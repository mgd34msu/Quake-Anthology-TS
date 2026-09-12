import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProviderReference } from "../../../src/contracts/content.ts";
import type { ItemId } from "../../../src/contracts/gameplay.ts";
import type { ActorId, ClientId, ProviderId } from "../../../src/contracts/identity.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { readSelectedMonstersCheckpoint } from "../../../src/app/bootstrap/simulation/monster-checkpoint.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import { decodeCheckpointValue, SaveReader } from "../../../src/persistence/value.ts";

const corpus = resolve(import.meta.dir, "../../../../qfiles");
const weapons: readonly { readonly family: "q1" | "q3"; readonly provider: ProviderId; readonly weapon: ItemId; readonly ammo: ItemId; readonly catalog: string }[] = [
  { family: "q1", provider: "q1:official", weapon: "q1:weapon/shotgun", ammo: "q1:ammo/shells", catalog: "q1-classic-id1" },
  { family: "q3", provider: "q3:official", weapon: "q3:weapon/machinegun", ammo: "q3:ammo/machinegun", catalog: "q3-baseq3" },
];
type Simulation = ReturnType<typeof createSimulation>;
function continuation(simulation: Simulation): string {
  const checkpoint = simulation.checkpoint(), saved = simulationProviderCheckpoint(checkpoint, "world:simulation");
  return JSON.stringify({ source: readSelectedMonstersCheckpoint(new SaveReader(decodeCheckpointValue(saved.bytes)).field("selectedMonsters")), bodies: checkpoint.bodies },
    (key: string, value: unknown) => key === "generation" ? 0 : value);
}
function oneDamage(simulation: Simulation, target: ActorId) {
  const body = simulation.bodies.read(target);
  if (body === null) throw new Error("Missing brain body");
  const yaw = body.angles.y * Math.PI / 180;
  return simulation.combat.apply({ target, amount: 1, knockback: 0, direction: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 },
    point: { x: body.origin.x + Math.cos(yaw) * 16, y: body.origin.y + Math.sin(yaw) * 16, z: body.origin.z }, delivery: "direct",
    attack: { sequence: 9000, time: { kind: "seconds", value: simulation.timeSeconds }, attacker: null, inflictor: null, weapon: null,
      weaponProvider: "q1:official", combatProvider: simulation.recipe.combat.provider, inventoryProvider: simulation.recipe.inventory.provider,
      movementProvider: simulation.recipe.movement.provider, cause: { kind: "q1", deathType: "" } } });
}
for (const weapon of weapons) test.skipIf(["q1/id1/PAK0.PAK", "q2/baseq2/pak0.pak", "q2/rerelease/baseq2/pak0.pak", "q3a/baseq3/pak0.pk3"].some(path => !existsSync(resolve(corpus, path))))(`retail fact1 rerelease brain screens actual selected ${weapon.family} shots and restores shared cells`, async () => {
  const command = parseApplicationCommand(["--content-root", corpus, "--game", "q2-classic-baseq2", "--map", "fact1", "--movement", "q2", "--character", "q2", "--dedicated", "--mode", "singleplayer"]);
  if (command.kind !== "run") throw new Error("Expected Q2 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const source: ProviderReference = { provider: "q2:monsters/rerelease/baseq2", content: catalog.require("q2-rerelease-baseq2").id };
  const classic: ProviderReference = { provider: "q2:monsters/classic/baseq2", content: catalog.require("q2-classic-baseq2").id };
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [{ provider: weapon.provider, content: catalog.require(weapon.catalog).id }] }, enemies: { kind: "selected", value: {
    kind: "replace", default: { source: classic, classname: "monster_infantry" },
    byClassname: Object.fromEntries(["monster_flipper", "monster_gunner", "monster_flyer", "monster_soldier_ss", "monster_berserk", "monster_infantry", "monster_hover", "monster_brain", "monster_parasite", "monster_gladiator", "monster_soldier_light", "monster_soldier"].map(classname => [classname, { source: classname === "monster_brain" ? source : classic, classname }])),
  } } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`brain-${weapon.family}`), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 };
  const original = createSimulation(options);
  const step = (simulation: Simulation, actor: ActorId, client: ClientId, sequence: number, yaw: number, attack: boolean) => simulation.step({ elapsedMilliseconds: 100, commands: [{
    actor, source: { kind: "remote-client", client }, sequence,
    command: { kind: "q2-classic", milliseconds: 100, angleShorts: [0, Math.round(yaw * 65536 / 360) & 65535, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse: 0, lightLevel: 0 },
    arsenal: { provider: weapon.provider, weapon: weapon.weapon, useHoldable: false },
  }] });
  try {
    const player = original.admitPlayer(client).actor, movement = original.movementPlayer(player);
    if (movement === null) throw new Error("Missing selected weapon owner");
    original.inventory.give(movement.actor, weapon.weapon, 1); original.inventory.give(movement.actor, weapon.ammo, 100);
    for (let frame = 0; frame < 8; frame++) step(original, player, client, frame, 0, false);
    const brain = original.actors.observations().find(actor => actor.definition === `${source.provider}/monster_brain`);
    if (brain === undefined) throw new Error("Missing authored fact1 brain");
    expect(brain.owner).toBe(recipe.map.entities.provider);
    expect(original.inventory.count(brain.id, "q2:monster-power")).toBe(100);
    const baseline = decodeSaveImage(encodeSaveImage(original.checkpoint()));
    for (const front of [true, false]) {
      const branch = createSimulation({ ...options, restore: baseline, restoredClients: [client] });
      try {
        const target = branch.actors.resolveSaved(brain.id), shooter = branch.players()[0];
        const owned = shooter === undefined ? null : branch.actors.resolveOwned(shooter);
        if (target === null || shooter === undefined || owned === null) throw new Error("Missing restored shot actors");
        const body = branch.bodies.read(target.id), playerBody = branch.bodies.read(shooter), map = branch.q2Source();
        if (body === null || playerBody === null || map === null) throw new Error("Missing shot bodies");
        const radians = body.angles.y * Math.PI / 180, sign = front ? 1 : -1;
        const lane = { x: body.origin.x + Math.cos(radians) * 96 * sign, y: body.origin.y + Math.sin(radians) * 96 * sign, z: body.origin.z };
        const floor = map.game.host.trace({ start: { ...lane, z: lane.z + 32 }, end: { ...lane, z: lane.z - 96 }, bounds: playerBody.bounds, ignore: shooter, mask: 1 });
        expect(floor.startSolid).toBe(false); expect(floor.allSolid).toBe(false); expect(floor.fraction).toBeLessThan(1);
        branch.bodies.write(owned, { ...playerBody, origin: floor.end }); branch.bodies.link(owned); branch.combat.setHealth(owned, 1000);
        let hits = 0, absorbed = 0;
        const before = branch.inventory.count(target.id, "q2:monster-power");
        for (let frame = 0; frame < 8 && hits === 0; frame++) {
          const output = step(branch, shooter, client, 100 + frame, body.angles.y + (front ? 180 : 0), true);
          for (const event of output.events) if (event.payload.kind === "damage" && event.payload.outcome.kind === "committed") {
            const decision = event.payload.outcome.decision;
            if (decision.request.target.equals(target.id) && decision.request.attack.weapon === weapon.weapon && decision.request.attack.attacker?.equals(shooter)) {
              expect(decision.request.attack.cause.kind).toBe(weapon.family); expect(decision.appliedDamage).toBeGreaterThan(0);
              for (const mutation of decision.mutations) if (mutation.kind === "armor" && mutation.before.kind === "q2" && mutation.after.kind === "q2"
                && mutation.before.powerArmor.kind !== "none" && mutation.after.powerArmor.kind !== "none") absorbed += mutation.before.powerArmor.cells - mutation.after.powerArmor.cells;
              hits++;
            }
          }
        }
        expect(hits).toBeGreaterThan(0);
        if (front) expect(absorbed).toBeGreaterThan(0); else expect(absorbed).toBe(0);
        expect(branch.inventory.count(target.id, "q2:monster-power")).toBe(before - absorbed);
        const resumed = createSimulation({ ...options, restore: decodeSaveImage(encodeSaveImage(branch.checkpoint())), restoredClients: [client] });
        try {
          const restoredBrain = resumed.actors.resolveSaved(target.id);
          if (restoredBrain === null) throw new Error("Missing saved brain");
          expect(resumed.inventory.count(restoredBrain.id, "q2:monster-power")).toBe(before - absorbed);
          expect(continuation(resumed)).toBe(continuation(branch));
          if (front) {
            oneDamage(branch, target.id); oneDamage(resumed, restoredBrain.id);
            expect(resumed.inventory.count(restoredBrain.id, "q2:monster-power")).toBe(before - absorbed - 1);
            expect(continuation(resumed)).toBe(continuation(branch));
          }
          for (let frame = 0; frame < 4; frame++) { branch.step({ elapsedMilliseconds: 100, commands: [] }); resumed.step({ elapsedMilliseconds: 100, commands: [] }); expect(continuation(resumed)).toBe(continuation(branch)); }
        } finally { resumed.close(); }
      } finally { branch.close(); }
    }
    // This is an armor arithmetic probe through shared authority, not a fired weapon.
    const before = original.inventory.count(brain.id, "q2:monster-power"), outcome = oneDamage(original, brain.id);
    expect(outcome.kind).toBe("committed");
    if (outcome.kind !== "committed") throw new Error("Brain rejected armor probe");
    expect(outcome.decision.appliedDamage).toBe(0); expect(original.inventory.count(brain.id, "q2:monster-power")).toBe(before - 1);
    if (weapon.family === "q1") {
      const body = original.bodies.read(brain.id), world = original.actors.atSource(recipe.map.entities.provider, 0);
      if (body === null || world === null) throw new Error("Missing armor hazard control actors");
      for (const inflictor of [null, world.id]) {
        const hazard = original.combat.apply({ ...outcome.decision.request, point: body.origin, direction: { x: 0, y: 1, z: 0 },
          attack: { ...outcome.decision.request.attack, inflictor } });
        expect(hazard.kind).toBe("committed");
        if (hazard.kind !== "committed") throw new Error("Armor control rejected");
        expect(hazard.decision.appliedDamage).toBe(1);
        expect(original.inventory.count(brain.id, "q2:monster-power")).toBe(before - 1);
      }
      const nativeCommand = parseApplicationCommand(["--content-root", corpus, "--game", "q2-rerelease-baseq2", "--map", "fact1", "--dedicated", "--mode", "singleplayer"]);
      if (nativeCommand.kind !== "run") throw new Error("Expected native rerelease launch");
      const nativeContent = await loadApplicationContent(nativeCommand.options);
      const native = createSimulation({ identity: createIdentityOwner("native-brain-armor"), recipe: nativeContent.recipe,
        world: nativeContent.world, mounts: nativeContent.mounts, skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
      try {
        for (let frame = 0; frame < 4; frame++) native.step({ elapsedMilliseconds: 100, commands: [] });
        const game = native.q2Source()?.game, nativeBrain = game === undefined ? undefined : [...game.entities.values()].find(entity => entity.classname === "monster_brain");
        if (nativeBrain === undefined) throw new Error("Missing native rerelease brain");
        const nativeBefore = native.inventory.count(nativeBrain.actor.id, "q2:monster-power"), nativeOutcome = oneDamage(native, nativeBrain.actor.id);
        expect(nativeOutcome.kind).toBe("committed");
        if (nativeOutcome.kind !== "committed") throw new Error("Native brain rejected armor probe");
        expect(nativeOutcome.decision.appliedDamage).toBe(outcome.decision.appliedDamage);
        expect(nativeBefore - native.inventory.count(nativeBrain.actor.id, "q2:monster-power")).toBe(1);
      } finally { native.close(); await nativeContent.close(); }
    }
  } finally { original.close(); await content.close(); }
}, 60000);
