import { Q1_DONOR_PROFILE } from "../../../src/core/numeric.ts";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { cameraWithKick } from "../../../src/app/bootstrap/presentation.ts";
import { anglesToAxis } from "../../../src/core/math.ts";
import { perspectiveProjection } from "../../../src/render/scene/view.ts";
import { q1Creatures } from "../../../src/content/q1/base/creatures.ts";
import type { ActorId, ClientId } from "../../../src/contracts/identity.ts";
import { simulationProviderCheckpoint } from "../../../src/app/bootstrap/simulation/save.ts";
import { encodeSaveImage, decodeSaveImage } from "../../../src/persistence/index.ts";
import { SaveReader, decodeCheckpointValue } from "../../../src/persistence/value.ts";
import type { Q2Edition } from "../../../src/content/q2/foundation/host.ts";
import { expect, test } from "bun:test";
import { applicationPreset, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import { EntityEvent, EV_EVENT_BITS } from "../../../src/content/q3/base/shared/definitions.ts";
import type { ItemId } from "../../../src/contracts/gameplay.ts";

test("Q1 force_retouch links players without a source entity and runs the actual map pickup", async () => {
  const command = parseApplicationCommand(["--preset", "q1-q2", "--map", "e1m1"]);
  if (command.kind !== "run") throw new Error("Expected application launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("actor-execution-retouch");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 0, mode: "singleplayer", seed: 17, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(identity.client(0, 0)).actor, source = simulation.q1Source();
    const player = simulation.movementPlayer(actor);
    if (source === null || player === null) throw new Error("Missing admitted source player");
    expect(source.game.entity(actor)).toBeNull();
    for (let frame = 0; frame < 4; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const pickup = [...source.game.entities.values()].find(entity => entity.classname === "item_shells");
    if (pickup === undefined) throw new Error("Retail map shell pickup missing");
    const pickupBody = simulation.bodies.read(pickup.actor.id), playerBody = simulation.bodies.read(actor);
    if (pickupBody === null || playerBody === null) throw new Error("Missing shared body");
    const before = simulation.inventory.count(actor, "q1:ammo/shells");
    simulation.bodies.write(player.actor, { ...playerBody, origin: pickupBody.origin, velocity: { x: 0, y: 0, z: 0 } });
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.inventory.count(actor, "q1:ammo/shells")).toBe(before);
    source.game.forceRetouch = 1;
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(simulation.inventory.count(actor, "q1:ammo/shells")).toBeGreaterThan(before);
    expect(source.game.forceRetouch).toBe(0);
  } finally { simulation.close(); await content.close(); }
});

test("native Q1 desired weapon intents preserve continuous fire and source impulses", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "dm4", "--movement", "q1", "--character", "q1", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected native Q1 launch");
  const content = await loadApplicationContent(command.options);
  try {
    const exercise = (repeatSelection: boolean) => {
      const identity = createIdentityOwner(`q1-native-intent-${repeatSelection}`);
      const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: 0, mode: "deathmatch", seed: 17, maxClients: 1 });
      try {
        const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
        const source = simulation.q1Source(), movement = simulation.movementPlayer(actor);
        const native = source?.game.player(actor);
        if (source === null || movement === null || native == null) throw new Error("Missing native Q1 player");
        for (const item of ["q1:weapon/nailgun", "q1:weapon/lightning"] satisfies readonly ItemId[]) simulation.inventory.give(movement.actor, item, 1);
        simulation.inventory.give(movement.actor, "q1:ammo/nails", 40);
        simulation.inventory.give(movement.actor, "q1:ammo/cells", 40);
        let sequence = 0;
        const step = (weapon: ItemId | null, attack: boolean, impulse = 0) => simulation.step({ elapsedMilliseconds: 100, commands: [{
          actor, source: { kind: "remote-client", client }, sequence: sequence++,
          command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: movement.viewAngles,
            forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse },
          arsenal: { provider: movement.arsenal.provider, weapon, useHoldable: false },
        }] });
        const timeline: { weapon: string; frame: number; continuous: boolean; deadline: number; nextFrame: number; ammo: number }[] = [];
        for (const [weapon, ammo] of [["q1:weapon/nailgun", "q1:ammo/nails"], ["q1:weapon/lightning", "q1:ammo/cells"]] satisfies readonly (readonly [ItemId, ItemId])[]) {
          for (let frame = 0; frame < 4; frame++) {
            step(frame === 0 || repeatSelection ? weapon : null, true);
            if (movement.state.kind === "q1-netquake") expect(movement.state.punchAngles).toEqual(native.punchAngles);
            timeline.push({ weapon: native.weapon, frame: native.weaponFrame, continuous: native.continuousFiring,
              deadline: native.attackFinished, nextFrame: native.nextWeaponFrame, ammo: simulation.inventory.count(actor, ammo) });
          }
          expect(simulation.inventory.count(actor, ammo)).toBeLessThan(40);
        }
        expect(native.weapon).toBe("lightning");
        while (source.game.time < native.attackFinished) step(null, false);
        step(null, false, 2);
        expect(native.weapon).toBe("shotgun");
        return timeline;
      } finally { simulation.close(); }
    };
    const once = exercise(false), repeated = exercise(true);
    expect(repeated).toEqual(once);
    expect(once.some(frame => frame.weapon === "nailgun" && frame.continuous && frame.frame > 1)).toBe(true);
    expect(once.some(frame => frame.weapon === "lightning" && frame.continuous && frame.frame > 1)).toBe(true);
  } finally { await content.close(); }
});

test("native Q2 weapon intents select and fire while retaining source pending semantics", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q2", "--character", "q2", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected native Q2 launch");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("q2-native-intent");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 0, mode: "deathmatch", seed: 17, maxClients: 1 });
  try {
    const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
    const source = simulation.q2Source(), movement = simulation.movementPlayer(actor);
    const native = source?.weapons.states.get(actor);
    if (source === null || movement === null || native === undefined) throw new Error("Missing native Q2 player");
    simulation.inventory.configure(movement.actor, { item: "q2:weapon_shotgun", count: 1, capacity: 1 });
    simulation.inventory.configure(movement.actor, { item: "q2:ammo_shells", count: 10, capacity: 100 });
    let sequence = 0;
    const step = (weapon: ItemId | null, attack = false) => simulation.step({ elapsedMilliseconds: 100, commands: [{
      actor, source: { kind: "remote-client", client }, sequence: sequence++,
      command: { kind: "q2-classic", milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0,
        buttons: Number(attack), impulse: 0, lightLevel: 0 },
      arsenal: { provider: movement.arsenal.provider, weapon, useHoldable: false },
    }] });
    for (let frame = 0; frame < 10; frame++) step(null);
    expect(native.weapon).toBe("blaster");
    step("q2:weapon_shotgun");
    expect(native.pending).toBe("shotgun");
    step("q2:weapon_blaster");
    expect(native.weapon).toBe("blaster");
    expect(native.pending).toBe("shotgun");
    for (let frame = 0; frame < 20; frame++) step(null, true);
    expect(native.weapon).toBe("shotgun");
    expect(native.pending).toBeNull();
    expect(simulation.inventory.count(actor, "q2:ammo_shells")).toBeLessThan(10);
  } finally { simulation.close(); await content.close(); }
});

test("selected Q1 repeated desired weapon intents preserve native continuous fire on Q2", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--movement", "q1", "--character", "q1", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected native Q1 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q1:official", content: catalog.require("q1-classic-id1").id },
  ] } } });
  const content = await loadApplicationContent(command.options, recipe);
  try {
    const exercise = (repeatSelection: boolean) => {
      const identity = createIdentityOwner(`q1-selected-intent-${repeatSelection}`);
      const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: 0, mode: "deathmatch", seed: 17, maxClients: 1 });
      try {
        const client = identity.client(0, 0), actor = simulation.admitPlayer(client).actor;
        const source = simulation.q1WeaponSource(), movement = simulation.movementPlayer(actor);
        const native = source?.game.player(actor);
        if (source === null || movement === null || native == null) throw new Error("Missing native Q1 player");
        for (const item of ["q1:weapon/nailgun", "q1:weapon/lightning"] satisfies readonly ItemId[]) simulation.inventory.give(movement.actor, item, 1);
        simulation.inventory.give(movement.actor, "q1:ammo/nails", 40);
        simulation.inventory.give(movement.actor, "q1:ammo/cells", 40);
        let sequence = 0;
        const step = (weapon: ItemId | null, attack: boolean, impulse = 0) => simulation.step({ elapsedMilliseconds: 100, commands: [{
          actor, source: { kind: "remote-client", client }, sequence: sequence++,
          command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: movement.viewAngles,
            forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse },
          arsenal: { provider: movement.arsenal.provider, weapon, useHoldable: false },
        }] });
        const timeline: { weapon: string; frame: number; continuous: boolean; deadline: number; nextFrame: number; ammo: number }[] = [];
        for (const [weapon, ammo] of [["q1:weapon/nailgun", "q1:ammo/nails"], ["q1:weapon/lightning", "q1:ammo/cells"]] satisfies readonly (readonly [ItemId, ItemId])[]) {
          for (let frame = 0; frame < 4; frame++) {
            step(frame === 0 || repeatSelection ? weapon : null, true);
            timeline.push({ weapon: native.weapon, frame: native.weaponFrame, continuous: native.continuousFiring,
              deadline: native.attackFinished, nextFrame: native.nextWeaponFrame, ammo: simulation.inventory.count(actor, ammo) });
          }
          expect(simulation.inventory.count(actor, ammo)).toBeLessThan(40);
        }
        expect(native.weapon).toBe("lightning");
        expect(simulation.q1Source()).toBeNull();
        expect(source.game.entity(actor)).toBeNull();
        return timeline;
      } finally { simulation.close(); }
    };
    const once = exercise(false), repeated = exercise(true);
    expect(repeated).toEqual(once);
    expect(once.some(frame => frame.weapon === "nailgun" && frame.continuous && frame.frame > 1)).toBe(true);
    expect(once.some(frame => frame.weapon === "lightning" && frame.continuous && frame.frame > 1)).toBe(true);
  } finally { await content.close(); }
});

