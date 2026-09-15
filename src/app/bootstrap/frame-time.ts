import type { CommandDialect } from "../../contracts/common.ts";
import { CvarFlag, Q2CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";

export interface FrameTimeControls {
  readonly timescale: number;
  readonly fixedtime: number;
  readonly hostFramerate: number;
  readonly cameraMode: number;
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

const frameTimeMirrors = new WeakMap<CvarRegistry, { clients: Set<FrameTimeCvarMirror>; releases: (() => void)[] }>();

/** Cgame accesses a seat registry while engine time remains owned by its source world. */
export class FrameTimeCvarMirror {
  private readonly releases: (() => void)[] = [];
  private refreshing = false;
  constructor(private readonly owner: CvarRegistry, private readonly mirror: CvarRegistry, assertCurrent: () => void) {
    for (const name of frameTimeCvarNames(owner.dialect)) {
      const value = owner.find(name);
      if (value !== undefined) mirror.register(name, value.resetValue, value.flags);
    }
    this.refresh();
    try {
      for (const name of frameTimeCvarNames(owner.dialect)) if (owner.find(name) !== undefined) {
        this.releases.push(mirror.bindValue(name, { validate: () => null, changed: value => {
          if (!this.refreshing) { assertCurrent(); owner.set(name, value, true); }
        } }));
      }
      let shared = frameTimeMirrors.get(owner);
      if (shared === undefined) {
        shared = { clients: new Set(), releases: [] };
        frameTimeMirrors.set(owner, shared);
        for (const name of frameTimeCvarNames(owner.dialect)) if (owner.find(name) !== undefined) {
          shared.releases.push(owner.bindValue(name, { validate: () => null, changed: () => {
            for (const client of frameTimeMirrors.get(owner)?.clients ?? []) client.refresh();
          } }));
        }
      }
      shared.clients.add(this);
    } catch (error) { this.close(); throw error; }
  }
  refresh(): void {
    this.refreshing = true;
    try { refreshFrameTimeCvars(this.owner, this.mirror); } finally { this.refreshing = false; }
  }
  close(): void {
    for (const release of this.releases.splice(0)) release();
    const shared = frameTimeMirrors.get(this.owner);
    if (shared === undefined) return;
    shared.clients.delete(this);
    if (shared.clients.size === 0) {
      for (const release of shared.releases) release();
      frameTimeMirrors.delete(this.owner);
    }
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
