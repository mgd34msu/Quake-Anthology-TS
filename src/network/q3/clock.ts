// CL_SetCGameTime and CL_AdjustTimeDelta, cl_cgame.c. GPL-2.0-or-later.
import { CommonError } from "../../core/common-error.ts";
import type { Snapshot } from "./server-message.ts";

function sourceClock(value: number): number {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new RangeError("Q3 source clock arithmetic exceeds signed int32");
  return value;
}
export interface Q3ClockOptions {
  readonly paused: boolean;
  readonly timeNudge: number;
  readonly timescale: number;
  readonly demo: boolean;
  readonly freezeDemo: boolean;
  readonly timedemo: boolean;
}
export class Q3ClientClock {
  time = 0;
  delta = 0;
  private oldTime = 0;
  private oldFrameServerTime = 0;
  private pending = false;
  private extrapolated = false;
  private current: Snapshot | null = null;
  private active = false;
  private demoBaseTime = 0;
  private demoFrames = 0;
  private demoStart = 0;
  publish(snapshot: Snapshot): void { this.current = snapshot; this.pending = true; }
  clear(): void {
    this.time = 0; this.delta = 0; this.oldTime = 0; this.oldFrameServerTime = 0;
    this.pending = false; this.extrapolated = false; this.current = null; this.active = false;
    this.demoBaseTime = 0; this.demoFrames = 0; this.demoStart = 0;
  }
  /** Call after module initialization has primed this client; returns null until its first active snapshot. */
  advance(realTime: number, options: Q3ClockOptions): number | null {
    sourceClock(realTime);
    const snapshot = this.current;
    if (!this.active) {
      if (!this.pending || snapshot === null || (snapshot.flags & 2) !== 0) return null;
      this.pending = false; this.active = true; this.delta = sourceClock(snapshot.serverTime - realTime);
      this.oldTime = snapshot.serverTime; this.demoBaseTime = snapshot.serverTime;
    }
    if (snapshot === null) throw new CommonError("drop", "CL_SetCGameTime: !cl.snap.valid");
    if (options.paused) return this.time;
    if (snapshot.serverTime < this.oldFrameServerTime) throw new CommonError("drop", "cl.snap.serverTime < cl.oldFrameServerTime");
    this.oldFrameServerTime = snapshot.serverTime;
    if (!options.demo || !options.freezeDemo) {
      const nudge = Math.max(-30, Math.min(30, Math.trunc(options.timeNudge)));
      this.time = sourceClock(sourceClock(realTime + this.delta) - nudge);
      if (this.time < this.oldTime) this.time = this.oldTime;
      this.oldTime = this.time;
      if (sourceClock(realTime + this.delta) >= sourceClock(snapshot.serverTime - 5)) this.extrapolated = true;
    }
    if (this.pending) {
      this.pending = false;
      if (!options.demo) {
        const next = sourceClock(snapshot.serverTime - realTime), distance = sourceClock(Math.abs(sourceClock(next - this.delta)));
        if (distance > 500) { this.delta = next; this.oldTime = snapshot.serverTime; this.time = snapshot.serverTime; }
        else if (distance > 100) this.delta = sourceClock(this.delta + next) >> 1;
        else if (options.timescale === 0 || options.timescale === 1) {
          if (this.extrapolated) { this.extrapolated = false; this.delta = sourceClock(this.delta - 2); }
          else this.delta = sourceClock(this.delta + 1);
        }
      }
    }
    if (options.demo && options.timedemo) {
      if (this.demoStart === 0) this.demoStart = realTime;
      this.demoFrames = sourceClock(this.demoFrames + 1);
      this.time = sourceClock(this.demoBaseTime + sourceClock(this.demoFrames * 50));
    }
    return this.time;
  }
  needsDemoMessage(): boolean { return this.current !== null && this.time >= this.current.serverTime; }
  demoTiming(milliseconds: number): { readonly frames: number; readonly elapsedMilliseconds: number } | null {
    const elapsed = sourceClock(milliseconds - this.demoStart);
    return elapsed > 0 ? { frames: this.demoFrames, elapsedMilliseconds: elapsed } : null;
  }
}
