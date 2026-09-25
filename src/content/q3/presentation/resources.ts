import { SaveReader } from "../../../persistence/value.ts";
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
import type { Q3AdmittedRefEntity, RefPoly, SceneModel, SceneShader, SceneSkin } from "./ref-entity.ts";
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
  addRefEntity(entity: Q3AdmittedRefEntity): void;
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
  private readonly pictureHandles = new Map<MaterialPicture, number>();
  private readonly shaderRequests: { readonly path: string; readonly mip: boolean; readonly handle: number }[] = [];
  private operations = 0;
  private readonly entityParser = new CommonParseState();
  private entityCursor = new CommonParseCursor("");
  private worldLoaded = false;
  constructor(readonly host: Q3ResourceHost, private readonly world?: Q3ResourceWorld, private readonly handles: "renderer" | "client" = "renderer") {}
  captureCheckpoint() {
    if (this.handles !== "client" || this.operations !== 0) throw new Error("Resource checkpoint requires an idle client handle owner");
    return { models: [...this.modelNames].map(([path, model]) => ({ path, handle: this.modelHandle(model),
      resource: model.kind === "default" ? null : model.resource.id })),
      skins: [...this.skins].map(([path, skin]) => ({ path, handle: this.skinHandle(skin), surfaces: skin?.surfaces ?? null })),
      shaders: this.shaderRequests.map(row => ({ ...row, name: this.shaders.get(row.handle)?.name ?? null })),
      bindings: [...this.pictures].map(([name, picture]) => ({ name, handle: this.shaderHandle(picture) })),
      worldLoaded: this.worldLoaded, entitySource: this.entityCursor.source, entityOffset: this.entityCursor.offset,
      entityParser: this.entityParser.captureSaveState() };
  }
  async restoreCheckpoint(value: unknown): Promise<void> {
    if (this.handles !== "client" || this.operations !== 0 || this.modelNames.size || this.skins.size || this.pictures.size || this.worldLoaded)
      throw new Error("Resource restore requires an empty client handle owner");
    const r = new SaveReader(value, "client-resources");
    for (const row of r.field("models").list(item => ({ path: item.field("path").string(), handle: item.field("handle").integer(0), resource: item.field("resource").nullable(v => v.string()) }))) {
      const model = await this.registerModel(row.path);
      if (this.modelHandle(model) !== row.handle || (model.kind === "default" ? null : model.resource.id) !== row.resource) r.fail("model binding changed");
    }
    for (const row of r.field("skins").list(item => ({ path: item.field("path").string(), handle: item.field("handle").integer(0),
      surfaces: item.field("surfaces").nullable(v => v.list(surface => ({ name: surface.field("name").string(), shader: surface.field("shader").string() }))) }))) {
      const skin = await this.registerSkin(row.path);
      if (this.skinHandle(skin) !== row.handle || JSON.stringify(skin?.surfaces ?? null) !== JSON.stringify(row.surfaces)) r.fail("skin binding changed");
    }
    for (const row of r.field("shaders").list(item => ({ path: item.field("path").string(), mip: item.field("mip").boolean(),
      handle: item.field("handle").integer(1), name: item.field("name").string() }))) {
      const shader = await this.shader(row.path, row.mip);
      if (this.shaderHandle(shader) !== row.handle || shader?.name !== row.name) r.fail("shader binding changed");
    }
    const bindings = r.field("bindings").list(item => ({ name: item.field("name").string(), handle: item.field("handle").integer(1) }));
    if (bindings.length !== this.pictures.size || bindings.some(row => this.pictures.get(row.name) !== this.shaders.get(row.handle))) r.fail("shader aliases changed");
    this.worldLoaded = r.field("worldLoaded").boolean();
    this.entityCursor = new CommonParseCursor(r.field("entitySource").string());
    this.entityCursor.offset = r.field("entityOffset").nullable(v => v.integer(0));
    this.entityParser.restoreSaveState(r.field("entityParser").value);
  }
  registeredModels(): readonly { readonly path: string; readonly handle: number; readonly model: SceneModel }[] {
    const names = [...this.modelNames];
    return this.models.flatMap((model, handle) => {
      if (handle === 0) return [];
      const named = names.find(([, value]) => value === model);
      if (named === undefined) throw new Error("Registered cgame model has no source name");
      return [{ path: named[0], handle, model }];
    });
  }
  registeredSkins(): readonly { readonly path: string; readonly handle: number; readonly skin: SceneSkin }[] {
    const names = [...this.skins];
    return this.skinHandles.flatMap((skin, handle) => {
      if (skin === null) return [];
      const named = names.find(([, value]) => value === skin);
      if (named === undefined) throw new Error("Registered cgame skin has no source name");
      return [{ path: named[0], handle, skin }];
    });
  }
  async registerModel(path: string | null): Promise<SceneModel> {
    if (path === null || path.length === 0) return DEFAULT_MODEL;
    const prior = this.modelNames.get(path); if (prior !== undefined) return prior;
    this.operations++;
    let model: SceneModel;
    try { model = await this.host.model(path); } finally { this.operations--; }
    this.modelNames.set(path, model);
    if (model.kind !== "default" && !this.models.includes(model)) this.models.push(model);
    return model;
  }
  async registerSkin(path: string): Promise<SceneSkin | null> {
    if (this.skins.has(path)) return this.skins.get(path) ?? null;
    this.operations++;
    let skin: SceneSkin | null;
    try { skin = await this.host.skin(path); } finally { this.operations--; }
    this.skins.set(path, skin);
    if (skin !== null && !this.skinHandles.includes(skin)) this.skinHandles.push(skin);
    return skin;
  }
  registerShader(path: string): Promise<SceneShader | null> { return this.shader(path, true); }
  registerShaderNoMip(path: string | null): Promise<SceneShader | null> { return path === null ? Promise.resolve(null) : this.shader(path, false); }
  private async shader(path: string, mip: boolean): Promise<SceneShader | null> {
    const key = path.replace(/[A-Z]/g, value => value.toLowerCase());
    const prior = this.pictures.get(key); if (prior !== undefined) return prior;
    this.operations++;
    let picture: MaterialPicture | null;
    try { picture = await this.host.shader(path, mip); } finally { this.operations--; }
    if (picture === null) return null;
    this.pictures.set(key, picture); this.pictures.set(picture.name.replace(/[A-Z]/g, value => value.toLowerCase()), picture);
    const existing = this.pictureHandles.get(picture);
    const handle = existing ?? (this.handles === "client" ? this.shaders.size + 1 : picture.material.order);
    this.shaders.set(handle, picture); this.pictureHandles.set(picture, handle); this.shaderRequests.push({ path, mip, handle }); return picture;
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
  shaderHandle(shader: SceneShader | null): number {
    if (shader === null) return 0;
    const picture = this.picture(shader);
    if (this.handles === "renderer") return picture.material.order;
    const handle = this.pictureHandles.get(picture);
    if (handle === undefined) throw new Error("Cgame shader belongs to another resource owner");
    return handle;
  }
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
  addRefEntity(entity: Q3AdmittedRefEntity): void { this.host.scene.addRefEntity(entity); }
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
