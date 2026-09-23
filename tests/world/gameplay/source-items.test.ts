import { expect, test } from "bun:test";
import type { InventoryEntry } from "../../../src/contracts/gameplay.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { SharedInventoryTable } from "../../../src/world/gameplay/inventory.ts";

function fixture() {
  const actors = new SessionActorRegistry(createIdentityOwner("source-items")), actor = actors.allocate("q2:world", "q2:player"), table = new SharedInventoryTable(actors);
  let primary: readonly InventoryEntry[] = [{ item: "q2:ammo_shells", count: 19, capacity: 100 }];
  table.bind(actor, { read: () => primary, write: entry => { primary = [entry]; return undefined; } });
  let entries: readonly InventoryEntry[] = [{ item: "q2:ammo_shells", count: 6, capacity: 50 }, { item: "mod:weapon/plasma", count: 1, capacity: 1 }], writes = 0;
  const lease = table.bindItems(actor, { owner: "mod:arsenal", items: [
    { admission: "replace-primary", definition: { item: "q2:ammo_shells", label: "Cells", kind: "counter", source: { provider: "mod:arsenal", content: "q1:classic:id1:installed" } } },
    { admission: "add", definition: { item: "mod:weapon/plasma", label: "Plasma", kind: "weapon", ammo: "q2:ammo_shells", source: { provider: "mod:arsenal", content: "q1:classic:id1:installed" } } },
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
