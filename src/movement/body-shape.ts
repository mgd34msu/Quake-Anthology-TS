import type { Bounds } from "../contracts/math.ts";

/** A requested local hull expands only after the selected source collision query accepts it. */
export function movementBounds(previous: Bounds, requested: Bounds, clear: (bounds: Bounds) => boolean): Bounds {
  const expands = requested.min.x < previous.min.x || requested.min.y < previous.min.y || requested.min.z < previous.min.z
    || requested.max.x > previous.max.x || requested.max.y > previous.max.y || requested.max.z > previous.max.z;
  return expands && !clear(requested) ? previous : requested;
}

export interface MovementBodyShape {
  readonly current: Bounds;
  readonly requested?: Bounds;
  currentActor(): void;
}
