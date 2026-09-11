// SPDX-License-Identifier: GPL-2.0-or-later
import type { SeatId } from "../contracts/identity.ts";
import type { LocalizationCatalog } from "./localization.ts";

export interface CaptionCue {
  readonly id: string;
  readonly kind: "subtitle" | "caption";
  readonly startMilliseconds: number;
  readonly durationMilliseconds: number;
  readonly text: string;
  readonly speaker: string | null;
  readonly arguments: readonly string[];
}
export interface ActiveCaption extends CaptionCue { readonly localizedText: string; readonly localizedSpeaker: string | null; }
export interface CaptionPreferences { readonly subtitles: boolean; readonly soundCaptions: boolean; readonly speakers: boolean; }

/** Playback supplies its paused/seekable logical clock. No wall clock or default seat is used. */
export class CaptionTimeline {
  private readonly cues = new Map<string, CaptionCue>();
  preferences: CaptionPreferences = { subtitles: true, soundCaptions: true, speakers: true };
  constructor(readonly seat: SeatId, private readonly localization: LocalizationCatalog) {
    if (!seat.equals(localization.seat)) throw new Error("Caption localization belongs to a different seat");
  }
  replace(cues: readonly CaptionCue[]): void {
    for (const cue of cues) validateCue(cue);
    this.cues.clear(); for (const cue of cues) this.cues.set(cue.id, cue);
  }
  add(cue: CaptionCue): void { validateCue(cue); this.cues.set(cue.id, cue); }
  remove(id: string): boolean { return this.cues.delete(id); }
  clear(): void { this.cues.clear(); }
  activeAt(playbackTimeMilliseconds: number): readonly ActiveCaption[] {
    if (!Number.isFinite(playbackTimeMilliseconds)) throw new RangeError("Caption time must be finite");
    const active: ActiveCaption[] = [];
    for (const cue of this.cues.values()) {
      if (cue.kind === "subtitle" ? !this.preferences.subtitles : !this.preferences.soundCaptions) continue;
      if (playbackTimeMilliseconds < cue.startMilliseconds || playbackTimeMilliseconds >= cue.startMilliseconds + cue.durationMilliseconds) continue;
      active.push({ ...cue, localizedText: this.localization.localize(cue.text, cue.arguments),
        localizedSpeaker: !this.preferences.speakers || cue.speaker === null ? null : this.localization.localize(cue.speaker) });
    }
    return active.sort((left, right) => left.startMilliseconds - right.startMilliseconds);
  }
}
function validateCue(cue: CaptionCue): void {
  if (cue.id.length === 0 || !Number.isFinite(cue.startMilliseconds) || cue.startMilliseconds < 0
    || !Number.isFinite(cue.durationMilliseconds) || cue.durationMilliseconds < 0
    || !Number.isFinite(cue.startMilliseconds + cue.durationMilliseconds)) throw new RangeError("Invalid caption cue interval");
}
function timestamp(value: string): number {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value.trim());
  if (match === null) throw new Error(`Invalid subtitle timestamp ${value}`);
  const hours = Number(match[1] ?? "0"), minutes = Number(match[2]), seconds = Number(match[3]), milliseconds = Number(match[4]);
  if (minutes >= 60 || seconds >= 60) throw new Error(`Invalid subtitle timestamp ${value}`);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}
/** SRT and WebVTT sidecars retain cue ordering, Unicode, line breaks and overlap. */
export function parseSubtitleText(text: string, namespace: string): readonly CaptionCue[] {
  const blocks = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/), cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex(line => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex];
    if (timing === undefined) continue;
    const match = /^\s*(\S+)\s+-->\s+(\S+)/.exec(timing);
    if (match === null || match[1] === undefined || match[2] === undefined) throw new Error("Invalid subtitle cue timing");
    const startMilliseconds = timestamp(match[1]), end = timestamp(match[2]);
    const cue: CaptionCue = { id: `${namespace}:${cues.length}`, kind: "subtitle", startMilliseconds,
      durationMilliseconds: end - startMilliseconds, text: lines.slice(timingIndex + 1).join("\n"), speaker: null, arguments: [] };
    validateCue(cue); cues.push(cue);
  }
  return cues;
}
