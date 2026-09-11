import { sameActor } from "../../contracts/identity.ts";
import type { ActorId, IdentityOwner, OwnedActor, ProviderId, SessionId } from "../../contracts/identity.ts";
import type { ActorObservation, ActorRegistry } from "../../contracts/world.ts";
import type { ActorSlotCheckpoint, SavedActorId } from "../../contracts/session.ts";

export interface SourceActorCheckpoint {
  readonly provider: ProviderId;
  readonly sourceSlot: number;
  readonly actor: SavedActorId;
}

interface Slot {
  generation: number;
  actor: OwnedActor | null;
  definition: `${string}:${string}`;
  source: { readonly provider: ProviderId; readonly slot: number } | null;
}

// Level registries come and go while seats and clients retain the same session identity.
const sessionGenerations = new WeakMap<SessionId, Map<number, number>>();

/** Host generations invalidate observations; a source slot deliberately resolves its current occupant. */
export class SessionActorRegistry implements ActorRegistry {
  readonly session: SessionId;
  private readonly slots: Slot[] = [];
  private readonly sourceSlots = new Map<ProviderId, Map<number, OwnedActor>>();
  private readonly releases = new Set<(actor: OwnedActor) => undefined>();
  private readonly generations: Map<number, number>;
  private readonly restoredActors = new Map<number, { readonly savedGeneration: number; readonly actor: OwnedActor }>();
  private readonly restoredHistory: { readonly checkpoint: ActorSlotCheckpoint; readonly generationBase: number }[] = [];
  private readonly savedReferences = new Map<string, ActorId>();
  private closed = false;

