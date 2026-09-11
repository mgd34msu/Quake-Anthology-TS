import type { ProviderId } from "../../contracts/identity.ts";
import type { RandomSource, RandomState } from "../../contracts/numeric.ts";
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

interface ProviderRuntime { readonly clock: SourceClock; readonly random: RandomSource; }

/** Draws remain on the registered generator; observing a checkpoint never draws. */
export class ProviderRuntimeState {
  private readonly providers = new Map<ProviderId, ProviderRuntime>();
  private closed = false;

  register(provider: ProviderId, clock: SourceClock, random: RandomSource): undefined {
    this.assertOpen();
    if (this.providers.has(provider)) throw new Error(`Provider runtime already registered: ${provider}`);
    for (const runtime of this.providers.values()) {
      if (runtime.clock === clock || runtime.random === random) throw new Error("Providers must own distinct clocks and random generators");
    }
    this.providers.set(provider, { clock, random });
    return undefined;
  }

  clock(provider: ProviderId): SourceClock { return this.runtime(provider).clock; }
  random(provider: ProviderId): RandomSource { return this.runtime(provider).random; }

  checkpoint(): {
    readonly clocks: readonly { readonly provider: ProviderId; readonly time: SourceTime }[];
    readonly random: readonly { readonly provider: ProviderId; readonly state: RandomState }[];
  } {
    this.assertOpen();
    return {
      clocks: Array.from(this.providers, ([provider, runtime]) => ({ provider, time: copyTime(runtime.clock.frame.time) })),
      random: Array.from(this.providers, ([provider, runtime]) => ({ provider, state: copyRandomState(runtime.random.checkpoint()) })),
    };
  }

  close(): undefined { this.closed = true; this.providers.clear(); return undefined; }

  private assertOpen(): undefined {
    if (this.closed) throw new Error("Provider runtime state is closed");
    return undefined;
  }

  private runtime(provider: ProviderId): ProviderRuntime {
    this.assertOpen();
    const runtime = this.providers.get(provider);
    if (runtime === undefined) throw new Error(`Unknown provider runtime: ${provider}`);
    return runtime;
  }
}

function copyRandomState(state: RandomState): RandomState {
  switch (state.kind) {
    case "q3-lcg": case "msvcrt-rand": return { ...state };
    case "glibc-random": return { ...state, words: [...state.words] };
    case "guest": return { ...state, bytes: state.bytes.slice() };
    default: { const exhaustive: never = state; return exhaustive; }
  }
}
