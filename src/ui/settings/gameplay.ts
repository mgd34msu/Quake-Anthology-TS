import type { CvarRegistry } from "../../core/cvars/index.ts";
import { nativeAtoi } from "../../core/numeric.ts";
import { bindCvarSetting } from "./index.ts";
import type { SettingBinding } from "./index.ts";

export interface GameplaySettingsSource {
  readonly cvars: CvarRegistry;
  readonly client?: CvarRegistry;
  readonly weaponPickupPolicy?: "shared" | "source-owned";
}
export function bindGameplaySettings(source: GameplaySettingsSource): readonly SettingBinding[] {
  const settings: SettingBinding[] = [], client = source.client ?? source.cvars;
  for (const [name, label] of [["sv_autosave", "Autosave on level load"], ["cg_drawGun", "Draw weapon"], ["cg_simpleItems", "Simple items"], ["cg_marks", "Wall marks"], ["cg_drawCrosshairNames", "Target names"]]) {
    const cvars = name === "sv_autosave" ? source.cvars : client;
    if (name !== undefined && label !== undefined && cvars.find(name) !== undefined) settings.push(bindCvarSetting(cvars, { name, label, kind: "toggle", category: "accessibility", restart: null }, null));
  }
  const autoSwitch = client.dialect === "q3" ? "cg_autoswitch" : client.dialect === "q2-rerelease" ? "autoswitch"
    : client.dialect === "q1-netquake" || client.dialect === "q1-quakeworld" ? "qts_weapon_autoswitch" : null;
  if (autoSwitch !== null && client.find(autoSwitch) !== undefined) {
    if (autoSwitch === "qts_weapon_autoswitch" && source.weaponPickupPolicy !== "shared") settings.push({
      id: "ui:gameplay:source-weapon-switching", label: "This game controls weapon pickup switching", kind: "button", category: "input",
      enabled: () => false, activate: () => {},
    });
    else if (client.dialect === "q3") settings.push(bindCvarSetting(client, { name: autoSwitch, label: "Switch to picked-up weapons", kind: "toggle", category: "input", restart: null }, null));
    else settings.push(bindCvarSetting(client, { name: autoSwitch, label: "Switch to picked-up weapons", kind: "choice", category: "input", restart: null,
      choices: client.dialect === "q2-rerelease" ? [{ id: "0", label: "Smart" }, { id: "1", label: "Always" }, { id: "2", label: "Except consumable weapons" }, { id: "3", label: "Never" }]
        : [{ id: "always", label: "Always" }, { id: "new", label: "New weapons" }, { id: "never", label: "Never" }] }, null));
  }
  const playerName = client.dialect === "q1-netquake" && client.find("name") === undefined ? "_cl_name" : "name";
  const identity = client.dialect === "q3" ? [[playerName, "Player name"], ["model", "Player model / skin"], ["headmodel", "Head model / skin"]]
    : client.dialect.startsWith("q2") ? [[playerName, "Player name"], ["skin", "Player skin (model/skin)"]] : [[playerName, "Player name"]];
  for (const [name, label] of identity) {
    if (name !== undefined && label !== undefined && client.find(name) !== undefined) settings.push(bindCvarSetting(client, { name, label, kind: "text-entry",
      maximumLength: client.dialect === "q1-netquake" ? 15 : 63, submitOnly: true, category: "network", restart: null }, null));
  }
  const colors = Array.from({ length: 14 }, (_, index) => ({ id: String(index), label: String(index) }));
  if (client.dialect === "q1-netquake") {
    const name = client.find("color") === undefined ? "_cl_color" : "color";
    if (client.find(name) !== undefined) for (const { id, label, shift } of [{ id: "shirt", label: "Shirt color", shift: 4 }, { id: "pants", label: "Pants color", shift: 0 }]) {
      settings.push({ id: `ui:gameplay:${id}-color`, label, kind: "choice", category: "network", enabled: () => true, choices: () => colors,
        read: () => String(Math.min(13, (nativeAtoi(client.variableString(name)) >> shift) & 15)),
        write: value => { if (!colors.some(color => color.id === value)) throw new Error("Unknown Quake color");
          const previous = nativeAtoi(client.variableString(name)); client.set(name, String((previous & ~(15 << shift)) | (Number(value) << shift))); } });
    }
  } else if (client.dialect === "q1-quakeworld") {
    for (const [name, label] of [["topcolor", "Shirt color"], ["bottomcolor", "Pants color"]])
      if (name !== undefined && label !== undefined && client.find(name) !== undefined) settings.push(bindCvarSetting(client, { name, label, kind: "choice", choices: colors, category: "network", restart: null }, null));
  } else if (client.dialect.startsWith("q2")) {
    if (client.find("hand") !== undefined) settings.push(bindCvarSetting(client, { name: "hand", label: "Weapon hand", kind: "choice",
      choices: [{ id: "0", label: "Right" }, { id: "1", label: "Left" }, { id: "2", label: "Center" }], category: "network", restart: null }, null));
    if (client.find("fov") !== undefined) settings.push(bindCvarSetting(client, { name: "fov", label: "Field of view", kind: "slider", minimum: 1, maximum: 160, step: 1, category: "video", restart: null }, null));
  }
  return settings;
}

export function resetGameplaySettings(source: GameplaySettingsSource): void {
  const client = source.client ?? source.cvars;
  for (const binding of bindGameplaySettings(source)) {
    const name = binding.id === "ui:gameplay:shirt-color" || binding.id === "ui:gameplay:pants-color"
      ? client.find("color") === undefined ? "_cl_color" : "color" : binding.id.replace("ui:settings:", "");
    const cvars = name === "sv_autosave" ? source.cvars : client, value = cvars.find(name);
    if (value !== undefined) cvars.set(name, value.resetValue);
  }
}
