import { expect, test } from "bun:test";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

const cases = [
  { family: "q1", movement: "q1", character: "q1", weapons: "q1-classic-id1", body: "progs/player.mdl" },
  { family: "q2", movement: "q2", character: "q2", weapons: "q2-classic-baseq2", body: "players/male/tris.md2" },
] as const;

for (const row of cases) test(`${row.family} character, movement and weapons run in a Q3 world through Application`, async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q3-baseq3", "--map", "q3dm0", "--movement", row.movement,
    "--character", row.character, "--mode", "deathmatch", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
    weapons: { kind: "selected", value: [{ provider: `${row.family}:official`, content: catalog.require(row.weapons).id }] } } });
  const prints: string[] = [];
  const app = await Application.open(parsed.options, { print: text => { prints.push(text); } }, recipe);
  try {
    for (let index = 0; index < 12; index++) await app.step(50);
    const local = app.localPlayers[0];
    if (local === undefined) throw new Error("Missing local player");
    const presentations = app.simulation.presentations().filter(entry => entry.actor.equals(local.actor));
    expect(presentations.some(entry => !entry.viewWeapon && entry.path === row.body)).toBe(true);
    expect(presentations.some(entry => entry.viewWeapon && entry.family === row.family)).toBe(true);
    expect(app.simulation.playerUi(local.actor).activeWeapon?.startsWith(`${row.family}:`)).toBe(true);
    const source = app.simulation.q3Source();
    if (source === null) throw new Error("Missing Q3 source");
    const config = source.sourceState().configstrings.find(entry => entry.index === 544)?.value ?? "";
    expect(config).toContain("model\\sarge/default");
    expect(config).not.toContain("model\\player/default");
    expect(config).not.toContain("model\\male/default");
    expect(prints.join("")).not.toContain("Failed to load model file");
  } finally { await app.close(); }
}, 60000);
