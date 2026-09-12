import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { SaveImage } from "../../../src/contracts/session.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

function monsters(image: SaveImage) {
  const state = image.providers.find(entry => entry.schema === "world:simulation");
  if (state === undefined) throw new Error("Missing simulation checkpoint");
  return readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(state.bytes)).field("selectedMonsters"));
}

function stableActors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableActors);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value).filter(key => key !== "generation" || !("slot" in value))
    .map((key): [string, unknown] => { const entry: unknown = Reflect.get(value, key); return [key, stableActors(entry)]; }));
}

const corpus = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(join(corpus, "q1/id1/PAK0.PAK")) || !existsSync(join(corpus, "q2/rerelease/baseq2/pak0.pak")) || !existsSync(join(corpus, "q3a/baseq3/pak0.pk3")))("retail Q1 map preserves rerelease infantry cadence, restore continuity, and one Q3 grenade turn", async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q2", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected launch command");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const provider = "q2:monsters/rerelease/baseq2";
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: "q3:official", content: catalog.require("q3-baseq3").id }] }, enemies: { kind: "selected", value: {
    kind: "replace", default: { source: { provider, content: catalog.require("q2-rerelease-baseq2").id }, classname: "monster_infantry" }, byClassname: {
      monster_dog: { source: { provider: "q2:monsters/classic/baseq2", content: catalog.require("q2-classic-baseq2").id }, classname: "monster_infantry" },
    },
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("monster-cadence");
  const options = { identity, recipe, world: content.world, mounts: content.mounts, skill: command.options.skill,
    mode: command.options.mode, seed: command.options.seed, maxClients: 1 };
  const original = createSimulation(options);
  try {
    const selected = original.actors.observations().filter(actor => actor.definition === `${provider}/monster_infantry`);
    const classic = original.actors.observations().filter(actor => actor.definition === "q2:monsters/classic/baseq2/monster_infantry");
    expect(selected.length).toBeGreaterThan(0); expect(classic.length).toBeGreaterThan(0);
    for (const actor of [...selected, ...classic]) expect(actor.owner).toBe(recipe.map.entities.provider);
    const calls = new Map<number, number[]>(), step = original.physics.step.bind(original.physics);
    original.physics.step = (actor, elapsed) => {
      if ([...selected, ...classic].some(value => value.id.equals(actor.id))) {
        const values = calls.get(actor.id.slot) ?? []; values.push(elapsed); calls.set(actor.id.slot, values);
      }
      return step(actor, elapsed);
    };
    original.step({ elapsedMilliseconds: 100, commands: [] });
    const saved = original.checkpoint(), source = monsters(saved).sources[0];
    expect(source?.frame).toEqual({ frame: 4, phase: "frame-entry", time: { kind: "milliseconds", value: 100 }, elapsed: { kind: "milliseconds", value: 25 } });
    for (const actor of selected) expect(calls.get(actor.id.slot)).toEqual([0.025, 0.025, 0.025, 0.025]);
    for (const actor of classic) expect(calls.get(actor.id.slot)).toEqual([0.1]);
    const restored = createSimulation({ ...options, restore: saved, restoredClients: [] });
    try {
      for (const elapsedMilliseconds of [24.6, 1, 74.4, 100]) {
        original.step({ elapsedMilliseconds, commands: [] }); restored.step({ elapsedMilliseconds, commands: [] });
        if (elapsedMilliseconds === 24.6) expect(monsters(original.checkpoint()).sources[0]?.frame.time).toEqual({ kind: "milliseconds", value: 100 });
        expect(stableActors(monsters(restored.checkpoint()))).toEqual(stableActors(monsters(original.checkpoint())));
        expect(stableActors(restored.checkpoint().bodies)).toEqual(stableActors(original.checkpoint().bodies));
      }
    } finally { restored.close(); }
    const client = identity.client(0, 0), player = original.admitPlayer(client).actor;
    const movement = original.movementPlayer(player);
    if (movement === null) throw new Error("Missing grenade owner");
    original.inventory.give(movement.actor, "q3:weapon/grenadelauncher", 1);
    original.inventory.give(movement.actor, "q3:ammo/grenadelauncher", 20);
    let grenade = original.actors.observations().find(actor => actor.definition === "q3:projectile");
    for (let sequence = 1; sequence <= 20 && grenade === undefined; sequence++) {
      original.step({ elapsedMilliseconds: 100, commands: [{ actor: player, source: { kind: "remote-client", client }, sequence,
        command: { kind: "q2-classic", milliseconds: 100, angleShorts: [57344, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: sequence === 1 ? 0 : 1, impulse: 0, lightLevel: 0 },
        arsenal: { provider: "q3:official", weapon: "q3:weapon/grenadelauncher", useHoldable: false },
      }] });
      grenade = original.actors.observations().find(actor => actor.definition === "q3:projectile");
    }
    if (grenade === undefined) throw new Error("Selected Q3 grenade was not launched");
    original.drainPresentationEvents();
    original.step({ elapsedMilliseconds: 100, commands: [] });
    const moves = original.drainPresentationEvents().filter(event => event.kind === "q3-ballistics" && event.event.kind === "projectile" && event.event.actor.equals(grenade.id));
    expect(moves).toHaveLength(1);
  } finally { original.close(); await content.close(); }
}, 60000);
