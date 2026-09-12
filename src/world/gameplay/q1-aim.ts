import type { ActorId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { BodyState } from "../../contracts/world.ts";
import { q1DonorMath as math } from "../../core/math.ts";

export interface Q1AimTargets {
  /** Native source slot order: equal alignment selects the later visible target. */
  readonly targets: readonly ActorId[];
  body(actor: ActorId): BodyState | null;
  eligible(actor: ActorId): boolean;
  trace(start: Vec3, end: Vec3): ActorId | null;
}

/** PF_aim's speed argument is unused; target height correction preserves horizontal aim. */
export function aimQ1(origin: Vec3, forward: Vec3, threshold: number, targets: Q1AimTargets): Vec3 {
  const start = { ...origin, z: Math.fround(origin.z + 20) }, end = { x: 0, y: 0, z: 0 };
  math.VectorMA(start, 2048, forward, end);
  const straight = targets.trace(start, end);
  if (straight !== null && targets.eligible(straight)) return forward;
  let best = threshold, selected: Vec3 | null = null;
  for (const actor of targets.targets) {
    if (!targets.eligible(actor)) continue;
    const body = targets.body(actor); if (body === null) continue;
    end.x = Math.fround(body.origin.x + 0.5 * (body.bounds.min.x + body.bounds.max.x));
    end.y = Math.fround(body.origin.y + 0.5 * (body.bounds.min.y + body.bounds.max.y));
    end.z = Math.fround(body.origin.z + 0.5 * (body.bounds.min.z + body.bounds.max.z));
    const direction = { x: 0, y: 0, z: 0 };
    math.VectorSubtract(end, start, direction); math.VectorNormalize(direction);
    const distance = math.DotProduct(direction, forward); if (distance < best) continue;
    const hit = targets.trace(start, end);
    if (hit !== null && hit.equals(actor)) { best = distance; selected = body.origin; }
  }
  if (selected === null) return forward;
  const delta = { x: 0, y: 0, z: 0 };
  math.VectorSubtract(selected, origin, delta); math.VectorScale(forward, math.DotProduct(delta, forward), end);
  end.z = delta.z; math.VectorNormalize(end); return end;
}
