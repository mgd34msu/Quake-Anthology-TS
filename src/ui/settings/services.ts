// SPDX-License-Identifier: GPL-2.0-or-later
import type { UnifiedAudio } from "../../audio/engine.ts";
import type { UiChoice } from "../../contracts/ui.ts";
import type { SdlWindow } from "../../platform/sdl.ts";
import type { LocalizationCatalog, LocLoadTier } from "../../text/localization.ts";
import type { SettingBinding } from "./index.ts";

export function bindEffectsVolume(audio: UnifiedAudio, read: () => number): SettingBinding {
  return { id: "ui:audio:effects", label: "Sound volume", category: "audio", kind: "slider", minimum: 0, maximum: 1, step: 0.05,
    enabled: () => audio.outputState !== "closed", read, write: value => audio.setEffectsVolume(value) };
}
/** Window size changes are immediate; renderer owners already rebuild resized targets. */
export function bindWindowResolution(window: SdlWindow, resolutions: readonly { readonly width: number; readonly height: number }[]): SettingBinding {
  const choices = resolutions.map(size => ({ id: `${size.width}x${size.height}`, label: `${size.width} x ${size.height}` }));
  return { id: "ui:video:resolution", label: "Window resolution", category: "video", kind: "choice", enabled: () => true,
    read: () => `${window.width}x${window.height}`, choices: () => choices,
    write: value => {
      const size = resolutions.find(size => `${size.width}x${size.height}` === value);
      if (size === undefined) throw new RangeError("Unavailable window resolution"); window.setSize(size.width, size.height);
    } };
}
export interface LanguageChoice extends UiChoice {
  readonly load: () => Promise<{ readonly primary: LocLoadTier; readonly fallback: LocLoadTier }>;
}
export class NativeLanguageSettings {
  private loading = false;
  private selection: string;
  constructor(readonly localization: LocalizationCatalog, private readonly available: readonly LanguageChoice[],
    current: string, private readonly failed: (error: unknown) => void) { this.selection = current; }
  async select(id: string): Promise<void> {
    const choice = this.available.find(choice => choice.id === id);
    if (choice === undefined) throw new Error(`Language is not installed: ${id}`);
    if (this.loading) return;
    this.loading = true;
    try { const loaded = await choice.load(); this.localization.loadOrdered(loaded.primary, loaded.fallback); this.selection = id; }
    finally { this.loading = false; }
  }
  binding(): SettingBinding {
    return { id: "ui:language:selection", label: "Language", category: "language", kind: "choice",
      choices: () => this.available, read: () => this.selection, enabled: () => !this.loading,
      write: value => { this.select(value).catch(this.failed); } };
  }
}
