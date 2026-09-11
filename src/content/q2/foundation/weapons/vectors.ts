import type { Vec3 } from "../../../../contracts/math.ts";

export function angleVectors(angles: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const pitch = angles.x * Math.PI / 180, yaw = angles.y * Math.PI / 180, roll = angles.z * Math.PI / 180;
  const sp = Math.sin(pitch), cp = Math.cos(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw), sr = Math.sin(roll), cr = Math.cos(roll);
  return {
    forward: { x: cp * cy, y: cp * sy, z: -sp },
    right: { x: -sr * sp * cy + cr * sy, y: -sr * sp * sy - cr * cy, z: -sr * cp },
    up: { x: cr * sp * cy + sr * sy, y: cr * sp * sy - sr * cy, z: cr * cp },
  };
}

export function vectorAngles(direction: Vec3): Vec3 {
  if (direction.x === 0 && direction.y === 0) return { x: direction.z > 0 ? -90 : -270, y: 0, z: 0 };
  let yaw = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  if (yaw < 0) yaw += 360;
  let pitch = Math.atan2(direction.z, Math.hypot(direction.x, direction.y)) * 180 / Math.PI;
  if (pitch < 0) pitch += 360;
  return { x: -pitch, y: yaw, z: 0 };
}

export function lerpAngle(from: number, to: number, fraction: number): number {
  const delta = to - from;
  return from + (delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta) * fraction;
}
