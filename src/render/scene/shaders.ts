import type { ProviderShaderRegistrations, RegisteredSceneMaterial, ShaderLogicalKey, ShaderRegistration, ShaderReplacementStage, ShaderWorldIdentity } from "./material-registrations.ts";
import type { RendererImage } from "../../contracts/render.ts";
import { compileImplicitMaterial, DEFAULT_SHADER_PROFILE, shaderRenderMaterial } from "../../materials/compile.ts";
import type { CompiledMaterial } from "../../materials/compile.ts";
import { finishShader } from "../../materials/material-finish.ts";
import type { FinishShaderProfile } from "../../materials/material-finish.ts";
import { inspectShaderScript, normalizeShaderName, stripShaderExtension } from "../../materials/material.ts";
import type { RegisteredImage, RegisteredShaderVideo, RegisteredSun, ShaderRegistrationProgram } from "../../materials/material.ts";
import { SkyBuilder } from "../../materials/sky.ts";
import { SceneTextureLoader, type SceneTexture } from "./textures.ts";
import type { MaterialPicture } from "../../text/draw2d.ts";

export type SceneShaderBinding = { readonly kind: "unlit"; readonly lightmapIndex: -1 | -2 | -3 | -4; readonly mipmap: boolean }
  | { readonly kind: "world"; readonly world: ShaderWorldIdentity; readonly lightmapIndex: number;
      readonly lightmap: RendererImage | null; readonly baseTexture: SceneTexture | null };

/** Named shaders are registered separately for each lightmap, as R_FindShader does. */
export class SceneShaderRegistry {
  private readonly programs = new Map<string, ShaderRegistrationProgram>();
  private readonly cinematicPrograms = new Set<string>();
  private readonly compiled = new Map<string, Promise<RegisteredSceneMaterial>>();
  private readonly remaps = new Map<string, { readonly name: string; readonly timeOffset: number }>();
  private readonly pictureOrders = new Map<ShaderRegistration, number>();
  private readonly imageRequests = new Map<string, { readonly name: string; readonly binding: Extract<SceneShaderBinding, { readonly kind: "unlit" }> }>();
  readonly sky = new SkyBuilder();
  readonly warnings: string[] = [];
  sun: RegisteredSun | null = null;

  constructor(public textures: SceneTextureLoader, readonly registrations: ProviderShaderRegistrations, readonly profile: FinishShaderProfile = DEFAULT_SHADER_PROFILE,
    private readonly playCinematic: (name: string) => Promise<RegisteredShaderVideo | null> = async () => null,
    private readonly family: "q1" | "q2" | "q3" = "q3", private stage: ShaderReplacementStage | null = null) {}

  addScript(text: string, source = "<shader>"): void {
    for (const entry of inspectShaderScript(text, source).entries) {
      const name = this.key(entry.name);
      if (!this.programs.has(name)) {
        this.programs.set(name, entry.program);
        const definition = entry.textResult.kind === "accepted" ? entry.textResult.definition : entry.textResult.partial;
        if (definition.stages.some(stage => stage.map.kind === "video")) this.cinematicPrograms.add(name);
      }
    }
  }

  hasAuthored(name: string): boolean { return this.programs.has(this.key(name)); }
  hasCinematic(name: string): boolean { return this.cinematicPrograms.has(this.key(name)); }

  remap(original: string, replacement: string, timeOffset = 0): void {
    const key = this.key(original);
    if (key === this.key(replacement)) this.remaps.delete(key);
    else this.remaps.set(key, { name: replacement, timeOffset });
  }

  resolveRemap(name: string): { readonly name: string; readonly timeOffset: number } {
    return this.remaps.get(this.key(name)) ?? { name, timeOffset: 0 };
  }

  register(name: string, binding: SceneShaderBinding = { kind: "unlit", lightmapIndex: -1, mipmap: true }): Promise<RegisteredSceneMaterial> {
    const lightmap = binding.kind === "world" ? binding.lightmap : null, baseTexture = binding.kind === "world" ? binding.baseTexture : null;
    const lightmapIndex = binding.lightmapIndex, mipmap = binding.kind === "unlit" ? binding.mipmap : lightmapIndex !== -4;
    const logical: ShaderLogicalKey = { name: this.key(name), binding: binding.kind === "unlit"
      ? { kind: "unlit", lightmapIndex: binding.lightmapIndex } : { kind: "world", world: binding.world, lightmapIndex, baseTextureName: baseTexture?.name ?? null } };
    const key = `${this.registrations.key(logical)}\0${lightmap?.ordinal ?? -1}\0${baseTexture?.image.ordinal ?? -1}`;
    const previous = this.compiled.get(key);
    if (previous !== undefined) return previous;
    if (binding.kind === "unlit") this.imageRequests.set(key, { name, binding });
    const publisher = this.stage ?? this.registrations, registration = publisher.reserve(logical);
    const pending = this.compile(name, lightmap, lightmapIndex, baseTexture, mipmap)
      .then(current => publisher.publish(registration, current)).catch((error: unknown) => {
        if (this.compiled.get(key) === pending) this.compiled.delete(key);
        throw error;
      });
    this.compiled.set(key, pending);
    return pending;
  }

