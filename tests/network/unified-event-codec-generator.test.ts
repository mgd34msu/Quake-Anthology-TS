// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { codecPath, derive } from "../../tools/generate-event-codec.ts";

const source = readFileSync(codecPath, "utf8");

test("the committed unified event codec is the generator output, and a hand edit to a derived pair is regenerated", () => {
  const vec3 = 'function writeEventVec3(value: EventVec3): unknown { return { "x": value["x"], "y": value["y"], "z": value["z"] }; }';
  expect(source).toContain(vec3);
  const edited = source.replace(vec3, 'function writeEventVec3(value: EventVec3): unknown { return { "x": value["x"], "y": value["y"] }; }');
  const result = derive(edited);
  expect(result.failures).toEqual([]);
  expect(result.drift).toEqual([]);
  expect(result.derivedCount).toBeGreaterThan(90);
  expect(result.output).toBe(source);
}, 300_000);
