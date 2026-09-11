import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { WeaponStepInput } from "../../../../src/contracts/movement.ts";
import { Q3SelectedArsenal, readQ3SelectedArsenalCheckpoint } from "../../../../src/app/bootstrap/simulation/arsenal/q3.ts";
import { q3SpawnAnimation } from "../../../../src/content/q3/foundation/arsenal.ts";
import { SaveReader } from "../../../../src/persistence/value.ts";
import { SessionActorRegistry } from "../../../../src/world/actors/registry.ts";
import { SharedInventoryTable } from "../../../../src/world/gameplay/inventory.ts";

test("selected Q3 arsenal consumes shared inventory for a Q1 actor and restores its exact cooldown", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("selected-q3-arsenal"));
  const actor = actors.allocate("q1:character", "q1:player"), inventory = new SharedInventoryTable(actors);
  inventory.create(actor, [{ item: "q1:ammo/shells", count: 25, capacity: 100 }]);
  const shots: number[] = [];
  const authority = new Q3SelectedArsenal({ provider: "q3:official", product: "baseq3", inventory,
    fire: (owner, weapon) => { expect(owner).toBe(actor); shots.push(weapon); return undefined; },
    useHoldable: () => { throw new Error("No holdable was admitted"); } });
  const input: WeaponStepInput = { actor, arsenal: authority.admit(actor, 100),
    command: { kind: "q1-netquake", acknowledgedServerTimeSeconds: 0, viewAngles: { x: 0, y: 0, z: 0 },
      forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 },
    frame: { frame: 1, time: { kind: "seconds", value: 0.016 }, elapsed: { kind: "seconds", value: 0.016 }, phase: "client-command" },
    animation: { provider: "q3:character", state: q3SpawnAnimation() },
    environment: { health: 100, flight: false, haste: false, invulnerable: false, gravityMultiplier: 1 }, gauntletHit: false };
  authority.step(input, undefined);
  const attack = { ...input, command: { ...input.command, buttons: 1 } };
  authority.step(attack, undefined);
  expect(shots).toEqual([2]);
  expect(inventory.count(actor.id, "q3:ammo/machinegun")).toBe(99);
  expect(inventory.count(actor.id, "q1:ammo/shells")).toBe(25);
  const checkpoint = readQ3SelectedArsenalCheckpoint(new SaveReader(authority.capture(actor.id)));
  const expected = authority.step(attack, undefined);
  authority.restore(actor, checkpoint);
  expect(authority.step(attack, undefined)).toEqual(expected);
  expect(shots).toEqual([2]);
  expect(authority.ui(actor.id).activeWeapon).toBe("q3:weapon/machinegun");
  expect(authority.view(actor.id)?.path).toBe("models/weapons2/machinegun/machinegun.md3");
  expect(authority.select(actor.id, "q1:weapon/shotgun")).toBe(false);
  expect(authority.select(actor.id, "q3:weapon/gauntlet")).toBe(true);
  expect(() => authority.step(input, { provider: "q1:official", weapon: null, useHoldable: false })).toThrow("different provider");
});
