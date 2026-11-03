import { expect, test } from "bun:test";
import { prepareFogVolume } from "../../src/materials/fog.ts";

const planes = [-1, 1].flatMap(sign => [0, 1, 2].map(axis => ({ normal: { x: axis === 0 ? sign : 0, y: axis === 1 ? sign : 0, z: axis === 2 ? sign : 0 }, distance: 64 })));
const map = { fogs: [{ brush: 0, visibleSide: -1 }], brushes: [{ firstSide: 0, sideCount: 6 }],
  brushSides: planes.map((_, plane) => ({ plane })), planes };
const parameters = { color: { x: 1, y: 0.5, z: 0.25 }, depthForOpaque: 128 };

test("fog volume colors are scaled by the identity light factor before quantizing to bytes", () => {
  expect(prepareFogVolume(map, 0, parameters).color).toEqual({ x: 1, y: 127 / 255, z: 63 / 255, w: 1 });
  const dim = prepareFogVolume(map, 0, parameters, 0.5).color;
  expect(dim.x).toBe(127 / 255);
  expect(dim.y).toBe(63 / 255);
  expect(dim.z).toBe(31 / 255);
});

import { parseShaderScript } from "../../src/materials/material.ts";

test("rgbGen const with missing components reads the absent ones as zero instead of failing the shader", () => {
  const stage = parseShaderScript("t\n{\n{\nmap a.tga\nrgbGen const ( 0.5 )\n}\n}\n")[0]?.stages[0];
  expect(stage?.rgbGen).toEqual({ kind: "const", color: { x: 0.5, y: 0, z: 0 } });
});
