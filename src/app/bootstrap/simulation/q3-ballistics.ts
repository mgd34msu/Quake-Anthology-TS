import type { SaveReader } from "../../../persistence/value.ts";
import { readVector } from "../../../persistence/shared.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { AttackProvenance } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { WeaponStepInput } from "../../../contracts/movement.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import { add3, length3, normalize3, scale3, sub3, vec3 } from "../../../core/math.ts";
import { qvmAngleVectors } from "../../../core/qvm-math.ts";
import { qvmFloatToInt } from "../../../core/numeric.ts";
import { q3ShotgunEndpoints, q3MissileParameters, q3NailVelocity, q3BounceVelocity, q3MissileHitTime } from "../../../content/q3/base/game/ballistics-math.ts";
import { q3AccuracyHit, q3BulletFire } from "../../../content/q3/base/game/hitscan.ts";
import type { Q3BulletAttack } from "../../../content/q3/base/game/hitscan.ts";
import { snapVector, snapVectorTowards } from "../../../content/q3/base/game/missile.ts";
import { evaluateTrajectory, evaluateTrajectoryDelta, TrajectoryType } from "../../../content/q3/base/shared/trajectory.ts";
import type { Trajectory } from "../../../content/q3/base/shared/trajectory.ts";
import type { GameRandom } from "../../../content/q3/base/game/numeric.ts";

export interface Q3BallisticPose { readonly origin: Vec3; readonly angles: Vec3; readonly viewheight: number; readonly quad: number; }
interface Q3BallisticEventFields { readonly actor: ActorId; readonly weapon: number; readonly origin: Vec3; readonly end: Vec3; readonly normal: Vec3; readonly target: ActorId | null; readonly surfaceFlags: number; }
type Q3BallisticEventPayload = Q3BallisticEventFields & (
  | { readonly kind: "fire" | "remove" | "bounce" | "trail" }
  | { readonly kind: "projectile"; readonly trajectory: Trajectory }
  | { readonly kind: "impact"; readonly hitKind: "wall" | "flesh" }
);

export type Q3SharedBallisticEvent = Q3BallisticEventPayload & { readonly timeMilliseconds: number };

export interface Q3SharedBallisticsHost {
  readonly actors: SessionActorRegistry; readonly bodies: SharedBodyTable; readonly scene: SharedSceneQueries; readonly combat: GameplayAuthority;
  readonly weaponProvider: ProviderId; readonly numeric: NumericProfile; readonly random: Pick<GameRandom, "rand" | "random" | "crandom">;
  pose(actor: OwnedActor): Q3BallisticPose;
  time(): number;
  teamDeathmatch(): boolean;
  teamGame(): boolean;
  isPlayer(actor: ActorId): boolean;
  attack(actor: OwnedActor, inflictor: OwnedActor, weapon: number, method: number, flags: number): AttackProvenance;
  event(event: Q3SharedBallisticEvent): undefined;
}
export interface Q3BulletStatistics { readonly actor: OwnedActor; readonly shots: number; readonly hits: number; }

export interface Q3ProjectileState {
  readonly actor: OwnedActor; readonly owner: OwnedActor; readonly weapon: number; readonly direct: number; readonly splash: number;
  readonly radius: number; readonly method: number; readonly splashMethod: number; readonly expires: number; readonly bounce: boolean;
  trajectory: Trajectory;
}
const zero = vec3(0, 0, 0);
function normal(trace: TraceResult): Vec3 { return trace.contact.kind === "plane" ? trace.contact.plane.normal : zero; }
function noImpact(trace: TraceResult): boolean { return trace.kind === "q3" && (trace.surfaceFlags & 16) !== 0; }

