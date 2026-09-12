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
