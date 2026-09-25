import { SceneMaterialRegistrations } from "../../render/scene/material-registrations.ts";
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
import { classifyBsp } from "../../formats/bsp-kind.ts";
import { readQ2Bsp, toQ2WorldGeometry } from "../../formats/q2-map/index.ts";
import { decodeQ3World, parseEntities } from "../../formats/q3-map/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene } from "../../render/scene/index.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import { loadMenuFont, loadMenuTypography } from "./menu-font.ts";
import type { LoadedApplicationContent } from "./content.ts";
import { loadApplicationModel } from "./model-loader.ts";
import type { ApplicationModelVariants } from "./model-loader.ts";
import { DEFAULT_MODEL_REPLACEMENT_POLICY, loadModelReplacement } from "../../render/scene/models/replacements.ts";
import type { ModelReplacementPolicy } from "../../render/scene/models/replacements.ts";
import { mountedImageReader } from "./image-reader.ts";
import type { ImagePolicy } from "../../render/scene/image-policy.ts";

export interface ProviderSceneAssets {
  readonly modelPolicy: ModelReplacementPolicy;
  readonly family: GameFamily;
  readonly mounts: MountedContent;
  readonly palette: Palette | null;
  readonly textures: SceneTextureLoader;
  readonly shaders: SceneShaderRegistry;
}

export interface PreparedApplicationImageBinding { commit(): void; discard(): void; }
export interface PreparedApplicationImages extends PreparedApplicationImageBinding {
  readonly font: TextFontSelection;
  readonly typography: Awaited<ReturnType<typeof loadMenuTypography>>;
  readonly policy: ImagePolicy;
  provider(content: ContentId): Promise<ProviderSceneAssets>;
  commit(): void;
  discard(): void;
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
  readonly materialRegistrations = new SceneMaterialRegistrations();
  private readonly movies = new Map<string, Promise<RegisteredShaderVideo | null>>();
  private readonly activeTextures = new Set<SceneTextureLoader>();
  private readonly activeMovies = new Set<MaterialCinematic>();
  private closed = false;
  private readonly providers = new Map<ContentId, Promise<ProviderSceneAssets>>();
  private readonly models = new Map<string, Promise<ModelAsset>>();
  private readonly modelVariants = new Map<ApplicationModelVariants, ContentId>();
  private readonly brushScenes: WorldScene[] = [];
  private currentWorld: WorldScene | null = null;
  private font: Promise<TextFontSelection> | null = null;
  private fonts: Awaited<ReturnType<typeof loadMenuFont>> | null = null;
  private typography: Promise<Awaited<ReturnType<typeof loadMenuTypography>>> | null = null;
  private loadedTypography: Awaited<ReturnType<typeof loadMenuTypography>> | null = null;
  private imagePolicyValue: ImagePolicy | undefined;
  private modelPolicyValue: ModelReplacementPolicy;
  private retiredImages: (() => void)[] = [];

  constructor(readonly content: LoadedApplicationContent, owner: RendererResourceOwner, private readonly mediaClock: MediaClock = { sample: () => performance.now() },
    options: { readonly imagePolicy?: ImagePolicy; readonly modelPolicy?: ModelReplacementPolicy; readonly imageRegistry?: SceneImageRegistry } = {}) {
    if (options.imageRegistry !== undefined && options.imageRegistry.owner !== owner) throw new Error("Application images belong to another renderer");
    this.images = options.imageRegistry?.fork(mediaClock) ?? new SceneImageRegistry(owner, mediaClock);
    this.imagePolicyValue = options.imagePolicy;
    this.modelPolicyValue = options.modelPolicy ?? DEFAULT_MODEL_REPLACEMENT_POLICY;
  }
  get imagePolicy(): ImagePolicy | undefined { return this.imagePolicyValue; }
  get modelPolicy(): ModelReplacementPolicy { return this.modelPolicyValue; }
  setModelPolicy(policy: ModelReplacementPolicy): void { this.modelPolicyValue = policy; }

  get world(): WorldScene {
    if (this.currentWorld === null) throw new Error("World presentation has not loaded");
    return this.currentWorld;
  }

