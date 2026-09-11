import { describe, expect, test } from "bun:test";
import { evaluateScenarios } from "./scenarios.ts";
import { subdivideMove } from "./semantics.ts";

describe("Q3 original-source derived expectations", () => {
  for (const scenario of evaluateScenarios()) {
    for (const assertion of scenario.assertions) {
      test(`${scenario.id}/${assertion.id}`, () => {
        expect(assertion.actual).toEqual(assertion.expected);
        expect(assertion.passed).toBe(true);
      });
    }
  }
  test("invalid fixed subdivision cannot hang the bounded evaluator", () => {
    for (const msec of [0, -1, 0.5, Number.NaN]) {
      expect(() => subdivideMove({
        commandTime: 0, serverTime: 1, framecount: 0, subdivision: { kind: "fixed", msec }, jumpHeld: false, upmove: 0,
      })).toThrow("Fixed subdivision must be a positive integer");
    }
  });
});
