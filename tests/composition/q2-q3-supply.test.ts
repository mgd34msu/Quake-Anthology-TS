import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { Q2_Q3_SUPPLY_PROFILE } from "../../src/content/composition/q2-q3-supply.ts";
import { SessionActorRegistry } from "../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../src/world/gameplay/inventory.ts";
import { SharedPickupAdmission } from "../../src/world/gameplay/pickups.ts";

test("Q2 grenades refill existing equipment ammo when selected Q3 grenade ammo is full", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("q2-q3-grenade-supply"));
  const actor = actors.allocate("q2:game", "q2:player");
  const inventory = new SharedInventoryTable(actors);
  inventory.create(actor, [
    { item: "q2:ammo_grenades", count: 2, capacity: 50 },
    { item: "q3:ammo/grenadelauncher", count: 200, capacity: 200 },
    { item: "q3:weapon/grenadelauncher", count: 1, capacity: 1 },
  ]);
  const pickups = new SharedPickupAdmission({ inventory, profile: Q2_Q3_SUPPLY_PROFILE,
    ammoGranted: () => undefined, weaponGranted: () => undefined });
  const offer = { item: "q2:ammo_grenades", weapon: "q2:ammo_grenades", amount: 5 } satisfies Parameters<SharedPickupAdmission["ammoWeapon"]>[1];
  expect(pickups.ammoWeapon(actor, offer, { mode: "better", when: "empty-ammo" })).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(7);
  expect(inventory.count(actor.id, "q3:ammo/grenadelauncher")).toBe(200);
  expect(inventory.consume(actor, "q2:ammo_grenades", 1)).toBe(true);
  expect(inventory.count(actor.id, "q2:ammo_grenades")).toBe(6);
  inventory.give(actor, "q2:ammo_grenades", 44);
  expect(pickups.ammoWeapon(actor, offer, { mode: "better", when: "empty-ammo" })).toBe(false);
});

test("ammo weapon identity supplies count ammo once in preview and committed grants", () => {
  for (const count of [0, 48, 50]) {
    const actors = new SessionActorRegistry(createIdentityOwner(`identity-grenades-${count}`));
    const actor = actors.allocate("q2:game", "q2:player"), inventory = new SharedInventoryTable(actors);
    inventory.create(actor, [{ item: "q2:ammo_grenades", count, capacity: 50 },
      { item: "q3:weapon/grenadelauncher", count: 0, capacity: 1 }]);
    const notifications: { readonly weapons: readonly string[]; readonly selection: string }[] = [];
    const pickups = new SharedPickupAdmission({ inventory, profile: {
      id: "q2:identity-grenades", weaponOwnership: "all-destinations",
      ammo: [{ source: "q2:ammo_grenades", destinations: ["q2:ammo_grenades"] }],
      weapons: [{ source: "q2:ammo_grenades", destinations: ["q2:ammo_grenades", "q3:weapon/grenadelauncher"] }],
    }, ammoGranted: () => undefined, weaponGranted: (_actor, weapons, selection) => { notifications.push({ weapons, selection }); } });
    const offer = { item: "q2:ammo_grenades", weapon: "q2:ammo_grenades", amount: 5 } satisfies Parameters<SharedPickupAdmission["ammoWeapon"]>[1];
    const accepted = count < 50, given = Math.min(5, 50 - count);
    const preview = pickups.preview(actor.id, { kind: "ammoWeapon", offer });
    expect(preview).toEqual({ accepted, ammo: [{ item: offer.item, before: count, given }], weapons: accepted
      ? [{ item: offer.item, before: count, given }, { item: "q3:weapon/grenadelauncher", before: 0, given: 1 }] : [] });
    expect(inventory.count(actor.id, offer.item)).toBe(count);
    expect(pickups.ammoWeapon(actor, offer, { mode: "better", when: "empty-ammo" })).toBe(accepted);
    expect(inventory.count(actor.id, offer.item)).toBe(count + given);
    expect(inventory.count(actor.id, "q3:weapon/grenadelauncher")).toBe(accepted ? 1 : 0);
    expect(notifications).toEqual(accepted ? [{ weapons: [offer.item, "q3:weapon/grenadelauncher"], selection: count === 0 ? "better" : "never" }] : []);
  }
});
