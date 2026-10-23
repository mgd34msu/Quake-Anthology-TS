import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import type { ItemId } from "../../../src/contracts/gameplay.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

// Q3-authored maps on TS Q1/Q2 primaries: Q3 items and world classes are
// hosted by the primary's own spawn/pickup systems through the shared
// Q3 supply profiles, so authored weapons grant playable destinations.

let application: Application | null = null;
let directory: string | null = null;

afterEach(async () => {
  await application?.close(); application = null;
  if (directory !== null) { await rm(directory, { recursive: true, force: true }); directory = null; }
});

async function foreignQ3Lane(args: string[], modelNeedle: string, expectedWeapon: ItemId): Promise<void> {
  const corpus = testCorpusRoot();
  directory = await mkdtemp(join(tmpdir(), "foreign-q3-map-"));
  const parsed = parseApplicationCommand(["--content-root", corpus, ...args, "--user-content-root", directory]);
  if (parsed.kind !== "run") throw new Error("Missing foreign Q3 launch options");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, parsed.options);
  application = await Application.open(parsed.options, { saveDirectory: join(directory, "saves"), print: () => undefined },
    await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) }));
  const simulation = application.simulation;
  const admission = simulation.admitPlayer(application.session.createClient(0).id);
  const player = simulation.actors.resolveOwned(admission.actor);
  if (player === null) throw new Error("Admitted player missing");
  for (let step = 0; step < 20; step++) await application.step(50);
  expect(simulation.inventory.count(player.id, expectedWeapon)).toBe(0);
  const pickup = simulation.presentations().find(entry => entry.path.includes(modelNeedle));
  if (pickup === undefined) throw new Error(`Authored pickup ${modelNeedle} missing`);
  const body = simulation.bodies.read(player.id);
  if (body === null) throw new Error("Player body missing");
  simulation.bodies.write(player, { ...body, origin: pickup.origin });
  simulation.bodies.link(player);
  simulation.physics.touchTriggers(player);
  for (let step = 0; step < 40 && simulation.inventory.count(player.id, expectedWeapon) === 0; step++) await application.step(50);
  expect(simulation.inventory.count(player.id, expectedWeapon)).toBe(1);
  const before = simulation.presentations().length;
  const save = join(directory, "saves", "foreign-q3.sav");
  await application.saveGame(save);
  await application.loadGame(save);
  expect(application.simulation.presentations().length).toBe(before);
  for (let step = 0; step < 10; step++) await application.step(50);
}

describe("Q3-authored maps on TS Q1/Q2 primaries", () => {
  test("Q1 source hosts q3dm17 and grants the railgun destination", async () => {
    await foreignQ3Lane(["--game", "q1-classic-id1", "--map-game", "q3-baseq3", "--map", "q3dm17",
      "--movement", "q1", "--character", "q1", "--mode", "deathmatch", "--dedicated"],
      "weapons2/railgun", "q1:weapon/supernailgun");
  }, 300_000);

  test("Q2 source hosts q3dm1 and grants the plasmagun destination", async () => {
    await foreignQ3Lane(["--game", "q2-classic-baseq2", "--map-game", "q3-baseq3", "--map", "q3dm1",
      "--movement", "q2", "--character", "q2", "--mode", "deathmatch", "--dedicated"],
      "weapons2/plasma", "q2:weapon_hyperblaster");
  }, 300_000);
});
