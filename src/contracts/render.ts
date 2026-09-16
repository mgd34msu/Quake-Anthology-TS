/* Ordered backend operations and shader data adapted from Q3 tr_cmds.c,
 * tr_backend.c/tr_shader.c, Q1 palettes, and Q2 ref.h/BSPX lighting.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ResolvedResourceReference } from "./content.ts";
import type { SeatId, SessionId } from "./identity.ts";
import type { Axis, Mat4, Plane, Vec2, Vec3, Vec4 } from "./math.ts";
import type { DecoupledLightmap } from "./scene.ts";
import type { SourceTime } from "./time.ts";

export interface ImageLevel { readonly width: number; readonly height: number; readonly pixels: Uint8Array; }
export interface DepthImageLevel { readonly width: number; readonly height: number; readonly pixels: Float32Array; }
export interface Palette {
  readonly colors: Uint8Array;
  readonly source: ResolvedResourceReference;
}
export type PaletteTransparency = { readonly kind: "opaque" }
  | { readonly kind: "index"; readonly index: number }
  | { readonly kind: "q1-fence"; readonly index: 255 };
export type RenderImage = {
  readonly kind: "indexed8";
  readonly levels: readonly [ImageLevel, ...ImageLevel[]];
  readonly palette: Palette;
  readonly transparency: PaletteTransparency;
  readonly fullbright: { readonly first: number; readonly last: number } | null;
  readonly translation: Uint8Array | null;
} | {
  readonly kind: "rgba8";
  readonly levels: readonly [ImageLevel, ...ImageLevel[]];
  readonly borderColor: Vec4;
} | {
  readonly kind: "depth32f";
  readonly levels: readonly [DepthImageLevel, ...DepthImageLevel[]];
};
export type TextureFilter = "nearest" | "linear" | "nearest-mipmap-nearest"
  | "linear-mipmap-nearest" | "nearest-mipmap-linear" | "linear-mipmap-linear";
export interface TextureSampling { readonly wrap: "repeat" | "clamp"; readonly filter: TextureFilter; }
export interface RendererResourceOwner {
  readonly identity: symbol;
  readonly session: SessionId;
  readonly generation: number;
}
export interface RendererImage {
  readonly owner: RendererResourceOwner;
  readonly ordinal: number;
  readonly source: { readonly kind: "resource"; readonly resource: ResolvedResourceReference }
    | { readonly kind: "generated"; readonly name: string };
  readonly width: number;
  readonly height: number;
}
export type ImageResourceOperation = {
  readonly kind: "create-image"; readonly image: RendererImage;
  readonly content: RenderImage; readonly sampling: TextureSampling;
} | {
  readonly kind: "update-image"; readonly image: RendererImage;
  /** Pixel encoding and palette remain those selected by create-image. */
  readonly level: number; readonly content: ImageLevel | DepthImageLevel;
} | { readonly kind: "release-image"; readonly image: RendererImage }
  | { readonly kind: "texture-mode"; readonly filter: TextureFilter };

export type BlendFactor = "zero" | "one" | "src-color" | "one-minus-src-color"
  | "dst-color" | "one-minus-dst-color" | "src-alpha" | "one-minus-src-alpha"
  | "dst-alpha" | "one-minus-dst-alpha" | "src-alpha-saturate";
export interface RenderState {
  readonly blend: { readonly source: BlendFactor; readonly destination: BlendFactor };
  readonly depthTest: "less-equal" | "equal" | "always";
  readonly depthWrite: boolean;
  readonly alphaTest: "none" | "gt0" | "lt128" | "ge128";
  readonly cull: "none" | "back" | "front";
  readonly depthRange: readonly [number, number];
  readonly polygonOffset: { readonly factor: number; readonly units: number } | null;
}
export interface Waveform {
  readonly kind: "none" | "sin" | "square" | "triangle" | "sawtooth" | "inversesawtooth" | "noise";
  readonly base: number; readonly amplitude: number; readonly phase: number; readonly frequency: number;
}
export type ColorGenerator = {
  readonly kind: "identity" | "identitylighting" | "entity" | "oneminusentity" | "vertex"
    | "exactvertex" | "lightingdiffuse" | "oneminusvertex";
} | { readonly kind: "const"; readonly color: Vec3 } | { readonly kind: "wave"; readonly wave: Waveform };
export type AlphaGenerator = {
  readonly kind: "identity" | "entity" | "oneminusentity" | "vertex" | "lightingspecular" | "oneminusvertex";
} | { readonly kind: "const"; readonly alpha: number } | { readonly kind: "wave"; readonly wave: Waveform }
  | { readonly kind: "portal"; readonly range: number };
