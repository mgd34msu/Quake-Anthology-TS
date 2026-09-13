import { join } from "node:path";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../core/cvars/index.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { ConfigStore } from "../../settings/config.ts";
import { imagePolicyFromControls } from "../../render/scene/image-policy.ts";
import type { ImagePolicy } from "../../render/scene/image-policy.ts";
import type { ModelReplacementPolicy } from "../../render/scene/models/replacements.ts";
import type { ApplicationAssets, PreparedApplicationImages, PreparedApplicationImageBinding } from "./assets.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import type { ApplicationRereleasePresentation } from "./rerelease-presentation.ts";
import type { NativeRenderer } from "./renderer.ts";
import type { ApplicationOptions } from "./options.ts";

interface ImageSettingsOptions {
  readonly context: CommandContext;
  readonly dialect: CommandDialect;
  readonly userContentRoot?: string;
  readonly gamma?: number;
  readonly displayOverrides?: NonNullable<ApplicationOptions["displayOverrides"]>;
  readonly print: (text: string) => void;
}

/** Shared renderer choices are local configuration, independent of source game state. */
export class ApplicationImageSettings {
  readonly cvars: CvarRegistry;
  private readonly store: ConfigStore;
  private applied = "";
  private saved = "";
  private displayApplied = "";
  private restoredSize: { readonly width: number; readonly height: number } | null = null;
  private appliedValues: readonly { readonly name: string; readonly value: string }[] = [];
  private constructor(private readonly options: ImageSettingsOptions) {
    this.store = new ConfigStore(join(options.userContentRoot ?? defaultUserContentRoot(), "settings"));
    this.cvars = new CvarRegistry(options);
    this.cvars.register("r_gamma", String(options.gamma ?? 1), CvarFlag.Archive);
    this.cvars.register("r_customwidth", "0", CvarFlag.Archive);
    this.cvars.register("r_customheight", "0", CvarFlag.Archive);
    this.cvars.register("r_fullscreen", "0", CvarFlag.Archive);
    this.cvars.register("r_swapInterval", "1", CvarFlag.Archive);
    this.cvars.register("gl_debug_distfrac", "0.004", CvarFlag.None);
    this.cvars.register("r_override_textures", "1", CvarFlag.Archive);
    this.cvars.register("r_texture_overrides", "-1", CvarFlag.Archive);
    this.cvars.register("r_texture_formats", "source", CvarFlag.Archive);
    this.cvars.register("r_enhancedmodels", "1", CvarFlag.Archive);
    this.cvars.register("gl_md5_load", "1", CvarFlag.Archive);
    this.cvars.register("gl_md5_use", "1", CvarFlag.Archive);
    this.cvars.register("gl_md5_distance", "2048", CvarFlag.Archive);
    this.cvars.register("r_model_distance", "source", CvarFlag.Archive);
    this.cvars.document("r_gamma", {
      summary: "Display brightness for CPU and GL output: 1 is unchanged, above 1 brightens, below 1 darkens.",
      usage: "r_gamma <0.5..3>", examples: ["r_gamma 1.3"], allowedValues: ["Finite numbers from 0.5 through 3"] });
    this.cvars.document("r_customwidth", {
      summary: "Window width in logical pixels, applied while windowed; 0 uses the current width. Restored oversized windows recover to desktop bounds.",
      usage: "r_customwidth <width>", examples: ["r_customwidth 1280"], allowedValues: ["0: current width", "Integers from 64 through 16384"] });
    this.cvars.document("r_customheight", {
      summary: "Window height in logical pixels, applied while windowed; 0 uses the current height. Restored oversized windows recover to desktop bounds.",
      usage: "r_customheight <height>", examples: ["r_customheight 720"], allowedValues: ["0: current height", "Integers from 64 through 16384"] });
    this.cvars.document("r_fullscreen", {
      summary: "Switch between a window and borderless desktop fullscreen; does not select an exclusive display mode.",
      usage: "r_fullscreen <0|1>", examples: ["r_fullscreen 1"], allowedValues: ["0: windowed", "1: borderless desktop fullscreen"] });
    this.cvars.document("r_swapInterval", {
      summary: "GL vertical synchronization (vsync), when supported by the display backend. Has no effect on the CPU renderer.",
      usage: "r_swapInterval <0|1>", examples: ["r_swapInterval 1"], allowedValues: ["0: off", "1: on"] });
    this.cvars.document("gl_debug_distfrac", {
      summary: "Distance culling factor for world text that requests distance culling: text is hidden when its cell size is smaller than forward camera distance times this factor. Not saved.",
      usage: "gl_debug_distfrac <factor>", examples: ["gl_debug_distfrac 0.004"] });
    this.cvars.document("r_override_textures", {
      summary: "Replacement image priority: below 1 keeps requested files first, 1 prioritizes replacements for native images, above 1 also prioritizes them for truecolor images. Fallback image searches still run at 0.",
      usage: "r_override_textures <level>", examples: ["r_override_textures 1", "r_override_textures 2"] });
    this.cvars.document("r_texture_overrides", {
      summary: "Usage bitmask for replacement image priority: skin 1, sprite 2, wall 4, picture 8, sky 16; add bits to combine. -1 selects all, 0 selects none. Does not disable fallback searches.",
      usage: "r_texture_overrides <mask>", examples: ["r_texture_overrides -1", "r_texture_overrides 5"] });
    this.cvars.document("r_texture_formats", {
      summary: "Replacement image search order. source uses the content family's order; otherwise lists png, jpg, tga, jpeg, bmp, gif. Legacy format initials are accepted and unknown letters ignored.",
      usage: "r_texture_formats <source|quoted format list>", examples: ['r_texture_formats "png tga jpg"', "r_texture_formats source"] });
    this.cvars.document("r_enhancedmodels", {
      summary: "Enable loading and drawing available mounted Quake I enhanced model replacements; native models remain the fallback.",
      usage: "r_enhancedmodels <number>", examples: ["r_enhancedmodels 1"], allowedValues: ["0: disabled", "Nonzero: enabled"] });
    this.cvars.document("gl_md5_load", {
      summary: "Enable loading available mounted Quake II MD5 model replacements. Drawing them also requires gl_md5_use.",
      usage: "gl_md5_load <number>", examples: ["gl_md5_load 1"], allowedValues: ["0: disabled", "Nonzero: enabled"] });
    this.cvars.document("gl_md5_use", {
      summary: "Draw loaded Quake II MD5 replacements instead of native models, subject to replacement distance limits. Requires gl_md5_load.",
      usage: "gl_md5_use <number>", examples: ["gl_md5_use 1"], allowedValues: ["0: disabled", "Nonzero: enabled"] });
    this.cvars.document("gl_md5_distance", {
      summary: "Quake II replacement model view distance in map units when r_model_distance is source. Positive values fall back to native models beyond the limit; nonpositive values remove the cutoff. Shadows bypass this distance cutoff.",
      usage: "gl_md5_distance <distance>", examples: ["gl_md5_distance 2048", "gl_md5_distance 0"] });
    this.cvars.document("r_model_distance", {
      summary: "Shared replacement model view distance in map units. source uses no cutoff for Quake I and gl_md5_distance for Quake II. Positive numeric overrides fall back to native models beyond the limit; nonpositive values remove it. Shadows bypass this cutoff.",
      usage: "r_model_distance <source|finite distance>", examples: ["r_model_distance source", "r_model_distance 4096"] });
  }
  static async open(options: ImageSettingsOptions): Promise<ApplicationImageSettings> {
    const settings = new ApplicationImageSettings(options);
    const text = await settings.store.loadText("images.cfg");
    if (text !== null) {
      const commands = new CommandBuffer({ dialect: options.dialect, context: options.context, cvars: settings.cvars, print: options.print });
      commands.append(text, options.context); commands.execute();
      settings.restoredSize = { width: settings.cvars.variableValue("r_customwidth"), height: settings.cvars.variableValue("r_customheight") };
    }
    const saved = settings.signature();
    if (options.displayOverrides?.width !== undefined) settings.cvars.set("r_customwidth", String(options.displayOverrides.width), true);
    if (options.displayOverrides?.height !== undefined) settings.cvars.set("r_customheight", String(options.displayOverrides.height), true);
    if (options.displayOverrides?.gamma !== undefined) settings.cvars.set("r_gamma", String(options.displayOverrides.gamma), true);
    settings.applied = settings.signature(); settings.saved = saved;
    settings.appliedValues = settings.archivedValues();
    return settings;
  }
  get policy(): ImagePolicy {
    return imagePolicyFromControls({ overrideLevel: this.cvars.variableValue("r_override_textures"),
      overrideMask: this.cvars.variableValue("r_texture_overrides"), formats: this.cvars.variableString("r_texture_formats") });
  }
  get gamma(): number { return this.cvars.variableValue("r_gamma"); }
  get modelPolicy(): ModelReplacementPolicy {
    const selected = this.cvars.variableString("r_model_distance").trim().toLowerCase();
    const distance = selected === "source" ? "source" : Number(selected);
    if (distance !== "source" && !Number.isFinite(distance)) throw new Error("r_model_distance requires source or a finite distance");
    return { q1Enhanced: this.cvars.variableValue("r_enhancedmodels") !== 0,
      q2Load: this.cvars.variableValue("gl_md5_load") !== 0, q2Use: this.cvars.variableValue("gl_md5_use") !== 0,
      q2Distance: this.cvars.variableValue("gl_md5_distance"), distance };
  }
  private archivedValues() { return this.cvars.snapshots().filter(value => (value.flags & CvarFlag.Archive) !== 0); }
  private signature(): string { return JSON.stringify(this.archivedValues().map(value => [value.name, value.value])); }
  private applyDisplay(renderer: NativeRenderer): void {
    if (renderer.outputGamma !== this.gamma) {
      try { renderer.setOutputGamma(this.gamma); }
      catch (error) { this.cvars.set("r_gamma", String(renderer.outputGamma), true); this.options.print(`Brightness rejected: ${String(error)}\n`); }
    }
    const window = renderer.window;
    const signature = (): string => ["r_customwidth", "r_customheight", "r_fullscreen", "r_swapInterval"].map(name => this.cvars.variableString(name)).join("/");
    if (signature() !== this.displayApplied) {
      const current = window.logicalSize, restored = this.displayApplied === "" ? this.restoredSize : null;
      const width = this.cvars.variableValue("r_customwidth") || current.width, height = this.cvars.variableValue("r_customheight") || current.height;
      try {
        if (![width, height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 16384)) throw new RangeError("Invalid saved window size");
        if (!window.fullscreen) {
          const desktop = window.display.bounds;
          const restoredWidth = this.options.displayOverrides?.width === undefined && restored?.width === width;
          const restoredHeight = this.options.displayOverrides?.height === undefined && restored?.height === height;
          window.setSize(restoredWidth ? Math.min(width, desktop.width) : width, restoredHeight ? Math.min(height, desktop.height) : height);
        }
        const fullscreen = this.cvars.variableValue("r_fullscreen");
        if (fullscreen !== 0 && fullscreen !== 1) throw new RangeError("Invalid fullscreen setting");
        if (window.fullscreen !== (fullscreen === 1)) window.setFullscreen(fullscreen === 1);
        if (window.backend === "gl") {
          const interval = this.cvars.variableValue("r_swapInterval");
          if (interval !== 0 && interval !== 1) throw new RangeError("Vertical sync must be on or off");
          if (window.swapInterval !== interval) window.setSwapInterval(interval);
        }
      } catch (error) { this.options.print(`Display settings rejected: ${String(error)}\n`); }
    }
    if (!window.fullscreen) {
      const size = window.logicalSize;
      this.cvars.set("r_customwidth", String(size.width), true); this.cvars.set("r_customheight", String(size.height), true);
    }
    this.cvars.set("r_fullscreen", window.fullscreen ? "1" : "0", true);
    if (window.backend === "gl") this.cvars.set("r_swapInterval", String(window.swapInterval === 0 ? 0 : 1), true);
    this.displayApplied = signature();
  }
  async refreshDisplay(renderer: NativeRenderer): Promise<void> { this.applyDisplay(renderer); await this.save(); }
  async refresh(assets: ApplicationAssets, presentations: readonly WorldSeatPresentation[], rerelease: ApplicationRereleasePresentation | null, renderer?: NativeRenderer): Promise<void> {
    if (renderer !== undefined) this.applyDisplay(renderer);
    const selected = this.signature();
    if (selected === this.applied) return;
    let images: PreparedApplicationImages | null = null;
    const bindings: PreparedApplicationImageBinding[] = [];
    let sky: (() => void) | undefined;
    try {
      const policy = this.policy, modelPolicy = this.modelPolicy;
      const loadChanged = modelPolicy.q1Enhanced !== assets.modelPolicy.q1Enhanced || modelPolicy.q2Load !== assets.modelPolicy.q2Load;
      if (loadChanged || JSON.stringify(policy) !== JSON.stringify(assets.imagePolicy)) {
        images = await assets.prepareImageRefresh(policy, modelPolicy);
        for (const presentation of presentations) bindings.push(await presentation.prepareImageRefresh(images));
        sky = await rerelease?.prepareImageRefresh(images);
      } else assets.setModelPolicy(modelPolicy);
    } catch (error) {
      for (const binding of bindings) binding.discard(); images?.discard();
      for (const value of this.appliedValues) this.cvars.set(value.name, value.value, true);
      this.options.print(`Image settings rejected: ${error instanceof Error ? error.message : String(error)}\n`);
      return;
    }
    images?.commit(); for (const binding of bindings) binding.commit(); sky?.();
    assets.finishImageRefresh();
    this.applied = selected;
    this.appliedValues = this.archivedValues();
    await this.save();
  }
  private async save(): Promise<void> {
    const selected = this.signature();
    if (selected === this.saved) return;
    await this.store.saveCvars("images.cfg", this.cvars); this.saved = selected;
  }
  async close(): Promise<void> { await this.save(); }
}
