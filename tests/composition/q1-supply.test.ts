import type { ItemId, InventoryEntry } from "../../src/contracts/gameplay.ts";
import type { PickupAmmoGrant, PickupAmmoReceipt, PickupSupplyOffer } from "../../src/contracts/pickups.ts";
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

test("supply previews preserve inventory and callbacks while matching real mapped grants", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("supply-preview")), actor = actors.allocate("q2:game", "q2:player");
  const inventory = new SharedInventoryTable(actors);
  inventory.create(actor, [
    { item: "q1:ammo/cells", count: 95, capacity: 100 },
    { item: "q2:ammo_cells", count: 180, capacity: 200 },
    { item: "q2:item_power_shield", count: 1, capacity: 1 },
    { item: "q1:ammo/rockets", count: 99, capacity: 100 },
    { item: "q2:ammo_grenades", count: 49, capacity: 50 },
    { item: "q1:weapon/grenadelauncher", count: 0, capacity: 1 },
  ]);
  const callbacks: string[] = [];
  const admission = new SharedPickupAdmission({ inventory, profile: Q2_Q1_SUPPLY_PROFILE,
    ammoGranted: (_actor, receipts, autoSwitch) => { callbacks.push(JSON.stringify({ receipts, autoSwitch })); return undefined; },
    weaponGranted: (_actor, weapons, selection) => { callbacks.push(JSON.stringify({ weapons, selection })); return undefined; } });
  const offer = { item: "q2:ammo_cells", amount: 50 } satisfies PickupAmmoGrant;
  const before = inventory.entries(actor.id), preview = admission.preview(actor.id, { kind: "ammo", offer });
  expect(preview).toEqual({ accepted: true, weapons: [], ammo: [
    { item: "q2:ammo_cells", before: 180, given: 20 }, { item: "q1:ammo/cells", before: 95, given: 5 },
  ] });
  expect(inventory.entries(actor.id)).toEqual([...before]); expect(callbacks).toEqual([]);
  expect(admission.ammo(actor, offer, false)).toBe(preview.accepted);
  expect(callbacks).toEqual([JSON.stringify({ receipts: preview.ammo, autoSwitch: false })]);
  for (const receipt of preview.ammo) expect(inventory.count(actor.id, receipt.item)).toBe(receipt.before + receipt.given);
  expect(inventory.count(actor.id, "q2:item_power_shield")).toBe(1);
  const full = inventory.entries(actor.id), calls = callbacks.length;
  expect(admission.preview(actor.id, { kind: "ammo", offer }).accepted).toBe(false);
  expect(inventory.entries(actor.id)).toEqual([...full]); expect(callbacks.length).toBe(calls);
  expect(admission.ammo(actor, offer)).toBe(false); expect(callbacks.length).toBe(calls);
  const grenade = { item: "q2:ammo_grenades", weapon: "q2:ammo_grenades", amount: 5 } satisfies PickupAmmoGrant & { readonly weapon: ItemId };
  const combined = admission.preview(actor.id, { kind: "ammoWeapon", offer: grenade });
  expect(combined.weapons).toEqual([{ item: "q1:weapon/grenadelauncher", before: 0, given: 1 }]);
  expect(callbacks.length).toBe(calls);
  expect(admission.ammoWeapon(actor, grenade, { mode: "better", when: "empty-ammo" })).toBe(combined.accepted);
  expect(callbacks.at(-1)).toBe(JSON.stringify({ weapons: ["q1:weapon/grenadelauncher"], selection: "never" }));
  expect(admission.preview(actor.id, { kind: "ammoWeapon", offer: grenade })).toEqual({ accepted: false, weapons: [], ammo: [
    { item: "q2:ammo_grenades", before: 50, given: 0 }, { item: "q1:ammo/rockets", before: 100, given: 0 },
  ] });
  actors.close();
});

