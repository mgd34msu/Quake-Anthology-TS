import { Q2RereleaseMovementContext } from "../../../movement/q2/index.ts";
/* Shared body physics adapted from Quake sv_phys.c/sv_move.c and Quake II
 * g_phys.c/m_move.c. Copyright (C) 1996-2005 Id Software. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { NumericOperations, NumericProfile } from "../../../contracts/numeric.ts";
import type { TracePolicy, TraceQuery, TraceResult } from "../../../contracts/scene.ts";
import type { BodyState, LinkedBody } from "../../../contracts/world.ts";
import type { Q2Motion, Q2TraceRequest } from "../../../content/q2/foundation/host.ts";
import { angleVectors, donorAngleVectors } from "../../../core/math.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { ActorCollision } from "../../../world/collision/index.ts";
import { boundsIntersect } from "../../../world/spatial/index.ts";
import { savedActorId, readSavedActor } from "../../../persistence/save-image.ts";
import { SaveReader } from "../../../persistence/value.ts";
import { createQ2RereleaseFlyMove } from "./q2-rerelease-slide.ts";
import { stepQ2NewToss } from "./new-toss.ts";
import { readVector } from "../../../persistence/shared.ts";

export type PhysicsFamily = "q1" | "q2" | "q3";
export interface SharedSolid {
  readonly solid: "none" | "trigger" | "box" | "brush";
  readonly model: number | null;
  readonly family: PhysicsFamily;
  readonly owner: ActorId | null;
  readonly monster?: boolean;
  readonly deadMonster?: boolean;
  readonly item?: boolean;
}
export interface SharedPhysicsFlags {
  readonly alwaysTouch?: boolean;
  readonly fly?: boolean;
  readonly swim?: boolean;
  readonly partialGround?: boolean;
  readonly dead?: boolean;
  readonly player?: boolean;
  readonly waterLevel?: number;
  readonly waterType?: number;
  readonly enemy?: ActorId | null;
  readonly deltaYaw?: number;
  readonly teamSlave?: boolean;
}
export interface SharedPhysicsOptions {
  readonly actors: SessionActorRegistry;
  readonly callbacks: ActorCallbackTable;
  readonly scene: SharedSceneQueries;
  readonly numeric: NumericProfile;
  readonly sourceOrder: (a: ActorId, b: ActorId) => number;
  readonly worldActor: () => ActorId | null;
  readonly onBlocked: (pusher: OwnedActor, other: ActorId) => undefined;
  readonly getCollision?: (actor: OwnedActor) => SharedSolid | null;
  readonly getMotion?: (actor: OwnedActor) => Q2Motion | null;
  readonly getFlags?: (actor: OwnedActor) => SharedPhysicsFlags;
  readonly writeFlags?: (actor: OwnedActor, changes: SharedPhysicsFlags) => undefined;
  readonly writeAngularVelocity?: (actor: OwnedActor, velocity: Vec3) => undefined;
  readonly event?: (event: PhysicsEvent) => undefined;
  readonly gravity?: number;
  readonly maxVelocity?: number;
  readonly q2Edition?: "classic" | "rerelease";
  readonly stopSpeed?: () => number;
  readonly takeKillVelocity?: (actor: OwnedActor) => boolean;
}
interface Pushed { readonly actor: OwnedActor; readonly origin: Vec3; readonly angles: Vec3; readonly deltaYaw: number; }
export interface PhysicsEvent { readonly actor: ActorId; readonly kind: "water-enter" | "water-leave" | "land"; readonly origin: Vec3; }
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const defaultMask = 0x02020003;

/** The scheduler calls one actor at a time. This owner never starts a family loop. */
export class SharedPhysics {
  readonly bodies: SharedBodyTable;
  readonly rereleaseMovement = new Q2RereleaseMovementContext();
  private readonly n: NumericOperations;
  private readonly solids = new Map<OwnedActor, SharedSolid>();
  private readonly collisions = new Map<OwnedActor, ActorCollision>();
  private readonly motions = new Map<OwnedActor, Q2Motion>();
  private readonly flags = new Map<OwnedActor, SharedPhysicsFlags>();
  private readonly events: PhysicsEvent[] = [];
  private pushTransaction: Pushed[] | null = null;
  private worldGravity: number;
  private readonly rereleaseFlyMove;
  constructor(private readonly options: SharedPhysicsOptions) {
    this.worldGravity = options.gravity ?? 800;
    this.n = createNumericOperations(options.numeric);
    this.rereleaseFlyMove = createQ2RereleaseFlyMove(this.n, this.rereleaseMovement);
    this.bodies = new SharedBodyTable(options.actors, {
      absoluteBounds: (actor, state) => this.absoluteBounds(actor, state),
      onLink: body => this.linked(body),
      onUnlink: actor => { options.scene.unlink(actor); return undefined; },
    });
    options.scene.bindActorState(id => this.bodies.read(id));
    options.actors.onRelease(actor => { this.solids.delete(actor); this.collisions.delete(actor); this.motions.delete(actor); this.flags.delete(actor); return undefined; });
  }
  private vector(x: number, y: number, z: number): Vec3 { return { x: this.n.store(x), y: this.n.store(y), z: this.n.store(z) }; }
  private add(a: Vec3, b: Vec3): Vec3 { return this.vector(this.n.add(a.x, b.x), this.n.add(a.y, b.y), this.n.add(a.z, b.z)); }
  private sub(a: Vec3, b: Vec3): Vec3 { return this.vector(this.n.subtract(a.x, b.x), this.n.subtract(a.y, b.y), this.n.subtract(a.z, b.z)); }
  private scale(v: Vec3, value: number): Vec3 { return this.vector(this.n.multiply(v.x, value), this.n.multiply(v.y, value), this.n.multiply(v.z, value)); }
  private dot(a: Vec3, b: Vec3): number { return this.n.add(this.n.add(this.n.multiply(a.x, b.x), this.n.multiply(a.y, b.y)), this.n.multiply(a.z, b.z)); }
  private moving(v: Vec3): boolean { return v.x !== 0 || v.y !== 0 || v.z !== 0; }
  private live(actor: OwnedActor): boolean { return this.options.actors.isLive(actor.id); }
  private solid(actor: OwnedActor): SharedSolid | null { return this.options.getCollision?.(actor) ?? this.solids.get(actor) ?? null; }
  private motion(actor: OwnedActor): Q2Motion | null { return this.options.getMotion?.(actor) ?? this.motions.get(actor) ?? null; }
  private family(actor: OwnedActor): PhysicsFamily { return this.solid(actor)?.family ?? "q2"; }
  get gravity(): number { return this.worldGravity; }
  setWorldGravity(value: number): undefined {
    if (!Number.isFinite(value)) throw new RangeError("World gravity must be finite");
    this.worldGravity = value; return undefined;
  }
  capture() {
    if (this.collisions.size !== 0) throw new Error("Exact Q3 collision checkpoints require the Q3 world provider checkpoint");
    return { gravity: this.worldGravity, rereleaseMovement: this.rereleaseMovement.capture(),
      spatial: this.options.scene.spatial.query({ min: { x: -Infinity, y: -Infinity, z: -Infinity }, max: { x: Infinity, y: Infinity, z: Infinity } }).map(value => ({
        actor: savedActorId(value.body.actor), collision: { ...value.collision, owner: value.collision.owner === null ? null : savedActorId(value.collision.owner) } })),
      solids: [...this.solids].map(([actor, solid]) => ({ actor: savedActorId(actor.id), ...solid, owner: solid.owner === null ? null : savedActorId(solid.owner) })),
      motions: [...this.motions].map(([actor, motion]) => ({ ...motion, actor: savedActorId(actor.id), owner: motion.owner === null ? null : savedActorId(motion.owner) })),
      flags: [...this.flags].map(([actor, flags]) => ({ actor: savedActorId(actor.id), ...flags, ...(flags.enemy === undefined ? {} : { enemy: flags.enemy === null ? null : savedActorId(flags.enemy) }) })) };
  }
  restoreCheckpoint(reader: SaveReader): undefined {
    this.setWorldGravity(reader.field("gravity").finite());
    this.rereleaseMovement.restore(readVector(reader.field("rereleaseMovement")));
    const reference = (value: SaveReader) => this.options.actors.referenceSaved(readSavedActor(value));
    const owner = (value: SaveReader): OwnedActor => {
      const actor = this.options.actors.resolveSaved(readSavedActor(value));
      if (actor === null) return value.fail("Missing shared physics actor");
      return actor;
    };
    this.solids.clear(); this.motions.clear(); this.flags.clear();
    reader.field("solids").list(value => {
      this.solids.set(owner(value.field("actor")), { solid: value.field("solid").choice("none", "trigger", "box", "brush"), model: value.field("model").nullable(v => v.integer(0)),
        family: value.field("family").choice("q1", "q2", "q3"), owner: value.field("owner").nullable(reference),
        ...(value.field("monster").value === undefined ? {} : { monster: value.field("monster").boolean() }),
        ...(value.field("deadMonster").value === undefined ? {} : { deadMonster: value.field("deadMonster").boolean() }),
        ...(value.field("item").value === undefined ? {} : { item: value.field("item").boolean() }) });
    });
    reader.field("motions").list(value => {
      const actor = owner(value.field("actor"));
      this.motions.set(actor, { actor, kind: value.field("kind").choice("stationary", "push", "stop", "toss", "new-toss", "bounce", "wall-bounce", "fly", "fly-missile", "step"),
        velocity: readVector(value.field("velocity")), angularVelocity: readVector(value.field("angularVelocity")), gravity: value.field("gravity").number(), gravityVector: readVector(value.field("gravityVector")),
        clipMask: value.field("clipMask").number(), owner: value.field("owner").nullable(reference) });
    });
    reader.field("flags").list(value => {
      this.flags.set(owner(value.field("actor")), {
        ...(value.field("teamSlave").value === undefined ? {} : { teamSlave: value.field("teamSlave").boolean() }),
        ...(value.field("alwaysTouch").value === undefined ? {} : { alwaysTouch: value.field("alwaysTouch").boolean() }),
        ...(value.field("fly").value === undefined ? {} : { fly: value.field("fly").boolean() }), ...(value.field("swim").value === undefined ? {} : { swim: value.field("swim").boolean() }),
        ...(value.field("partialGround").value === undefined ? {} : { partialGround: value.field("partialGround").boolean() }), ...(value.field("dead").value === undefined ? {} : { dead: value.field("dead").boolean() }),
        ...(value.field("player").value === undefined ? {} : { player: value.field("player").boolean() }), ...(value.field("waterLevel").value === undefined ? {} : { waterLevel: value.field("waterLevel").number() }),
        ...(value.field("waterType").value === undefined ? {} : { waterType: value.field("waterType").number() }), ...(value.field("deltaYaw").value === undefined ? {} : { deltaYaw: value.field("deltaYaw").number() }),
        ...(value.field("enemy").value === undefined ? {} : { enemy: value.field("enemy").nullable(reference) }) });
    });
    return undefined;
  }
  restoreSpatial(reader: SaveReader): undefined {
    this.options.scene.spatial.clear();
    reader.field("spatial").list(value => {
      const actor = this.options.actors.resolveSaved(readSavedActor(value.field("actor"))), collision = value.field("collision"), shape = collision.field("shape");
      const kind = shape.field("kind").choice("box", "capsule", "model");
      const body = actor === null ? null : this.bodies.linked(actor.id);
      if (body === null) return value.fail("Saved spatial actor has no retained body link");
      this.options.scene.link(body, { family: collision.field("family").choice("q1", "q2", "q3"), shape: kind === "model" ? { kind, model: shape.field("model").integer(0) } : { kind },
        contents: collision.field("contents").number(), owner: collision.field("owner").nullable(v => this.options.actors.referenceSaved(readSavedActor(v))),
        role: collision.field("role").choice("solid", "trigger"), monster: collision.field("monster").boolean(), deadMonster: collision.field("deadMonster").boolean() });
    });
    return undefined;
  }
  solidOf(actor: ActorId): SharedSolid | null { const owned = this.options.actors.resolveOwned(actor); return owned === null ? null : this.solid(owned); }
  motionOf(actor: ActorId): Q2Motion | null { const owned = this.options.actors.resolveOwned(actor); return owned === null ? null : this.motion(owned); }
  isBrush(actor: ActorId): boolean { const owned = this.options.actors.resolveOwned(actor); return owned !== null && this.solid(owned)?.solid === "brush"; }
  drainEvents(): readonly PhysicsEvent[] { return this.events.splice(0); }
  private emit(event: PhysicsEvent): undefined { if (this.options.event !== undefined) return this.options.event(event); this.events.push(event); return undefined; }
  private actorFlags(actor: OwnedActor): SharedPhysicsFlags { return { ...this.flags.get(actor), ...this.options.getFlags?.(actor) }; }
  setFlags(actor: OwnedActor, changes: SharedPhysicsFlags): undefined {
    if (!this.live(actor)) return undefined;
    this.flags.set(actor, { ...this.actorFlags(actor), ...changes });
    return this.options.writeFlags?.(actor, changes);
  }
  setSolid(actor: OwnedActor, solid: SharedSolid["solid"], model: number | null, family: PhysicsFamily, owner: ActorId | null = null): undefined {
    this.options.actors.assertOwned(actor);
    if (solid === "brush" && model === null) throw new RangeError("Brush solidity requires an inline model");
    this.solids.set(actor, { solid, model, family, owner });
    const linked = this.bodies.linked(actor.id);
    if (linked !== null) return this.linked(linked);
    return undefined;
  }
  setCollision(actor: OwnedActor, collision: ActorCollision): undefined {
    this.options.actors.assertOwned(actor);
    this.collisions.set(actor, collision);
    this.solids.set(actor, { solid: collision.role === "trigger" ? "trigger" : collision.shape.kind === "model" ? "brush" : "box",
      model: collision.shape.kind === "model" ? collision.shape.model : null, family: collision.family, owner: collision.owner,
      monster: collision.monster, deadMonster: collision.deadMonster });
    const linked = this.bodies.linked(actor.id);
    return linked === null ? undefined : this.linked(linked);
  }
  setMotion(motion: Q2Motion): undefined {
    this.options.actors.assertOwned(motion.actor);
    this.motions.set(motion.actor, { ...motion });
    const body = this.bodies.read(motion.actor.id);
    if (body !== null) this.bodies.write(motion.actor, { ...body, velocity: motion.velocity });
    const linked = this.bodies.linked(motion.actor.id); if (linked !== null) this.linked(linked);
    return undefined;
  }
  private absoluteBounds(actor: OwnedActor, state: BodyState): Bounds {
    const solid = this.solid(actor);
    let bounds: Bounds = { min: this.add(state.origin, state.bounds.min), max: this.add(state.origin, state.bounds.max) };
    if (solid?.solid === "brush" && this.moving(state.angles)) {
      const extent = { x: Math.max(Math.abs(state.bounds.min.x), Math.abs(state.bounds.max.x)), y: Math.max(Math.abs(state.bounds.min.y), Math.abs(state.bounds.max.y)), z: Math.max(Math.abs(state.bounds.min.z), Math.abs(state.bounds.max.z)) };
      const radius = this.n.squareRoot(this.dot(extent, extent)), offset = { x: radius, y: radius, z: radius };
      bounds = { min: this.sub(state.origin, offset), max: this.add(state.origin, offset) };
    }
    const pad = solid?.family === "q1" && solid.item ? { x: 15, y: 15, z: 0 } : { x: 1, y: 1, z: 1 };
    return { min: this.sub(bounds.min, pad), max: this.add(bounds.max, pad) };
  }
  private linked(body: LinkedBody): undefined {
    const actor = this.options.actors.resolveOwned(body.actor);
    if (actor === null) return undefined;
    const exact = this.collisions.get(actor);
    if (exact !== undefined) { this.options.scene.link(body, exact); return undefined; }
    const solid = this.solid(actor), world = this.options.worldActor();
    if (solid === null || solid.solid === "none" || world !== null && sameActor(world, actor.id)) { this.options.scene.unlink(actor.id); return undefined; }
    const shape: ActorCollision["shape"] = solid.solid === "brush" && solid.model !== null ? { kind: "model", model: solid.model } : { kind: "box" };
    const contents = solid.family === "q1" ? -2 : solid.solid === "brush" ? 1 : solid.deadMonster ? 0x4000000 : 0x2000000;
    const motion = this.motion(actor);
    this.options.scene.link(body, { family: solid.family, shape, contents, owner: motion === null ? solid.owner : motion.owner,
      role: solid.solid === "trigger" ? "trigger" : "solid", monster: solid.monster ?? false, deadMonster: solid.deadMonster ?? false });
    return undefined;
  }
  private policy(family: PhysicsFamily, mask: number, move: "normal" | "no-monsters" | "missile" = "normal"): TracePolicy {
    if (family === "q1") return { kind: "q1", move, hull: null };
    if (family === "q2") return { kind: "q2", contentsMask: mask, leafContents: "merged" };
    return { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true };
  }
  trace(request: Q2TraceRequest, family: PhysicsFamily = "q2"): TraceResult {
    const query: TraceQuery = { start: request.start, end: request.end,
      shape: request.bounds === null ? { kind: "point" } : { kind: "box", bounds: request.bounds },
      target: { kind: "world" }, policy: this.policy(family, request.mask), numeric: this.options.numeric, passActor: request.ignore };
    return request.exclude === undefined || request.exclude.length === 0 ? this.options.scene.trace(query) : this.options.scene.traceExcluding(query, request.exclude);
  }
  private bodyTrace(actor: OwnedActor, start: Vec3, end: Vec3, exclude: readonly ActorId[] = [], exactMask = false, bounds?: Bounds): TraceResult {
    const body = this.bodies.read(actor.id);
    if (body === null) throw new RangeError("Cannot trace an actor without a body");
    const family = this.family(actor), motion = this.motion(actor);
    const solid = this.solid(actor)?.solid;
    const move = family === "q1" && motion?.kind === "fly-missile" ? "missile" : family === "q1" && (solid === "none" || solid === "trigger") ? "no-monsters" : "normal";
    const query: TraceQuery = { start, end, shape: { kind: "box", bounds: bounds ?? body.bounds }, target: { kind: "world" },
      policy: this.policy(family, exactMask ? motion?.clipMask ?? 0 : motion?.clipMask || 3, move),
      numeric: this.options.numeric, passActor: actor.id };
    return exclude.length === 0 ? this.options.scene.trace(query) : this.options.scene.traceExcluding(query, exclude);
  }
  private hitActor(trace: TraceResult): ActorId | null {
    if (trace.hit.kind === "actor") return trace.hit.actor;
    return trace.hit.kind === "world" ? this.options.worldActor() : null;
  }
  touchTriggers(actor: OwnedActor): undefined {
    const linked = this.bodies.linked(actor.id);
    if (linked === null || !this.live(actor)) return undefined;
    const flags = this.actorFlags(actor), family = this.family(actor);
    if (family !== "q1" && flags.dead && (flags.player || this.solid(actor)?.monster)) return undefined;
    const touch = (id: ActorId): void => {
      if (!this.live(actor)) return;
      const trigger = this.options.actors.resolveOwned(id), current = this.bodies.linked(id), moving = this.bodies.linked(actor.id);
      if (trigger === null || current === null || moving === null || sameActor(id, actor.id) || this.solid(trigger)?.solid !== "trigger") return;
      if (!boundsIntersect(current.absoluteBounds, moving.absoluteBounds)) return;
      this.options.callbacks.touch({ self: trigger, other: actor.id, plane: null, surface: null });
    };
    if (family === "q1") this.options.scene.spatial.visit(linked.absoluteBounds, candidate => {
      if (candidate.collision.role === "trigger") touch(candidate.body.actor);
      return this.live(actor) ? "continue" : "stop";
    });
    else for (const candidate of this.options.scene.queryActors(linked.absoluteBounds, "trigger")) { if (!this.live(actor)) break; touch(candidate.body.actor); }
    return undefined;
  }
  private impact(actor: OwnedActor, trace: TraceResult): undefined {
    const otherId = this.hitActor(trace);
    if (otherId === null || !this.live(actor)) return undefined;
    const other = this.options.actors.resolveOwned(otherId);
    const plane = trace.contact.kind === "plane" ? trace.contact.plane : trace.sourcePlane;
    const surface = trace.kind === "q2" && trace.surface !== null ? { name: trace.surface.name, nativeFlags: trace.surface.flags, nativeValue: trace.surface.value } : trace.kind === "q1" && trace.surfaceFlags !== undefined ? { name: "", nativeFlags: trace.surfaceFlags & 0x86, nativeValue: 0 } : null;
    if (this.family(actor) === "q2" && this.options.q2Edition === "rerelease" && trace.kind === "q2") {
      if (this.solid(actor)?.solid !== "none" || this.actorFlags(actor).alwaysTouch === true)
        this.options.callbacks.touch({ self: actor, other: otherId, plane, surface,
          sourceTrace: { kind: "q2-rerelease", trace, ent: otherId, inverted: false } });
      if (other !== null && this.live(other) && (this.solid(other)?.solid !== "none" || this.actorFlags(other).alwaysTouch === true))
        this.options.callbacks.touch({ self: other, other: actor.id, plane, surface,
          sourceTrace: { kind: "q2-rerelease", trace, ent: otherId, inverted: true } });
      return undefined;
    }
    if (this.solid(actor)?.solid !== "none") this.options.callbacks.touch({ self: actor, other: otherId, plane, surface });
    if (other !== null && this.live(actor) && this.live(other) && this.solid(other)?.solid !== "none") this.options.callbacks.touch({ self: other, other: actor.id, plane: null, surface: null });
    return undefined;
  }
  private pushEntity(actor: OwnedActor, displacement: Vec3, exclude: readonly ActorId[] = []): TraceResult {
    const initial = this.bodies.read(actor.id);
    if (initial === null) throw new RangeError("Cannot push an actor without a body");
    const end = this.add(initial.origin, displacement);
    for (;;) {
      const trace = this.bodyTrace(actor, initial.origin, end, exclude), current = this.bodies.read(actor.id);
      if (current === null) return trace;
      this.bodies.write(actor, { ...current, origin: trace.end }); this.bodies.link(actor);
      if (trace.fraction !== 1) {
        const hit = this.hitActor(trace);
        this.impact(actor, trace);
        if (this.family(actor) !== "q1" && hit !== null && !this.options.actors.isLive(hit) && this.live(actor)) {
          const changed = this.bodies.read(actor.id);
          if (changed !== null) { this.bodies.write(actor, { ...changed, origin: initial.origin }); this.bodies.link(actor); continue; }
        }
      }
      if (this.live(actor)) this.touchTriggers(actor);
      return trace;
    }
  }
  private clip(velocity: Vec3, normal: Vec3, overbounce = 1): Vec3 {
    const backoff = this.n.multiply(this.dot(velocity, normal), overbounce);
    const clipped = this.vector(this.n.subtract(velocity.x, this.n.multiply(normal.x, backoff)),
      this.n.subtract(velocity.y, this.n.multiply(normal.y, backoff)), this.n.subtract(velocity.z, this.n.multiply(normal.z, backoff)));
    const stop = (v: number): number => v > -0.1 && v < 0.1 ? 0 : v;
    return this.vector(stop(clipped.x), stop(clipped.y), stop(clipped.z));
  }
  private testPosition(actor: OwnedActor): TraceResult | null {
    const body = this.bodies.read(actor.id);
    if (body === null) return null;
    const trace = this.bodyTrace(actor, body.origin, body.origin);
    return trace.startSolid ? trace : null;
  }
  private writeLive(actor: OwnedActor, changes: Partial<BodyState>, link = false): boolean {
    const body = this.bodies.read(actor.id);
    if (body === null) return false;
    this.bodies.write(actor, { ...body, ...changes });
    if (link) this.bodies.link(actor);
    return true;
  }
  private candidates(): readonly OwnedActor[] {
    return this.options.actors.observations().map(actor => actor.id).sort(this.options.sourceOrder)
      .flatMap(id => { const actor = this.options.actors.resolveOwned(id); return actor === null ? [] : [actor]; });
  }
  pushMove(actor: OwnedActor, displacement: Vec3, angularDisplacement: Vec3 = zero): ActorId | null {
    const original = this.bodies.read(actor.id);
    if (original === null) return null;
    const family = this.family(actor), q1 = family === "q1";
    const snap = (v: number): number => this.n.store(Math.trunc(v * 8 + (v > 0 ? 0.5 : -0.5)) * 0.125);
    const move = q1 ? displacement : this.vector(snap(displacement.x), snap(displacement.y), snap(displacement.z));
    if (!this.moving(move) && !this.moving(angularDisplacement)) return null;
    const saved: Pushed[] = q1 ? [] : this.pushTransaction ?? [];
    saved.push({ actor, origin: original.origin, angles: original.angles, deltaYaw: this.actorFlags(actor).deltaYaw ?? 0 });
    this.writeLive(actor, { origin: this.add(original.origin, move), angles: this.add(original.angles, angularDisplacement) }, true);
    const bounds = this.bodies.linked(actor.id)?.absoluteBounds;
    if (bounds === undefined) return null;
    const angles = this.scale(angularDisplacement, -1);
    const forward = { ...zero }, right = { ...zero }, up = { ...zero };
    if (this.options.numeric.arithmetic.kind === "donor-binary64") donorAngleVectors(angles, forward, right, up);
    const axes = this.options.numeric.arithmetic.kind === "donor-binary64" ? { forward, right, up } : angleVectors(angles);
    for (const candidate of this.candidates()) {
      if (sameActor(candidate.id, actor.id) || !this.live(actor)) continue;
      const body = this.bodies.read(candidate.id), linked = this.bodies.linked(candidate.id), kind = this.motion(candidate)?.kind;
      if (body === null || linked === null || kind === "push" || kind === "stop" || kind === "stationary" || kind === undefined) continue;
      const rider = body.ground !== null && sameActor(body.ground, actor.id);
      if (!rider && (!boundsIntersect(linked.absoluteBounds, bounds) || this.testPosition(candidate) === null)) continue;
      let blocked = !q1 && this.motion(actor)?.kind === "stop" && !rider;
      if (!blocked) {
        saved.push({ actor: candidate, origin: body.origin, angles: body.angles, deltaYaw: this.actorFlags(candidate).deltaYaw ?? 0 });
        const pusherOrigin = this.bodies.read(actor.id)?.origin;
        if (pusherOrigin === undefined) return null;
        const translated = this.add(body.origin, move), offset = this.sub(translated, pusherOrigin);
        const rotated = this.vector(this.dot(offset, axes.forward), -this.dot(offset, axes.right), this.dot(offset, axes.up));
        const delta = this.add(move, this.sub(rotated, offset));
        if (q1) {
          if (!this.actorFlags(candidate).player) this.writeLive(candidate, { ground: null });
          this.pushEntity(candidate, delta, [actor.id]);
        }
        else {
          this.writeLive(candidate, { origin: this.add(body.origin, delta), ground: rider ? body.ground : null });
          if (this.actorFlags(candidate).player) this.setFlags(candidate, { deltaYaw: this.n.add(this.actorFlags(candidate).deltaYaw ?? 0, angularDisplacement.y) });
        }
        if (!this.live(actor)) return null;
        if (!this.live(candidate)) continue;
        blocked = this.testPosition(candidate) !== null;
        if (!blocked) {
          if (q1 && this.moving(angularDisplacement)) { const state = this.bodies.read(candidate.id); if (state !== null) this.writeLive(candidate, { angles: this.add(state.angles, angularDisplacement) }); }
          this.bodies.link(candidate); continue;
        }
        if (!q1) {
          const state = this.bodies.read(candidate.id);
          if (state !== null) this.writeLive(candidate, { origin: this.sub(state.origin, move) });
          if (this.testPosition(candidate) === null) { saved.pop(); continue; }
        } else {
          const state = this.bodies.read(candidate.id), solid = this.solid(candidate);
          if (state !== null && state.bounds.min.x === state.bounds.max.x) continue;
          if (state !== null && (solid?.solid === "none" || solid?.solid === "trigger" || solid?.deadMonster)) {
            const minimum = { x: 0, y: 0, z: state.bounds.min.z };
            this.writeLive(candidate, { bounds: { min: minimum, max: minimum } }); continue;
          }
        }
      }
      if (blocked) {
        if (q1) {
          this.writeLive(candidate, { origin: body.origin }, true); this.touchTriggers(candidate);
          this.writeLive(actor, { origin: original.origin, angles: original.angles }, true);
          if (this.live(actor)) this.options.onBlocked(actor, candidate.id);
          for (const entry of saved.slice(1)) {
            const current = this.bodies.read(entry.actor.id);
            if (current !== null) this.writeLive(entry.actor, { origin: entry.origin, angles: this.moving(angularDisplacement) ? this.sub(current.angles, angularDisplacement) : current.angles }, true);
          }
        } else {
          for (const entry of saved.slice().reverse()) this.restore(entry, true);
          if (this.live(actor)) this.options.onBlocked(actor, candidate.id);
        }
        return candidate.id;
      }
    }
    if (!q1 && this.pushTransaction === null) for (const entry of saved.slice().reverse()) if (this.live(entry.actor)) this.touchTriggers(entry.actor);
    return null;
  }

