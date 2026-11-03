// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { ALIAS_NORMALS } from "../../../src/formats/q12-model/normals.ts";
import { bytedirs, NUMVERTEXNORMALS } from "../../../src/network/q2/anorms.ts";
import { byteToDirection } from "../../../src/content/q3/base/shared/direction-byte.ts";

// Three literal copies of the 162-entry anorms table exist; this ties them together.
test("the alias, Q2 wire and Q3 direction-byte normal tables agree", () => {
  expect(ALIAS_NORMALS).toHaveLength(NUMVERTEXNORMALS);
  expect(bytedirs).toHaveLength(NUMVERTEXNORMALS);
  for (let index = 0; index < NUMVERTEXNORMALS; index++) {
    const alias = ALIAS_NORMALS[index],
      wire = bytedirs[index],
      q3 = byteToDirection(index);
    if (alias === undefined || wire === undefined) throw new Error(`Missing normal ${index}`);
    const expected = Array.from(wire);
    expect([alias.x, alias.y, alias.z].map(value => Math.fround(value))).toEqual(expected.map(value => Math.fround(value)));
    expect([q3.x, q3.y, q3.z].map(value => Math.round(value * 1e5))).toEqual(expected.map(value => Math.round(value * 1e5)));
  }
});
