// Source g_combat.c radius falloff and visibility over actual shared actors.
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import { add3, length3, scale3, sub3, vec3 } from "../../../../core/math.ts";
import type { ActorSpatialQueries } from "../world.ts";

export interface Q3RadiusTarget {
  readonly origin: Vec3;
  readonly bounds: Bounds;
  readonly accuracyEligible: boolean;
}
export interface Q3RadiusHost {
  readonly spatial: Pick<ActorSpatialQueries, "traceActor" | "areaActors">;
  target(actor: ActorId): Q3RadiusTarget | null;
  damage(actor: ActorId, direction: Vec3, point: Vec3, amount: number): void;
}

export function q3CanDamage(spatial: Pick<ActorSpatialQueries, "traceActor">, actor: ActorId, bounds: Bounds, origin: Vec3): boolean {
  const midpoint = scale3(add3(bounds.min, bounds.max), 0.5);
  const trace = (end: Vec3) => spatial.traceActor({ start: origin, end, shape: { kind: "point" }, passActor: null, mask: 1 });
  const center = trace(midpoint);
  if (center.fraction === 1 || center.hit.kind === "actor" && center.hit.actor.equals(actor)) return true;
  for (const [x, y] of [[15, 15], [15, -15], [-15, 15], [-15, -15]] satisfies readonly (readonly [number, number])[]) {
    if (trace(vec3(midpoint.x + x, midpoint.y + y, midpoint.z)).fraction === 1) return true;
  }
  return false;
}

export function q3RadiusDamage(host: Q3RadiusHost, origin: Vec3, amount: number, radius: number, ignore: ActorId | null): boolean {
  radius = Math.max(1, Math.fround(radius)); amount = Math.fround(amount);
  const extent = vec3(radius, radius, radius);
  const candidates = host.spatial.areaActors({ min: sub3(origin, extent), max: add3(origin, extent) }, 1024);
  let hitClient = false;
  for (const actor of candidates) {
    if (ignore !== null && actor.equals(ignore)) continue;
    const target = host.target(actor); if (target === null) continue;
    const axis = (value: number, min: number, max: number): number => value < min ? min - value : value > max ? value - max : 0;
    const distance = length3(vec3(axis(origin.x, target.bounds.min.x, target.bounds.max.x),
      axis(origin.y, target.bounds.min.y, target.bounds.max.y), axis(origin.z, target.bounds.min.z, target.bounds.max.z)));
    if (distance >= radius) continue;
    const points = Math.fround(amount * Math.fround(1 - Math.fround(distance / radius)));
    if (!q3CanDamage(host.spatial, actor, target.bounds, origin)) continue;
    if (target.accuracyEligible) hitClient = true;
    host.damage(actor, add3(sub3(target.origin, origin), vec3(0, 0, 24)), origin, Math.trunc(points));
  }
  return hitClient;
}
