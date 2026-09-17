import { expect, test } from "bun:test";
import { sourceMoverBoundsMatch } from "../../../src/bots/navigation/entity-binding.ts";
test("NAV2 source bounds bind a moving brush at its authored endpoint without proximity guesses", () => {
  const authored = { min: { x: -65, y: 511, z: -241 }, max: { x: 65, y: 641, z: 1 } };
  const linked = { min: { ...authored.min, z: -291 }, max: { ...authored.max, z: -49 } };
  expect(sourceMoverBoundsMatch(authored, linked, { x: 0, y: 0, z: -50 }, { x: 0, y: 0, z: 0 })).toBe(true);
  expect(sourceMoverBoundsMatch(authored, linked, { x: 0, y: 0, z: -50 }, { x: 0, y: 0, z: -50 })).toBe(false);
  expect(sourceMoverBoundsMatch(authored, linked, { x: 0, y: 0, z: -50 }, { x: 0.01, y: 0, z: 0 })).toBe(false);
});
