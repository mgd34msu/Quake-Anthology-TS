import { q3RadiusDamage } from "../../../content/q3/base/game/radius-damage.ts";
import type { SaveReader } from "../../../persistence/value.ts";
import { readVector } from "../../../persistence/shared.ts";
import type { ActorId, OwnedActor, ProviderId } from "../../../contracts/identity.ts";
import type { AttackProvenance } from "../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { NumericProfile } from "../../../contracts/numeric.ts";
import type { WeaponStepInput } from "../../../contracts/movement.ts";
import type { TraceResult } from "../../../contracts/scene.ts";
import type { SessionActorRegistry, SharedBodyTable } from "../../../world/actors/index.ts";
import type { SharedSceneQueries } from "../../../world/collision/index.ts";
import type { GameplayAuthority } from "../../../world/gameplay/authority.ts";
import { add3, length3, normalize3, scale3, vec3 } from "../../../core/math.ts";
import { qvmAngleVectors } from "../../../core/qvm-math.ts";
import { qvmFloatToInt } from "../../../core/numeric.ts";
import { q3MissileParameters, q3NailVelocity, q3BounceVelocity, q3MissileHitTime } from "../../../content/q3/base/game/ballistics-math.ts";
import { q3AccuracyHit, q3BulletFire, q3GauntletAttack, q3LightningFire, q3ShotgunFire, q3RailFire, q3RailStatistics } from "../../../content/q3/base/game/hitscan.ts";
import type { Q3BulletAttack, Q3ContactHost, Q3ContactEvent, Q3ShotgunEvent, Q3RailTrail, Q3RailStatistics } from "../../../content/q3/base/game/hitscan.ts";
import { snapVector, snapVectorTowards } from "../../../content/q3/base/game/missile.ts";
import { evaluateTrajectory, evaluateTrajectoryDelta, TrajectoryType } from "../../../content/q3/base/shared/trajectory.ts";
import type { Trajectory } from "../../../content/q3/base/shared/trajectory.ts";
import type { GameRandom } from "../../../content/q3/base/game/numeric.ts";

