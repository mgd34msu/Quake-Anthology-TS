import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ClockProfile, FrameContext, FrameOrdering } from "../../src/contracts/time.ts";
import { compareInvocationOrder, thinkCallbackTime } from "../../src/world/scheduler.ts";

test("think deadlines retain NetQuake, classic Q2 and rerelease timing", () => {
  const frame: FrameContext = { frame: 10, phase: "entity-physics",
    time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.05 } };
  const nq: ClockProfile = { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null };
  expect(thinkCallbackTime(nq, { kind: "seconds", value: 1.04 }, frame)).toEqual({ kind: "seconds", value: 1.04 });
  expect(thinkCallbackTime(nq, { kind: "seconds", value: 0.5 }, frame)).toEqual(frame.time);
  expect(thinkCallbackTime(nq, { kind: "seconds", value: 1.06 }, frame)).toBeNull();
  expect(thinkCallbackTime({ kind: "q2-classic", frameMilliseconds: 100 }, { kind: "seconds", value: 1.001 }, frame)).toEqual(frame.time);
  const ms: FrameContext = { ...frame, time: { kind: "milliseconds", value: 1000 }, elapsed: { kind: "milliseconds", value: 50 } };
  const rerelease: ClockProfile = { kind: "q2-rerelease", frameMilliseconds: 100, preparation: "before-frame" };
  expect(thinkCallbackTime(rerelease, { kind: "milliseconds", value: 1001 }, ms)).toBeNull();
  expect(thinkCallbackTime(rerelease, { kind: "milliseconds", value: 1000 }, ms)).toEqual(ms.time);
  expect(() => thinkCallbackTime(rerelease, { kind: "seconds", value: 1 }, frame)).toThrow("source unit");
});

test("native traversal uses source slots and mixed ties use explicit provider order", () => {
  const owner = createIdentityOwner("scheduler order");
  const lowSlot = { actor: owner.actor(2, 0), provider: "q3:game", sequence: 4 } satisfies Parameters<typeof compareInvocationOrder>[1];
  const highSlot = { actor: owner.actor(9, 0), provider: "q1:game", sequence: 1 } satisfies Parameters<typeof compareInvocationOrder>[1];
  const mixed: FrameOrdering = { kind: "mixed", providers: ["q1:game", "q3:game"], entityOrder: "source-slot-order", ties: "provider-entity-invocation" };
  expect(compareInvocationOrder(mixed, highSlot, lowSlot)).toBeLessThan(0);
  const native: FrameOrdering = { kind: "native", traversal: "source-slot-order",
    clock: { kind: "q3", serverFrameMilliseconds: 50, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 } };
  expect(compareInvocationOrder(native, lowSlot, highSlot)).toBeLessThan(0);
  expect(compareInvocationOrder(mixed, lowSlot, { ...lowSlot, sequence: 5 })).toBeLessThan(0);
});
