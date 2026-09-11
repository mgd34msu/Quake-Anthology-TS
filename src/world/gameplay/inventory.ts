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
      quantity(entry.count); quantity(entry.capacity);
      if (items.has(entry.item)) throw new RangeError(`Duplicate inventory item ${entry.item}`);
      items.set(entry.item, Object.freeze({ ...entry }));
    }
    return this.bind(actor, { read: () => [...items.values()], write: entry => { items.set(entry.item, Object.freeze({ ...entry })); return undefined; } });
  }

  entries(actor: ActorId): readonly InventoryEntry[] {
    const owner = this.actors.resolveOwned(actor);
    return owner === null ? [] : (this.stores.get(owner)?.read() ?? []).map(entry => Object.freeze({ ...entry }));
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
    binding.write(Object.freeze({ ...entry, count: entry.count - count }));
    return true;
  }

  give(actor: OwnedActor, item: ItemId, count: number): number {
    this.actors.assertOwned(actor); quantity(count);
    const binding = this.stores.get(actor);
    const entry = binding?.read().find(candidate => candidate.item === item);
    if (entry === undefined || binding === undefined) return 0;
    const given = Math.min(count, Math.max(0, entry.capacity - entry.count));
    if (given !== 0) binding.write(Object.freeze({ ...entry, count: entry.count + given }));
    return given;
  }

  /** Source pickups can change capacity or retain an over-cap count without a forced generic clamp. */
  configure(actor: OwnedActor, entry: InventoryEntry): undefined {
    this.actors.assertOwned(actor); quantity(entry.count); quantity(entry.capacity);
    const binding = this.stores.get(actor);
    if (binding === undefined) throw new Error("Actor has no inventory binding");
    return binding.write(Object.freeze({ ...entry }));
  }
}