test("Q3 selected supply observations preview actual authored grants and source lifecycle without mutation", async () => {
  const command = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch"]);
  if (command.kind !== "run") throw new Error("Expected Q3 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q2:official", content: catalog.require("q2-classic-baseq2").id },
  ] } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner("q3-supply-observation");
  const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts,
    skill: 0, mode: "deathmatch", seed: 17, maxClients: 1 });
  try {
    const actor = simulation.admitPlayer(identity.client(0, 0)).actor, source = simulation.q3Source();
    if (source === null) throw new Error("Missing Q3 source");
    const player = source.records.nativeByActor(actor), movement = simulation.movementPlayer(actor);
    if (player?.client == null || movement === null) throw new Error("Missing actual Q3 player");
    for (let frame = 0; frame < 5; frame++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const entities = Array.from({ length: source.pool.numEntities }, (_, index) => source.pool.at(index));
    const gun = entities.find(entity => entity.inuse && entity.classname === "weapon_shotgun");
    const ammo = entities.find(entity => entity.inuse && entity.classname === "ammo_shells");
    if (gun === undefined || ammo === undefined) throw new Error("Missing authored q3dm1 supplies");
    player.client.ps.ammo.set(3, 200);
    simulation.drainPresentationEvents();
    const inventory = simulation.inventory.entries(actor), state = player.client.ps.copy(), seed = source.random.seed;
    const sharedSeed = simulation.random.checkpoint(), itemState = { contents: gun.r.contents, flags: gun.s.eFlags, nextthink: gun.nextthink, think: gun.think, touch: gun.touch };
    const observed = source.observeSupply(gun.actor.id, actor);
    if (observed === null) throw new Error("Missing selected Q3 supply observation");
    expect(observed.observation.availability).toEqual({ kind: "ready", eligible: true });
    expect(observed.preview.weapons).toEqual([{ item: "q2:weapon_shotgun", before: 0, given: 1 }, { item: "q2:weapon_supershotgun", before: 0, given: 1 }]);
    expect(observed.preview.ammo).toEqual([{ item: "q2:ammo_shells", before: 0, given: 10 }]);
    expect(simulation.inventory.entries(actor)).toEqual(inventory); expect(player.client.ps.copy()).toEqual(state);
    expect(source.random.seed).toBe(seed); expect(simulation.random.checkpoint()).toEqual(sharedSeed);
    expect({ contents: gun.r.contents, flags: gun.s.eFlags, nextthink: gun.nextthink, think: gun.think, touch: gun.touch }).toEqual(itemState);
    expect(simulation.drainPresentationEvents()).toEqual([]);
    gun.touch?.(gun, player, { self: gun.actor, other: actor, plane: null, surface: null });
    for (const receipt of [...observed.preview.weapons, ...observed.preview.ammo]) expect(simulation.inventory.count(actor, receipt.item)).toBe(receipt.before + receipt.given);
    expect(player.client.ps.ammo.get(3)).toBe(200);
    expect(player.client.ps.externalEvent & ~EV_EVENT_BITS).toBe(EntityEvent.EV_ITEM_PICKUP);
    expect(player.client.ps.externalEventParm).toBe(gun.s.modelindex);
    expect(gun.r.contents).toBe(0);
    expect(source.observeSupply(gun.actor.id, actor)?.observation.availability).toEqual({ kind: "respawning", atSeconds: gun.nextthink / 1000 });
    const respawn = gun.think;
    gun.think = () => undefined;
    expect(source.observeSupply(gun.actor.id, actor)?.observation.availability).toEqual({ kind: "inactive" });
    gun.think = respawn;
    gun.team = "ambiguous";
    expect(source.observeSupply(gun.actor.id, actor)?.observation.availability).toEqual({ kind: "inactive" });
    gun.team = null;
    simulation.inventory.give(movement.actor, "q2:ammo_shells", 1000);
    const full = source.observeSupply(ammo.actor.id, actor);
    expect(full?.preview.accepted).toBe(false);
    const beforeFull = simulation.inventory.count(actor, "q2:ammo_shells");
    ammo.touch?.(ammo, player, { self: ammo.actor, other: actor, plane: null, surface: null });
    expect(simulation.inventory.count(actor, "q2:ammo_shells")).toBe(beforeFull);
    expect(source.observeSupply(ammo.actor.id, actor)?.observation.availability).toEqual({ kind: "ready", eligible: true });
    const touch = ammo.touch; ammo.touch = () => undefined;
    expect(source.observeSupply(ammo.actor.id, actor)).toBeNull(); ammo.touch = touch;
    simulation.inventory.consume(movement.actor, "q2:ammo_shells", beforeFull);
    player.health = 0.5;
    expect(source.observeSupply(ammo.actor.id, actor)?.observation.availability).toEqual({ kind: "ready", eligible: false });
    expect(source.observeSupply(ammo.actor.id, actor)?.preview.accepted).toBe(true);
    ammo.touch?.(ammo, player, { self: ammo.actor, other: actor, plane: null, surface: null });
    expect(simulation.inventory.count(actor, "q2:ammo_shells")).toBe(0);
    expect(ammo.r.contents).not.toBe(0);
    player.health = 100;
    const available = source.observeSupply(ammo.actor.id, actor);
    if (available === null) throw new Error("Missing restored-health ammo observation");
    expect(available.observation.availability).toEqual({ kind: "ready", eligible: true });
    expect(available.preview.accepted).toBe(true);
    expect(player.client.ps.ammo.get(3)).toBe(200);
    ammo.touch?.(ammo, player, { self: ammo.actor, other: actor, plane: null, surface: null });
    for (const receipt of available.preview.ammo) expect(simulation.inventory.count(actor, receipt.item)).toBe(receipt.before + receipt.given);
    expect(simulation.inventory.count(actor, "q2:ammo_shells")).toBeGreaterThan(0);
    expect(player.client.ps.ammo.get(3)).toBe(200);
    expect(ammo.r.contents).toBe(0);
    const removed = ammo.actor.id; source.pool.free(ammo);
    expect(source.observeSupply(removed, actor)).toBeNull();
  } finally { simulation.close(); await content.close(); }
  const nativeContent = await loadApplicationContent(command.options), nativeIdentity = createIdentityOwner("native-q3-no-supply-override");
  const native = createSimulation({ identity: nativeIdentity, recipe: nativeContent.recipe, world: nativeContent.world, mounts: nativeContent.mounts,
    skill: 0, mode: "deathmatch", seed: 17, maxClients: 1 });
  try {
    const actor = native.admitPlayer(nativeIdentity.client(0, 0)).actor, source = native.q3Source();
    if (source === null) throw new Error("Missing native Q3 source");
    for (let frame = 0; frame < 5; frame++) native.step({ elapsedMilliseconds: 100, commands: [] });
    const gun = Array.from({ length: source.pool.numEntities }, (_, index) => source.pool.at(index)).find(entity => entity.inuse && entity.classname === "weapon_shotgun");
    if (gun === undefined) throw new Error("Missing native Q3 shotgun");
    expect(source.observeSupply(gun.actor.id, actor)).toBeNull();
    const player = source.records.nativeByActor(actor);
    if (player?.client == null) throw new Error("Missing native Q3 recipient");
    gun.touch?.(gun, player, { self: gun.actor, other: actor, plane: null, surface: null });
    expect(player.client.ps.ammo.get(3)).toBe(10);
    expect(gun.r.contents).toBe(0);
  } finally { native.close(); await nativeContent.close(); }
}, 60000);