export interface Q3BallisticPose { readonly origin: Vec3; readonly angles: Vec3; readonly viewheight: number; readonly quad: number; readonly quadActive: boolean; }
interface Q3BallisticEventFields { readonly actor: ActorId; readonly weapon: number; readonly origin: Vec3; readonly end: Vec3; readonly normal: Vec3; readonly target: ActorId | null; readonly surfaceFlags: number; }
type Q3BallisticEventPayload = Q3BallisticEventFields & (
  | { readonly kind: "fire" | "remove" | "bounce" | "trail" }
  | { readonly kind: "projectile"; readonly trajectory: Trajectory }
  | { readonly kind: "impact"; readonly hitKind: "wall" | "flesh" }
  | { readonly kind: "contact"; readonly contact: Q3ContactEvent }
  | { readonly kind: "shotgun"; readonly shot: Q3ShotgunEvent }
  | { readonly kind: "rail"; readonly trail: Q3RailTrail }
  | { readonly kind: "rail-award"; readonly count: number; readonly until: number }
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
  worldActor(): ActorId;
  attack(actor: ActorId, inflictor: ActorId, weapon: number, method: number, flags: number, originatingProjectile?: ActorId): AttackProvenance;
  event(event: Q3SharedBallisticEvent): undefined;
}
export interface Q3WeaponStatistics extends Q3RailStatistics { readonly actor: OwnedActor; readonly shots: number; }

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
  private readonly weaponCounters = new Map<OwnedActor, Q3WeaponStatistics>();
  constructor(readonly host: Q3SharedBallisticsHost) { host.actors.onRelease(actor => { this.weaponCounters.delete(actor); const projectile = this.projectiles.get(actor); if (projectile !== undefined) { this.event({ kind: "remove", actor: actor.id, weapon: projectile.weapon, origin: projectile.trajectory.base, end: projectile.trajectory.base, normal: zero, target: null, surfaceFlags: 0 }); this.projectiles.delete(actor); } return undefined; }); }
  private event(payload: Q3BallisticEventPayload): undefined { return this.host.event({ ...payload, timeMilliseconds: this.host.time() }); }
  owns(actor: OwnedActor): boolean { return this.projectiles.has(actor); }
  checkpoint(): readonly Q3ProjectileState[] { return [...this.projectiles.values()].map(value => ({ ...value, trajectory: { ...value.trajectory } })); }
  restore(states: readonly Q3ProjectileState[]): void { this.projectiles.clear(); for (const state of states) { this.host.actors.assertOwned(state.actor); this.projectiles.set(state.actor, { ...state }); } }
  weaponStatistics(actor: OwnedActor): Q3WeaponStatistics { return this.weaponCounters.get(actor) ?? { actor, shots: 0, hits: 0, streak: 0, impressiveCount: 0, rewardUntil: 0 }; }
  checkpointWeaponStatistics(): readonly Q3WeaponStatistics[] { return [...this.weaponCounters.values()]; }
  restoreWeaponStatistics(states: readonly Q3WeaponStatistics[]): void {
    this.weaponCounters.clear();
    for (const state of states) { this.host.actors.assertOwned(state.actor); this.weaponCounters.set(state.actor, { ...state }); }
  }
  respawn(actor: ActorId): undefined {
    const owner = this.host.actors.resolveOwned(actor), state = owner === null ? undefined : this.weaponCounters.get(owner);
    if (owner !== null && state !== undefined) this.weaponCounters.set(owner, { ...state, streak: 0, rewardUntil: 0 });
    return undefined;
  }
  private bullet(actor: OwnedActor, weapon: number, attack: Q3BulletAttack, spread: number, amount: number): void {
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
      damage: (target, direction, point, scaled) => this.hit(actor.id, actor.id, weapon, target, point, direction, scaled, 3),
      creditAccuracyHit: () => { if (!this.host.actors.isLive(actor.id)) return; const current = this.weaponStatistics(actor); this.weaponCounters.set(actor, { ...current, hits: (current.hits + 1) | 0 }); },
    }, actor.id, attack, spread, amount);
  }
  private attack(actor: OwnedActor) {
    const pose = this.host.pose(actor), vectors = qvmAngleVectors(pose.angles);
    return { ...vectors, muzzle: snapVector(add3(vec3(pose.origin.x, pose.origin.y, Math.fround(pose.origin.z + pose.viewheight)), scale3(vectors.forward, 14))), quad: pose.quad };
  }
  private trace(start: Vec3, end: Vec3, pass: ActorId | null, mask = 0x6000001): TraceResult {
    return this.host.scene.trace({ start, end, passActor: pass, target: { kind: "world" }, shape: { kind: "point" },
      policy: { kind: "q3", contentsMask: mask, curves: true, playerCurveClip: true }, numeric: this.host.numeric });
  }
  private hit(actor: ActorId, inflictor: ActorId, weapon: number, target: ActorId, point: Vec3, direction: Vec3, amount: number, method: number, radius = false, originatingProjectile?: ActorId): void {
    if (!this.host.combat.read(target)?.canTakeDamage) return;
    this.host.combat.apply({ attack: this.host.attack(actor, inflictor, weapon, method, radius ? 1 : 0, originatingProjectile), target, amount, knockback: amount,
      point, direction, normal: zero, delivery: radius ? "radius" : "direct" });
  }
  private contactHost(actor: OwnedActor, weapon: number, attack: Q3BulletAttack, method: number): Q3ContactHost {
    return { product: "baseq3",
      trace: (start, end, pass) => {
        const trace = this.trace(start, end, pass);
        if (trace.kind !== "q3") throw new Error("Q3 contact trace requires its source collision policy");
        if (weapon === 6) this.event({ kind: "trail", actor: actor.id, weapon, origin: start, end: trace.end,
          normal: normal(trace), target: trace.hit.kind === "actor" ? trace.hit.actor : null, surfaceFlags: trace.surfaceFlags });
        return { fraction: trace.fraction, end: trace.end, hit: trace.hit, contact: trace.contact, contents: trace.contents, surfaceFlags: trace.surfaceFlags,
          solidity: trace.allSolid ? "all-solid" : trace.startSolid ? "start-solid" : "clear" };
      },
      target: target => {
        const observed = this.host.combat.read(target); if (observed === null) return null;
        const owner = this.host.combat.read(actor.id);
        const subject = { actor: target, damageable: observed.canTakeDamage, player: this.host.isPlayer(target), health: observed.health, team: observed.team };
        const attacker = { actor: actor.id, damageable: owner?.canTakeDamage ?? false, player: this.host.isPlayer(actor.id), health: owner?.health ?? 0, team: owner?.team ?? null };
        return { damageable: subject.damageable, player: subject.player,
          accuracyEligible: q3AccuracyHit(this.host.teamGame(), subject, attacker), invulnerable: false };
      },
      emit: contact => { this.event({ kind: "contact", actor: actor.id, weapon, origin: contact.kind === "gauntlet-quad" ? this.host.pose(actor).origin : attack.muzzle, end: attack.muzzle,
        normal: zero, target: null, surfaceFlags: 0, contact }); },
      damage: (target, direction, point, amount) => this.hit(actor.id, actor.id, weapon, target, point, direction, amount, method),
      creditAccuracyHit: () => { if (!this.host.actors.isLive(actor.id)) return; const current = this.weaponStatistics(actor); this.weaponCounters.set(actor, { ...current, hits: (current.hits + 1) | 0 }); },
    };
  }
  gauntletHit(actor: OwnedActor): boolean {
    const attack = this.attack(actor);
    return q3GauntletAttack(this.contactHost(actor, 1, attack, 2), actor.id, attack, this.host.pose(actor).quadActive);
  }
  private hitKind(target: ActorId | null): "wall" | "flesh" {
    return target !== null && this.host.combat.read(target)?.canTakeDamage === true &&
      this.host.scene.spatial.get(target)?.collision.shape.kind !== "model" ? "flesh" : "wall";
  }
  fire(actor: OwnedActor, weapon: number, _input: WeaponStepInput): undefined {
    if (weapon !== 1 && weapon !== 10) {
      const previous = this.weaponStatistics(actor);
      this.weaponCounters.set(actor, { ...previous, shots: (previous.shots + (weapon === 11 ? 15 : 1)) | 0 });
    }
    const attack = this.attack(actor);
    this.event({ kind: "fire", actor: actor.id, weapon, origin: attack.muzzle, end: add3(attack.muzzle, attack.forward), normal: zero, target: null, surfaceFlags: 0 });
    switch (weapon) {
      case 0: case 1: return undefined;
      case 2: this.bullet(actor, weapon, attack, 200, this.host.teamDeathmatch() ? 5 : 7); return undefined;
      case 3:
        q3ShotgunFire({ ...this.contactHost(actor, weapon, attack, 1), random: this.host.random, alive: () => this.host.actors.isLive(actor.id), begin: (muzzle, direction) => seed => {
          const shot = { muzzle, direction, seed };
          this.event({ kind: "shotgun", actor: actor.id, weapon, origin: shot.muzzle, end: shot.direction, normal: zero, target: null, surfaceFlags: 0, shot });
        } }, actor.id, { ...attack, forward: { ...attack.forward } }); return undefined;
      case 6: {
        q3LightningFire(this.contactHost(actor, weapon, attack, 11), actor.id, { ...attack, forward: { ...attack.forward } }); return undefined;
      }
      case 7: {
        const hits = q3RailFire({ ...this.contactHost(actor, weapon, attack, 10), alive: () => this.host.actors.isLive(actor.id),
          unlink: target => {
            const owner = this.host.actors.resolveOwned(target);
            if (owner === null || this.host.bodies.linked(target) === null) return null;
            this.host.bodies.unlink(owner);
            return () => { if (this.host.actors.isLive(owner.id) && this.host.bodies.read(owner.id) !== null) this.host.bodies.link(owner); };
          },
          trail: trail => { this.event({ kind: "rail", actor: actor.id, weapon, origin: trail.start, end: trail.end, normal: zero, target: null, surfaceFlags: 0, trail }); },
        }, actor.id, { ...attack, forward: { ...attack.forward } });
        if (!this.host.actors.isLive(actor.id)) return undefined;
        const previous = this.weaponStatistics(actor), next = q3RailStatistics(previous, hits, this.host.time());
        this.weaponCounters.set(actor, { actor, shots: previous.shots, hits: next.hits, streak: next.streak, impressiveCount: next.impressiveCount, rewardUntil: next.rewardUntil });
        if (next.awarded) this.event({ kind: "rail-award", actor: actor.id, weapon, origin: this.host.pose(actor).origin, end: this.host.pose(actor).origin,
          normal: zero, target: null, surfaceFlags: 0, count: next.impressiveCount, until: next.rewardUntil });
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
            this.hit(projectile.owner.id, projectile.actor.id, projectile.weapon, target, trace.end, length3(velocity) === 0 ? vec3(velocity.x, velocity.y, 1) : velocity, projectile.direct, projectile.method, false, projectile.actor.id);
          }
          this.explode(projectile, snapVectorTowards(trace.end, projectile.trajectory.base), target, normal(trace), trace.kind === "q3" ? trace.surfaceFlags : 0, hitKind); continue;
        }
      }
      this.event({ kind: "projectile", trajectory: { ...projectile.trajectory }, actor: projectile.actor.id, weapon: projectile.weapon, origin: body.origin, end: this.host.bodies.read(projectile.actor.id)?.origin ?? trace.end, normal: zero, target: null, surfaceFlags: 0 });
      if (time >= projectile.expires) this.explode(projectile, snapVector(evaluateTrajectory(projectile.trajectory, time)), null);
    }
  }
  private explode(projectile: Q3ProjectileState, origin: Vec3, ignore: ActorId | null, impactNormal = vec3(0, 0, 1), surfaceFlags = 0, hitKind: "wall" | "flesh" = "wall"): void {
    if (projectile.splash !== 0) q3RadiusDamage({ spatial: {
      areaActors: (bounds, maximum) => this.host.scene.queryActors(bounds).slice(0, maximum).map(value => value.body.actor),
      traceActor: query => {
        const trace = this.trace(query.start, query.end, query.passActor, query.mask);
        if (trace.kind !== "q3") throw new Error("Q3 radius trace requires its source collision policy");
        return { fraction: trace.fraction, end: trace.end, hit: trace.hit, contact: trace.contact, contents: trace.contents, surfaceFlags: trace.surfaceFlags,
          solidity: trace.allSolid ? "all-solid" : trace.startSolid ? "start-solid" : "clear" };
      },
    }, target: actor => {
      const state = this.host.combat.read(actor), body = this.host.bodies.linked(actor);
      if (state?.canTakeDamage !== true || body === null) return null;
      const owner = this.host.combat.read(projectile.owner.id);
      return { origin: body.state.origin, bounds: body.absoluteBounds, accuracyEligible: q3AccuracyHit(this.host.teamGame(),
        { actor, damageable: state.canTakeDamage, player: this.host.isPlayer(actor), health: state.health, team: state.team },
        { actor: projectile.owner.id, damageable: owner?.canTakeDamage ?? false, player: this.host.isPlayer(projectile.owner.id), health: owner?.health ?? 0, team: owner?.team ?? null }) };
    }, damage: (target, direction, point, amount) => this.hit(projectile.owner.id, this.host.worldActor(), projectile.weapon,
      target, point, direction, amount, projectile.splashMethod, true, projectile.actor.id),
    }, origin, projectile.splash, projectile.radius, ignore);
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

export function readQ3WeaponStatistics(reader: SaveReader, actor: (reader: SaveReader) => OwnedActor): readonly Q3WeaponStatistics[] {
  return reader.list(value => ({ actor: actor(value.field("actor")), shots: value.field("shots").integer(), hits: value.field("hits").integer(),
    streak: value.field("streak").integer(), impressiveCount: value.field("impressiveCount").integer(), rewardUntil: value.field("rewardUntil").integer() }));
}
