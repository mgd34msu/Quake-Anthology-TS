import type { WeaponHudIcon } from "../../../src/contracts/ui.ts";
import { readItemIconDeclaration, resolveItemIcon, readSourceItemIcon } from "../../../src/content/item-icon.ts";
import { SaveReader } from "../../../src/persistence/value.ts";
import { sourceItemNamed } from "../../../src/contracts/source-items.ts";
import type { HeldWeaponDeclaration } from "../../../src/contracts/held-weapon.ts";
import { captureSourceItems, readSourceItems } from "../../../src/persistence/source-items.ts";
import { savedActorId } from "../../../src/persistence/save-image.ts";
import { expect, test } from "bun:test";
import type { InventoryEntry } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";

function fixture(held?: HeldWeaponDeclaration, icon?: WeaponHudIcon | null) {
  const actors = new SessionActorRegistry(createIdentityOwner("source-items")), actor = actors.allocate("q2:world", "q2:player"), table = new SharedInventoryTable(actors);
  let primary: readonly InventoryEntry[] = [{ item: "q2:ammo_shells", count: 19, capacity: 100 }];
  table.bind(actor, { read: () => primary, write: entry => { primary = [entry]; return undefined; } });
  let entries: readonly InventoryEntry[] = [{ item: "q2:ammo_shells", count: 6, capacity: 50 }, { item: "mod:weapon/plasma", count: 1, capacity: 1 }], writes = 0;
  const lease = table.bindItems(actor, { owner: "mod:arsenal", items: [
    { admission: "replace-primary", definition: { item: "q2:ammo_shells", label: "Cells", kind: "counter", source: { provider: "mod:arsenal", content: "q1:classic:id1:installed" } } },
    { admission: "add", definition: { item: "mod:weapon/plasma", label: "Plasma", kind: "weapon", ammo: "q2:ammo_shells", ...(icon === undefined ? {} : { icon }), ...(held === undefined ? {} : { held }), source: { provider: "mod:arsenal", content: "q1:classic:id1:installed" } } },
  ], state: { read: () => entries, write: entry => { writes++; entries = entries.map(value => value.item === entry.item ? entry : value); return undefined; } } });
  return { actors, actor, table, lease, primary: () => primary, entries: () => entries, store: (value: readonly InventoryEntry[]) => { entries = value; }, writes: () => writes };
}
test("source items preserve primary storage and release exact ownership and pickup rules", () => {
  const f = fixture();
  try {
    expect(f.table.count(f.actor.id, "q2:ammo_shells")).toBe(6);
    expect(f.table.consume(f.actor, "q2:ammo_shells", 2)).toBe(true); expect(f.primary()[0]?.count).toBe(19);
    expect(f.table.itemOwner(f.actor.id, "mod:weapon/plasma")).toBe("mod:arsenal");
    expect(() => f.table.bindPickup(f.actor, { owner: "mod:other", rules: [{ id: "wrong", writes: [{ kind: "inventory", item: "q2:ammo_shells", fields: "count" }], offered: ["q1:ammo/shells"], take: () => "accepted" }] })).toThrow("another source");
    f.lease.close(); expect(f.lease.current()).toBe(false); expect(f.table.count(f.actor.id, "q2:ammo_shells")).toBe(19); expect(f.table.count(f.actor.id, "mod:weapon/plasma")).toBe(0);
  } finally { f.actors.close(); }
});
test("committed multi-item source publication keeps outer snapshots through nested writes without replay", () => {
  const f = fixture(), seen: number[] = [];
  try {
    f.table.operations.configure.register({ kind: "observe", provider: "mod:watch", id: "watch:stores", order: 0, observe: ([actor, entry]) => {
      seen.push(entry.count);
      if (entry.item === "q2:ammo_shells") f.table.configure(actor, { item: "mod:weapon/plasma", count: 0, capacity: 1 });
      return undefined;
    } });
    const before = f.entries(), after = before.map(entry => ({ ...entry, count: entry.item === "q2:ammo_shells" ? 8 : 1 })); f.store(after);
    f.lease.stored(after.map((entry, index) => { const previous = before[index]; if (previous === undefined) throw new Error("Missing source row"); return { before: previous, after: entry }; }));
    expect(seen).toEqual([8, 0, 1]); expect(f.table.count(f.actor.id, "mod:weapon/plasma")).toBe(0); expect(f.writes()).toBe(1);
    f.actors.release(f.actor); expect(() => f.lease.stored([])).toThrow("no longer current");
  } finally { f.actors.close(); }
});
test("invalid source receipts fail before any observer and retain committed bytes", () => {
  const f = fixture(); let observed = 0;
  try {
    f.table.operations.configure.register({ kind: "observe", provider: "mod:watch", id: "watch:stores", order: 0, observe: () => { observed++; return undefined; } });
    expect(() => f.lease.stored([{ before: { item: "q2:ammo_shells", count: 0, capacity: 50 }, after: { item: "q2:ammo_shells", count: 7, capacity: 50 } }])).toThrow("differs");
    expect(observed).toBe(0); expect(f.table.count(f.actor.id, "q2:ammo_shells")).toBe(6); expect(f.writes()).toBe(0);
  } finally { f.actors.close(); }
});