const armorEditions: readonly Q2Edition[] = ["classic", "rerelease"];
for (const edition of armorEditions) test(`Q3 application bridge resolves ${edition} Q2 armor on an explicitly synthetic source actor`, async () => {
  const command = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--movement", "q3", "--character", "q3", "--mode", "deathmatch", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected Q3 launch");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: "selected", value: [
    { provider: "q2:official", content: catalog.require(`q2-${edition}-baseq2`).id },
  ] } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`q3-q2-armor-${edition}`);
  const simulation = createSimulation({ identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: "deathmatch", seed: 17, maxClients: 1 });
  try {
    const player = simulation.admitPlayer(identity.client(0, 0)).actor, source = simulation.q2WeaponSource();
    if (source === null) throw new Error("Missing selected Q2 source");
    expect(source.game.options.edition).toBe(edition);
    const victim = source.game.create("armor_probe");
    simulation.combat.create(victim.actor, { health: 100, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
    for (const family of ["q1", "q3"]) for (const front of [true, false]) for (const amount of [1, 9]) {
      simulation.combat.setHealth(victim.actor, 100);
      simulation.combat.setArmor(victim.actor, { kind: "q2", item: "q2:item_armor_jacket", points: 0, normalProtection: 0, energyProtection: 0, powerArmor: { kind: "screen", cells: 100 } });
      const outcome = simulation.combat.apply({ target: victim.actor.id, amount, knockback: 0, delivery: "direct",
        direction: { x: front ? -1 : 1, y: 0, z: 0 }, point: { x: family === "q1" ? 0 : front ? 16 : -16, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 },
        attack: { sequence: 1, time: { kind: "milliseconds", value: 0 }, attacker: player, inflictor: player, weapon: null,
          weaponProvider: family === "q1" ? "q1:official" : "q3:official", combatProvider: recipe.combat.provider, inventoryProvider: recipe.inventory.provider,
          movementProvider: recipe.movement.provider, cause: family === "q1" ? { kind: "q1", deathType: "" } : { kind: "q3", meansOfDeath: 1, damageFlags: 0 } } });
      expect(outcome.kind).toBe("committed");
      const saved = front ? edition === "rerelease" ? Math.max(1, Math.trunc(amount / 3)) : Math.trunc(amount / 3) : 0;
      expect(simulation.combat.read(victim.actor.id)?.health).toBe(100 - amount + saved);
      expect(simulation.combat.read(victim.actor.id)?.armor).toEqual({ kind: "q2", item: "q2:item_armor_jacket", points: 0, normalProtection: 0, energyProtection: 0, powerArmor: { kind: "screen", cells: 100 - saved } });
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);

for (const mapEdition of armorEditions) test(`base1 ${mapEdition} map runs the other Q2 edition arsenal with native supplies and fresh save continuation`, async () => {
  const weaponEdition: Q2Edition = mapEdition === 'classic' ? 'rerelease' : 'classic';
  const command = parseApplicationCommand(['--game', `q2-${mapEdition}-baseq2`, '--map', 'base1', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'singleplayer']);
  if (command.kind !== 'run') throw new Error('Expected Q2 launch');
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: 'selected', value: [
    { provider: 'q2:official', content: catalog.require(`q2-${weaponEdition}-baseq2`).id },
  ] } } });
  const reference = recipe.weapons[0]; if (reference === undefined) throw new Error('Missing selected source');
  expect(reference.provider).toBe(`q2:weapons/${weaponEdition}/baseq2`);
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`same-family-${mapEdition}`), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: 'singleplayer', seed: 17, maxClients: 1, playerIdentity: value => ({ seat: value.slot, socialId: '' }) };
  const simulation = createSimulation(options);
  const step = (world: ReturnType<typeof createSimulation>, actor: ActorId, owner: ClientId, sequence: number, attack: boolean, turns = mapEdition === 'rerelease' ? 4 : 1) => {
    for (let turn = 0; turn < turns; turn++) world.step({ elapsedMilliseconds: mapEdition === 'rerelease' ? 25 : 100, commands: [{
    actor, source: { kind: 'remote-client', client: owner }, sequence: sequence * 4 + turn,
    command: world.movementPlayer(actor)?.profile.kind === 'q2-classic' ? { kind: 'q2-classic', milliseconds: mapEdition === 'rerelease' ? 25 : 100, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse: 0, lightLevel: 0 }
      : { kind: 'q2-rerelease', milliseconds: mapEdition === 'rerelease' ? 25 : 100, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, buttons: Number(attack), serverFrame: sequence * 4 + turn },
    arsenal: { provider: reference.provider, weapon: null, useHoldable: false },
  }] });
  };
  try {
    const actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor), map = simulation.q2Source(), selected = simulation.q2WeaponSource();
    if (player === null || map === null || selected === null) throw new Error('Missing actual Q2 player or source');
    expect(selected.game).not.toBe(map.game); expect(selected.game.options.edition).toBe(weaponEdition); expect(map.game.options.edition).toBe(mapEdition);
    expect(map.weapons.states.has(actor)).toBe(false); expect(selected.weapons.states.has(actor)).toBe(true);
    expect(simulation.playerUi(actor).activeWeapon).toBe('q2:weapon_blaster');
    step(simulation, actor, client, 0, false);
    const clock = new SaveReader(decodeCheckpointValue(simulationProviderCheckpoint(simulation.checkpoint(), 'world:simulation').bytes)).field('selectedWeaponSource').field('frame');
    expect(clock.field('frame').integer()).toBe(weaponEdition === 'rerelease' ? 4 : 1);
    expect(selected.game.host.frameSeconds()).toBe(weaponEdition === 'rerelease' ? 0.025 : 0.1);
    for (let frame = 1; frame < 4; frame++) step(simulation, actor, client, frame, false);
    const shotgun = [...map.game.entities.values()].find(entity => entity.classname === 'weapon_shotgun');
    if (shotgun?.touch == null) throw new Error('Missing authored base1 shotgun');
    const shells = simulation.inventory.count(actor, 'q2:ammo_shells');
    shotgun.touch(shotgun, map.game, { self: shotgun.actor, other: actor, plane: null, surface: null });
    expect(simulation.inventory.count(actor, 'q2:ammo_shells')).toBe(shells + 10);
    expect(simulation.inventory.count(actor, 'q2:weapon_shotgun')).toBe(1);
    for (let frame = 4; frame < 20; frame++) step(simulation, actor, client, frame, false);
    expect(simulation.playerUi(actor).activeWeapon).toBe('q2:weapon_shotgun');
    simulation.inventory.give(player.actor, 'q2:item_silencer', 1);
    expect(map.items.use(player.actor, 'q2:item_silencer', map.game)).toBe(true);
    expect(selected.weapons.silencerShots(actor)).toBe(30); expect(map.weapons.silencerShots(actor)).toBe(0);
    const nativePlayer = map.game.entity(actor);
    if (nativePlayer === null) throw new Error('Missing native map player');
    let observedKick = false;
    for (let frame = 20; frame < 30; frame++) {
      step(simulation, actor, client, frame, true);
      const weapon = map.players.context(nativePlayer, map.game).weaponState(), actual = selected.weapons.states.get(actor);
      expect(weapon?.kickAngles).toEqual(actual?.kickAngles);
      expect(weapon?.kickOrigin).toEqual(actual?.kickOrigin);
      if (weapon !== null && Math.hypot(weapon.kickAngles.x, weapon.kickAngles.y, weapon.kickAngles.z) > 0) observedKick = true;
    }
    expect(observedKick).toBe(true);
    expect(simulation.inventory.count(actor, 'q2:ammo_shells')).toBeLessThan(shells + 10);
    expect(selected.weapons.silencerShots(actor)).toBeLessThan(30);
    selected.weapons.resetSilencer(actor);
    for (let frame = 30; frame < 40; frame++) step(simulation, actor, client, frame, true);
    expect(map.monsters.capture().perception.noises.some(noise => noise.actor.slot === actor.slot)).toBe(true);
    let grenades = [...map.game.entities.values()].find(entity => entity.classname === 'ammo_grenades');
    if (grenades === undefined) {
      // If this map edition lacks authored grenades, exercise an explicitly synthetic native item spawn.
      grenades = map.game.create('ammo_grenades'); expect(map.items.spawn(grenades, map.game)).toBe(true);
    }
    const grenadesBefore = simulation.inventory.count(actor, 'q2:ammo_grenades');
    map.items.touch(grenades, map.game, actor);
    expect(simulation.inventory.count(actor, 'q2:ammo_grenades')).toBe(grenadesBefore + 5);
    expect(simulation.inventory.entries(actor).find(entry => entry.item === 'q2:ammo_grenades')?.capacity).toBe(50);
    expect(simulation.playerUi(actor).items.find(item => item.id === 'q2:ammo_grenades')?.owned).toBe(true);
    simulation.inventory.give(player.actor, 'q2:item_silencer', 1);
    expect(map.items.use(player.actor, 'q2:item_silencer', map.game)).toBe(true);
    simulation.inventory.give(player.actor, 'q2:weapon_hyperblaster', 1); simulation.inventory.give(player.actor, 'q2:ammo_cells', 20);
    expect(simulation.requestWeapon(actor, { provider: reference.provider, item: 'q2:weapon_hyperblaster' })).toBe(true);
    for (let frame = 40; frame < 55; frame++) step(simulation, actor, client, frame, false);
    let sourceActor = [...selected.game.entities.values()].find(entity => entity.classname === 'bolt');
    for (let frame = 55; frame < 63 && sourceActor === undefined; frame++) {
      step(simulation, actor, client, frame, true, 1);
      sourceActor = [...selected.game.entities.values()].find(entity => entity.classname === 'bolt');
    }
    if (sourceActor === undefined) throw new Error('Actual selected hyperblaster has no live source projectile');
    expect(map.players.context(nativePlayer, map.game).weaponState()?.loopSound).toBe(selected.weapons.states.get(actor)?.loopSound);
    expect(map.players.context(nativePlayer, map.game).weaponState()?.loopSound).not.toBe('');
    expect(simulation.actors.sourceOf(sourceActor.actor.id)?.provider).toBe(reference.provider);
    const save = decodeSaveImage(encodeSaveImage(simulation.checkpoint())), restoredIdentity = createIdentityOwner(`restored-same-family-${mapEdition}`), restoredClient = restoredIdentity.client(0, 0);
    const restored = createSimulation({ ...options, identity: restoredIdentity, restoredClients: [restoredClient], restore: save });
    try {
      const restoredActor = restored.players()[0], restoredSource = restored.q2WeaponSource();
      if (restoredActor === undefined || restoredSource === null) throw new Error('Missing restored selected source');
      expect(restoredSource.game.options.provider).toBe(reference.provider);
      expect(restoredSource.weapons.silencerShots(restoredActor)).toBe(selected.weapons.silencerShots(actor));
      expect(restoredSource.weapons.silencerShots(restoredActor)).toBeGreaterThan(0);
      const restoredProjectile = restored.actors.resolveSaved(sourceActor.actor.id);
      if (restoredProjectile === null) throw new Error('Missing restored actual hyperblaster projectile');
      expect(restored.actors.sourceOf(restoredProjectile.id)).toEqual(simulation.actors.sourceOf(sourceActor.actor.id));
      expect(restored.bodies.read(restoredProjectile.id)?.origin).toEqual(simulation.bodies.read(sourceActor.actor.id)?.origin);
      expect(restored.bodies.read(restoredProjectile.id)?.velocity).toEqual(simulation.bodies.read(sourceActor.actor.id)?.velocity);
      expect(restored.actors.sourceOf(restored.actors.referenceSaved({ slot: sourceActor.actor.id.slot, generation: sourceActor.actor.id.generation }))?.provider).toBe(reference.provider);
      for (let frame = 64; frame < 68; frame++) { step(simulation, actor, client, frame, true); step(restored, restoredActor, restoredClient, frame, true); }
      expect(restored.playerUi(restoredActor)).toEqual(simulation.playerUi(actor));
      expect(restoredSource.weapons.capture(restoredSource.game).states.map(state => state.state)).toEqual(selected.weapons.capture(selected.game).states.map(state => state.state));
      expect(restoredSource.game.host.now()).toBe(selected.game.host.now());
      const projectiles = (world: ReturnType<typeof createSimulation>, source: NonNullable<typeof selected>) => [...source.game.entities.values()].map(entity => ({
        address: world.actors.sourceOf(entity.actor.id), classname: entity.classname, origin: world.bodies.read(entity.actor.id)?.origin, velocity: world.bodies.read(entity.actor.id)?.velocity,
      }));
      expect(projectiles(restored, restoredSource)).toEqual(projectiles(simulation, selected));
    } finally { restored.close(); }
  } finally { simulation.close(); await content.close(); }
}, 30000);

