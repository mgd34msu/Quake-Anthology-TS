import type { InventoryEntry, InventoryTable, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";

export interface InventoryStateBinding {
  read(): readonly InventoryEntry[];
  write(entry: InventoryEntry): undefined;
}

function quantity(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Inventory quantity must be finite and nonnegative");
  return value;
}

function sourceCount(entry: InventoryEntry, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Inventory counter must be finite");
  if (entry.countPolicy?.kind !== "source-counter") return quantity(value);
  switch (entry.countPolicy.arithmetic) {
    case "binary32": {
      const rounded = Math.fround(value);
      if (!Number.isFinite(rounded)) throw new RangeError("Inventory counter exceeds binary32 range");
      return rounded;
    }
    case "binary64": return value;
    case "int32": return value | 0;
  }
}
function copyEntry(entry: InventoryEntry): InventoryEntry {
  quantity(entry.capacity);
  return Object.freeze({ ...entry, count: sourceCount(entry, entry.count), ...(entry.countPolicy === undefined ? {} : { countPolicy: Object.freeze({ ...entry.countPolicy }) }) });
}

/** Capacity and item selection belong to the chosen inventory provider. Counts have one write path. */
export class SharedInventoryTable implements InventoryTable {
  private readonly stores = new Map<OwnedActor, InventoryStateBinding>();

  constructor(private readonly actors: SessionActorRegistry) {
    actors.onRelease(actor => { this.stores.delete(actor); return undefined; });
  }

  bind(actor: OwnedActor, binding: InventoryStateBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.stores.has(actor)) throw new Error("Actor already has an inventory binding");
    this.stores.set(actor, binding);
    return undefined;
  }

  create(actor: OwnedActor, entries: readonly InventoryEntry[]): undefined {
    const items = new Map<ItemId, InventoryEntry>();
    for (const entry of entries) {
      if (items.has(entry.item)) throw new RangeError(`Duplicate inventory item ${entry.item}`);
      items.set(entry.item, copyEntry(entry));
    }
    return this.bind(actor, { read: () => [...items.values()], write: entry => { items.set(entry.item, copyEntry(entry)); return undefined; } });
  }

  entries(actor: ActorId): readonly InventoryEntry[] {
    const owner = this.actors.resolveOwned(actor);
    return owner === null ? [] : (this.stores.get(owner)?.read() ?? []).map(copyEntry);
  }

  has(actor: ActorId): boolean {
    const owner = this.actors.resolveOwned(actor);
    return owner !== null && this.stores.has(owner);
  }

  count(actor: ActorId, item: ItemId): number { return this.entries(actor).find(entry => entry.item === item)?.count ?? 0; }

  consume(actor: OwnedActor, item: ItemId, count: number): boolean {
    this.actors.assertOwned(actor); quantity(count);
    const binding = this.stores.get(actor);
    const entry = binding?.read().find(candidate => candidate.item === item);
    if (entry === undefined || binding === undefined) return count === 0;
    if (entry.count < count) return false;
    binding.write(copyEntry({ ...entry, count: entry.count - sourceCount(entry, count) }));
    return true;
  }

  give(actor: OwnedActor, item: ItemId, count: number): number {
    this.actors.assertOwned(actor); quantity(count);
    const binding = this.stores.get(actor);
    const entry = binding?.read().find(candidate => candidate.item === item);
    if (entry === undefined || binding === undefined) return 0;
    const given = Math.min(count, Math.max(0, entry.capacity - entry.count));
    if (given === 0) return 0;
    const next = copyEntry({ ...entry, count: entry.count + sourceCount(entry, given) });
    binding.write(next);
    return next.count - entry.count;
  }

  /** Source pickups can change capacity or retain an over-cap count without a forced generic clamp. */
  configure(actor: OwnedActor, entry: InventoryEntry): undefined {
    this.actors.assertOwned(actor);
    const binding = this.stores.get(actor);
    if (binding === undefined) throw new Error("Actor has no inventory binding");
    const policy = entry.countPolicy ?? binding.read().find(candidate => candidate.item === entry.item)?.countPolicy;
    return binding.write(copyEntry(policy === undefined ? entry : { ...entry, countPolicy: policy }));
  }

  /** Fixed source bursts may decrement past zero; ordinary stack consumption keeps its availability check. */
  adjustSourceCounter(actor: OwnedActor, item: ItemId, delta: number): number {
    this.actors.assertOwned(actor);
    const binding = this.stores.get(actor), entry = binding?.read().find(candidate => candidate.item === item);
    if (binding === undefined || entry === undefined || entry.countPolicy?.kind !== "source-counter") throw new Error("Item is not a signed source counter");
    const next = copyEntry({ ...entry, count: sourceCount(entry, entry.count) + sourceCount(entry, delta) });
    binding.write(next);
    return next.count;
  }
}
