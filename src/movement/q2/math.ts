/* Quake II q_shared.c and rerelease q_vec3.h. GPL-2.0-or-later. */
import type { NumericOperations } from "../../contracts/numeric.ts";
import { axes, type Vec3, type Vec4 } from "./types.ts";

export function createMovementMath(n: NumericOperations, edition: "classic" | "rerelease" = "classic") {
  const scalar = (value: number): number => n.profile.arithmetic.kind === "donor-binary64" ? value : n.store(value);
  const vec3 = (x = 0, y = 0, z = 0): Vec3 => [n.store(x), n.store(y), n.store(z)];
  const DotProduct = (a: Vec3, b: Vec3): number => n.add(n.add(n.multiply(a[0], b[0]), n.multiply(a[1], b[1])), n.multiply(a[2], b[2]));
  function VectorCopy(a: Vec3, b: Vec3): void { for (const i of axes) b[i] = n.store(a[i]); }
  function VectorClear(a: Vec3): void { a[0] = a[1] = a[2] = 0; }
  function VectorMA(a: Vec3, scale: number, b: Vec3, out: Vec3): void { for (const i of axes) out[i] = n.store(n.add(a[i], n.multiply(scale, b[i]))); }
  function VectorScale(a: Vec3, scale: number, out: Vec3): void { for (const i of axes) out[i] = n.store(n.multiply(a[i], scale)); }
  const VectorLength = (a: Vec3): number => n.squareRoot(DotProduct(a, a));
  function VectorNormalize(a: Vec3): number { const length = VectorLength(a); if (length) VectorScale(a, n.divide(1, length), a); return length; }
  function CrossProduct(a: Vec3, b: Vec3, out: Vec3): void {
    const result = vec3(n.subtract(n.multiply(a[1], b[2]), n.multiply(a[2], b[1])), n.subtract(n.multiply(a[2], b[0]), n.multiply(a[0], b[2])), n.subtract(n.multiply(a[0], b[1]), n.multiply(a[1], b[0])));
    VectorCopy(result, out);
  }
  function AngleVectors(angles: Vec3, forward: Vec3, right: Vec3, up: Vec3): void {
    const radians = edition === "classic" ? Math.PI * 2 / 360 : n.divide(n.multiply(n.store(Math.PI), 2), 360);
    const yaw = scalar(angles[1] * radians);
    const pitch = scalar(angles[0] * radians);
    const roll = scalar(angles[2] * radians);
    const sy = scalar(Math.sin(yaw)), cy = scalar(Math.cos(yaw));
    const sp = scalar(Math.sin(pitch)), cp = scalar(Math.cos(pitch));
    const sr = scalar(Math.sin(roll)), cr = scalar(Math.cos(roll));
    forward[0] = n.store(n.multiply(cp, cy)); forward[1] = n.store(n.multiply(cp, sy)); forward[2] = n.store(-sp);
    right[0] = n.store(n.add(n.multiply(n.multiply(-sr, sp), cy), n.multiply(cr, sy)));
    right[1] = n.store(n.subtract(n.multiply(n.multiply(-sr, sp), sy), n.multiply(cr, cy)));
    right[2] = n.store(n.multiply(-sr, cp));
    up[0] = n.store(n.add(n.multiply(n.multiply(cr, sp), cy), n.multiply(sr, sy)));
    up[1] = n.store(n.subtract(n.multiply(n.multiply(cr, sp), sy), n.multiply(sr, cy)));
    up[2] = n.store(n.multiply(cr, cp));
  }
  const vec3_add = (a: Vec3, b: Vec3): Vec3 => vec3(n.add(a[0], b[0]), n.add(a[1], b[1]), n.add(a[2], b[2]));
  const vec3_sub = (a: Vec3, b: Vec3): Vec3 => vec3(n.subtract(a[0], b[0]), n.subtract(a[1], b[1]), n.subtract(a[2], b[2]));
  const vec3_muls = (a: Vec3, b: number): Vec3 => vec3(n.multiply(a[0], b), n.multiply(a[1], b), n.multiply(a[2], b));
  function vec3_mulEqs(a: Vec3, scale: number): void { VectorScale(a, scale, a); }
  function vec3_addEq(a: Vec3, b: Vec3): void { for (const i of axes) a[i] = n.store(n.add(a[i], b[i])); }
  function vec3_cross(a: Vec3, b: Vec3): Vec3 { const out = vec3(); CrossProduct(a, b, out); return out; }
  function SlideClipVelocity(a: Vec3, normal: Vec3, overbounce: number): Vec3 {
    const backoff = n.multiply(DotProduct(a, normal), scalar(overbounce));
    const out = vec3();
    for (const i of axes) { out[i] = n.subtract(a[i], n.multiply(normal[i], backoff)); if (out[i] > -scalar(0.1) && out[i] < scalar(0.1)) out[i] = 0; }
    return out;
  }
  function G_AddBlend(r: number, g: number, b: number, a: number, blend: Vec4): void {
    if (a <= 0) return;
    const alpha = n.add(blend[3], n.multiply(n.subtract(1, blend[3]), a));
    const fraction = n.divide(blend[3], alpha);
    blend[0] = n.add(n.multiply(blend[0], fraction), n.multiply(r, n.subtract(1, fraction)));
    blend[1] = n.add(n.multiply(blend[1], fraction), n.multiply(g, n.subtract(1, fraction)));
    blend[2] = n.add(n.multiply(blend[2], fraction), n.multiply(b, n.subtract(1, fraction)));
    blend[3] = alpha;
  }
  return { vec3, DotProduct, VectorCopy, VectorClear, VectorMA, VectorScale, VectorNormalize, VectorLength, CrossProduct, AngleVectors,
    vec3_add, vec3_sub, vec3_muls, vec3_mulEqs, vec3_addEq, vec3_dot: DotProduct, vec3_cross, vec3_normalize: VectorNormalize,
    vec3_length: VectorLength, vec3_lengthSquared: (a: Vec3): number => DotProduct(a, a), SlideClipVelocity, G_AddBlend,
    SHORT2ANGLE: (value: number): number => n.multiply(value, 360 / 65536),
    clamp: (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max) };
}
