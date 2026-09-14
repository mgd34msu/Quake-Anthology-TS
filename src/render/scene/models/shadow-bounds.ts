import type { Axis, Vec3 } from "../../../contracts/math.ts";
import type { ModelTransform, SkeletonJointPose } from "../../../contracts/scene.ts";
import type { Md5Mesh } from "../../../formats/q3-model/md5.ts";
import { rotateQuaternionAxis } from "../../../formats/q3-model/quaternion.ts";
import type { ShadowSphere } from "../shadows.ts";

interface WeightEnvelope {
  readonly joints: ReadonlyMap<number, number>;
  readonly biasSum: number;
  readonly count: number;
}
const envelopes = new WeakMap<Md5Mesh, WeightEnvelope | null>();
const unitAxes: Axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
// Four binary32 unit roundoffs also cover the binary64 bound arithmetic.
const roundoff = 2 ** -22, underflow = 1e-30, maximum = 1e30;
const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const bounded = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= maximum;
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

function weights(mesh: Md5Mesh): WeightEnvelope | null {
  const cached = envelopes.get(mesh);
  if (cached !== undefined) return cached;
  const joints = new Map<number, number>();
  let biasSum = 0, count = 0;
  for (const vertex of mesh.vertices) {
    if (!Number.isInteger(vertex.weights.count) || vertex.weights.count < 0 || vertex.weights.count > 4096
      || !Number.isInteger(vertex.weights.first) || vertex.weights.first < 0) { envelopes.set(mesh, null); return null; }
    count = Math.max(count, vertex.weights.count);
    let sum = 0;
    for (let i = 0; i < vertex.weights.count; i++) {
      const weight = mesh.weights[vertex.weights.first + i];
      if (weight === undefined || !Number.isInteger(weight.joint) || weight.joint < 0) { envelopes.set(mesh, null); return null; }
      const radius = length(weight.position);
      sum += Math.abs(weight.bias);
      if (!bounded(radius) || !bounded(sum)) { envelopes.set(mesh, null); return null; }
      joints.set(weight.joint, Math.max(joints.get(weight.joint) ?? 0, radius));
    }
    biasSum = Math.max(biasSum, sum);
  }
  const result = { joints, biasSum: biasSum * (1 + roundoff), count };
  envelopes.set(mesh, result);
  return result;
}

/** Gershgorin bounds the largest eigenvalue of A-transpose A, including shear. */
function operatorNorm(columns: Axis): number {
  const [a, b, c] = columns;
  const ab = Math.abs(dot(a, b)), ac = Math.abs(dot(a, c)), bc = Math.abs(dot(b, c));
  return Math.sqrt(Math.max(dot(a, a) + ab + ac, dot(b, b) + ab + bc, dot(c, c) + ac + bc)) * (1 + roundoff);
}

/** Bound actual skinning, including signed biases and each binary32 accumulation. */
export function md5ShadowEnvelope(meshes: readonly Md5Mesh[], joints: readonly SkeletonJointPose[], transform: ModelTransform): ShadowSphere | null {
  let radius = 0;
  for (const mesh of meshes) {
    const metadata = weights(mesh);
    if (metadata === null) return null;
    let pointRadius = 0;
    for (const [index, weightRadius] of metadata.joints) {
      const joint = joints[index];
      if (joint === undefined || !bounded(Math.abs(joint.scale))) return null;
      // Basis vectors expose exactly the rounded matrix used by skinMd5Mesh.
      const rotation: Axis = [rotateQuaternionAxis(joint.orientation, unitAxes[0]),
        rotateQuaternionAxis(joint.orientation, unitAxes[1]), rotateQuaternionAxis(joint.orientation, unitAxes[2])];
      const norm = operatorNorm(rotation), position = length(joint.position);
      const rotated = norm * weightRadius * (1 + roundoff) + underflow;
      const point = (position + Math.abs(joint.scale) * rotated) * (1 + roundoff) + underflow;
      if (![norm, position, rotated, point].every(bounded)) return null;
      pointRadius = Math.max(pointRadius, point);
    }
    const accumulated = (metadata.biasSum * pointRadius + metadata.count * underflow) * (1 + roundoff) ** metadata.count;
    if (!bounded(accumulated)) return null;
    radius = Math.max(radius, accumulated);
  }
  if (![Math.abs(transform.scale.x), Math.abs(transform.scale.y), Math.abs(transform.scale.z),
    radius * Math.abs(transform.scale.x), radius * Math.abs(transform.scale.y), radius * Math.abs(transform.scale.z),
    ...transform.axis.map(length)].every(bounded)) return null;
  const column = (axis: Vec3, scale: number): Vec3 => ({ x: axis.x * scale, y: axis.y * scale, z: axis.z * scale });
  const columns: Axis = [column(transform.axis[0], transform.scale.x), column(transform.axis[1], transform.scale.y), column(transform.axis[2], transform.scale.z)];
  const norm = operatorNorm(columns), frobenius = Math.hypot(...columns.map(length));
  const origin = length(transform.origin), transformed = norm * radius, products = frobenius * radius;
  if (![norm, frobenius, origin, transformed, products].every(bounded)) return null;
  // modelWorldPoint rounds three scaled columns, two sums, then the origin sum.
  // The absolute origin term is required when a small local point crosses an ULP.
  const worldRadius = transformed + 32 * roundoff * (products + origin) + underflow;
  return bounded(worldRadius) ? { origin: transform.origin, radius: Math.max(64, worldRadius) } : null;
}