for (const mapEdition of armorEditions) test(`e1m1 ${mapEdition} map runs the other Q1 edition arsenal with map inventory and travel`, async () => {
  const weaponEdition = mapEdition === 'classic' ? 'rerelease' : 'classic';
  const command = parseApplicationCommand(['--game', `q1-${mapEdition}-id1`, '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--dedicated', '--mode', 'coop']);
  if (command.kind !== 'run') throw new Error('Expected Q1 launch');
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: 'selected', value: [
    { provider: 'q1:official', content: catalog.require(`q1-${weaponEdition}-id1`).id },
  ] } } });
  const reference = recipe.weapons[0]; if (reference === undefined) throw new Error('Missing selected Q1 source');
  expect(reference.provider).toBe(`q1:weapons/${weaponEdition}/id1`);
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`q1-same-family-${mapEdition}`), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe, world: content.world, mounts: content.mounts, skill: 1, mode: 'coop', seed: 17, maxClients: 1, playerIdentity: value => ({ seat: value.slot, socialId: '' }) };
  const simulation = createSimulation(options);
  const step = (world: ReturnType<typeof createSimulation>, actor: ActorId, owner: ClientId, sequence: number, attack = false, impulse = 0) => world.step({ elapsedMilliseconds: 100, commands: [{
    actor, source: { kind: 'remote-client', client: owner }, sequence,
    command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: world.timeSeconds, viewAngles: { x: -25, y: 90, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse },
  }] });
  try {
    const actor = simulation.admitPlayer(client).actor, map = simulation.q1Source(), player = simulation.movementPlayer(actor);
    const selected = map?.composition.services.weaponServices?.(actor), native = map?.game.player(actor), weapon = selected?.player(actor);
    if (map === null || player === null || selected == null || native == null || weapon == null) throw new Error('Missing selected or native Q1 continuation');
    expect(selected).not.toBe(map.game); expect(selected.options.edition).toBe(weaponEdition); expect(map.game.options.edition).toBe(mapEdition);
    expect(simulation.inventory.count(actor, 'q1:ammo/shells')).toBe(25);
    for (let frame = 0; frame < 4; frame++) step(simulation, actor, client, frame);
    const shells = [...map.game.entities.values()].find(entity => entity.classname === 'item_shells');
    if (shells?.touch == null) throw new Error('Missing authored e1m1 shells');
    shells.touch(actor, null); expect(simulation.inventory.count(actor, 'q1:ammo/shells')).toBe(45);
    step(simulation, actor, client, 4, true); expect(simulation.inventory.count(actor, 'q1:ammo/shells')).toBe(44);
    expect(weapon.attackFinished).toBeGreaterThan(0); expect(native.attackFinished).toBe(0);
    expect(weapon.punchAngles.x).toBe(-2);
    for (let frame = 5; frame < 12; frame++) step(simulation, actor, client, frame);
    const nailgun = [...map.game.entities.values()].find(entity => entity.classname === 'weapon_nailgun');
    if (nailgun?.touch == null) throw new Error('Missing authored e1m1 nailgun');
    nailgun.touch(actor, null); expect(weapon.weapon).toBe('nailgun');
    expect(simulation.inventory.count(actor, 'q1:weapon/nailgun')).toBe(1);
    simulation.inventory.give(player.actor, 'q1:weapon/lightning', 1); simulation.inventory.give(player.actor, 'q1:ammo/cells', 12);
    step(simulation, actor, client, 12, false, 8); expect(weapon.weapon).toBe('lightning'); expect(native.weapon).toBe('shotgun');
    map.game.givePowerup(native, 'quad'); map.game.givePowerup(native, 'invulnerability');
    const quadUntil = native.powerups.get('quad'), protectionUntil = native.powerups.get('invulnerability');
    if (quadUntil === undefined || protectionUntil === undefined) throw new Error('Missing map powerup deadlines');
    expect(selected.powerupExpires(actor, 'quad')).toBe(quadUntil);
    expect(selected.powerupExpires(actor, 'invulnerability')).toBe(protectionUntil);
    // Explicit synthetic victim compares shared selected-source damage with the map-native quad policy.
    const victim = map.game.create('arsenal_quad_probe');
    simulation.combat.setHealth(victim.actor, 100); simulation.combat.setTraits(victim.actor, { canTakeDamage: true });
    selected.damage(victim.actor.id, actor, actor, 1, 'shotgun'); expect(simulation.combat.read(victim.actor.id)?.health).toBe(96);
    simulation.combat.setHealth(victim.actor, 100); map.game.damage(victim.actor.id, actor, actor, 1, 'shotgun'); expect(simulation.combat.read(victim.actor.id)?.health).toBe(96);
    map.game.remove(victim);
    step(simulation, actor, client, 13, true); expect(simulation.inventory.count(actor, 'q1:ammo/cells')).toBe(11);
    expect(weapon.lightningSoundAt).toBeGreaterThan(selected.time); expect(native.lightningSoundAt).toBe(0);
    for (let frame = 14; frame < 18; frame++) step(simulation, actor, client, frame);
    step(simulation, actor, client, 18, false, 10); expect(weapon.weapon).toBe('axe');
    step(simulation, actor, client, 19, false, 12); expect(weapon.weapon).toBe('lightning');
    const backpack = map.composition.dropInventory(player.actor);
    if (backpack === null) throw new Error('Missing coop backpack');
    expect(q1Creatures(map.game).backpacks.get(backpack.actor)?.weapon).toBe('lightning');
    const travel = simulation.captureTravel(), carry = travel.players[0]?.state;
    if (carry?.kind !== 'q1') throw new Error('Missing Q1 map carry');
    expect(carry.carry.weapon).toBe('lightning'); expect(carry.carry.inventory.find(entry => entry.item === 'q1:ammo/cells')?.count).toBe(11);
    simulation.inventory.give(player.actor, 'q1:weapon/nailgun', 1); simulation.inventory.give(player.actor, 'q1:ammo/nails', 20);
    step(simulation, actor, client, 20, false, 4); step(simulation, actor, client, 21, true);
    const projectile = [...selected.entities.values()].find(entity => entity.classname === 'spike');
    if (projectile === undefined) throw new Error('Missing actual selected Q1 nail');
    expect(simulation.actors.sourceOf(projectile.actor.id)?.provider).toBe(reference.provider);
    const restoredIdentity = createIdentityOwner(`q1-same-family-restore-${mapEdition}`), restoredClient = restoredIdentity.client(0, 0);
    const restored = createSimulation({ ...options, identity: restoredIdentity, restoredClients: [restoredClient], restore: decodeSaveImage(encodeSaveImage(simulation.checkpoint())) });
    try {
      const restoredActor = restored.players()[0]; if (restoredActor === undefined) throw new Error('Missing restored Q1 player');
      const restoredSource = restored.q1Source()?.composition.services.weaponServices?.(restoredActor);
      expect(restoredSource?.provider).toBe(reference.provider);
      expect(restoredSource?.player(restoredActor)?.lightningSoundAt).toBe(weapon.lightningSoundAt);
      const restoredProjectile = restored.actors.resolveSaved(projectile.actor.id);
      if (restoredProjectile === null) throw new Error('Missing saved selected nail');
      expect(restored.actors.sourceOf(restoredProjectile.id)).toEqual(simulation.actors.sourceOf(projectile.actor.id));
      expect(restored.bodies.read(restoredProjectile.id)?.origin).toEqual(simulation.bodies.read(projectile.actor.id)?.origin);
      for (let frame = 22; frame < 26; frame++) { step(simulation, actor, client, frame, true); step(restored, restoredActor, restoredClient, frame, true); }
      expect(restored.playerUi(restoredActor)).toEqual(simulation.playerUi(actor));
      expect(restoredSource?.player(restoredActor)?.attackFinished).toBe(weapon.attackFinished);
      expect(restoredSource?.time).toBe(selected.time);
    } finally { restored.close(); }
    const travelIdentity = createIdentityOwner(`q1-same-family-travel-${mapEdition}`), traveled = createSimulation({ ...options, identity: travelIdentity, travel });
    try {
      const arrival = traveled.admitTravel(travelIdentity.client(0, 0), travel).actor;
      expect(traveled.playerUi(arrival).activeWeapon).toBe('q1:weapon/lightning');
      expect(traveled.inventory.count(arrival, 'q1:ammo/cells')).toBe(11);
      expect(traveled.inventory.count(arrival, 'q1:ammo/shells')).toBe(44);
      expect(traveled.q1Source()?.composition.services.weaponServices?.(arrival)?.powerupExpires(arrival, 'quad')).toBe(0);
    } finally { traveled.close(); }
    const restartTravel = { ...travel, players: travel.players.map(record => ({ ...record, state: { kind: 'q1', carry: map.composition.newTravel() } satisfies typeof record.state })) };
    const restartIdentity = createIdentityOwner(`q1-same-family-reset-${mapEdition}`), restarted = createSimulation({ ...options, identity: restartIdentity, travel: restartTravel });
    try {
      const arrival = restarted.admitTravel(restartIdentity.client(0, 0), restartTravel).actor;
      expect(restarted.playerUi(arrival).activeWeapon).toBe('q1:weapon/shotgun');
      expect(restarted.inventory.count(arrival, 'q1:ammo/shells')).toBe(25);
      expect(restarted.inventory.count(arrival, 'q1:ammo/cells')).toBe(0);
    } finally { restarted.close(); }
    const spawn = map.composition.selectSpawn(actor);
    if (spawn === null) throw new Error('Missing actual Q1 respawn point');
    map.composition.services.placePlayer(player.actor, spawn, carry.carry);
    expect(simulation.playerUi(actor).activeWeapon).toBe('q1:weapon/lightning');
    expect(simulation.inventory.count(actor, 'q1:ammo/cells')).toBe(11);
    expect(simulation.inventory.count(actor, 'q1:ammo/shells')).toBe(44);
  } finally { simulation.close(); await content.close(); }
}, 30000);

