import type { CvarRegistry } from "../../core/cvars/index.ts";
import { bindCvarSetting } from "./index.ts";
import type { SettingBinding } from "./index.ts";

/** The application owns registration and refresh; menus edit its existing controls. */
export function bindImageSettings(registry: CvarRegistry): readonly SettingBinding[] {
  const replacement = bindCvarSetting(registry, { name: "r_override_textures", label: "Replacement images", category: "video", restart: null,
    kind: "choice", choices: [{ id: "0", label: "Disabled" }, { id: "1", label: "Replace classic formats" }, { id: "2", label: "Replace all formats" }] }, null);
  const formats = bindCvarSetting(registry, { name: "r_texture_formats", label: "Formats (source = default)", category: "video", restart: null,
    kind: "text-entry", maximumLength: 128 }, null);
  const mask = bindCvarSetting(registry, { name: "r_texture_overrides", label: "Image types", category: "video", restart: null,
    kind: "text-entry", maximumLength: 12 }, null);
  if (mask.kind !== "text-entry") throw new Error("Image mask requires a numeric text binding");
  // quake-2-re-ts ImagetypeT bits, explicitly mapped rather than UI choice ordinals.
  const usages: readonly (readonly [string, string, number])[] = [
    ["skin", "Replace model skins", 1], ["sprite", "Replace sprites", 2], ["wall", "Replace wall textures", 4],
    ["picture", "Replace pictures", 8], ["sky", "Replace sky images", 16],
  ];
  return [replacement, formats, ...usages.map(([usage, label, bit]): SettingBinding => ({
    id: `ui:settings:image-${usage}`, label, category: "video", kind: "toggle", enabled: mask.enabled,
    read: () => (Number(mask.read()) & bit) !== 0,
    write: value => { const current = Number(mask.read()); mask.write(String(value ? current | bit : current & ~bit)); },
  }))];
}
