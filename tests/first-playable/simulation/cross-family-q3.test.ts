import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

interface Case {
  readonly family: string; readonly movement: string; readonly character: string; readonly weapons: string; readonly body: string;
  readonly enemies?: string; readonly botCharacter: "q1" | "q2" | "q3"; readonly botBody: string | null;
}
const cases: readonly Case[] = [
  { family: "q1", movement: "q1", character: "q1", weapons: "q1-classic-id1", body: "progs/player.mdl", botCharacter: "q3", botBody: null },
  { family: "q2", movement: "q2", character: "q2", weapons: "q2-classic-baseq2", body: "players/male/tris.md2", botCharacter: "q3", botBody: null },
  { family: "q1", movement: "q1", character: "q1", weapons: "q1-classic-id1", body: "progs/player.mdl",
    enemies: "q2-classic-baseq2", botCharacter: "q2", botBody: "players/male/tris.md2" },
];

for (const row of cases) test(`${row.family} character, movement and weapons run in a Q3 world through Application`, async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3", "--map", "q3dm1", "--movement", row.movement,
    "--character", row.character, "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: "selected", value: [{ provider: `${row.family}:official`, content: catalog.require(row.weapons).id }] },
    ...(row.enemies === undefined ? {} : { enemies: { kind: "selected", value: { kind: "players",
      character: { provider: "q2:character", content: catalog.require(row.enemies).id } } } }) } });
  const prints: string[] = [];
  const app = await Application.open(parsed.options, { print: text => { prints.push(text); } }, recipe);
  try {
    for (let index = 0; index < 12; index++) await app.step(50);
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const presentations = app.simulation.presentations().filter(entry => entry.actor.equals(local.actor));
    expect(presentations.some(entry => !entry.viewWeapon && entry.path === row.body)).toBe(true);
    const gun = presentations.find(entry => entry.viewWeapon && entry.family === row.family);
    expect(gun).toBeDefined();
    expect(gun?.viewOrigin).toBeDefined();
    expect(gun?.viewAngles).toBeDefined();
    // Strafe through render frames that do not align with fixed ticks; the
    // authored gun must stay usable (scene re-anchors it to the final eye).
    const strafe = (down: boolean): void => { app.input({ seat: local.seat.id, kind: "key", code: 100, down,
      repeat: false, timeMilliseconds: performance.now() }); };
    strafe(true);
    for (let index = 0; index < 12; index++) await app.step(16);
    strafe(false);
    expect(app.simulation.presentations().some(entry => entry.viewWeapon && entry.actor.equals(local.actor) && entry.viewOrigin !== undefined)).toBe(true);
    expect(app.simulation.playerUi(local.actor).activeWeapon?.startsWith(`${row.family}:`)).toBe(true);
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Missing Q3 source");
    const config = source.sourceState().configstrings.find(entry => entry.index === 544)?.value ?? "";
    expect(config).toContain("model\\sarge/default");
    expect(config).not.toContain("model\\player/default");
    expect(config).not.toContain("model\\male/default");
    // Single-player Q3 arenas are bot matches: the authored arena roster
    // (Ranger on q3dm1) must actually enter, even with foreign weapons.
    for (let index = 0; index < 300 && !prints.some(text => text.includes("Ranger^7 entered the game")); index++) await app.step(50);
    expect(app.simulation.players().length).toBeGreaterThan(1);
    expect(prints.join("")).toContain("Ranger^7 entered the game");
    const bot = app.simulation.players().find(actor => !actor.equals(local.actor));
    if (bot === undefined) throw new Error("Missing bot player");
    expect(app.simulation.movementPlayer(bot)?.character).toBe(row.botCharacter);
    const botBodies = app.simulation.presentations().filter(entry => entry.actor.equals(bot) && !entry.viewWeapon);
    if (row.botBody === null) expect(botBodies.some(entry => entry.path === row.body)).toBe(false);
    else expect(botBodies.some(entry => entry.path === row.botBody)).toBe(true);
    expect(prints.join("")).not.toContain("Failed to load model file");
  } finally { await app.close(); }
}, 120000);
