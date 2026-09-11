import { expect, test } from "bun:test";
import { Q2RereleaseRandom } from "../../src/core/random/q2-rerelease.ts";

test("MT19937 reference sequence and source distributions resume across a twist", () => {
  const random = new Q2RereleaseRandom();
  expect(Array.from({ length: 10 }, () => random.nextUint32())).toEqual([
    3499211612, 581869302, 3890346734, 3586334585, 545404204,
    4161255391, 3922919429, 949333985, 2715962298, 1323567403,
  ]);
  for (let i = 10; i < 620; i++) random.nextUint32();
  const checkpoint = random.capture();
  const continuation = () => Array.from({ length: 8 }, () => [random.float(-1, 1), random.timeMilliseconds(3000, 10000), random.integer(-20, 50)]);
  const expected = continuation();
  random.restore(checkpoint);
  expect(continuation()).toEqual(expected);
  expect(checkpoint.index).toBe(620);
  expect(checkpoint.draws).toBe(620);
  const scalar = new Q2RereleaseRandom();
  expect([scalar.float(), scalar.timeMilliseconds(3000, 10000), scalar.float(-1, 1), scalar.integer(100)])
    .toEqual([0.8147236704826355, 3948, 0.8115838766098022, 83]);
  const before = scalar.capture().draws;
  expect(scalar.integer(7, 8)).toBe(7);
  expect(scalar.capture().draws).toBe(before);
  expect(scalar.timeMilliseconds(7, 7)).toBe(7);
  expect(scalar.capture().draws).toBe(before + 1);
  const wide = new Q2RereleaseRandom();
  expect(wide.integer64(-(1n << 63n), (1n << 63n) - 1n)).toBe(5805627399050534646n);
  expect(wide.capture().draws).toBe(2);
});

test("the selected legacy MSVC float profile preserves its rounded upper endpoint", () => {
  class MaximumWord extends Q2RereleaseRandom { override nextUint32(): number { return 0xffffffff; } }
  expect(new MaximumWord().float()).toBe(1);
});
