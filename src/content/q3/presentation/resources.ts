import type { DynamicLight } from "./scene-host.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { MaterialPicture } from "../../../text/draw2d.ts";
import type { Bounds, Vec3 } from "../../../contracts/math.ts";
import type { Q3WorldGeometry } from "../../../contracts/scene.ts";
import type { SourceClusterPVS } from "../../../world/collision/q3/topology.ts";
import { CommonParseCursor, CommonParseState } from "../../../core/common-parse.ts";
import { CommonError } from "../../../core/common-error.ts";
import { dot3 } from "../../../core/math.ts";
import { DEFAULT_MODEL } from "./ref-entity.ts";
import type { RefEntity, RefPoly, SceneModel, SceneShader, SceneSkin } from "./ref-entity.ts";
import type { Refdef } from "./refdef.ts";
import type { Q3SceneRecorder } from "./scene.ts";
export interface AssetReader { read(path: string): Promise<Uint8Array>; has(path: string): boolean; list(prefix?: string): readonly string[]; }
export interface SoundAssetReader extends AssetReader { readFileLength(path: string): number | Promise<number>; readSync(path: string): Uint8Array; }
export interface ClientSoundBank { registerSound(path: string | null, compressed: boolean): Promise<PcmSound | null>; indexForSound(sound: PcmSound | null): number; }
export interface WorldScene { readonly map: { readonly models: readonly { readonly bounds: Bounds }[] }; }
export interface Q3ResourceWorld {
  readonly map: Pick<Q3WorldGeometry, "entities" | "nodes" | "leaves" | "planes">;
  clusterPVS(cluster: number): SourceClusterPVS;
}
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
  private readonly skinHandles: (SceneSkin | null)[] = [null];
  private readonly skins = new Map<string, SceneSkin | null>();
  private readonly pictures = new Map<string, MaterialPicture>();
  private readonly shaders = new Map<number, MaterialPicture>();
  private readonly entityParser = new CommonParseState();
  private entityCursor = new CommonParseCursor("");
  private worldLoaded = false;
  constructor(readonly host: Q3ResourceHost, private readonly world?: Q3ResourceWorld) {}
  async registerModel(path: string | null): Promise<SceneModel> {
    if (path === null || path.length === 0) return DEFAULT_MODEL;
    const prior = this.modelNames.get(path); if (prior !== undefined) return prior;
    const model = await this.host.model(path); this.modelNames.set(path, model);
    if (model.kind !== "default" && !this.models.includes(model)) this.models.push(model);
    return model;
  }
  async registerSkin(path: string): Promise<SceneSkin | null> {
    if (this.skins.has(path)) return this.skins.get(path) ?? null;
    const skin = await this.host.skin(path); this.skins.set(path, skin);
    if (skin !== null && !this.skinHandles.includes(skin)) this.skinHandles.push(skin);
    return skin;
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
  shaderHandle(shader: SceneShader | null): number { return shader === null ? 0 : this.picture(shader).material.order; }
  skinHandle(skin: SceneSkin | null): number {
    const index = this.skinHandles.indexOf(skin);
    if (index < 0) throw new Error("Cgame skin belongs to another resource owner");
    return index;
  }
  skinForHandle(handle: number): SceneSkin | null {
    const skin = this.skinHandles[handle];
    if (skin === undefined) throw new RangeError(`Invalid cgame skin handle ${handle}`);
    return skin;
  }
  clearScene(): void { this.host.scene.clearScene(); }
  addRefEntity(entity: RefEntity): void { this.host.scene.addRefEntity(entity); }
  addPoly(poly: RefPoly): void { this.host.scene.addPoly(poly); }
  addLight(light: DynamicLight): void { this.host.scene.addLight(light); }
  remapShader(original: string, replacement: string, offset: string): Promise<void> { return this.host.remapShader(original, replacement, offset); }
  renderScene(refdef: Refdef): void { this.host.scene.renderScene(refdef); }
  async loadWorld(path: string): Promise<WorldScene> {
    const scene = await this.host.world(path);
    this.entityCursor = new CommonParseCursor(this.world?.map.entities ?? "");
    this.worldLoaded = true;
    return scene;
  }
  getEntityToken(write: (token: string) => void): boolean {
    const token = this.entityParser.parse(this.entityCursor);
    write(token);
    if (this.entityCursor.offset === null || token.length === 0) { this.entityCursor.offset = 0; return false; }
    return true;
  }
  private pointCluster(read: () => Vec3): number {
    if (!this.worldLoaded || this.world === undefined) throw new CommonError("drop", "R_PointInLeaf: bad model");
    const map = this.world.map;
    let leaf = 0;
    if (map.nodes.length !== 0) {
      const point = read();
      let index = 0;
      for (;;) {
        const node = map.nodes[index];
        if (node === undefined) throw new RangeError("R_PointInLeaf: invalid node");
        const plane = map.planes[node.plane];
        if (plane === undefined) throw new RangeError("R_PointInLeaf: invalid plane");
        const child = node.children[dot3(point, plane.normal) - plane.distance > 0 ? 0 : 1];
        if (child.kind === "leaf") { leaf = child.index; break; }
        index = child.index;
      }
    }
    const result = map.leaves[leaf];
    if (result === undefined) throw new RangeError("R_PointInLeaf: invalid leaf");
    return result.cluster;
  }
  inPVS(readFirst: () => Vec3, readSecond: () => Vec3): boolean {
    const first = this.pointCluster(readFirst);
    if (this.world === undefined) throw new CommonError("drop", "R_PointInLeaf: bad model");
    const visibility = this.world.clusterPVS(first), second = this.pointCluster(readSecond);
    return (visibility.byteAt(second >> 3) & (1 << (second & 7))) !== 0;
  }
}