  provider(content: ContentId): Promise<ProviderSceneAssets> {
    if (this.closed) throw new Error("Application assets are closed");
    const existing = this.providers.get(content);
    if (existing !== undefined) return existing;
    const registrations = this.materialRegistrations.provider(content);
    const pending = (async (): Promise<ProviderSceneAssets> => {
      const family = this.content.catalog.product(content).expectation.family;
      const mounts = await this.content.forContent(content), palette = await paletteFor(mounts, family);
      if (this.closed) throw new Error("Scene provider loaded after assets closed");
      const textures = new SceneTextureLoader(this.images, mountedImageReader(this.content.catalog, mounts), palette,
        this.imagePolicyValue === undefined ? {} : { policy: this.imagePolicyValue });
      this.activeTextures.add(textures);
      try {
        const shaders = new SceneShaderRegistry(textures, registrations, DEFAULT_SHADER_PROFILE, path => this.materialMovie(content, mounts, path), family);
        const loadScripts = async (): Promise<void> => {
          for (const path of await shaderPaths(this.content, mounts)) {
            const asset = await mounts.open(path);
            if (asset !== null) shaders.addScript(new TextDecoder().decode(asset.bytes), path);
          }
        };
        if (family === "q3") await shaders.initializeSourceMaterials(loadScripts);
        else await loadScripts();
        if (this.closed) throw new Error("Scene provider loaded after assets closed");
        const assets = this;
        return { family, mounts, palette, get textures() { return shaders.textures; }, shaders,
          get modelPolicy() { return assets.modelPolicyValue; } };
      } catch (error) {
        this.activeTextures.delete(textures);
        textures.disposeImages();
        throw error;
      }
    })();
    const cached = pending.catch((error: unknown) => { if (this.providers.get(content) === cached) this.providers.delete(content); throw error; });
    this.providers.set(content, cached);
    return cached;
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
      if (extension !== "roq" && extension !== "cin" && extension !== "ogv") throw new Error(`Unsupported material movie format: ${path}`);
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
    return product.family === "q2" ? 2 : 1;
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
      this.fonts = await loadMenuFont({ catalog: this.content.catalog, mounts: provider.mounts, family: provider.family,
        rerelease: product.expectation.edition === "rerelease", images: this.images,
        ...(this.imagePolicyValue === undefined ? {} : { imagePolicy: this.imagePolicyValue }) });
      return this.fonts.font;
    })();
    return this.font;
  }

  loadMenuTypography(): Promise<Awaited<ReturnType<typeof loadMenuTypography>>> {
    this.typography ??= (async () => {
      const font = await this.loadConsoleFont();
      this.loadedTypography = await loadMenuTypography(this.content.catalog, this.images, font.classic, this.imagePolicyValue);
      return this.loadedTypography;
    })();
    return this.typography;
  }

  async prepareImageRefresh(policy: ImagePolicy, modelPolicy = this.modelPolicyValue): Promise<PreparedApplicationImages> {
    if (this.closed) throw new Error("Application assets are closed");
    if (this.retiredImages.length !== 0) throw new Error("Previous image refresh has not finished rebinding");
    const replacements = new Map<ContentId, { readonly provider: ProviderSceneAssets; readonly textures: SceneTextureLoader; readonly shaders: SceneShaderRegistry }>();
    const stagedProvider = async (content: ContentId): Promise<ProviderSceneAssets> => {
      let replacement = replacements.get(content);
      if (replacement === undefined) {
        const provider = await this.provider(content);
        const textures = new SceneTextureLoader(this.images, mountedImageReader(this.content.catalog, provider.mounts), provider.palette, { policy });
        replacement = { provider, textures, shaders: provider.shaders.replacement(textures) };
        replacements.set(content, replacement);
        await provider.textures.prepareReplacement(textures);
        await provider.shaders.prepareReplacement(replacement.shaders);
      }
      return { ...replacement.provider, textures: replacement.textures, shaders: replacement.shaders };
    };
    const worlds: { readonly current: WorldScene; readonly replacement: WorldScene }[] = [];
    const models: (() => void)[] = [];
    let fonts: Awaited<ReturnType<typeof loadMenuFont>> | null = null;
    let typography: Awaited<ReturnType<typeof loadMenuTypography>> | null = null;
    let preparedRemaps: Awaited<ReturnType<SceneMaterialRegistrations["prepareRemapRefresh"]>> | null = null;
    try {
      for (const content of this.providers.keys()) await stagedProvider(content);
      if (modelPolicy.q1Enhanced !== this.modelPolicyValue.q1Enhanced || modelPolicy.q2Load !== this.modelPolicyValue.q2Load) {
        for (const [variants, content] of this.modelVariants) {
          const provider = await stagedProvider(content);
          if (loadModelReplacement(provider.family, modelPolicy) === loadModelReplacement(provider.family, this.modelPolicyValue)) continue;
          models.push(await variants.prepareReplacement(provider, loadModelReplacement(provider.family, modelPolicy)));
        }
      }
      for (const current of [...(this.currentWorld === null ? [] : [this.currentWorld]), ...this.brushScenes]) {
        const provider = [...replacements.values()].find(replacement => replacement.provider.shaders === current.shaders);
        if (provider === undefined) throw new Error("World image provider is absent");
        worlds.push({ current, replacement: await current.prepareImages(provider.shaders, source => {
          const selected = [...replacements.values()].find(value => value.provider.shaders === source);
          if (selected === undefined) throw new Error("Remap image provider is absent");
          return selected.shaders;
        }) });
      }
      preparedRemaps = await this.materialRegistrations.prepareRemapRefresh(new Map([...replacements.values()].map(value => [value.provider.shaders, value.shaders])));
      {
        const content = this.content.recipe.presentation.assets, provider = await this.provider(content);
        fonts = await loadMenuFont({ catalog: this.content.catalog, mounts: provider.mounts, family: provider.family,
          rerelease: this.content.catalog.product(content).expectation.edition === "rerelease", images: this.images, imagePolicy: policy });
        typography = await loadMenuTypography(this.content.catalog, this.images, fonts.font.classic, policy);
      }
    } catch (error) {
      typography?.close(); fonts?.close();
      for (const world of worlds) world.replacement.close();
      for (const replacement of replacements.values()) { replacement.shaders.discardReplacement(); replacement.textures.disposeImages(); }
      throw error;
    }
    const preparedFonts = fonts, preparedTypography = typography;
    const remaps = preparedRemaps;
    if (preparedFonts === null || preparedTypography === null || remaps === null) throw new Error("Image refresh resources were not prepared");
    return { provider: stagedProvider, font: preparedFonts.font, typography: preparedTypography, policy,
      commit: () => {
        remaps.validate();
        for (const world of worlds) world.current.validateImages(world.replacement);
        for (const replacement of replacements.values()) replacement.provider.shaders.validateReplacement(replacement.shaders);
        for (const commit of models) commit();
        for (const replacement of replacements.values()) {
          const previous = replacement.provider.textures;
          replacement.provider.shaders.commitReplacement(replacement.shaders);
          this.activeTextures.add(replacement.textures);
          this.retiredImages.push(() => { previous.disposeImages(); this.activeTextures.delete(previous); });
        }
        for (const world of worlds) world.current.commitImages(world.replacement);
        remaps.commit();
        const previousFonts = this.fonts, previousTypography = this.loadedTypography;
        this.retiredImages.push(() => previousFonts?.close(), () => previousTypography?.close());
        this.fonts = preparedFonts; this.font = Promise.resolve(preparedFonts.font);
        this.loadedTypography = preparedTypography; this.typography = Promise.resolve(preparedTypography);
        this.imagePolicyValue = policy;
        this.modelPolicyValue = modelPolicy;
      },
      discard: () => {
        preparedTypography.close(); preparedFonts.close();
        for (const world of worlds) world.replacement.close();
        for (const replacement of replacements.values()) { replacement.shaders.discardReplacement(); replacement.textures.disposeImages(); }
      } };
  }

  finishImageRefresh(): void { for (const retire of this.retiredImages.splice(0)) retire(); }

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
        const format = classifyBsp(asset.bytes, path);
        const world = format === "q1" ? readQ1Bsp(asset.bytes, { source: path })
          : format === "q2" ? toQ2WorldGeometry(readQ2Bsp(asset.bytes, path)) : decodeQ3World(asset.bytes, path);
        const brushScene = await WorldScene.load(world, provider.shaders, world.kind === "q2-bsp" ? { q2LightModulate: this.q2LightModulate(asset.reference.provenance.mount.identity.content) } : {});
        this.brushScenes.push(brushScene);
        return { resource: asset.reference, model: { kind: "brush-model", world, model: 0 }, provider, brushScene };
      }
      const loaded = await loadApplicationModel(provider, asset, { enhancedModels: loadModelReplacement(provider.family, this.modelPolicyValue) });
      if (loaded.variants !== undefined) this.modelVariants.set(loaded.variants, content);
      return { ...loaded, provider, brushScene: null };
    })();
    const cached = pending.catch((error: unknown) => { if (this.models.get(key) === cached) this.models.delete(key); throw error; });
    this.models.set(key, cached);
    return cached;
  }

  close(): undefined {
    if (this.closed) return;
    this.closed = true;
    this.finishImageRefresh();
    for (const textures of this.activeTextures) textures.close();
    this.activeTextures.clear();
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
    this.modelVariants.clear();
    return undefined;
  }
}
