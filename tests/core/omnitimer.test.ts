import { expect, test } from "bun:test";
import { OmniTimer } from "../../src/core/omnitimer.ts";
import { sourceCaptureFrame } from "../../src/app/bootstrap/diagnostic-tools.ts";
test("nested timers count exclusive time, unwind failures and retain bounded stamps", () => {
  let now = 0; const timer = new OmniTimer(() => now, 2); timer.setEnabled(true);
  timer.measure("frame", () => { now = 2; timer.measure("render", () => { now = 5; }); now = 7; });
  expect(timer.report()).toEqual([{ name: "render", calls: 1, totalMilliseconds: 3, selfMilliseconds: 3, maximumMilliseconds: 3 }, { name: "frame", calls: 1, totalMilliseconds: 7, selfMilliseconds: 4, maximumMilliseconds: 7 }]);
  expect(() => timer.measure("error", () => { now = 9; throw new Error("failure"); })).toThrow("failure");
  for (const name of ["first", "second", "third"]) timer.stamp(name);
  expect(timer.stampList().map(stamp => stamp.name)).toEqual(["second", "third"]);
  timer.reset(); expect(timer.report()).toEqual([]); expect(() => timer.pop()).toThrow("Unbalanced");
});
test("source capture clock uses integer fps division then timescale and active/forced gate", () => {
  expect(sourceCaptureFrame(16, { fps: 30, timescale: 0.5, active: true, force: false })).toEqual({ milliseconds: 16, capture: true });
  expect(sourceCaptureFrame(16, { fps: 2000, timescale: 1, active: false, force: true })).toEqual({ milliseconds: 1, capture: true });
  expect(sourceCaptureFrame(16, { fps: 60, timescale: 1, active: false, force: false })).toEqual({ milliseconds: 16, capture: false });
  expect(sourceCaptureFrame(0, { fps: 30, timescale: 1, active: true, force: true })).toEqual({ milliseconds: 0, capture: false });
});