for (const family of ['q1', 'q2', 'q3', 'q3-world']) test(`Q1 source recoil survives ${family} movement and character with one saved camera kick`, async () => {
  const selectedFamily = family === 'q3-world' ? 'q3' : family;
  const command = parseApplicationCommand(['--game', family === 'q3-world' ? 'q3-baseq3' : 'q1-classic-id1', '--map', family === 'q3-world' ? 'q3dm1' : 'e1m1', '--movement', selectedFamily, '--character', selectedFamily, '--dedicated']);
  if (command.kind !== 'run') throw new Error('Expected Q1 recoil launch');
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), weapons: { kind: 'selected', value: [{ provider: 'q1:official', content: catalog.require('q1-rerelease-id1').id }] } } });
  const content = await loadApplicationContent(command.options, recipe), identity = createIdentityOwner(`recoil-${family}`), client = identity.client(0, 0);
  const options: Parameters<typeof createSimulation>[0] = { identity, recipe, world: content.world, mounts: content.mounts, skill: 0, mode: 'singleplayer', seed: 17, maxClients: 1, playerIdentity: value => ({ seat: value.slot, socialId: '' }) };
  const simulation = createSimulation(options);
  const step = (world: ReturnType<typeof createSimulation>, actor: ActorId, owner: ClientId, sequence: number, attack = false, copies = 1) => {
    const profile = world.movementPlayer(actor)?.profile.kind;
    world.step({ elapsedMilliseconds: 100, commands: Array.from({ length: copies }, (_, copy): Parameters<typeof world.step>[0]['commands'][number] => ({ actor, source: { kind: 'remote-client', client: owner }, sequence: sequence * 2 + copy,
      command: profile === 'q1-netquake' ? { kind: 'q1-netquake', acknowledgedServerTimeSeconds: world.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse: 0 }
        : profile === 'q2-classic' ? { kind: 'q2-classic', milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 0, sideMove: 0, upMove: 0, buttons: Number(attack), impulse: 0, lightLevel: 0 }
        : { kind: 'q3', serverTimeMilliseconds: (sequence + 1) * 100, angleWords: [0, 0, 0], forwardMove: 0, rightMove: 0, upMove: 0, buttons: Number(attack), weapon: 0 },
    })) });
  };
  try {
    const actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor), source = simulation.q1WeaponSource();
    const weapon = source?.game.player(actor);
    if (player === null || source === null || weapon == null) throw new Error('Missing source recoil owner');
    for (let frame = 0; frame < 4; frame++) step(simulation, actor, client, frame);
    simulation.inventory.give(player.actor, 'q1:weapon/supershotgun', 1);
    expect(simulation.requestWeapon(actor, { provider: source.game.provider, item: 'q1:weapon/supershotgun' })).toBe(true);
    step(simulation, actor, client, 4, true);
    expect(weapon.punchAngles).toEqual({ x: -4, y: 0, z: 0 });
    expect(simulation.playerView(actor).kickAngles?.x).toBe(-4);
    expect(player.viewAngles.x).toBe(0); expect(player.commandAngles.x).toBe(0);
    const gun = simulation.presentations().find(model => model.viewWeapon && model.actor.equals(actor));
    expect(gun?.angles.x).toBe(0);
    if (player.state.kind === 'q1-netquake') expect(player.state.punchAngles).toEqual(weapon.punchAngles);
    if (player.animation.state.kind === 'q1') expect(player.animation.state.frame).toBe(113);
    if (family === 'q3-world') {
      // Native Q3 saved games are separately unavailable; all three movement saves are covered on e1m1 above.
      for (let frame = 5; frame < 9; frame++) { step(simulation, actor, client, frame); expect(weapon.punchAngles.x).toBe(-4 + (frame - 4) * source.game.frameSeconds * 10); }
      return;
    }
    const restoredIdentity = createIdentityOwner(`recoil-restored-${family}`), restoredClient = restoredIdentity.client(0, 0);
    const restored = createSimulation({ ...options, identity: restoredIdentity, restoredClients: [restoredClient], restore: decodeSaveImage(encodeSaveImage(simulation.checkpoint())) });
    try {
      const restoredActor = restored.players()[0]; if (restoredActor === undefined) throw new Error('Missing restored recoil owner');
      expect(restored.playerView(restoredActor).kickAngles).toEqual(simulation.playerView(actor).kickAngles);
      for (let frame = 5; frame < 9; frame++) {
        if (frame === 6) { simulation.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] }); }
        else { step(simulation, actor, client, frame, false, frame === 5 ? 2 : 1); step(restored, restoredActor, restoredClient, frame, false, frame === 5 ? 2 : 1); }
        expect(weapon.punchAngles.x).toBe(frame === 8 ? -0 : frame - 8);
        expect(restored.q1WeaponSource()?.game.player(restoredActor)?.punchAngles).toEqual(weapon.punchAngles);
        expect(restored.playerView(restoredActor).kickAngles).toEqual(simulation.playerView(actor).kickAngles);
        expect(player.viewAngles.x).toBe(0); expect(player.commandAngles.x).toBe(0);
      }
    } finally { restored.close(); }
    if (family === 'q1') {
      for (let frame = 9; frame < 13; frame++) step(simulation, actor, client, frame);
      expect(simulation.requestWeapon(actor, { provider: source.game.provider, item: 'q1:weapon/axe' })).toBe(true);
      const random = source.game.host.random; let draws = 0;
      source.game.host.random = () => { draws++; return random(); };
      try { expect(source.game.weaponInput(player.actor, true, player.viewAngles, source.game.time, player.waterLevel)).toBe(true); }
      finally { source.game.host.random = random; }
      expect(draws).toBe(1);
    }
  } finally { simulation.close(); await content.close(); }
}, 30000);


