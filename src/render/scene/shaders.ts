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

/** Named shaders are registered separately for each lightmap, as R_FindShader does. */
export class SceneShaderRegistry {
  private readonly programs = new Map<string, ShaderRegistrationProgram>();
  private readonly compiled = new Map<string, Promise<CompiledMaterial>>();
  private readonly remaps = new Map<string, { readonly name: string; readonly timeOffset: number }>();
  private readonly pictureOrders = new Map<CompiledMaterial, number>();
  readonly sky = new SkyBuilder();
  readonly warnings: string[] = [];
  sun: RegisteredSun | null = null;

  constructor(readonly textures: SceneTextureLoader, readonly profile: FinishShaderProfile = DEFAULT_SHADER_PROFILE,
    private readonly playCinematic: (name: string) => Promise<RegisteredShaderVideo | null> = async () => null,
    private readonly family: "q1" | "q2" | "q3" = "q3") {}

  addScript(text: string, source = "<shader>"): void {
    for (const entry of inspectShaderScript(text, source).entries) {
      const name = this.key(entry.name);
      if (!this.programs.has(name)) this.programs.set(name, entry.program);
    }
  }

  hasAuthored(name: string): boolean { return this.programs.has(this.key(name)); }

  remap(original: string, replacement: string, timeOffset = 0): void {
    const key = this.key(original);
    if (key === this.key(replacement)) this.remaps.delete(key);
    else this.remaps.set(key, { name: replacement, timeOffset });
  }

  resolveRemap(name: string): { readonly name: string; readonly timeOffset: number } {
    return this.remaps.get(this.key(name)) ?? { name, timeOffset: 0 };
  }

  register(name: string, lightmap: RendererImage | null = null, lightmapIndex = -1, baseTexture: SceneTexture | null = null): Promise<CompiledMaterial> {
    const key = `${this.key(name)}\0${lightmapIndex}\0${lightmap?.ordinal ?? -1}\0${baseTexture?.image.ordinal ?? -1}`;
    const previous = this.compiled.get(key);
    if (previous !== undefined) return previous;
    const pending = this.compile(name, lightmap, lightmapIndex, baseTexture);
    this.compiled.set(key, pending);
    return pending;
  }

  async registerPicture(name: string): Promise<MaterialPicture> {
    const compiled = await this.register(name, null, -4);
    let order = this.pictureOrders.get(compiled);
    if (order === undefined) { order = this.pictureOrders.size + 1; this.pictureOrders.set(compiled, order); }
    return { kind: "material", name, material: { order, compiled } };
  }

  private key(name: string): string { return normalizeShaderName(stripShaderExtension(name)); }

  private async compile(name: string, lightmap: RendererImage | null, lightmapIndex: number, baseTexture: SceneTexture | null): Promise<CompiledMaterial> {
    const registered = (image: RendererImage, tmu: 0 | 1 = 0): RegisteredImage => ({ frame: { image }, tmu });
    const program = this.programs.get(this.key(name));
    if (program !== undefined) {
      const result = await program.register({ whiteImage: registered(this.textures.white.image), defaultImage: registered(this.textures.missing.image),
        lightmapImage: registered(lightmap ?? this.textures.white.image, 1),
        findImage: async request => {
          if (baseTexture !== null && this.key(request.name) === this.key(name)) return registered((await this.textures.sampleSurface(baseTexture, request)).image);
          const texture = await this.textures.load(request.name, { mipmap: request.mipmap, wrap: request.wrap, family: this.family });
          return texture === null ? null : registered(texture.image);
        }, playShaderCinematic: this.playCinematic, applySun: sun => { this.sun = sun; },
        initializeSkyTexCoords: height => { this.sky.initializeCloudCoordinates(height); }, printWarning: message => { this.warnings.push(message); } });
      return { registered: result, material: shaderRenderMaterial(result.definition), finished: finishShader({ definition: result.definition,
        images: result.stages, lightmapIndex, profile: this.profile }) };
    }
    const loaded = await this.textures.load(name, { mipmap: lightmapIndex !== -4, wrap: lightmapIndex === -4 ? "clamp" : "repeat", family: this.family }), texture = loaded ?? this.textures.missing;
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
