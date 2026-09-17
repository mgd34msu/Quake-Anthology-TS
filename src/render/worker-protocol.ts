// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResolvedResourceReference } from "../contracts/content.ts";
import type { Mat4, Vec2, Vec3, Vec4 } from "../contracts/math.ts";
import type { BatchFog, BatchLighting, BlendFactor, DepthAtlasPass, DepthImageLevel, DrawBatch, DynamicImageSource,
  ImageLevel, ImageResourceOperation, Q2FragmentLight, Q2ShadowAtlas, Q2ShadowProjection, RenderCommand, RenderImage,
  RenderOperation, RendererImage, RendererResourceOwner, RenderState, RenderVertex, RenderViewState, SceneCamera,
  TextureBinding, TextureFilter } from "../contracts/render.ts";
import type { ExecutionCommand, ExecutionOperation } from "./execution.ts";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Invalid renderer wire record");
  if ("workerFailure" in value) {
    const message = value["workerFailure"];
    throw new Error(typeof message === "string" ? message : "Renderer encoding failed");
  }
  return value;
}
function number(value: unknown): number { if (typeof value !== "number") throw new TypeError("Invalid renderer wire number"); return value; }
function integer(value: unknown): number { const n = number(value); if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("Invalid renderer wire integer"); return n; }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw new TypeError("Invalid renderer wire boolean"); return value; }
function string(value: unknown): string { if (typeof value !== "string") throw new TypeError("Invalid renderer wire string"); return value; }
function isList(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
function list(value: unknown): readonly unknown[] { if (!isList(value)) throw new TypeError("Invalid renderer wire list"); return value; }
function choice<const T extends string>(value: unknown, choices: readonly T[]): T {
  for (const candidate of choices) if (value === candidate) return candidate;
  throw new TypeError("Invalid renderer wire variant");
}
function vec2(value: unknown): Vec2 { const p = record(value); return { x: number(p["x"]), y: number(p["y"]) }; }
function vec3(value: unknown): Vec3 { const p = record(value); return { ...vec2(p), z: number(p["z"]) }; }
function vec4(value: unknown): Vec4 { const p = record(value); return { ...vec3(p), w: number(p["w"]) }; }
function rect(value: unknown) { const p = record(value); return { ...vec2(p), width: number(p["width"]), height: number(p["height"]) }; }
function pair(value: unknown): readonly [number, number] { const a = list(value); if (a.length !== 2) throw new RangeError("Invalid renderer pair"); return [number(a[0]), number(a[1])]; }
function matrix(value: unknown): Mat4 {
  const a = list(value); if (a.length !== 16) throw new RangeError("Invalid renderer matrix");
  return [number(a[0]), number(a[1]), number(a[2]), number(a[3]), number(a[4]), number(a[5]), number(a[6]), number(a[7]),
    number(a[8]), number(a[9]), number(a[10]), number(a[11]), number(a[12]), number(a[13]), number(a[14]), number(a[15])];
}
function offset(value: unknown): RenderState["polygonOffset"] { if (value === null) return null; const p = record(value); return { factor: number(p["factor"]), units: number(p["units"]) }; }
function cull(value: unknown): RenderState["cull"] { return choice(value, ["none", "back", "front"]); }
function blend(value: unknown): BlendFactor { return choice(value, ["zero", "one", "src-color", "one-minus-src-color", "dst-color", "one-minus-dst-color", "src-alpha", "one-minus-src-alpha", "dst-alpha", "one-minus-dst-alpha", "src-alpha-saturate"]); }
function filter(value: unknown): TextureFilter { return choice(value, ["nearest", "linear", "nearest-mipmap-nearest", "linear-mipmap-nearest", "nearest-mipmap-linear", "linear-mipmap-linear"]); }
function state(value: unknown): RenderState {
  const p = record(value), b = record(p["blend"]);
  return { blend: { source: blend(b["source"]), destination: blend(b["destination"]) }, depthTest: choice(p["depthTest"], ["less-equal", "equal", "always"]),
    depthWrite: boolean(p["depthWrite"]), alphaTest: choice(p["alphaTest"], ["none", "gt0", "lt128", "ge128"]), cull: cull(p["cull"]), depthRange: pair(p["depthRange"]), polygonOffset: offset(p["polygonOffset"]) };
}
function vertex(value: unknown): RenderVertex { const p = record(value); return { position: vec4(p["position"]), texCoord: vec2(p["texCoord"]), color: vec4(p["color"]) }; }
function fog(value: unknown): BatchFog {
  const p = record(value), color = vec3(p["color"]);
  switch (p["kind"]) {
    case "constant": return { kind: "constant", color, amount: number(p["amount"]) };
    case "exp2": return { kind: "exp2", color, density: number(p["density"]), ...(p["effect"] === undefined ? {} : { effect: choice(p["effect"], ["color", "none", "rgb", "alpha", "rgba", "overlay"]) }) };
    default: throw new TypeError("Invalid renderer fog");
  }
}
function shadow(value: unknown): Q2ShadowProjection {
  const p = record(value);
  switch (p["kind"]) {
    case "none": return { kind: "none" };
    case "point": return { kind: "point", atlasRect: vec4(p["atlasRect"]) };
    case "cone": return { kind: "cone", atlasRect: vec4(p["atlasRect"]), matrix: matrix(p["matrix"]) };
    default: throw new TypeError("Invalid renderer shadow projection");
  }
}
function light(value: unknown): Q2FragmentLight {
  const p = record(value), cone = p["cone"] === null ? null : record(p["cone"]);
  return { origin: vec3(p["origin"]), radius: number(p["radius"]), color: vec3(p["color"]), scale: number(p["scale"]),
    cone: cone === null ? null : { direction: vec3(cone["direction"]), cosHalfAngle: number(cone["cosHalfAngle"]) }, shadow: shadow(p["shadow"]) };
}
function camera(value: unknown): SceneCamera {
  const p = record(value), axes = list(p["axis"]), clip = record(p["clip"]);
  if (axes.length !== 3) throw new RangeError("Invalid renderer axes");
  const common = { origin: vec3(p["origin"]), axis: [vec3(axes[0]), vec3(axes[1]), vec3(axes[2])] satisfies SceneCamera["axis"], projection: matrix(p["projection"]), viewport: rect(p["viewport"]) };
  if (clip["kind"] === "none") return { ...common, clip: { kind: "none" } };
  if (clip["kind"] !== "portal") throw new TypeError("Invalid renderer camera clip");
  const plane = record(clip["plane"]);
  return { ...common, clip: { kind: "portal", mirror: boolean(clip["mirror"]), plane: { normal: vec3(plane["normal"]), distance: number(plane["distance"]) } } };
}
export function decodeImageLevel(value: unknown): ImageLevel {
  const p = record(value), width = integer(p["width"]), height = integer(p["height"]), pixels = p["pixels"];
  if (!(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new TypeError("Invalid renderer RGBA readback");
  return { width, height, pixels };
}
function snapshot<T>(value: T): T { return structuredClone(value); }
function deferred(action: () => unknown): unknown {
  try { return action(); } catch (error) { return { workerFailure: error instanceof Error ? error.message : String(error) }; }
}

/** Snapshot values without invoking dynamic sources or serializing frontend identities. */
export class WireEncoder {
  private readonly images = new Map<number, RendererImage>();
  private readonly tokens = new Map<DynamicImageSource, number>();
  private readonly sources = new Map<number, DynamicImageSource>();
  private nextToken = 1;
  private nextAcknowledgment = 1;
  private readonly acknowledgments = new Map<number, ImageResourceOperation>();
  constructor(private readonly owner: RendererResourceOwner) {}
  originalImage(ordinal: number): RendererImage { const image = this.images.get(ordinal); if (image === undefined) throw new Error("Unknown renderer image ordinal"); return image; }
  source(token: number): DynamicImageSource { const source = this.sources.get(token); if (source === undefined) throw new Error("Unknown renderer dynamic token"); return source; }
  /** Caller must synchronize and retain tokens while direct prepared draws remain active. */
  clearSources(): void { this.tokens.clear(); this.sources.clear(); }
  clear(): void { this.images.clear(); this.clearSources(); this.acknowledgments.clear(); }
  acknowledge(token: unknown): ImageResourceOperation {
    const id = integer(token), operation = this.acknowledgments.get(id);
    if (operation === undefined) throw new Error("Unknown renderer image acknowledgment");
    this.acknowledgments.delete(id); return operation;
  }
  image(image: RendererImage): unknown {
    if (image.owner.identity !== this.owner.identity || image.owner.session !== this.owner.session || image.owner.generation !== this.owner.generation) throw new Error("Image belongs to another renderer lifetime");
    const previous = this.images.get(image.ordinal);
    if (previous !== undefined && previous !== image) throw new Error("Renderer image ordinal has another identity");
    this.images.set(image.ordinal, image);
    return { ordinal: image.ordinal, width: image.width, height: image.height, name: image.source.kind === "generated" ? image.source.name : image.source.resource.requestedPath };
  }
  binding(binding: TextureBinding): unknown {
    switch (binding.kind) {
      case "bind-image": return { kind: binding.kind, image: this.image(binding.image) };
      case "retain-current-texture": return { kind: binding.kind };
      case "dynamic-image": {
        let token = this.tokens.get(binding.source);
        if (token === undefined) { token = this.nextToken++; this.tokens.set(binding.source, token); this.sources.set(token, binding.source); }
        return { kind: binding.kind, token };
      }
    }
  }
  imageOperation(operation: ImageResourceOperation): unknown {
    return deferred(() => {
      const image = operation.kind === "texture-mode" ? null : this.image(operation.image);
      let retained: ImageResourceOperation;
      switch (operation.kind) {
        case "texture-mode": retained = { ...operation }; break;
        case "release-image": retained = { ...operation }; break;
        case "update-image": retained = { ...operation, content: snapshot(operation.content) }; break;
        case "create-image": {
          const content: RenderImage = operation.content.kind === "indexed8"
            ? { ...snapshot({ ...operation.content, palette: { colors: operation.content.palette.colors, source: null } }), palette: { colors: operation.content.palette.colors.slice(), source: operation.content.palette.source } }
            : snapshot(operation.content);
          retained = { ...operation, content, sampling: snapshot(operation.sampling) }; break;
        }
      }
      const acknowledgment = this.nextAcknowledgment++;
      this.acknowledgments.set(acknowledgment, retained);
      if (retained.kind === "texture-mode") return { ...retained, acknowledgment };
      if (retained.kind !== "create-image") return { ...retained, image, acknowledgment };
      const content = retained.content.kind === "indexed8" ? { ...retained.content, palette: { colors: retained.content.palette.colors } } : retained.content;
      return { ...retained, image, content, acknowledgment };
    });
  }
  batch(batch: DrawBatch): unknown {
    return deferred(() => {
      const lighting = batch.lighting.kind === "vertex" ? batch.lighting : { ...batch.lighting,
        atlas: batch.lighting.atlas === null ? null : { ...batch.lighting.atlas, image: this.image(batch.lighting.atlas.image) } };
      return snapshot({ ...batch, lighting, texture: this.binding(batch.texture), ...(batch.texturing === "pair" ? { secondTexture: { ...batch.secondTexture, binding: this.binding(batch.secondTexture.binding) } } : {}) });
    });
  }
  operation(operation: RenderOperation): unknown {
    return deferred(() => {
      switch (operation.kind) {
        case "draw": case "object-opacity": return { ...operation, batches: operation.batches.map(batch => this.batch(batch)) };
        case "depth-atlas": case "sky-side": return snapshot({ ...operation, image: this.image(operation.image) });
        case "shadow-volume": case "shadow-finish": return snapshot({ ...operation, whiteImage: this.image(operation.whiteImage) });
        case "q2-fog": case "depth-range": case "cull": case "polygon-offset": case "disable-portal-clip": return snapshot(operation);
      }
    });
  }
  command(command: RenderCommand, captures: readonly number[] = []): unknown {
    return deferred(() => {
      switch (command.kind) {
        case "view": return { kind: command.kind, view: { viewport: snapshot(command.view.viewport), clear: snapshot(command.view.clear), clipPlane: snapshot(command.view.clipPlane),
          beforeView: command.view.beforeView.map(operation => this.operation(operation)), operations: command.view.operations.map(operation => this.operation(operation)) } };
        case "image-resource": return { kind: command.kind, operation: this.imageOperation(command.operation) };
        case "stretch-pic": return snapshot({ ...command, image: this.image(command.image) });
        case "swap-buffers": return { kind: command.kind, captures: [...captures] };
        case "draw-buffer": case "set-color": return snapshot(command);
      }
    });
  }
}

/** Reconstruct canonical receiver identities, decoding execution leaves only when reached. */
export class WireDecoder {
  private readonly images = new Map<number, RendererImage>();
  private readonly sources = new Map<number, DynamicImageSource>();
  private readonly acknowledgments = new WeakMap<ImageResourceOperation, number>();
  constructor(private readonly owner: RendererResourceOwner,
    private readonly reachedDynamic: (token: number, apply: (operation: ImageResourceOperation) => void) => RendererImage,
    private readonly paletteSource: ResolvedResourceReference) {}
  /** Caller must finish submitted work and all direct prepared draws before clearing. */
  clearSources(): void { this.sources.clear(); }
  image(value: unknown): RendererImage {
    const p = record(value), ordinal = integer(p["ordinal"]), width = integer(p["width"]), height = integer(p["height"]), name = string(p["name"]);
    const existing = this.images.get(ordinal);
    if (existing !== undefined) {
      if (existing.width !== width || existing.height !== height || existing.source.kind !== "generated" || existing.source.name !== name) throw new Error("Renderer image metadata changed");
      return existing;
    }
    const image: RendererImage = { owner: this.owner, ordinal, width, height, source: { kind: "generated", name } };
    this.images.set(ordinal, image); return image;
  }
  binding(value: unknown): TextureBinding {
    const p = record(value);
    switch (p["kind"]) {
      case "bind-image": return { kind: "bind-image", image: this.image(p["image"]) };
      case "retain-current-texture": return { kind: "retain-current-texture" };
      case "dynamic-image": {
        const token = integer(p["token"]); let source = this.sources.get(token);
        if (source === undefined) { source = { resolve: apply => this.reachedDynamic(token, apply) }; this.sources.set(token, source); }
        return { kind: "dynamic-image", source };
      }
      default: throw new TypeError("Invalid renderer texture binding");
    }
  }
  private level(value: unknown): ImageLevel | DepthImageLevel {
    const p = record(value), width = integer(p["width"]), height = integer(p["height"]), pixels = p["pixels"];
    if (pixels instanceof Uint8Array) return { width, height, pixels };
    if (pixels instanceof Float32Array) return { width, height, pixels };
    throw new TypeError("Invalid renderer image pixels");
  }
  private content(value: unknown): RenderImage {
    const p = record(value), levels = list(p["levels"]);
    if (p["kind"] === "depth32f") {
      const decoded = levels.map(value => { const level = this.level(value); if (!(level.pixels instanceof Float32Array)) throw new TypeError("Invalid depth pixels"); return { ...level, pixels: level.pixels }; });
      const [first, ...rest] = decoded; if (first === undefined) throw new Error("Image has no levels");
      return { kind: "depth32f", levels: [first, ...rest] };
    }
    const decoded = levels.map(value => { const level = this.level(value); if (!(level.pixels instanceof Uint8Array)) throw new TypeError("Invalid color pixels"); return { ...level, pixels: level.pixels }; });
    const [first, ...rest] = decoded; if (first === undefined) throw new Error("Image has no levels");
    if (p["kind"] === "rgba8") return { kind: "rgba8", levels: [first, ...rest], borderColor: vec4(p["borderColor"]) };
    if (p["kind"] !== "indexed8") throw new TypeError("Invalid renderer image encoding");
    const palette = record(p["palette"]), colors = palette["colors"], transparency = record(p["transparency"]), fullbright = p["fullbright"] === null ? null : record(p["fullbright"]), translation = p["translation"];
    if (!(colors instanceof Uint8Array) || colors.length !== 768 || (translation !== null && !(translation instanceof Uint8Array))) throw new TypeError("Invalid indexed palette");
    const common = { kind: "indexed8", levels: [first, ...rest], palette: { colors, source: this.paletteSource }, translation,
      fullbright: fullbright === null ? null : { first: integer(fullbright["first"]), last: integer(fullbright["last"]) } } satisfies Omit<Extract<RenderImage, { kind: "indexed8" }>, "transparency">;
    if (transparency["kind"] === "opaque") return { ...common, transparency: { kind: "opaque" } };
    if (transparency["kind"] === "index") return { ...common, transparency: { kind: "index", index: integer(transparency["index"]) } };
    if (transparency["kind"] === "q1-fence" && transparency["index"] === 255) return { ...common, transparency: { kind: "q1-fence", index: 255 } };
    throw new TypeError("Invalid palette transparency");
  }
  acknowledgment(operation: ImageResourceOperation): number {
    const token = this.acknowledgments.get(operation);
    if (token === undefined) throw new Error("Renderer image operation has no acknowledgment");
    return token;
  }
  imageOperation(value: unknown): ImageResourceOperation {
    const p = record(value), token = integer(p["acknowledgment"]), operation = this.decodeImageOperation(p);
    this.acknowledgments.set(operation, token); return operation;
  }
  private decodeImageOperation(value: unknown): ImageResourceOperation {
    const p = record(value);
    switch (p["kind"]) {
      case "texture-mode": return { kind: "texture-mode", filter: filter(p["filter"]) };
      case "release-image": return { kind: "release-image", image: this.image(p["image"]) };
      case "update-image": return { kind: "update-image", image: this.image(p["image"]), level: integer(p["level"]), content: this.level(p["content"]) };
      case "create-image": { const sampling = record(p["sampling"]); return { kind: "create-image", image: this.image(p["image"]), content: this.content(p["content"]), sampling: { wrap: choice(sampling["wrap"], ["repeat", "clamp"]), filter: filter(sampling["filter"]) } }; }
      default: throw new TypeError("Invalid renderer resource operation");
    }
  }
  private atlas(value: unknown): Q2ShadowAtlas { const p = record(value); return { image: this.image(p["image"]), texelSize: number(p["texelSize"]), nearPlane: number(p["nearPlane"]) }; }
  private lighting(value: unknown): BatchLighting {
    const p = record(value);
    if (p["kind"] === "vertex") return { kind: "vertex" };
    const worldPositions = list(p["worldPositions"]).map(vec3);
    if (p["kind"] === "q2-model-shadow") return { kind: "q2-model-shadow", worldPositions, atlas: this.atlas(p["atlas"]), shadeScale: number(p["shadeScale"]),
      lights: list(p["lights"]).map(value => { const l = record(value); return { origin: vec3(l["origin"]), radius: number(l["radius"]), fraction: vec3(l["fraction"]), shadow: shadow(l["shadow"]) }; }) };
    if (p["kind"] !== "q2-world") throw new TypeError("Invalid batch lighting");
    const common = { kind: "q2-world", worldPositions, normals: list(p["normals"]).map(vec3), atlas: p["atlas"] === null ? null : this.atlas(p["atlas"]) } satisfies Pick<Extract<BatchLighting, { kind: "q2-world" }>, "kind" | "worldPositions" | "normals" | "atlas">;
    if (p["pass"] === "model") return { ...common, pass: "model", lights: list(p["lights"]).map(value => ({ ...light(value), fraction: vec3(record(value)["fraction"]) })), shadeScale: p["shadeScale"] === null ? null : number(p["shadeScale"]) };
    return { ...common, pass: choice(p["pass"], ["lightmap", "texture", "material-lightmap"]), lights: list(p["lights"]).map(light) };
  }
  batch(value: unknown): DrawBatch {
    const p = record(value), primitive = p["primitive"] === "lines" ? { primitive: "lines", lineWidth: number(p["lineWidth"]) } satisfies Pick<Extract<DrawBatch, { primitive: "lines" }>, "primitive" | "lineWidth">
      : { primitive: choice(p["primitive"], ["triangles"]) };
    const common = { ...primitive, indices: list(p["indices"]).map(integer), texture: this.binding(p["texture"]), state: state(p["state"]), lighting: this.lighting(p["lighting"]),
      ...(p["fog"] === undefined ? {} : { fog: fog(p["fog"]) }), ...(p["textureEffect"] === undefined ? {} : { textureEffect: choice(p["textureEffect"], ["luminance-alpha"]) }) };
    if (p["texturing"] === "single") return { ...common, texturing: "single", vertices: list(p["vertices"]).map(vertex) };
    if (p["texturing"] !== "pair") throw new TypeError("Invalid renderer texturing");
    const second = record(p["secondTexture"]);
    return { ...common, texturing: "pair", vertices: list(p["vertices"]).map(value => ({ ...vertex(value), texCoord2: vec2(record(value)["texCoord2"]) })),
      secondTexture: { environment: choice(second["environment"], ["modulate", "add", "replace"]), binding: this.binding(second["binding"]) } };
  }
  private *batches(value: unknown): Generator<DrawBatch, undefined, unknown> { for (const item of list(value)) yield this.batch(item); }
  private *operations(value: unknown): Generator<ExecutionOperation, undefined, unknown> { for (const item of list(value)) yield this.operation(item); }
  operation(value: unknown): ExecutionOperation {
    const p = record(value);
    switch (p["kind"]) {
      case "draw": return { kind: "draw", batches: this.batches(p["batches"]) };
      case "object-opacity": return { kind: "object-opacity", opacity: number(p["opacity"]), batches: this.batches(p["batches"]) };
      case "disable-portal-clip": return { kind: "disable-portal-clip" };
      case "depth-range": return { kind: "depth-range", range: pair(p["range"]) };
      case "cull": return { kind: "cull", cull: cull(p["cull"]) };
      case "polygon-offset": return { kind: "polygon-offset", value: offset(p["value"]) };
      case "depth-atlas": return { kind: "depth-atlas", image: this.image(p["image"]), passes: list(p["passes"]).map(value => this.depthPass(value)) };
      case "sky-side": return { kind: "sky-side", image: this.image(p["image"]), color: vec4(p["color"]), strips: list(p["strips"]).map(strip => list(strip).map(value => { const v = record(value); return { position: vec4(v["position"]), texCoord: vec2(v["texCoord"]) }; })) };
      case "shadow-volume": return { kind: "shadow-volume", whiteImage: this.image(p["whiteImage"]), positions: list(p["positions"]).map(vec4), indices: list(p["indices"]).map(integer), mirror: boolean(p["mirror"]) };
      case "shadow-finish": { const a = list(p["positions"]); if (a.length !== 4) throw new Error("Invalid shadow finish quad"); return { kind: "shadow-finish", whiteImage: this.image(p["whiteImage"]), positions: [vec4(a[0]), vec4(a[1]), vec4(a[2]), vec4(a[3])] }; }
      case "q2-fog": {
        const f = record(p["fog"]), h = record(f["height"]), start = record(h["start"]), end = record(h["end"]);
        if (f["kind"] !== "q2") throw new Error("Invalid Q2 fog kind");
        return { kind: "q2-fog", camera: camera(p["camera"]), farDepth: number(p["farDepth"]), skyDrawn: boolean(p["skyDrawn"]),
          fog: { kind: "q2", color: vec3(f["color"]), density: number(f["density"]), skyFactor: number(f["skyFactor"]), height: { start: { color: vec3(start["color"]), distance: number(start["distance"]) }, end: { color: vec3(end["color"]), distance: number(end["distance"]) }, density: number(h["density"]), falloff: number(h["falloff"]) } } };
      }
      default: throw new TypeError("Invalid renderer operation");
    }
  }
  private depthPass(value: unknown): DepthAtlasPass {
    const p = record(value);
    return { viewport: rect(p["viewport"]), clearDepth: p["clearDepth"] === null ? null : number(p["clearDepth"]), draws: list(p["draws"]).map(value => {
      const d = record(value); return { positions: list(d["positions"]).map(vec4), indices: list(d["indices"]).map(integer), cull: cull(d["cull"]), polygonOffset: offset(d["polygonOffset"]) };
    }) };
  }
  viewState(value: unknown): RenderViewState {
    const p = record(value), clear = p["clear"] === null ? null : record(p["clear"]);
    return { viewport: rect(p["viewport"]), clipPlane: p["clipPlane"] === null ? null : vec4(p["clipPlane"]), clear: clear === null ? null : { depth: number(clear["depth"]), color: clear["color"] === null ? null : vec4(clear["color"]), stencil: boolean(clear["stencil"]) } };
  }
  command(value: unknown): ExecutionCommand {
    const p = record(value);
    switch (p["kind"]) {
      case "draw-buffer": return { kind: "draw-buffer", buffer: choice(p["buffer"], ["front", "back", "back-left", "back-right"]), clear: boolean(p["clear"]) };
      case "set-color": return { kind: "set-color", color: vec4(p["color"]) };
      case "image-resource": return { kind: "image-resource", operation: this.imageOperation(p["operation"]) };
      case "stretch-pic": { const uv = record(p["uv"]); return { kind: "stretch-pic", image: this.image(p["image"]), rect: rect(p["rect"]), uv: { s1: number(uv["s1"]), t1: number(uv["t1"]), s2: number(uv["s2"]), t2: number(uv["t2"]) } }; }
      case "swap-buffers": return { kind: "swap-buffers", captures: list(p["captures"]).map(integer) };
      case "view": {
        const view = record(p["view"]), decoder = this;
        return { kind: "view", view: {
          get viewport() { return decoder.viewState(view).viewport; },
          get clear() { return decoder.viewState(view).clear; },
          get clipPlane() { return decoder.viewState(view).clipPlane; },
          beforeView: this.operations(view["beforeView"]), operations: this.operations(view["operations"]),
        } };
      }
      default: throw new TypeError("Invalid renderer command");
    }
  }
}