/** Q3 weapon trajectories and damage over the session's existing actors and collision scene. */
export class Q3SharedBallistics {
  private readonly projectiles = new Map<OwnedActor, Q3ProjectileState>();
  private readonly bulletCounters = new Map<OwnedActor, Q3BulletStatistics>();
  constructor(readonly host: Q3SharedBallisticsHost) { host.actors.onRelease(actor => { this.bulletCounters.delete(actor); const projectile = this.projectiles.get(actor); if (projectile !== undefined) { this.event({ kind: "remove", actor: actor.id, weapon: projectile.weapon, origin: projectile.trajectory.base, end: projectile.trajectory.base, normal: zero, target: null, surfaceFlags: 0 }); this.projectiles.delete(actor); } return undefined; }); }
  private event(payload: Q3BallisticEventPayload): undefined { return this.host.event({ ...payload, timeMilliseconds: this.host.time() }); }
  owns(actor: OwnedActor): boolean { return this.projectiles.has(actor); }
  checkpoint(): readonly Q3ProjectileState[] { return [...this.projectiles.values()].map(value => ({ ...value, trajectory: { ...value.trajectory } })); }
  restore(states: readonly Q3ProjectileState[]): void { this.projectiles.clear(); for (const state of states) { this.host.actors.assertOwned(state.actor); this.projectiles.set(state.actor, { ...state }); } }
  bulletStatistics(actor: OwnedActor): Q3BulletStatistics { return this.bulletCounters.get(actor) ?? { actor, shots: 0, hits: 0 }; }
  checkpointBulletStatistics(): readonly Q3BulletStatistics[] { return [...this.bulletCounters.values()]; }
  restoreBulletStatistics(states: readonly Q3BulletStatistics[]): void {
    this.bulletCounters.clear();
    for (const state of states) { this.host.actors.assertOwned(state.actor); this.bulletCounters.set(state.actor, { ...state }); }
  }
  private bullet(actor: OwnedActor, weapon: number, attack: Q3BulletAttack, spread: number, amount: number): void {
    const previous = this.bulletStatistics(actor);
    this.bulletCounters.set(actor, { ...previous, shots: (previous.shots + 1) | 0 });
    const state = this.host.combat.read(actor.id), attacker = { actor: actor.id, damageable: state?.canTakeDamage ?? false,
      player: this.host.isPlayer(actor.id), health: state?.health ?? 0, team: state?.team ?? null };
    q3BulletFire({ product: "baseq3", random: this.host.random,
      trace: (start, end, pass) => {
        const trace = this.trace(start, end, pass);
        if (trace.kind !== "q3") throw new Error("Q3 bullet trace requires its source collision policy");
        return { fraction: trace.fraction, end: trace.end, hit: trace.hit, contact: trace.contact, contents: trace.contents, surfaceFlags: trace.surfaceFlags,
          solidity: trace.allSolid ? "all-solid" : trace.startSolid ? "start-solid" : "clear" };
      },
      target: target => {
        const observed = this.host.combat.read(target); if (observed === null) return null;
        const subject = { actor: target, damageable: observed.canTakeDamage, player: this.host.isPlayer(target), health: observed.health, team: observed.team };
        return { damageable: subject.damageable, player: subject.player,
          accuracyEligible: q3AccuracyHit(this.host.teamGame(), subject, attacker), invulnerable: false };
      },
      emit: event => { this.event({ kind: "impact", hitKind: event.flesh ? "flesh" : "wall", actor: actor.id, weapon,
        origin: attack.muzzle, end: event.point, normal: event.normal, target: event.target, surfaceFlags: 0 }); },
      damage: (target, direction, point, scaled) => this.hit(actor, actor, weapon, target, point, direction, scaled, 3),
      creditAccuracyHit: () => { const current = this.bulletStatistics(actor); this.bulletCounters.set(actor, { ...current, hits: (current.hits + 1) | 0 }); },
    }, actor.id, attack, spread, amount);
  }
  private attack(actor: OwnedActor) {
    const pose = this.host.pose(actor), vectors = qvmAngleVectors(pose.angles);
    return { ...vectors, muzzle: snapVector(add3(vec3(pose.origin.x, pose.origin.y, Math.fround(pose.origin.z + pose.viewheight)), scale3(vectors.forward, 14))), quad: pose.quad };
  }
  private trace(start: Vec3, end: Vec3, pass: ActorId | null, excluded: readonly ActorId[] = [], mask = 0x6000001): TraceResult {
    return this.host.scene.traceExcluding({ start, end, passActor: pass, target: { kind: "world" }, shape: { kind: "point" },
      policy: { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true }, numeric: this.host.numeric }, excluded);
  }
  private hit(actor: OwnedActor, inflictor: OwnedActor, weapon: number, target: ActorId, point: Vec3, direction: Vec3, amount: number, method: number, radius = false): void {
    if (!this.host.combat.read(target)?.canTakeDamage) return;
    this.host.combat.apply({ attack: this.host.attack(actor, inflictor, weapon, method, radius ? 1 : 0), target, amount, knockback: amount,
      point, direction, normal: zero, delivery: radius ? "radius" : "direct" });
  }
  gauntletHit(actor: OwnedActor): boolean {
    const attack = this.attack(actor), trace = this.trace(attack.muzzle, add3(attack.muzzle, scale3(attack.forward, 32)), actor.id);
    if (noImpact(trace) || trace.hit.kind !== "actor" || !this.host.combat.read(trace.hit.actor)?.canTakeDamage) return false;
    this.impact(actor, 1, attack.muzzle, trace);
    this.hit(actor, actor, 1, trace.hit.actor, trace.end, attack.forward, qvmFloatToInt(Math.fround(50 * attack.quad)), 2); return true;
  }
  private hitKind(target: ActorId | null): "wall" | "flesh" {
    return target !== null && this.host.combat.read(target)?.canTakeDamage === true &&
      this.host.scene.spatial.get(target)?.collision.shape.kind !== "model" ? "flesh" : "wall";
  }
  private impact(actor: OwnedActor, weapon: number, start: Vec3, trace: TraceResult): void {
    if (trace.hit.kind === "none" || noImpact(trace)) return;
    this.event({ kind: "impact", hitKind: this.hitKind(trace.hit.kind === "actor" ? trace.hit.actor : null), actor: actor.id, weapon, origin: start, end: trace.end, normal: normal(trace), target: trace.hit.kind === "actor" ? trace.hit.actor : null, surfaceFlags: trace.kind === "q3" ? trace.surfaceFlags : 0 });
  }
  fire(actor: OwnedActor, weapon: number, _input: WeaponStepInput): undefined {
    const attack = this.attack(actor);
    this.event({ kind: "fire", actor: actor.id, weapon, origin: attack.muzzle, end: add3(attack.muzzle, attack.forward), normal: zero, target: null, surfaceFlags: 0 });
    const shoot = (end: Vec3, amount: number, method: number): void => {
      const trace = this.trace(attack.muzzle, end, actor.id);
      if (weapon === 6) this.event({ kind: "trail", actor: actor.id, weapon, origin: attack.muzzle, end: trace.end,
        normal: normal(trace), target: trace.hit.kind === "actor" ? trace.hit.actor : null, surfaceFlags: trace.kind === "q3" ? trace.surfaceFlags : 0 });
      if (noImpact(trace)) return;
      this.impact(actor, weapon, attack.muzzle, trace);
      if (trace.hit.kind === "actor") this.hit(actor, actor, weapon, trace.hit.actor, trace.end, attack.forward, qvmFloatToInt(Math.fround(amount * attack.quad)), method);
    };
    switch (weapon) {
      case 0: case 1: return undefined;
      case 2: this.bullet(actor, weapon, attack, 200, this.host.teamDeathmatch() ? 5 : 7); return undefined;
      case 3: for (const end of q3ShotgunEndpoints(attack.muzzle, snapVector(scale3(attack.forward, 4096)), this.host.random.rand() & 255)) shoot(end, 10, 1); return undefined;
      case 6: shoot(add3(attack.muzzle, scale3(attack.forward, 768)), 8, 11); return undefined;
      case 7: {
        const excluded: ActorId[] = [], end = add3(attack.muzzle, scale3(attack.forward, 8192));
        let trace = this.trace(attack.muzzle, end, actor.id);
        for (let count = 0; count < 4; count++) {
          if (trace.hit.kind !== "actor") break;
          this.impact(actor, weapon, attack.muzzle, trace);
          this.hit(actor, actor, weapon, trace.hit.actor, trace.end, attack.forward, qvmFloatToInt(Math.fround(100 * attack.quad)), 10);
          if (trace.kind === "q3" && (trace.contents & 1) !== 0) break;
          excluded.push(trace.hit.actor); trace = this.trace(attack.muzzle, end, actor.id, excluded);
        }
        if (trace.hit.kind === "world") this.impact(actor, weapon, attack.muzzle, trace);
        this.event({ kind: "trail", actor: actor.id, weapon, origin: add3(add3(attack.muzzle, scale3(attack.right, 4)), scale3(attack.up, -1)), end: snapVectorTowards(trace.end, attack.muzzle), normal: normal(trace), target: trace.hit.kind === "actor" ? trace.hit.actor : null, surfaceFlags: trace.kind === "q3" ? trace.surfaceFlags : 0 });
        return undefined;
      }
      case 4: case 5: case 8: case 9: this.launch(actor, weapon, attack); return undefined;
      case 11: for (let index = 0; index < 15; index++) this.launch(actor, weapon, attack); return undefined;
      case 13: this.bullet(actor, weapon, attack, 600, 7); return undefined;
      default: throw new Error(`Q3 shared ballistics does not yet support weapon ${weapon}`);
    }
  }
  private launch(owner: OwnedActor, weapon: number, attack: ReturnType<Q3SharedBallistics["attack"]>): void {
    const spec = weapon === 11 ? { speed: 0, duration: 10000, gravity: false, direct: 20, splash: 0, radius: 0, method: 23, splashMethod: 0 } : q3MissileParameters(weapon), grenade = weapon === 4;
    const direction = normalize3(grenade ? vec3(attack.forward.x, attack.forward.y, Math.fround(attack.forward.z + Math.fround(0.2))) : attack.forward);
    const actor = this.host.actors.allocate(this.host.weaponProvider, "q3:projectile"), time = this.host.time();
    const trajectory: Trajectory = { type: spec.gravity ? TrajectoryType.TR_GRAVITY : TrajectoryType.TR_LINEAR, time: weapon === 11 ? time : (time - 50) | 0, duration: 0,
      base: attack.muzzle, delta: snapVector(weapon === 11 ? q3NailVelocity(attack.muzzle, attack.forward, attack.right, attack.up, this.host.random) : scale3(direction, spec.speed)) };
    this.host.bodies.create(actor, { origin: attack.muzzle, angles: zero, velocity: trajectory.delta, bounds: { min: zero, max: zero }, ground: null });
    this.projectiles.set(actor, { actor, owner, weapon, trajectory, direct: qvmFloatToInt(Math.fround(spec.direct * attack.quad)),
      splash: qvmFloatToInt(Math.fround(spec.splash * attack.quad)), radius: spec.radius,
      method: spec.method, splashMethod: spec.splashMethod,
      expires: time + spec.duration, bounce: grenade });
    this.event({ kind: "projectile", trajectory: { ...trajectory }, actor: actor.id, weapon, origin: attack.muzzle, end: attack.muzzle, normal: zero, target: null, surfaceFlags: 0 });
  }
  step(previousTime: number, time: number): void {
    for (const projectile of [...this.projectiles.values()]) {
      const body = this.host.bodies.read(projectile.actor.id); if (body === null) continue;
      if (!this.host.actors.isLive(projectile.owner.id)) { this.host.actors.release(projectile.actor); continue; }
      let trace = this.trace(body.origin, evaluateTrajectory(projectile.trajectory, time), projectile.owner.id);
      if (trace.startSolid || trace.allSolid) trace = { ...this.trace(body.origin, body.origin, projectile.owner.id), fraction: 0 };
      this.host.bodies.write(projectile.actor, { ...body, origin: trace.end, velocity: evaluateTrajectoryDelta(projectile.trajectory, time) });
      if (trace.fraction !== 1) {
        if (noImpact(trace)) { this.host.actors.release(projectile.actor); continue; }
        const target = trace.hit.kind === "actor" ? trace.hit.actor : null;
        if (projectile.bounce && (target === null || !this.host.combat.read(target)?.canTakeDamage)) {
          const hitTime = q3MissileHitTime(previousTime, time, trace.fraction);
          const velocity = evaluateTrajectoryDelta(projectile.trajectory, hitTime), plane = normal(trace);
          const delta = q3BounceVelocity(velocity, plane, true);
          const stop = plane.z > Math.fround(0.2) && length3(delta) < 40;
          projectile.trajectory = { ...projectile.trajectory, type: stop ? TrajectoryType.TR_STATIONARY : projectile.trajectory.type,
            base: stop ? trace.end : add3(trace.end, plane), delta: stop ? zero : delta, time };
          this.host.bodies.write(projectile.actor, { ...body, origin: projectile.trajectory.base, velocity: projectile.trajectory.delta });
          this.event({ kind: "bounce", actor: projectile.actor.id, weapon: projectile.weapon, origin: trace.end, end: trace.end, normal: plane, target, surfaceFlags: trace.kind === "q3" ? trace.surfaceFlags : 0 });
        } else {
          const hitKind = this.hitKind(target);
          if (target !== null) {
            const velocity = evaluateTrajectoryDelta(projectile.trajectory, time);
            this.hit(projectile.owner, projectile.actor, projectile.weapon, target, trace.end, length3(velocity) === 0 ? vec3(velocity.x, velocity.y, 1) : velocity, projectile.direct, projectile.method);
          }
          this.explode(projectile, snapVectorTowards(trace.end, projectile.trajectory.base), target, normal(trace), trace.kind === "q3" ? trace.surfaceFlags : 0, hitKind); continue;
        }
      }
      this.event({ kind: "projectile", trajectory: { ...projectile.trajectory }, actor: projectile.actor.id, weapon: projectile.weapon, origin: body.origin, end: this.host.bodies.read(projectile.actor.id)?.origin ?? trace.end, normal: zero, target: null, surfaceFlags: 0 });
      if (time >= projectile.expires) this.explode(projectile, snapVector(evaluateTrajectory(projectile.trajectory, time)), null);
    }
  }
  private explode(projectile: Q3ProjectileState, origin: Vec3, ignore: ActorId | null, impactNormal = vec3(0, 0, 1), surfaceFlags = 0, hitKind: "wall" | "flesh" = "wall"): void {
    const extent = vec3(projectile.radius, projectile.radius, projectile.radius);
    for (const candidate of this.host.scene.queryActors({ min: sub3(origin, extent), max: add3(origin, extent) })) {
      const target = candidate.body.actor;
      if (ignore !== null && sameActor(target, ignore) || !this.host.combat.read(target)?.canTakeDamage) continue;
      const bounds = candidate.body.absoluteBounds;
      const axis = (value: number, min: number, max: number): number => value < min ? min - value : value > max ? value - max : 0;
      const distance = length3(vec3(axis(origin.x, bounds.min.x, bounds.max.x), axis(origin.y, bounds.min.y, bounds.max.y), axis(origin.z, bounds.min.z, bounds.max.z)));
      if (distance >= projectile.radius) continue;
      const midpoint = scale3(add3(bounds.min, bounds.max), 0.5);
      const center = this.trace(origin, midpoint, null, [], 1);
      let visible = center.fraction === 1 || center.hit.kind === "actor" && sameActor(center.hit.actor, target);
      for (const [x, y] of [[15, 15], [15, -15], [-15, 15], [-15, -15]] satisfies readonly (readonly [number, number])[]) {
        if (visible) break; visible = this.trace(origin, vec3(midpoint.x + x, midpoint.y + y, midpoint.z), null, [], 1).fraction === 1;
      }
      if (visible) this.hit(projectile.owner, projectile.actor, projectile.weapon, target, origin, add3(sub3(candidate.body.state.origin, origin), vec3(0, 0, 24)),
        Math.trunc(Math.fround(Math.fround(projectile.splash) * Math.fround(1 - Math.fround(distance / projectile.radius)))), projectile.splashMethod, true);
    }
    this.event({ kind: "impact", hitKind, actor: projectile.actor.id, weapon: projectile.weapon, origin, end: origin, normal: impactNormal, target: ignore, surfaceFlags });
    this.host.actors.release(projectile.actor);
  }
}

