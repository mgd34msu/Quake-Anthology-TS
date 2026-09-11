// Bullet_Fire from id Software's code/game/g_weapon.c. GPL-2.0-or-later.
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add3, dot3, normalize3, scale3, sub3, vec3 } from "../../../../core/math.ts";
import { qvmFloatToInt } from "../../../../core/numeric.ts";
import type { ActorTraceResult } from "../world.ts";
import { q3BulletEndpoint } from "./ballistics-math.ts";
import { snapVectorTowards } from "./missile.ts";
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
