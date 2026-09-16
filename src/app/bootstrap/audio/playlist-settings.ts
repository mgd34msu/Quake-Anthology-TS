import { normalizeResourcePath } from "../../../content/mounts/paths.ts";
import { CvarFlag, type CvarRegistry } from "../../../core/cvars/index.ts";

export interface MusicPreferences { readonly musicShuffle: boolean; readonly menuTrack: string; }
export function validMenuTrack(value: string): boolean {
  if (value === "auto" || value === "0") return true;
  if (/^\d+$/.test(value)) return Number(value) >= 1 && Number(value) <= 255;
  if (value.length > 255 || value.trim() !== value || /["\x00-\x1f\x7f\\]/.test(value)) return false;
  try { normalizeResourcePath(value); } catch { return false; }
  const name = value.split("/").at(-1) ?? "";
  return !name.includes(".") || /\.(?:ogg|wav)$/i.test(name);
}
export function registerMusicSettings(cvars: CvarRegistry): void {
  cvars.register("music_shuffle", "0", CvarFlag.Archive);
  cvars.register("music_menu_track", "auto", CvarFlag.Archive);
  cvars.bindValue("music_shuffle", { validate: value => value === "0" || value === "1" ? null : "Use 0 or 1", changed: () => undefined });
  cvars.bindValue("music_menu_track", { validate: value => validMenuTrack(value) ? null : "Use auto, 0, a track number 1..255, or a mounted OGG/WAV music path", changed: () => undefined });
  const shuffle = { summary: "Shuffle mounted Quake II gameplay music at track end. Menu music remains fixed.", usage: "music_shuffle <0|1>", examples: ["music_shuffle 1"] };
  const menu = { summary: "Menu music: auto uses Anthology's title/family fallback; 0 disables; numbers and paths select an explicit mounted track. Auto is an Anthology extension.", usage: "music_menu_track <auto|0|1..255|path>", examples: ["music_menu_track auto", "music_menu_track 77", "music_menu_track 0"] };
  cvars.document("music_shuffle", shuffle); cvars.document("music_menu_track", menu);
  cvars.registerAlias({ name: "ogg_shuffle", target: "music_shuffle", conversion: { kind: "identity" }, documentation: shuffle });
  cvars.registerAlias({ name: "ogg_menu_track", target: "music_menu_track", conversion: { kind: "identity" }, documentation: menu });
}
export function readMusicSettings(cvars: Pick<CvarRegistry, "find" | "variableValue"> | null): MusicPreferences {
  return { musicShuffle: (cvars?.variableValue("music_shuffle") ?? 0) !== 0, menuTrack: cvars?.find("music_menu_track")?.value ?? "auto" };
}
