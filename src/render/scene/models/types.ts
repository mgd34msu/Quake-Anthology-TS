/* Model submission adapted from Q1 r_alias/r_sprite, Q2 gl_mesh and Q3 tr_mesh.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Plane, Vec2, Vec3, Vec4 } from "../../../contracts/math.ts";
import type { DrawBatch, RenderImage, RenderState, SceneCamera } from "../../../contracts/render.ts";
import type { ModelTransform, Q3MeshModel, SceneEntity } from "../../../contracts/scene.ts";
import type { MaterialGeometry } from "../../../materials/geometry.ts";

export type ModelImageSelection = { readonly kind: "external"; readonly name: string }
  | { readonly kind: "indexed"; readonly name: string; readonly width: number; readonly height: number;
      readonly pixels: Uint8Array; readonly transparentIndex: number | null; readonly fullbright: boolean }
  | { readonly kind: "white" }
  | { readonly kind: "default"; readonly reason: "missing-skin-surface" | "no-skin" };

/** Source renderer fields supplement the family-independent SceneEntity. */
export interface ModelSourceOptions {
  readonly syncBase?: number;
  readonly spriteRoll?: number;
  readonly customShader?: string | null;
  readonly customSkin?: readonly { readonly name: string; readonly shader: string }[] | null;
  readonly q3Lods?: readonly (Q3MeshModel | null)[];
  readonly lodScale?: number;
  readonly lodBias?: number;
  readonly nonNormalizedAxes?: boolean;
  readonly noWorldModel?: boolean;
  readonly shaderTexCoord?: Vec2;
  readonly leftHand?: 0 | 1 | 2;
  readonly infrared?: boolean;
  readonly viewModel?: boolean;
  readonly player?: boolean;
  readonly overbrightModels?: boolean;
  readonly playerColors?: { readonly top: number; readonly bottom: number };
}

export interface ModelPreparationContext {
  readonly camera: SceneCamera;
  readonly timeSeconds: number;
  readonly frustum?: readonly Plane[];
  readonly noCull?: boolean;
  options?(entity: SceneEntity): ModelSourceOptions;
  /** Normalized alias-light modulation; Q3 keeps local normals for its stages. */
  lightVertex?(entity: SceneEntity, normal: Vec3, position: Vec3): Vec3;
  /** A resource/lighting join may supply the complete source vertex modulation. */
  finalVertexLight?(entity: SceneEntity, normal: Vec3, position: Vec3, corner: number, options: ModelSourceOptions): Vec3;
  /** Palette byte colors used by Q2 RF_BEAM, independent of a model skin. */
  paletteColor?(entity: SceneEntity, index: number): Vec3;
}

export interface PreparedModelSurface {
  readonly options: ModelSourceOptions;
  readonly name: string;
  readonly entity: SceneEntity;
  readonly transform: ModelTransform;
  readonly image: ModelImageSelection;
  readonly localGeometry: MaterialGeometry;
  readonly geometry: MaterialGeometry;
  readonly depthRange: RenderState["depthRange"];
  readonly cull: RenderState["cull"];
  readonly alphaTest: RenderState["alphaTest"];
  readonly translucent: boolean;
  readonly unlit: boolean;
  readonly mirrorWeapon: boolean;
}

export interface PreparedModelEntity {
  readonly entity: SceneEntity;
  readonly frame: number;
  readonly previousFrame: number;
  readonly frameFallback: boolean;
  readonly lod: number;
  readonly bounds: Bounds | null;
  readonly cull: "in" | "clip" | "out";
  readonly personalModel: boolean;
  readonly surfaces: readonly PreparedModelSurface[];
  readonly attachments: readonly PreparedModelEntity[];
  readonly missingAttachments: readonly string[];
  /** Q1 model flags drive client trails/rotation; retain them for the effect owner. */
  readonly modelEffectFlags: number;
}

export interface ModelBatchContext {
  draw(surface: PreparedModelSurface): readonly DrawBatch[];
}

export function modelImage(selection: Extract<ModelImageSelection, { readonly kind: "indexed" }>,
  palette: Extract<RenderImage, { readonly kind: "indexed8" }>["palette"], translation: Uint8Array | null = null): RenderImage {
  return { kind: "indexed8", levels: [{ width: selection.width, height: selection.height, pixels: selection.pixels }], palette,
    transparency: selection.transparentIndex === null ? { kind: "opaque" } : { kind: "index", index: selection.transparentIndex },
    fullbright: selection.fullbright ? { first: 224, last: selection.transparentIndex === 255 ? 254 : 255 } : null, translation };
}

export function byteColor(color: Vec4): Vec4 {
  return { x: color.x * 255, y: color.y * 255, z: color.z * 255, w: color.w * 255 };
}
