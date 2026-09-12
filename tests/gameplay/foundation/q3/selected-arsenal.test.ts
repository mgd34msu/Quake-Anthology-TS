import type { ProviderReference } from "../../../../src/contracts/content.ts";
import type { ItemId } from "../../../../src/contracts/gameplay.ts";
import { q2WeaponStatus, q3WeaponStatus, q3ArsenalWarning } from "../../../../src/app/bootstrap/simulation/arsenal/weapon-status.ts";
import { Q2_BASE_WEAPONS } from "../../../../src/content/q2/foundation/weapons/definitions.ts";
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
  expect(authority.ui(actor.id, { provider: "q3:official", content: "q3:classic:baseq3:fixture" }).activeWeapon).toBe("q3:weapon/machinegun");
  expect(authority.view(actor.id)?.path).toBe("models/weapons2/machinegun/machinegun.md3");
  inventory.configure(actor, { item: "q3:ammo/machinegun", count: -1, capacity: 200, countPolicy: { kind: "source-counter", arithmetic: "int32" } });
  expect(authority.ui(actor.id, { provider: "q3:official", content: "q3:classic:baseq3:fixture" }).weaponStatus?.ammo).toEqual({ kind: "unmetered" });
  for (let frame = 0; frame < 10; frame++) authority.step(attack, undefined);
  expect(shots.length).toBeGreaterThan(1);
  expect(inventory.count(actor.id, "q3:ammo/machinegun")).toBe(-1);
  expect(authority.select(actor.id, "q1:weapon/shotgun")).toBe(false);
  expect(authority.select(actor.id, "q3:weapon/gauntlet")).toBe(true);
  expect(() => authority.step(input, { provider: "q1:official", weapon: null, useHoldable: false })).toThrow("different provider");
});

test("weapon status distinguishes source ammo thresholds, unmetered weapons and owned Q3 aggregate", () => {
  const amounts = new Map<ItemId, number>([["q3:weapon/machinegun", 1], ["q3:ammo/machinegun", 0], ["q3:ammo/rocketlauncher", 100]]);
  const count = (item: ItemId) => amounts.get(item) ?? 0;
  const source: ProviderReference = { provider: "q3:official", content: "q3:classic:baseq3:fixture" };
  expect(q3WeaponStatus("q3:weapon/machinegun", "baseq3", count, source)?.ammo).toEqual({ kind: "finite", item: "q3:ammo/machinegun", count: 0, hasAmmoToStart: false, low: false });
  expect(q3ArsenalWarning("baseq3", count)).toBe("empty");
  amounts.set("q3:ammo/machinegun", 24);
  expect(q3ArsenalWarning("baseq3", count)).toBe("low");
  amounts.set("q3:ammo/machinegun", 25);
  expect(q3ArsenalWarning("baseq3", count)).toBe("none");
  expect(q3WeaponStatus("q3:weapon/gauntlet", "baseq3", count, source)?.ammo).toEqual({ kind: "unmetered" });
  const q2Source: ProviderReference = { provider: "q2:official", content: "q2:classic:baseq2:fixture" };
  const bfg = Q2_BASE_WEAPONS.find(weapon => weapon.name === "bfg");
  const blaster = Q2_BASE_WEAPONS.find(weapon => weapon.name === "blaster");
  if (bfg === undefined || blaster === undefined) throw new Error("Base source weapons absent");
  amounts.set("q2:ammo_cells", 49);
  expect(q2WeaponStatus(bfg, count, q2Source)?.ammo).toEqual({ kind: "finite", item: "q2:ammo_cells", count: 49, hasAmmoToStart: false, low: true });
  amounts.set("q2:ammo_cells", 50);
  expect(q2WeaponStatus(bfg, count, q2Source)?.ammo).toEqual({ kind: "finite", item: "q2:ammo_cells", count: 50, hasAmmoToStart: true, low: true });
  expect(q2WeaponStatus(blaster, count, q2Source)?.ammo).toEqual({ kind: "unmetered" });
});
