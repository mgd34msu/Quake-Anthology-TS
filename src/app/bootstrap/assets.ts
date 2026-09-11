import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContentId, GameFamily, ResolvedResourceReference } from "../../contracts/content.ts";
import type { Palette, RendererImage, RendererResourceOwner } from "../../contracts/render.ts";
import type { DecodedModel } from "../../contracts/scene.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { decodePalette, decodePcx, decodeWad, indexedRenderImage } from "../../formats/images/index.ts";
import { readQ1Bsp } from "../../formats/q1-map/index.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../formats/q2-map/index.ts";
import { decodeQ3World, parseEntities } from "../../formats/q3-map/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene } from "../../render/scene/index.ts";
import { classicCharset } from "../../text/atlas.ts";
import type { TextFontRegistry, TextFontSelection } from "../../text/atlas.ts";
import { createMountedTextFonts } from "../../text/mounted.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { loadApplicationModel } from "./model-loader.ts";

export interface ProviderSceneAssets {
  readonly family: GameFamily;
  readonly mounts: MountedContent;
  readonly palette: Palette | null;
  readonly textures: SceneTextureLoader;
  readonly shaders: SceneShaderRegistry;
}

export interface ModelAsset {
  readonly resource: ResolvedResourceReference;
  readonly model: DecodedModel;
  readonly provider: ProviderSceneAssets;
  readonly brushScene: WorldScene | null;
}

async function paletteFor(mounts: MountedContent, family: GameFamily): Promise<Palette | null> {
  if (family === "q3") return null;
  const path = family === "q1" ? "gfx/palette.lmp" : "pics/colormap.pcx";
  const asset = await mounts.open(path);
  if (asset === null) throw new Error(`Selected ${family} content has no ${path}`);
  if (family === "q1") return decodePalette(asset.bytes, asset.reference);
  const colors = decodePcx(asset.bytes, path).palette;
  if (colors === null) throw new Error(`Selected Quake II colormap has no palette: ${asset.reference.id}`);
  return { colors, source: asset.reference };
}

async function shaderPaths(content: LoadedApplicationContent, mounts: MountedContent): Promise<readonly string[]> {
  const paths = new Set<string>();
  const archives = new Set(mounts.plan.mounts.flatMap(mount => mount.kind === "archive" ? [mount.archivePath] : []));
  for (const product of content.catalog.products) for (const archive of product.archives) {
    if (!archives.has(archive.path)) continue;
    for (const entry of archive.entries) if (/^scripts\/[^/]+\.shader$/i.test(entry.path)) paths.add(entry.path);
  }
  for (const mount of mounts.plan.mounts) {
    if (mount.kind !== "loose") continue;
    const directory = resolve(mount.rootPath, "scripts");
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".shader")) paths.add(`scripts/${entry.name}`);
  }
  return [...paths].sort();
}

/** Presentation caches are distinct from authoritative map and game state. */
export class ApplicationAssets {
  readonly images: SceneImageRegistry;
  private readonly providers = new Map<ContentId, Promise<ProviderSceneAssets>>();
  private readonly models = new Map<string, Promise<ModelAsset>>();
  private readonly brushScenes: WorldScene[] = [];
  private currentWorld: WorldScene | null = null;
  private font: Promise<TextFontSelection> | null = null;
  private fonts: TextFontRegistry | null = null;

  constructor(readonly content: LoadedApplicationContent, owner: RendererResourceOwner) {
    this.images = new SceneImageRegistry(owner);
  }

  get world(): WorldScene {
    if (this.currentWorld === null) throw new Error("World presentation has not loaded");
    return this.currentWorld;
  }

