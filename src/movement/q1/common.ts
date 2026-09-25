import { movementBounds } from "../body-shape.ts";
/* Movement kernels derived from Quake sv_phys.c, sv_user.c and QW pmove.c.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { AngleVectors, Bounds, Vec3 } from "../../contracts/math.ts";
import type { MovementContact, MovementEffect, MovementServices, MovementState, OrderedMovementEffect } from "../../contracts/movement.ts";
import type { NumericOperations } from "../../contracts/numeric.ts";
import type { TraceHit, TraceResult, TraceShape } from "../../contracts/scene.ts";
import type { SourceTime } from "../../contracts/time.ts";
import { angleVectors, createMutableVectorMath, donorAngleVectors } from "../../core/math.ts";
import type { Q1MovementOptions, Q1PlayerInput } from "./types.ts";

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const NONE: TraceHit = { kind: "none" };
export const WORLD: TraceHit = { kind: "world", model: 0 };

export function shapeBounds(shape: TraceShape): Bounds {
  return shape.kind === "point" ? { min: ZERO, max: ZERO } : shape.bounds;
}
export function seconds(time: SourceTime): number { return time.kind === "seconds" ? time.value : time.value / 1000; }
export class MovementMath {
  readonly v;
  constructor(readonly n: NumericOperations) { this.v = createMutableVectorMath(n, "preserve"); }
  vec(x = 0, y = 0, z = 0): Vec3 { return { x: this.n.store(x), y: this.n.store(y), z: this.n.store(z) }; }
  add(a: Vec3, b: Vec3): Vec3 { const out = { ...ZERO }; this.v.VectorAdd(a, b, out); return out; }
  sub(a: Vec3, b: Vec3): Vec3 { const out = { ...ZERO }; this.v.VectorSubtract(a, b, out); return out; }
  scale(a: Vec3, b: number): Vec3 { const out = { ...ZERO }; this.v.VectorScale(a, b, out); return out; }
  ma(a: Vec3, b: number, c: Vec3): Vec3 { const out = { ...ZERO }; this.v.VectorMA(a, b, c, out); return out; }
  dot(a: Vec3, b: Vec3): number { return this.v.DotProduct(a, b); }
  length(a: Vec3): number { return this.v.VectorLength(a); }
  normalize(a: Vec3): { readonly direction: Vec3; readonly length: number } {
    const direction = { ...a }; const length = this.v.VectorNormalize(direction); return { direction, length };
  }
  cross(a: Vec3, b: Vec3): Vec3 { const out = { ...ZERO }; this.v.CrossProduct(a, b, out); return out; }
  angles(value: Vec3): AngleVectors {
    if (this.n.profile.arithmetic.kind !== "donor-binary64") return angleVectors(value);
    const forward = { ...ZERO }, right = { ...ZERO }, up = { ...ZERO };
    donorAngleVectors(value, forward, right, up);
    return { forward, right, up };
  }
  clip(velocity: Vec3, normal: Vec3, overbounce: number): Vec3 {
    const backoff = this.n.multiply(this.dot(velocity, normal), overbounce);
    const out = this.vec(this.n.subtract(velocity.x, this.n.multiply(normal.x, backoff)),
      this.n.subtract(velocity.y, this.n.multiply(normal.y, backoff)),
      this.n.subtract(velocity.z, this.n.multiply(normal.z, backoff)));
    return this.vec(Math.abs(out.x) < 0.1 ? 0 : out.x, Math.abs(out.y) < 0.1 ? 0 : out.y, Math.abs(out.z) < 0.1 ? 0 : out.z);
  }
  horizontal(a: Vec3): number { return this.n.squareRoot(this.n.add(this.n.multiply(a.x, a.x), this.n.multiply(a.y, a.y))); }
}

export class MovementContext {
  readonly math: MovementMath;
  readonly contacts: MovementContact[] = [];
  readonly effects: OrderedMovementEffect[] = [];
  get viewHeight(): number { return this.input.environment.pose?.viewHeight ?? this.options.viewHeight ?? 22; }
  private sourceMode: number;
  private ownedBounds: Bounds | null = null;
  private modeProjected = false;
  projectClientMode(): void { this.modeProjected = true; }
  removed = false;
  substep = 0;
  constructor(readonly input: Q1PlayerInput, readonly services: MovementServices, readonly options: Q1MovementOptions) {
    this.sourceMode = input.state.kind === "q1-netquake" ? input.state.moveType : input.state.spectator;
    this.math = new MovementMath(services.numeric);
  }
  sourceState(state: MovementState): MovementState {
    if (!this.modeProjected) return state;
    return state.kind === "q1-netquake" ? { ...state, moveType: this.sourceMode } : state.kind === "q1-quakeworld" ? { ...state, spectator: this.sourceMode } : state;
  }
  private resumed(state: MovementState): MovementState {
    if (state.kind === "q1-netquake") this.sourceMode = state.moveType;
    else if (state.kind === "q1-quakeworld") this.sourceMode = state.spectator;
    return state;
  }
  speed(value: number): number {
    const multiplier = this.input.environment.speedMultiplier ?? 1;
    return multiplier === 1 ? value : this.math.n.multiply(value, multiplier);
  }
  get shape(): TraceShape {
    if (this.input.environment.pose !== undefined) return { kind: "box", bounds: this.input.environment.pose.bounds };
    const source = this.options.hooks?.shape?.() ?? this.input.shape;
    return this.ownedBounds === null || source.kind === "point" ? source : { kind: source.kind, bounds: this.ownedBounds };
  }
  updateBodyShape(state: MovementState): void {
    const requested = this.input.environment.clientOutputs?.bodyBounds;
    if (requested === undefined || this.input.environment.pose !== undefined) { this.ownedBounds = null; return; }
    const source = this.options.hooks?.shape?.() ?? this.input.shape;
    if (source.kind === "point") throw new Error("A player body output requires a selected collision hull");
    this.ownedBounds = movementBounds(this.ownedBounds ?? this.input.currentBounds ?? source.bounds, requested, bounds => {
      const origin = state.kind === "q2-classic" ? { x: state.originEighths[0] / 8, y: state.originEighths[1] / 8, z: state.originEighths[2] / 8 } : state.origin;
      const trace = this.trace(origin, origin, { kind: source.kind, bounds });
      return !trace.startSolid && !trace.allSolid;
    });
    this.options.hooks?.bodyShape?.(this.ownedBounds);
  }
  get bounds(): Bounds { return shapeBounds(this.shape); }
  trace(start: Vec3, end: Vec3, shape = this.shape, move: "normal" | "no-monsters" | "missile" = "normal"): TraceResult {
    return this.services.scene.trace({ start, end, shape, target: { kind: "world" },
      policy: { kind: "q1", move, hull: null }, numeric: this.input.profile.numeric, passActor: this.input.actor.id });
  }
  contents(point: Vec3): number {
    const value = this.services.scene.pointContents({ point, target: { kind: "world" },
      policy: { kind: "q1", move: "normal", hull: null }, numeric: this.input.profile.numeric, passActor: this.input.actor.id });
    if (value.kind !== "q1") throw new Error("Q1 movement requires collision contents translated to its selected policy");
    // SV_PointContents/PM_PointContents collapse source currents to water.
    return value.contents <= -9 && value.contents >= -14 ? -3 : value.contents;
  }
  positionFree(origin: Vec3): boolean {
    const trace = this.trace(origin, origin);
    return !trace.startSolid && !trace.allSolid;
  }
  effect(effect: MovementEffect): void {
    this.effects.push({ substep: this.substep, sequence: this.effects.length, time: this.input.frame.time, effect });
  }
  touch(trace: TraceResult, state: MovementState, record = true): MovementState {
    if (record) this.contacts.push({ target: trace.hit, trace, substep: this.substep });
    if (trace.hit.kind === "none" || this.removed) return state;
    this.effect({ kind: "touch", target: trace.hit, substep: this.substep });
    const continuation = this.services.touch({ self: this.input.actor, other: trace.hit,
      plane: trace.contact.kind === "plane" ? trace.contact.plane : null,
      surface: trace.kind === "q2" && trace.surface !== null ? { name: trace.surface.name, nativeFlags: trace.surface.flags, nativeValue: trace.surface.value } : null }, this.sourceState(state));
    if (continuation.kind === "actor-removed") { this.removed = true; return state; }
    return this.resumed(continuation.state);
  }
  link(state: MovementState, touchTriggers: boolean): MovementState {
    if (this.removed || this.options.hooks === undefined) return state;
    const continuation = this.options.hooks.link(this.input.actor, this.sourceState(state), touchTriggers);
    if (continuation.kind === "actor-removed") { this.removed = true; return state; }
    return this.resumed(continuation.state);
  }
  lifecycle(state: MovementState, phase: "beforePhysics" | "think" | "afterPhysics", input = this.input): MovementState {
    if (this.removed) return state;
    const hook = this.options.hooks?.[phase];
    if (hook === undefined) { if (phase === "beforePhysics") this.updateBodyShape(state); return state; }
    const continuation = hook(input, this.sourceState(state));
    if (continuation.kind === "actor-removed") { this.removed = true; return state; }
    const result = this.resumed(continuation.state);
    if (phase === "beforePhysics") this.updateBodyShape(result);
    return result;
  }
  isBsp(hit: TraceHit): boolean { return hit.kind === "world" || (this.options.hooks?.isBsp(hit) ?? false); }
}
