import { CvarFlag } from "../../core/cvars/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { UiPreferenceValues, SettingCvars } from "./index.ts";

export const defaultUiPreferences: UiPreferenceValues = { hudScale: 1, textScale: 1, menuScale: 1, highContrast: false, reducedFlashes: false, captions: true, crosshair: true, crosshairSize: 8, typeface: "standard", colorMode: "standard" };
const ranges = { hudScale: [0.5, 1.5], textScale: [0.75, 2], menuScale: [0.75, 1], crosshairSize: [2, 32] } satisfies Partial<Record<keyof UiPreferenceValues, readonly number[]>>;
const toggles = ["highContrast", "reducedFlashes", "captions", "crosshair"] satisfies readonly (keyof UiPreferenceValues)[];
function name(seat: number, key: keyof UiPreferenceValues): string { return `ui_seat${seat + 1}_${key}`; }
export function registerAccessibilitySettings(cvars: CvarRegistry): void {
  for (let seat = 0; seat < 4; seat++) {
    for (const key of ["hudScale", "textScale", "menuScale", "crosshairSize"] satisfies readonly (keyof typeof ranges)[]) {
      const bounds = ranges[key], low = bounds[0], high = bounds[1];
      if (low === undefined || high === undefined) throw new Error("Missing accessibility bounds");
      cvars.register(name(seat, key), String(defaultUiPreferences[key]), CvarFlag.Archive);
      cvars.bindValue(name(seat, key), { validate: value => Number.isFinite(Number(value)) && Number(value) >= low && Number(value) <= high ? null : `Expected ${low} through ${high}`, changed: () => {} });
    }
    for (const key of toggles) {
      cvars.register(name(seat, key), defaultUiPreferences[key] ? "1" : "0", CvarFlag.Archive);
      cvars.bindValue(name(seat, key), { validate: value => value === "0" || value === "1" ? null : "Expected 0 or 1", changed: () => {} });
    }
    for (const key of ["typeface", "colorMode"] satisfies readonly (keyof UiPreferenceValues)[]) {
      const choices = key === "typeface" ? ["standard", "bold"] : ["standard", "blue-yellow", "monochrome"];
      cvars.register(name(seat, key), String(defaultUiPreferences[key]), CvarFlag.Archive);
      cvars.bindValue(name(seat, key), { validate: value => choices.includes(value) ? null : `Expected ${choices.join(", ")}`, changed: () => {} });
    }
  }
}
export function readUiPreferences(cvars: SettingCvars, seat: number): UiPreferenceValues {
  const read = (key: keyof UiPreferenceValues): string => {
    const fallback = defaultUiPreferences[key];
    return cvars.find(name(seat, key))?.value ?? (typeof fallback === "boolean" ? fallback ? "1" : "0" : String(fallback));
  };
  const typeface = read("typeface"), colorMode = read("colorMode");
  return { hudScale: Number(read("hudScale")), textScale: Number(read("textScale")), menuScale: Number(read("menuScale")), crosshairSize: Number(read("crosshairSize")),
    highContrast: read("highContrast") === "1", reducedFlashes: read("reducedFlashes") === "1", captions: read("captions") === "1", crosshair: read("crosshair") === "1",
    typeface: typeface === "bold" ? typeface : "standard", colorMode: colorMode === "blue-yellow" || colorMode === "monochrome" ? colorMode : "standard" };
}
export function writeUiPreferences(cvars: SettingCvars, seat: number, values: UiPreferenceValues): void {
  for (const key of ["hudScale", "textScale", "menuScale", "crosshairSize", "highContrast", "reducedFlashes", "captions", "crosshair", "typeface", "colorMode"] satisfies readonly (keyof UiPreferenceValues)[]) {
    const value = values[key]; cvars.set(name(seat, key), typeof value === "boolean" ? value ? "1" : "0" : String(value));
  }
}
