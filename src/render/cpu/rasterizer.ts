import { createTextureResolver } from "../commands/dynamic-texture.ts";
/* Quake III CPU backend adapted from quake-3-ts/src/render/cpu/rasterizer.ts.
 * Fixed-function state follows id Software tr_backend.c and tr_shadows.c.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
 * Clipping and rasterization algorithms are from the TypeScript donor. */
import { outputGammaTable } from "../output-gamma.ts";
import type { Mat4, Vec2, Vec3, Vec4 } from "../../contracts/math.ts";
import type { DrawBatch, ImageLevel, ImageResourceOperation, PreparedBackendDraw,
  Rect, RendererBackend, RendererDrawBuffer, RendererImage, RendererResourceOwner,
  RenderOperation, RenderState, RenderViewState, TextureBinding, TextureRect } from "../../contracts/render.ts";
import { blend, byte, sampleBound, clamp, colorWord, LITTLE_ENDIAN, passesAlpha, runTriangleRows,
  sampleLineBound, stencilFragment, textureColor, textureHasAlpha } from "./triangle-kernel.ts";
import type { BoundTexture, Framebuffer, Sample, TexturePlaneDerivative, TriangleSetup } from "./triangle-kernel.ts";
import { rasterizeAliasedLine } from "./lines.ts";
import type { LineFragment } from "./lines.ts";
import { worldAttributes, shadeQ2Fragment } from "./lighting.ts";
import type { CpuVertex, CpuLighting } from "./lighting.ts";
import { CpuImages } from "./textures.ts";
import { applyQ1DepthFog, applyQ2DepthFog } from "./fog.ts";
import type { Q1Fog } from "../../materials/legacy-fog.ts";
import { emitSourceTriangleStrips, sourcePrimitiveMode } from "./source.ts";
import type { SourceStageData, SourceStageCell, PreparedSourceDraw } from "./source.ts";
import { SourceStateBit, sourceStateChanges } from "../../materials/source-state.ts";
type TextureEnvironment = Extract<DrawBatch, { readonly texturing: "pair" }>["secondTexture"]["environment"];
type CurrentTexCoord = { readonly kind: "known"; readonly value: Vec2 } | { readonly kind: "source-indeterminate" };
type CurrentColor = { readonly kind: "known"; readonly value: Vec4 } | { readonly kind: "source-indeterminate" };
interface ClientTexCoordArray {
  readonly origin: "svars0" | "svars1" | "raw0" | "raw1" | "local" | "direct";
  readonly values: readonly Vec2[];
}

export const CPU_OPAQUE_STATE: RenderState = {
  blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true,
  alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null,
};

interface ScreenVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly inverseW: number;
  readonly worldPosition: Vec3;
  readonly worldNormal: Vec3;
  readonly texCoord: Vec2;
  readonly texCoord2: Vec2;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

type ClipPlane = "left" | "right" | "bottom" | "top" | "near" | "far" | Vec4;
const CLIP_PLANES: readonly ClipPlane[] = ["left", "right", "bottom", "top", "near", "far"];
/** Precision used for the polygon-offset resolvable-depth unit, not depth quantization. */
export const CPU_OFFSET_DEPTH_BITS = 24;

function finiteVector(value: Vec4): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.z) && Number.isFinite(value.w);
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || !Number.isSafeInteger(width * height * 8)) {
    throw new RangeError("Image dimensions must be positive integers with a safe storage size");
  }
}

function snapshotState(state: RenderState): RenderState {
  return { ...state, blend: { ...state.blend },
    ...(state.depthRange === undefined ? {} : { depthRange: [state.depthRange[0], state.depthRange[1]] satisfies readonly [number, number] }),
    polygonOffset: state.polygonOffset === null ? null : { ...state.polygonOffset } };
}

function snapshotSourceCells(scratch: readonly SourceStageCell[]): readonly SourceStageCell[] {
  return scratch.map(cell => ({ color: { ...cell.color }, texCoord: { ...cell.texCoord }, texCoord2: { ...cell.texCoord2 },
    rawTexCoord: { ...cell.rawTexCoord }, rawTexCoord2: { ...cell.rawTexCoord2 } }));
}

function snapshotBatch(batch: DrawBatch): DrawBatch {
  const state = snapshotState(batch.state);
  if (batch.texturing === "pair") return { ...batch, state, indices: [...batch.indices],
    vertices: batch.vertices.map(vertex => ({ position: { ...vertex.position }, color: { ...vertex.color }, texCoord: { ...vertex.texCoord }, texCoord2: { ...vertex.texCoord2 } })),
    texture: { ...batch.texture }, secondTexture: { ...batch.secondTexture, binding: { ...batch.secondTexture.binding } } };
  return { ...batch, state, indices: [...batch.indices], texture: { ...batch.texture },
    vertices: batch.vertices.map(vertex => ({ position: { ...vertex.position }, color: { ...vertex.color }, texCoord: { ...vertex.texCoord } })) };
}

function snapshotSourceBatch(batch: SourceStageData["batch"], state: RenderState): DrawBatch {
  const indices = [...batch.indices];
  if (batch.texturing === "pair") return { texturing: "pair", primitive: "triangles", state, indices, lighting: batch.lighting,
    vertices: batch.vertices.map(vertex => ({ position: { ...vertex.position }, color: { ...vertex.color }, texCoord: { ...vertex.texCoord }, texCoord2: { ...vertex.texCoord2 } })),
    get texture() { return batch.texture; },
    secondTexture: {
      get binding() { return batch.secondTexture.binding; },
      get environment() { return batch.secondTexture.environment; },
    } };
  return { texturing: "single", primitive: "triangles", state, indices, lighting: batch.lighting,
    vertices: batch.vertices.map(vertex => ({ position: { ...vertex.position }, color: { ...vertex.color }, texCoord: { ...vertex.texCoord } })),
    get texture() { return batch.texture; } };
}

function indexedVertex(batch: DrawBatch, offset: number): CpuVertex {
  const index = batch.indices[offset];
  if (index === undefined) throw new RangeError("Missing triangle index");
  if (batch.texturing === "pair") {
    const vertex = batch.vertices[index];
    if (vertex === undefined) throw new RangeError("Missing triangle vertex");
    return { ...vertex, ...worldAttributes(batch.lighting, index) };
  }
  const vertex = batch.vertices[index];
  if (vertex === undefined) throw new RangeError("Missing triangle vertex");
  return { ...vertex, texCoord2: { x: 0, y: 0 }, ...worldAttributes(batch.lighting, index) };
}

function planeDistance(vertex: CpuVertex, plane: ClipPlane): number {
  const p = vertex.position;
  if (typeof plane !== "string") return p.x * plane.x + p.y * plane.y + p.z * plane.z + p.w * plane.w;
  switch (plane) {
    case "left": return p.w + p.x;
    case "right": return p.w - p.x;
    case "bottom": return p.w + p.y;
    case "top": return p.w - p.y;
    case "near": return p.w + p.z;
    case "far": return p.w - p.z;
  }
}

function intersect(a: CpuVertex, b: CpuVertex, da: number, db: number, plane: ClipPlane): CpuVertex {
  // Symmetric weights give the same intersection for a shared edge in either direction.
  const scale = Math.max(Math.abs(da), Math.abs(db));
  const ad = Math.abs(da) / scale;
  const bd = Math.abs(db) / scale;
  const aw = bd / (ad + bd);
  const bw = ad / (ad + bd);
  const coordinate = (left: number, right: number): number => {
    const anchor = Math.min(left, right);
    return anchor + (left - anchor) * aw + (right - anchor) * bw;
  };
  const w = a.position.w * aw + b.position.w * bw;
  let x = a.position.x * aw + b.position.x * bw;
  let y = a.position.y * aw + b.position.y * bw;
  let z = a.position.z * aw + b.position.z * bw;
  switch (plane) {
    case "left": x = -w; break;
    case "right": x = w; break;
    case "bottom": y = -w; break;
    case "top": y = w; break;
    case "near": z = -w; break;
    case "far": z = w; break;
  }
  return {
    position: { x, y, z, w },
    worldPosition: { x: a.worldPosition.x * aw + b.worldPosition.x * bw, y: a.worldPosition.y * aw + b.worldPosition.y * bw, z: a.worldPosition.z * aw + b.worldPosition.z * bw },
    worldNormal: { x: a.worldNormal.x * aw + b.worldNormal.x * bw, y: a.worldNormal.y * aw + b.worldNormal.y * bw, z: a.worldNormal.z * aw + b.worldNormal.z * bw },
    texCoord: { x: coordinate(a.texCoord.x, b.texCoord.x), y: coordinate(a.texCoord.y, b.texCoord.y) },
    texCoord2: { x: coordinate(a.texCoord2.x, b.texCoord2.x), y: coordinate(a.texCoord2.y, b.texCoord2.y) },
    color: {
      x: a.color.x * aw + b.color.x * bw,
      y: a.color.y * aw + b.color.y * bw,
      z: a.color.z * aw + b.color.z * bw,
      w: a.color.w * aw + b.color.w * bw,
    },
  };
}

