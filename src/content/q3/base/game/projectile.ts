/* Shared G_RunMissile, G_MissileImpact, G_BounceMissile and G_ExplodeMissile.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId, OwnedActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add3, length3, normalize3, scale3, vec3 } from "../../../../core/math.ts";
import type { ActorTraceResult } from "../world.ts";
import { EVENT_VALID_MSEC } from "../shared/definitions.ts";
import type { Trajectory } from "../shared/trajectory.ts";
import { evaluateTrajectory, evaluateTrajectoryDelta, TrajectoryType } from "../shared/trajectory.ts";
import { q3BounceVelocity, q3MissileHitTime } from "./ballistics-math.ts";
import { snapVector, snapVectorTowards } from "./missile.ts";

export interface Q3Projectile {
  readonly actor: OwnedActor;
  readonly owner: ActorId;
  readonly weapon: number;
  readonly direct: number;
  readonly splash: number;
  readonly radius: number;
  readonly method: number;
  readonly splashMethod: number;
  readonly damagePoint: Vec3;
  trajectory: Trajectory;
  flags: number;
  pass: ActorId | null;
}
export interface Q3ProjectileTarget {
  readonly damageable: boolean;
  readonly player: boolean;
  readonly accuracyEligible: boolean;
  readonly invulnerable: boolean;
}
export type Q3ProjectileImpact =
  | { readonly kind: "bounce"; readonly normal: Vec3 }
  | { readonly kind: "impact"; readonly normal: Vec3; readonly target: ActorId | null; readonly flesh: boolean; readonly surfaceFlags: number };
export interface Q3ProjectileHost {
  readonly time: number;
  readonly previousTime: number;
  live(): boolean;
  phase(): "flight" | "event" | "attached";
  eventTime(): number;
  clearEvent?(): void;
  origin(): Vec3;
  move(origin: Vec3, velocity: Vec3): void;
  setOrigin(origin: Vec3): void;
  link(): void;
  release(): void;
  trace(start: Vec3, end: Vec3, pass: ActorId | null): ActorTraceResult;
  target(actor: ActorId): Q3ProjectileTarget | null;
  worldActor(): ActorId;
  emit(event: Q3ProjectileImpact): void;
  retain(): void;
  damage(target: ActorId, direction: Vec3, point: Vec3): void;
  radius(origin: Vec3, ignore: ActorId | null): boolean;
  accuracy(): void;
  think(): void;
  moved(): void;
  readonly reflection: null | { impact(target: ActorId, direction: Vec3, point: Vec3): { readonly kind: "miss" } | { readonly kind: "hit"; readonly bounceDirection: Vec3 } };
  readonly special: null | {
    impact(trace: ActorTraceResult, target: ActorId): boolean;
    afterMove(): void;
    noImpact(): void;
  };
}
export function q3LaunchProjectile(start: Vec3, direction: Vec3, speed: number, gravity: boolean, duration: number, time: number) {
  return { expires: (time + duration) | 0, trajectory: { type: gravity ? TrajectoryType.TR_GRAVITY : TrajectoryType.TR_LINEAR,
    time: (time - 50) | 0, duration: 0, base: vec3(start.x, start.y, start.z), delta: snapVector(scale3(direction, speed)) } };
}

const zero = vec3(0, 0, 0);
function normal(trace: ActorTraceResult): Vec3 { return trace.contact.kind === "plane" ? trace.contact.plane.normal : zero; }

export function q3BounceProjectile(projectile: Q3Projectile, host: Q3ProjectileHost, trace: ActorTraceResult): void {
  const hitTime = q3MissileHitTime(host.previousTime, host.time, trace.fraction);
  const plane = normal(trace), half = (projectile.flags & 0x20) !== 0;
  const delta = q3BounceVelocity(evaluateTrajectoryDelta(projectile.trajectory, hitTime), plane, half);
  projectile.trajectory = { ...projectile.trajectory, delta };
  if (half && plane.z > Math.fround(0.2) && length3(delta) < 40) { host.setOrigin(trace.end); return; }
  const origin = add3(host.origin(), plane);
  host.move(origin, delta);
  projectile.trajectory = { ...projectile.trajectory, base: origin, time: host.time };
}

export function q3ExplodeProjectile(projectile: Q3Projectile, host: Q3ProjectileHost): void {
  const origin = snapVector(evaluateTrajectory(projectile.trajectory, host.time));
  host.setOrigin(origin);
  host.emit({ kind: "impact", normal: vec3(0, 0, 1), target: null, flesh: false, surfaceFlags: 0 });
  if (!host.live()) return;
  host.retain();
  if (projectile.splash !== 0 && host.radius(origin, projectile.actor.id)) host.accuracy();
  if (host.live()) host.link();
}

export function q3ImpactProjectile(projectile: Q3Projectile, host: Q3ProjectileHost, trace: ActorTraceResult): void {
  const actor = trace.hit.kind === "actor" ? trace.hit.actor : host.worldActor(), plane = normal(trace);
  const target = host.target(actor);
  if (target?.damageable !== true && (projectile.flags & 0x30) !== 0) {
    q3BounceProjectile(projectile, host, trace); host.emit({ kind: "bounce", normal: plane }); return;
  }
  if (host.reflection !== null && target?.damageable === true && target.invulnerable && projectile.weapon !== 12) {
    const effect = host.reflection.impact(actor, normalize3(projectile.trajectory.delta), projectile.trajectory.base);
    if (!host.live()) return;
    if (effect.kind === "hit") {
      const half = projectile.flags & 0x20; projectile.flags &= ~0x20;
      q3BounceProjectile(projectile, host, { ...trace, contact: { kind: "plane", plane: { normal: effect.bounceDirection, distance: 0 } } });
      projectile.flags |= half;
    }
    projectile.pass = actor; return;
  }
  let hitClient = false;
  if (target?.damageable === true && projectile.direct !== 0) {
    if (target.accuracyEligible) { host.accuracy(); hitClient = true; }
    let velocity = evaluateTrajectoryDelta(projectile.trajectory, host.time);
    if (length3(velocity) === 0) velocity = vec3(velocity.x, velocity.y, 1);
    host.damage(actor, velocity, projectile.damagePoint);
    if (!host.live()) return;
  }
  if (host.special?.impact(trace, actor) === true || !host.live()) return;
  const current = host.target(actor);
  host.emit({ kind: "impact", normal: plane, target: actor, flesh: current?.damageable === true && current.player, surfaceFlags: trace.surfaceFlags });
  if (!host.live()) return;
  host.retain();
  const origin = snapVectorTowards(trace.end, projectile.trajectory.base); host.setOrigin(origin);
  if (projectile.splash !== 0 && host.radius(origin, actor) && !hitClient) host.accuracy();
  if (host.live()) host.link();
}

export function q3StepProjectile(projectile: Q3Projectile, host: Q3ProjectileHost): void {
  if (!host.live()) return;
  if (host.phase() === "event") { if (((host.time - host.eventTime()) | 0) > EVENT_VALID_MSEC) host.release(); return; }
  if (((host.time - host.eventTime()) | 0) > EVENT_VALID_MSEC) host.clearEvent?.();
  if (host.phase() === "attached") { host.think(); return; }
  const origin = host.origin(), destination = evaluateTrajectory(projectile.trajectory, host.time);
  let trace = host.trace(origin, destination, projectile.pass);
  if (trace.solidity !== "clear") trace = { ...host.trace(origin, origin, projectile.pass), fraction: 0 };
  else host.move(trace.end, evaluateTrajectoryDelta(projectile.trajectory, host.time));
  host.link();
  if (trace.fraction !== 1) {
    if ((trace.surfaceFlags & 16) !== 0) { host.special?.noImpact(); if (host.live()) host.release(); return; }
    q3ImpactProjectile(projectile, host, trace);
    if (!host.live() || host.phase() !== "flight") return;
  }
  host.special?.afterMove();
  if (!host.live()) return;
  host.moved();
  host.think();
}