test("common camera kick preserves zero basis and raises a pitched yawed view without changing aim", () => {
  const aim = { x: 20, y: 35, z: 0 };
  const camera: Parameters<typeof cameraWithKick>[0] = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis(aim), viewport: { x: 0, y: 0, width: 640, height: 400 }, projection: perspectiveProjection(90, 64, 16384), clip: { kind: 'none' } };
  expect(cameraWithKick(camera, { x: 0, y: 0, z: 0 })).toBe(camera);
  const kicked = cameraWithKick(camera, { x: -4, y: 0, z: 0 }), expected = anglesToAxis({ ...aim, x: 16 });
  for (const axis of [0, 1, 2]) {
    const actual = kicked.axis[axis], target = expected[axis]; if (actual === undefined || target === undefined) throw new Error('Missing camera basis');
    expect(actual.x).toBeCloseTo(target.x, 6); expect(actual.y).toBeCloseTo(target.y, 6); expect(actual.z).toBeCloseTo(target.z, 6);
  }
  expect(camera.axis).toEqual(anglesToAxis(aim));
});

test("authored Q1 platform pauses local time when blocked and restores its source deadline", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q2", "--character", "q2"]);
  if (command.kind !== "run") throw new Error("Expected native Q1 map");
  const content = await loadApplicationContent(command.options), identity = createIdentityOwner("native-pusher-time");
  const options = { recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 0, mode: "singleplayer", seed: 17, maxClients: 1 } satisfies Omit<Parameters<typeof createSimulation>[0], "identity">;
  const simulation = createSimulation({ ...options, identity });
  try {
    const actor = simulation.admitPlayer(identity.client(0, 0)).actor, source = simulation.q1Source();
    if (source === null) throw new Error("Missing native Q1 source");
    for (let i = 0; i < 4; i++) simulation.step({ elapsedMilliseconds: 100, commands: [] });
    const platform = [...source.game.entities.values()].find(entity => entity.model === "*22");
    if (platform === undefined) throw new Error("Missing authored platform");
    const trigger = [...source.game.entities.values()].find(entity => entity.owner?.equals(platform.actor.id) && entity.touch !== null);
    if (trigger === undefined) throw new Error("Missing authored e1m1 platform and trigger");
    const initial = source.game.body(platform).origin;
    // A synthetic tall rider deliberately intersects the authored ceiling; the brush stays authored.
    const blocker = source.game.create("info_notnull"); blocker.movement = "step"; blocker.solid = "bbox"; blocker.movementFlags = 512;
    source.game.setBody(blocker, { origin: { x: 792, y: 512, z: -296 }, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 400 } }, ground: platform.actor.id });
    source.game.link(blocker);
    simulation.callbacks.touch({ self: trigger.actor, other: actor, plane: null, surface: null });
    expect(platform.state).toBe("up");
    simulation.step({ elapsedMilliseconds: 100, commands: [] });
    expect(source.game.body(platform).origin).toEqual(initial);
    expect(platform.number("ltime")).toBe(Math.fround(Math.fround(0.1) - 0.1));
    expect(platform.state).toBe("down");
    expect(platform.nextThink).toBe(Math.fround(0.1));
    const saved = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
    const restoredIdentity = createIdentityOwner("native-pusher-time-restored"), client = restoredIdentity.client(0, 0);
    const restored = createSimulation({ ...options, identity: restoredIdentity, restoredClients: [client], restore: saved });
    try {
      const other = restored.q1Source(), restoredActor = restored.players()[0];
      if (other === null || restoredActor === undefined) throw new Error("Missing restored native source/player");
      const samePlatform = other.game.entity(restored.actors.referenceSaved(platform.actor.id));
      const sameBlocker = other.game.entity(restored.actors.referenceSaved(blocker.actor.id));
      const sameTrigger = other.game.entity(restored.actors.referenceSaved(trigger.actor.id));
      if (samePlatform === null || sameBlocker === null || sameTrigger === null) throw new Error("Missing saved pusher actors");
      expect(samePlatform.number("ltime")).toBe(platform.number("ltime")); expect(samePlatform.nextThink).toBe(platform.nextThink);
      expect(other.game.capture().version).toBe(5);
      source.game.remove(blocker); other.game.remove(sameBlocker);
      simulation.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
      expect(platform.state).toBe("bottom"); expect(samePlatform.state).toBe("bottom");
      simulation.callbacks.touch({ self: trigger.actor, other: actor, plane: null, surface: null });
      restored.callbacks.touch({ self: sameTrigger.actor, other: restoredActor, plane: null, surface: null });
      let reachedTop = false;
      for (let i = 0; i < 55; i++) {
        simulation.step({ elapsedMilliseconds: 100, commands: [] }); restored.step({ elapsedMilliseconds: 100, commands: [] });
        expect(other.game.body(samePlatform)).toEqual(source.game.body(platform));
        expect(samePlatform.number("ltime")).toBe(platform.number("ltime")); expect(samePlatform.nextThink).toBe(platform.nextThink);
        expect(samePlatform.state).toBe(platform.state);
        reachedTop ||= platform.state === "top";
      }
      expect(reachedTop).toBe(true); expect(platform.number("ltime")).toBeLessThan(source.game.time);
      expect(simulation.playerUi(actor)).toEqual(restored.playerUi(restoredActor));
    } finally { restored.close(); }
  } finally { simulation.close(); await content.close(); }
});


