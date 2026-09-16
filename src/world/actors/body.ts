import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";
import type { BodyAttachment, BodyState, BodyTable, LinkedBody } from "../../contracts/world.ts";
import type { SessionActorRegistry } from "./registry.ts";

export interface BodyStateBinding {
  read(): BodyState;
  write(state: BodyState): undefined;
  linked?(body: LinkedBody): undefined;
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

type BodyStorage = { readonly kind: "local"; state: BodyState } | { readonly kind: "external"; readonly binding: BodyStateBinding };
interface BodyRecord { readonly actor: OwnedActor; readonly storage: BodyStorage; linked: LinkedBody | null; linkCount: number; }

export class SharedBodyTable implements BodyTable {
  private readonly records = new Map<number, BodyRecord>();
  private readonly attachments = new Map<OwnedActor, BodyAttachment>();

  constructor(private readonly actors: SessionActorRegistry, private readonly hooks: BodyLinkHooks) {
    actors.onRelease(actor => {
      this.attachments.delete(actor);
      const children: OwnedActor[] = [];
      for (const [child, attachment] of this.attachments) if (attachment.anchor.equals(actor.id)) {
        children.push(child);
        this.attachments.delete(child);
      }
      const record = this.records.get(actor.id.slot);
      if (record?.actor === actor) this.records.delete(actor.id.slot);
      const errors: unknown[] = [];
      if (record?.actor === actor && record.linked !== null) {
        try { hooks.onUnlink(actor.id); } catch (error) { errors.push(error); }
      }
      for (const child of children) if (actors.isLive(child.id)) {
        try { actors.release(child); } catch (error) { errors.push(error); }
      }
      if (errors.length > 0) throw new AggregateError(errors, "Attached body release failed");
      return undefined;
    });
  }

  bind(actor: OwnedActor, binding: BodyStateBinding): undefined {
    this.actors.assertOwned(actor);
    if (this.records.has(actor.id.slot)) throw new Error("Actor already has a body binding");
    this.records.set(actor.id.slot, { actor, storage: { kind: "external", binding }, linked: null, linkCount: 0 });
    return undefined;
  }

  create(actor: OwnedActor, initial: BodyState): undefined {
    const state = copyBody(initial);
    this.actors.assertOwned(actor);
    if (this.records.has(actor.id.slot)) throw new Error("Actor already has a body binding");
    this.records.set(actor.id.slot, { actor, storage: { kind: "local", state }, linked: null, linkCount: 0 });
    return undefined;
  }

  read(actor: ActorId): BodyState | null {
    const record = this.record(actor);
    return record === null ? null : record.storage.kind === "local" ? record.storage.state : copyBody(record.storage.binding.read());
  }

  write(actor: OwnedActor, state: BodyState): undefined {
    this.actors.assertOwned(actor);
    const record = this.record(actor.id);
    if (record === null) return this.create(actor, state);
    if (record.storage.kind === "external") return record.storage.binding.write(copyBody(state));
    record.storage.state = copyBody(state);
    return undefined;
  }

  attach(actor: OwnedActor, attachment: BodyAttachment): undefined {
    this.actors.assertOwned(actor);
    if (this.record(actor.id) === null) throw new Error("Cannot attach an actor without a body");
    const anchor = this.record(attachment.anchor);
    if (anchor === null) throw new Error("Cannot attach to a missing anchor body");
    for (let ancestor: BodyRecord | null = anchor; ancestor !== null;) {
      if (ancestor.actor === actor) throw new Error("Body attachment cycle");
      const parent = this.attachments.get(ancestor.actor);
      ancestor = parent === undefined ? null : this.record(parent.anchor);
    }
    const follow = attachment.follow;
    this.attachments.set(actor, Object.freeze({ anchor: attachment.anchor, follow: Object.freeze(follow.kind === "center"
      ? { kind: follow.kind } : { kind: follow.kind, offset: copyVector(follow.offset) }) }));
    return undefined;
  }

  detach(actor: OwnedActor): undefined {
    this.actors.assertOwned(actor);
    this.attachments.delete(actor);
    return undefined;
  }

  attachment(actor: ActorId): BodyAttachment | null {
    const record = this.record(actor);
    return record === null ? null : this.attachments.get(record.actor) ?? null;
  }

  /** Run at a committed execution boundary; spatial publication never invokes source touches. */
  transportAttachments(numeric: NumericOperations): undefined {
    const transported = new Set<OwnedActor>();
    const transport = (actor: OwnedActor): void => {
      if (transported.has(actor)) return;
      transported.add(actor);
      const attachment = this.attachments.get(actor);
      if (attachment === undefined) return;
      const anchorRecord = this.record(attachment.anchor);
      if (anchorRecord === null) return;
      transport(anchorRecord.actor);
      const anchor = this.read(attachment.anchor), body = this.read(actor.id);
      if (anchor === null || body === null) return;
      const follow = attachment.follow;
      const component = (axis: "x" | "y" | "z"): number => {
        const offset = follow.kind === "center" ? numeric.multiply(numeric.add(anchor.bounds.min[axis], anchor.bounds.max[axis]), 0.5)
          : follow.kind === "bounds-min" ? numeric.add(anchor.bounds.min[axis], follow.offset[axis]) : follow.offset[axis];
        return numeric.store(numeric.add(anchor.origin[axis], offset));
      };
      const origin = { x: component("x"), y: component("y"), z: component("z") };
      if (Object.is(origin.x, body.origin.x) && Object.is(origin.y, body.origin.y) && Object.is(origin.z, body.origin.z)) return;
      this.write(actor, { ...body, origin });
      this.link(actor);
    };
    for (const actor of this.attachments.keys()) transport(actor);
    return undefined;
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
    if (record.linked === null) return this.hooks.onUnlink(actor.id);
    if (record.storage.kind === "external") record.storage.binding.linked?.(record.linked);
    return this.hooks.onLink(record.linked);
  }

  link(actor: OwnedActor, origin?: Vec3): undefined {
    this.actors.assertOwned(actor);
    const record = this.record(actor.id);
    if (record === null) throw new Error("Cannot link an actor without a body");
    const current = record.storage.kind === "local" ? record.storage.state : record.storage.binding.read();
    const state = copyBody(origin === undefined ? current : { ...current, origin });
    const linked: LinkedBody = Object.freeze({ actor: actor.id, state,
      absoluteBounds: copyBounds(this.hooks.absoluteBounds(actor, state)), linkCount: ++record.linkCount });
    record.linked = linked;
    if (record.storage.kind === "external") record.storage.binding.linked?.(linked);
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