export type TexCoordGenerator = { readonly kind: "texture" | "lightmap" | "environment" }
  | { readonly kind: "vector"; readonly s: Vec3; readonly t: Vec3 };
export type TexCoordModifier = { readonly kind: "scale" | "scroll"; readonly amount: Vec2 }
  | { readonly kind: "stretch" | "turb"; readonly wave: Waveform }
  | { readonly kind: "rotate"; readonly degreesPerSecond: number }
  | { readonly kind: "transform"; readonly matrix: readonly [number, number, number, number]; readonly translation: Vec2 }
  | { readonly kind: "entitytranslate" | "none" };
export type ShaderMap = { readonly kind: "image"; readonly name: string; readonly clamp: boolean }
  | { readonly kind: "lightmap" | "whiteimage" | "none" }
  | { readonly kind: "animation"; readonly frequency: number; readonly frames: readonly string[] }
  | { readonly kind: "video"; readonly name: string };
export interface ShaderStage {
  readonly map: ShaderMap;
  readonly blend: RenderState["blend"];
  readonly depthTest: RenderState["depthTest"];
  readonly depthWrite: boolean;
  readonly alphaTest: RenderState["alphaTest"];
  readonly detail: boolean;
  readonly color: ColorGenerator;
  readonly alpha: AlphaGenerator;
  readonly coordinates: TexCoordGenerator;
  readonly modifiers: readonly TexCoordModifier[];
  /** Original parser fields survive repeated directives and FinishShader changes. */
  readonly sourceState: {
    readonly active: boolean; readonly stateBits: number; readonly rgbGen: number; readonly alphaGen: number;
    readonly tcGen: number; readonly rgbWave: Waveform; readonly alphaWave: Waveform;
    readonly isLightmap: boolean; readonly vertexLightmap: boolean;
  };
}
export type VertexDeformation = { readonly kind: "projectionshadow" | "autosprite" | "autosprite2" | "none" }
  | { readonly kind: "text"; readonly index: number }
  | { readonly kind: "wave"; readonly spread: number; readonly wave: Waveform }
  | { readonly kind: "normal"; readonly amplitude: number; readonly frequency: number }
  | { readonly kind: "move"; readonly direction: Vec3; readonly wave: Waveform }
  | { readonly kind: "bulge"; readonly width: number; readonly height: number; readonly speed: number };
export type SurfaceLighting = { readonly kind: "unlit" }
  | { readonly kind: "vertex" }
  | { readonly kind: "lightmap"; readonly image: RendererImage; readonly styles: readonly number[] }
  | { readonly kind: "decoupled-lightmap"; readonly image: RendererImage; readonly styles: readonly number[]; readonly mapping: DecoupledLightmap };
export type RenderMaterial = {
  readonly kind: "q1"; readonly name: string; readonly texture: RendererImage;
  readonly lighting: SurfaceLighting;
  readonly animation: readonly { readonly image: RendererImage; readonly startTenths: number; readonly endTenths: number }[];
  readonly alternateAnimation: readonly { readonly image: RendererImage; readonly startTenths: number; readonly endTenths: number }[];
  readonly surface: "ordinary" | "sky" | "water" | "slime" | "lava" | "teleport" | "fence";
  readonly alpha: number;
} | {
  readonly kind: "q2"; readonly name: string; readonly frames: readonly RendererImage[];
  readonly lighting: SurfaceLighting; readonly surfaceFlags: number; readonly material: string;
  readonly flowing: boolean; readonly warp: boolean; readonly alpha: number;
} | {
  readonly kind: "q3"; readonly name: string; readonly stages: readonly ShaderStage[];
  readonly deformations: readonly VertexDeformation[];
  readonly surfaceParameters: readonly string[];
  readonly sort: number | null;
  readonly cull: RenderState["cull"];
  readonly polygonOffset: boolean;
  readonly noMipmaps: boolean; readonly noPicmip: boolean; readonly entityMergeable: boolean;
  readonly portalRange: number; readonly clampTime: number;
  readonly sky: { readonly outerBox: string | null; readonly innerBox: string | null; readonly cloudHeight: number } | null;
  readonly fog: { readonly color: Vec3; readonly depthForOpaque: number } | null;
  readonly sun: { readonly color: Vec3; readonly intensity: number; readonly azimuth: number; readonly elevation: number } | null;
};

