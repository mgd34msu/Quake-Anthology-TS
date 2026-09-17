import type { CvarRegistry } from "../../core/cvars/index.ts";
import { bindCvarSetting } from "./index.ts";
import type { SettingBinding } from "./index.ts";

export interface GameplaySettingsSource {
  readonly cvars: CvarRegistry;
  readonly autoSwitch?: { read(): "always" | "new" | "never"; write(value: "always" | "new" | "never"): void };
}
export function bindGameplaySettings(source: GameplaySettingsSource): readonly SettingBinding[] {
  const settings: SettingBinding[] = [];
  for (const [name, label] of [["sv_autosave", "Automatic saves"], ["cg_drawGun", "Draw weapon"], ["cg_simpleItems", "Simple items"], ["cg_marks", "Wall marks"], ["cg_drawCrosshairNames", "Target names"]]) {
    if (name !== undefined && label !== undefined && source.cvars.find(name) !== undefined) settings.push(bindCvarSetting(source.cvars, { name, label, kind: "toggle", category: "accessibility", restart: null }, null));
  }
  const autoSwitch = source.autoSwitch;
  if (autoSwitch !== undefined) settings.push({ id: "ui:gameplay:autoswitch", label: "Switch to picked-up weapons", category: "input", kind: "choice", enabled: () => true,
    read: () => autoSwitch.read(), choices: () => [{ id: "always", label: "Always" }, { id: "new", label: "New weapons" }, { id: "never", label: "Never" }],
    write: value => { if (value === "always" || value === "new" || value === "never") autoSwitch.write(value); } });
  for (const [name, label] of [["name", "Player name"], ["model", "Player model / skin"], ["headmodel", "Head model / skin"]]) {
    if (name !== undefined && label !== undefined && source.cvars.find(name) !== undefined) settings.push(bindCvarSetting(source.cvars, { name, label, kind: "text-entry", maximumLength: 64, submitOnly: true, category: "network", restart: null }, null));
  }
  return settings;
}

export function resetGameplaySettings(source: GameplaySettingsSource): void {
  for (const binding of bindGameplaySettings(source)) {
    const name = binding.id.replace("ui:settings:", "");
    const value = source.cvars.find(name);
    if (value !== undefined) source.cvars.set(name, value.resetValue);
  }
}