  /** Stage replacement images without changing source-retained shader handles. */
  replacement(textures: SceneTextureLoader): SceneShaderRegistry {
    const result = new SceneShaderRegistry(textures, this.registrations, this.profile, this.playCinematic, this.family, this.registrations.beginReplacement());
    for (const [key, program] of this.programs) result.programs.set(key, program);
    for (const key of this.cinematicPrograms) result.cinematicPrograms.add(key);
    for (const [key, remap] of this.remaps) result.remaps.set(key, remap);
    return result;
  }

  async prepareReplacement(replacement: SceneShaderRegistry): Promise<void> {
    for (const request of this.imageRequests.values())
      await replacement.register(request.name, request.binding);
  }

  validateReplacement(replacement: SceneShaderRegistry): void {
    if (replacement.registrations !== this.registrations || replacement.stage === null) throw new Error("Shader replacement belongs to another provider or is already complete");
    replacement.stage.validate();
  }

  commitReplacement(replacement: SceneShaderRegistry): void {
    this.validateReplacement(replacement);
    const stage = replacement.stage;
    if (stage === null) throw new Error("Shader replacement lost its stage");
    stage.commit(); replacement.stage = null;
    for (const [key, pending] of replacement.compiled)
      replacement.compiled.set(key, pending.then(material => this.registrations.owner.retained(material.registration)));
    this.textures = replacement.textures;
    this.compiled.clear();
    for (const [key, pending] of replacement.compiled) this.compiled.set(key, pending);
    this.imageRequests.clear();
    for (const [key, request] of replacement.imageRequests) this.imageRequests.set(key, request);
    this.sun = replacement.sun;
  }

  discardReplacement(): void {
    if (this.stage === null) throw new Error("Live shader registry cannot be discarded as a replacement");
    this.stage.discard(); this.compiled.clear(); this.imageRequests.clear();
  }

  async registerPicture(name: string, mipmap = false): Promise<MaterialPicture> {
    const compiled = await this.register(name, { kind: "unlit", lightmapIndex: -4, mipmap });
    let order = this.pictureOrders.get(compiled.registration);
    if (order === undefined) { order = this.pictureOrders.size + 1; this.pictureOrders.set(compiled.registration, order); }
    return { kind: "material", name, material: { order, compiled } };
  }

  private key(name: string): string { return normalizeShaderName(stripShaderExtension(name)); }

  private async compile(name: string, lightmap: RendererImage | null, lightmapIndex: number, baseTexture: SceneTexture | null, mipmap: boolean): Promise<CompiledMaterial> {
    const registered = (image: RendererImage, tmu: 0 | 1 = 0): RegisteredImage => ({ frame: { image }, tmu });
    const program = this.programs.get(this.key(name));
    if (program !== undefined) {
      const result = await program.register({ whiteImage: registered(this.textures.white.image), defaultImage: registered(this.textures.missing.image),
        lightmapImage: registered(lightmap ?? this.textures.white.image, 1),
        findImage: async request => {
          if (baseTexture !== null && this.key(request.name) === this.key(name)) return registered((await this.textures.sampleSurface(baseTexture, request)).image);
          const texture = await this.textures.load(request.name, { mipmap: request.mipmap, wrap: request.wrap, family: this.family, usage: lightmapIndex === -4 ? "picture" : "wall" });
          return texture === null ? null : registered(texture.image);
        }, playShaderCinematic: this.playCinematic, applySun: sun => { this.sun = sun; },
        initializeSkyTexCoords: height => { this.sky.initializeCloudCoordinates(height); }, printWarning: message => { this.warnings.push(message); } });
      return { registered: result, material: shaderRenderMaterial(result.definition), finished: finishShader({ definition: result.definition,
        images: result.stages, lightmapIndex, profile: this.profile }) };
    }
    const loaded = await this.textures.load(name, { mipmap, wrap: mipmap ? "repeat" : "clamp", family: this.family, usage: lightmapIndex === -4 ? "picture" : "wall" }), texture = loaded ?? this.textures.missing;
    const implicitImage = { kind: "loaded", tmu: 0, binding: { kind: "images", playback: { kind: "single", image: { image: texture.image } } } } satisfies Parameters<typeof compileImplicitMaterial>[0]["baseImage"];
    if (loaded === null) {
      this.warnings.push(`${name}: missing shader image, using the source default material`);
      return compileImplicitMaterial({ kind: "default", name, baseImage: implicitImage, profile: this.profile });
    }
    if (lightmap !== null) return compileImplicitMaterial({ kind: "lightmap", name, baseImage: implicitImage, lightmapIndex, profile: this.profile,
      lightmapImage: { kind: "loaded", tmu: 1, binding: { kind: "images", playback: { kind: "single", image: { image: lightmap } } } } });
    if (lightmapIndex === -2) return compileImplicitMaterial({ kind: "white", name, baseImage: implicitImage, profile: this.profile,
      whiteImage: { kind: "loaded", tmu: 0, binding: { kind: "images", playback: { kind: "single", image: { image: this.textures.white.image } } } } });
    return compileImplicitMaterial({ kind: lightmapIndex === -4 ? "picture" : lightmapIndex === -3 ? "vertex" : "dynamic", name, baseImage: implicitImage, profile: this.profile });
  }
}
