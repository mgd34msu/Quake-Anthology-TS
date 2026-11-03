// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { railGeometry } from "../../../src/render/scene/particles/primitives.ts";

const pose = (kind: "rail-core" | "rail-rings" | "lightning", x: number): Parameters<typeof railGeometry>[0] => ({
  kind,
  origin: { x, y: 0, z: 0 },
  oldOrigin: { x: 0, y: 0, z: 0 },
  shaderRGBA: { x: 255, y: 255, z: 255, w: 255 },
});

test("rails with source-undefined lengths draw nothing instead of throwing", () => {
  const view = { x: 0, y: 100, z: 0 };
  const kinds: readonly Parameters<typeof pose>[0][] = ["rail-core", "rail-rings", "lightning"];
  for (const kind of kinds) {
    for (const x of [Number.NaN, 3e9, 1e10]) expect(railGeometry(pose(kind, x), view).vertices).toHaveLength(0);
    expect(railGeometry(pose(kind, 640), view).vertices.length).toBeGreaterThan(0);
  }
  expect(railGeometry(pose("rail-rings", 3.3e7 * 32), view).vertices).toHaveLength(0);
});
