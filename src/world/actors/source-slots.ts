// Source allocation order from Quake pr_edict.c, Quake II g_utils.c, Quake III g_utils.c.
import type { OwnedActor, ProviderId } from "../../contracts/identity.ts";
import type { SourceTime } from "../../contracts/time.ts";
import type { ActorLifetimePolicy } from "../../contracts/world.ts";
import type { SessionActorRegistry } from "./registry.ts";

export interface SourceSlotState { readonly free: boolean; readonly freedAt: SourceTime; }

/** These methods access source-owned fields directly, including guest bytes when applicable. */
export interface SourceSlotStorage {
  count(): number;
  setCount(count: number): undefined;
  read(slot: number): SourceSlotState;
  initialize(slot: number, actor: OwnedActor): undefined;
  clearFreed(slot: number, now: SourceTime): undefined;
  /** Q2 reserved corpse/client slots and Q3 neverFree entities return false after unlinking. */
  canFree(slot: number): boolean;
}

export interface SourceActorSlotsOptions {
  readonly provider: ProviderId;
  readonly capacity: number;
  readonly lifetime: ActorLifetimePolicy;
  readonly storage: SourceSlotStorage;
  readonly now: () => SourceTime;
  readonly unlink: (actor: OwnedActor) => undefined;
  readonly exhausted: (slot: number) => undefined;
}

export function quakeEdictLifetime(firstDynamicSlot: number, exhaustion: "fatal" | "qw-last-slot" = "fatal"): ActorLifetimePolicy {
  return { firstDynamicSlot, reuse: "source-cooldown", clear: "source-edict", exhaustion,
    reusableAfter(freedAt, now) {
      if (freedAt.kind !== "seconds" || now.kind !== "seconds") throw new RangeError("Q1/Q2 classic edict lifetime uses seconds");
      return freedAt.value < 2 || now.value - freedAt.value > 0.5;
    } };
}

export function q3EntityLifetime(firstDynamicSlot: number, mapStartMilliseconds: number): ActorLifetimePolicy {
  return { firstDynamicSlot, reuse: "source-cooldown", clear: "source-gentity", exhaustion: "fatal",
    reusableAfter(freedAt, now) {
      if (freedAt.kind !== "milliseconds" || now.kind !== "milliseconds") throw new RangeError("Q3 entity lifetime uses milliseconds");
      return !(freedAt.value > ((mapStartMilliseconds + 2000) | 0) && ((now.value - freedAt.value) | 0) < 1000);
    } };
}

/** Raw pointers use atSource on each access. Only built-in host references carry generations. */
export class SourceActorSlots {
  constructor(private readonly actors: SessionActorRegistry, readonly options: SourceActorSlotsOptions) {
    const first = options.lifetime.firstDynamicSlot;
    if (!Number.isSafeInteger(first) || first < 0 || !Number.isSafeInteger(options.capacity) || options.capacity <= first) throw new RangeError("Invalid source actor slot range");
    this.count();
  }

  at(slot: number): OwnedActor | null { return this.actors.atSource(this.options.provider, slot); }

  /** Map/world/client slots initialized by the source host already own their original record contents. */
  bindExisting(slot: number, definition: `${string}:${string}`): OwnedActor {
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.count()) throw new RangeError("Source slot is outside the opened table");
    const existing = this.at(slot);
    return existing ?? this.actors.allocateAtSource(this.options.provider, slot, definition);
  }

  allocate(definition: `${string}:${string}`): OwnedActor {
    const { lifetime, storage, provider, capacity } = this.options;
    const now = this.options.now();
    const count = this.count();
    let selected = count;
    for (let slot = lifetime.firstDynamicSlot; slot < count; slot++) {
      const state = storage.read(slot);
      if (state.free && (lifetime.reuse === "immediate" || lifetime.reusableAfter(state.freedAt, now))) { selected = slot; break; }
    }
    if (selected === capacity) {
      this.options.exhausted(selected);
      if (lifetime.exhaustion === "fatal") throw new RangeError(`${provider}: no free source actors`);
      selected--;
      // QW deliberately unlinks and overwrites the final edict when its table is full.
      const previous = this.at(selected);
      if (previous !== null) { this.options.unlink(previous); this.actors.release(previous); }
    } else if (selected === count) storage.setCount(count + 1);
    const previous = this.at(selected);
    if (previous !== null) this.actors.release(previous);
    const actor = this.actors.allocateAtSource(provider, selected, definition);
    storage.initialize(selected, actor);
    return actor;
  }

  free(actor: OwnedActor): boolean {
    this.actors.assertOwned(actor);
    const source = this.actors.sourceOf(actor.id);
    if (source === null || source.provider !== this.options.provider) throw new RangeError("Actor is outside this source table");
    this.options.unlink(actor);
    if (!this.options.storage.canFree(source.slot)) return false;
    this.options.storage.clearFreed(source.slot, this.options.now());
    this.actors.release(actor);
    return true;
  }

  private count(): number {
    const count = this.options.storage.count();
    if (!Number.isSafeInteger(count) || count < this.options.lifetime.firstDynamicSlot || count > this.options.capacity) throw new RangeError("Invalid source actor high-water count");
    return count;
  }
}
