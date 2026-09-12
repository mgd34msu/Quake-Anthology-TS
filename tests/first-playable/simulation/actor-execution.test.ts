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
