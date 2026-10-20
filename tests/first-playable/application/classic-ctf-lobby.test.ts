import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { readField, readObject, readString } from "../../support/reflect.ts";

// Classic ThreeWave lobby regression: bootstrap canonicalizes shared combat
// teams to team:red/team:blue; the CTF team reader must accept that spelling
// (a plain-only read made CheckTeamLock kill the player every frame), and the
// lobby map is ctfstart, not start.
test("q1-classic-ctf lobby spawn keeps the player alive", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-ctf", "--map", "ctfstart",
    "--movement", "q1", "--character", "q1", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    for (let index = 0; index < 20; index++) await app.step(50);
    expect(app.simulation.playerUi(local.actor).health).toBe(100);
    const source = readObject(app.simulation, "source");
    expect(readString(source, "kind")).toBe("q1");
  } finally { await app.close(); }
}, 120000);

test("q1-classic-ctf match spawn keeps the player alive on an assigned team", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q1-classic-ctf", "--map", "ctf1",
    "--movement", "q1", "--character", "q1", "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    for (let index = 0; index < 20; index++) await app.step(50);
    expect(app.simulation.playerUi(local.actor).health).toBe(100);
    const combat = readObject(app.simulation, "combat"), read = readField(combat, "read");
    if (typeof read !== "function") throw new Error("Combat authority has no reader");
    const state: unknown = Reflect.apply(read, combat, [local.actor]);
    if (typeof state !== "object" || state === null) throw new Error("Player has no combat state");
    const team: unknown = readField(state, "team");
    expect(team === "team:red" || team === "team:blue").toBe(true);
  } finally { await app.close(); }
}, 120000);
