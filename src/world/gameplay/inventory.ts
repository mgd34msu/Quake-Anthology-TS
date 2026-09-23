import type { InventoryEntry, InventoryTable, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { OriginalPickupOffer, OriginalPickupResolution, OriginalPickupRule } from "../../contracts/original-pickups.ts";
import type { SessionActorRegistry } from "../actors/registry.ts";
import { ModOperation } from "./mod-composition.ts";
import { captureOriginalPickupRules, type CapturedOriginalPickupRule } from "./original-pickups.ts";

export interface InventoryStateBinding {
  read(): readonly InventoryEntry[];
  write(entry: InventoryEntry): undefined;
  /** Explicit owner support, including its source consumers and saved continuation. */
  mutableCapacity?(item: ItemId): boolean;
}
export interface InventoryCommittedChange {
  readonly actor: OwnedActor;
  readonly before: InventoryEntry | null;
  readonly after: InventoryEntry;
}
export interface InventoryPickupBinding {
  readonly owner: ProviderId;
  readonly rules: readonly OriginalPickupRule[];
}
interface BoundInventoryPickups { readonly owner: ProviderId; readonly rules: readonly CapturedOriginalPickupRule[]; readonly items: readonly ItemId[]; }
interface InventoryStore {
  readonly binding: InventoryStateBinding;
  readonly pickups: Map<ItemId, BoundInventoryPickups>;
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

export type InventoryGiveTransition =
  | { readonly kind: "unchanged"; readonly given: 0 }
  | { readonly kind: "write"; readonly entry: InventoryEntry; readonly given: number };

/** Preserve source rounding and writes even when the resulting count delta is zero. */
export function inventoryGive(entry: InventoryEntry, count: number): InventoryGiveTransition {
  quantity(count);
  const given = Math.min(count, Math.max(0, entry.capacity - entry.count));
  if (given === 0) return { kind: "unchanged", given: 0 };
  const next = copyEntry({ ...entry, count: entry.count + sourceCount(entry, given) });
  return { kind: "write", entry: next, given: next.count - entry.count };
}

/** Capacity and item selection belong to the chosen inventory provider. Counts have one write path. */
export class SharedInventoryTable implements InventoryTable {
  readonly operations = {
    give: new ModOperation<Readonly<Parameters<InventoryTable["give"]>>, ReturnType<InventoryTable["give"]>>("inventory.give"),
    consume: new ModOperation<Readonly<Parameters<InventoryTable["consume"]>>, ReturnType<InventoryTable["consume"]>>("inventory.consume"),
    configure: new ModOperation<readonly [actor: OwnedActor, entry: InventoryEntry], undefined>("inventory.configure"),
    adjustSourceCounter: new ModOperation<readonly [actor: OwnedActor, item: ItemId, delta: number], number>("inventory.adjust-source-counter"),
  };
  private readonly stores = new Map<OwnedActor, InventoryStore>();

  constructor(private readonly actors: SessionActorRegistry) {
    actors.onRelease(actor => { this.stores.delete(actor); return undefined; });
  }

  bind(actor: OwnedActor, binding: InventoryStateBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.stores.has(actor)) throw new Error("Actor already has an inventory binding");
    this.stores.set(actor, { binding, pickups: new Map<ItemId, BoundInventoryPickups>() });
    return undefined;
  }

  /** Delegate grant behavior only; the selected storage binding still owns the admitted item. */
  bindPickup(actor: OwnedActor, requested: InventoryPickupBinding): () => undefined {
    this.actors.assertOwned(actor);
    const store = this.stores.get(actor);
    const rules = captureOriginalPickupRules(requested.rules);
    const writes = rules.flatMap(rule => rule.writes.filter(write => write.kind === "inventory"));
    const items = [...new Set(writes.map(write => write.item))];
    if (items.length === 0) throw new Error("Original inventory pickup delegate has no inventory writes");
    for (const write of writes) {
      if (store === undefined || !store.binding.read().some(entry => entry.item === write.item))
        throw new Error(`Original pickup destination ${write.item} was not admitted`);
      if (store.pickups.has(write.item)) throw new Error(`Original pickup destination ${write.item} already has a grant owner`);
      if (write.fields !== "count" && store.binding.mutableCapacity?.(write.item) !== true)
        throw new Error(`Original pickup destination ${write.item} has no mutable capacity`);
    }
    if (store === undefined) throw new Error("Original pickup inventory was not admitted");
    const binding = Object.freeze({ owner: requested.owner, rules, items: Object.freeze(items) });
    for (const existing of store.pickups.values()) for (const rule of existing.rules) for (const offered of rule.offered)
      if (binding.rules.some(candidate => candidate.offered.includes(offered))) throw new Error(`Ambiguous original inventory pickup for ${offered}`);
    for (const item of items) store.pickups.set(item, binding);
    return () => {
      if (this.stores.get(actor) === store) for (const item of items) if (store.pickups.get(item) === binding) store.pickups.delete(item);
      return undefined;
    };
  }

  resolvePickup(actor: OwnedActor, offer: OriginalPickupOffer): OriginalPickupResolution {
    this.actors.assertOwned(actor);
    const store = this.stores.get(actor);
    if (store === undefined) return { matches: [], blocksPrimary: false };
    const matches = [...new Set(store.pickups.values())].flatMap(binding => binding.rules.filter(rule => rule.offered.includes(offer.item))
      .flatMap(rule => rule.writes.filter(write => write.kind === "inventory").map(write => ({ owner: binding.owner, operation: rule.operation,
        captured: rule, write, current: () => this.actors.resolveOwned(actor.id) === actor && this.stores.get(actor) === store
          && binding.items.every(item => store.pickups.get(item) === binding && store.binding.read().some(entry => entry.item === item))
          && (write.fields === "count" || store.binding.mutableCapacity?.(write.item) === true) }))));
    return { matches, blocksPrimary: false };
  }

  create(actor: OwnedActor, entries: readonly InventoryEntry[]): undefined {
    const items = new Map<ItemId, InventoryEntry>();
    for (const entry of entries) {
      if (items.has(entry.item)) throw new RangeError(`Duplicate inventory item ${entry.item}`);
      items.set(entry.item, copyEntry(entry));
    }
    return this.bind(actor, { read: () => [...items.values()], write: entry => { items.set(entry.item, copyEntry(entry)); return undefined; }, mutableCapacity: () => true });
  }

  entries(actor: ActorId): readonly InventoryEntry[] {
    const owner = this.actors.resolveOwned(actor);
    return owner === null ? [] : (this.stores.get(owner)?.binding.read() ?? []).map(copyEntry);
  }

  has(actor: ActorId): boolean {
    const owner = this.actors.resolveOwned(actor);
    return owner !== null && this.stores.has(owner);
  }

  mutableCapacity(actor: ActorId, item: ItemId): boolean {
    const owner = this.actors.resolveOwned(actor), binding = owner === null ? undefined : this.stores.get(owner)?.binding;
    return binding?.read().some(entry => entry.item === item) === true && binding.mutableCapacity?.(item) === true;
  }

  count(actor: ActorId, item: ItemId): number {
    const owner = this.actors.resolveOwned(actor);
    if (owner === null) return 0;
    let result = 0, found = false;
    for (const entry of this.stores.get(owner)?.binding.read() ?? []) {
      quantity(entry.capacity);
      const count = sourceCount(entry, entry.count);
      if (!found && entry.item === item) { result = count; found = true; }
    }
    return result;
  }

  consume(actor: OwnedActor, item: ItemId, count: number): boolean {
    if (this.operations.consume.active) this.actors.assertOwned(actor);
    return this.operations.consume.active ? this.operations.consume.dispatch([actor, item, count], args => this.consumeCanonical(...args)) : this.consumeCanonical(actor, item, count);
  }

  private consumeCanonical(actor: OwnedActor, item: ItemId, count: number): boolean {
    this.actors.assertOwned(actor); quantity(count);
    const binding = this.stores.get(actor)?.binding;
    const entry = binding?.read().find(candidate => candidate.item === item);
    if (entry === undefined || binding === undefined) return count === 0;
    if (entry.count < count) return false;
    binding.write(copyEntry({ ...entry, count: entry.count - sourceCount(entry, count) }));
    return true;
  }

  give(actor: OwnedActor, item: ItemId, count: number): number {
    if (this.operations.give.active) this.actors.assertOwned(actor);
    return this.operations.give.active ? this.operations.give.dispatch([actor, item, count], args => this.giveCanonical(...args)) : this.giveCanonical(actor, item, count);
  }

  private giveCanonical(actor: OwnedActor, item: ItemId, count: number): number {
    this.actors.assertOwned(actor); quantity(count);
    const binding = this.stores.get(actor)?.binding;
    const entry = binding?.read().find(candidate => candidate.item === item);
    if (entry === undefined || binding === undefined) return 0;
    const transition = inventoryGive(entry, count);
    if (transition.kind === "unchanged") return 0;
    binding.write(transition.entry);
    return transition.given;
  }

  /** Source pickups can change capacity or retain an over-cap count without a forced generic clamp. */
  configure(actor: OwnedActor, entry: InventoryEntry, committed?: (change: InventoryCommittedChange) => undefined): undefined {
    if (this.operations.configure.active) this.actors.assertOwned(actor);
    if (committed === undefined) return this.operations.configure.active
      ? this.operations.configure.dispatch([actor, entry], args => this.configureCanonical(...args)) : this.configureCanonical(actor, entry);
    let stored = false;
    return this.operations.configure.dispatch([actor, entry], ([owner, value]) => {
      if (owner !== actor || value.item !== entry.item) throw new Error("Observed inventory store changed actor or item");
      return this.configureCanonical(owner, value, change => { committed(change); stored = true; return undefined; });
    }, () => { if (!stored) throw new Error("Observed source inventory requires its canonical store before observers"); });
  }

  private configureCanonical(actor: OwnedActor, entry: InventoryEntry, committed?: (change: InventoryCommittedChange) => undefined): undefined {
    this.actors.assertOwned(actor);
    const binding = this.stores.get(actor)?.binding;
    if (binding === undefined) throw new Error("Actor has no inventory binding");
    const previous = binding.read().find(candidate => candidate.item === entry.item);
    const before = committed === undefined || previous === undefined ? null : copyEntry(previous), policy = entry.countPolicy ?? previous?.countPolicy;
    binding.write(copyEntry(policy === undefined ? entry : { ...entry, countPolicy: policy }));
    if (committed !== undefined) {
      this.actors.assertOwned(actor);
      if (this.stores.get(actor)?.binding !== binding) throw new Error("Inventory owner changed during observed store");
      const after = binding.read().find(candidate => candidate.item === entry.item);
      if (after === undefined) throw new Error("Observed inventory entry disappeared during its store");
      committed({ actor, before, after: copyEntry(after) });
    }
    return undefined;
  }

  /** Fixed source bursts may decrement past zero; ordinary stack consumption keeps its availability check. */
  adjustSourceCounter(actor: OwnedActor, item: ItemId, delta: number): number {
    if (this.operations.adjustSourceCounter.active) this.actors.assertOwned(actor);
    return this.operations.adjustSourceCounter.active ? this.operations.adjustSourceCounter.dispatch([actor, item, delta], args => this.adjustSourceCounterCanonical(...args)) : this.adjustSourceCounterCanonical(actor, item, delta);
  }

  private adjustSourceCounterCanonical(actor: OwnedActor, item: ItemId, delta: number): number {
    this.actors.assertOwned(actor);
    const binding = this.stores.get(actor)?.binding, entry = binding?.read().find(candidate => candidate.item === item);
    if (binding === undefined || entry === undefined || entry.countPolicy?.kind !== "source-counter") throw new Error("Item is not a signed source counter");
    const next = copyEntry({ ...entry, count: sourceCount(entry, entry.count) + sourceCount(entry, delta) });
    binding.write(next);
    return next.count;
  }
}
