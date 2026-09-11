// Extracted from id Software g_weapon.c. GPL-2.0-or-later.
import { add3, cross3, dot3, normalize3, normalize3OrZero, perpendicularVector, scale3, sub3 } from "../../../../core/math.ts";
import type { Vec3 } from "../../../../core/math.ts";
import { qCrandom, qvmFloatToInt } from "../../../../core/numeric.ts";
import type { GameRandom } from "./numeric.ts";
export interface BallisticAttack { readonly muzzle: Vec3; readonly forward: Vec3; readonly right: Vec3; readonly up: Vec3; }
export function q3BulletEndpoint(attack: BallisticAttack, spread: number, random: Pick<GameRandom, "random" | "crandom">): Vec3 {
    const angle = Math.fround(Math.fround(random.random() * Math.fround(Math.PI)) * 2);
    const vertical = Math.fround(Math.fround(Math.fround(Math.fround(Math.sin(angle)) * random.crandom()) * spread) * 16);
    const horizontal = Math.fround(Math.fround(Math.fround(Math.fround(Math.cos(angle)) * random.crandom()) * spread) * 16);
    return  add3(add3(add3(attack.muzzle, scale3(attack.forward, 131072)), scale3(attack.right, horizontal)), scale3(attack.up, vertical));
}
export function q3ShotgunEndpoints(origin: Vec3, direction: Vec3, initialSeed: number): readonly Vec3[] {
  const forward = normalize3OrZero(direction), right = perpendicularVector(forward), up = cross3(forward, right);
  let seed = initialSeed;
  const ends: Vec3[] = [];
  for (let count = 0; count < 11; count++) {
    const r = qCrandom(seed), u = qCrandom(r.seed); seed = u.seed;
    const horizontal = Math.fround(Math.fround(r.value * 700) * 16), vertical = Math.fround(Math.fround(u.value * 700) * 16);
    ends.push(add3(add3(add3(origin, scale3(forward, 131072)), scale3(right, horizontal)), scale3(up, vertical)));
  }
  return ends;
}
export interface Q3MissileParameters {
  readonly speed: number; readonly duration: number; readonly gravity: boolean; readonly direct: number;
  readonly splash: number; readonly radius: number; readonly method: number; readonly splashMethod: number;
}
export function q3MissileParameters(weapon: number): Q3MissileParameters {
  switch (weapon) {
    case 4: return { speed: 700, duration: 2500, gravity: true, direct: 100, splash: 100, radius: 150, method: 4, splashMethod: 5 };
    case 5: return { speed: 900, duration: 15000, gravity: false, direct: 100, splash: 100, radius: 120, method: 6, splashMethod: 7 };
    case 8: return { speed: 2000, duration: 10000, gravity: false, direct: 20, splash: 15, radius: 20, method: 8, splashMethod: 9 };
    case 9: return { speed: 2000, duration: 10000, gravity: false, direct: 100, splash: 100, radius: 120, method: 12, splashMethod: 13 };
    default: throw new Error(`No Q3 missile parameters for weapon ${weapon}`);
  }
}

export function q3NailVelocity(start: Vec3, forward: Vec3, right: Vec3, up: Vec3, random: Pick<GameRandom, "random" | "crandom">): Vec3 {
    const angle = Math.fround(Math.fround(random.random() * Math.fround(Math.PI)) * 2);
    const vertical = Math.fround(Math.fround(Math.fround(Math.fround(Math.sin(angle)) * random.crandom()) * 500) * 16);
    const horizontal = Math.fround(Math.fround(Math.fround(Math.fround(Math.cos(angle)) * random.crandom()) * 500) * 16);
    const end = add3(add3(add3(start, scale3(forward, 8192 * 16)), scale3(right, horizontal)), scale3(up, vertical));
    const direction = normalize3(sub3(end, start));
    const speed = Math.fround(555 + Math.fround(random.random() * 1800));
    return scale3(direction, speed);
}

export function q3BounceVelocity(velocity: Vec3, normal: Vec3, half: boolean): Vec3 {
  let delta = add3(velocity, scale3(normal, Math.fround(-2 * dot3(velocity, normal))));
  if (half) delta = scale3(delta, Math.fround(0.65));
  return delta;
}
export function q3MissileHitTime(previous: number, time: number, fraction: number): number {
  const elapsed = Math.fround((time - previous) | 0);
  return qvmFloatToInt(Math.fround(Math.fround(previous) + Math.fround(elapsed * Math.fround(fraction))));
}
