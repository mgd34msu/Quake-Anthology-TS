import { expect, test } from "bun:test";
import type { ModelTransform } from "../../src/contracts/scene.ts";
import { alignModelAttachment } from "../../src/render/scene/models/attachment.ts";
import { composeModelTransform, modelWorldDirection, modelWorldPoint, modelLocalDelta, q3ModelViewOrigin } from "../../src/render/scene/models/transform.ts";
import { add3, scale3 } from "../../src/core/math.ts";
import { q2HeldWeapon } from "../../src/content/q2/foundation/held-weapons.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../src/content/q3/foundation/held-weapons.ts";

function closePoint(actual: ModelTransform["origin"], expected: ModelTransform["origin"]): void {
  expect(actual.x).toBeCloseTo(expected.x, 5);
  expect(actual.y).toBeCloseTo(expected.y, 5);
  expect(actual.z).toBeCloseTo(expected.z, 5);
}

test("model transforms retain every binary32 boundary and signed zero", () => {
  const transforms: readonly ModelTransform[] = [
    { origin: { x: 0, y: -0, z: 0 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], scale: { x: 1, y: 1, z: 1 } },
    { origin: { x: -0, y: -0, z: -0 }, axis: [{ x: -0, y: -0, z: -0 }, { x: -0, y: -0, z: -0 }, { x: -0, y: -0, z: -0 }], scale: { x: 1, y: 1, z: 1 } },
    { origin: { x: 2 ** 28, y: -(2 ** 27), z: 0.1 }, axis: [{ x: 2, y: 1, z: 0.1 }, { x: -1, y: 1, z: 3 }, { x: 0.3, y: -2, z: 1 }], scale: { x: -2, y: 0.1, z: 3 } },
    { origin: { x: -3, y: 7, z: 1 }, axis: [{ x: 2 ** 24, y: -(2 ** 24), z: 1 }, { x: -(2 ** 24), y: 2 ** 24, z: -1 }, { x: 1, y: 1, z: 2 ** -149 }], scale: { x: 1, y: 1, z: 1 } },
    { origin: { x: 1e30, y: -1e30, z: 2 ** -149 }, axis: [{ x: 0.1, y: -0.7, z: 0.3 }, { x: 0.7, y: 0.1, z: -0.2 }, { x: -0.3, y: 0.2, z: 0.9 }], scale: { x: 1e-20, y: -1e20, z: 0 } },
  ];
  const values = [0, -0, 1, -1, 0.1, 1 + 2 ** -24, 2 ** -149, -(2 ** -149), 2 ** -150, 2 ** 24 + 1, 1e30, -1e30];
  for (const transform of transforms) for (const x of values) for (const y of values) for (const z of values) {
    const value = { x, y, z }, [forward, left, up] = transform.axis;
    const direction = add3(add3(scale3(forward, x * transform.scale.x), scale3(left, y * transform.scale.y)), scale3(up, z * transform.scale.z));
    const point = add3(transform.origin, direction);
    const actualDirection = modelWorldDirection(transform, value), actualPoint = modelWorldPoint(transform, value);
    for (const component of ["x", "y", "z"] satisfies readonly (keyof typeof value)[]) {
      expect(Object.is(actualDirection[component], direction[component])).toBe(true);
      expect(Object.is(actualPoint[component], point[component])).toBe(true);
    }
  }
});

test("model attachment registers the source origin and basis, retaining model size", () => {
  const source: ModelTransform = { origin: { x: 12, y: -7, z: 5 },
    axis: [{ x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], scale: { x: 1, y: 1, z: 1 } };
  const destination: ModelTransform = { ...source, origin: { x: -3, y: 4, z: -2 },
    axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: -1, z: 0 }] };
  const placement = alignModelAttachment(source, destination), registered = composeModelTransform(placement, source);
  closePoint(registered.origin, destination.origin);
  for (const point of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    closePoint(modelWorldPoint(registered, point), modelWorldPoint(destination, point));
  }
  expect(placement.scale).toEqual({ x: 1, y: 1, z: 1 });
});

test("Q2 blaster uses the held mesh and reference grip instead of its first-person frames", () => {
  const held = q2HeldWeapon("models/weapons/v_blast/tris.md2");
  if (held === null) throw new Error("Missing blaster registration");
  expect(held.path).toBe("players/male/w_blaster.md2"); expect(held.referenceFrame).toBe(0);
  const placement = alignModelAttachment(held.grip, Q3_WEAPON_HAND_GRIP);
  closePoint(modelWorldPoint(placement, held.grip.origin), Q3_WEAPON_HAND_GRIP.origin);
  expect(q2HeldWeapon("models/weapons/v_shotg/tris.md2")).toBeNull();
});


test("Q3 shader view origin follows R_RotateForEntity including item respawn axes", () => {
  const origin = { x: 674.6016845703125, y: 2103.394287109375, z: 25.288625717163086 };
  const camera = add3(origin, { x: 8, y: 10, z: 12 });
  const zero: ModelTransform = { origin, axis: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], scale: { x: 1, y: 1, z: 1 } };
  expect(q3ModelViewOrigin(zero, camera, true)).toEqual({ x: 0, y: 0, z: 0 });
  expect(() => modelLocalDelta(zero, camera)).toThrow("Model transform is singular");
  const scaledCamera = { x: 8, y: 10, z: 12 };
  const scaled: ModelTransform = { ...zero, origin: { x: 0, y: 0, z: 0 }, axis: [{ x: 2, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 4 }] };
  expect(q3ModelViewOrigin(scaled, scaledCamera, false)).toEqual({ x: 16, y: 30, z: 48 });
  expect(q3ModelViewOrigin(scaled, scaledCamera, true)).toEqual({ x: 8, y: 15, z: 24 });
  expect(q3ModelViewOrigin({ ...scaled, axis: [zero.axis[0], scaled.axis[1], scaled.axis[2]] }, camera, true)).toEqual({ x: 0, y: 0, z: 0 });
});
