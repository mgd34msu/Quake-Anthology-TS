import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { applicationPreset } from "../../../src/app/bootstrap/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch, type InstalledCatalog } from "../../../src/content/catalog/index.ts";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import { q1MonsterSources } from "../../../src/content/monsters/q1.ts";
import { q2MonsterSources } from "../../../src/content/monsters/q2.ts";
import { readSelectedMonstersCheckpoint, type SelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";
import { testCorpusRoot } from "../../support/corpus.ts";

// Selected TS enemies on guest-program worlds (native DLL lanes are covered
// by q2-native-foreign-enemies.test.ts). Guests address trace hits by their
// own entity slots, so replacements are projected where the guest offers a
// qualified combat profile, and kept visibly guest-native where it does not.

let application: Application | null = null;
let directory: string | null = null;

afterEach(async () => {
  await application?.close(); application = null;
  if (directory !== null) { await rm(directory, { recursive: true, force: true }); directory = null; }
});

async function recipe(catalog: InstalledCatalog, options: Parameters<typeof applicationPreset>[1],
  provider: ProviderReference["provider"], content: string, classname: string): Promise<Awaited<ReturnType<typeof resolveLaunch>>> {
  const preset = applicationPreset(catalog, options);
  const source = { provider, content: catalog.require(content).id };
  return resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), enemies: { kind: "selected", value: {
    kind: "replace", default: { source, classname }, byClassname: {} } } } });
}

function selectedData(app: Application): SelectedMonstersCheckpoint {
  const checkpoint = simulationProviderCheckpoint(app.simulation.checkpoint(), "world:simulation");
  return readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(checkpoint.bytes)).field("selectedMonsters"));
}