  provider(content: ContentId): Promise<ProviderSceneAssets> {
    const existing = this.providers.get(content);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<ProviderSceneAssets> => {
      const family = this.content.catalog.product(content).expectation.family;
      const mounts = await this.content.forContent(content), palette = await paletteFor(mounts, family);
      const textures = new SceneTextureLoader(this.images, { read: async path => {
        const asset = await mounts.open(path);
        return asset === null ? null : { bytes: asset.bytes, source: { kind: "resource", resource: asset.reference } };
      } }, palette);
      const shaders = new SceneShaderRegistry(textures);
      if (family === "q3") for (const path of await shaderPaths(this.content, mounts)) {
        const asset = await mounts.open(path);
        if (asset !== null) shaders.addScript(new TextDecoder().decode(asset.bytes), path);
      }
      return { family, mounts, palette, textures, shaders };
    })();
    this.providers.set(content, pending);
    return pending;
  }

  async loadWorld(): Promise<WorldScene> {
    if (this.currentWorld !== null) return this.currentWorld;
    const provider = await this.provider(this.content.recipe.presentation.assets);
    const worldspawn = parseEntities(this.content.world.entities).find(entity => entity.get("classname") === "worldspawn");
    this.currentWorld = await WorldScene.load(this.content.world, provider.shaders,
      this.content.world.kind === "q2-bsp" ? { q2SkyName: worldspawn?.get("sky") ?? "unit1_" } : {});
    return this.currentWorld;
  }

  loadConsoleFont(): Promise<TextFontSelection> {
    if (this.font !== null) return this.font;
    this.font = (async (): Promise<TextFontSelection> => {
      const provider = await this.provider(this.content.recipe.presentation.assets);
      let image: RendererImage;
      if (provider.family === "q1") {
        const wad = await provider.mounts.open("gfx.wad");
        if (wad === null || provider.palette === null) throw new Error("Quake console requires gfx.wad and its palette");
        const lump = decodeWad(wad.bytes, "gfx.wad").lumps.find(lump => lump.name === "conchars");
        if (lump === undefined || lump.compression !== 0 || lump.bytes.length !== 128 * 128) throw new Error("Quake conchars is missing or malformed");
        image = this.images.register("conchars", indexedRenderImage([{ width: 128, height: 128, pixels: lump.bytes }], provider.palette,
          { kind: "index", index: 0 }), { wrap: "clamp", filter: "nearest" }, { kind: "resource", resource: wad.reference });
      } else if (provider.family === "q2") {
        const texture = await provider.textures.load("pics/conchars.pcx", { family: "q2", mipmap: false, wrap: "clamp" });
        if (texture === null) throw new Error("Quake II console charset is missing");
        image = texture.image;
      } else {
        const texture = await provider.textures.load("gfx/2d/bigchars", { mipmap: false, wrap: "clamp" });
        if (texture === null) throw new Error("Quake III console charset is missing");
        image = texture.image;
      }
      const classic = classicCharset(image, "conchars", provider.family === "q3" ? "tinted" : "baked");
      const product = this.content.catalog.product(this.content.recipe.presentation.assets);
      if (provider.family === "q2" && product.expectation.edition === "rerelease") {
        this.fonts = createMountedTextFonts(provider.mounts, this.images);
        return this.fonts.select({ kind: "kfont", path: "fonts/qconfont.kfont" }, classic);
      }
      return { kind: "classic", classic, unicode: null };
    })();
    return this.font;
  }

  model(content: ContentId, path: string): Promise<ModelAsset> {
    const key = `${content}\0${path}`;
    const existing = this.models.get(key);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<ModelAsset> => {
      const provider = await this.provider(content);
      if (path.startsWith("*")) {
        const model = Number(path.slice(1));
        if (!Number.isSafeInteger(model) || this.content.world.models[model] === undefined) throw new Error(`Missing inline model ${path}`);
        return { resource: this.content.recipe.map.geometry, model: { kind: "brush-model", world: this.content.world, model }, provider, brushScene: this.world };
      }
      const asset = await provider.mounts.open(path);
      if (asset === null) throw new Error(`Model is absent from selected content: ${content}/${path}`);
      if (path.toLowerCase().endsWith(".bsp")) {
        const world = provider.family === "q1" ? readQ1Bsp(asset.bytes, { source: path })
          : provider.family === "q2" ? toQ2WorldGeometry(readQ2Bsp(asset.bytes, path)) : decodeQ3World(asset.bytes, path);
        const brushScene = await WorldScene.load(world, provider.shaders);
        this.brushScenes.push(brushScene);
        return { resource: asset.reference, model: { kind: "brush-model", world, model: 0 }, provider, brushScene };
      }
      return { ...await loadApplicationModel(provider, asset), provider, brushScene: null };
    })();
    this.models.set(key, pending);
    return pending;
  }

  close(): undefined {
    this.fonts?.close();
    this.fonts = null;
    this.font = null;
    this.currentWorld?.close();
    this.currentWorld = null;
    for (const brush of this.brushScenes) brush.close();
    this.brushScenes.length = 0;
    this.images.close();
    this.providers.clear();
    this.models.clear();
    return undefined;
  }
}
