import type { ClockProfile, FrameContext } from "../../../contracts/time.ts";

function startsInterval(profile: ClockProfile): boolean {
  return profile.kind === "q1-netquake" || profile.kind === "q1-quakeworld";
}

/** Projects the active shared-world interval into a source callback's clock. */
export function providerFrame(frame: FrameContext, worldProfile: ClockProfile, providerProfile: ClockProfile): FrameContext {
  if (worldProfile.kind === providerProfile.kind) return frame;
  const milliseconds = frame.time.kind === "milliseconds" ? frame.time.value : frame.time.value * 1000;
  const elapsedMilliseconds = frame.elapsed.kind === "milliseconds" ? frame.elapsed.value : frame.elapsed.value * 1000;
  const start = startsInterval(worldProfile) ? milliseconds : milliseconds - elapsedMilliseconds;
  const time = startsInterval(providerProfile) ? start : start + elapsedMilliseconds;
  const kind = providerProfile.kind === "q2-rerelease" || providerProfile.kind === "q3" ? "milliseconds" : "seconds";
  const divisor = kind === "seconds" ? 1000 : 1;
  return { ...frame, time: { kind, value: time / divisor }, elapsed: { kind, value: elapsedMilliseconds / divisor } };
}
