// Bullet_Fire from id Software's code/game/g_weapon.c. GPL-2.0-or-later.
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add3, dot3, normalize3, scale3, sub3, vec3 } from "../../../../core/math.ts";
import { qvmFloatToInt } from "../../../../core/numeric.ts";
import type { ActorTraceResult } from "../world.ts";
import { q3BulletEndpoint, q3ShotgunEndpoints } from "./ballistics-math.ts";
import { snapVector, snapVectorTowards } from "./missile.ts";
import type { GameRandom } from "./numeric.ts";

export interface Q3AccuracySubject {
  readonly actor: ActorId;
  readonly damageable: boolean;
  readonly player: boolean;
  readonly health: number;
  readonly team: string | null;
}

export function q3AccuracyHit(teamGame: boolean, target: Q3AccuracySubject, attacker: Q3AccuracySubject): boolean {
  return target.damageable && !target.actor.equals(attacker.actor) && target.player && attacker.player &&
    target.health > 0 && (!teamGame || target.team !== attacker.team);
}

export interface Q3BulletAttack {
  forward: { x: number; y: number; z: number };
  readonly right: Vec3;
  readonly up: Vec3;
  muzzle: Vec3;
  readonly quad: number;
}

export interface Q3BulletTarget {
  readonly damageable: boolean;
  readonly player: boolean;
  readonly accuracyEligible: boolean;
  readonly invulnerable: boolean;
}

interface BulletServices {
  readonly random: Pick<GameRandom, "random" | "crandom">;
  trace(start: Vec3, end: Vec3, pass: ActorId | null): ActorTraceResult;
  target(actor: ActorId): Q3BulletTarget | null;
  emit(event: { readonly point: Vec3; readonly normal: Vec3; readonly target: ActorId | null; readonly flesh: boolean }): void;
  damage(target: ActorId, direction: Q3BulletAttack["forward"], point: Vec3, amount: number): void;
  creditAccuracyHit(): void;
}

export type Q3BulletHost = BulletServices & ({ readonly product: "baseq3" } | {
  readonly product: "missionpack";
  invulnerabilityImpact(target: ActorId, direction: Vec3, point: Vec3):
    { readonly kind: "miss" } | { readonly kind: "hit"; readonly impactPoint: Vec3; readonly bounceDirection: Vec3 };
});

export function q3BulletFire(host: Q3BulletHost, shooter: ActorId, attack: Q3BulletAttack, spread: number, amount: number): void {
  let end = q3BulletEndpoint(attack, spread, host.random), pass: ActorId | null = shooter;
  for (let count = 0; count < 10; count++) {
    const trace = host.trace(attack.muzzle, end, pass);
    if (trace.surfaceFlags & 0x10) return;
    const actor = trace.hit.kind === "actor" ? trace.hit.actor : null;
    const target = actor === null ? null : host.target(actor), point = snapVectorTowards(trace.end, attack.muzzle);
    const flesh = target?.damageable === true && target.player;
    host.emit({ point, normal: trace.contact.kind === "plane" ? trace.contact.plane.normal : vec3(0, 0, 0), target: actor, flesh });
    if (flesh && target.accuracyEligible) host.creditAccuracyHit();
    if (actor !== null && target?.damageable === true) {
      if (host.product === "missionpack" && target.player && target.invulnerable) {
        const impact = host.invulnerabilityImpact(actor, attack.forward, point);
        if (impact.kind === "hit") {
          const incoming = sub3(impact.impactPoint, attack.muzzle);
          const reflection = add3(incoming, scale3(impact.bounceDirection, Math.fround(-2 * dot3(incoming, impact.bounceDirection))));
          end = add3(impact.impactPoint, scale3(normalize3(reflection), 8192));
          attack.muzzle = impact.impactPoint; pass = null;
        } else { attack.muzzle = point; pass = actor; }
        continue;
      }
      host.damage(actor, attack.forward, point, qvmFloatToInt(Math.fround(Math.fround(amount) * attack.quad)));
    }
    break;
  }
}

export type Q3ContactEvent =
  | { readonly kind: "hit"; readonly point: Vec3; readonly normal: Vec3; readonly target: ActorId }
  | { readonly kind: "miss"; readonly point: Vec3; readonly normal: Vec3 }
  | { readonly kind: "lightning-reflection"; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: "gauntlet-quad" };
