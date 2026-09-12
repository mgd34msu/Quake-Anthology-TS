/* WinQuake/sv_move.c and PF_changeyaw/PF_walkmove from pr_cmds.c.
 * Copyright (C) 1996-1997 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { NumericOperations, RandomSource } from "../../contracts/numeric.ts";
import type { SceneQueries, TraceHit, TraceResult } from "../../contracts/scene.ts";
import { MovementMath } from "./common.ts";
import { Q1_CONTENTS_EMPTY, Q1_CONTENTS_SOLID, Q1_FLAG_FLY, Q1_FLAG_ONGROUND, Q1_FLAG_SWIM, Q1_STEP_HEIGHT } from "./types.ts";

export const Q1_FLAG_PARTIALGROUND = 1024;

export interface Q1MonsterMoveState {
  readonly origin: Vec3;
  readonly angles: Vec3;
  readonly bounds: Bounds;
  readonly absoluteBounds: Bounds;
  readonly flags: number;
  readonly ground: TraceHit;
  readonly idealYaw: number;
  readonly yawSpeed: number;
  readonly enemy: ActorId | null;
}

export interface Q1MonsterMoveServices {
  readonly scene: SceneQueries;
  readonly numeric: NumericOperations;
  readonly random: Pick<RandomSource, "nextInteger">;
  read(actor: ActorId): Q1MonsterMoveState | null;
  readTarget(actor: ActorId): Pick<Q1MonsterMoveState, "origin" | "absoluteBounds"> | null;
  write(actor: OwnedActor, state: Q1MonsterMoveState): undefined;
  /** Source linking may call nested triggers, teleport, or remove the actor. */
  link(actor: OwnedActor, touchTriggers: boolean): undefined;
}