export interface RenderVertex { readonly position: Vec4; readonly texCoord: Vec2; readonly color: Vec4; }
export interface MultitextureVertex extends RenderVertex { readonly texCoord2: Vec2; }
export interface DynamicImageSource {
  resolve(apply: (operation: ImageResourceOperation) => void): RendererImage;
}
export type TextureBinding = { readonly kind: "dynamic-image"; readonly source: DynamicImageSource }
  | { readonly kind: "bind-image"; readonly image: RendererImage }
  | { readonly kind: "retain-current-texture" };
export interface TextureBundle { readonly binding: TextureBinding; readonly environment: "modulate" | "add" | "replace"; }
/** Atlas rectangles are normalized xy origins and zw sizes, as in Q2 gl_shader.ts. */
export type Q2ShadowProjection = { readonly kind: "none" }
  | { readonly kind: "cone"; readonly matrix: Mat4; readonly atlasRect: Vec4 }
  | { readonly kind: "point"; readonly atlasRect: Vec4 };
export interface Q2ShadowAtlas {
  readonly image: RendererImage;
  readonly texelSize: number;
  readonly nearPlane: number;
}
export interface Q2FragmentLight {
  readonly origin: Vec3;
  readonly radius: number;
  /** A negative red channel retains Q2's fullbright sentinel. */
  readonly color: Vec3;
  readonly scale: number;
  readonly cone: { readonly direction: Vec3; readonly cosHalfAngle: number } | null;
  readonly shadow: Q2ShadowProjection;
}
export interface Q2ModelShadowLight {
  readonly origin: Vec3;
  readonly radius: number;
  readonly fraction: Vec3;
  readonly shadow: Q2ShadowProjection;
}
/** World-space arrays use the same vertex indices as the batch and survive clipping. */
export type BatchLighting = { readonly kind: "vertex" }
  | ({ readonly kind: "q2-world"; readonly worldPositions: readonly Vec3[]; readonly normals: readonly Vec3[]; readonly atlas: Q2ShadowAtlas | null }
    & ({ readonly pass: "lightmap" | "texture" | "material-lightmap"; readonly lights: readonly Q2FragmentLight[] }
      | { readonly pass: "model"; readonly lights: readonly (Q2FragmentLight & { readonly fraction: Vec3 })[]; readonly shadeScale: number | null }))
  | { readonly kind: "q2-model-shadow"; readonly worldPositions: readonly Vec3[];
      readonly lights: readonly Q2ModelShadowLight[]; readonly shadeScale: number; readonly atlas: Q2ShadowAtlas };
interface BatchData {
  readonly textureEffect?: "luminance-alpha";
  readonly indices: readonly number[]; readonly texture: TextureBinding; readonly state: RenderState;
  readonly lighting: BatchLighting;
}
type BatchPrimitive = { readonly primitive: "triangles" } | { readonly primitive: "lines"; readonly lineWidth: number };
/** Lightstyles, palettes and shader time are resolved before either backend draws. */
export type DrawBatch = BatchData & BatchPrimitive & (
  { readonly texturing: "single"; readonly vertices: readonly RenderVertex[] }
  | { readonly texturing: "pair"; readonly vertices: readonly MultitextureVertex[]; readonly secondTexture: TextureBundle }
);
export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface TextureRect { readonly s1: number; readonly t1: number; readonly s2: number; readonly t2: number; }
export interface SceneCamera {
  readonly origin: Vec3; readonly axis: Axis; readonly projection: Mat4;
  readonly viewport: Rect;
  readonly clip: { readonly kind: "none" } | { readonly kind: "portal"; readonly plane: Plane; readonly mirror: boolean };
}
export type SceneFog = { readonly kind: "none" }
  | { readonly kind: "q2"; readonly color: Vec3; readonly density: number; readonly skyFactor: number;
      readonly height: { readonly start: { readonly color: Vec3; readonly distance: number };
        readonly end: { readonly color: Vec3; readonly distance: number }; readonly density: number; readonly falloff: number } }
  | { readonly kind: "q3"; readonly color: Vec3; readonly depthForOpaque: number; readonly plane: Plane | null };
export interface DepthAtlasDraw {
  readonly positions: readonly Vec4[];
  readonly indices: readonly number[];
  readonly cull: RenderState["cull"];
  readonly polygonOffset: RenderState["polygonOffset"];
}
export interface DepthAtlasPass {
  readonly viewport: Rect;
  readonly clearDepth: number | null;
  readonly draws: readonly DepthAtlasDraw[];
}
/** Q2 rerelease fog runs once after scene lighting and transparency, before screen blends.
 * The camera uses the source symmetric perspective projection. Far depth includes
 * the source 1e-6 sky threshold; skyDrawn distinguishes a sky view from an empty view. */