describe("selected enemies on guest worlds", () => {
  test("QuakeC guest world fights selected Q2 soldiers and survives save/load", async () => {
    const corpus = testCorpusRoot();
    directory = await mkdtemp(join(tmpdir(), "guest-foreign-qc-"));
    const parsed = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--progs", "progs.dat",
      "--map", "e1m1", "--movement", "q1", "--character", "q1", "--mode", "singleplayer", "--dedicated", "--user-content-root", directory]);
    if (parsed.kind !== "run") throw new Error("Missing QuakeC launch options");
    const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
    const q2Source = q2MonsterSources.find(source => source.edition === "classic");
    if (q2Source === undefined) throw new Error("Missing Q2 classic monster source");
    application = await Application.open(parsed.options, { saveDirectory: join(directory, "saves"), print: () => undefined },
      await recipe(catalog, parsed.options, q2Source.provider, "q2-classic-baseq2", "monster_soldier"));
    const simulation = application.simulation;
    expect(simulation.quakecSource()).not.toBeNull();
    expect(simulation.presentations().filter(entry => entry.family === "q2").length).toBeGreaterThanOrEqual(5);

    await application.step(25);
    const client = application.session.createClient(0);
    const admission = simulation.admitPlayer(client.id);
    const player = simulation.actors.resolveOwned(admission.actor);
    if (player === null) throw new Error("Admitted player missing");
    await application.step(25);
    const data = selectedData(application);
    expect(data.authored.length).toBeGreaterThanOrEqual(5);
    // Teleport next to each replaced soldier in turn until one engages:
    // some authored spots are niches without a clear line to the player.
    let health = 10000;
    for (const entry of data.authored) {
      if (health < 10000) break;
      const soldier = simulation.actors.resolveSaved(entry.actor);
      if (soldier === null) continue;
      const soldierBody = simulation.bodies.read(soldier.id), playerBody = simulation.bodies.read(player.id);
      if (soldierBody === null || playerBody === null) continue;
      simulation.combat.setHealth(player, 10000);
      const dx = playerBody.origin.x - soldierBody.origin.x, dy = playerBody.origin.y - soldierBody.origin.y;
      const length = Math.hypot(dx, dy) || 1;
      simulation.bodies.write(player, { ...playerBody, origin: {
        x: soldierBody.origin.x + dx / length * 60, y: soldierBody.origin.y + dy / length * 60, z: soldierBody.origin.z } });
      simulation.bodies.link(player);
      for (let step = 0; step < 80 && health >= 10000; step++) {
        await application.step(50);
        health = Math.min(health, simulation.playerUi(admission.actor).health);
      }
    }
    expect(health).toBeLessThan(10000);

    const save = join(directory, "saves", "qc.sav");
    await application.saveGame(save);
    await application.loadGame(save);
    expect(application.simulation.quakecSource()).not.toBeNull();
    expect(selectedData(application).authored).toHaveLength(data.authored.length);
    expect(application.simulation.presentations().filter(entry => entry.family === "q2").length).toBeGreaterThanOrEqual(5);
    for (let step = 0; step < 10; step++) await application.step(50);
  }, 300_000);

  test("QVM guest world admits selected Q1 grunts as thinking adjuncts", async () => {
    const corpus = testCorpusRoot();
    directory = await mkdtemp(join(tmpdir(), "guest-foreign-qvm-"));
    const parsed = parseApplicationCommand(["--content-root", corpus, "--game", "q3-classic-lrctf", "--map-game", "q2-classic-baseq2",
      "--map", "base1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated", "--user-content-root", directory]);
    if (parsed.kind !== "run") throw new Error("Missing QVM launch options");
    const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: true });
    const q1Source = q1MonsterSources.find(source => source.edition === "classic");
    if (q1Source === undefined) throw new Error("Missing Q1 classic monster source");
    application = await Application.open(parsed.options, { saveDirectory: join(directory, "saves"), print: () => undefined },
      await recipe(catalog, parsed.options, q1Source.provider, "q1-classic-id1", "monster_army"));
    const simulation = application.simulation;
    if (simulation.q3Guest() === null) throw new Error("QVM guest missing");
    application.queueCommand("addbot", ["Sarge", "3"], null);
    for (let step = 0; step < 20; step++) await application.step(50);
    const data = selectedData(application);
    expect(data.authored.length).toBeGreaterThanOrEqual(10);
    expect(simulation.presentations().filter(entry => entry.family === "q1").length).toBeGreaterThanOrEqual(10);
    // Adjunct grunts must actually think on the guest: their animation
    // frames advance over time (monsterStart follows the trait writes
    // guest-backed combat bindings now expose).
    const frames = new Set<number>();
    for (let step = 0; step < 120; step++) {
      await application.step(50);
      for (const entry of simulation.presentations()) if (entry.family === "q1") frames.add(entry.frame);
    }
    expect(frames.size).toBeGreaterThanOrEqual(3);
  }, 300_000);

  test("TS Q3 source hosts a Q2 map through the foreign world adjunct", async () => {
    const corpus = testCorpusRoot();
    directory = await mkdtemp(join(tmpdir(), "foreign-world-q3-"));
    const parsed = parseApplicationCommand(["--content-root", corpus, "--game", "q3-baseq3", "--map-game", "q2-classic-baseq2",
      "--map", "base1", "--movement", "q3", "--character", "q3", "--mode", "singleplayer", "--dedicated", "--user-content-root", directory]);
    if (parsed.kind !== "run") throw new Error("Missing foreign launch options");
    const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
    const preset = applicationPreset(catalog, parsed.options);
    application = await Application.open(parsed.options, { saveDirectory: join(directory, "saves"), print: () => undefined },
      await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) }));
    const simulation = application.simulation;
    expect(simulation.q3Source()).not.toBeNull();
    const admission = simulation.admitPlayer(application.session.createClient(0).id);
    const player = simulation.actors.resolveOwned(admission.actor);
    if (player === null) throw new Error("Admitted player missing");
    for (let step = 0; step < 20; step++) await application.step(50);
    // The adjunct spawned the Q2 world the Q3 source has no spawns for:
    // native soldiers, items, movers are live presentations.
    const adjunctPresentations = simulation.presentations().filter(entry => entry.family === "q2");
    expect(adjunctPresentations.length).toBeGreaterThanOrEqual(20);
    // An adjunct-native soldier engages a teleported player.
    const playerBody = simulation.bodies.read(player.id);
    if (playerBody === null) throw new Error("Player body missing");
    simulation.combat.setHealth(player, 10000);
    let health = 10000;
    for (const candidate of adjunctPresentations.slice(0, 30)) {
      if (health < 10000) break;
      const current = simulation.bodies.read(player.id);
      if (current === null) break;
      const dx = current.origin.x - candidate.origin.x, dy = current.origin.y - candidate.origin.y;
      const length = Math.hypot(dx, dy) || 1;
      simulation.bodies.write(player, { ...current, origin: {
        x: candidate.origin.x + dx / length * 60, y: candidate.origin.y + dy / length * 60, z: candidate.origin.z } });
      simulation.bodies.link(player);
      for (let step = 0; step < 60 && health >= 10000; step++) {
        await application.step(50);
        health = Math.min(health, simulation.playerUi(admission.actor).health);
      }
      simulation.combat.setHealth(player, 10000);
    }
    expect(health).toBeLessThan(10000);
    const before = simulation.presentations().length;
    const save = join(directory, "saves", "foreign.sav");
    await application.saveGame(save);
    await application.loadGame(save);
    expect(application.simulation.q3Source()).not.toBeNull();
    expect(application.simulation.presentations().filter(entry => entry.family === "q2").length).toBeGreaterThanOrEqual(20);
    expect(application.simulation.presentations().length).toBe(before);
    for (let step = 0; step < 10; step++) await application.step(50);
  }, 300_000);
});