function clipPolygon(vertices: readonly CpuVertex[], extraPlane: Vec4 | null): readonly CpuVertex[] {
  let polygon = [...vertices];
  let magnitude = 0;
  for (const vertex of polygon) {
    const p = vertex.position;
    magnitude = Math.max(magnitude, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z), Math.abs(p.w));
  }
  if (magnitude > Number.MAX_VALUE / 4) {
    // Homogeneous coordinates admit a common scale. Bound the plane sums
    // without rejecting otherwise finite input or overflowing intersections.
    polygon = polygon.map((vertex) => ({
      position: { x: vertex.position.x / magnitude, y: vertex.position.y / magnitude,
        z: vertex.position.z / magnitude, w: vertex.position.w / magnitude },
      worldPosition: vertex.worldPosition, worldNormal: vertex.worldNormal,
      color: vertex.color,
      texCoord: vertex.texCoord,
      texCoord2: vertex.texCoord2,
    }));
  }
  for (const plane of extraPlane === null ? CLIP_PLANES : [...CLIP_PLANES, extraPlane]) {
    const last = polygon[polygon.length - 1];
    if (last === undefined) return polygon;
    if (polygon.every((vertex) => planeDistance(vertex, plane) >= 0)) continue;
    const output: CpuVertex[] = [];
    let previous = last;
    let previousDistance = planeDistance(previous, plane);
    for (const current of polygon) {
      const distance = planeDistance(current, plane);
      if ((distance >= 0) !== (previousDistance >= 0)) {
        output.push(intersect(previous, current, previousDistance, distance, plane));
      }
      if (distance >= 0) output.push(current);
      previous = current;
      previousDistance = distance;
    }
    polygon = output;
  }
  // All six planes permit w=0 only at the homogeneous origin. It has no
  // projected area; remove it before division instead of inventing an epsilon plane.
  return polygon.filter((vertex) => vertex.position.w > 0);
}

function subpixel(value: number, scale: number): number {
  const scaled = Math.fround(value) * scale, lower = Math.floor(scaled), fraction = scaled - lower;
  return (fraction < 0.5 || (fraction === 0.5 && lower % 2 === 0) ? lower : lower + 1) / scale;
}

function project(vertex: CpuVertex, viewport: Rect, wScale: number, subpixelScale: number): ScreenVertex {
  const p = vertex.position;
  // A common scale preserves all perspective ratios and bounds reciprocals.
  const inverseW = wScale / p.w;
  return {
    x: subpixel(viewport.x + (p.x / p.w + 1) * viewport.width * 0.5, subpixelScale),
    y: subpixel(viewport.y + (1 - p.y / p.w) * viewport.height * 0.5, subpixelScale),
    z: p.z / p.w,
    inverseW,
    worldPosition: vertex.worldPosition, worldNormal: vertex.worldNormal,
    texCoord: vertex.texCoord,
    texCoord2: vertex.texCoord2,
    r: vertex.color.x * inverseW,
    g: vertex.color.y * inverseW,
    b: vertex.color.z * inverseW,
    a: vertex.color.w * inverseW,
  };
}

function edge(a: ScreenVertex, b: ScreenVertex, x: number, y: number): number {
  return (a.y - b.y) * x + (b.x - a.x) * y + (a.x * b.y - a.y * b.x);
}

function lowerLeft(a: ScreenVertex, b: ScreenVertex): boolean {
  return b.y < a.y || (b.y === a.y && b.x < a.x);
}


/** RGBA rows are top to bottom; positions are homogeneous clip coordinates. */
export class SoftwareRenderer implements RendererBackend {
  private outputPixels: Uint8Array | null = null;
  private gammaTable: Uint8Array | null = null;
  readonly capabilities = { textureUnits: 2, textureEnvAdd: true };
  private framebuffer: Framebuffer;
  private opacityFramebuffer: Framebuffer | null = null;
  private opacityActive = false;
  private get drawPixels(): Uint8Array { return this.framebuffer.pixels; }
  private get colorWords(): Int32Array { return this.framebuffer.colorWords; }
  private get depth(): Float64Array { return this.framebuffer.depth; }
  private get stencil(): Uint32Array | null { return this.framebuffer.stencil; }
  private readonly stencilMaximum: number;
  private readonly subpixelScale: number;
  private readonly images: CpuImages;
  private readonly sampled: Sample = { r: 1, g: 1, b: 1, a: 1 };
  private viewport: Rect;
  private clipPlane: Vec4 | null = null;
  private retainedState: RenderState = CPU_OPAQUE_STATE;
  private clearColor: Vec4 = { x: 0, y: 0, z: 0, w: 0 };
  private clearDepth = 1;
  private stencilEnabled = false;
  private stencilFunction: "always" | "nonzero" = "always";
  private stencilCompareMask = 0xffffffff;
  private stencilWriteMask = 0xffffffff;
  private stencilDepthFail: "keep" | "increment" | "decrement" = "keep";
  private stencilDepthPass: "keep" | "increment" | "decrement" = "keep";
  private colorWrite = true;
  private currentUnit: 0 | 1 = 0;
  private genericArraysOnce = false;
  private colorClientEnabled = false;
  private primaryEnabled = true;
  private primaryClientEnabled = false;
  private secondaryEnabled = false;
  private secondaryClientEnabled = false;
  private readonly clientTexCoords: [ClientTexCoordArray | null, ClientTexCoordArray | null] = [null, null];
  private secondaryEnvironment: TextureEnvironment = "modulate";
  private readonly currentTexCoords: [CurrentTexCoord, CurrentTexCoord] = [
    { kind: "known", value: { x: 0, y: 0 } }, { kind: "known", value: { x: 0, y: 0 } },
  ];
  private currentColor: CurrentColor = { kind: "known", value: { x: 1, y: 1, z: 1, w: 1 } };
  private polygonMode: "fill" | "line" = "fill";
  private lineWidth = 1;
  private sourceBits: number | null = SourceStateBit.DEPTHTEST_DISABLE | SourceStateBit.DEPTHMASK_TRUE;
  private blendEnabled = false;
  private depthTestEnabled = false;
  private portalView = false;
  private closed = false;

  constructor(readonly width: number, readonly height: number, readonly owner: RendererResourceOwner,
    readonly subpixelBits = 8, readonly stencilBits = 8, readonly alphaBits: 0 | 8 = 8) {
    validateDimensions(width, height);
    if (!Number.isInteger(subpixelBits) || subpixelBits < 4 || subpixelBits > 16)
      throw new RangeError("CPU subpixel precision must be between 4 and 16 bits");
    if (!Number.isInteger(stencilBits) || stencilBits < 0 || stencilBits > 32)
      throw new RangeError("CPU stencil precision must be between 0 and 32 bits");
    this.subpixelScale = 2 ** subpixelBits;
    this.viewport = { x: 0, y: 0, width, height };
    const pixels = new Uint8Array(width * height * 4), colorWords = new Int32Array(pixels.buffer);
    if (alphaBits === 0) colorWords.fill(colorWord(0, 0, 0, 1));
    const depth = new Float64Array(width * height);
    depth.fill(1);
    const stencil = stencilBits === 0 ? null : new Uint32Array(width * height);
    this.stencilMaximum = 2 ** stencilBits - 1;
    this.images = new CpuImages(owner);
    this.framebuffer = { width, height, pixels, colorWords, depth, stencil, originX: 0, originY: 0, stride: width };
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("CPU renderer is closed");
  }

  get pixels(): Uint8Array { return this.outputPixels ?? this.drawPixels; }

  withObjectOpacity(opacity: number, draw: () => undefined): undefined {
    this.assertOpen();
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError("Object opacity must be in 0..1");
    if (this.opacityActive) throw new Error("Object opacity scopes cannot nest");
    if (opacity === 0) return undefined;
    if (opacity === 1) {
      this.opacityActive = true;
      try { return draw(); } finally { this.opacityActive = false; }
    }
    const parent = this.framebuffer;
    if (this.opacityFramebuffer === null) {
      const pixels = new Uint8Array(parent.pixels.length);
      this.opacityFramebuffer = { ...parent, pixels, colorWords: new Int32Array(pixels.buffer),
        depth: new Float64Array(parent.depth.length), stencil: parent.stencil === null ? null : new Uint32Array(parent.stencil.length) };
    }
    const scratch = this.opacityFramebuffer;
    scratch.pixels.set(parent.pixels);
    scratch.depth.set(parent.depth);
    if (scratch.stencil !== null && parent.stencil !== null) scratch.stencil.set(parent.stencil);
    const viewport = this.viewport;
    this.opacityActive = true;
    this.framebuffer = scratch;
    try {
      draw();
      const left = Math.max(0, viewport.x), right = Math.min(this.width, viewport.x + viewport.width);
      for (let y = Math.max(0, viewport.y); y < Math.min(this.height, viewport.y + viewport.height); y++) {
        for (let offset = (y * this.width + left) * 4; offset < (y * this.width + right) * 4; offset++) {
          const backdrop = parent.pixels[offset] ?? 0, result = scratch.pixels[offset] ?? 0;
          parent.pixels[offset] = this.alphaBits === 0 && offset % 4 === 3 ? 255 : Math.round(backdrop * (1 - opacity) + result * opacity);
        }
      }
    } finally {
      this.framebuffer = parent;
      this.opacityActive = false;
    }
    return undefined;
  }

