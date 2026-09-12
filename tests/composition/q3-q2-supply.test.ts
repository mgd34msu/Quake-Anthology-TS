import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { Q3_Q2_SUPPLY_PROFILE } from "../../src/content/composition/q3-q2-supply.ts";
import { SessionActorRegistry } from "../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../src/world/gameplay/inventory.ts";
import { SharedPickupAdmission } from "../../src/world/gameplay/pickups.ts";

test("Q3 supplies grant paired Q2 guns and refill existing equipment pools within capacity", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("q3-q2-supply"));
  const actor = actors.allocate("q3:game", "q3:player"), inventory = new SharedInventoryTable(actors);
  inventory.create(actor, [
    { item: "q2:weapon_machinegun", count: 1, capacity: 1 },
    { item: "q2:weapon_chaingun", count: 0, capacity: 1 },
    { item: "q2:ammo_bullets", count: 195, capacity: 200 },
    { item: "q2:ammo_grenades", count: 48, capacity: 50 },
    { item: "q2:ammo_cells", count: 198, capacity: 200 },
    { item: "q3:holdable/teleporter", count: 1, capacity: 1 },
  ]);
  const pickups = new SharedPickupAdmission({ inventory, profile: Q3_Q2_SUPPLY_PROFILE,
    ammoGranted: () => undefined, weaponGranted: () => undefined });
  expect(pickups.owns(actor.id, "q3:weapon/machinegun")).toBe(false);
  expect(pickups.weapon(actor, { item: "q3:weapon/machinegun", ammo: [{ item: "q3:ammo/machinegun", amount: 40 }] }, "better")).toBe(true);
  expect(pickups.owns(actor.id, "q3:weapon/machinegun")).toBe(true);
  expect(inventory.count(actor.id, "q2:weapon_chaingun")).toBe(1);
  expect(inventory.count(actor.id, "q2:ammo_bullets")).toBe(200);
  expect(pickups.ammo(actor, { item: "q3:ammo/grenadelauncher", amount: 5 })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(50);
  expect(inventory.consume(actor, "q2:ammo_grenades", 1)).toBe(true);
  expect(pickups.ammo(actor, { item: "q3:ammo/grenadelauncher", amount: 5 })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(50);
  expect(pickups.ammo(actor, { item: "q3:ammo/plasmagun", amount: 30 })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_cells")).toBe(200);
  expect(pickups.ammo(actor, { item: "q3:ammo/bfg", amount: 15 })).toBe(false);
  expect(inventory.count(actor.id, "q3:holdable/teleporter")).toBe(1);
  actors.close();
});
