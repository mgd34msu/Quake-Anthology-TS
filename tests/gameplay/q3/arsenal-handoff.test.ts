import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { WeaponStepInput } from "../../../src/contracts/movement.ts";
import { Q3SelectedArsenal, readQ3SelectedArsenalCheckpoint } from "../../../src/app/bootstrap/simulation/arsenal/q3.ts";
import { q3SpawnAnimation } from "../../../src/content/q3/foundation/arsenal.ts";
import { EntityEvent, Holdable, Weapon, WeaponState } from "../../../src/movement/q3/constants.ts";
import { SaveReader, decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";
import { SessionActorRegistry } from "../../../src/world/actors/registry.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("q3-primary-handoff"));
  const actor = actors.allocate("q3:character", "q3:player"), inventory = new SharedInventoryTable(actors);
  inventory.create(actor, []);
  const shots: number[] = [], holdables: number[] = [], events: number[] = [];
  const arsenal = new Q3SelectedArsenal({ provider: "q3:official", product: "baseq3", inventory,
    fire: (_actor, weapon) => { shots.push(weapon); return undefined; },
    useHoldable: (_actor, event) => { holdables.push(event); return undefined; } });
  arsenal.admit(actor, 100);
  let time = 0;
  const step = (msec: number, attack = false, useHoldable = false) => {
    time += msec;
    const input: WeaponStepInput = { actor, arsenal: arsenal.read(actor.id),
      command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0, viewAngles: { x: 0, y: 0, z: 0 },
        forwardMove: 0, sideMove: 0, upMove: 0, buttons: attack ? 1 : 0, impulse: 0 },
      frame: { frame: 1, time: { kind: "milliseconds", value: time }, elapsed: { kind: "milliseconds", value: msec }, phase: "client-command" },
      animation: { provider: "q3:character", state: q3SpawnAnimation() },
      environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 }, gauntletHit: false };
    const result = arsenal.step(input, { provider: "q3:official", weapon: null, useHoldable });
    for (const effect of result.effects) if (effect.kind === "event") events.push(effect.value.event);
    return result;
  };
  const save = () => readQ3SelectedArsenalCheckpoint(new SaveReader(decodeCheckpointValue(encodeCheckpointValue(arsenal.capture(actor.id)))));
  step(0);
  return { actor, actors, inventory, arsenal, handoff: arsenal.handoff(actor.id), step, save, shots, holdables, events };
}

test("Q3 handoff retains cooldown, saves its real drop, processes holdables, and raises the original weapon", () => {
  const f = fixture();
  f.step(0, true);
  f.handoff.holster();
  f.handoff.holster();
  f.step(50, true);
  expect(f.save().runtime.externalSlot).toBe("holster-requested");
  expect(f.save().arsenal.state).toEqual({ kind: "q3", sourceWeapon: Weapon.WP_MACHINEGUN, state: WeaponState.WEAPON_FIRING, timeMilliseconds: 50 });
  f.step(50, true);
  expect(f.save().runtime.externalSlot).toBe("dropping");
  f.step(100, true);
  const dropping = f.save();
  const expected = f.step(100, true);
  f.arsenal.restore(f.actor, dropping);
  expect(f.step(100, true)).toEqual(expected);
  expect(f.handoff.isHolstered()).toBe(true);
  expect(f.arsenal.read(f.actor.id).activeWeapon).toBe("q3:weapon/machinegun");
  expect(f.shots).toEqual([Weapon.WP_MACHINEGUN]);
  expect(f.events.filter(event => event === EntityEvent.EV_CHANGE_WEAPON)).toHaveLength(1);
  const holstered = f.save();
  f.arsenal.restore(f.actor, { ...holstered, runtime: { ...holstered.runtime, holdableItem: 2, holdableTag: Holdable.HI_MEDKIT } });
  f.step(50, true, true);
  expect(f.holdables).toEqual([EntityEvent.EV_USE_ITEM0 + Holdable.HI_MEDKIT]);
  expect(f.handoff.isHolstered()).toBe(true);
  f.handoff.resume(null);
  const resuming = f.save();
  f.arsenal.restore(f.actor, resuming);
  f.step(0, true);
  expect(f.save().arsenal.state).toEqual({ kind: "q3", sourceWeapon: Weapon.WP_MACHINEGUN, state: WeaponState.WEAPON_RAISING, timeMilliseconds: 250 });
  const raising = f.save();
  f.step(250, true);
  f.arsenal.restore(f.actor, raising);
  f.step(250, true);
  expect(f.shots).toHaveLength(1);
  f.step(0, true);
  expect(f.shots).toEqual([Weapon.WP_MACHINEGUN, Weapon.WP_MACHINEGUN]);
  expect(f.inventory.count(f.actor.id, "q3:ammo/machinegun")).toBe(98);
  f.actors.close();
});

test("Q3 completes a committed native switch before external drop and uses native unavailable-weapon fallback", () => {
  const f = fixture();
  expect(f.handoff.select("q3:weapon/gauntlet")).toBe(true);
  f.step(0);
  f.handoff.holster();
  f.step(200);
  expect(f.arsenal.read(f.actor.id).activeWeapon).toBe("q3:weapon/gauntlet");
  expect(f.save().runtime.externalSlot).toBe("holster-requested");
  f.arsenal.restore(f.actor, f.save());
  f.step(250);
  f.step(0);
  f.step(200);
  expect(f.handoff.isHolstered()).toBe(true);
  expect(f.events.filter(event => event === EntityEvent.EV_CHANGE_WEAPON)).toHaveLength(2);
  expect(f.shots).toHaveLength(0);
  f.inventory.configure(f.actor, { item: "q3:weapon/gauntlet", count: 0, capacity: 1 });
  f.handoff.resume(null);
  f.step(0);
  expect(f.save().arsenal.state).toEqual({ kind: "q3", sourceWeapon: Weapon.WP_NONE, state: WeaponState.WEAPON_RAISING, timeMilliseconds: 250 });
  expect(f.arsenal.read(f.actor.id).activeWeapon).toBeNull();
  f.actors.close();
});

test("Q3 holster cancels a queued resume before any source raise commits", () => {
  const f = fixture();
  f.handoff.holster(); f.step(0); f.step(200);
  expect(f.handoff.isHolstered()).toBe(true);
  const before = f.save();
  f.handoff.resume(null);
  expect(f.save().runtime.externalSlot).toBe("resume-requested");
  f.handoff.holster();
  expect(f.handoff.isHolstered()).toBe(true);
  expect(f.save().arsenal).toEqual(before.arsenal);
  f.step(100, true);
  expect(f.handoff.isHolstered()).toBe(true);
  expect(f.shots).toHaveLength(0);
  f.handoff.resume(null); f.step(0);
  expect(f.save().arsenal.state).toEqual({ kind: "q3", sourceWeapon: Weapon.WP_MACHINEGUN, state: WeaponState.WEAPON_RAISING, timeMilliseconds: 250 });
  f.actors.close();
});
