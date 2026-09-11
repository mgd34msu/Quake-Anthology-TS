import { describe, expect, test } from "bun:test";
import {
  Float32VectorView, createMutableVectorMath, dot3, floorDivMod, identityMat4,
  mutableVec3, normalize3, planeFromPoints, q1DonorMath, q2DonorMath,
  transformVec4, vec3, vec4,
} from "../../src/core/math.ts";
import {
  Q3Random, Q3_BINARY32_PROFILE, checkedFloatToInt, createNumericOperations,
  float32ToBits, nativeAtof, nativeAtoi, qCrandom, qRandom, qvmFloatToInt,
} from "../../src/core/numeric.ts";
import { qvmAngleMod, qvmAngleVectors } from "../../src/core/qvm-math.ts";
import { inverseSqrt32, rendererSine } from "../../src/core/renderer-math.ts";

describe("source math", () => {
  test("RC01 donor cancellation retains separate intermediate rounding", () => {
    const left = vec3(16777216, 1, -16777216);
    const right = vec3(1, 1, 1);
    expect(q1DonorMath.DotProduct(left, right)).toBe(1);
    expect(q2DonorMath.DotProduct(left, right)).toBe(1);
    expect(dot3(left, right)).toBe(0);
    const staged = createMutableVectorMath(createNumericOperations(Q3_BINARY32_PROFILE), "clear");
    expect(staged.DotProduct(left, right)).toBe(0);
  });

  test("mutable source writes observe overlapping guest vectors", () => {
    const storage = new Float32Array([1, 2, 3, 4]);
    const input = new Float32VectorView(storage);
    const output = new Float32VectorView(storage, 4);
    q1DonorMath.VectorCopy(input, output);
    expect(Array.from(storage)).toEqual([1, 1, 1, 1]);
    const aliased = mutableVec3(1, 2, 3);
    q2DonorMath.CrossProduct(aliased, vec3(4, 5, 6), aliased);
    expect([aliased.x, aliased.y, aliased.z]).toEqual([-3, 30, -135]);
    output.x = 16777217;
    expect(input.y).toBe(16777216);
  });

  test("Q2 zero normalization retains output while Q3 clears it", () => {
    const output = mutableVec3(4, 5, 6);
    expect(q2DonorMath.VectorNormalize2(vec3(0, 0, 0), output)).toBe(0);
    expect([output.x, output.y, output.z]).toEqual([4, 5, 6]);
    const staged = createMutableVectorMath(createNumericOperations(Q3_BINARY32_PROFILE), "clear");
    staged.VectorNormalize2(vec3(0, 0, 0), output);
    expect([output.x, output.y, output.z]).toEqual([0, 0, 0]);
    expect(float32ToBits(normalize3(vec3(-0, 0, 0)).x)).toBe(0x80000000);
  });

  test("Q3 geometry and QVM angle entry points are usable", () => {
    expect(transformVec4(identityMat4(), vec4(2, 3, 4, 1))).toEqual(vec4(2, 3, 4, 1));
    expect(planeFromPoints(vec3(0, 0, 0), vec3(0, 1, 0), vec3(1, 0, 0)))
      .toEqual({ normal: vec3(0, 0, 1), distance: 0 });
    expect(qvmAngleMod(-90)).toBe(270);
    expect(qvmAngleVectors(vec3(0, 0, 0)).forward).toEqual(vec3(1, 0, -0));
    expect(rendererSine(1024)).toBe(0);
    expect(inverseSqrt32(4)).toBeCloseTo(0.5, 2);
    expect(floorDivMod(-5, 3)).toEqual({ quotient: -2, remainder: 1 });
  });

  test("QVM conversion and native byte-number parsing retain their source rules", () => {
    expect(qvmFloatToInt(2147483647)).toBe(-2147483648);
    expect(qvmFloatToInt(Number.NaN)).toBe(-2147483648);
    expect(qvmFloatToInt(-3.9)).toBe(-3);
    expect(checkedFloatToInt(2147483647)).toBe(2147483647);
    expect(() => checkedFloatToInt(Infinity)).toThrow(RangeError);
    expect(nativeAtoi(" -123tail")).toBe(-123);
    expect(nativeAtof("0x1.8p+2tail")).toBe(6);
    expect(Object.is(nativeAtof("-0"), -0)).toBe(true);
  });

  test("Q_rand follows 69069 LCG and restores an owner's draw position", () => {
    expect(qRandom(1)).toEqual({ seed: 69070, value: 3534 / 65536 });
    expect(qCrandom(1).value).toBe(2 * (3534 / 65536 - 0.5));
    const random = new Q3Random(1);
    expect(random.nextInteger()).toBe(69070);
    const saved = random.checkpoint();
    const continuation = [random.nextInteger(), random.nextUnit()];
    const restored = Q3Random.restore(saved);
    expect([restored.nextInteger(), restored.nextUnit()]).toEqual(continuation);
    expect(restored.checkpoint().draws).toBe(3);
  });
});