interface ContactServices {
  trace(start: Vec3, end: Vec3, pass: ActorId | null): ActorTraceResult;
  target(actor: ActorId): Q3BulletTarget | null;
  emit(event: Q3ContactEvent): void;
  damage(target: ActorId, direction: Q3BulletAttack["forward"], point: Vec3, amount: number): void;
  creditAccuracyHit(): void;
}
export type Q3ContactHost = ContactServices & ({ readonly product: "baseq3" } | {
  readonly product: "missionpack";
  invulnerabilityImpact(target: ActorId, direction: Vec3, point: Vec3):
    { readonly kind: "miss" } | { readonly kind: "hit"; readonly impactPoint: Vec3; readonly bounceDirection: Vec3 };
});

function traceNormal(trace: ActorTraceResult): Vec3 {
  return trace.contact.kind === "plane" ? trace.contact.plane.normal : vec3(0, 0, 0);
}
function scaledDamage(amount: number, attack: Q3BulletAttack): number {
  return qvmFloatToInt(Math.fround(Math.fround(amount) * attack.quad));
}
function reflectedEnd(start: Vec3, point: Vec3, direction: Vec3): Vec3 {
  const incoming = sub3(point, start);
  return add3(point, scale3(normalize3(add3(incoming, scale3(direction, Math.fround(-2 * dot3(incoming, direction))))), 8192));
}

export function q3GauntletAttack(host: Q3ContactHost, shooter: ActorId, attack: Q3BulletAttack, quadActive: boolean): boolean {
  const trace = host.trace(attack.muzzle, add3(attack.muzzle, scale3(attack.forward, 32)), shooter);
  if (trace.surfaceFlags & 0x10 || trace.hit.kind !== "actor") return false;
  const target = host.target(trace.hit.actor);
  if (target?.damageable !== true) return false;
  if (target.player) host.emit({ kind: "hit", point: trace.end, normal: traceNormal(trace), target: trace.hit.actor });
  if (quadActive) host.emit({ kind: "gauntlet-quad" });
  host.damage(trace.hit.actor, attack.forward, trace.end, scaledDamage(50, attack));
  return true;
}

export function q3LightningFire(host: Q3ContactHost, shooter: ActorId, attack: Q3BulletAttack): void {
  let pass: ActorId | null = shooter;
  for (let count = 0; count < 10; count++) {
    const trace = host.trace(attack.muzzle, add3(attack.muzzle, scale3(attack.forward, 768)), pass);
    if (host.product === "missionpack" && count !== 0) host.emit({ kind: "lightning-reflection", start: attack.muzzle,
      end: snapVector(trace.end) });
    if (trace.hit.kind === "none") return;
    const actor = trace.hit.kind === "actor" ? trace.hit.actor : null;
    const target = actor === null ? null : host.target(actor);
    if (actor !== null && target?.damageable === true) {
      if (host.product === "missionpack" && target.player && target.invulnerable) {
        const impact = host.invulnerabilityImpact(actor, attack.forward, trace.end);
        if (impact.kind === "hit") {
          const end = reflectedEnd(attack.muzzle, impact.impactPoint, impact.bounceDirection);
          attack.muzzle = impact.impactPoint; attack.forward = { ...normalize3(sub3(end, impact.impactPoint)) }; pass = null;
        } else { attack.muzzle = trace.end; pass = actor; }
        continue;
      }
      host.damage(actor, attack.forward, trace.end, scaledDamage(8, attack));
    }
    const after = actor === null ? null : host.target(actor);
    if (actor !== null && after?.damageable === true && after.player) {
      host.emit({ kind: "hit", point: trace.end, normal: traceNormal(trace), target: actor });
      if (after.accuracyEligible) host.creditAccuracyHit();
    } else if (!(trace.surfaceFlags & 0x10)) host.emit({ kind: "miss", point: trace.end, normal: traceNormal(trace) });
    break;
  }
}


export interface Q3ShotgunEvent { readonly muzzle: Vec3; readonly direction: Vec3; readonly seed: number; }
export type Q3ShotgunHost = Omit<ContactServices, "emit"> & ({ readonly product: "baseq3" } | {
  readonly product: "missionpack";
  invulnerabilityImpact: Extract<Q3ContactHost, { readonly product: "missionpack" }>["invulnerabilityImpact"];
}) & {
  readonly random: Pick<GameRandom, "rand">;
  begin(muzzle: Vec3, direction: Vec3): (seed: number) => void;
  alive(): boolean;
};

