/* Quake II rerelease m_move.cpp SV_alternate_flystep and q_vec3.h.
 * Copyright id Software. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { TraceResult } from "../../../../contracts/scene.ts";
import type { BodyState } from "../../../../contracts/world.ts";
import type { Q2RereleaseRandomSource } from "../../../../core/random/q2-rerelease.ts";
import type { Q2AlternateFlyState } from "./alternate-fly-state.ts";
import type { MonsterContext, MonsterState } from "./types.ts";

const f = Math.fround;
const minimum = (a: number, b: number): number => b < a ? b : a;
const maximum = (a: number, b: number): number => a < b ? b : a;
const pi = f(Math.PI);
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const up: Vec3 = { x: 0, y: 0, z: 1 };
const fitBounds: Bounds = { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } };
const solidMask = 1 | 2 | 0x20000;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: f(a.x + b.x), y: f(a.y + b.y), z: f(a.z + b.z) });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: f(a.x - b.x), y: f(a.y - b.y), z: f(a.z - b.z) });
const scale = (a: Vec3, b: number): Vec3 => ({ x: f(a.x * b), y: f(a.y * b), z: f(a.z * b) });
const scaled = (a: Vec3, b: Vec3): Vec3 => ({ x: f(a.x * b.x), y: f(a.y * b.y), z: f(a.z * b.z) });
const dot = (a: Vec3, b: Vec3): number => f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z));
const nonzero = (v: Vec3): boolean => v.x !== 0 || v.y !== 0 || v.z !== 0;
const nan = (v: Vec3): boolean => Number.isNaN(v.x) || Number.isNaN(v.y) || Number.isNaN(v.z);
function normal(v: Vec3): { readonly direction: Vec3; readonly length: number } {
  const length = f(Math.sqrt(dot(v, v)));
  return { direction: length === 0 ? v : scale(v, f(1 / length)), length };
}
function yaw(v: Vec3): number {
  if (v.x === 0) return v.y === 0 ? 0 : v.y > 0 ? 90 : 270;
  const angle = f(f(Math.atan2(v.y, v.x)) * f(180 / pi));
  return angle < 0 ? f(angle + 360) : angle;
}
function pitch(v: Vec3): number {
  if (v.x === 0 && v.y === 0) return v.z > 0 ? -90 : -270;
  const forward = f(Math.sqrt(f(f(v.x * v.x) + f(v.y * v.y))));
  const angle = f(f(Math.atan2(v.z, forward)) * f(180 / pi));
  return -(angle < 0 ? f(angle + 360) : angle);
}
function slerp(from: Vec3, to: Vec3, t: number): Vec3 {
  const product = dot(from, to);
  let a = f(1 - t), b = t;
  if (!(Math.abs(product) > f(0.9995))) {
    const angle = f(Math.acos(product)), sine = f(Math.sin(angle));
    a = f(f(Math.sin(f(f(1 - t) * angle))) / sine);
    b = f(f(Math.sin(f(t * angle))) / sine);
  }
  return add(scale(from, a), scale(to, b));
}

export type Q2AlternateFlySteeringState = Q2AlternateFlyState & Pick<MonsterState,
  "medic" | "combatPoint" | "soundTarget" | "lostSight" | "manualSteering" | "waterLevel" | "idealYaw">;
export interface Q2AlternateFlyInput {
  readonly state: Q2AlternateFlySteeringState;
  readonly body: BodyState;
  readonly enemy: BodyState | null;
  readonly goal: Vec3 | null;
  readonly flags: number;
  readonly now: number;
  readonly frameSeconds: number;
}
export interface Q2AlternateFlyServices {
  readonly random: Q2RereleaseRandomSource;
  trace(start: Vec3, end: Vec3, bounds: Bounds | null, mask: number): TraceResult;
  pointContents(point: Vec3): number;
  visibleEnemy(): boolean;
}
export type Q2AlternateFlyResult = { readonly kind: "fallback" }
  | { readonly kind: "steered"; readonly velocity: Vec3; readonly pitch: number | null };

function idealHover(input: Q2AlternateFlyInput, random: Q2RereleaseRandomSource): Vec3 {
  const state = input.state;
  if (input.enemy === null && !state.medic || state.combatPoint || state.soundTarget !== null || state.hintPath || state.pathing !== null) return zero;
  const theta = random.float(f(2 * pi));
  const phi = f(Math.acos(state.flyAbove ? f(f(0.7) + random.float(f(0.3)))
    : state.flyBuzzard || state.medic ? random.float() : f(random.float(-1, 1) * f(0.06))));
  return scale({ x: f(f(Math.sin(phi)) * f(Math.cos(theta))), y: f(f(Math.sin(phi)) * f(Math.sin(theta))), z: f(Math.cos(phi)) },
    random.float(state.flyMinDistance, state.flyMaxDistance));
}

/** Source AI only changes steering velocity and pitch. The shared physics step
 * remains responsible for moving the body, gravity, impacts and relinking. */
