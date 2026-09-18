import { loadLocalizationResources } from "./localization-resources.ts";
import type { CinematicStatus } from "../media/types.ts";
import type { SeatId } from "../contracts/identity.ts";
import { CaptionTimeline, parseSubtitleText } from "./captions.ts";
import type { ActiveCaption, CaptionPreferences } from "./captions.ts";
import { LocalizationCatalog } from "./localization.ts";

const suffixes: Readonly<Record<string, string>> = { french: "fr", german: "de", italian: "it", spanish: "es", russian: "ru", polish: "pl", portuguese: "pt", japanese: "ja", korean: "ko", chinese: "zh" };
export function subtitlePaths(source: string, language: string): readonly string[] {
  const stem = source.replace(/\.[^/.]+$/, ""), suffix = suffixes[language];
  return [...(suffix === undefined ? [] : [`${stem}_${suffix}.srt`, `${stem}_${suffix}.vtt`]), `${stem}.srt`, `${stem}.vtt`];
}
export interface CaptionPlaybackState { readonly source: string; readonly sourceTimeMilliseconds: number; readonly status: CinematicStatus; }
/** Mounted sidecars supply all text and cue intervals; playback supplies its own seek/loop clock. */
export class SeatMediaCaptions {
  private timeline: CaptionTimeline;
  private prepared = "";
  private request = 0;
  private liveRequest = "";
  constructor(private readonly seat: SeatId, private readonly read: (path: string) => Promise<Uint8Array | null>, private readonly localization: LocalizationCatalog | null = null, private readonly kind: "subtitle" | "caption" = "subtitle", private readonly liveLanguage?: { readonly read: () => string; readonly failed: (error: unknown) => void }) {
    this.timeline = new CaptionTimeline(seat, localization ?? new LocalizationCatalog(seat));
  }
  async prepare(source: string, language: string): Promise<void> {
    const key = `${source}:${language}`;
    if (key === this.prepared) return;
    const request = ++this.request;
    this.prepared = "";
    this.timeline.clear();
    for (const path of subtitlePaths(source, language)) {
      const bytes = await this.read(path);
      if (request !== this.request) return;
      if (bytes === null) continue;
      const localization = this.localization ?? await loadLocalizationResources(this.seat, language, this.read);
      if (request !== this.request) return;
      this.timeline = new CaptionTimeline(this.seat, localization);
      this.timeline.replace(parseSubtitleText(new TextDecoder().decode(bytes), path).map(cue => ({ ...cue, kind: this.kind })));
      this.prepared = key; return;
    }
    this.prepared = key;
  }
  active(state: CaptionPlaybackState, preferences: CaptionPreferences): readonly ActiveCaption[] {
    if (this.liveLanguage !== undefined) {
      const language = this.liveLanguage.read(), key = `${state.source}:${language}`;
      if (key !== this.prepared) {
        if (key !== this.liveRequest) {
          this.liveRequest = key;
          this.prepare(state.source, language).catch(this.liveLanguage.failed);
        }
        return [];
      }
    }
    this.timeline.preferences = preferences;
    if (!this.prepared.startsWith(`${state.source}:`) || state.status === "ended" || state.status === "stopped") return [];
    return this.timeline.activeAt(state.sourceTimeMilliseconds);
  }
  clear(): void { this.request++; this.prepared = ""; this.liveRequest = ""; this.timeline.clear(); }
}
