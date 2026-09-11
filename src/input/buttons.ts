// Quake cl_input.c kbutton state, with Q2/Q3 millisecond sampling.
// Copyright (C) id Software. GPL-2.0-or-later.
export type ButtonTiming = "q1" | "q2" | "q3";

export class InputButton {
  private readonly sources = new Set<string>();
  private downTime = 0;
  private milliseconds = 0;
  private impulseDown = false;
  private impulseUp = false;
  get active(): boolean { return this.sources.size !== 0; }
  get pressed(): boolean { return this.impulseDown; }

  down(source: string, timeMilliseconds: number): void {
    if (this.sources.has(source)) return;
    const active = this.active;
    this.sources.add(source);
    if (active) return;
    this.downTime = timeMilliseconds;
    this.impulseDown = true;
  }
  up(source: string, timeMilliseconds: number, missingTimeMilliseconds = 10): void {
    if (!this.sources.delete(source) || this.active) return;
    this.milliseconds += timeMilliseconds === 0 ? missingTimeMilliseconds : Math.max(0, timeMilliseconds - this.downTime);
    this.impulseUp = true;
  }
  release(timeMilliseconds: number): void {
    for (const source of this.sources) this.up(source, timeMilliseconds);
  }
  sample(timing: ButtonTiming, nowMilliseconds: number, frameMilliseconds: number): number {
    let result: number;
    if (timing === "q1") {
      result = this.impulseDown && this.impulseUp ? this.active ? 0.75 : 0.25
        : this.impulseDown ? this.active ? 0.5 : 0 : this.active ? 1 : 0;
    } else {
      if (this.active) {
        this.milliseconds += this.downTime === 0 ? nowMilliseconds : Math.max(0, nowMilliseconds - this.downTime);
        this.downTime = nowMilliseconds;
      }
      const value = timing === "q3" ? Math.fround(Math.fround(this.milliseconds) / Math.fround(frameMilliseconds)) : this.milliseconds / frameMilliseconds;
      result = Math.max(0, Math.min(1, value));
    }
    this.milliseconds = 0;
    this.impulseDown = false;
    this.impulseUp = false;
    return result;
  }
  clear(): void {
    this.sources.clear(); this.milliseconds = 0; this.downTime = 0;
    this.impulseDown = false; this.impulseUp = false;
  }
}
