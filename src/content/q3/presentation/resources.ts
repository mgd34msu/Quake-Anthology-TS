import type { DynamicLight } from "./scene-host.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { MaterialPicture } from "../../../text/draw2d.ts";
import type { Bounds } from "../../../contracts/math.ts";
import { DEFAULT_MODEL } from "./ref-entity.ts";
import type { RefEntity, RefPoly, SceneModel, SceneShader, SceneSkin } from "./ref-entity.ts";
import type { Refdef } from "./refdef.ts";
import type { Q3SceneRecorder } from "./scene.ts";
export interface AssetReader { read(path: string): Promise<Uint8Array>; has(path: string): boolean; list(prefix?: string): readonly string[]; }
export interface SoundAssetReader extends AssetReader { readFileLength(path: string): number | Promise<number>; readSync(path: string): Uint8Array; }
export interface ClientSoundBank { registerSound(path: string | null, compressed: boolean): Promise<PcmSound | null>; indexForSound(sound: PcmSound | null): number; }
export interface WorldScene { readonly map: { readonly models: readonly { readonly bounds: Bounds }[] }; }
/** The selected mount plan and shared renderer own these resources, not cgame. */
export interface RendererResources {
  registerModel(path: string | null): Promise<SceneModel>;
  registerSkin(path: string): Promise<SceneSkin | null>;
  registerShader(path: string): Promise<SceneShader | null>;
  registerShaderNoMip(path: string | null): Promise<SceneShader | null>;
  picture(shader: SceneShader | null): MaterialPicture;
  modelHandle(model: SceneModel): number;
  modelForHandle(handle: number): SceneModel;
  shaderForHandle(handle: number): SceneShader | null;
  clearScene(): void;
  addRefEntity(entity: RefEntity): void;
  addPoly(poly: RefPoly): void;
  addLight(light: DynamicLight): void;
  remapShader(original: string, replacement: string, offset: string): Promise<void>;
  renderScene(refdef: Refdef): void;
  loadWorld(path: string): Promise<WorldScene>;
}
export interface Q3ResourceHost {
  readonly scene: Q3SceneRecorder;
  readonly zeroPicture: MaterialPicture;
  model(path: string): Promise<SceneModel>;
  skin(path: string): Promise<SceneSkin | null>;
  shader(path: string, mip: boolean): Promise<MaterialPicture | null>;
  world(requestedPath: string): Promise<WorldScene>;
  remapShader(original: string, replacement: string, offset: string): Promise<void>;
}
/** Source integer handles index the session's actual shared registered objects. */
export class Q3RendererResources implements RendererResources {
  private readonly models: SceneModel[] = [DEFAULT_MODEL];
  private readonly modelNames = new Map<string, SceneModel>();
  private readonly skins = new Map<string, SceneSkin | null>();
  private readonly pictures = new Map<string, MaterialPicture>();
  private readonly shaders = new Map<number, MaterialPicture>();
  constructor(readonly host: Q3ResourceHost) {}
  async registerModel(path: string | null): Promise<SceneModel> {
    if (path === null || path.length === 0) return DEFAULT_MODEL;
    const prior = this.modelNames.get(path); if (prior !== undefined) return prior;
    const model = await this.host.model(path); this.modelNames.set(path, model);
    if (model.kind !== "default" && !this.models.includes(model)) this.models.push(model);
    return model;
  }
  async registerSkin(path: string): Promise<SceneSkin | null> {
    if (this.skins.has(path)) return this.skins.get(path) ?? null;
    const skin = await this.host.skin(path); this.skins.set(path, skin); return skin;
  }
  registerShader(path: string): Promise<SceneShader | null> { return this.shader(path, true); }
  registerShaderNoMip(path: string | null): Promise<SceneShader | null> { return path === null ? Promise.resolve(null) : this.shader(path, false); }
  private async shader(path: string, mip: boolean): Promise<SceneShader | null> {
    const key = path.replace(/[A-Z]/g, value => value.toLowerCase());
    const prior = this.pictures.get(key); if (prior !== undefined) return prior;
    const picture = await this.host.shader(path, mip);
    if (picture === null) return null;
    this.pictures.set(key, picture); this.pictures.set(picture.name.replace(/[A-Z]/g, value => value.toLowerCase()), picture);
    this.shaders.set(picture.material.order, picture); return picture;
  }
  picture(shader: SceneShader | null): MaterialPicture {
    if (shader === null) return this.host.zeroPicture;
    const picture = this.pictures.get(shader.name.replace(/[A-Z]/g, value => value.toLowerCase()));
    if (picture === undefined) throw new Error(`Cgame shader is not registered in this resource owner: ${shader.name}`);
    return picture;
  }
  modelHandle(model: SceneModel): number { const index = this.models.indexOf(model); if (index < 0) throw new Error("Cgame model belongs to another resource owner"); return index; }
  modelForHandle(handle: number): SceneModel { const model = this.models[handle]; if (model === undefined) throw new RangeError(`Invalid cgame model handle ${handle}`); return model; }
  shaderForHandle(handle: number): SceneShader | null { if (handle === 0) return null; const shader = this.shaders.get(handle); if (shader === undefined) throw new RangeError(`Invalid cgame shader handle ${handle}`); return shader; }
  clearScene(): void { this.host.scene.clearScene(); }
  addRefEntity(entity: RefEntity): void { this.host.scene.addRefEntity(entity); }
  addPoly(poly: RefPoly): void { this.host.scene.addPoly(poly); }
  addLight(light: DynamicLight): void { this.host.scene.addLight(light); }
  remapShader(original: string, replacement: string, offset: string): Promise<void> { return this.host.remapShader(original, replacement, offset); }
  renderScene(refdef: Refdef): void { this.host.scene.renderScene(refdef); }
  loadWorld(path: string): Promise<WorldScene> { return this.host.world(path); }
}