/** Movement builtins share the simulation's actor, collision, and random owners. */
export class Q1MonsterMovement {
  readonly #math: MovementMath;
  constructor(readonly services: Q1MonsterMoveServices) { this.#math = new MovementMath(services.numeric); }
  private trace(actor: ActorId, start: Vec3, end: Vec3, bounds: Bounds | null): TraceResult {
    return this.services.scene.trace({ start, end, shape: bounds === null ? { kind: "point" } : { kind: "box", bounds },
      target: { kind: "world" }, policy: { kind: "q1", move: bounds === null ? "no-monsters" : "normal", hull: null },
      numeric: this.services.numeric.profile, passActor: actor });
  }
  private contents(actor: ActorId, point: Vec3): number {
    const result = this.services.scene.pointContents({ point, target: { kind: "world" },
      policy: { kind: "q1", move: "normal", hull: null }, numeric: this.services.numeric.profile, passActor: actor });
    if (result.kind !== "q1") throw new Error("Quake monster contents require Q1 policy translation");
    return result.contents;
  }
  private angleMod(angle: number): number {
    const n = this.services.numeric;
    return n.multiply(360 / 65536, n.toInt32(n.multiply(angle, 65536 / 360)) & 65535);
  }
  changeYaw(actor: OwnedActor): undefined {
    const state = this.services.read(actor.id);
    if (state === null) return undefined;
    const n = this.services.numeric, current = this.angleMod(state.angles.y), ideal = state.idealYaw;
    if (current === ideal) return undefined;
    let move = n.subtract(ideal, current);
    if (ideal > current) { if (move >= 180) move = n.subtract(move, 360); }
    else if (move <= -180) move = n.add(move, 360);
    move = move > 0 ? Math.min(move, state.yawSpeed) : Math.max(move, -state.yawSpeed);
    this.services.write(actor, { ...state, angles: this.#math.vec(state.angles.x, this.angleMod(n.add(current, move)), state.angles.z) });
    return undefined;
  }
  checkBottom(actor: ActorId): boolean {
    const state = this.services.read(actor);
    if (state === null) return false;
    const m = this.#math, n = m.n;
    const minimum = m.add(state.origin, state.bounds.min), maximum = m.add(state.origin, state.bounds.max);
    let easy = true;
    cornerCheck: for (const x of [minimum.x, maximum.x]) for (const y of [minimum.y, maximum.y]) {
      if (this.contents(actor, m.vec(x, y, n.subtract(minimum.z, 1))) !== Q1_CONTENTS_SOLID) { easy = false; break cornerCheck; }
    }
    if (easy) return true;
    const middle = m.vec(n.multiply(n.add(minimum.x, maximum.x), 0.5), n.multiply(n.add(minimum.y, maximum.y), 0.5), minimum.z);
    const endZ = n.subtract(minimum.z, 2 * Q1_STEP_HEIGHT);
    const trace = this.trace(actor, middle, m.vec(middle.x, middle.y, endZ), null);
    if (trace.fraction === 1) return false;
    const middleHeight = trace.end.z;
    for (const x of [minimum.x, maximum.x]) for (const y of [minimum.y, maximum.y]) {
      const corner = this.trace(actor, m.vec(x, y, minimum.z), m.vec(x, y, endZ), null);
      if (corner.fraction === 1 || n.subtract(middleHeight, corner.end.z) > Q1_STEP_HEIGHT) return false;
    }
    return true;
  }
  moveStep(actor: OwnedActor, move: Vec3, relink: boolean): boolean {
    let state = this.services.read(actor.id);
    if (state === null) return false;
    const m = this.#math, n = m.n, original = state.origin;
    let destination = m.add(state.origin, move);
    if ((state.flags & (Q1_FLAG_SWIM | Q1_FLAG_FLY)) !== 0) {
      for (let attempt = 0; attempt < 2; attempt++) {
        destination = m.add(state.origin, move);
        const enemy = state.enemy === null ? null : this.services.readTarget(state.enemy);
        if (attempt === 0 && enemy !== null) {
          const dz = n.subtract(state.origin.z, enemy.origin.z);
          if (dz > 40) destination = m.vec(destination.x, destination.y, n.subtract(destination.z, 8));
          if (dz < 30) destination = m.vec(destination.x, destination.y, n.add(destination.z, 8));
        }
        const trace = this.trace(actor.id, state.origin, destination, state.bounds);
        if (trace.fraction === 1) {
          if ((state.flags & Q1_FLAG_SWIM) !== 0 && this.contents(actor.id, trace.end) === Q1_CONTENTS_EMPTY) return false;
          this.services.write(actor, { ...state, origin: trace.end });
          if (relink) this.services.link(actor, true);
          return true;
        }
        if (enemy === null) break;
      }
      return false;
    }
    destination = m.vec(destination.x, destination.y, n.add(destination.z, Q1_STEP_HEIGHT));
    const end = m.vec(destination.x, destination.y, n.subtract(destination.z, Q1_STEP_HEIGHT * 2));
    let trace = this.trace(actor.id, destination, end, state.bounds);
    if (trace.allSolid) return false;
    if (trace.startSolid) {
      destination = m.vec(destination.x, destination.y, n.subtract(destination.z, Q1_STEP_HEIGHT));
      trace = this.trace(actor.id, destination, end, state.bounds);
      if (trace.allSolid || trace.startSolid) return false;
    }
    if (trace.fraction === 1) {
      if ((state.flags & Q1_FLAG_PARTIALGROUND) === 0) return false;
      this.services.write(actor, { ...state, origin: m.add(state.origin, move) });
      if (relink) this.services.link(actor, true);
      state = this.services.read(actor.id);
      if (state !== null) this.services.write(actor, { ...state, flags: state.flags & ~Q1_FLAG_ONGROUND });
      return true;
    }
    state = { ...state, origin: trace.end };
    this.services.write(actor, state);
    if (!this.checkBottom(actor.id)) {
      if ((state.flags & Q1_FLAG_PARTIALGROUND) !== 0) {
        if (relink) this.services.link(actor, true);
        return true;
      }
      this.services.write(actor, { ...state, origin: original });
      return false;
    }
    if (trace.hit.kind === "none") throw new Error("Quake monster step landed without a ground hit");
    this.services.write(actor, { ...state, flags: state.flags & ~Q1_FLAG_PARTIALGROUND, ground: trace.hit });
    if (relink) this.services.link(actor, true);
    return true;
  }
  stepDirection(actor: OwnedActor, yaw: number, distance: number): boolean {
    let state = this.services.read(actor.id);
    if (state === null) return false;
    this.services.write(actor, { ...state, idealYaw: this.services.numeric.store(yaw) });
    this.changeYaw(actor);
    state = this.services.read(actor.id);
    if (state === null) return false;
    const m = this.#math, n = m.n, radians = n.divide(n.multiply(n.multiply(yaw, Math.PI), 2), 360);
    const move = m.vec(n.multiply(Math.cos(radians), distance), n.multiply(Math.sin(radians), distance), 0);
    const original = state.origin, moved = this.moveStep(actor, move, false);
    state = this.services.read(actor.id);
    if (state === null) return moved;
    if (moved) {
      const delta = n.subtract(state.angles.y, state.idealYaw);
      if (delta > 45 && delta < 315) this.services.write(actor, { ...state, origin: original });
    }
    this.services.link(actor, true);
    return moved;
  }
  walkMove(actor: OwnedActor, yaw: number, distance: number): boolean {
    const state = this.services.read(actor.id);
    if (state === null || (state.flags & (Q1_FLAG_ONGROUND | Q1_FLAG_FLY | Q1_FLAG_SWIM)) === 0) return false;
    const m = this.#math, n = m.n, radians = n.divide(n.multiply(n.multiply(yaw, Math.PI), 2), 360);
    return this.moveStep(actor, m.vec(n.multiply(Math.cos(radians), distance), n.multiply(Math.sin(radians), distance), 0), true);
  }
  closeEnough(actor: ActorId, goal: ActorId, distance: number): boolean {
    const self = this.services.read(actor), target = this.services.readTarget(goal);
    if (self === null || target === null) return false;
    const n = this.services.numeric, a = self.absoluteBounds, b = target.absoluteBounds;
    return b.min.x <= n.add(a.max.x, distance) && b.max.x >= n.subtract(a.min.x, distance)
      && b.min.y <= n.add(a.max.y, distance) && b.max.y >= n.subtract(a.min.y, distance)
      && b.min.z <= n.add(a.max.z, distance) && b.max.z >= n.subtract(a.min.z, distance);
  }
  newChaseDirection(actor: OwnedActor, goal: ActorId, distance: number): undefined {
    const state = this.services.read(actor.id), enemy = this.services.readTarget(goal);
    if (state === null || enemy === null) return undefined;
    const n = this.services.numeric;
    const oldDirection = this.angleMod(n.multiply(n.toInt32(n.divide(state.idealYaw, 45)), 45));
    const turnaround = this.angleMod(n.subtract(oldDirection, 180));
    const dx = n.subtract(enemy.origin.x, state.origin.x), dy = n.subtract(enemy.origin.y, state.origin.y);
    let first = dx > 10 ? 0 : dx < -10 ? 180 : -1;
    let second = dy < -10 ? 270 : dy > 10 ? 90 : -1;
    const tryStep = (direction: number): boolean => {
      if (this.services.read(actor.id) === null) return true;
      return this.stepDirection(actor, direction, distance);
    };
    if (first !== -1 && second !== -1) {
      // The southwest constant is 215 in both released source and donor.
      const diagonal = first === 0 ? second === 90 ? 45 : 315 : second === 90 ? 135 : 215;
      if (diagonal !== turnaround && tryStep(diagonal)) return undefined;
    }
    if (((this.services.random.nextInteger() & 3) & 1) !== 0 || Math.abs(dy) > Math.abs(dx)) [first, second] = [second, first];
    if (first !== -1 && first !== turnaround && tryStep(first)) return undefined;
    if (second !== -1 && second !== turnaround && tryStep(second)) return undefined;
    if (oldDirection !== -1 && tryStep(oldDirection)) return undefined;
    if ((this.services.random.nextInteger() & 1) !== 0) {
      for (let direction = 0; direction <= 315; direction += 45) if (direction !== turnaround && tryStep(direction)) return undefined;
    } else {
      for (let direction = 315; direction >= 0; direction -= 45) if (direction !== turnaround && tryStep(direction)) return undefined;
    }
    if (turnaround !== -1 && tryStep(turnaround)) return undefined;
    const current = this.services.read(actor.id);
    if (current !== null) {
      this.services.write(actor, { ...current, idealYaw: oldDirection });
      if (!this.checkBottom(actor.id)) {
        const after = this.services.read(actor.id);
        if (after !== null) this.services.write(actor, { ...after, flags: after.flags | Q1_FLAG_PARTIALGROUND });
      }
    }
    return undefined;
  }
  moveToGoal(actor: OwnedActor, goal: ActorId, distance: number, mode: "range" | "contact" = "range"): undefined {
    const state = this.services.read(actor.id);
    if (state === null || (state.flags & (Q1_FLAG_ONGROUND | Q1_FLAG_FLY | Q1_FLAG_SWIM)) === 0) return undefined;
    if (mode === "range" && state.enemy !== null && this.closeEnough(actor.id, goal, distance)) return undefined;
    if ((this.services.random.nextInteger() & 3) === 1 || !this.stepDirection(actor, state.idealYaw, distance)) {
      if (this.services.read(actor.id) !== null) this.newChaseDirection(actor, goal, distance);
    }
    return undefined;
  }
}

export function createQ1MonsterMovement(services: Q1MonsterMoveServices): Q1MonsterMovement { return new Q1MonsterMovement(services); }