test("dedicated actual id1 QuakeC application traverses authored pushers and live source slots", async () => {
  const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--dedicated"]);
  if (command.kind !== "run") throw new Error("Expected dedicated launch");
  const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false });
  const preset = applicationPreset(catalog, command.options);
  const recipe = await resolveLaunch({ catalog, preset: { ...preset, execution: [{ kind: "quakec", owner: preset.map.entities,
    role: "server-game", artifact: { content: preset.map.entities.content, path: "progs.dat" },
    api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }] }, choice: presetChoice(preset.id) });
  const application = await Application.open(command.options, { print: () => undefined }, recipe);
  try {
    const simulation = application.simulation, source = simulation.quakecSource();
    if (source === null) throw new Error("Actual QC source missing");
    const field = (name: string): number => {
      const definition = source.prepared.program.fieldsByName.get(name);
      if (definition === undefined) throw new Error(`Missing source field ${name}`);
      return definition.offset;
    };
    const initial = simulation.actors.observations(), pushers = initial.filter(actor => source.readMoveType(actor.id) === 7);
    expect(simulation.q1Source()).toBeNull();
    expect(simulation.players()).toEqual([]);
    expect(source.prepared.resources.size).toBe(358);
    expect(pushers.length).toBe(30);
    expect(source.options.random).toBe(simulation.random);
    expect(source.options.physics).toBe(simulation.physics);
    expect(source.options.actors).toBe(simulation.actors);
    expect(() => simulation.checkpoint()).toThrow("complete saved-game checkpoint");
    expect(() => simulation.admitPlayer(simulation.options.identity.client(0, 0))).toThrow("QuakeC");
    const visits: number[] = [], beforeActor = source.beforeActor.bind(source);
    source.beforeActor = actor => {
      const slot = source.sourceSlot(actor.id);
      if (slot === null) throw new Error("Missing live source slot");
      if (visits.length === 0) expect(source.machine.globals.float(source.machine.globalOffset("time"))).toBe(Math.fround(source.timeSeconds));
      visits.push(slot); return beforeActor(actor);
    };
    for (const milliseconds of [100, 100, 50]) {
      visits.length = 0;
      const beginning = simulation.timeSeconds, elapsed = milliseconds / 1000;
      const localTimes = new Map(pushers.map((pusher): [ActorId, number] => {
        const slot = source.sourceSlot(pusher.id);
        if (slot === null) throw new Error("Missing authored pusher");
        const words = source.entities.at(slot), local = words.float(field("ltime")), next = words.float(field("nextthink"));
        return [pusher.id, Math.fround(local + Math.max(0, Math.min(elapsed, next - local)))];
      }));
      await application.step(milliseconds);
      expect(source.machine.globals.float(source.machine.globalOffset("frametime"))).toBe(Math.fround(elapsed));
      expect(source.timeSeconds).toBe(beginning);
      expect(source.machine.globals.float(source.machine.globalOffset("time"))).toBeGreaterThanOrEqual(Math.fround(beginning));
      expect(source.machine.globals.float(source.machine.globalOffset("time"))).toBeLessThanOrEqual(Math.fround(beginning + elapsed));
      expect(simulation.timeSeconds).toBeCloseTo(beginning + elapsed, 12);
      expect(visits).toEqual([...visits].sort((a, b) => a - b));
      expect(new Set(visits).size).toBe(visits.length);
      for (const pusher of pushers) {
        const slot = source.sourceSlot(pusher.id);
        if (slot === null) throw new Error("Authored pusher unexpectedly freed");
        expect(visits).toContain(slot);
        const expectedLocalTime = localTimes.get(pusher.id);
        if (expectedLocalTime === undefined) throw new Error("Missing authored pusher deadline expectation");
        expect(source.entities.at(slot).float(field("ltime"))).toBe(expectedLocalTime);
        expect(simulation.bodies.read(pusher.id)?.origin).toEqual(source.entities.at(slot).vector(field("origin")));
      }
    }
    expect(simulation.actors.observations().length).toBeGreaterThan(initial.length);
    expect(() => source.machine.execute(source.prepared.program.functionNamed("door_blocked").index)).toThrow("Unsupported QuakeC damage provenance");
    const door = pushers.find(actor => source.classname(actor.id) === "door"), victim = simulation.actors.observations().find(actor => source.classname(actor.id) === "monster_army");
    if (door === undefined || victim === undefined) throw new Error("Authored crusher callback actors missing");
    const owner = simulation.actors.resolveOwned(door.id), before = simulation.combat.read(victim.id)?.health;
    if (owner === null || before === undefined) throw new Error("Missing shared source damage state");
    // Explicit callback invocation tests provenance; it does not claim a physical collision.
    source.pusherServices.blocked(owner, victim.id);
    expect(simulation.combat.read(victim.id)?.health).toBeLessThan(before);
    expect(source.currentPhysicsCallback).toBeNull();
  } finally { await application.close(); }
}, 45000);


