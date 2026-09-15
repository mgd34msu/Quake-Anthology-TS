import { expect, test } from "bun:test";
import { PresentationTime } from "../../../src/app/bootstrap/frame-clock.ts";
import { Q3ClientClock } from "../../../src/network/q3/clock.ts";
import { PlayerStateRecord } from "../../../src/network/q3/state/player.ts";
import type { Snapshot } from "../../../src/network/q3/server-message.ts";

function snapshot(serverTime: number, messageNumber = 1): Snapshot {
  return { messageNumber, serverTime, deltaNumber: -1, flags: 0, serverCommandNumber: 0, parseEntitiesNumber: 0,
    areaMask: new Uint8Array(32), playerState: new PlayerStateRecord("baseq3", 0, 0, 0), entities: [] };
}
const options = { paused: false, timeNudge: 0, timescale: 0.5, demo: false, freezeDemo: false, timedemo: false };

test("presentation time commits once per frame and remains fixed across async work", () => {
  const time = new PresentationTime();
  time.advance(1000.5, 16.5, 16.5); expect(time.milliseconds).toBe(1000.5);
  const receivedAt = time.milliseconds;
  time.advance(1100.5, 100, 50); expect(time.milliseconds - receivedAt).toBe(50);
  time.advance(1200.5, 100, 100); expect(time.milliseconds - receivedAt).toBe(150);
  time.advance(1300.5, 100, 200); expect(time.milliseconds - receivedAt).toBe(350);
  time.advance(1400.5, 100, 0);
  const clock = new Q3ClientClock(); clock.publish(snapshot(1000));
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 0 })).toBe(1000);
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 0 })).toBe(1000);
  time.advance(1450.5, 50, 0);
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 0 })).toBe(1000);
});

test("Q3 scaled clock preserves server authority through initial join, scale return, large reset and extrapolation", () => {
  const time = new PresentationTime(), clock = new Q3ClientClock();
  time.advance(5000, 1000, 500);
  clock.publish(snapshot(1000));
  expect(clock.advance(Math.trunc(time.milliseconds), options)).toBe(1000); expect(clock.delta).toBe(-3500);
  time.advance(5100, 100, 50);
  expect(clock.advance(Math.trunc(time.milliseconds), options)).toBe(1050);
  clock.publish(snapshot(1050, 2));
  expect(clock.advance(Math.trunc(time.milliseconds), options)).toBe(1050); expect(clock.delta).toBe(-3500);
  time.advance(5200, 100, 100);
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 1 })).toBe(1150);
  clock.publish(snapshot(2000, 3));
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 1 })).toBe(2000); expect(clock.delta).toBe(-2650);
  time.advance(5300, 100, 100);
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 1 })).toBe(2100);
  clock.publish(snapshot(2100, 4));
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 1 })).toBe(2100); expect(clock.delta).toBe(-2652);
  time.advance(5400, 100, 100);
  expect(clock.advance(Math.trunc(time.milliseconds), { ...options, timescale: 1 })).toBe(2198);
});
