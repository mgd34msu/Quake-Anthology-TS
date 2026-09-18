import { CvarFlag, type CvarRegistry } from "../../core/cvars/index.ts";
import type { SettingCvars } from "./index.ts";
function name(seat: number): string { return `ui_seat${seat + 1}_language`; }
export function registerLanguageSettings(cvars: CvarRegistry): void {
  for (let seat = 0; seat < 4; seat++) {
    const key = name(seat);
    cvars.register(key, "english", CvarFlag.Archive);
    cvars.bindValue(key, { validate: value => /^[a-z]+$/.test(value) ? null : "Expected a lowercase language name", changed: () => {} });
  }
}
export function readSeatLanguage(cvars: SettingCvars, seat: number): string {
  return cvars.find(name(seat))?.value ?? "english";
}
export function writeSeatLanguage(cvars: SettingCvars, seat: number, language: string): void {
  if (!/^[a-z]+$/.test(language)) throw new Error("Expected a lowercase language name");
  cvars.set(name(seat), language);
}