  setOutputGamma(gamma: number): undefined {
    this.assertOpen();
    this.gammaTable = outputGammaTable(gamma);
    this.outputPixels = this.gammaTable === null ? null : new Uint8Array(this.drawPixels.length);
    this.finish();
  }

  finish(): undefined {
    this.assertOpen();
    if (this.gammaTable === null || this.outputPixels === null) return;
    for (let offset = 0; offset < this.drawPixels.length; offset++) {
      const value = this.drawPixels[offset] ?? 0;
      this.outputPixels[offset] = offset % 4 === 3 ? value : this.gammaTable[value] ?? 0;
    }
  }

  readRgba(): ImageLevel {
    this.assertOpen();
    this.finish();
    return { width: this.width, height: this.height, pixels: this.pixels.slice() };
  }

  private fragmentLighting(batch: DrawBatch): CpuLighting {
    const lighting = batch.lighting;
    return { parameters: lighting, depth: lighting.kind === "vertex" || lighting.atlas === null ? null : this.images.depthImage(lighting.atlas.image) };
  }

  applyQ1Fog(projection: Mat4, fog: Q1Fog, skyFraction: number, output: "truecolor" | "classic-indexed" = "truecolor"): undefined {
    this.assertOpen();
    applyQ1DepthFog(this.framebuffer, this.viewport, projection, fog, skyFraction, output, this.clearDepth);
  }

  close(): undefined {
    if (this.closed) return;
    this.images.clear();
    this.opacityFramebuffer = null;
    this.closed = true;
  }

  applyImageResource(operation: ImageResourceOperation): undefined {
    this.assertOpen();
    this.images.apply(operation);
  }

  selectDrawBuffer(buffer: RendererDrawBuffer, clear: boolean): undefined {
    this.assertOpen();
    if (buffer !== "front" && buffer !== "back") throw new Error("CPU stereo draw buffers are unavailable");
    if (clear) this.beginView({ viewport: this.viewport, clipPlane: this.clipPlane,
      clear: { color: { x: 1, y: 0, z: 0.5, w: 1 }, depth: 1, stencil: false } });
  }

