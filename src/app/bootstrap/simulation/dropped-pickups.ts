import type { ItemId } from "../../../contracts/gameplay.ts";
import type { ActorId, ProviderId } from "../../../contracts/identity.ts";
import { readSavedActor, savedActorId } from "../../../persistence/save-image.ts";
import { namespaced, type SaveReader } from "../../../persistence/value.ts";
import type { SessionActorRegistry } from "../../../world/actors/registry.ts";

export interface DroppedPickupCargo { readonly item: ItemId; readonly count: number; }
export interface DroppedPickupSlot extends DroppedPickupCargo { readonly slot: number; }
export type DroppedPickupLevels = ReadonlyMap<string, readonly DroppedPickupSlot[]>;

/** Item identity belongs to the actual source allocation, not its reusable pickup alias. */
export class SourcePickupCargo {
  private readonly current = new Map<ActorId, DroppedPickupCargo>();
  private levels = new Map<string, readonly DroppedPickupSlot[]>();
  constructor(private readonly actors: SessionActorRegistry, private readonly provider: ProviderId) {
    actors.onRelease(actor => { this.current.delete(actor.id); return undefined; });
  }

  get(actor: ActorId): DroppedPickupCargo | undefined { return this.current.get(actor); }
  set(actor: ActorId, cargo: DroppedPickupCargo): void {
    if (!this.actors.isLive(actor) || !Number.isSafeInteger(cargo.count) || cargo.count <= 0) throw new Error("Invalid original dropped pickup cargo");
    this.current.set(actor, { item: cargo.item, count: cargo.count });
  }
  delete(actor: ActorId): void { this.current.delete(actor); }

  travel(map: string, newUnit: boolean): DroppedPickupLevels {
    const levels = newUnit ? new Map<string, readonly DroppedPickupSlot[]>() : new Map(this.levels);
    if (!newUnit) levels.set(map, [...this.current].map(([actor, cargo]) => {
      const source = this.actors.sourceOf(actor);
      if (source === null || source.provider !== this.provider) throw new Error("Dropped pickup has no original level allocation");
      return { slot: source.slot, ...cargo };
    }));
    return levels;
  }

  revisit(levels: DroppedPickupLevels, map: string): void {
    this.levels = new Map(levels);
    for (const entry of levels.get(map) ?? []) {
      const actor = this.actors.atSource(this.provider, entry.slot);
      if (actor === null) throw new Error("Retained dropped pickup has no restored source allocation");
      this.set(actor.id, entry);
    }
  }

  capture() {
    return { current: [...this.current].map(([actor, cargo]) => ({ actor: savedActorId(actor), ...cargo })),
      levels: [...this.levels].map(([map, items]) => ({ map, items })) };
  }

  restore(reader: SaveReader): void {
    this.current.clear(); this.levels.clear();
    if (reader.value === undefined) return;
    const cargo = (value: SaveReader): DroppedPickupCargo => ({ item: namespaced(value.field("item")), count: value.field("count").integer(1) });
    for (const value of reader.field("current").list(value => value)) {
      const actor = this.actors.resolveSaved(readSavedActor(value.field("actor")));
      if (actor === null || this.current.has(actor.id)) return value.fail("Missing or duplicate dropped pickup actor");
      this.set(actor.id, cargo(value));
    }
    for (const value of reader.field("levels").list(value => value)) {
      const map = value.field("map").string(), items = value.field("items").list(value => ({ slot: value.field("slot").integer(0), ...cargo(value) }));
      if (this.levels.has(map) || new Set(items.map(item => item.slot)).size !== items.length) value.fail("Duplicate dropped pickup level or source slot");
      this.levels.set(map, items);
    }
  }
}
