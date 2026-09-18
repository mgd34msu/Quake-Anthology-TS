import { test } from "bun:test";
import { deepStrictEqual } from "node:assert";
import { boxCell, clipCell, negatePlane, splitCell } from "../../src/world/geometry/q1-solid/polyhedron.ts";
import type { ConvexCell } from "../../src/world/geometry/q1-solid/polyhedron.ts";
import type { Plane } from "../../src/contracts/math.ts";

test("shared BSP split preserves independently clipped complementary cells", () => {
  let count = 0;
  function check(cell: ConvexCell, plane: Plane) {
    const result = splitCell(cell, plane);
    deepStrictEqual(result.front, clipCell(cell, negatePlane(plane)), `front ${count}`);
    deepStrictEqual(result.back, clipCell(cell, plane), `back ${count}`);
    count++;
    return result;
  }
  for (const extent of [0, Number.MIN_VALUE, 1e-10, 1, 32, 32768, 2 ** 1022]) {
    const cell = boxCell({ min: { x: -extent, y: -extent, z: -extent }, max: { x: extent, y: extent, z: extent } });
    const normals = [{ x: 1, y: 0, z: 0 }, { x: -1, y: -0, z: 0 }, { x: 0, y: 1, z: -0 }, { x: 0, y: 0, z: 1 },
      { x: -0, y: -0, z: -0 }, { x: 1, y: 1, z: 0 }, { x: 0.3, y: -0.7, z: 0.6 },
      { x: Number.MIN_VALUE, y: -Number.MIN_VALUE, z: 0 }, { x: Infinity, y: 1, z: 0 }, { x: NaN, y: 0, z: 1 }];
    for (const normal of normals) for (const distance of [-Infinity, -extent, -1e-8, -0, 0, 1e-8, extent, Infinity, NaN]) check(cell, { normal, distance });
  }
  let state = 5;
  function random(): number { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 0) / 4294967296; }
  for (let round = 0; round < 250; round++) {
    let cell: ConvexCell | null = boxCell({ min: { x: -32, y: -32, z: -32 }, max: { x: 32, y: 32, z: 32 } });
    for (let step = 0; step < 12 && cell !== null; step++) {
      const result = check(cell, { normal: { x: random() * 2 - 1, y: random() * 2 - 1, z: random() * 2 - 1 }, distance: random() * 32 - 16 });
      cell = random() < 0.5 ? result.front : result.back;
    }
  }
});

test("cell bounds preserve repeated split results at numeric and tolerance boundaries", () => {
  const cells: readonly ConvexCell[] = [
    { faces: [] },
    boxCell({ min: { x: -0, y: 0, z: -0 }, max: { x: 0, y: -0, z: 0 } }),
    boxCell({ min: { x: -1, y: -2, z: -3 }, max: { x: 4, y: 5, z: 6 } }),
    boxCell({ min: { x: -Number.MIN_VALUE, y: 0, z: 0 }, max: { x: Number.MIN_VALUE, y: 0, z: 0 } }),
    boxCell({ min: { x: -Number.MAX_VALUE, y: -Number.MAX_VALUE, z: -1 }, max: { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 1 } }),
    boxCell({ min: { x: Number.MAX_VALUE / 2, y: -Number.MAX_VALUE, z: 0 }, max: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE / 2, z: 1 } }),
    boxCell({ min: { x: NaN, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }),
    boxCell({ min: { x: -Infinity, y: 0, z: 0 }, max: { x: Infinity, y: 1, z: 1 } }),
  ];
  const normals = [{ x: 1, y: -0, z: 0 }, { x: -1, y: 0, z: -0 }, { x: 1, y: 1, z: -1 },
    { x: 2, y: -2, z: 0 }, { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: -Number.MAX_VALUE },
    { x: Number.MIN_VALUE, y: -Number.MIN_VALUE, z: 0 }, { x: -0, y: 0, z: -0 },
    { x: Infinity, y: 0, z: 0 }, { x: NaN, y: 1, z: 0 }];
  const thresholdStep = 1e-8 * Number.EPSILON;
  const distances = [-Infinity, -Number.MAX_VALUE, -64, -1e-8 - thresholdStep, -1e-8, -1e-8 + thresholdStep,
    -0, 0, 1e-8 - thresholdStep, 1e-8, 1e-8 + thresholdStep, 64, Number.MAX_VALUE, Infinity, NaN];
  for (const cell of cells) for (const normal of normals) for (const distance of distances) {
    const plane = { normal, distance };
    const expected = { front: clipCell(cell, negatePlane(plane)), back: clipCell(cell, plane) };
    deepStrictEqual(splitCell(cell, plane), expected);
    deepStrictEqual(splitCell(cell, plane), expected);
  }
});