export function readQ3ProjectileStates(reader: SaveReader, actor: (reader: SaveReader) => OwnedActor): readonly Q3ProjectileState[] {
  return reader.list(value => {
    const trajectory = value.field("trajectory");
    const type = trajectory.field("type").choice(TrajectoryType.TR_STATIONARY, TrajectoryType.TR_LINEAR, TrajectoryType.TR_GRAVITY);
    return { actor: actor(value.field("actor")), owner: actor(value.field("owner")), weapon: value.field("weapon").choice(4, 5, 8, 9, 11),
      direct: value.field("direct").integer(0), splash: value.field("splash").integer(0), radius: value.field("radius").finite(),
      method: value.field("method").integer(0), splashMethod: value.field("splashMethod").integer(0), expires: value.field("expires").finite(),
      bounce: value.field("bounce").boolean(), trajectory: { type, time: trajectory.field("time").finite(), duration: trajectory.field("duration").finite(),
        base: readVector(trajectory.field("base")), delta: readVector(trajectory.field("delta")) } };
  });
}

export function readQ3BulletStatistics(reader: SaveReader, actor: (reader: SaveReader) => OwnedActor): readonly Q3BulletStatistics[] {
  return reader.list(value => ({ actor: actor(value.field("actor")), shots: value.field("shots").integer(), hits: value.field("hits").integer() }));
}
