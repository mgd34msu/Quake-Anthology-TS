import type { InventoryEntry, ItemId } from "../../../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { PickupSupplyProfile } from "../../../../contracts/pickups.ts";
import type { SessionActorRegistry } from "../../../../world/actors/index.ts";
import type { SharedInventoryTable } from "../../../../world/gameplay/inventory.ts";
import { Q3_WEAPON_ITEMS } from "../../../../content/q3/foundation/arsenal.ts";
import { q3AmmoRegenerationRule, type Q3MappedAmmoTimer } from "../../../../content/q3/team-arena/client-effects.ts";
import { readSavedActor, savedActorId } from "../../../../persistence/save-image.ts";
import { namespaced, type SaveReader } from "../../../../persistence/value.ts";

interface PoolTimer extends Q3MappedAmmoTimer { readonly item: ItemId; readonly source: ItemId; }

/** Independent destination counters driven by the actual primary Team Arena timer call. */
export class Q3MappedAmmoRegeneration {
  private readonly bindings: readonly { readonly item: ItemId; readonly source: ItemId; readonly rule: Q3MappedAmmoTimer["rule"] }[];
  private readonly entries = new Map<OwnedActor, readonly PoolTimer[]>();
  private readonly unobserve: () => undefined;
  private closed = false;

  constructor(readonly profile: PickupSupplyProfile, private readonly actors: SessionActorRegistry, private readonly inventory: SharedInventoryTable,
    private readonly legacyOwners: NonNullable<PickupSupplyProfile["ammoOwners"]>) {
    const items = new Set<ItemId>();
    this.bindings = (profile.ammoOwners ?? []).map(owner => {
      if (items.has(owner.item)) throw new Error("Periodic ammo pool has multiple owners");
      items.add(owner.item);
      const source = Q3_WEAPON_ITEMS.find(weapon => weapon.ammo === owner.source);
      if (source === undefined) throw new Error("Periodic ammo rule requires original source ammunition");
      return { ...owner, rule: q3AmmoRegenerationRule(source.weapon) };
    });
    this.unobserve = actors.onRelease(actor => { this.entries.delete(actor); return undefined; });
  }

  timers(actor: OwnedActor): readonly Q3MappedAmmoTimer[] { return this.require(actor); }

  stored(actor: ActorId, weapon: number, value: number): void {
    const owner = this.actors.resolveOwned(actor), timers = owner === null ? undefined : this.entries.get(owner);
    if (timers !== undefined) for (const timer of timers) if (timer.rule.weapon === weapon) timer.elapsedMilliseconds = value;
  }

  private require(actor: OwnedActor): readonly PoolTimer[] {
    if (this.closed) throw new Error("Mapped ammo timer owner is closed");
    this.actors.assertOwned(actor);
    const retained = this.entries.get(actor); if (retained !== undefined) return retained;
    const current = () => !this.closed && this.actors.isLive(actor.id) && this.entries.get(actor) === timers;
    const read = (item: ItemId): InventoryEntry => {
      if (!current()) throw new Error("Mapped ammo timer actor is retired");
      const entry = this.inventory.entries(actor.id).find(entry => entry.item === item);
      if (entry === undefined) throw new Error("Mapped ammo pool is not admitted by the selected inventory");
      return entry;
    };
    const thisInventory = this.inventory;
    const timers: readonly PoolTimer[] = this.bindings.map(binding => ({ ...binding, elapsedMilliseconds: 0, current,
      get count() { return read(binding.item).count; },
      set count(count: number) { thisInventory.configure(actor, { ...read(binding.item), count }); },
    }));
    this.entries.set(actor, timers);
    try { for (const timer of timers) read(timer.item); }
    catch (error) { this.entries.delete(actor); throw error; }
    return timers;
  }

  capture(actors: readonly OwnedActor[]) {
    return { profile: this.profile.id, actors: actors.map(actor => ({ actor: savedActorId(actor.id),
      timers: this.require(actor).map(timer => ({ item: timer.item, source: timer.source, elapsedMilliseconds: timer.elapsedMilliseconds })) })) };
  }

  restore(reader: SaveReader, actors: readonly OwnedActor[], legacy: (actor: ActorId, weapon: number) => number): void {
    if (reader.value === undefined) {
      for (const actor of actors) for (const timer of this.require(actor)) {
        const previous = this.legacyOwners.some(owner => owner.item === timer.item && owner.source === timer.source);
        timer.elapsedMilliseconds = previous ? this.elapsed(reader, timer, legacy(actor.id, timer.rule.weapon)) : 0;
      }
      return;
    }
    if (reader.value === null || namespaced(reader.field("profile")) !== this.profile.id) reader.fail("Mapped ammo profile differs from selected supply");
    const remaining = new Set(actors);
    reader.field("actors").list(saved => {
      const actor = this.actors.resolveSaved(readSavedActor(saved.field("actor")));
      if (actor === null || !remaining.delete(actor)) return saved.fail("Mapped ammo actor is missing or duplicated");
      const timers = this.require(actor), unused = new Set(timers);
      saved.field("timers").list(value => {
        const item = namespaced(value.field("item")), source = namespaced(value.field("source"));
        const timer = timers.find(timer => timer.item === item && timer.source === source);
        if (timer === undefined || !unused.delete(timer)) return value.fail("Mapped ammo pool or original rule differs from selected supply");
        timer.elapsedMilliseconds = this.elapsed(value, timer, value.field("elapsedMilliseconds").integer(0));
        return undefined;
      });
      if (unused.size !== 0) saved.fail("Saved mapped ammo pool is missing");
      return undefined;
    });
    if (remaining.size !== 0) reader.fail("Saved mapped ammo actor is missing");
  }

  private elapsed(reader: SaveReader, timer: PoolTimer, value: number): number {
    if (!Number.isInteger(value) || value < 0 || value >= timer.rule.time) return reader.fail("Invalid original ammo regeneration counter");
    return value;
  }

  close(): void { if (!this.closed) { this.closed = true; this.unobserve(); this.entries.clear(); } }
}