test("preview replays repeated destinations and source counter arithmetic in grant order", () => {
  const cases: readonly { readonly arithmetic: "binary32" | "binary64" | "int32"; readonly count: number; readonly capacity: number; readonly amount: number }[] = [
    { arithmetic: "binary32", count: 16777216, capacity: 33554432, amount: 1 },
    { arithmetic: "int32", count: 2147483647, capacity: 4294967295, amount: 1 },
    { arithmetic: "binary64", count: -3, capacity: 10, amount: 2 },
    { arithmetic: "binary64", count: 12, capacity: 10, amount: 2 },
  ];
  for (const row of cases) {
    const actors = new SessionActorRegistry(createIdentityOwner(`preview-${row.arithmetic}-${row.count}`)), actor = actors.allocate("q1:game", "q1:player");
    const inventory = new SharedInventoryTable(actors);
    const entries = new Map<ItemId, InventoryEntry>([
      ["test:pool", { item: "test:pool", count: row.count, capacity: row.capacity, countPolicy: { kind: "source-counter", arithmetic: row.arithmetic } }],
      ["test:gun", { item: "test:gun", count: 0, capacity: 1 }],
    ]);
    const writes: PickupAmmoReceipt[] = [], callbacks: string[] = [];
    inventory.bind(actor, { read: () => [...entries.values()], write: entry => {
      const before = entries.get(entry.item)?.count; if (before === undefined) throw new Error("Missing test inventory entry");
      writes.push({ item: entry.item, before, given: entry.count - before }); entries.set(entry.item, entry); return undefined;
    } });
    const admission = new SharedPickupAdmission({ inventory, profile: { id: "test:supply", weaponOwnership: "all-destinations",
      ammo: [{ source: "source:first", destinations: ["test:pool"] }, { source: "source:second", destinations: ["test:pool"] }, { source: "source:unadmitted", destinations: ["test:missing"] }],
      weapons: [{ source: "source:gun", destinations: ["test:gun"] }] },
      ammoGranted: () => { callbacks.push("ammo"); return undefined; }, weaponGranted: () => { callbacks.push("weapon"); return undefined; } });
    const offer = { item: "source:gun", ammo: [{ item: "source:first", amount: row.amount }, { item: "source:second", amount: row.amount }] } satisfies Extract<PickupSupplyOffer, { readonly kind: "weapon" }>["offer"];
    const before = inventory.entries(actor.id), preview = admission.preview(actor.id, { kind: "weapon", offer });
    expect(preview.accepted).toBe(true); expect(inventory.entries(actor.id)).toEqual([...before]); expect(writes).toEqual([]); expect(callbacks).toEqual([]);
    expect(preview.ammo[1]?.before).toBe((preview.ammo[0]?.before ?? 0) + (preview.ammo[0]?.given ?? 0));
    expect(admission.weapon(actor, offer, "never")).toBe(preview.accepted);
    expect(callbacks).toEqual(["weapon"]); expect(writes[0]).toEqual(preview.weapons[0]);
    expect(inventory.count(actor.id, "test:pool")).toBe(preview.ammo.reduce((count, receipt) => count + receipt.given, row.count));
    if (row.count > row.capacity) expect(writes.length).toBe(1);
    else expect(writes.slice(1)).toEqual([...preview.ammo]);
    if (row.arithmetic === "binary32") expect(writes.slice(1).map(receipt => receipt.given)).toEqual([0, 0]);
    if (row.arithmetic === "int32") expect(preview.ammo[0]?.given).toBe(-4294967295);
    expect(() => admission.preview(actor.id, { kind: "ammo", offer: { item: "source:missing", amount: 1 } })).toThrow("no ammo mapping");
    const unchanged = inventory.entries(actor.id), written = writes.length, called = callbacks.length;
    const invalid = { ...offer, ammo: [...offer.ammo, { item: "source:unadmitted", amount: 1 }] } satisfies Extract<PickupSupplyOffer, { readonly kind: "weapon" }>["offer"];
    expect(() => admission.preview(actor.id, { kind: "weapon", offer: invalid })).toThrow("was not admitted");
    expect(() => admission.weapon(actor, invalid, "always")).toThrow("was not admitted");
    expect(inventory.entries(actor.id)).toEqual([...unchanged]); expect(writes.length).toBe(written); expect(callbacks.length).toBe(called);
    if (row.arithmetic === "binary32") {
      const ammo = { item: "source:first", amount: 1 } satisfies PickupAmmoGrant;
      expect(admission.preview(actor.id, { kind: "ammo", offer: ammo }).accepted).toBe(false);
      expect(writes.length).toBe(written);
      expect(admission.ammo(actor, ammo)).toBe(false); expect(writes.length).toBe(written + 1); expect(callbacks.length).toBe(called);
    }
    actors.close();
  }
});
