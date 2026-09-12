import { Q1_Q2_SUPPLY_PROFILE, q1Q2PickupSelect } from "../../src/content/composition/q1-q2-supply.ts";
import { Q2_BASE_WEAPONS } from "../../src/content/q2/foundation/weapons/definitions.ts";
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { Q2_Q1_SUPPLY_PROFILE } from "../../src/content/composition/q2-q1-supply.ts";
import { Q3_Q1_SUPPLY_PROFILE } from "../../src/content/composition/q3-q1-supply.ts";
import { SessionActorRegistry } from "../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../src/world/gameplay/inventory.ts";
import { SharedPickupAdmission } from "../../src/world/gameplay/pickups.ts";

test("Q1 to Q2 composition pickup rank retains stronger current weapons", () => {
  expect(q1Q2PickupSelect("q2:weapon_hyperblaster", "q2:weapon_shotgun", "better")).toBe(false);
  expect(q1Q2PickupSelect("q2:weapon_shotgun", "q2:weapon_hyperblaster", "better")).toBe(true);
  expect(q1Q2PickupSelect("q2:weapon_shotgun", "q2:weapon_shotgun", "better")).toBe(false);
  expect(q1Q2PickupSelect("q2:weapon_hyperblaster", "q2:weapon_shotgun", "always")).toBe(true);
  expect(q1Q2PickupSelect("q2:weapon_shotgun", "q2:weapon_hyperblaster", "never")).toBe(false);
});

test("foreign Q1 supply clamps shared pools and preserves native Q2 equipment ammo", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("q1-supply"));
  const actor = actors.allocate("q2:game", "q2:player");
  const inventory = new SharedInventoryTable(actors);
  inventory.create(actor, [
    { item: "q1:ammo/cells", count: 95, capacity: 100 },
    { item: "q2:ammo_cells", count: 0, capacity: 200 },
    { item: "q1:ammo/rockets", count: 98, capacity: 100 },
    { item: "q2:ammo_grenades", count: 0, capacity: 50 },
    { item: "q1:weapon/grenadelauncher", count: 0, capacity: 1 },
    { item: "q1:weapon/lightning", count: 0, capacity: 1 },
  ]);
  const q2 = new SharedPickupAdmission({ inventory, profile: Q2_Q1_SUPPLY_PROFILE,
    ammoGranted: () => undefined, weaponGranted: () => undefined });
  expect(q2.ammo(actor, { item: "q2:ammo_cells", amount: 50 })).toBe(true);
  expect(inventory.count(actor.id, "q1:ammo/cells")).toBe(100);
  expect(inventory.count(actor.id, "q2:ammo_cells")).toBe(50);
  expect(q2.ammoWeapon(actor, { item: "q2:ammo_grenades", weapon: "q2:ammo_grenades", amount: 5 },
    { mode: "better", when: "empty-ammo" })).toBe(true);
  expect(inventory.count(actor.id, "q1:ammo/rockets")).toBe(100);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(5);
  expect(q2.owns(actor.id, "q2:ammo_grenades")).toBe(true);
  const q3 = new SharedPickupAdmission({ inventory, profile: Q3_Q1_SUPPLY_PROFILE,
    ammoGranted: () => undefined, weaponGranted: () => undefined });
  expect(q3.ammo(actor, { item: "q3:ammo/lightning", amount: 60 })).toBe(false);
  inventory.consume(actor, "q1:ammo/cells", 30);
  expect(q3.weapon(actor, { item: "q3:weapon/bfg", ammo: [{ item: "q3:ammo/bfg", amount: 20 }] }, "better")).toBe(true);
  expect(inventory.count(actor.id, "q1:ammo/cells")).toBe(90);
  expect(q3.owns(actor.id, "q3:weapon/plasmagun")).toBe(true);
  expect(() => q3.ammo(actor, { item: "q3:holdable/medkit", amount: 1 })).toThrow("no ammo mapping");
  expect(inventory.count(actor.id, "q2:ammo_cells")).toBe(50);
});

test("Q1 supplies grant into existing Q2 ammo pools without resetting equipment", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("q1-q2-supply"));
  const actor = actors.allocate("q2:game", "q2:player"), inventory = new SharedInventoryTable(actors);
  inventory.create(actor, [
    { item: "q2:ammo_cells", count: 10, capacity: 18 },
    { item: "q2:ammo_shells", count: 0, capacity: 8 },
    { item: "q2:ammo_rockets", count: 2, capacity: 10 },
    { item: "q2:ammo_grenades", count: 7, capacity: 9 },
    { item: "q2:item_power_shield", count: 1, capacity: 1 },
    { item: "q2:weapon_hyperblaster", count: 0, capacity: 1 },
  ]);
  const admission = new SharedPickupAdmission({ inventory, profile: Q1_Q2_SUPPLY_PROFILE,
    ammoGranted: () => undefined, weaponGranted: () => undefined });
  expect(admission.ammo(actor, { item: "q1:ammo/cells", amount: 5 })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_cells")).toBe(15);
  expect(admission.ammo(actor, { item: "q1:ammo/shells", amount: 5 })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_shells")).toBe(5);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(7);
  expect(inventory.count(actor.id, "q2:item_power_shield")).toBe(1);
  expect(admission.weapon(actor, { item: "q1:weapon/lightning", ammo: [{ item: "q1:ammo/cells", amount: 5 }] }, "better")).toBe(true);
  expect(inventory.count(actor.id, "q2:weapon_hyperblaster")).toBe(1);
  expect(inventory.count(actor.id, "q2:ammo_cells")).toBe(18);
  expect(admission.ammo(actor, { item: "q1:ammo/rockets", amount: 5 })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_rockets")).toBe(7);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(9);
  for (const mapping of Q1_Q2_SUPPLY_PROFILE.weapons) for (const item of mapping.destinations)
    expect(Q2_BASE_WEAPONS.some(definition => definition.item === item)).toBe(true);
  actors.close();
});
