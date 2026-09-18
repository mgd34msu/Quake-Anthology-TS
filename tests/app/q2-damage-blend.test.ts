import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RendererImage } from "../../src/contracts/render.ts";
import { interpolateQ2DamageBlend, prepareQ2DamageBlend } from "../../src/app/bootstrap/q2-damage-blend.ts";

test("rerelease damage uses the donor eight-vertex transparent-center border in its seat view", () => {
  const image: RendererImage = { owner: { identity: Symbol("damage"), session: createIdentityOwner("damage").session, generation: 0 }, ordinal: 0, width: 1, height: 1, source: { kind: "generated", name: "white" } };
  const viewport = { x: 800, y: 100, width: 800, height: 600 }, color = { x: 1, y: 0.5, z: 0, w: 0.5 };
  const batch = prepareQ2DamageBlend(color, viewport, image)[0]; if (batch === undefined) throw new Error("Missing damage batch");
  expect(batch.vertices).toHaveLength(8); expect(batch.indices).toEqual([0, 5, 4, 0, 1, 5, 1, 6, 5, 1, 2, 6, 6, 2, 3, 6, 3, 7, 0, 7, 3, 0, 4, 7]);
  expect(batch.vertices[0]?.position).toEqual({ x: -1, y: 1, z: 0, w: 1 });
  expect(batch.vertices[4]?.position).toEqual({ x: -0.7, y: 0.6, z: 0, w: 1 });
  expect(batch.vertices[0]?.color).toEqual({ x: 1, y: 127 / 255, z: 0, w: 127 / 255 }); expect(batch.vertices[4]?.color.w).toBe(0);
  expect(batch.state.depthWrite).toBe(false); expect(batch.state.blend).toEqual({ source: "src-alpha", destination: "one-minus-src-alpha" });
  expect(prepareQ2DamageBlend({ ...color, w: 0 }, viewport, image)).toEqual([]);
  expect(prepareQ2DamageBlend(color, viewport, image, 0)[0]?.vertices).toHaveLength(4);
  expect(interpolateQ2DamageBlend({ x: 0, y: 0, z: 0, w: 0 }, color, 0.25)).toEqual(color);
  expect(interpolateQ2DamageBlend({ x: 1, y: 0, z: 0, w: 1 }, { x: 0, y: 1, z: 0, w: 0 }, 0.5)).toEqual({ x: 0.5, y: 0.5, z: 0, w: 0.5 });
});
