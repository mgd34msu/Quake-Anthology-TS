import type { Vec3 } from "../../contracts/math.ts";

/** PM_UpdateViewAngles; callers supply the source movement enum. */
export function q3ViewAngles(command: Vec3, delta: Vec3, previous: Vec3, health: number, movementType: number,
  intermission: readonly number[]): { readonly angles: Vec3; readonly delta: Vec3 } {
  if (intermission.includes(movementType) || movementType !== 2 && health <= 0) return { angles: previous, delta };
  let pitch = ((command.x + delta.x) << 16) >> 16;
  if (pitch > 16000) { delta = { ...delta, x: (16000 - command.x) | 0 }; pitch = 16000; }
  else if (pitch < -16000) { delta = { ...delta, x: (-16000 - command.x) | 0 }; pitch = -16000; }
  return { angles: { x: pitch * (360 / 65536), y: (((command.y + delta.y) << 16) >> 16) * (360 / 65536),
    z: (((command.z + delta.z) << 16) >> 16) * (360 / 65536) }, delta };
}