  /** SV_Physics_Pusher commits an entire source team before touching triggers or running thinks. */
  pushTeam(actors: readonly OwnedActor[], elapsed: number): ActorId | null {
    if (this.pushTransaction !== null) throw new Error("Nested pusher team movement is not permitted by the source frame");
    const saved: Pushed[] = [];
    this.pushTransaction = saved;
    try {
      for (const actor of actors) {
        if (!this.live(actor)) continue;
        const body = this.bodies.read(actor.id), motion = this.motion(actor);
        if (body === null || motion === null) continue;
        const blocked = this.pushMove(actor, this.scale(body.velocity, elapsed), this.scale(motion.angularVelocity, elapsed));
        if (blocked !== null) return blocked;
      }
    } finally { this.pushTransaction = null; }
    for (const entry of saved.slice().reverse()) if (this.live(entry.actor)) this.touchTriggers(entry.actor);
    return null;
  }
  private restore(entry: Pushed, angles: boolean): undefined {
    const current = this.bodies.read(entry.actor.id);
    if (current === null) return undefined;
    this.bodies.write(entry.actor, { ...current, origin: entry.origin, angles: angles ? entry.angles : current.angles });
    if (angles && this.actorFlags(entry.actor).player) this.setFlags(entry.actor, { deltaYaw: entry.deltaYaw });
    this.bodies.link(entry.actor);
    return undefined;
  }
  private checkBottom(actor: OwnedActor, body: BodyState): boolean {
    const min = this.add(body.origin, body.bounds.min), max = this.add(body.origin, body.bounds.max);
    const direction = this.motion(actor)?.gravityVector ?? { x: 0, y: 0, z: -1 }, floor = direction.z > 0 ? max.z : min.z;
    const point = (x: number, y: number): TraceResult => this.options.scene.trace({ start: { x, y, z: floor }, end: { x, y, z: floor + direction.z * 36 },
      shape: { kind: "point" }, passActor: actor.id, target: { kind: "world" }, policy: this.policy(this.family(actor), defaultMask, "no-monsters"), numeric: this.options.numeric });
    const middle = point((min.x + max.x) * 0.5, (min.y + max.y) * 0.5);
    if (middle.fraction === 1) return false;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) {
      const corner = point(x, y);
      if (corner.fraction === 1 || (corner.end.z - middle.end.z) * direction.z > 18) return false;
    }
    return true;
  }
  walkMove(actor: OwnedActor, yaw: number, distance: number): boolean {
    const body = this.bodies.read(actor.id);
    if (body === null) return false;
    const radians = yaw * Math.PI * 2 / 360, move = this.vector(Math.cos(radians) * distance, Math.sin(radians) * distance, 0);
    const flags = this.actorFlags(actor), family = this.family(actor);
    if (flags.fly || flags.swim) {
      const enemy = flags.enemy === undefined || flags.enemy === null ? null : this.bodies.read(flags.enemy);
      for (let attempt = 0; attempt < (enemy === null ? 1 : 2); attempt++) {
        let end = this.add(body.origin, move);
        if (attempt === 0 && enemy !== null) { const dz = body.origin.z - enemy.origin.z; end = this.add(end, { x: 0, y: 0, z: dz > 40 ? -8 : dz < 30 ? 8 : 0 }); }
        const trace = this.bodyTrace(actor, body.origin, end);
        if (trace.fraction !== 1) continue;
        const contents = this.options.scene.pointContents({ point: trace.end, target: { kind: "world" }, policy: this.policy(family, defaultMask), numeric: this.options.numeric, passActor: actor.id });
        const water = contents.kind === "q1" ? contents.contents <= -3 && contents.contents >= -5 : ((contents.kind === "q2" ? contents.merged : contents.contents) & 56) !== 0;
        if (flags.swim && !water) return false;
        this.writeLive(actor, { origin: trace.end }, true); this.touchTriggers(actor); return this.live(actor);
      }
      return false;
    }
    const desired = this.add(body.origin, move), raised = this.add(desired, { x: 0, y: 0, z: 18 }), down = this.add(desired, { x: 0, y: 0, z: -18 });
    let trace = this.bodyTrace(actor, raised, down);
    if (trace.allSolid) return false;
    if (trace.startSolid) { trace = this.bodyTrace(actor, desired, down); if (trace.allSolid || trace.startSolid) return false; }
    if (trace.fraction === 1) {
      if (!flags.partialGround) return false;
      this.writeLive(actor, { origin: desired, ground: null }, true); this.touchTriggers(actor); return this.live(actor);
    }
    const landed = { ...body, origin: trace.end };
    if (!this.checkBottom(actor, landed)) {
      if (!flags.partialGround) return false;
      this.writeLive(actor, { origin: trace.end }, true); this.touchTriggers(actor); return this.live(actor);
    }
    this.writeLive(actor, { origin: trace.end, ground: this.hitActor(trace) }, true);
    this.setFlags(actor, { partialGround: false }); this.touchTriggers(actor); return this.live(actor);
  }
  private flyMove(actor: OwnedActor, elapsed: number, newToss = false): undefined {
    if (this.family(actor) === "q2" && this.options.q2Edition === "rerelease") {
      return this.rereleaseFlyMove(actor, elapsed, { actors: this.options.actors, bodies: this.bodies,
        trace: (start, end, bounds) => this.bodyTrace(actor, start, end, [], newToss, bounds), hitActor: trace => this.hitActor(trace),
        impact: trace => this.impact(actor, trace), takeKillVelocity: () => this.options.takeKillVelocity?.(actor) ?? false });
    }
    let state = this.bodies.read(actor.id);
    if (state === null) return undefined;
    let originalVelocity = state.velocity;
    const primal = state.velocity, planes: Vec3[] = [];
    let remaining = elapsed;
    this.writeLive(actor, { ground: null });
    for (let bump = 0; bump < 4; bump++) {
      state = this.bodies.read(actor.id); if (state === null) return undefined;
      const trace = this.bodyTrace(actor, state.origin, this.add(state.origin, this.scale(state.velocity, remaining)), [], newToss);
      if (trace.allSolid) { this.writeLive(actor, { velocity: zero }); return undefined; }
      if (trace.fraction > 0) { this.writeLive(actor, { origin: trace.end }); originalVelocity = state.velocity; planes.length = 0; }
      if (trace.fraction === 1) break;
      const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : trace.sourcePlane.normal;
      const hit = this.hitActor(trace), target = hit === null ? null : this.options.actors.resolveOwned(hit);
      const down = this.motion(actor)?.gravityVector ?? { x: 0, y: 0, z: -1 };
      if ((newToss ? normal.z > 0.7 : this.dot(normal, down) < -0.7) && hit !== null && (trace.hit.kind === "world" || target !== null && this.solid(target)?.solid === "brush")) this.writeLive(actor, { ground: hit });
      this.impact(actor, trace);
      if (!this.live(actor)) return undefined;
      remaining = this.n.subtract(remaining, this.n.multiply(remaining, trace.fraction));
      if (planes.length >= 5) { this.writeLive(actor, { velocity: zero }); return undefined; }
      planes.push(normal);
      let velocity: Vec3 | null = null;
      for (const plane of planes) {
        const candidate = this.clip(originalVelocity, plane);
        if (planes.every(other => other === plane || this.family(actor) !== "q1" && other.x === plane.x && other.y === plane.y && other.z === plane.z || this.dot(candidate, other) >= 0)) { velocity = candidate; break; }
      }
      if (velocity === null) {
        const a = planes[0], b = planes[1];
        if (planes.length !== 2 || a === undefined || b === undefined) velocity = zero;
        else {
          const direction = this.vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
          const current = this.bodies.read(actor.id); velocity = current === null ? zero : this.scale(direction, this.dot(direction, current.velocity));
        }
      }
      if (this.dot(velocity, primal) <= 0) { this.writeLive(actor, { velocity: zero }); break; }
      this.writeLive(actor, { velocity });
    }
    return undefined;
  }
  waterTransition(actor: OwnedActor, previousOrigin: Vec3): undefined {
    const body = this.bodies.read(actor.id); if (body === null) return undefined;
    const family = this.family(actor), before = this.actorFlags(actor);
    const contents = this.options.scene.pointContents({ point: body.origin, target: { kind: "world" },
      policy: this.policy(family, defaultMask), numeric: this.options.numeric, passActor: actor.id });
    const value = contents.kind === "q2" ? contents.merged : contents.contents;
    const wet = family === "q1" ? value <= -3 && value >= -5 || value <= -9 && value >= -14 : (value & 56) !== 0;
    const wasWet = (before.waterLevel ?? 0) !== 0;
    this.setFlags(actor, { waterLevel: wet ? 1 : 0, waterType: value });
    if (wet !== wasWet) this.emit({ actor: actor.id, kind: wet ? "water-enter" : "water-leave", origin: wet ? previousOrigin : body.origin });
    return undefined;
  }
  step(actor: OwnedActor, elapsed: number): "moved" | "stopped" | "team-slave" | "removed" | undefined {
    if (!Number.isFinite(elapsed) || elapsed < 0) throw new RangeError("Invalid physics interval");
    let state = this.bodies.read(actor.id);
    const motion = this.motion(actor);
    if (state === null || motion === null || elapsed === 0 || motion.kind === "stationary") return undefined;
    if (this.bodies.attachment(actor.id) !== null) {
      if (motion.kind === "fly" || motion.kind === "fly-missile") this.writeLive(actor, { angles: this.add(state.angles, this.scale(motion.angularVelocity, elapsed)) });
      this.pushEntity(actor, zero);
      if (this.live(actor)) this.waterTransition(actor, state.origin);
      return undefined;
    }
    if (motion.kind === "push" || motion.kind === "stop") { this.pushMove(actor, this.scale(state.velocity, elapsed), this.scale(motion.angularVelocity, elapsed)); return undefined; }
    const family = this.family(actor), flags = this.actorFlags(actor);
    if (motion.kind === "new-toss") {
      return stepQ2NewToss(actor, elapsed, motion, { actors: this.options.actors, bodies: this.bodies, numeric: this.n,
        edition: this.options.q2Edition ?? "classic", worldGravity: this.worldGravity, maxVelocity: this.options.maxVelocity ?? 2000,
        stopSpeed: this.options.stopSpeed?.() ?? 100, teamSlave: flags.teamSlave ?? false,
        water: () => { const water = this.actorFlags(actor); return { waterLevel: water.waterLevel ?? 0, waterType: water.waterType ?? 0 }; },
        trace: (start, end) => this.bodyTrace(actor, start, end, [], true),
        hitActor: trace => trace.hit.kind === "actor" ? trace.hit.actor : this.options.worldActor(),
        flyMove: frame => this.flyMove(actor, frame, true),
        writeAngularVelocity: angularVelocity => { this.motions.set(actor, { ...motion, angularVelocity }); this.options.writeAngularVelocity?.(actor, angularVelocity); return undefined; },
        touchTriggers: () => this.touchTriggers(actor), pointContents: point => {
          const contents = this.options.scene.pointContents({ point, target: { kind: "world" }, policy: this.policy("q2", -1), numeric: this.options.numeric, passActor: actor.id });
          if (contents.kind !== "q2") throw new Error("NewToss requires Q2 contents representation"); return contents.stored;
        }, writeWater: (waterLevel, waterType) => this.setFlags(actor, { waterLevel, waterType }),
        waterSound: origin => { this.emit({ actor: this.options.worldActor() ?? actor.id, kind: "water-enter", origin }); return undefined; },
      });
    }
    if (state.ground !== null && (!this.options.actors.isLive(state.ground) || family !== "q1" && this.dot(state.velocity, motion.gravityVector) < 0)) { this.writeLive(actor, { ground: null }); state = this.bodies.read(actor.id); }
    if (state === null) return undefined;
    const maximum = this.options.maxVelocity ?? 2000;
    const clamp = (v: number): number => Number.isFinite(v) ? Math.max(-maximum, Math.min(maximum, v)) : 0;
    let velocity = this.vector(clamp(state.velocity.x), clamp(state.velocity.y), clamp(state.velocity.z));
    if (motion.kind === "step") {
      if (family === "q1") {
        if (state.ground !== null || flags.fly || flags.swim) return undefined;
        const hitSound = state.velocity.z < -this.worldGravity * 0.1;
        velocity = this.add(state.velocity, this.scale(motion.gravityVector, motion.gravity * this.worldGravity * elapsed));
        this.writeLive(actor, { velocity: this.vector(clamp(velocity.x), clamp(velocity.y), clamp(velocity.z)) });
        this.flyMove(actor, elapsed);
        if (this.live(actor)) { this.bodies.link(actor); this.touchTriggers(actor); }
        const landed = this.bodies.read(actor.id);
        if (hitSound && landed?.ground != null) this.emit({ actor: actor.id, kind: "land", origin: landed.origin });
        return undefined;
      }
      if (state.ground === null && this.dot(velocity, motion.gravityVector) >= -100) {
        const floor = this.bodyTrace(actor, state.origin, this.add(state.origin, this.scale(motion.gravityVector, 0.25)));
        if (floor.fraction < 1 && !floor.startSolid && this.dot(floor.sourcePlane.normal, motion.gravityVector) <= -0.7) { this.writeLive(actor, { ground: this.hitActor(floor) }); state = this.bodies.read(actor.id) ?? state; }
      }
      const wasGrounded = state.ground !== null, fallingFast = this.dot(state.velocity, motion.gravityVector) > this.worldGravity * 0.1;
      this.writeLive(actor, { angles: this.add(state.angles, this.scale(motion.angularVelocity, elapsed)) });
      if (this.moving(motion.angularVelocity)) {
        const adjustment = elapsed * 600;
        const friction = (value: number): number => value > 0 ? Math.max(0, value - adjustment) : Math.min(0, value + adjustment);
        const angular = this.vector(friction(motion.angularVelocity.x), friction(motion.angularVelocity.y), friction(motion.angularVelocity.z));
        this.motions.set(actor, { ...motion, angularVelocity: angular }); this.options.writeAngularVelocity?.(actor, angular);
      }
      if (state.ground === null && !flags.fly && !(flags.swim && (flags.waterLevel ?? 0) > 2) && (flags.waterLevel ?? 0) === 0)
        velocity = this.add(velocity, this.scale(motion.gravityVector, motion.gravity * this.worldGravity * elapsed));
      if (flags.fly && velocity.z !== 0) {
        const speed = Math.abs(velocity.z), factor = Math.max(0, speed - elapsed * Math.max(speed, 100) * 2) / speed;
        velocity = this.vector(velocity.x, velocity.y, velocity.z * factor);
      }
      if (flags.swim && velocity.z !== 0) {
        const speed = Math.abs(velocity.z), factor = Math.max(0, speed - elapsed * Math.max(speed, 100) * (flags.waterLevel ?? 0)) / speed;
        velocity = this.vector(velocity.x, velocity.y, velocity.z * factor);
      }
      if (this.moving(velocity)) {
        if (state.ground !== null || flags.fly || flags.swim) {
          const speed = Math.hypot(velocity.x, velocity.y);
          if (speed > 0 && (!flags.dead || this.checkBottom(actor, state))) {
            const fraction = Math.max(0, speed - elapsed * Math.max(speed, 100) * 6) / speed;
            velocity = this.vector(velocity.x * fraction, velocity.y * fraction, velocity.z);
          }
        }
        this.writeLive(actor, { velocity });
        this.flyMove(actor, elapsed);
        if (this.live(actor)) { this.bodies.link(actor); this.touchTriggers(actor); }
        const landed = this.bodies.read(actor.id);
        if (!wasGrounded && fallingFast && landed !== null && landed.ground !== null) this.emit({ actor: actor.id, kind: "land", origin: landed.origin });
      } else this.writeLive(actor, { velocity });
      return undefined;
    }
    if (state.ground !== null) return undefined;
    if (motion.kind !== "fly" && motion.kind !== "fly-missile" && motion.kind !== "wall-bounce") velocity = this.add(velocity, this.scale(motion.gravityVector, motion.gravity * this.worldGravity * elapsed));
    this.writeLive(actor, { velocity, angles: this.add(state.angles, this.scale(motion.angularVelocity, elapsed)) });
    const trace = this.pushEntity(actor, this.scale(velocity, elapsed));
    this.waterTransition(actor, state.origin);
    state = this.bodies.read(actor.id);
    if (state === null || trace.fraction === 1) return undefined;
    const currentMotion = this.motion(actor) ?? motion;
    const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : trace.sourcePlane.normal;
    velocity = this.clip(state.velocity, normal, currentMotion.kind === "wall-bounce" ? 2 : currentMotion.kind === "bounce" ? 1.5 : 1);
    if (currentMotion.kind !== "wall-bounce" && this.dot(normal, currentMotion.gravityVector) < -0.7 && (this.dot(velocity, currentMotion.gravityVector) > -60 || currentMotion.kind !== "bounce")) {
      this.writeLive(actor, { velocity: zero, ground: this.hitActor(trace) });
      this.motions.set(actor, { ...currentMotion, velocity: zero, angularVelocity: zero });
      this.options.writeAngularVelocity?.(actor, zero);
    } else this.writeLive(actor, { velocity });
    return undefined;
  }

  commitAttachments(): undefined { return this.bodies.transportAttachments(this.n); }
}
