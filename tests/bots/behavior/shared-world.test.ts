import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const retail = test.skipIf(!existsSync(resolve(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(resolve(corpus, "q3a/baseq3/pak0.pk3")));

retail("one bot controller moves and fires in Q2 and preserves its real client and shared configuration through travel", async () => {
  const launch = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--map", "base1",
    "--movement", "q2", "--character", "q2", "--mode", "deathmatch", "--dedicated"]);
  if (launch.kind !== "run") throw new Error("Expected Q2 launch");
  const application = await Application.open(launch.options, { print: () => undefined });
  try {
    expect(application.botClients).toHaveLength(0);
    expect(application.content.openedMounts().some(mount => mount.plan.mounts.some(source => source.kind === "archive" && source.archivePath.includes("q3a")))).toBe(false);
    const client = application.session.createClient(0), human = application.simulation.admitPlayer(client.id);
    application.queueCommand("addbot", ["Ranger", "5"], null); await application.step(100);
    const bot = application.botClients[0]; if (bot === undefined) throw new Error("Bot was not admitted");
    const actor = application.simulation.players().find(actor => application.simulation.movementPlayer(actor)?.client.equals(bot.client.id));
    if (actor === undefined) throw new Error("Bot has no shared actor");
    const source = application.simulation.q2Source(), origin = application.simulation.bodies.read(actor)?.origin;
    if (source === null || origin === undefined) throw new Error("Missing Q2 world");
    const target = source.game.entity(human.actor); if (target === null) throw new Error("Missing human entity");
    source.players.teleportPlayer(target, source.game, { x: origin.x + 160, y: origin.y, z: origin.z }, { x: 0, y: 180, z: 0 });
    expect((source.game.entity(actor)?.serverFlags ?? 0) & 16).toBe(16);
    let attacks = 0;
    for (let frame = 0; frame < 80; frame++) {
      await application.step(100);
      if (((application.simulation.movementPlayer(actor)?.buttons ?? 0) & 1) !== 0) attacks++;
    }
    const position = application.simulation.bodies.read(actor)?.origin; if (position === undefined) throw new Error("Lost bot body");
    expect(Math.hypot(position.x - origin.x, position.y - origin.y)).toBeGreaterThan(32);
    expect(attacks).toBeGreaterThan(0);
    expect(application.simulation.combat.read(human.actor)?.health).toBeLessThan(100);
    const configuration = application.simulation.botServices.configuration;
    if (configuration === null) throw new Error("Bot did not borrow application configuration");
    configuration.set("bot_thinktime", "150", true);
    await application.changeLevel("base1");
    expect(application.botClients[0]?.client.id.equals(bot.client.id)).toBe(true);
    expect(application.simulation.botServices.configuration).toBe(configuration);
    expect(configuration.variableValue("bot_thinktime")).toBe(150);
    expect(application.simulation.players().some(current => current.equals(actor))).toBe(false);
    await application.step(100);
    application.queueCommand("removebot", [String(bot.client.id.slot)], null); await application.step(100);
    expect(application.botClients).toHaveLength(0);
    expect(bot.client.isClosed).toBe(true);
    expect(application.simulation.players()).toHaveLength(1);
  } finally { await application.close(); }
}, 120000);
