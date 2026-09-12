import { Q2CvarFlag } from "../../core/cvars/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { Q2ProductRuntime } from "../../content/composition/q2/index.ts";
import { Q2Ctf } from "../../content/q2/multiplayer/ctf/index.ts";
import { Q2Lmctf } from "../../content/q2/multiplayer/lmctf/runtime.ts";
import { createQ2PlayerRules } from "../../content/q2/base/player/types.ts";
import { createQ2CtfRules } from "../../content/q2/multiplayer/ctf/types.ts";
import { createLmctfRules } from "../../content/q2/multiplayer/lmctf/types.ts";
import { bindLmctfConsoleRules } from "./lmctf-cvars.ts";
import { q2CombatSettings, q2CtfCaptureSettings, q2LimitSettings, q2SpawnSettings } from "./q2.ts";
import { lmctfLimitSettings, lmctfRuneSettings, lmctfWeaponSettings } from "./lmctf.ts";
import type { ServerSettingCollection } from "./types.ts";

export function q2ServerSettingCollections(match: string, q2Combat: boolean): readonly ServerSettingCollection[] {
  return [q2SpawnSettings(), ...(q2Combat ? [q2CombatSettings()] : []),
    ...(match === "q2:lmctf" ? [lmctfLimitSettings(), lmctfRuneSettings(), lmctfWeaponSettings()] : [q2LimitSettings()]),
    ...(match === "q2:ctf" ? [q2CtfCaptureSettings()] : [])];
}
export function registerQ2ServerCvars(cvars: CvarRegistry, match: string): void {
  const defaults = createQ2PlayerRules();
  cvars.register("dmflags", "0", Q2CvarFlag.ServerInfo);
  cvars.register("timelimit", String(defaults.timeLimitMinutes), Q2CvarFlag.ServerInfo);
  cvars.register("fraglimit", String(defaults.fragLimit), Q2CvarFlag.ServerInfo);
  if (match === "q2:ctf") cvars.register("capturelimit", String(createQ2CtfRules().captureLimit), Q2CvarFlag.ServerInfo);
  if (match === "q2:lmctf") bindLmctfConsoleRules(cvars, createLmctfRules());
}
export function bindQ2ServerCvars(cvars: CvarRegistry, product: Q2ProductRuntime): void {
  const mode = product.match.source;
  if (mode instanceof Q2Lmctf) bindLmctfConsoleRules(cvars, mode.rules);
  else for (const [key, name] of [["timeLimitMinutes", "timelimit"], ["fragLimit", "fraglimit"]] satisfies readonly (readonly ["timeLimitMinutes" | "fragLimit", string])[]) {
    Object.defineProperty(product.players.rules, key, { enumerable: true, configurable: true,
      get: () => cvars.variableValue(name), set: (value: number) => { cvars.set(name, String(value)); } });
  }
  if (mode instanceof Q2Ctf) Object.defineProperty(mode.rules, "captureLimit", { enumerable: true, configurable: true,
    get: () => cvars.variableValue("capturelimit"), set: (value: number) => { cvars.set("capturelimit", String(value)); } });
}