function shotgunPellet(host: Q3ShotgunHost, shooter: ActorId, attack: Q3BulletAttack, start: Vec3, end: Vec3): boolean {
  let pass: ActorId | null = shooter;
  for (let count = 0; count < 10; count++) {
    const trace = host.trace(start, end, pass);
    if (trace.surfaceFlags & 0x10 || trace.hit.kind !== "actor") return false;
    const actor = trace.hit.actor, target = host.target(actor);
    if (target?.damageable !== true) return false;
    if (host.product === "missionpack" && target.player && target.invulnerable) {
      const impact = host.invulnerabilityImpact(actor, attack.forward, trace.end);
      if (impact.kind === "hit") { end = reflectedEnd(start, impact.impactPoint, impact.bounceDirection); start = impact.impactPoint; pass = null; }
      else { start = trace.end; pass = actor; }
      continue;
    }
    host.damage(actor, attack.forward, trace.end, scaledDamage(10, attack));
    return host.target(actor)?.accuracyEligible === true;
  }
  return false;
}

export function q3ShotgunFire(host: Q3ShotgunHost, shooter: ActorId, attack: Q3BulletAttack): void {
  const muzzle = attack.muzzle, direction = snapVector(scale3(attack.forward, 4096));
  const publish = host.begin(muzzle, direction), seed = host.random.rand() & 255;
  publish(seed);
  let hitClient = false;
  for (const end of q3ShotgunEndpoints(muzzle, direction, seed)) {
    if (!host.alive()) break;
    if (shotgunPellet(host, shooter, attack, muzzle, end) && !hitClient) {
      hitClient = true; host.creditAccuracyHit();
    }
  }
}

export interface Q3RailTrail {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly impact: { readonly kind: "none" } | { readonly kind: "surface"; readonly normal: Vec3 };
}
export type Q3RailHost = Omit<ContactServices, "emit" | "creditAccuracyHit"> & ({ readonly product: "baseq3" } | {
  readonly product: "missionpack";
  invulnerabilityImpact: Extract<Q3ContactHost, { readonly product: "missionpack" }>["invulnerabilityImpact"];
}) & {
  alive(): boolean;
  unlink(actor: ActorId): (() => void) | null;
  trail(event: Q3RailTrail): void;
};

export function q3RailFire(host: Q3RailHost, shooter: ActorId, attack: Q3BulletAttack): number {
  let end = add3(attack.muzzle, scale3(attack.forward, 8192)), pass: ActorId | null = shooter, hits = 0, penetrated = 0;
  const restores: (() => void)[] = [];
  let trace: ActorTraceResult | null = null;
  const trail = (point: Vec3, impact: Q3RailTrail["impact"]): void => host.trail({
    start: add3(add3(attack.muzzle, scale3(attack.right, 4)), scale3(attack.up, -1)), end: point, impact });
  try {
    do {
      if (!host.alive()) break;
      trace = host.trace(attack.muzzle, end, pass);
      if (trace.hit.kind !== "actor") break;
      const actor = trace.hit.actor, target = host.target(actor);
      if (target?.damageable === true) {
        if (host.product === "missionpack" && target.player && target.invulnerable) {
          const impact = host.invulnerabilityImpact(actor, attack.forward, trace.end);
          if (impact.kind === "hit") {
            end = reflectedEnd(attack.muzzle, impact.impactPoint, impact.bounceDirection);
            trace = { ...trace, end: snapVectorTowards(trace.end, attack.muzzle) };
            trail(trace.end, { kind: "none" }); attack.muzzle = impact.impactPoint; pass = null;
          }
        } else {
          if (target.accuracyEligible) hits++;
          host.damage(actor, attack.forward, trace.end, scaledDamage(100, attack));
        }
      }
      if (trace.contents & 1) break;
      const restore = host.unlink(actor); if (restore !== null) restores.push(restore);
      penetrated++;
    } while (penetrated < 4);
  } finally {
    for (const restore of restores) restore();
  }
  if (trace !== null) trail(snapVectorTowards(trace.end, attack.muzzle), trace.surfaceFlags & 0x10 ? { kind: "none" } : { kind: "surface", normal: traceNormal(trace) });
  return hits;
}

export interface Q3RailStatistics {
  readonly streak: number;
  readonly hits: number;
  readonly impressiveCount: number;
  readonly rewardUntil: number;
}
export function q3RailStatistics(state: Q3RailStatistics, hits: number, time: number): Q3RailStatistics & { readonly awarded: boolean } {
  if (hits === 0) return { ...state, streak: 0, awarded: false };
  const streak = (state.streak + hits) | 0, awarded = streak >= 2;
  return { streak: awarded ? (streak - 2) | 0 : streak, hits: (state.hits + 1) | 0,
    impressiveCount: awarded ? (state.impressiveCount + 1) | 0 : state.impressiveCount,
    rewardUntil: awarded ? (time + 2000) | 0 : state.rewardUntil, awarded };
}
