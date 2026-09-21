/* Quake II PM_ClampAngles, id Software / ZeniMax. GPL-2.0-or-later. */
import type { NumericOperations } from "../../contracts/numeric.ts";
import { PMF_TIME_TELEPORT, axes, element, type Vec3 } from "./types.ts";

function clampPitch(view: Vec3, numeric: NumericOperations): void {
  if (view[0] > 89 && view[0] < 180) view[0] = numeric.store(89);
  else if (view[0] < 271 && view[0] >= 180) view[0] = numeric.store(271);
}

export function classicViewAngles(view: Vec3, angles: Vec3, delta: Vec3, flags: number, numeric: NumericOperations): void {
  if (flags & PMF_TIME_TELEPORT) {
    view[1] = numeric.store(numeric.multiply(numeric.add(angles[1], delta[1]), 360 / 65536));
    view[0] = numeric.store(0); view[2] = numeric.store(0);
  } else {
    for (const axis of axes) {
      const word = (numeric.add(element(angles, axis), element(delta, axis)) << 16) >> 16;
      view[axis] = numeric.store(numeric.multiply(word, 360 / 65536));
    }
    clampPitch(view, numeric);
  }
}

export function rereleaseViewAngles(view: Vec3, angles: Vec3, delta: Vec3, flags: number, numeric: NumericOperations): void {
  if (flags & PMF_TIME_TELEPORT) {
    view[1] = numeric.store(numeric.add(angles[1], delta[1]));
    view[0] = numeric.store(0); view[2] = numeric.store(0);
  } else {
    for (const axis of axes) view[axis] = numeric.store(numeric.add(element(angles, axis), element(delta, axis)));
    clampPitch(view, numeric);
  }
}
