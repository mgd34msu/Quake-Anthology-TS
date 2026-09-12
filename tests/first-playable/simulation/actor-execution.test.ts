import { expect, test } from "bun:test";
import { loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
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