export interface Q2FogOperation {
  readonly kind: "q2-fog";
  readonly camera: SceneCamera;
  readonly fog: Extract<SceneFog, { readonly kind: "q2" }>;
  readonly farDepth: number;
  readonly skyDrawn: boolean;
}
export type RenderOperation = { readonly kind: "draw"; readonly batches: readonly DrawBatch[] }
  /** Interpolates the complete ordered object against the current backdrop once. */
  | { readonly kind: "object-opacity"; readonly opacity: number; readonly batches: readonly DrawBatch[] }
  | Q2FogOperation
  /** Binds a depth32f image, executes the passes, then restores the previous target and viewport. */
  | { readonly kind: "depth-atlas"; readonly image: RendererImage; readonly passes: readonly DepthAtlasPass[] }
  | { readonly kind: "depth-range"; readonly range: readonly [number, number] }
  | { readonly kind: "cull"; readonly cull: RenderState["cull"] }
  | { readonly kind: "polygon-offset"; readonly value: RenderState["polygonOffset"] }
  | { readonly kind: "disable-portal-clip" }
  | { readonly kind: "sky-side"; readonly image: RendererImage; readonly color: Vec4;
      readonly strips: readonly (readonly Pick<RenderVertex, "position" | "texCoord">[])[] }
  | { readonly kind: "shadow-volume"; readonly positions: readonly Vec4[]; readonly indices: readonly number[]; readonly mirror: boolean; readonly whiteImage: RendererImage }
  | { readonly kind: "shadow-finish"; readonly positions: readonly [Vec4, Vec4, Vec4, Vec4]; readonly whiteImage: RendererImage };
export interface RenderViewState {
  readonly viewport: Rect;
  readonly clear: { readonly depth: number; readonly color: Vec4 | null; readonly stencil: boolean } | null;
  readonly clipPlane: Vec4 | null;
}
export interface RenderView extends RenderViewState {
  readonly target: { readonly kind: "seat"; readonly seat: SeatId } | { readonly kind: "preview"; readonly id: string };
  readonly time: SourceTime;
  readonly beforeView: readonly RenderOperation[];
  readonly operations: readonly RenderOperation[];
}
export type RendererDrawBuffer = "front" | "back" | "back-left" | "back-right";
export type RenderCommand = { readonly kind: "draw-buffer"; readonly buffer: RendererDrawBuffer; readonly clear: boolean }
  | { readonly kind: "image-resource"; readonly operation: ImageResourceOperation }
  | { readonly kind: "set-color"; readonly color: Vec4 }
  | { readonly kind: "stretch-pic"; readonly rect: Rect; readonly uv: TextureRect; readonly image: RendererImage }
  | { readonly kind: "view"; readonly view: RenderView }
  | { readonly kind: "swap-buffers" };
export interface RenderFrame {
  readonly owner: RendererResourceOwner;
  readonly sequence: number;
  readonly commands: readonly RenderCommand[];
}
export interface PreparedBackendDraw {
  begin(): undefined;
  applyTexture(unit: number, operation: TextureBinding): undefined;
  draw(): undefined;
  cleanup(): undefined;
}
/** CPU and GL implementations consume the same ordered operations synchronously. */
export interface RendererBackend {
  readonly owner: RendererResourceOwner;
  readonly width: number;
  readonly height: number;
  readonly stencilBits: number;
  applyImageResource(operation: ImageResourceOperation): undefined;
  selectDrawBuffer(buffer: RendererDrawBuffer, clear: boolean): undefined;
  setOverdrawMeasurement(enabled: boolean): undefined;
  readStencilOverdraw(destination: Uint8Array): undefined;
  readDepthPixel(windowX: number, windowY: number): number;
  beginView(view: RenderViewState): undefined;
  /** Partial opacity commits color only; zero skips draw, one preserves direct rendering. */
  withObjectOpacity(opacity: number, draw: () => undefined): undefined;
  drawImmediate(operation: Exclude<RenderOperation, { readonly kind: "draw" | "object-opacity" }>): undefined;
  prepareGeometry(batch: DrawBatch): PreparedBackendDraw;
  clearColorBuffer(): undefined;
  drawShowImage(image: RendererImage, rect: Rect, proportional: boolean): undefined;
  finish(): undefined;
  close(): undefined;
}
