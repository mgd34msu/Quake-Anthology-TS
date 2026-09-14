import { expect, test } from "bun:test";
import type { ModelTransform, SceneLight, SkeletonJointPose } from "../../../src/contracts/scene.ts";
import type { Md5Mesh } from "../../../src/formats/q3-model/md5.ts";
import { skinMd5Mesh } from "../../../src/formats/q3-model/md5.ts";
import { md5ShadowEnvelope } from "../../../src/render/scene/models/shadow-bounds.ts";
import { modelWorldPoint } from "../../../src/render/scene/models/transform.ts";
import { shadowBodyFilter } from "../../../src/render/scene/shadows.ts";

const identity: ModelTransform = { origin: { x: 0, y: 0, z: 0 },
  axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: { x: 1, y: 1, z: 1 } };
const mesh: Md5Mesh = { shader: "skin", indices: [0, 0, 0],
  vertices: [{ normal: { x: 1, y: 0, z: 0 }, texCoord: { x: 0, y: 0 }, weights: { first: 0, count: 3 } }],
  weights: [{ joint: 0, bias: 2, position: { x: 51.1, y: -19, z: 3 } },
    { joint: 1, bias: -1.5, position: { x: -4, y: 73, z: 20 } }, { joint: 0, bias: 0.5, position: { x: 2, y: 9, z: 1 } }] };
const joints: readonly SkeletonJointPose[] = [
  { position: { x: 100, y: 3, z: -10 }, orientation: { x: 0, y: 0, z: 0, w: 2 }, scale: -2 },
  { position: { x: -1, y: 80, z: 0 }, orientation: { x: 0.3, y: 0.8, z: 0.1, w: 0.4 }, scale: 3 },
];

test("MD5 shadow envelope encloses signed weights, nonunit quaternions, shear and origin rounding", () => {
  const transforms: readonly ModelTransform[] = [identity, { ...identity, origin: { x: 2 ** 28, y: -(2 ** 27), z: 2 ** 25 } },
    { origin: { x: -20, y: 30, z: 4 }, axis: [{ x: 2, y: 1, z: 0 }, { x: -1, y: 1, z: 3 }, { x: 0, y: -2, z: 1 }],
      scale: { x: -2, y: 0.5, z: 3 } }, { ...identity, scale: { x: 0, y: 0, z: 0 } }];
  for (const transform of transforms) {
    const bound = md5ShadowEnvelope([mesh], joints, transform);
    if (bound === null) throw new Error("Supported skeleton needs a bound");
    for (const vertex of skinMd5Mesh(mesh, joints)) {
      const point = modelWorldPoint(transform, vertex.position);
      expect(Math.hypot(point.x - bound.origin.x, point.y - bound.origin.y, point.z - bound.origin.z)).toBeLessThanOrEqual(bound.radius);
    }
  }
  const many: Md5Mesh = { ...mesh, vertices: [{ normal: { x: 1, y: 0, z: 0 }, texCoord: { x: 0, y: 0 }, weights: { first: 0, count: 4096 } }],
    weights: Array.from({ length: 4096 }, (_, i) => ({ joint: 0, bias: i % 2 === 0 ? 1.1 : -0.9, position: { x: 150, y: 20, z: 1 } })) };
  const bound = md5ShadowEnvelope([many], joints, identity);
  if (bound === null) throw new Error("Bounded accumulation needs an envelope");
  for (const vertex of skinMd5Mesh(many, joints)) expect(Math.hypot(vertex.position.x, vertex.position.y, vertex.position.z)).toBeLessThanOrEqual(bound.radius);
});

test("uncertain intermediate ranges retain full preparation", () => {
  expect(md5ShadowEnvelope([mesh], [], identity)).toBeNull();
  expect(md5ShadowEnvelope([mesh], joints, { ...identity,
    axis: [{ x: 1e-300, y: 0, z: 0 }, { x: 0, y: 1e-300, z: 0 }, { x: 0, y: 0, z: 1e-300 }],
    scale: { x: 1e300, y: 1e300, z: 1e300 } })).toBeNull();
  expect(md5ShadowEnvelope([mesh], joints, { ...identity, scale: { x: 1e300, y: 1, z: 1 } })).toBeNull();
  expect(md5ShadowEnvelope([mesh], [{ position: { x: Infinity, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, scale: 0 }], identity)).toBeNull();
});

test("early cone envelopes retain axis-spanning spheres and honor the first eight Q2 lights", () => {
  const cone: SceneLight = { origin: { x: 0, y: 0, z: 0 }, radius: 200, color: { x: 1, y: 1, z: 1 }, additive: false,
    profile: { kind: "q2", scale: 1, cone: { direction: { x: 1, y: 0, z: 0 }, cosHalfAngle: 0.99 }, shadow: { kind: "none" } } };
  const keep = shadowBodyFilter([cone]);
  expect(keep({ origin: { x: 100, y: 0, z: 0 }, radius: 64 })).toBe(true);
  expect(keep({ origin: { x: -100, y: 0, z: 0 }, radius: 64 })).toBe(false);
  expect(keep({ origin: { x: 500, y: 0, z: 0 }, radius: 64 })).toBe(false);
  const plain: SceneLight = { ...cone, profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "none" } } };
  expect(shadowBodyFilter([...Array.from({ length: 8 }, () => plain), cone])({ origin: { x: 100, y: 0, z: 0 }, radius: 64 })).toBe(false);
});