test("source item checkpoint retains authored held metadata and explicit absence", () => {
  for (const held of [{ kind: "none" }, { kind: "model", model: { path: "models/mod/held.md2", referenceFrame: 7,
    grip: { origin: { x: 1, y: 2, z: 3 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: { x: 2, y: 1, z: 1 } } } }] satisfies readonly HeldWeaponDeclaration[]) {
    const f = fixture(held);
    try {
      const saved = readSourceItems({ providers: [captureSourceItems(f.actors, f.table)], inventories: [{ actor: savedActorId(f.actor.id), entries: f.table.entries(f.actor.id) }] });
      const weapon = saved[0]?.groups[0]?.items.find(item => item.definition.item === "mod:weapon/plasma")?.definition;
      if (weapon?.kind !== "weapon") throw new Error("Missing saved original weapon definition");
      expect(weapon.held).toEqual(held); expect(weapon.source).toEqual({ provider: "mod:arsenal", content: "q1:classic:id1:installed" });
    } finally { f.lease.close(); f.actors.close(); }
  }
});

test("item actions keep their exact source lease and survive metadata checkpoint decoding", () => {
  const actors = new SessionActorRegistry(createIdentityOwner("source-item-actions")), actor = actors.allocate("q1:world", "q1:player"), table = new SharedInventoryTable(actors);
  table.create(actor, []); let calls = 0;
  const lease = table.bindItems(actor, { owner: "mod:equipment", items: [{ admission: "add", definition: {
    item: "mod:medkit", label: "Medkit", kind: "counter", actions: ["use"], source: { provider: "mod:equipment", content: "q3:classic:baseq3:installed" },
  } }], state: { read: () => [{ item: "mod:medkit", count: 1, capacity: 1 }], write: () => undefined }, invoke: () => { calls++; } });
  try {
    const invoke = table.itemAction(actor.id, "mod:medkit", "use"); expect(invoke).not.toBeNull(); invoke?.(); expect(calls).toBe(1);
    expect(table.itemAction(actor.id, "mod:medkit", "drop")).toBeNull();
    const saved = readSourceItems({ providers: [captureSourceItems(actors, table)], inventories: [{ actor: savedActorId(actor.id), entries: table.entries(actor.id) }] });
    expect(saved[0]?.groups[0]?.items[0]?.definition.actions).toEqual(["use"]);
    lease.close(); expect(() => invoke?.()).toThrow("retired inventory owner"); expect(calls).toBe(1);
  } finally { lease.close(); actors.close(); }
});

test("item names prefer canonical IDs and report all colliding source labels", () => {
  const rows = [{ item: "mod:first", label: "Medkit" }, { item: "mod:second", label: "Medkit" }] satisfies readonly { item: import("../../../src/contracts/gameplay.ts").ItemId; label: string }[];
  expect(sourceItemNamed(rows, "mod:second")).toEqual({ kind: "match", item: { item: "mod:second", label: "Medkit" }, exact: true });
  expect(sourceItemNamed(rows, "medkit")).toEqual({ kind: "ambiguous", items: rows });
  expect(sourceItemNamed(rows, "unknown")).toBeNull();
});

test("source item icons retain source ownership, authored type and explicit absence through save", () => {
  for (const declaration of [{ kind: "wad-picture", path: "gfx.wad", lump: "inv_cells" },
    { kind: "image", path: "pics/item.pcx" }, { kind: "shader", name: "icons/teleporter" }, null]) {
    const icon = declaration === null ? null : resolveItemIcon(readItemIconDeclaration(new SaveReader(declaration)), "q1:classic:id1:installed");
    const f = fixture(undefined, icon);
    try {
      const saved = readSourceItems({ providers: [captureSourceItems(f.actors, f.table)], inventories: [{ actor: savedActorId(f.actor.id), entries: f.table.entries(f.actor.id) }] });
      const item = saved[0]?.groups[0]?.items.find(value => value.definition.item === "mod:weapon/plasma")?.definition;
      expect(item?.icon).toEqual(icon);
      if (icon !== null) expect(() => readSourceItemIcon(new SaveReader(icon), "q3:classic:baseq3:installed")).toThrow("another content source");
    } finally { f.lease.close(); f.actors.close(); }
  }
  expect(() => readItemIconDeclaration(new SaveReader({ kind: "image", path: "../outside.pcx" }))).toThrow();
});

test("native item names retain the current canonical owner of the original descriptor", () => {
  const original = { item: "q2:item_quad", label: "Quad Damage", selected: false } satisfies { item: import("../../../src/contracts/gameplay.ts").ItemId; label: string; selected: boolean };
  const component = { item: "mod:quad", label: "Quad Damage", selected: true } satisfies { item: import("../../../src/contracts/gameplay.ts").ItemId; label: string; selected: boolean };
  expect(sourceItemNamed([original, component], "Quad Damage", original.item)).toEqual({ kind: "match", item: original, exact: false });
  const replacement = { ...original, label: "Replaced Quad", selected: true };
  expect(sourceItemNamed([replacement, component], "Quad Damage", original.item)).toEqual({ kind: "match", item: replacement, exact: false });
  expect(sourceItemNamed([replacement, component], component.item, original.item)).toEqual({ kind: "match", item: component, exact: true });
  expect(sourceItemNamed([original, component], "Quad Damage")).toEqual({ kind: "ambiguous", items: [original, component] });
});
