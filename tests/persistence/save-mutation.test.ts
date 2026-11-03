import { expect, test } from "bun:test";
import { decodeSaveImage, encodeSaveImage } from "../../src/persistence/save-image.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";
import { runMutations } from "../support/mutation.ts";
import { saveImageFixture } from "../support/save-fixtures.ts";

test("seeded mutants of a unified save either decode or fail with a typed error", () => {
  const valid = encodeSaveImage(saveImageFixture());
  expect(decodeSaveImage(valid).frame.frame).toBe(1);
  for (const seed of [1, 2, 3]) {
    const report = runMutations(seed, 600, valid, decodeSaveImage);
    expect(report.foreign).toEqual([]);
    expect(report.rejected).toBeGreaterThan(0);
  }
});

test("seeded mutants of a checkpoint value never escape as untyped failures", () => {
  const valid = encodeCheckpointValue({ list: [1, "two", { nested: new Uint8Array([1, 2, 3]) }, null, true, 1.5], name: "fixture", count: 7 });
  for (const seed of [11, 12]) {
    const report = runMutations(seed, 800, valid, decodeCheckpointValue);
    expect(report.foreign).toEqual([]);
  }
});
