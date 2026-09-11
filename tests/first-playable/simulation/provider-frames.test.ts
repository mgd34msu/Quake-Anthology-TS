import { expect, test } from "bun:test";
import type { ClockProfile, FrameContext } from "../../../src/contracts/time.ts";
import { providerFrame } from "../../../src/app/bootstrap/simulation/provider-frames.ts";

const q1: ClockProfile = { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null };
const classic: ClockProfile = { kind: "q2-classic", frameMilliseconds: 100 };
const rerelease: ClockProfile = { kind: "q2-rerelease", frameMilliseconds: 25, preparation: "before-frame" };
const q3: ClockProfile = { kind: "q3", serverFrameMilliseconds: 50, fixedMovementMilliseconds: null, maximumCommandMilliseconds: 200 };
const interval: FrameContext = { frame: 5, phase: "entity-physics", time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.05 } };

test("one active world interval supplies source start and end callback clocks", () => {
  expect(providerFrame(interval, q1, q1)).toEqual(interval);
  const end = providerFrame(interval, q1, classic);
  expect(end.time).toEqual({ kind: "seconds", value: 1.05 });
  expect(end.elapsed).toEqual({ kind: "seconds", value: 0.05 });
  expect(providerFrame(end, classic, q1)).toEqual(interval);
  for (const profile of [rerelease, q3]) {
    const milliseconds = providerFrame(interval, q1, profile);
    expect(milliseconds).toEqual({ ...interval, time: { kind: "milliseconds", value: 1050 }, elapsed: { kind: "milliseconds", value: 50 } });
    expect(providerFrame(milliseconds, profile, q1)).toEqual(interval);
  }
});

test("observing an unchanged paused or restored interval never advances a source clock", () => {
  const first = providerFrame(interval, q1, rerelease);
  expect(providerFrame(interval, q1, rerelease)).toEqual(first);
  const restored: FrameContext = { ...interval, time: { ...interval.time }, elapsed: { ...interval.elapsed } };
  expect(providerFrame(restored, q1, rerelease)).toEqual(first);
  expect(interval.time).toEqual({ kind: "seconds", value: 1 });
});