test("dedicated actual id1 QC client reuses its raw actor, retains movement and fires the source shotgun", async () => {
    const command = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--dedicated', '--character', 'q1']);
    if (command.kind !== 'run')
        throw new Error("Missing actual QC fixture state");
    const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false }), preset = applicationPreset(catalog, command.options);
    const recipe = await resolveLaunch({ catalog, preset: { ...preset, execution: [{ kind: 'quakec', owner: preset.map.entities, role: 'server-game', artifact: { content: preset.map.entities.content, path: 'progs.dat' }, api: { kind: 'q1-netquake', programVersion: 6, systemCrc: 5927 } }] }, choice: presetChoice(preset.id) });
    const application = await Application.open(command.options, { print: () => undefined }, recipe);
    try {
        const simulation = application.simulation, source = simulation.quakecSource();
        if (source === null)
            throw new Error("Missing actual QC fixture state");
        const client = simulation.options.identity.client(0, 0), reserved = source.slots.at(1);
        const admitted = simulation.admitPlayer(client), player = simulation.movementPlayer(admitted.actor);
        if (player === null || reserved === null)
            throw new Error('Missing reserved client');
        expect(admitted.actor).toBe(reserved.id);
        expect(simulation.q1Source()).toBeNull();
        expect(source.isActiveClient(admitted.actor)).toBe(true);
        expect(simulation.combat.read(admitted.actor)?.health).toBe(100);
        expect(simulation.inventory.count(admitted.actor, 'q1:ammo/shells')).toBe(25);
        const spawned = simulation.bodies.read(admitted.actor);
        if (spawned === null)
            throw new Error("Missing actual QC fixture state");
        simulation.step({ elapsedMilliseconds: 50, commands: [{ actor: admitted.actor, source: { kind: 'remote-client', client }, sequence: 0, command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: player.viewAngles, forwardMove: 100, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } }] });
        const moved = simulation.bodies.read(admitted.actor);
        if (moved === null)
            throw new Error("Missing actual QC fixture state");
        expect(moved.origin).not.toEqual(spawned.origin);
        simulation.step({ elapsedMilliseconds: 50, commands: [] });
        expect(simulation.bodies.read(admitted.actor)?.origin).not.toEqual(moved.origin);
        simulation.step({ elapsedMilliseconds: 50, commands: [{ actor: admitted.actor, source: { kind: 'remote-client', client }, sequence: 1, command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: player.viewAngles, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } }] });
        for (let i = 0; i < 3; i++)
            simulation.step({ elapsedMilliseconds: 100, commands: [] });
        simulation.step({ elapsedMilliseconds: 50, commands: [{ actor: admitted.actor, source: { kind: 'remote-client', client }, sequence: 2, command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: player.viewAngles, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 2, impulse: 0 } }] });
        expect(simulation.bodies.read(admitted.actor)?.velocity.z).toBe(230);
        simulation.step({ elapsedMilliseconds: 50, commands: [] });
        expect(simulation.bodies.read(admitted.actor)?.velocity.z).toBe(190);
        const playerBody = simulation.bodies.read(admitted.actor);
        if (playerBody === null)
            throw new Error("Missing actual QC fixture state");
        const lane = (() => {
            for (const target of simulation.actors.observations().filter(a => source.classname(a.id) === 'monster_army')) {
                const targetBody = simulation.bodies.read(target.id);
                if (targetBody === null)
                    continue;
                for (const distance of [80, 120, 160])
                    for (const [offsetX, offsetY, yaw] of [[-distance, 0, 0], [distance, 0, 180], [0, -distance, 90], [0, distance, 270]]) {
                        if (offsetX === undefined || offsetY === undefined || yaw === undefined)
                            throw new Error("Missing actual QC fixture state");
                        const candidate = { x: targetBody.origin.x + offsetX, y: targetBody.origin.y + offsetY, z: targetBody.origin.z };
                        const clear = simulation.scene.trace({ start: candidate, end: candidate, shape: { kind: 'box', bounds: playerBody.bounds }, target: { kind: 'world' }, policy: { kind: 'q1', move: 'normal', hull: null }, numeric: Q1_DONOR_PROFILE, passActor: admitted.actor });
                        const shot = simulation.scene.trace({ start: { ...candidate, z: candidate.z + 15 }, end: { ...targetBody.origin, z: targetBody.origin.z + 15 }, shape: { kind: 'point' }, target: { kind: 'world' }, policy: { kind: 'q1', move: 'normal', hull: null }, numeric: Q1_DONOR_PROFILE, passActor: admitted.actor });
                        if (!clear.startSolid && !clear.allSolid && shot.hit.kind === 'actor' && shot.hit.actor.equals(target.id))
                            return { target, origin: candidate, angle: yaw };
                    }
            }
            throw new Error('No valid authored creature lane');
        })();
        const { target, origin, angle } = lane;
        simulation.bodies.write(player.actor, { ...playerBody, origin, velocity: { x: 0, y: 0, z: 0 } });
        simulation.bodies.link(player.actor);
        const before = simulation.combat.read(target.id)?.health;
        const output = simulation.step({ elapsedMilliseconds: 100, commands: [{ actor: admitted.actor, source: { kind: 'remote-client', client }, sequence: 3, command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: { x: 0, y: angle, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 1, impulse: 0 } }] });
        if (before === undefined)
            throw new Error('Missing victim health');
        const after = simulation.combat.read(target.id)?.health;
        if (after === undefined)
            throw new Error("Missing actual QC fixture state");
        expect(after).toBeLessThan(before);
        expect(simulation.inventory.count(admitted.actor, 'q1:ammo/shells')).toBe(24);
        expect(output.events.length).toBeGreaterThan(0);
        const slot = source.sourceSlot(admitted.actor), linked = simulation.bodies.linked(admitted.actor);
        if (slot === null || linked === null)
            throw new Error('Missing client link');
        const absmin = source.prepared.program.fieldsByName.get('absmin'), absmax = source.prepared.program.fieldsByName.get('absmax');
        if (absmin === undefined || absmax === undefined)
            throw new Error('Missing raw bounds fields');
        expect(source.entities.at(slot).vector(absmin.offset)).toEqual(linked.absoluteBounds.min);
        expect(source.entities.at(slot).vector(absmax.offset)).toEqual(linked.absoluteBounds.max);
        expect(() => simulation.checkpoint()).toThrow('complete saved-game checkpoint');
        simulation.disconnectPlayer(admitted.actor);
        expect(source.isActiveClient(admitted.actor)).toBe(false);
        expect(simulation.players()).toEqual([]);
        expect(simulation.actors.isLive(admitted.actor)).toBe(true);
        const reconnected = simulation.admitPlayer(simulation.options.identity.client(0, 1));
        expect(reconnected.actor.equals(admitted.actor)).toBe(false);
        expect(simulation.actors.isLive(admitted.actor)).toBe(false);
        expect(source.sourceSlot(reconnected.actor)).toBe(1);
        expect(source.isActiveClient(reconnected.actor)).toBe(true);
        expect(simulation.inventory.count(reconnected.actor, 'q1:ammo/shells')).toBe(25);
        const reconnectClient = simulation.options.identity.client(0, 1);
        simulation.step({ elapsedMilliseconds: 50, commands: [1, 0].map((impulse, sequence): Parameters<typeof simulation.step>[0]['commands'][number] => ({
                actor: reconnected.actor, source: { kind: 'remote-client', client: reconnectClient }, sequence,
                command: { kind: 'q1-netquake', acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse },
            })) });
        expect(source.clientArsenal(reconnected.actor).activeWeapon).toBe('q1:weapon/axe');
        simulation.step({ elapsedMilliseconds: 50, commands: [] });
        await application.close();
        expect(source.isActiveClient(reconnected.actor)).toBe(false);
        expect(simulation.actors.isLive(reconnected.actor)).toBe(false);
    }
    finally {
        await application.close();
    }
}, 45000);
test("native NetQuake held movement survives a fresh encoded save without another command", async () => {
    const command = parseApplicationCommand(["--game", "q1-classic-id1", "--map", "e1m1", "--movement", "q1", "--character", "q1", "--dedicated"]);
    if (command.kind !== "run")
        throw new Error("Expected native NetQuake launch");
    const content = await loadApplicationContent(command.options), identity = createIdentityOwner("native-held-command"), client = identity.client(0, 0);
    const options: Parameters<typeof createSimulation>[0] = { identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
        skill: 0, mode: "singleplayer", seed: 17, maxClients: 1 };
    const simulation = createSimulation(options);
    try {
        const actor = simulation.admitPlayer(client).actor, player = simulation.movementPlayer(actor);
        if (player === null)
            throw new Error("Missing native player");
        simulation.step({ elapsedMilliseconds: 50, commands: [1, 0].map((impulse, sequence): Parameters<typeof simulation.step>[0]["commands"][number] => ({
            actor, source: { kind: "remote-client", client }, sequence,
            command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: simulation.timeSeconds, viewAngles: player.viewAngles,
                forwardMove: 100, sideMove: 0, upMove: 0, buttons: 0, impulse },
        })) });
        expect(simulation.q1Source()?.game.player(actor)?.weapon).toBe("axe");
        expect(player.netQuakeCommand?.impulse).toBe(0);
        const before = simulation.bodies.read(actor);
        const saved = decodeSaveImage(encodeSaveImage(simulation.checkpoint()));
        const restoredIdentity = createIdentityOwner("native-held-command-restored"), restoredClient = restoredIdentity.client(0, 0);
        const restored = createSimulation({ ...options, identity: restoredIdentity, restoredClients: [restoredClient], restore: saved });
        try {
            const restoredActor = restored.players()[0];
            if (restoredActor === undefined || before === null)
                throw new Error("Missing restored native player");
            expect(restored.movementPlayer(restoredActor)?.netQuakeCommand).toEqual(player.netQuakeCommand);
            for (let frame = 0; frame < 3; frame++) {
                simulation.step({ elapsedMilliseconds: 50, commands: [] });
                restored.step({ elapsedMilliseconds: 50, commands: [] });
                expect(restored.bodies.read(restoredActor)?.origin).toEqual(simulation.bodies.read(actor)?.origin);
                expect(restored.bodies.read(restoredActor)?.velocity).toEqual(simulation.bodies.read(actor)?.velocity);
            }
            expect(simulation.bodies.read(actor)?.origin).not.toEqual(before.origin);
        }
        finally {
            restored.close();
        }
    }
    finally {
        simulation.close();
        await content.close();
    }
});


test("actual QC client think preserves selected toss physics and source model bounds", async () => {
const command = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--dedicated', '--character', 'q1']);
if (command.kind !== 'run') throw new Error('Missing launch');
const catalog = await discoverInstalledContent({ corpusRoot: command.options.corpusRoot, discoverMods: false });
const preset = applicationPreset(catalog, command.options);
const recipe = await resolveLaunch({ catalog, preset: { ...preset, execution: [{ kind: 'quakec', owner: preset.map.entities, role: 'server-game',
  artifact: { content: preset.map.entities.content, path: 'progs.dat' }, api: { kind: 'q1-netquake', programVersion: 6, systemCrc: 5927 } }] }, choice: presetChoice(preset.id) });
const app = await Application.open(command.options, { print: () => undefined }, recipe);
try {
  const simulation = app.simulation, source = simulation.quakecSource(); if (source === null) throw new Error('Missing source');
  const player = simulation.admitPlayer(simulation.options.identity.client(0, 0)), slot = source.sourceSlot(player.actor);
  if (slot === null) throw new Error('Missing player slot');
  const words = source.entities.at(slot), field = (name: string): number => {
    const value = source.prepared.program.fieldsByName.get(name); if (value === undefined) throw new Error(name); return value.offset;
  };
  const origin = words.vector(field('origin'));
  words.setVector(field('velocity'), { x: 0, y: 0, z: 0 }); words.setFloat(field('movetype'), 6); words.setFloat(field('flags'), 8);
  words.setFloat(field('nextthink'), simulation.timeSeconds + 0.05);
  words.setInt(field('think'), source.prepared.program.functionNamed('BecomeExplosion').index);
  source.worldHost.link(slot);
  // Explicit source-controlled client think, without changing the map or its authored actors.
  const runThink = source.runThink.bind(source);
  source.runThink = (actor, frame) => {
    runThink(actor, frame);
    if (actor.id.equals(player.actor)) {
      const bounds = { min: words.vector(field('mins')), max: words.vector(field('maxs')) };
      const trace = source.options.scene.trace({ start: origin, end: { ...origin, z: origin.z - 8 }, shape: { kind: 'box', bounds }, target: { kind: 'world' },
        policy: { kind: 'q1', move: 'normal', hull: null }, numeric: Q1_DONOR_PROFILE, passActor: actor.id });
      expect(bounds).toEqual({ min: { x: -28, y: -28, z: -28 }, max: { x: 28, y: 28, z: 28 } });
      expect(trace.fraction).toBe(1); expect(trace.end.z).toBe(origin.z - 8);
    }
    return undefined;
  };
  simulation.step({ elapsedMilliseconds: 100, commands: [] });
  expect(words.vector(field('origin'))).toEqual({ ...origin, z: origin.z - 8 });
  expect(words.vector(field('velocity'))).toEqual({ x: 0, y: 0, z: -80 });
  expect(words.vector(field('mins'))).toEqual({ x: -28, y: -28, z: -28 });
  expect(words.vector(field('maxs'))).toEqual({ x: 28, y: 28, z: 28 });
  expect(simulation.bodies.read(player.actor)?.bounds).toEqual({ min: { x: -28, y: -28, z: -28 }, max: { x: 28, y: 28, z: 28 } });

} finally { await app.close(); }

}, 45000);
