// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { PoseLru } from "../../../src/formats/q12-model/pose-lru.ts";
import { interpolateAliasFrames } from "../../../src/formats/q12-model/animation.ts";
import type { ModelFrame } from "../../../src/contracts/scene.ts";

function frame(offset: number): ModelFrame {
  const zero = { x: 0, y: 0, z: 0 };
  return {
    name: `f${offset}`,
    bounds: { min: zero, max: zero },
    origin: zero,
    vertices: [{ normal: { x: 0, y: 0, z: 1 }, position: { x: offset, y: 0, z: 0 } }],
  };
}

test("PoseLru keeps at most its limit and evicts least recently used first", () => {
  const cache = new PoseLru<number>(3);
  const owner = {};
  for (let i = 0; i < 100; i++) cache.set(cache.key([owner], `${i}`), i);
  expect(cache.size).toBe(3);
  expect(cache.get(cache.key([owner], "99"))).toBe(99);
  expect(cache.get(cache.key([owner], "0"))).toBeUndefined();
});

test("alias interpolation reuses repeated lerps and stays bounded for continuous ones", () => {
  const current = frame(0),
    previous = frame(10);
  expect(interpolateAliasFrames(current, previous, 0.25)).toBe(interpolateAliasFrames(current, previous, 0.25));
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 20000; i++) interpolateAliasFrames(current, previous, Math.random());
  expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024 * 1024);
  expect(interpolateAliasFrames(current, previous, 0.5)[0]?.position.x).toBe(5);
});