  beginView(view: RenderViewState): undefined {
    this.assertOpen();
    const { x, y, width, height } = view.viewport;
    if (![x, y, width, height].every(Number.isSafeInteger) || width <= 0 || height <= 0)
      throw new RangeError("CPU viewport must have integer coordinates and positive dimensions");
    if (view.clipPlane !== null && !finiteVector(view.clipPlane)) throw new RangeError("CPU clip plane must be finite");
    this.viewport = { x, y, width, height };
    this.clipPlane = view.clipPlane;
    this.portalView = view.clipPlane !== null;
    if (view.clear === null) return;
    const clear = view.clear;
    if (!Number.isFinite(clear.depth) || clear.color !== null && !finiteVector(clear.color))
      throw new RangeError("CPU clear values must be finite");
    this.clearDepth = clamp(clear.depth);
    if (clear.color !== null) {
      this.clearColor = clear.color;
      this.clearColorBuffer();
    }
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++) {
      const begin = row * this.width + Math.max(0, x), end = row * this.width + Math.min(this.width, x + width);
      if (begin >= end) continue;
      this.depth.fill(this.clearDepth, begin, end);
      if (clear.stencil && this.stencil !== null) this.stencil.fill(0, begin, end);
    }
  }

  clearColorBuffer(): undefined {
    this.assertOpen();
    if (!this.colorWrite) return;
    const { x, y, width, height } = this.viewport, color = this.clearColor;
    const word = colorWord(color.x, color.y, color.z, this.alphaBits === 0 ? 1 : color.w);
    for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++) {
      const begin = row * this.width + Math.max(0, x), end = row * this.width + Math.min(this.width, x + width);
      if (begin < end) this.colorWords.fill(word, begin, end);
    }
  }

  readDepthPixel(windowX: number, windowY: number): number {
    this.assertOpen();
    if (!Number.isInteger(windowX) || !Number.isInteger(windowY)
      || windowX < 0 || windowX >= this.width || windowY < 0 || windowY >= this.height)
      throw new RangeError("CPU depth readback coordinates must be inside the framebuffer");
    const value = this.depth[(this.height - 1 - windowY) * this.width + windowX];
    if (value === undefined) throw new RangeError("Missing CPU depth pixel");
    return Math.fround(value);
  }

  setOverdrawMeasurement(enabled: boolean): undefined {
    this.assertOpen();
    if (enabled && this.stencil === null) throw new Error("CPU overdraw measurement requires stencil storage");
    this.stencilEnabled = enabled;
    this.stencilFunction = "always";
    this.stencilCompareMask = 0xffffffff;
    this.stencilWriteMask = 0xffffffff;
    this.stencilDepthFail = "increment";
    this.stencilDepthPass = "increment";
  }

  readStencilOverdraw(destination: Uint8Array): undefined {
    this.assertOpen();
    if (this.stencil === null) throw new Error("CPU stencil readback requires stencil storage");
    const stride = Math.ceil(this.width / 4) * 4;
    if (destination.length < stride * (this.height - 1) + this.width)
      throw new RangeError("CPU stencil destination is too small for PACK_ALIGNMENT=4");
    for (let row = 0; row < this.height; row++) for (let x = 0; x < this.width; x++) {
      const value = this.stencil[(this.height - 1 - row) * this.width + x];
      if (value === undefined) throw new RangeError("Missing CPU stencil pixel");
      destination[row * stride + x] = value & 255;
    }
  }

  prepareGeometry(input: DrawBatch): PreparedBackendDraw {
    this.assertOpen();
    const resolveTexture = createTextureResolver(resource => this.applyImageResource(resource));
    const batch = snapshotBatch(input);
    if (batch.lighting.kind !== "vertex") {
      if (batch.lighting.lights.length > 8) throw new RangeError("Q2 fragment lighting accepts at most eight selected lights per draw");
      for (const index of batch.indices) {
        const { worldPosition, worldNormal } = worldAttributes(batch.lighting, index);
        if (![worldPosition.x, worldPosition.y, worldPosition.z, worldNormal.x, worldNormal.y, worldNormal.z].every(Number.isFinite))
          throw new RangeError("CPU fragment lighting attributes must be finite");
      }
      this.fragmentLighting(batch);
    }
    const step = batch.primitive === "lines" ? 2 : 3;
    if (batch.indices.length % step !== 0) throw new RangeError("Incomplete CPU primitive indices");
    if (batch.primitive === "lines" && (!Number.isFinite(batch.lineWidth) || batch.lineWidth <= 0))
      throw new RangeError("CPU line width must be positive");
    for (const index of batch.indices) if (!Number.isSafeInteger(index) || index < 0 || index >= batch.vertices.length)
      throw new RangeError("CPU vertex index is outside its array");
    for (const vertex of batch.vertices) if (!finiteVector(vertex.position) || !finiteVector(vertex.color)
      || !Number.isFinite(vertex.texCoord.x) || !Number.isFinite(vertex.texCoord.y))
      throw new RangeError("CPU vertex attributes must be finite");
    if (batch.texturing === "pair") for (const vertex of batch.vertices)
      if (!Number.isFinite(vertex.texCoord2.x) || !Number.isFinite(vertex.texCoord2.y))
        throw new RangeError("CPU secondary coordinates must be finite");
    let phase: "prepared" | "begun" | "drawn" | "cleaned" = "prepared";
    let nextUnit = 0;
    return {
      begin: () => {
        this.assertOpen();
        if (phase !== "prepared") throw new Error("CPU prepared draw has already begun");
        this.applyDiagnosticState(batch.state);
        phase = "begun";
      },
      applyTexture: (unit: number, operation: TextureBinding) => {
        this.assertOpen();
        if (phase !== "begun" || unit !== nextUnit || unit !== 0 && unit !== 1
          || unit === 1 && batch.texturing !== "pair") throw new Error("CPU texture slots must execute in order");
        this.images.bind(unit, resolveTexture(operation));
        this.currentUnit = unit;
        if (unit === 0) this.primaryEnabled = true;
        else this.secondaryEnabled = true;
        nextUnit++;
      },
      draw: () => {
        this.assertOpen();
        if (phase !== "begun" || nextUnit !== (batch.texturing === "pair" ? 2 : 1))
          throw new Error("CPU prepared draw has unapplied texture slots");
        this.drawBatch(batch, this.images.bound(0), batch.texturing === "pair" ? this.images.bound(1) : { kind: "incomplete" });
        if (batch.indices.length !== 0) {
          this.currentColor = { kind: "source-indeterminate" };
          this.currentTexCoords[0] = { kind: "source-indeterminate" };
          if (batch.texturing === "pair") this.currentTexCoords[1] = { kind: "source-indeterminate" };
        }
        phase = "drawn";
      },
      cleanup: () => {
        this.assertOpen();
        if (phase !== "drawn") throw new Error("CPU prepared draw has not completed");
        if (batch.texturing === "pair") this.secondaryEnabled = false;
        this.currentUnit = 0;
        phase = "cleaned";
      },
    };
  }

  draw(batch: DrawBatch): undefined {
    const prepared = this.prepareGeometry(batch);
    prepared.begin();
    prepared.applyTexture(0, batch.texture);
    if (batch.texturing === "pair") prepared.applyTexture(1, batch.secondTexture.binding);
    prepared.draw();
    prepared.cleanup();
  }

  drawStretchPic(image: RendererImage, rect: Rect, uv: TextureRect, color: Vec4): undefined {
    this.beginView({ viewport: { x: 0, y: 0, width: this.width, height: this.height }, clear: null, clipPlane: null });
    const points = [{ x: rect.x, y: rect.y, s: uv.s1, t: uv.t1 },
      { x: rect.x + rect.width, y: rect.y, s: uv.s2, t: uv.t1 },
      { x: rect.x + rect.width, y: rect.y + rect.height, s: uv.s2, t: uv.t2 },
      { x: rect.x, y: rect.y + rect.height, s: uv.s1, t: uv.t2 }];
    this.draw({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", indices: [0, 1, 2, 0, 2, 3],
      texture: { kind: "bind-image", image }, state: { ...CPU_OPAQUE_STATE,
        blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, depthTest: "always", depthWrite: false },
      vertices: points.map(point => ({ position: { x: point.x * 2 / this.width - 1,
        y: 1 - point.y * 2 / this.height, z: -1, w: 1 }, texCoord: { x: point.s, y: point.t }, color })) });
  }

  drawShowImage(image: RendererImage, rect: Rect, proportional: boolean): undefined {
    const width = rect.width * (proportional ? image.width / 512 : 1),
      height = rect.height * (proportional ? image.height / 512 : 1);
    const points = [{ x: rect.x, y: rect.y, s: 0, t: 0 },
      { x: rect.x + width, y: rect.y, s: 1, t: 0 },
      { x: rect.x + width, y: rect.y + height, s: 1, t: 1 },
      { x: rect.x, y: rect.y + height, s: 0, t: 1 }];
    this.draw({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", indices: [0, 1, 2, 0, 2, 3],
      texture: { kind: "bind-image", image }, state: this.retainedState,
      vertices: points.map(point => ({ position: { x: point.x * 2 / this.width - 1,
        y: 1 - point.y * 2 / this.height, z: -1, w: 1 }, texCoord: { x: point.s, y: point.t },
        color: { x: 1, y: 1, z: 1, w: 1 } })) });
  }

  drawImmediate(operation: Exclude<RenderOperation, { readonly kind: "draw" | "object-opacity" }>): undefined {
    this.assertOpen();
    switch (operation.kind) {
      case "q2-fog": applyQ2DepthFog(this.framebuffer, operation, this.alphaBits); return;
      case "depth-atlas": {
        const image = this.images.depthImage(operation.image), target = new SoftwareRenderer(image.width, image.height, this.owner, this.subpixelBits, 0);
        // Atlas image row zero is V=0. Raster rows run from the top of the target.
        for (let y = 0; y < image.height; y++)
          target.depth.set(image.pixels.subarray(y * image.width, (y + 1) * image.width), (image.height - 1 - y) * image.width);
        try {
          for (const pass of operation.passes) {
            target.beginView({ viewport: { ...pass.viewport, y: image.height - pass.viewport.y - pass.viewport.height },
              clipPlane: null, clear: pass.clearDepth === null ? null : { depth: pass.clearDepth, color: null, stencil: false } });
            for (const draw of pass.draws) target.draw({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single",
              indices: draw.indices, texture: { kind: "retain-current-texture" },
              state: { ...CPU_OPAQUE_STATE, cull: draw.cull, polygonOffset: draw.polygonOffset },
              vertices: draw.positions.map(position => ({ position, texCoord: { x: 0, y: 0 }, color: { x: 1, y: 1, z: 1, w: 1 } })) });
          }
          for (let y = 0; y < image.height; y++)
            image.pixels.set(target.depth.subarray((image.height - 1 - y) * image.width, (image.height - y) * image.width), y * image.width);
        } finally { target.close(); }
        return;
      }
      case "disable-portal-clip": this.clipPlane = null; return;
      case "depth-range": this.retainedState = { ...this.retainedState, depthRange: operation.range }; return;
      case "cull": this.retainedState = { ...this.retainedState, cull: operation.cull }; return;
      case "polygon-offset": this.retainedState = { ...this.retainedState, polygonOffset: operation.value }; return;
      case "sky-side": {
        for (const strip of operation.strips) {
          if (strip.length < 2 || strip.length % 2 !== 0) throw new RangeError("CPU sky strips require paired row vertices");
          const indices: number[] = [];
          for (let index = 0; index + 2 < strip.length; index++)
            indices.push(index + index % 2, index + 1 - index % 2, index + 2);
          this.draw({ lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", indices,
            texture: { kind: "bind-image", image: operation.image }, state: this.retainedState,
            vertices: strip.map(vertex => ({ ...vertex, color: operation.color })) });
        }
        return;
      }
      case "shadow-volume":
      case "shadow-finish": {
        if (this.stencilBits < 4) throw new Error("CPU stencil shadows require at least four stencil bits");
        const finishing = operation.kind === "shadow-finish", shade = Math.fround(finishing ? 0.6 : 0.2);
        const vertices = operation.positions.map(position => ({ position,
          color: { x: shade, y: shade, z: shade, w: 1 }, texCoord: { x: 0, y: 0 } }));
        this.stencilEnabled = true;
        this.stencilFunction = finishing ? "nonzero" : "always";
        this.stencilCompareMask = 255;
        this.stencilDepthFail = "keep";
        this.stencilDepthPass = finishing ? "keep" : "increment";
        this.colorWrite = finishing;
        if (finishing) this.clipPlane = null;
        const state: RenderState = { ...this.retainedState, alphaTest: "none", depthTest: "less-equal", depthWrite: finishing,
          blend: { source: finishing ? "dst-color" : "one", destination: "zero" },
          cull: operation.kind === "shadow-volume" ? operation.mirror ? "front" : "back" : "none" };
        const batch: DrawBatch = { lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", vertices,
          indices: operation.kind === "shadow-volume" ? operation.indices : [0, 1, 2, 0, 2, 3],
          texture: { kind: "bind-image", image: operation.whiteImage }, state };
        try {
          this.draw(batch);
          if (!finishing) {
            this.stencilDepthPass = "decrement";
            this.draw({ ...batch, state: { ...state, cull: state.cull === "front" ? "back" : "front" } });
          }
        } finally {
          this.colorWrite = true;
          if (finishing) this.stencilEnabled = false;
        }
        return;
      }
      default: {
        const invalid: never = operation;
        throw new Error(`Invalid CPU operation ${invalid}`);
      }
    }
  }
  private applySourceState(bits: number): void {
    for (const change of sourceStateChanges(this.sourceBits, bits)) {
      switch (change.kind) {
        case "depth-function": this.retainedState = { ...this.retainedState, depthTest: change.value }; break;
        case "blend":
          this.blendEnabled = change.enabled;
          if (change.enabled) this.retainedState = { ...this.retainedState,
            blend: { source: change.source, destination: change.destination } };
          break;
        case "depth-write": this.retainedState = { ...this.retainedState, depthWrite: change.value }; break;
        case "polygon-mode": this.polygonMode = change.value; break;
        case "depth-test": this.depthTestEnabled = change.enabled; break;
        case "alpha-test": this.retainedState = { ...this.retainedState, alphaTest: change.value }; break;
        default: {
          const invalid: never = change;
          throw new Error(`Invalid source state operation ${invalid}`);
        }
      }
    }
    this.sourceBits = bits;
  }

  private applyDiagnosticState(state: RenderState): void {
    this.retainedState = state;
    this.blendEnabled = state.blend.source !== "one" || state.blend.destination !== "zero";
    this.depthTestEnabled = true;
    this.polygonMode = "fill";
    this.sourceBits = null;
  }

  private rasterState(): RenderState {
    let state = this.retainedState;
    if (!this.blendEnabled) state = { ...state, blend: { source: "one", destination: "zero" } };
    if (!this.depthTestEnabled) state = { ...state, depthTest: "always", depthWrite: false };
    return state;
  }

  private refreshSourceCoordinates(scratch: readonly SourceStageCell[]): void {
    for (const unit of [0, 1] satisfies readonly (0 | 1)[]) {
      const array = this.clientTexCoords[unit];
      if (array === null || array.origin === "local" || array.origin === "direct") continue;
      const origin = array.origin;
      const values = scratch.map(cell => {
        switch (origin) {
          case "svars0": return cell.texCoord;
          case "svars1": return cell.texCoord2;
          case "raw0": return cell.rawTexCoord;
          case "raw1": return cell.rawTexCoord2;
        }
      });
      this.clientTexCoords[unit] = { origin, values };
    }
  }

  private validateClientCoordinates(indices: readonly number[]): void {
    for (const unit of [0, 1] satisfies readonly (0 | 1)[]) {
      if (!(unit === 0 ? this.primaryClientEnabled : this.secondaryClientEnabled)) continue;
      const array = this.clientTexCoords[unit];
      if (array === null) throw new Error(`CPU texture unit ${unit} has no source client coordinate array`);
      for (const index of indices) {
        const coordinate = array.values[index];
        if (coordinate === undefined) throw new RangeError(`CPU texture unit ${unit} client coordinate index is outside its array`);
        if (!Number.isFinite(Math.fround(coordinate.x)) || !Number.isFinite(Math.fround(coordinate.y)))
          throw new RangeError("CPU source client coordinates must be finite float32 values");
      }
    }
  }

  private immediateTexture(unit: 0 | 1): BoundTexture {
    const texture = this.enabledTexture(unit), coordinate = this.currentTexCoords[unit];
    if (texture.kind === "incomplete") return texture;
    if (texture.kind === "constant") return texture;
    // tr_shadows.c RB_ShadowTessEnd masks color and disables alpha testing.
    // Those fragments consume only depth/stencil, leaving this texture unsampled.
    if (!this.colorWrite && this.retainedState.alphaTest === "none") return texture;
    if (coordinate.kind === "known") {
      const value: Sample = { r: 1, g: 1, b: 1, a: 1 };
      sampleBound(texture, coordinate.value.x, coordinate.value.y, 0, value);
      return { kind: "constant", internalFormat: texture.internalFormat, sample: value };
    }
    const uniform = texture.levels[0].uniform;
    const alpha = textureHasAlpha(texture.internalFormat);
    // Unknown current coordinates require a proof across every reachable level,
    // including its actual storage conversion, and all possible border taps.
    if (uniform !== null && texture.levels.every(level => level.uniform !== null
      && level.uniform.r === uniform.r && level.uniform.g === uniform.g && level.uniform.b === uniform.b
      && (!alpha || level.uniform.a === uniform.a))
      && (texture.wrap === "repeat" || !texture.magnifyLinear
        || Math.fround(texture.borderColor.x) === uniform.r && Math.fround(texture.borderColor.y) === uniform.g
          && Math.fround(texture.borderColor.z) === uniform.b && (!alpha || Math.fround(texture.borderColor.w) === uniform.a))) {
      return { kind: "constant", internalFormat: texture.internalFormat, sample: uniform };
    }
    // OpenGL 1.2.1 section 2.8 leaves enabled current attributes indeterminate
    // after DrawElements. A coordinate-dependent read has no source-defined sample.
    throw new Error(`CPU immediate texture unit ${unit} has source-indeterminate coordinates and coordinate-dependent texels`);
  }

  private enabledTexture(unit: 0 | 1): BoundTexture {
    return (unit === 0 ? this.primaryEnabled : this.secondaryEnabled) ? this.images.bound(unit) : { kind: "incomplete" };
  }

  beginSourceIterator(setArraysOnce: boolean, scratch: readonly SourceStageCell[]): undefined {
    this.assertOpen();
    this.refreshSourceCoordinates(scratch);
    this.genericArraysOnce = setArraysOnce;
    this.colorClientEnabled = true;
    if (this.currentUnit === 0) this.primaryClientEnabled = true;
    else this.secondaryClientEnabled = true;
    if (setArraysOnce) this.clientTexCoords[this.currentUnit] = { origin: "svars0",
      values: scratch.length === 0 ? this.clientTexCoords[this.currentUnit]?.values ?? [] : scratch.map(cell => cell.texCoord) };
  }

  prepareSourceGeometry(stage: SourceStageData): PreparedSourceDraw {
    return this.prepareSourceDraw(stage.batch, stage);
  }

  private prepareSourceDraw(input: DrawBatch, source: SourceStageData | null): PreparedSourceDraw {
    this.assertOpen();
    const resolveTexture = createTextureResolver(resource => this.applyImageResource(resource));
    let batch = source === null ? snapshotBatch(input) : snapshotSourceBatch(source.batch, this.retainedState);
    this.prepareGeometry(batch);
    const paired = batch.texturing === "pair";
    const sourceKind = source === null ? null : source.kind;
    const scratch = source === null ? null : snapshotSourceCells(source.scratch);
    if (scratch !== null) {
      if (scratch.length !== batch.vertices.length) throw new RangeError("CPU source scratch must match published vertices");
      for (const cell of scratch) if (!finiteVector(cell.color)
        || ![cell.texCoord.x, cell.texCoord.y, cell.texCoord2.x, cell.texCoord2.y].every(value => Number.isFinite(Math.fround(value))))
        throw new RangeError("CPU source scratch attributes must be finite float32 values");
    }
    if (source === null) for (const binding of batch.texturing === "pair" ? [batch.texture, batch.secondTexture.binding] : [batch.texture]) {
      if (binding.kind === "bind-image") this.images.validate(binding.image);
    }
    let phase: "prepared" | "begun" | "textured" | "drawn" | "cleaned" = "prepared", nextUnit = 0;
    let pendingUnit: 0 | 1 | null = null;
    const sourceCoordinates = (secondary: boolean): void => {
      const origin = sourceKind === null ? "direct" : secondary ? sourceKind === "lightmapped-pair" ? "raw1" : "svars1"
        : sourceKind === "lightmapped-pair" || sourceKind === "vertex-lit" ? "raw0" : sourceKind === "dlight" ? "local" : "svars0";
      let values: readonly Vec2[];
      if (batch.vertices.length === 0) values = this.clientTexCoords[this.currentUnit]?.values ?? [];
      else if (origin === "raw0" || origin === "raw1") {
        if (scratch === null) throw new Error("CPU raw source coordinates require stage scratch");
        values = scratch.map(cell => origin === "raw0" ? cell.rawTexCoord : cell.rawTexCoord2);
      } else if (secondary) {
        if (batch.texturing !== "pair") throw new Error("CPU secondary client coordinates require a paired batch");
        values = batch.vertices.map(vertex => vertex.texCoord2);
      } else values = batch.vertices.map(vertex => vertex.texCoord);
      this.clientTexCoords[this.currentUnit] = { origin, values };
    };
    const stateBeforeBinding = sourceKind === null || sourceKind === "generic-pair" || sourceKind === "lightmapped-pair";
    const applyState = (): void => {
      // GL_State leaves physical cull, depth range and polygon offset to their
      // explicit surface operations. Single stages reach it after binding.
      if (source === null) this.applyDiagnosticState(batch.state);
      else this.applySourceState(source.stateBits);
      // DrawMultitextured applies this driver workaround without updating GL_State's cache.
      if (sourceKind === "generic-pair" && this.portalView) this.polygonMode = "fill";
      if (batch.primitive === "lines") this.lineWidth = batch.lineWidth;
    };
    const prepareTexture = (unit: 0 | 1): undefined => {
      this.assertOpen();
      if (phase !== "begun" || pendingUnit !== null || unit !== nextUnit || unit === 1 && batch.texturing !== "pair")
        throw new Error("CPU prepared texture slot order is invalid");
      if (unit === 1 && sourceKind === "lightmapped-pair") sourceCoordinates(false);
      if (sourceKind === null || batch.texturing === "pair") this.currentUnit = unit;
      if (unit === 0) {
        if (sourceKind === null) this.primaryEnabled = true;
        if (sourceKind === null || sourceKind === "lightmapped-pair") this.primaryClientEnabled = true;
        if (sourceKind !== "lightmapped-pair" && (sourceKind !== "generic-single" || !this.genericArraysOnce)) sourceCoordinates(false);
      } else if (batch.texturing === "pair") {
        this.secondaryEnabled = true;
        if (sourceKind !== "lightmapped-pair") this.secondaryClientEnabled = true;
        const environment = batch.secondTexture.environment;
        if (!["modulate", "add", "replace"].includes(environment)) throw new RangeError("CPU texture environment is invalid");
        this.secondaryEnvironment = environment;
        if (sourceKind !== "lightmapped-pair") sourceCoordinates(true);
      }
      pendingUnit = unit;
    };
    return {
      begin: () => {
        this.assertOpen();
        if (phase !== "prepared") throw new Error("CPU prepared draw has already begun");
        if (scratch !== null) this.refreshSourceCoordinates(scratch);
        if (sourceKind !== "generic-single" && sourceKind !== "generic-pair" || !this.genericArraysOnce) this.colorClientEnabled = true;
        if (sourceKind === "vertex-lit" || sourceKind === "dlight" || sourceKind === "fog") {
          if (this.currentUnit === 0) this.primaryClientEnabled = true;
          else this.secondaryClientEnabled = true;
        }
        if (stateBeforeBinding) applyState();
        phase = "begun";
      },
      prepareTexture,
      applyTexture: (unit, operation) => {
        this.assertOpen();
        if (sourceKind === null) prepareTexture(unit);
        if (phase !== "begun" || pendingUnit !== unit) throw new Error("CPU prepared texture slot has not begun");
        this.images.bind(this.currentUnit, resolveTexture(operation));
        pendingUnit = null;
        nextUnit++;
      },
      finishTextures: () => {
        this.assertOpen();
        if (phase !== "begun" || pendingUnit !== null || nextUnit !== (batch.texturing === "pair" ? 2 : 1))
          throw new Error("CPU prepared draw has unapplied texture slots");
        if (!stateBeforeBinding) applyState();
        if (sourceKind === "lightmapped-pair") {
          if (this.currentUnit === 0) this.primaryClientEnabled = true;
          else this.secondaryClientEnabled = true;
          sourceCoordinates(true);
        }
        phase = "textured";
      },
      draw: primitives => {
        this.assertOpen();
        if (phase !== (sourceKind === null ? "begun" : "textured") || pendingUnit !== null || nextUnit !== (batch.texturing === "pair" ? 2 : 1))
          throw new Error("CPU prepared draw has unapplied texture slots");
        const mode = sourcePrimitiveMode(primitives, false), discrete = mode === "discrete-strips";
        const state = this.rasterState();
        let sourceVertices: readonly CpuVertex[] | null = null;
        if (sourceKind !== null) {
          if (mode !== "none" && !discrete && batch.indices.length !== 0) this.validateClientCoordinates(batch.indices);
          let retainedColor: Vec4 | null = null;
          if (!discrete && !this.colorClientEnabled && mode !== "none" && batch.indices.length !== 0) {
            if (this.currentColor.kind !== "known") throw new Error("CPU source draw color is source-indeterminate");
            retainedColor = this.currentColor.value;
          }
          const primary = !discrete && this.primaryClientEnabled ? this.clientTexCoords[0]?.values : undefined;
          const secondary = !discrete && this.secondaryClientEnabled ? this.clientTexCoords[1]?.values : undefined;
          sourceVertices = batch.vertices.map((vertex, index): CpuVertex => {
            const cell = scratch?.[index];
            if (cell === undefined) throw new RangeError("CPU source scratch vertex is missing");
            // Only indexed vertices consume retained array slots. Unreferenced
            // allocation tails keep their unused coordinates.
            return { position: vertex.position, ...worldAttributes(batch.lighting, index),
              color: discrete ? { x: byte(cell.color.x) / 255, y: byte(cell.color.y) / 255, z: byte(cell.color.z) / 255, w: byte(cell.color.w) / 255 } : retainedColor ?? vertex.color,
              texCoord: discrete ? { x: Math.fround(cell.texCoord.x), y: Math.fround(cell.texCoord.y) } : primary?.[index] ?? vertex.texCoord,
              texCoord2: secondary?.[index] ?? cell.texCoord2 };
          });
          if (this.secondaryEnabled) {
            batch = { texturing: "pair", primitive: "triangles", vertices: sourceVertices, indices: batch.indices,
              lighting: batch.lighting, texture: { kind: "retain-current-texture" }, secondTexture: {
                binding: { kind: "retain-current-texture" }, environment: this.secondaryEnvironment,
              }, state };
          } else batch = { texturing: "single", primitive: "triangles", vertices: sourceVertices, indices: batch.indices,
              lighting: batch.lighting, texture: { kind: "retain-current-texture" }, state };
        } else batch = { ...batch, state };
        if (batch.indices.length !== 0 && mode !== "none") {
          {
            if (mode === "elements") {
              if (sourceKind === null) this.drawBatch(batch, this.enabledTexture(0), this.enabledTexture(1));
              else this.drawBatch(batch, this.primaryClientEnabled ? this.enabledTexture(0) : this.immediateTexture(0),
                this.secondaryClientEnabled ? this.enabledTexture(1) : this.immediateTexture(1));
              if (sourceKind === null || this.colorClientEnabled) this.currentColor = { kind: "source-indeterminate" };
              if (sourceKind === null || this.primaryClientEnabled) this.currentTexCoords[0] = { kind: "source-indeterminate" };
              if (sourceKind === null ? batch.texturing === "pair" : this.secondaryClientEnabled)
                this.currentTexCoords[1] = { kind: "source-indeterminate" };
            } else {
              if (sourceVertices === null) throw new Error("CPU source strips require stage scratch");
              const vertices = sourceVertices;
              const texture = this.enabledTexture(0), secondary = this.enabledTexture(1);
              const uv0 = { x: 0, y: 0 }, uv1 = { x: 0, y: 0 };
              const current0: CurrentTexCoord = { kind: "known", value: uv0 }, current1: CurrentTexCoord = { kind: "known", value: uv1 };
              let first: CpuVertex | null = null, second: CpuVertex | null = null, even = true;
              emitSourceTriangleStrips(batch.indices, {
                begin: () => { first = null; second = null; even = true; },
                element: index => {
                  const vertex = vertices[index];
                  if (vertex === undefined) throw new RangeError("CPU source strip vertex is missing");
                  if (discrete || this.colorClientEnabled) this.currentColor = { kind: "known", value: vertex.color };
                  if (discrete && this.currentUnit !== 0)
                    throw new Error("Unsupported source R_ArrayElementDiscrete multitexture targets 0 and 1");
                  if (discrete || this.primaryClientEnabled) {
                    uv0.x = Math.fround(vertex.texCoord.x); uv0.y = Math.fround(vertex.texCoord.y);
                    this.currentTexCoords[0] = current0;
                  }
                  if (!discrete && this.secondaryClientEnabled) {
                    uv1.x = Math.fround(vertex.texCoord2.x); uv1.y = Math.fround(vertex.texCoord2.y);
                    this.currentTexCoords[1] = current1;
                  }
                  if (first === null) first = vertex;
                  else if (second === null) second = vertex;
                  else {
                    // Strip parity emits (a,b,c), then (c,b,d), then (c,d,e):
                    // exactly the source triples, including their third/provoking vertex.
                    const primaryTexture = discrete || this.primaryClientEnabled ? texture : this.immediateTexture(0);
                    const secondaryTexture = !discrete && this.secondaryClientEnabled ? secondary : this.immediateTexture(1);
                    this.drawTriangle(even ? first : second, even ? second : first, vertex, batch, primaryTexture, secondaryTexture);
                    first = second; second = vertex; even = !even;
                  }
                },
                end: () => {},
              });
            }
          }
        }
        phase = "drawn";
      },
      cleanup: () => {
        this.assertOpen();
        if (phase !== "drawn") throw new Error("CPU prepared draw has not completed");
        if (paired) {
          if (sourceKind === null) this.currentUnit = 1;
          if (this.currentUnit === 0) {
            this.primaryEnabled = false;
            if (sourceKind !== "generic-pair") this.primaryClientEnabled = false;
          } else {
            this.secondaryEnabled = false;
            if (sourceKind !== "generic-pair") this.secondaryClientEnabled = false;
          }
          this.currentUnit = 0;
        }
        if (sourceKind === null && batch.state.polygonOffset !== null) {
          this.retainedState = { ...this.retainedState, polygonOffset: null };
        }
        if (batch.primitive === "lines") this.lineWidth = 1;
        phase = "cleaned";
      },
    };
  }

  private drawPolygonOutline(polygon: readonly CpuVertex[], batch: DrawBatch, texture: BoundTexture, secondary: BoundTexture): void {
    const first = polygon[0];
    if (first === undefined) return;
    const projected = polygon.map(vertex => project(vertex, this.viewport, 1, this.subpixelScale));
    let area = 0, previous = projected[projected.length - 1];
    if (previous === undefined) return;
    for (const current of projected) {
      area += previous.x * current.y - previous.y * current.x;
      previous = current;
    }
    if (!Number.isFinite(area) || batch.state.cull === "back" && area >= 0 || batch.state.cull === "front" && area < 0) return;
    // GL_POLYGON_OFFSET_FILL has no effect on polygon-line fragments.
    // Keep the clipping-created boundary and never draw triangulation spokes.
    let edgeStart = first;
    for (let index = 1; index <= polygon.length; index++) {
      const edgeEnd = index === polygon.length ? first : polygon[index];
      if (edgeEnd === undefined) throw new RangeError("Missing clipped perimeter vertex");
      // clipPolygon already applied the portal plane. A second test can
      // reject its rounded boundary points.
      this.rasterizeLine(edgeStart, edgeEnd, this.lineWidth, batch, texture, secondary);
      edgeStart = edgeEnd;
    }
  }

  private drawBatch(batch: DrawBatch, texture: BoundTexture, secondary: BoundTexture): void {
    if (batch.indices.length === 0) return;
    if (batch.primitive === "lines") {
      for (let offset = 0; offset < batch.indices.length; offset += 2) {
        this.drawLine(indexedVertex(batch, offset), indexedVertex(batch, offset + 1), batch.lineWidth, batch, texture, secondary);
      }
      return;
    }
    for (let offset = 0; offset < batch.indices.length; offset += 3) {
      this.drawTriangle(indexedVertex(batch, offset), indexedVertex(batch, offset + 1), indexedVertex(batch, offset + 2), batch, texture, secondary);
    }
  }

  private drawLine(first: CpuVertex, second: CpuVertex, width: number,
    batch: DrawBatch, texture: BoundTexture, secondary: BoundTexture): void {
    let a = first, b = second;
    if (this.clipPlane !== null) {
      const da = planeDistance(a, this.clipPlane), db = planeDistance(b, this.clipPlane);
      if (da < 0 && db < 0) return;
      if (da < 0) a = intersect(a, b, da, db, this.clipPlane);
      else if (db < 0) b = intersect(a, b, da, db, this.clipPlane);
    }
    this.rasterizeLine(a, b, width, batch, texture, secondary);
  }

  private rasterizeLine(a: CpuVertex, b: CpuVertex, width: number,
    batch: DrawBatch, texture: BoundTexture, secondary: BoundTexture): void {
    const scissor = { minX: Math.max(0, -this.viewport.x), minY: Math.max(0, -this.viewport.y),
      maxX: Math.min(this.viewport.width - 1, this.width - 1 - this.viewport.x),
      maxY: Math.min(this.viewport.height - 1, this.height - 1 - this.viewport.y) };
    rasterizeAliasedLine(a, b, this.viewport.width, this.viewport.height, width, scissor, fragment => {
      const x = fragment.x + this.viewport.x, y = fragment.y + this.viewport.y;
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) this.lineFragment({ ...fragment, x, y }, batch, texture, secondary);
    });
  }

  private drawTriangle(a: CpuVertex, b: CpuVertex, c: CpuVertex,
    batch: DrawBatch, texture: BoundTexture, secondary: BoundTexture): void {
    const original: readonly [CpuVertex, CpuVertex, CpuVertex] = [a, b, c];
    const polygon = clipPolygon(original, this.clipPlane);
    const first = polygon[0];
    if (first === undefined) return;
    if (this.polygonMode === "line") {
      this.drawPolygonOutline(polygon, batch, texture, secondary);
      return;
    }
    let interpolation: readonly [ScreenVertex, ScreenVertex, ScreenVertex] | null = null;
    if (original.every(vertex => vertex.position.w > 0 && vertex.position.z >= -vertex.position.w && vertex.position.z <= vertex.position.w)
      && original.some(vertex => Math.abs(vertex.position.x) > vertex.position.w || Math.abs(vertex.position.y) > vertex.position.w)) {
      // The measured GL profile retains the original snapped interpolation
      // plane. Rebuilding it from newly snapped clip vertices changes UVs on
      // thin triangles. Coverage still uses the bounded clipped polygon.
      const scale = Math.min(original[0].position.w, original[1].position.w, original[2].position.w);
      const projected: readonly [ScreenVertex, ScreenVertex, ScreenVertex] = [project(original[0], this.viewport, scale, this.subpixelScale),
        project(original[1], this.viewport, scale, this.subpixelScale), project(original[2], this.viewport, scale, this.subpixelScale)];
      const area = edge(projected[0], projected[1], projected[2].x, projected[2].y);
      if (Number.isFinite(area)) {
        if (area === 0) return;
        interpolation = projected;
      }
    }
    for (let index = 1; index + 1 < polygon.length; index++) {
      const second = polygon[index];
      const third = polygon[index + 1];
      if (second === undefined || third === undefined) throw new RangeError("Missing clipped vertex");
      const wScale = Math.min(first.position.w, second.position.w, third.position.w);
      this.triangle(project(first, this.viewport, wScale, this.subpixelScale),
        project(second, this.viewport, wScale, this.subpixelScale), project(third, this.viewport, wScale, this.subpixelScale), batch, texture, secondary, interpolation);
    }
  }

  private lineFragment(fragment: LineFragment, batch: DrawBatch, texture: BoundTexture, secondaryTexture: BoundTexture): void {
    const index = fragment.y * this.width + fragment.x, previousDepth = this.depth[index];
    if (previousDepth === undefined) throw new RangeError("Line fragment outside framebuffer");
    const state = batch.state, near = clamp(state.depthRange[0]), far = clamp(state.depthRange[1]);
    const depth = clamp(fragment.depth) * (far - near) + near;
    const depthPassed = !((state.depthTest === "less-equal" && depth > previousDepth) || (state.depthTest === "equal" && depth !== previousDepth));
    if (!depthPassed && !this.stencilEnabled) return;
    const textureConsumed = this.colorWrite || state.alphaTest !== "none";
    let r = clamp(fragment.color.x), g = clamp(fragment.color.y), b = clamp(fragment.color.z), alpha = clamp(fragment.color.w);
    const vertexColor = { x: r, y: g, z: b, w: alpha };
    let texel: Sample = { r: 1, g: 1, b: 1, a: 1 };
    if (textureConsumed && texture.kind !== "incomplete") {
      sampleLineBound(texture, fragment.texCoord, fragment.texCoordDerivative, this.sampled);
      texel = { ...this.sampled, a: textureHasAlpha(texture.internalFormat) ? this.sampled.a : 1 };
      r *= this.sampled.r; g *= this.sampled.g; b *= this.sampled.b;
      if (textureHasAlpha(texture.internalFormat)) alpha *= this.sampled.a;
    }
    if (textureConsumed && batch.lighting.kind !== "vertex") {
      const result = shadeQ2Fragment(this.fragmentLighting(batch), fragment.worldPosition, fragment.worldNormal, vertexColor, texel);
      r = result.r; g = result.g; b = result.b; alpha = result.a;
    }
    if (textureConsumed && batch.texturing === "pair" && secondaryTexture.kind !== "incomplete") {
      const secondary = batch.secondTexture;
      sampleLineBound(secondaryTexture, fragment.texCoord2, fragment.texCoord2Derivative, this.sampled);
      r = textureColor(r, this.sampled.r, secondary.environment); g = textureColor(g, this.sampled.g, secondary.environment);
      b = textureColor(b, this.sampled.b, secondary.environment);
      if (textureHasAlpha(secondaryTexture.internalFormat)) alpha = secondary.environment === "replace" ? this.sampled.a : alpha * this.sampled.a;
    }
    if (!passesAlpha(alpha, state.alphaTest)) return;
    if (this.stencilEnabled && !stencilFragment(this.stencil, index, depthPassed, this.stencilFunction, this.stencilCompareMask,
      this.stencilWriteMask, this.stencilMaximum, this.stencilDepthFail, this.stencilDepthPass)) return;
    if (!this.colorWrite) return;
    const destination = this.colorWords[index];
    if (destination === undefined) throw new RangeError("Line fragment outside color buffer");
    const dr = (LITTLE_ENDIAN ? destination & 255 : destination >>> 24) / 255;
    const dg = ((destination >>> (LITTLE_ENDIAN ? 8 : 16)) & 255) / 255;
    const db = ((destination >>> (LITTLE_ENDIAN ? 16 : 8)) & 255) / 255;
    const da = this.alphaBits === 0 ? 1 : (LITTLE_ENDIAN ? destination >>> 24 : destination & 255) / 255;
    const offset = index * 4;
    this.drawPixels[offset] = blend(r, dr, alpha, da, state, false);
    this.drawPixels[offset + 1] = blend(g, dg, alpha, da, state, false);
    this.drawPixels[offset + 2] = blend(b, db, alpha, da, state, false);
    this.drawPixels[offset + 3] = this.alphaBits === 0 ? 255 : blend(alpha, da, alpha, da, state, true);
    if (state.depthWrite) this.depth[index] = depth;
  }

  private triangle(a: ScreenVertex, b: ScreenVertex, c: ScreenVertex, batch: DrawBatch,
    texture: BoundTexture, secondaryTexture: BoundTexture, interpolation: readonly [ScreenVertex, ScreenVertex, ScreenVertex] | null): void {
    let area = edge(a, b, c.x, c.y);
    if (!Number.isFinite(area) || area === 0) return;
    if ((batch.state.cull === "back" && area > 0) || (batch.state.cull === "front" && area < 0)) return;
    if (area < 0) {
      const previous = b;
      b = c;
      c = previous;
      area = -area;
    }
    const minX = Math.max(0, this.viewport.x, Math.ceil(Math.min(a.x, b.x, c.x) - 0.5));
    const maxX = Math.min(this.width - 1, this.viewport.x + this.viewport.width - 1, Math.floor(Math.max(a.x, b.x, c.x) - 0.5));
    const minY = Math.max(0, this.viewport.y, Math.ceil(Math.min(a.y, b.y, c.y) - 0.5));
    const maxY = Math.min(this.height - 1, this.viewport.y + this.viewport.height - 1, Math.floor(Math.max(a.y, b.y, c.y) - 0.5));
    const edgeAInclusive = lowerLeft(b, c);
    const edgeBInclusive = lowerLeft(c, a);
    const edgeCInclusive = lowerLeft(a, b);
    const attributes: readonly [ScreenVertex, ScreenVertex, ScreenVertex] = interpolation ?? [a, b, c];
    const [ia, ib, ic] = attributes;
    const inverseArea = 1 / (interpolation === null ? area : edge(ia, ib, ic.x, ic.y));
    const state = batch.state;
    const depthNear = clamp(state.depthRange[0]), depthFar = clamp(state.depthRange[1]);
    const white = ia.r === ia.inverseW && ia.g === ia.inverseW && ia.b === ia.inverseW && ia.a === ia.inverseW
      && ib.r === ib.inverseW && ib.g === ib.inverseW && ib.b === ib.inverseW && ib.a === ib.inverseW
      && ic.r === ic.inverseW && ic.g === ic.inverseW && ic.b === ic.inverseW && ic.a === ic.inverseW;
    const blending = state.blend.source === "one" && state.blend.destination === "zero" ? "opaque"
      : state.blend.source === "src-alpha" && state.blend.destination === "one-minus-src-alpha" ? "alpha"
      : state.blend.source === "one" && state.blend.destination === "one" ? "add"
        : (state.blend.source === "dst-color" && state.blend.destination === "zero")
          || (state.blend.source === "zero" && state.blend.destination === "src-color") ? "multiply"
          : state.blend.source === "dst-color" && state.blend.destination === "one-minus-dst-alpha" ? "dst-color-inverse-dst-alpha" : "general";
    const depthTest = state.depthTest, depthWrite = state.depthWrite, alphaTest = state.alphaTest;
    const stencilEnabled = this.stencilEnabled, colorWrite = this.colorWrite;
    const textureConsumed = colorWrite || alphaTest !== "none";
    const primaryAlpha = texture.kind !== "incomplete" && textureHasAlpha(texture.internalFormat);
    const secondaryAlpha = secondaryTexture.kind !== "incomplete" && textureHasAlpha(secondaryTexture.internalFormat);
    const secondaryEnvironment = batch.texturing === "pair" ? batch.secondTexture.environment : null;
    const edgeAX = b.y - c.y, edgeAY = c.x - b.x, edgeAC = b.x * c.y - b.y * c.x;
    const edgeBX = c.y - a.y, edgeBY = a.x - c.x, edgeBC = c.x * a.y - c.y * a.x;
    const edgeCX = a.y - b.y, edgeCY = b.x - a.x, edgeCC = a.x * b.y - a.y * b.x;
    const attributeAX = ib.y - ic.y, attributeAY = ic.x - ib.x, attributeAC = ib.x * ic.y - ib.y * ic.x;
    const attributeBX = ic.y - ia.y, attributeBY = ia.x - ic.x, attributeBC = ic.x * ia.y - ic.y * ia.x;
    const attributeCX = ia.y - ib.y, attributeCY = ib.x - ia.x, attributeCC = ia.x * ib.y - ia.y * ib.x;
    const az = ia.z, bz = ib.z, cz = ic.z;
    const constantDepth = az === bz && bz === cz;
    const slope = Math.max(Math.abs(az * attributeAX + bz * attributeBX + cz * attributeCX), Math.abs(az * attributeAY + bz * attributeBY + cz * attributeCY))
      * Math.abs(inverseArea) * 0.5 * Math.abs(depthFar - depthNear);
    // Fixed-point 24-bit depth resolution, matching the SDL GL depth buffer.
    const polygonDepthOffset = state.polygonOffset === null ? 0 : slope * Math.fround(state.polygonOffset.factor) + 2 ** -CPU_OFFSET_DEPTH_BITS * Math.fround(state.polygonOffset.units);
    const planeDepth = clamp(clamp(az * 0.5 + 0.5) * (depthFar - depthNear) + depthNear + polygonDepthOffset);
    const aiw = ia.inverseW, biw = ib.inverseW, ciw = ic.inverseW;
    // Delay UV/W until a common anchor is known. Subtracting U' - s*Q' with
    // large absolute s can invent a nonzero LOD for a constant coordinate.
    const uAnchor = ia.texCoord.x, vAnchor = ia.texCoord.y;
    const au = (ia.texCoord.x - uAnchor) * aiw, bu = (ib.texCoord.x - uAnchor) * biw, cu = (ic.texCoord.x - uAnchor) * ciw;
    const av = (ia.texCoord.y - vAnchor) * aiw, bv = (ib.texCoord.y - vAnchor) * biw, cv = (ic.texCoord.y - vAnchor) * ciw;
    const u2Anchor = ia.texCoord2.x, v2Anchor = ia.texCoord2.y;
    const au2 = (ia.texCoord2.x - u2Anchor) * aiw, bu2 = (ib.texCoord2.x - u2Anchor) * biw, cu2 = (ic.texCoord2.x - u2Anchor) * ciw;
    const av2 = (ia.texCoord2.y - v2Anchor) * aiw, bv2 = (ib.texCoord2.y - v2Anchor) * biw, cv2 = (ic.texCoord2.y - v2Anchor) * ciw;
    const qDx = (aiw * attributeAX + biw * attributeBX + ciw * attributeCX) * inverseArea;
    const qDy = (aiw * attributeAY + biw * attributeBY + ciw * attributeCY) * inverseArea;
    const derivative: TexturePlaneDerivative = {
      uAnchor, vAnchor,
      uDx: (au * attributeAX + bu * attributeBX + cu * attributeCX) * inverseArea,
      vDx: (av * attributeAX + bv * attributeBX + cv * attributeCX) * inverseArea, qDx,
      uDy: (au * attributeAY + bu * attributeBY + cu * attributeCY) * inverseArea,
      vDy: (av * attributeAY + bv * attributeBY + cv * attributeCY) * inverseArea, qDy,
    };
    const secondaryDerivative: TexturePlaneDerivative = {
      uAnchor: u2Anchor, vAnchor: v2Anchor,
      uDx: (au2 * attributeAX + bu2 * attributeBX + cu2 * attributeCX) * inverseArea,
      vDx: (av2 * attributeAX + bv2 * attributeBX + cv2 * attributeCX) * inverseArea, qDx,
      uDy: (au2 * attributeAY + bu2 * attributeBY + cu2 * attributeCY) * inverseArea,
      vDy: (av2 * attributeAY + bv2 * attributeBY + cv2 * attributeCY) * inverseArea, qDy,
    };
    const ar = ia.r, br = ib.r, cr = ic.r, ag = ia.g, bg = ib.g, cg = ic.g;
    const ab = ia.b, bb = ib.b, cb = ic.b, aa = ia.a, ba = ib.a, ca = ic.a;
    const setup: TriangleSetup = {
      minX, maxX, minY, maxY, inverseArea, depthNear,
      depthFar, edgeAX, edgeAY, edgeAC, edgeBX, edgeBY,
      edgeBC, edgeCX, edgeCY, edgeCC, attributeAX, attributeAY,
      attributeAC, attributeBX, attributeBY, attributeBC, attributeCX, attributeCY,
      attributeCC, az, bz, cz, polygonDepthOffset, planeDepth,
      aiw, biw, ciw, au, bu, cu,
      av, bv, cv, au2, bu2, cu2,
      av2, bv2, cv2, ar, br, cr,
      ag, bg, cg, ab, bb, cb,
      aa, ba, ca, edgeAInclusive, edgeBInclusive, edgeCInclusive,
      white, depthWrite, stencilEnabled, colorWrite, textureConsumed, primaryAlpha,
      secondaryAlpha, constantDepth, blending, depthTest, alphaTest, secondaryEnvironment,
      texture, secondaryTexture, derivative, secondaryDerivative,
      lighting: { ...this.fragmentLighting(batch), positions: [ia.worldPosition, ib.worldPosition, ic.worldPosition],
        normals: [ia.worldNormal, ib.worldNormal, ic.worldNormal] },
      width: this.width, height: this.height,
      state: { blend: { ...state.blend } }, alphaBits: this.alphaBits,
      stencilFunction: this.stencilFunction, stencilCompareMask: this.stencilCompareMask, stencilWriteMask: this.stencilWriteMask,
      stencilMaximum: this.stencilMaximum, stencilDepthFail: this.stencilDepthFail, stencilDepthPass: this.stencilDepthPass,
    };
    runTriangleRows(setup, this.framebuffer, this.sampled);
  }
}