  constructor(private readonly identities: IdentityOwner, readonly capacity = 65536) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError("Actor capacity must be a positive safe integer");
    this.session = identities.session;
    let generations = sessionGenerations.get(this.session);
    if (generations === undefined) { generations = new Map<number, number>(); sessionGenerations.set(this.session, generations); }
    this.generations = generations;
  }

  allocate(owner: ProviderId, definition: `${string}:${string}`): OwnedActor {
    if (this.closed) throw new Error("Actor registry is closed");
    let index = this.slots.findIndex(slot => slot.actor === null);
    if (index < 0) {
      index = this.slots.length;
      if (index >= this.capacity) throw new RangeError("Actor registry is full");
      this.slots.push({ generation: 0, actor: null, definition, source: null });
    }
    const slot = this.slots[index];
    if (slot === undefined) throw new Error("Actor allocation lost its slot");
    slot.generation = this.reserveGeneration(index, slot.generation);
    const actor = this.identities.ownedActor(this.identities.actor(index, slot.generation), owner);
    slot.actor = actor;
    slot.definition = definition;
    return actor;
  }

  allocateAtSource(owner: ProviderId, sourceSlot: number, definition: `${string}:${string}`): OwnedActor {
    if (!Number.isSafeInteger(sourceSlot) || sourceSlot < 0) throw new RangeError("Source slot must be a nonnegative safe integer");
    let table = this.sourceSlots.get(owner);
    if (table === undefined) { table = new Map<number, OwnedActor>(); this.sourceSlots.set(owner, table); }
    if (table.has(sourceSlot)) throw new RangeError(`Source slot ${owner}/${sourceSlot} is occupied`);
    const actor = this.allocate(owner, definition);
    this.requireSlot(actor).source = { provider: owner, slot: sourceSlot };
    table.set(sourceSlot, actor);
    return actor;
  }

  atSource(owner: ProviderId, slot: number): OwnedActor | null { return this.sourceSlots.get(owner)?.get(slot) ?? null; }

  sourceOf(actor: ActorId): { readonly provider: ProviderId; readonly slot: number } | null {
    if (!this.isLive(actor)) return null;
    const source = this.slots[actor.slot]?.source;
    return source === undefined || source === null ? null : Object.freeze({ ...source });
  }

  release(actor: OwnedActor): undefined {
    const slot = this.requireSlot(actor);
    const source = slot.source;
    // Reentrant callbacks may allocate this slot. Invalidate the old generation before notifying tables.
    slot.actor = null;
    slot.source = null;
    slot.generation++;
    this.restoredActors.delete(actor.id.slot);
    if (source !== null) this.sourceSlots.get(source.provider)?.delete(source.slot);
    const errors: unknown[] = [];
    for (const callback of [...this.releases]) {
      try { callback(actor); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Actor release callbacks failed");
    return undefined;
  }

  isLive(actor: ActorId): boolean {
    if (!this.identities.owns(actor)) return false;
    const current = this.slots[actor.slot]?.actor;
    return current !== undefined && current !== null && sameActor(current.id, actor);
  }

  observe(actor: ActorId): ActorObservation | null {
    if (!this.isLive(actor)) return null;
    const slot = this.slots[actor.slot];
    if (slot === undefined || slot.actor === null) return null;
    return Object.freeze({ id: slot.actor.id, owner: slot.actor.owner, definition: slot.definition });
  }

  resolveOwned(actor: ActorId): OwnedActor | null {
    return this.isLive(actor) ? this.slots[actor.slot]?.actor ?? null : null;
  }

  ownedBy(owner: ProviderId): readonly OwnedActor[] {
    return this.slots.flatMap(slot => slot.actor !== null && slot.actor.owner === owner ? [slot.actor] : []);
  }

  observations(): readonly ActorObservation[] {
    return this.slots.flatMap(slot => slot.actor === null ? [] : [Object.freeze({ id: slot.actor.id, owner: slot.actor.owner, definition: slot.definition })]);
  }

  checkpoint(): readonly ActorSlotCheckpoint[] {
    let length = this.slots.length;
    for (const index of this.generations.keys()) length = Math.max(length, index + 1);
    return Array.from({ length }, (_, index): ActorSlotCheckpoint => {
      const slot = this.slots[index];
      return slot === undefined || slot.actor === null
        ? { slot: index, generation: Math.max(slot?.generation ?? 0, this.generations.get(index) ?? 0), lifetime: { kind: "free", freedAt: null } }
        : { slot: index, generation: slot.generation, lifetime: { kind: "active", owner: slot.actor.owner, definition: slot.definition } };
    });
  }

  sourceCheckpoint(): readonly SourceActorCheckpoint[] {
    return this.slots.flatMap(slot => slot.actor === null || slot.source === null ? [] : [{ provider: slot.source.provider,
      sourceSlot: slot.source.slot, actor: { slot: slot.actor.id.slot, generation: slot.actor.id.generation } }]);
  }

  resolveSaved(saved: SavedActorId): OwnedActor | null {
    const restored = this.restoredActors.get(saved.slot);
    if (restored !== undefined) return restored.savedGeneration === saved.generation && this.isLive(restored.actor.id) ? restored.actor : null;
    const actor = this.slots[saved.slot]?.actor;
    return actor !== undefined && actor !== null && actor.id.generation === saved.generation ? actor : null;
  }

  /** Restores provenance pointing to a released lifetime without granting actor authority. */
  referenceSaved(saved: SavedActorId): ActorId {
    const key = `${saved.slot}/${saved.generation}`;
    const existing = this.savedReferences.get(key);
    if (existing !== undefined) return existing;
    const history = this.restoredHistory[saved.slot];
    if (!Number.isSafeInteger(saved.slot) || saved.slot < 0 || !Number.isSafeInteger(saved.generation) || saved.generation < 0 || history === undefined
      || saved.generation > history.checkpoint.generation || (history.checkpoint.lifetime.kind === "free" && saved.generation === history.checkpoint.generation)) throw new RangeError("Invalid historical actor checkpoint reference");
    const generation = history.generationBase + saved.generation;
    const reference = this.identities.actor(saved.slot, generation);
    this.savedReferences.set(key, reference);
    return reference;
  }

  static restore(identities: IdentityOwner, checkpoints: readonly ActorSlotCheckpoint[], sources: readonly SourceActorCheckpoint[], capacity = 65536): SessionActorRegistry {
    const registry = new SessionActorRegistry(identities, capacity);
    if (checkpoints.length > capacity) throw new RangeError("Actor checkpoint exceeds capacity");
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (checkpoint.slot !== index || !Number.isSafeInteger(checkpoint.generation) || checkpoint.generation < 0) throw new RangeError("Invalid actor slot checkpoint");
      const active = checkpoint.lifetime;
      const generationBase = registry.generations.get(index) ?? 0;
      const restoredGeneration = generationBase + checkpoint.generation;
      if (!Number.isSafeInteger(restoredGeneration) || restoredGeneration >= Number.MAX_SAFE_INTEGER) throw new RangeError("Restored actor generation is exhausted");
      registry.restoredHistory.push({ checkpoint, generationBase });
      // Reserve the complete saved lifetime interval, including references to freed actors.
      const generation = active.kind === "free" ? restoredGeneration : registry.reserveGeneration(index, restoredGeneration);
      const actor = active.kind === "free" ? null : identities.ownedActor(identities.actor(index, generation), active.owner);
      registry.slots.push({ generation, actor, definition: active.kind === "free" ? "world:free" : active.definition, source: null });
      if (actor !== null) {
        registry.restoredActors.set(index, { savedGeneration: checkpoint.generation, actor });
        registry.savedReferences.set(`${index}/${checkpoint.generation}`, actor.id);
      }
      else registry.generations.set(index, generation);
    }
    for (const source of sources) {
      const restored = registry.restoredActors.get(source.actor.slot);
      const actor = restored?.savedGeneration === source.actor.generation ? restored.actor : null;
      if (actor === null || actor.owner !== source.provider || !Number.isSafeInteger(source.sourceSlot) || source.sourceSlot < 0) throw new RangeError("Invalid source actor checkpoint");
      let table = registry.sourceSlots.get(source.provider);
      if (table === undefined) { table = new Map<number, OwnedActor>(); registry.sourceSlots.set(source.provider, table); }
      const slot = registry.requireSlot(actor);
      if (table.has(source.sourceSlot) || slot.source !== null) throw new RangeError("Duplicate source actor binding");
      slot.source = { provider: source.provider, slot: source.sourceSlot };
      table.set(source.sourceSlot, actor);
    }
    return registry;
  }

  onRelease(callback: (actor: OwnedActor) => undefined): () => undefined {
    this.releases.add(callback);
    return () => { this.releases.delete(callback); return undefined; };
  }

  assertOwned(actor: OwnedActor): undefined { this.requireSlot(actor); return undefined; }

  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    const errors: unknown[] = [];
    for (const slot of this.slots) {
      if (slot.actor !== null) {
        try { this.release(slot.actor); } catch (error) { errors.push(error); }
      }
    }
    this.releases.clear();
    if (errors.length > 0) throw new AggregateError(errors, "Actor registry shutdown failed");
    return undefined;
  }

  private requireSlot(actor: OwnedActor): Slot {
    const slot = this.slots[actor.id.slot];
    if (!this.isLive(actor.id) || slot === undefined || slot.actor !== actor) throw new RangeError("Stale or foreign actor authority");
    return slot;
  }

  private reserveGeneration(slot: number, minimum: number): number {
    const generation = Math.max(minimum, this.generations.get(slot) ?? 0);
    if (!Number.isSafeInteger(generation) || generation >= Number.MAX_SAFE_INTEGER) throw new RangeError("Actor generation is exhausted");
    this.generations.set(slot, generation + 1);
    return generation;
  }
}
