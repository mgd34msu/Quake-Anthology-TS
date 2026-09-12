import { CinematicPlayback, cinematicBytes } from "../../media/playback.ts";
import { cinematicDimensions } from "../../media/presentation.ts";
import { MaterialCinematic } from "../../media/material.ts";
import type { MediaClock } from "../../media/types.ts";
import type { RegisteredShaderVideo } from "../../materials/material.ts";
import { DEFAULT_SHADER_PROFILE } from "../../materials/compile.ts";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ContentId, GameFamily, ResolvedResourceReference } from "../../contracts/content.ts";
import type { Palette, RendererResourceOwner } from "../../contracts/render.ts";
import type { DecodedModel } from "../../contracts/scene.ts";
import type { MountedContent } from "../../content/mounts/index.ts";
import { decodePalette, decodePcx } from "../../formats/images/index.ts";
import { readQ1Bsp } from "../../formats/q1-map/index.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../formats/q2-map/index.ts";
import { decodeQ3World, parseEntities } from "../../formats/q3-map/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene } from "../../render/scene/index.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { loadMenuFont, loadMenuTypography } from "./menu-font.ts";
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
  private readonly movies = new Map<string, Promise<RegisteredShaderVideo | null>>();
  private readonly activeMovies = new Set<MaterialCinematic>();
  private closed = false;
  private readonly providers = new Map<ContentId, Promise<ProviderSceneAssets>>();
  private readonly models = new Map<string, Promise<ModelAsset>>();
  private readonly brushScenes: WorldScene[] = [];
  private currentWorld: WorldScene | null = null;
  private font: Promise<TextFontSelection> | null = null;
  private fonts: Awaited<ReturnType<typeof loadMenuFont>> | null = null;
  private typography: Promise<Awaited<ReturnType<typeof loadMenuTypography>>> | null = null;
  private loadedTypography: Awaited<ReturnType<typeof loadMenuTypography>> | null = null;

  constructor(readonly content: LoadedApplicationContent, owner: RendererResourceOwner, private readonly mediaClock: MediaClock = { sample: () => performance.now() }) {
    this.images = new SceneImageRegistry(owner);
  }

  get world(): WorldScene {
    if (this.currentWorld === null) throw new Error("World presentation has not loaded");
    return this.currentWorld;
  }

  provider(content: ContentId): Promise<ProviderSceneAssets> {
    if (this.closed) throw new Error("Application assets are closed");
    const existing = this.providers.get(content);
    if (existing !== undefined) return existing;
    const pending = (async (): Promise<ProviderSceneAssets> => {
      const family = this.content.catalog.product(content).expectation.family;
      const mounts = await this.content.forContent(content), palette = await paletteFor(mounts, family);
      const textures = new SceneTextureLoader(this.images, { read: async path => {
        const asset = await mounts.open(path);
        return asset === null ? null : { bytes: asset.bytes, source: { kind: "resource", resource: asset.reference } };
      } }, palette);
      const shaders = new SceneShaderRegistry(textures, DEFAULT_SHADER_PROFILE, path => this.materialMovie(content, mounts, path));
      if (family === "q3") for (const path of await shaderPaths(this.content, mounts)) {
        const asset = await mounts.open(path);
        if (asset !== null) shaders.addScript(new TextDecoder().decode(asset.bytes), path);
      }
      return { family, mounts, palette, textures, shaders };
    })();
    this.providers.set(content, pending);
    return pending;
  }

  private materialMovie(content: ContentId, mounts: MountedContent, argument: string): Promise<RegisteredShaderVideo | null> {
    if (this.closed) throw new Error("Application assets are closed");
    const end = argument.indexOf("\0"), name = end < 0 ? argument : argument.slice(0, end);
    const path = name.includes("/") || name.includes("\\") ? name : `video/${name}`;
    const key = `${content}\0${path}`;
    const previous = this.movies.get(key);
    if (previous !== undefined) return previous;
    const pending = (async (): Promise<RegisteredShaderVideo | null> => {
      const asset = await mounts.open(path);
      if (this.closed) throw new Error("Material movie loaded after assets closed");
      if (asset === null) throw new Error(`Material movie is absent from selected content: ${content}/${path}`);
      const extension = path.toLowerCase().split(".").at(-1);
      if (extension !== "roq" && extension !== "cin") throw new Error(`Unsupported material movie format: ${path}`);
      const source = cinematicBytes(extension, asset.bytes, path), dimensions = cinematicDimensions(source);
      const image = this.images.allocate(dimensions.width, dimensions.height, { kind: "resource", resource: asset.reference });
      const playback = new CinematicPlayback(source, { clock: this.mediaClock, target: { kind: "material", id: key }, loop: true, silent: true,
        onAudio: () => { throw new Error("Silent material movie produced audio"); }, onAudioReset: () => undefined,
        onAudioPause: () => undefined, onComplete: () => undefined });
      const movie = new MaterialCinematic(playback, image, (width, height, provenance) => this.images.allocate(width, height, provenance),
        operation => this.images.commit(operation));
      this.activeMovies.add(movie);
      return { source: movie, image: { frame: { image }, tmu: 0 } };
    })();
    this.movies.set(key, pending);
    return pending;
  }

  private q2LightModulate(content: ContentId): number {
    const product = this.content.catalog.product(content).expectation;
    return product.family === "q2" && product.edition === "rerelease" ? 2 : 1;
  }

  async loadWorld(): Promise<WorldScene> {
    if (this.currentWorld !== null) return this.currentWorld;
    const provider = await this.provider(this.content.recipe.presentation.assets);
    const worldspawn = parseEntities(this.content.world.entities).find(entity => entity.get("classname") === "worldspawn");
    this.currentWorld = await WorldScene.load(this.content.world, provider.shaders,
      this.content.world.kind === "q2-bsp" ? { q2SkyName: worldspawn?.get("sky") ?? "unit1_", q2LightModulate: this.q2LightModulate(this.content.recipe.map.geometry.provenance.mount.identity.content) } : {});
    return this.currentWorld;
  }

  loadConsoleFont(): Promise<TextFontSelection> {
    if (this.font !== null) return this.font;
    this.font = (async (): Promise<TextFontSelection> => {
      const provider = await this.provider(this.content.recipe.presentation.assets);
      const product = this.content.catalog.product(this.content.recipe.presentation.assets);
      this.fonts = await loadMenuFont({ mounts: provider.mounts, family: provider.family,
        rerelease: product.expectation.edition === "rerelease", images: this.images });
      return this.fonts.font;
    })();
    return this.font;
  }

  loadMenuTypography(): Promise<Awaited<ReturnType<typeof loadMenuTypography>>> {
    this.typography ??= (async () => {
      const font = await this.loadConsoleFont();
      this.loadedTypography = await loadMenuTypography(this.content.catalog, this.images, font.classic);
      return this.loadedTypography;
    })();
    return this.typography;
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
        const brushScene = await WorldScene.load(world, provider.shaders, world.kind === "q2-bsp" ? { q2LightModulate: this.q2LightModulate(asset.reference.provenance.mount.identity.content) } : {});
        this.brushScenes.push(brushScene);
        return { resource: asset.reference, model: { kind: "brush-model", world, model: 0 }, provider, brushScene };
      }
      return { ...await loadApplicationModel(provider, asset), provider, brushScene: null };
    })();
    this.models.set(key, pending);
    return pending;
  }

  close(): undefined {
    if (this.closed) return;
    this.closed = true;
    for (const movie of this.activeMovies) movie.close();
    this.activeMovies.clear(); this.movies.clear();
    this.loadedTypography?.close();
    this.loadedTypography = null; this.typography = null;
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
