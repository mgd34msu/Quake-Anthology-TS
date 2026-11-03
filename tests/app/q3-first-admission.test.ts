import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";

async function open(map: string, directory: string): Promise<Application> {
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", map, "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Expected native Q3 launch");
  return Application.open(parsed.options, { print: () => undefined, saveDirectory: join(directory, "saves") });
}

// q3ctf4's spawn point targets a target_give; its item publishes its model index only after the sv_init settle frames.
test("the first client on a spawn point that targets a target_give is admitted after the settle frames, holds the best given weapon and spawns at handicap health", async () => {
  const directory = await mkdtemp(join(tmpdir(), "q3-first-admission-"));
  let app: Application | null = null;
  try {
    app = await open("q3ctf4", directory);
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Expected native source");
    const human = app.session.createClient(0);
    source.host.engine.setUserinfo(0, "\\name\\Tester\\handicap\\50\\model\\sarge/default\\ip\\localhost");
    const player = app.simulation.admitPlayer(human.id);
    const entity = source.records.nativeByActor(player.actor);
    if (entity?.client == null) throw new Error("Expected admitted client");
    expect(entity.client.pers.maxHealth).toBe(50);
    expect(entity.health).toBe(75);
    expect(entity.client.ps.weapon).toBe(3);
    // Peer text that makes a command fail is reported to the peer instead of ending the server.
    expect(() => app?.simulation.playerCommand(player.actor, "follow", ["a\x1b"])).not.toThrow();
    expect(() => app?.simulation.playerCommand(player.actor, "gc", ["0", "7"])).not.toThrow();
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

test("a server with an IP ban still admits bots, which carry no ip key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "q3-banned-bot-"));
  let app: Application | null = null;
  try {
    app = await open("q3dm1", directory);
    app.queueCommand("addip", ["1.2.3.4"], null);
    app.queueCommand("addbot", ["sarge", "3"], null);
    for (let frame = 0; frame < 40; frame++) await app.step(100);
    expect(app.botClients).toHaveLength(1);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
