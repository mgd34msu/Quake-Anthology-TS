import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContentId } from "../../../contracts/content.ts";
import type { OpenedResource } from "../../../content/mounts/index.ts";
import type { SoundAssetReader, Q3ResourceHost } from "../../../content/q3/presentation/resources.ts";
import { DEFAULT_MODEL } from "../../../content/q3/presentation/ref-entity.ts";
import type { SceneModel } from "../../../content/q3/presentation/ref-entity.ts";
import type { Q3SceneRecorder } from "../../../content/q3/presentation/scene.ts";
import { parseSkin } from "../../../formats/q3-model/md3.ts";
import { decodeSoundBytes } from "../../../audio/streams.ts";
import type { SoundAsset } from "../../../audio/types.ts";
import { SoundBank } from "../../../audio/bank.ts";
import { Q3PresentationSoundBank } from "../../../content/q3/presentation/audio.ts";
import { MountedFontReader } from "../../../text/mounted.ts";
import { RendererFontRegistry } from "../../../text/q3-font-registry.ts";
import { UiAssetRegistry } from "../../../text/q3-font.ts";
import type { ApplicationAssets, ProviderSceneAssets } from "../assets.ts";

/** Synchronous source script/sound calls read bytes resolved through the actual mount plan. */
export class ApplicationQ3Assets implements SoundAssetReader {
  private readonly retained = new Map<string, OpenedResource>();
  private readonly sounds = new Map<string, SoundAsset>();
  private readonly names = new Set<string>();
  readonly modelProviders = new Map<SceneModel, ProviderSceneAssets>();
  readonly bank: Q3PresentationSoundBank;
  readonly fonts: RendererFontRegistry;
  readonly fontRegistry: UiAssetRegistry;
  private readonly fontReader: MountedFontReader;
  private constructor(readonly assets: ApplicationAssets, readonly content: ContentId, readonly provider: ProviderSceneAssets, readonly print: (text: string) => void) {
    this.bank = new Q3PresentationSoundBank(new SoundBank(provider.mounts), null, path => this.sound(path));
    this.fontReader = new MountedFontReader(provider.mounts);
    this.fonts = new RendererFontRegistry(this.fontReader, path => provider.shaders.registerPicture(path), () => undefined);
    this.fontRegistry = new UiAssetRegistry({ fonts: this.fonts, registerPicture: path => provider.shaders.registerPicture(path) }, print);
  }
  static async create(assets: ApplicationAssets, content: ContentId, print: (text: string) => void, mode: "source-sync" | "guest-async" = "source-sync"): Promise<ApplicationQ3Assets> {
    const provider = await assets.provider(content), result = new ApplicationQ3Assets(assets, content, provider, print);
    const archives = new Set(provider.mounts.plan.mounts.flatMap(mount => mount.kind === "archive" ? [mount.archivePath] : []));
    for (const product of assets.content.catalog.products) for (const archive of product.archives) if (archives.has(archive.path))
      for (const entry of archive.entries) result.names.add(entry.path.toLowerCase());
    for (const mount of provider.mounts.plan.mounts) if (mount.kind === "loose") {
      const entries = await readdir(mount.rootPath, { recursive: true, withFileTypes: true }).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) if (entry.isFile()) {
        const path = resolve(entry.parentPath, entry.name).slice(resolve(mount.rootPath).length + 1).replaceAll("\\", "/");
        result.names.add(path.toLowerCase());
      }
    }
    const synchronous = mode === "guest-async" ? [] : [...result.names].filter(path => /\.(?:menu|hud|txt|cfg|voice|vc|h)$/i.test(path) || /^sound\/.*\.(?:wav|ogg)$/i.test(path));
    for (let start = 0; start < synchronous.length; start += 32) await Promise.all(synchronous.slice(start, start + 32).map(async path => {
      const opened = await provider.mounts.open(path); if (opened !== null) result.retained.set(path, opened);
    }));
    return result;
  }
  has(path: string): boolean { return this.names.has(path.toLowerCase()); }
  list(prefix = ""): readonly string[] { return [...this.names].filter(path => path.startsWith(prefix.toLowerCase())).sort(); }
  async read(path: string): Promise<Uint8Array> { return (await this.open(path))?.bytes ?? new Uint8Array(); }
  async readFileLength(path: string): Promise<number> { return (await this.open(path))?.bytes.length ?? -1; }
  readSync(path: string): Uint8Array {
    const opened = this.retained.get(path.toLowerCase());
    if (opened === undefined) throw new Error(`Q3 source requested an unretained synchronous asset: ${path}`);
    return opened.bytes;
  }
  private async open(path: string): Promise<OpenedResource | null> {
    const key = path.toLowerCase(), prior = this.retained.get(key); if (prior !== undefined) return prior;
    const opened = await this.provider.mounts.open(path); if (opened !== null) this.retained.set(key, opened); return opened;
  }
  private sound(name: string): SoundAsset | null {
    const path = (name.startsWith("#") ? name.slice(1) : name.startsWith("sound/") ? name : `sound/${name}`).toLowerCase();
    const prior = this.sounds.get(path); if (prior !== undefined) return prior;
    const opened = this.retained.get(path); if (opened === undefined) return null;
    const sound = { resource: opened.reference.id, name: path, pcm: decodeSoundBytes(opened.bytes, path) };
    this.sounds.set(path, sound); return sound;
  }
  async resourceHost(scene: Q3SceneRecorder): Promise<Q3ResourceHost> {
    const recipe = this.assets.content.recipe;
    const contentFor = (path: string): ContentId => {
      if (path.startsWith("models/players/")) {
        const content = recipe.character.appearance.content;
        if (this.assets.content.catalog.product(content).expectation.family === "q3") return content;
      }
      if (/^models\/(?:weapons2|weaphits|ammo)\//.test(path)) {
        const weapon = recipe.weapons.find(weapon => this.assets.content.catalog.product(weapon.content).expectation.family === "q3");
        if (weapon !== undefined) return weapon.content;
      }
      return this.content;
    };
    return { scene, zeroPicture: await this.provider.shaders.registerPicture("*white"),
      model: async path => {
        const content = contentFor(path), provider = await this.assets.provider(content);
        if (!path.startsWith("*") && await provider.mounts.resolve(path) === null) return DEFAULT_MODEL;
        const asset = await this.assets.model(content, path);
        let model: SceneModel;
        if (asset.model.kind === "brush-model") {
          const bounds = asset.model.world.models[asset.model.model]?.bounds;
          if (bounds === undefined) throw new Error(`Missing inline model bounds ${path}`);
          model = { kind: "inline", path, index: asset.model.model, geometry: asset.model.world, resource: asset.resource, bounds };
        } else model = { kind: "model", path, model: asset.model, resource: asset.resource };
        this.modelProviders.set(model, provider); return model;
      },
      skin: async path => { const provider = await this.assets.provider(contentFor(path)), opened = await provider.mounts.open(path);
        return opened === null ? null : { path, surfaces: parseSkin(new TextDecoder().decode(opened.bytes)) }; },
      shader: (path, mip) => this.provider.shaders.registerPicture(path, mip),
      world: async () => ({ map: { models: this.assets.world.map.models } }),
      remapShader: async (original, replacement, offset) => {
        const value = Number.parseFloat(offset), timeOffset = Number.isNaN(value) ? 0 : value;
        this.provider.shaders.remap(original, replacement, timeOffset);
        await this.provider.shaders.register(replacement);
        await this.assets.world.remapShader(original, replacement, timeOffset);
      },
    };
  }
  close(): void { this.fonts.close(); this.fontReader.close(); this.retained.clear(); this.sounds.clear(); this.modelProviders.clear(); }
}