export function steerQ2AlternateFly(input: Q2AlternateFlyInput, services: Q2AlternateFlyServices): Q2AlternateFlyResult {
  const { state, body, enemy } = input;
  if ((input.flags & 2) !== 0 && state.waterLevel < 3) return { kind: "steered", velocity: body.velocity, pitch: null };
  if (state.flyPositionTime <= input.now || enemy !== null && state.flyPinned && !services.visibleEnemy()) {
    state.flyPinned = false;
    state.flyPositionTime = (Math.round(input.now * 1000) + services.random.timeMilliseconds(3000, 10000)) / 1000;
    state.flyIdealPosition = idealHover(input, services.random);
  }
  const initial = normal(body.velocity), direction = initial.direction;
  let currentSpeed = initial.length;
  if (nan(direction)) return { kind: "fallback" };
  let target: Vec3, targetVelocity = zero;
  if (state.pathing !== null) target = state.pathing.traversalPending ? state.pathing.secondMovePoint : state.pathing.firstMovePoint;
  else if (enemy !== null && !state.combatPoint && state.soundTarget === null && !state.lostSight) { target = enemy.origin; targetVelocity = enemy.velocity; }
  else if (input.goal !== null) target = input.goal;
  else {
    if (currentSpeed > 0) currentSpeed = maximum(0, f(currentSpeed - state.flyAcceleration));
    else if (currentSpeed < 0) currentSpeed = minimum(0, f(currentSpeed + state.flyAcceleration));
    return { kind: "steered", velocity: currentSpeed === initial.length ? body.velocity : scale(direction, currentSpeed), pitch: null };
  }
  let wantedPosition = state.flyPinned ? state.flyIdealPosition
    : state.pathing !== null || state.combatPoint || state.soundTarget !== null || state.lostSight ? target
      : add(add(target, scale(targetVelocity, f(0.25))), state.flyIdealPosition);
  const fit = services.trace(target, wantedPosition, fitBounds, solidMask);
  if (!fit.allSolid) wantedPosition = fit.end;
  let difference = sub(wantedPosition, body.origin);
  if (difference.z > body.bounds.min.z && difference.z < body.bounds.max.z) difference = { ...difference, z: 0 };
  const wanted = normal(difference);
  let wantedDirection = wanted.direction;
  if (!state.manualSteering) state.idealYaw = yaw(normal(sub(target, body.origin)).direction);
  const obstruction = services.trace(body.origin, add(body.origin, scale(wantedDirection, state.flyAcceleration)), body.bounds, solidMask);
  const angle = f(body.angles.y * f(f(pi * 2) / 360)), sine = f(Math.sin(angle)), cosine = f(Math.cos(angle));
  const forward: Vec3 = { x: cosine, y: sine, z: -0 }, right: Vec3 = { x: sine, y: -cosine, z: -0 };
  if (obstruction.fraction < f(0.25)) {
    const visiblePosition = (height: number, endHeight: number): boolean => {
      const start = add(body.origin, { x: 0, y: 0, z: height });
      return services.trace(start, wantedPosition, null, solidMask).fraction === 1
        && services.trace(body.origin, add(body.origin, { x: 0, y: 0, z: endHeight }), body.bounds, solidMask).fraction === 1;
    };
    const bottomVisible = visiblePosition(body.bounds.min.z, f(body.bounds.min.z - state.flyAcceleration));
    const topVisible = visiblePosition(body.bounds.max.z, f(body.bounds.max.z + state.flyAcceleration));
    if (bottomVisible === topVisible) {
      const front = add(body.origin, scaled(forward, body.bounds.max)), side = scaled(right, body.bounds.max);
      const leftVisible = services.trace(sub(front, side), wantedPosition, null, solidMask).fraction === 1;
      const rightVisible = services.trace(add(front, side), wantedPosition, null, solidMask).fraction === 1;
      wantedDirection = leftVisible !== rightVisible ? rightVisible ? add(wantedDirection, right) : sub(wantedDirection, right) : obstruction.sourcePlane.normal;
    } else wantedDirection = topVisible ? add(wantedDirection, up) : sub(wantedDirection, up);
    wantedDirection = normal(wantedDirection).direction;
  }
  const direct = state.flyThrusters && !state.flyPinned || state.pathing !== null || state.combatPoint || state.lostSight;
  const turnFactor = direct && dot(direction, wantedDirection) > 0 ? f(0.45)
    : minimum(1, f(f(0.84) + f(f(0.08) * f(currentSpeed / state.flySpeed))));
  let finalDirection = nonzero(direction) ? direction : wantedDirection;
  if (nan(finalDirection)) return { kind: "fallback" };
  const swimming = (input.flags & 2) !== 0, flying = (input.flags & 1) !== 0;
  const avoidWater = swimming || flying && state.waterLevel < 3;
  const waterAhead = avoidWater && (services.pointContents(add(body.origin, scale(wantedDirection, currentSpeed))) & 32) !== 0;
  const badDirection = swimming ? !waterAhead : flying && state.waterLevel < 3 && waterAhead;
  if (badDirection) {
    if (state.flyRecoveryTime < input.now) {
      state.flyRecoveryDirection = normal({ x: services.random.float(-1, 1), y: services.random.float(-1, 1), z: services.random.float(-1, 1) }).direction;
      state.flyRecoveryTime = (Math.round(input.now * 1000) + 1000) / 1000;
    }
    wantedDirection = state.flyRecoveryDirection;
  }
  if (nonzero(direction) && turnFactor > 0) finalDirection = normal(slerp(direction, wantedDirection, f(1 - turnFactor))).direction;
  let speedFactor = enemy === null || direct ? 1 : dot(forward, wantedDirection) < -0.25 && nonzero(direction) ? 0 : minimum(1, f(wanted.length / state.flySpeed));
  if (badDirection) speedFactor = -speedFactor;
  let acceleration = state.flyAcceleration;
  if (dot(finalDirection, wantedDirection) < f(0.25)) acceleration = f(acceleration * 2);
  const wantedSpeed = state.manualSteering ? 0 : f(state.flySpeed * speedFactor);
  if (currentSpeed > wantedSpeed) currentSpeed = maximum(wantedSpeed, f(currentSpeed - acceleration));
  else if (currentSpeed < wantedSpeed) currentSpeed = minimum(wantedSpeed, f(currentSpeed + acceleration));
  if (nan(finalDirection) || Number.isNaN(currentSpeed)) return { kind: "fallback" };
  let newPitch = 0;
  if (enemy !== null && (state.flyBuzzard || state.medic)) {
    let desired = -pitch(normal(sub(body.origin, target)).direction);
    if (f(desired - body.angles.x) > 180) desired = f(desired - 360);
    if (f(desired - body.angles.x) < -180) desired = f(desired + 360);
    newPitch = f(body.angles.x + f(f(f(input.frameSeconds) * 4) * f(desired - body.angles.x)));
  }
  return { kind: "steered", velocity: scale(finalDirection, currentSpeed), pitch: newPitch };
}

