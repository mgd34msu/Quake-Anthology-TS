import { expect, test } from "bun:test";
import type { ModelTransform } from "../../src/contracts/scene.ts";
import { alignModelAttachment } from "../../src/render/scene/models/attachment.ts";
import { composeModelTransform, modelWorldPoint } from "../../src/render/scene/models/transform.ts";
import { q2HeldWeapon } from "../../src/content/q2/foundation/held-weapons.ts";
import { Q3_WEAPON_HAND_GRIP } from "../../src/content/q3/foundation/held-weapons.ts";

function closePoint(actual: ModelTransform["origin"], expected: ModelTransform["origin"]): void {
  expect(actual.x).toBeCloseTo(expected.x, 5);
  expect(actual.y).toBeCloseTo(expected.y, 5);
  expect(actual.z).toBeCloseTo(expected.z, 5);
}

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
