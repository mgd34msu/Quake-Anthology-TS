import type { UiSkin } from "./skin.ts";
import type { UiPreferenceValues } from "../settings/index.ts";

export function accessibleColors(colors: UiSkin["colors"], appearance: { readonly highContrast: boolean; readonly colorMode?: UiPreferenceValues["colorMode"] }): UiSkin["colors"] {
  const white = { x: 1, y: 1, z: 1, w: 1 }, black = { x: 0, y: 0, z: 0, w: 1 };
  const base = appearance.highContrast ? { ...colors, text: white, disabled: { x: 0.65, y: 0.65, z: 0.65, w: 1 }, accent: { x: 1, y: 1, z: 0, w: 1 }, panel: black, control: black, focused: { x: 0.2, y: 0.2, z: 0.2, w: 1 } } : colors;
  if (appearance.colorMode === "monochrome") return { ...base, text: white, accent: white, focused: { x: 0.25, y: 0.25, z: 0.25, w: 1 } };
  if (appearance.colorMode === "blue-yellow") return { ...base, accent: { x: 1, y: 0.9, z: 0.2, w: 1 }, focused: { x: 0.06, y: 0.2, z: 0.42, w: 1 } };
  return base;
}
