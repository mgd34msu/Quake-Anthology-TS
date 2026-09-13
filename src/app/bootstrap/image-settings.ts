import { join } from "node:path";
import type { CommandContext, CommandDialect } from "../../contracts/common.ts";
import { CommandBuffer } from "../../core/commands/index.ts";
import { CvarFlag, CvarRegistry } from "../../core/cvars/index.ts";
import { defaultUserContentRoot } from "../../content/user-data.ts";
import { ConfigStore } from "../../settings/config.ts";
import { imagePolicyFromControls } from "../../render/scene/image-policy.ts";
import type { ImagePolicy } from "../../render/scene/image-policy.ts";
import type { ApplicationAssets, PreparedApplicationImages, PreparedApplicationImageBinding } from "./assets.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import type { ApplicationRereleasePresentation } from "./rerelease-presentation.ts";

interface ImageSettingsOptions {
  readonly context: CommandContext;
  readonly dialect: CommandDialect;
  readonly userContentRoot?: string;
  readonly print: (text: string) => void;
}

/** Shared renderer choices are local configuration, independent of source game state. */
export class ApplicationImageSettings {
  readonly cvars: CvarRegistry;
  private readonly store: ConfigStore;
  private applied = "";
  private saved = "";
  private appliedValues: readonly { readonly name: string; readonly value: string }[] = [];
  private constructor(private readonly options: ImageSettingsOptions) {
    this.store = new ConfigStore(join(options.userContentRoot ?? defaultUserContentRoot(), "settings"));
    this.cvars = new CvarRegistry(options);
    this.cvars.register("r_override_textures", "1", CvarFlag.Archive);
    this.cvars.register("r_texture_overrides", "-1", CvarFlag.Archive);
    this.cvars.register("r_texture_formats", "source", CvarFlag.Archive);
  }
  static async open(options: ImageSettingsOptions): Promise<ApplicationImageSettings> {
    const settings = new ApplicationImageSettings(options);
    const text = await settings.store.loadText("images.cfg");
    if (text !== null) {
      const commands = new CommandBuffer({ dialect: options.dialect, context: options.context, cvars: settings.cvars, print: options.print });
      commands.append(text, options.context); commands.execute();
    }
    settings.applied = settings.signature(); settings.saved = settings.applied;
    settings.appliedValues = settings.cvars.snapshots();
    return settings;
  }
  get policy(): ImagePolicy {
    return imagePolicyFromControls({ overrideLevel: this.cvars.variableValue("r_override_textures"),
      overrideMask: this.cvars.variableValue("r_texture_overrides"), formats: this.cvars.variableString("r_texture_formats") });
  }
  private signature(): string { return JSON.stringify(this.cvars.snapshots().map(value => [value.name, value.value])); }
  async refresh(assets: ApplicationAssets, presentations: readonly WorldSeatPresentation[], rerelease: ApplicationRereleasePresentation | null): Promise<void> {
    const selected = this.signature();
    if (selected === this.applied) return;
    let images: PreparedApplicationImages | null = null;
    const bindings: PreparedApplicationImageBinding[] = [];
    let sky: (() => void) | undefined;
    try {
      images = await assets.prepareImageRefresh(this.policy);
      for (const presentation of presentations) bindings.push(await presentation.prepareImageRefresh(images));
      sky = await rerelease?.prepareImageRefresh(images);
    } catch (error) {
      for (const binding of bindings) binding.discard(); images?.discard();
      for (const value of this.appliedValues) this.cvars.set(value.name, value.value, true);
      this.options.print(`Image settings rejected: ${error instanceof Error ? error.message : String(error)}\n`);
      return;
    }
    images.commit(); for (const binding of bindings) binding.commit(); sky?.();
    assets.finishImageRefresh();
    this.applied = selected;
    this.appliedValues = this.cvars.snapshots();
    await this.save();
  }
  private async save(): Promise<void> {
    const selected = this.signature();
    if (selected === this.saved) return;
    await this.store.saveCvars("images.cfg", this.cvars); this.saved = selected;
  }
  async close(): Promise<void> { await this.save(); }
}
