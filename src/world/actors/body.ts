import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { BodyState, BodyTable, LinkedBody } from "../../contracts/world.ts";
import type { SessionActorRegistry } from "./registry.ts";

export interface BodyStateBinding {
  read(): BodyState;
  write(state: BodyState): undefined;
}

export interface BodyLinkHooks {
  absoluteBounds(actor: OwnedActor, state: BodyState): Bounds;
  onLink(body: LinkedBody): undefined;
  onUnlink(actor: ActorId): undefined;
}
export interface BodyLinkState {
  readonly linkCount: number;
  readonly linked: { readonly state: BodyState; readonly absoluteBounds: Bounds } | null;
}

export function copyVector(vector: Vec3): Vec3 { return Object.freeze({ x: vector.x, y: vector.y, z: vector.z }); }
export function copyBounds(bounds: Bounds): Bounds { return Object.freeze({ min: copyVector(bounds.min), max: copyVector(bounds.max) }); }
export function copyBody(state: BodyState): BodyState {
  return Object.freeze({ origin: copyVector(state.origin), angles: copyVector(state.angles), velocity: copyVector(state.velocity), bounds: copyBounds(state.bounds), ground: state.ground });
}

/** This is only an untranslated box policy. BSP rotation and family link padding are supplied by the provider. */
export function translatedBodyBounds(_actor: OwnedActor, state: BodyState): Bounds {
  return { min: { x: state.origin.x + state.bounds.min.x, y: state.origin.y + state.bounds.min.y, z: state.origin.z + state.bounds.min.z },
    max: { x: state.origin.x + state.bounds.max.x, y: state.origin.y + state.bounds.max.y, z: state.origin.z + state.bounds.max.z } };
}

interface BodyRecord { readonly actor: OwnedActor; readonly binding: BodyStateBinding; linked: LinkedBody | null; linkCount: number; }

export class SharedBodyTable implements BodyTable {
  private readonly records = new Map<number, BodyRecord>();

  constructor(private readonly actors: SessionActorRegistry, private readonly hooks: BodyLinkHooks) {
    actors.onRelease(actor => {
      const record = this.records.get(actor.id.slot);
      if (record?.actor === actor) {
        this.records.delete(actor.id.slot);
        if (record.linked !== null) hooks.onUnlink(actor.id);
      }
      return undefined;
    });
  }

  bind(actor: OwnedActor, binding: BodyStateBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.records.has(actor.id.slot)) throw new Error("Actor already has a body binding");
    this.records.set(actor.id.slot, { actor, binding, linked: null, linkCount: 0 });
    return undefined;
  }

  create(actor: OwnedActor, initial: BodyState): undefined {
    let state = copyBody(initial);
    return this.bind(actor, { read: () => state, write: next => { state = copyBody(next); return undefined; } });
  }

  read(actor: ActorId): BodyState | null {
    const record = this.record(actor);
    return record === null ? null : copyBody(record.binding.read());
  }

  write(actor: OwnedActor, state: BodyState): undefined {
    this.actors.assertOwned(actor);
    const record = this.record(actor.id);
    if (record === null) return this.create(actor, state);
    return record.binding.write(copyBody(state));
  }

  linked(actor: ActorId): LinkedBody | null { return this.record(actor)?.linked ?? null; }

  linkState(actor: ActorId): BodyLinkState | null {
    const record = this.record(actor);
    return record === null ? null : Object.freeze({ linkCount: record.linkCount, linked: record.linked });
  }

  /** Installs saved spatial state directly, without source link callbacks, bounds recomputation or a new link count. */
  restoreLinkState(actor: OwnedActor, saved: BodyLinkState): undefined {
    this.actors.assertOwned(actor);
    const record = this.record(actor.id);
    if (record === null) throw new Error("Cannot restore links without an actor body");
    if (!Number.isSafeInteger(saved.linkCount) || saved.linkCount < 0 || (saved.linked !== null && saved.linkCount === 0)) throw new RangeError("Invalid saved body link count");
    record.linkCount = saved.linkCount;
    record.linked = saved.linked === null ? null : Object.freeze({ actor: actor.id, state: copyBody(saved.linked.state), absoluteBounds: copyBounds(saved.linked.absoluteBounds), linkCount: saved.linkCount });
    return record.linked === null ? this.hooks.onUnlink(actor.id) : this.hooks.onLink(record.linked);
  }

  link(actor: OwnedActor, origin?: Vec3): undefined {
    this.actors.assertOwned(actor);
    const record = this.record(actor.id);
    if (record === null) throw new Error("Cannot link an actor without a body");
    const current = record.binding.read();
    const state = copyBody(origin === undefined ? current : { ...current, origin });
    const linked: LinkedBody = Object.freeze({ actor: actor.id, state,
      absoluteBounds: copyBounds(this.hooks.absoluteBounds(actor, state)), linkCount: ++record.linkCount });
    record.linked = linked;
    return this.hooks.onLink(linked);
  }

  unlink(actor: OwnedActor): undefined {
    this.actors.assertOwned(actor);
    const record = this.record(actor.id);
    if (record === null || record.linked === null) return undefined;
    record.linked = null;
    return this.hooks.onUnlink(actor.id);
  }

  private record(actor: ActorId): BodyRecord | null { return this.actors.isLive(actor) ? this.records.get(actor.slot) ?? null : null; }
}
