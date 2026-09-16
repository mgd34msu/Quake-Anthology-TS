// SPDX-License-Identifier: GPL-2.0-or-later
import type { UnifiedAudio } from "../../audio/engine.ts";
import type { UiChoice } from "../../contracts/ui.ts";
import type { SdlWindow } from "../../platform/sdl.ts";
import type { LocalizationCatalog, LocLoadTier } from "../../text/localization.ts";
import type { SettingBinding } from "./index.ts";
import type { SettingCvars } from "./index.ts";

export function bindEffectsVolume(audio: UnifiedAudio, read: () => number): SettingBinding {
  return { id: "ui:audio:effects", label: "Sound volume", category: "audio", kind: "slider", minimum: 0, maximum: 1, step: 0.05,
    enabled: () => audio.outputState !== "closed", read, write: value => audio.setEffectsVolume(value) };
}
export function bindRendererSettings(options: {
  readonly current: () => SdlWindow["backend"];
  readonly apply: (backend: SdlWindow["backend"]) => void;
  readonly report: (message: string) => void;
  readonly enabled?: () => boolean;
}): readonly SettingBinding[] {
  let active = options.current(), draft = active;
  const refresh = (): void => {
    const current = options.current();
    if (current !== active) { active = current; draft = current; }
  };
  return [
    { id: "ui:video:renderer", category: "display", kind: "choice", label: "Renderer",
      enabled: () => options.enabled?.() ?? true,
      read: () => { refresh(); return draft; }, choices: () => [{ id: "cpu", label: "CPU" }, { id: "gl", label: "OpenGL" }],
      write: value => { refresh(); if (value !== "cpu" && value !== "gl") throw new RangeError("Unknown renderer"); draft = value; } },
    { id: "ui:video:renderer-apply", category: "display", kind: "button", label: "Apply renderer",
      enabled: () => { refresh(); return (options.enabled?.() ?? true) && draft !== active; },
      activate: () => {
        refresh(); if (!(options.enabled?.() ?? true) || draft === active) return;
        try { options.apply(draft); options.report(`Renderer change queued: ${draft === "gl" ? "OpenGL" : "CPU"}.`); }
        catch (error) { options.report(error instanceof Error ? error.message : String(error)); }
      } },
  ];
}

/** Display controls use window pixels and the same output gamma on both renderers. */
export function bindNativeVideoSettings(currentWindow: () => SdlWindow, registry: SettingCvars | null, report: (message: string) => void): readonly SettingBinding[] {
  let draftWindow = currentWindow();
  let width = String(draftWindow.logicalSize.width), height = String(draftWindow.logicalSize.height);
  const window = (): SdlWindow => {
    const current = currentWindow();
    if (current !== draftWindow) {
      draftWindow = current; width = String(current.logicalSize.width); height = String(current.logicalSize.height);
    }
    return current;
  };
  const apply = (operation: () => void): void => { try { operation(); } catch (error) { report(error instanceof Error ? error.message : String(error)); } };
  const choices = () => {
    const modes = [...window().displayModes, window().logicalSize, ...[
      { width: 640, height: 480 }, { width: 800, height: 600 }, { width: 960, height: 600 }, { width: 1024, height: 768 },
      { width: 1280, height: 720 }, { width: 1280, height: 800 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 },
      { width: 2560, height: 1440 }, { width: 3440, height: 1440 }, { width: 3840, height: 2160 },
    ]];
    const sizes = new Map(modes.map(size => [`${size.width}x${size.height}`, size]));
    return [...sizes.entries()].sort((a, b) => a[1].width - b[1].width || a[1].height - b[1].height)
      .map(([id, size]) => ({ id, label: `${size.width} x ${size.height}` }));
  };
  const validSize = (w: number, h: number): boolean => [w, h].every(value => Number.isSafeInteger(value) && value <= 8192) && w >= 320 && h >= 200;
  const resize = (w: number, h: number): void => {
    if (!validSize(w, h))
      throw new RangeError("Use a width of 320-8192 and a height of 200-8192 pixels.");
    window().setSize(w, h); width = String(w); height = String(h);
  };
  const brightness: SettingBinding[] = registry === null ? [] : [{ id: "ui:video:brightness", category: "display", kind: "slider", label: "Brightness",
    minimum: 0.5, maximum: 3, step: 0.05, enabled: () => true, read: () => registry.variableValue("r_gamma"), write: value => { registry.set("r_gamma", String(value)); } },
    { id: "ui:video:brightness-reset", category: "display", kind: "button", label: "Reset brightness", enabled: () => registry.variableValue("r_gamma") !== 1,
      activate: () => { registry.set("r_gamma", "1"); } }];
  return [...brightness,
    { id: "ui:video:fullscreen", category: "display", kind: "toggle", label: "Borderless fullscreen", enabled: () => true,
      read: () => window().fullscreen, write: value => apply(() => window().setFullscreen(value)) },
    { id: "ui:video:resolution", category: "display", kind: "choice", label: "Window resolution", enabled: () => !window().fullscreen,
      read: () => `${window().logicalSize.width}x${window().logicalSize.height}`, choices,
      write: value => apply(() => { const selected = choices().find(choice => choice.id === value); if (selected === undefined) throw new RangeError("Unavailable resolution");
        const [w, h] = selected.id.split("x").map(Number); if (w === undefined || h === undefined) throw new Error("Invalid resolution"); resize(w, h); }) },
    { id: "ui:video:custom-width", category: "display", kind: "text-entry", label: "Custom width (320-8192)", maximumLength: 4, enabled: () => !window().fullscreen,
      read: () => { window(); return width; }, write: value => { window(); width = value; } },
    { id: "ui:video:custom-height", category: "display", kind: "text-entry", label: "Custom height (200-8192)", maximumLength: 4, enabled: () => !window().fullscreen,
      read: () => { window(); return height; }, write: value => { window(); height = value; } },
    { id: "ui:video:custom-apply", category: "display", kind: "button", label: "Apply custom window size", enabled: () => !window().fullscreen && validSize(Number(width), Number(height)),
      activate: () => apply(() => resize(Number(width), Number(height))) },
    { id: "ui:video:vsync", category: "display", kind: "toggle", label: "Vertical sync", enabled: () => window().backend === "gl",
      read: () => window().backend === "gl" && window().swapInterval !== 0, write: (value: boolean) => apply(() => { const current = window(); if (current.backend === "gl") current.setSwapInterval(value ? 1 : 0); }) },
  ];
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
