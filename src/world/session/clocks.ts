import type { FrameContext, FramePhase, SourceTime } from "../../contracts/time.ts";

export function copyTime(time: SourceTime): SourceTime {
  return Object.freeze({ kind: time.kind, value: time.value });
}

export function validateTime(time: SourceTime): undefined {
  if (!Number.isFinite(time.value)) throw new RangeError("Source time must be finite");
  return undefined;
}

export function sameTimeUnit(left: SourceTime, right: SourceTime): undefined {
  if (left.kind !== right.kind) throw new RangeError("Source clocks need an explicit unit conversion");
  return undefined;
}

export function copyFrame(frame: FrameContext): FrameContext {
  return Object.freeze({ ...frame, time: copyTime(frame.time), elapsed: copyTime(frame.elapsed) });
}

/** The caller supplies its source timestep; no renderer tick or protocol chooses it. */
export class SourceClock {
  private current: FrameContext;

  constructor(initial: SourceTime, frame = 0) {
    validateTime(initial);
    if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError("Frame must be a nonnegative safe integer");
    this.current = copyFrame({ frame, time: initial, elapsed: { kind: initial.kind, value: 0 }, phase: "frame-entry" });
  }

  get frame(): FrameContext { return this.current; }

  advance(elapsed: SourceTime, phase: FramePhase = "frame-entry"): FrameContext {
    validateTime(elapsed);
    sameTimeUnit(this.current.time, elapsed);
    if (elapsed.value < 0) throw new RangeError("Elapsed source time cannot be negative");
    const time: SourceTime = { kind: elapsed.kind, value: this.current.time.value + elapsed.value };
    validateTime(time);
    if (!Number.isSafeInteger(this.current.frame + 1)) throw new RangeError("Frame counter exhausted");
    this.current = copyFrame({ frame: this.current.frame + 1, time, elapsed, phase });
    return this.current;
  }

  enter(phase: FramePhase): FrameContext {
    this.current = copyFrame({ ...this.current, phase });
    return this.current;
  }
}
