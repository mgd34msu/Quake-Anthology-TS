import { SharedCvarMirror } from "../../core/cvars/mirror.ts";
import type { CommandDialect } from "../../contracts/common.ts";
import { CvarFlag, Q2CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";

export interface FrameTimeControls {
  readonly timescale: number;
  readonly fixedtime: number;
  readonly hostFramerate: number;
  readonly cameraMode: number;
}

/** SV_CheckPaused counts connected humans, including clients that have not begun. */
export function q3ServerPaused(cvars: CvarRegistry, requested: boolean, connectedHumans: number): boolean {
  if (cvars.find("sv_paused") === undefined) cvars.register("sv_paused", "0", CvarFlag.ReadOnly);
  if (!requested) return false;
  const paused = connectedHumans <= 1;
  cvars.set("sv_paused", paused ? "1" : "0", true);
  return paused;
}

export function frameTimeCvarNames(dialect: CommandDialect): readonly string[] {
  return dialect.startsWith("q1") ? ["timescale", "host_framerate"]
    : dialect.startsWith("q2") ? ["timescale", "fixedtime"] : ["timescale", "fixedtime", "com_cameraMode"];
}

export function refreshFrameTimeCvars(owner: CvarRegistry, mirror: CvarRegistry): void {
  for (const name of frameTimeCvarNames(owner.dialect)) {
    const value = owner.find(name);
    if (value !== undefined) mirror.set(name, value.value, true);
  }
}

/** Cgame accesses a seat registry while engine time remains owned by its source world. */
export class FrameTimeCvarMirror extends SharedCvarMirror {
  constructor(owner: CvarRegistry, mirror: CvarRegistry, assertCurrent: () => void) {
    super(owner, mirror, frameTimeCvarNames(owner.dialect).filter(name => owner.find(name) !== undefined), assertCurrent);
  }
}

export function registerFrameTimeCvars(cvars: CvarRegistry): void {
  const q1 = cvars.dialect.startsWith("q1"), q2 = cvars.dialect.startsWith("q2");
  const register = (name: string, value: string, flags: number): void => {
    if (!q1 || cvars.find(name) === undefined) cvars.register(name, value, flags);
  };
  register("timescale", "1", q1 ? 0 : q2 ? Q2CvarFlag.Cheat : CvarFlag.Cheat | CvarFlag.SystemInfo);
  if (q1) register("host_framerate", "0", 0);
  else {
    register("fixedtime", "0", q2 ? Q2CvarFlag.Cheat : CvarFlag.Cheat);
    if (!q2) register("com_cameraMode", "0", CvarFlag.Cheat);
  }
}

export function readFrameTimeControls(cvars: CvarRegistry): FrameTimeControls {
  return { timescale: cvars.find("timescale")?.numericValue ?? 1,
    fixedtime: cvars.dialect === "q3" ? cvars.find("fixedtime")?.integerValue ?? 0 : cvars.variableValue("fixedtime"),
    hostFramerate: cvars.variableValue("host_framerate"), cameraMode: cvars.find("com_cameraMode")?.integerValue ?? 0 };
}

/** Transform simulation/client frame deltas; socket timestamps remain wall time. */
export function sourceFrameMilliseconds(dialect: CommandDialect, rawMilliseconds: number, controls: FrameTimeControls,
  host: { readonly dedicated: boolean; readonly localServer: boolean }): number {
  if (!Number.isFinite(rawMilliseconds) || rawMilliseconds < 0) throw new RangeError("Frame milliseconds must be finite and nonnegative");
  if (![controls.timescale, controls.fixedtime, controls.hostFramerate, controls.cameraMode].every(Number.isFinite))
    throw new RangeError("Frame time controls must be finite");
  if (dialect === "q1-netquake" || dialect === "q1-quakeworld") {
    if (controls.hostFramerate > 0) return controls.hostFramerate * 1000;
    const scaled = controls.timescale === 0 ? rawMilliseconds : rawMilliseconds * controls.timescale;
    return Math.max(1, Math.min(100, scaled));
  }
  if (dialect === "q2-classic" || dialect === "q2-rerelease") {
    if (controls.fixedtime !== 0) return controls.fixedtime;
    return controls.timescale === 0 ? rawMilliseconds : Math.max(1, rawMilliseconds * controls.timescale);
  }
  let milliseconds = Math.trunc(rawMilliseconds);
  const scale = Math.fround(controls.timescale);
  const fixedtime = Math.trunc(controls.fixedtime), cameraMode = Math.trunc(controls.cameraMode);
  if (fixedtime !== 0) milliseconds = fixedtime;
  else if (scale !== 0 || cameraMode !== 0) {
    const product = Math.fround(Math.fround(milliseconds) * scale);
    if (!Number.isFinite(product) || product < -2147483648 || product >= 2147483648)
      throw new RangeError("Undefined native common float-to-int time conversion");
    milliseconds = Math.trunc(product) + 0;
  }
  if (milliseconds < 1 && scale !== 0) milliseconds = 1;
  return Math.min(milliseconds, host.dedicated || !host.localServer ? 5000 : 200);
}
