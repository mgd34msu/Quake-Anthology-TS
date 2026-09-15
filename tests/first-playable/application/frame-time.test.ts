import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { CommandDialect } from "../../../src/contracts/common.ts";
import { CvarFlag, CvarRegistry, Q2CvarFlag } from "../../../src/core/cvars/index.ts";
import { readFrameTimeControls, registerFrameTimeCvars, sourceFrameMilliseconds } from "../../../src/app/bootstrap/frame-time.ts";

const defaults = { timescale: 1, fixedtime: 0, hostFramerate: 0, cameraMode: 0 };
const local = { dedicated: false, localServer: true };
const dialects: readonly CommandDialect[] = ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"];

test("default controls still apply native frame conversion and host limits", () => {
  for (const dialect of dialects) for (const delta of [0, 0.25, 16.6666666667, 250, 1000, 6000]) {
    const expected = dialect.startsWith("q1") ? Math.max(1, Math.min(100, delta))
      : dialect.startsWith("q2") ? Math.max(1, delta) : Math.max(1, Math.min(200, Math.trunc(delta)));
    expect(sourceFrameMilliseconds(dialect, delta, defaults, local)).toBe(expected);
  }
  expect(sourceFrameMilliseconds("q3", 1000, defaults, local)).toBe(200);
  expect(sourceFrameMilliseconds("q3", 6000, defaults, { dedicated: true, localServer: true })).toBe(5000);
  expect(sourceFrameMilliseconds("q3", 6000, defaults, { dedicated: false, localServer: false })).toBe(5000);
});

test("source time controls preserve registered values and native authority flags", () => {
  for (const dialect of dialects) {
    const cvars = new CvarRegistry({ dialect, context: { session: createIdentityOwner(dialect).session, origin: { kind: "server-console" } }, cheatsAllowed: () => true });
    registerFrameTimeCvars(cvars);
    cvars.set("timescale", "0.5"); registerFrameTimeCvars(cvars);
    expect(readFrameTimeControls(cvars).timescale).toBe(0.5);
    expect(cvars.find("timescale")?.flags).toBe(dialect === "q3" ? CvarFlag.Cheat | CvarFlag.SystemInfo : dialect.startsWith("q2") ? Q2CvarFlag.Cheat : 0);
    expect(sourceFrameMilliseconds(dialect, 40, readFrameTimeControls(cvars), local)).toBe(20);
  }
});

test("Q1 host_framerate is seconds and overrides shared scale without clamping", () => {
  expect(sourceFrameMilliseconds("q1-netquake", 20, { ...defaults, hostFramerate: 0.5, timescale: 2 }, local)).toBe(500);
  expect(sourceFrameMilliseconds("q1-quakeworld", 200, { ...defaults, timescale: 2 }, local)).toBe(100);
});

test("primary Q2 rerelease TS fixedtime and timescale preserve fractional deltas", () => {
  for (const dialect of ["q2-classic", "q2-rerelease"] satisfies readonly CommandDialect[]) {
    expect(sourceFrameMilliseconds(dialect, 17, { ...defaults, timescale: 0.5 }, local)).toBe(8.5);
    expect(sourceFrameMilliseconds(dialect, 17, { ...defaults, timescale: 0 }, local)).toBe(17);
    expect(sourceFrameMilliseconds(dialect, 17, { ...defaults, timescale: 0.001 }, local)).toBe(1);
    expect(sourceFrameMilliseconds(dialect, 17, { ...defaults, timescale: 2, fixedtime: 2.5 }, local)).toBe(2.5);
  }
});

test("Q3 native integer conversion, zero scale, camera freeze, fixed override and host caps", () => {
  expect(sourceFrameMilliseconds("q3", 17.9, { ...defaults, timescale: 0.5 }, local)).toBe(8);
  expect(sourceFrameMilliseconds("q3", 17.9, { ...defaults, timescale: 0 }, local)).toBe(17);
  expect(sourceFrameMilliseconds("q3", 17, { ...defaults, timescale: 0, cameraMode: 1 }, local)).toBe(0);
  expect(sourceFrameMilliseconds("q3", 17, { ...defaults, timescale: 0.001 }, local)).toBe(1);
  expect(sourceFrameMilliseconds("q3", 17, { ...defaults, timescale: 2, fixedtime: 7.9 }, local)).toBe(7);
  expect(sourceFrameMilliseconds("q3", 150, { ...defaults, timescale: 2 }, local)).toBe(200);
  expect(sourceFrameMilliseconds("q3", 150, { ...defaults, timescale: 2 }, { dedicated: true, localServer: true })).toBe(300);
  expect(sourceFrameMilliseconds("q3", 4000, { ...defaults, timescale: 2 }, { dedicated: false, localServer: false })).toBe(5000);
});
