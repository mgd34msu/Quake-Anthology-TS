import type { SettingCvars } from "./index.ts";
import { bindCvarSetting } from "./index.ts";
import type { SettingBinding } from "./index.ts";

export function bindConsoleSettings(registry: SettingCvars): readonly SettingBinding[] {
  return [bindCvarSetting(registry, { name: "con_scale", label: "Console text size", category: "accessibility", restart: null,
    kind: "choice", choices: [{ id: "0", label: "Auto" }, { id: "1", label: "1x" }, { id: "2", label: "2x" },
      { id: "3", label: "3x" }, { id: "4", label: "4x" }] }, null)];
}
