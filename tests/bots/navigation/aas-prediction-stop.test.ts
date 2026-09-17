import { expect, test } from "bun:test";
import { aasPredictionStop } from "../../../src/bots/navigation/aas-prediction-stop.ts";
import { aasPointArea, parseAas, type AasAsset } from "../../../src/bots/navigation/aas.ts";
import { aasEstimateFixture } from "./estimate-fixture.ts";

test("source prediction stops at the first crossed area with source priority and initial jump-pad exception", () => {
  const base = parseAas(aasEstimateFixture([{ contents: 128 | 64 | 8 }, {}], []));
  const asset: AasAsset = { ...base, nodes: [{ plane: 0, children: [0, 0] }, { plane: 0, children: [-1, -2] }] };
  const start = { x: -10, y: 0, z: 0 }, end = { x: 10, y: 0, z: 0 }, crossing = { x: 0, y: 0, z: 0 };
  expect(aasPointArea(asset, crossing)).toBe(2);
  expect(aasPredictionStop(asset, start, end, 1, 512 | 128 | 256 | 4096, 1)).toEqual({ events: 512, origin: crossing, area: 1 });
  expect(aasPredictionStop(asset, start, end, 1, 128 | 256 | 4096, 0)).toEqual({ events: 128, origin: crossing, area: 1 });
  expect(aasPredictionStop(asset, start, end, 0, 128 | 256 | 4096, 0)).toEqual({ events: 256, origin: crossing, area: 1 });
  expect(aasPredictionStop(asset, start, end, 0, 128, 0)).toBeNull();
  expect(aasPredictionStop(asset, start, end, 1, 4096, 0)).toEqual({ events: 4096, origin: crossing, area: 1 });
  expect(aasPredictionStop(asset, start, end, 1, 1, 0)).toBeNull();
});