export function alternateFlyStep(context: MonsterContext): boolean {
  const { game, entity, state } = context, body = game.body(entity);
  const random = game.host.rereleaseRandom;
  if (random === undefined) throw new Error("Rerelease alternate flying requires the shared rerelease random stream");
  const enemy = entity.enemy === null ? null : game.host.bodies.read(entity.enemy);
  const result = steerQ2AlternateFly({ state, body, enemy, goal: entity.goal === null ? null : game.host.bodies.read(entity.goal)?.origin ?? null,
    flags: entity.flags, now: game.host.now(), frameSeconds: game.host.frameSeconds() }, {
    random, trace: (start, end, bounds, mask) => game.host.trace({ start, end, bounds, mask, ignore: entity.actor.id }),
    pointContents: point => game.host.pointContents(point),
    visibleEnemy: () => enemy !== null && game.host.trace({ start: add(body.origin, { x: 0, y: 0, z: entity.viewHeight }),
      end: add(enemy.origin, { x: 0, y: 0, z: game.entity(entity.enemy)?.viewHeight ?? 22 }), bounds: null, ignore: entity.actor.id, mask: 1 | 8 | 16 }).fraction === 1,
  });
  if (result.kind === "fallback") return false;
  if (result.pitch === null) game.move(entity, { velocity: result.velocity }, false);
  else game.move(entity, { velocity: result.velocity, angles: { ...body.angles, x: result.pitch } }, false);
  return true;
}
