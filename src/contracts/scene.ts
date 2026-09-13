/* Decoded scene and collision shapes derived from id Software's Q1 model.h,
 * Q2 qfiles.h/q_shared.h, Q3 qfiles.h, and q2repro MD5/BSPX extensions.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { ActorId, SessionId } from "./identity.ts";
import type { ResolvedResourceReference } from "./content.ts";
import type { Axis, Bounds, Plane, Vec2, Vec3, Vec4 } from "./math.ts";
import type { NumericProfile } from "./numeric.ts";
import type { SourceTime } from "./time.ts";

export interface IndexRange { readonly first: number; readonly count: number; }
export interface BspPlane extends Plane { readonly type: number; readonly signbits: number; }
export type BspChild = { readonly kind: "node"; readonly index: number }
  | { readonly kind: "leaf"; readonly index: number };
export interface BspNode {
  readonly plane: number;
  readonly children: readonly [BspChild, BspChild];
  readonly bounds: Bounds;
  readonly faces: IndexRange;
}
export interface BspEdge { readonly vertices: readonly [number, number]; }
export interface TextureProjection { readonly s: Vec4; readonly t: Vec4; }
export interface BspExtension { readonly name: string; readonly bytes: Uint8Array; }

export type Q1ClipChild = { readonly kind: "clipnode"; readonly index: number }
  | { readonly kind: "contents"; readonly value: number };
export interface Q1ClipNode { readonly plane: number; readonly children: readonly [Q1ClipChild, Q1ClipChild]; }
export interface Q1Hull {
  readonly clipnodes: readonly Q1ClipNode[];
  readonly planes: readonly BspPlane[];
  readonly firstClipnode: number;
  readonly lastClipnode: number;
  readonly clipBounds: Bounds;
}
export interface Q1Leaf {
  readonly contents: number;
  readonly bounds: Bounds;
  readonly faces: IndexRange;
  readonly visibilityOffset: number | null;
  readonly ambientSound: readonly [number, number, number, number];
}
interface Q1MipTextureHeader {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}
export type Q1MipTexture = Q1MipTextureHeader & ({ readonly kind: "external" }
  | { readonly kind: "embedded"; readonly levels: readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array] });
export interface Q1TextureInfo { readonly projection: TextureProjection; readonly texture: number; readonly flags: number; }
export interface BspFace {
  readonly plane: number;
  readonly back: boolean;
  readonly edges: IndexRange;
  readonly textureInfo: number;
  readonly styles: readonly number[];
  readonly lightingOffset: number | null;
}
export type BspLighting = { readonly kind: "luminance8"; readonly samples: Uint8Array }
  | { readonly kind: "rgb8"; readonly samples: Uint8Array; readonly source: "bsp" | "lit" | "bspx" };
export interface DecoupledLightmap {
  readonly width: number;
  readonly height: number;
  readonly lightingOffset: number | null;
  readonly axes: readonly [Vec3, Vec3];
  readonly offset: Vec2;
}
/** BSPX BRUSHLIST is optional source data, never inferred authored geometry. */
export interface Q1BrushListModel {
  readonly model: number;
  readonly brushes: readonly { readonly bounds: Bounds; readonly contents: number; readonly planes: readonly Plane[] }[];
}
export interface Q1WorldModel {
  readonly bounds: Bounds;
  readonly origin: Vec3;
  readonly headnodes: readonly number[];
  readonly visibleLeaves: number;
  readonly faces: IndexRange;
}
export interface Q1WorldGeometry {
  readonly kind: "q1-bsp";
  readonly format: "bsp29" | "bsp2" | "2psb";
  readonly entities: string;
  readonly planes: readonly BspPlane[];
  readonly vertices: readonly Vec3[];
  readonly edges: readonly BspEdge[];
  readonly surfaceEdges: readonly number[];
  readonly nodes: readonly BspNode[];
  readonly leaves: readonly Q1Leaf[];
  readonly leafFaces: readonly number[];
  readonly textures: readonly (Q1MipTexture | null)[];
  readonly textureInfo: readonly Q1TextureInfo[];
  readonly faces: readonly BspFace[];
  readonly models: readonly Q1WorldModel[];
  readonly clipnodes: readonly Q1ClipNode[];
  readonly visibility: Uint8Array;
  readonly lighting: BspLighting;
  readonly decoupledLightmaps: readonly DecoupledLightmap[] | null;
  readonly brushList: readonly Q1BrushListModel[] | null;
  readonly extensions: readonly BspExtension[];
}

export interface Q2SurfaceInfo {
  readonly name: string;
  readonly flags: number;
  readonly value: number;
  readonly material: string;
}
export interface Q2TextureInfo extends Q2SurfaceInfo {
  readonly projection: TextureProjection;
  readonly next: number | null;
}
export interface Q2BrushSide { readonly plane: number; readonly textureInfo: number; }
export interface Q2Brush { readonly sides: IndexRange; readonly contents: number; }
export interface Q2Leaf {
  readonly contents: number;
  readonly mergedContents: number;
  readonly cluster: number;
  readonly area: number;
  readonly bounds: Bounds;
  readonly faces: IndexRange;
  readonly brushes: IndexRange;
}
export interface Q2Area { readonly portals: IndexRange; }
export interface Q2AreaPortal { readonly portal: number; readonly otherArea: number; }
export interface Q2Visibility {
  readonly clusters: readonly { readonly pvsOffset: number; readonly phsOffset: number }[];
  readonly compressed: Uint8Array;
}
export type Q2LightgridChild = { readonly kind: "occluded" }
  | { readonly kind: "leaf"; readonly index: number }
  | { readonly kind: "node"; readonly index: number };
export interface Q2LightgridNode {
  readonly point: Vec3;
  readonly children: readonly [Q2LightgridChild, Q2LightgridChild, Q2LightgridChild, Q2LightgridChild,
    Q2LightgridChild, Q2LightgridChild, Q2LightgridChild, Q2LightgridChild];
}
export interface Q2LightgridSample { readonly style: number; readonly rgb: Vec3; }
export interface Q2LightgridLeaf {
  readonly min: Vec3; readonly size: Vec3; readonly firstSample: number; readonly pointCount: number;
}
export interface Q2Lightgrid {
  readonly spacing: Vec3; readonly scale: Vec3; readonly min: Vec3; readonly size: Vec3;
  readonly styleCount: number; readonly root: Q2LightgridChild;
  readonly nodes: readonly Q2LightgridNode[];
  readonly leaves: readonly Q2LightgridLeaf[];
  /** Every grid point has styleCount entries; style 255 means no sample. */
  readonly samples: readonly Q2LightgridSample[];
}
export interface Q2WorldModel {
  readonly bounds: Bounds;
  readonly origin: Vec3;
  readonly headnode: number;
  readonly faces: IndexRange;
}
export interface Q2WorldGeometry {
  readonly kind: "q2-bsp";
  readonly format: "ibsp38" | "qbsp";
  readonly entities: string;
  readonly planes: readonly BspPlane[];
  readonly vertices: readonly Vec3[];
  readonly edges: readonly BspEdge[];
  readonly surfaceEdges: readonly number[];
  readonly nodes: readonly BspNode[];
  readonly leaves: readonly Q2Leaf[];
  readonly leafFaces: readonly number[];
  readonly leafBrushes: readonly number[];
  readonly textureInfo: readonly Q2TextureInfo[];
  readonly faces: readonly BspFace[];
  readonly brushes: readonly Q2Brush[];
  readonly brushSides: readonly Q2BrushSide[];
  readonly models: readonly Q2WorldModel[];
  readonly areas: readonly Q2Area[];
  readonly areaPortals: readonly Q2AreaPortal[];
  readonly visibility: Q2Visibility | null;
  readonly lighting: BspLighting;
  readonly lightgrid: Q2Lightgrid | null;
  readonly decoupledLightmaps: readonly DecoupledLightmap[] | null;
  readonly extensions: readonly BspExtension[];
}

export interface Q3BspShader { readonly name: string; readonly surfaceFlags: number; readonly contentFlags: number; }
export interface Q3BspVertex {
  readonly position: Vec3;
  readonly texCoord: Vec2;
  readonly lightmapCoord: Vec2;
  readonly normal: Vec3;
  readonly color: Vec4;
}
export interface Q3BspLeaf {
  readonly cluster: number; readonly area: number; readonly bounds: Bounds;
  readonly surfaces: IndexRange; readonly brushes: IndexRange;
}
export interface Q3BspModel { readonly bounds: Bounds; readonly surfaces: IndexRange; readonly brushes: IndexRange; }
export interface Q3BspLightmap {
  readonly image: number;
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  readonly origin: Vec3; readonly vectors: readonly [Vec3, Vec3, Vec3];
}
interface Q3SurfaceFields {
  readonly shader: number; readonly fog: number; readonly vertices: IndexRange;
  readonly indices: IndexRange; readonly lightmap: Q3BspLightmap;
}
export type Q3BspSurface = Q3SurfaceFields & (
  { readonly kind: "planar" } | { readonly kind: "triangles" } | { readonly kind: "flare" }
  | { readonly kind: "patch"; readonly width: number; readonly height: number }
);
export interface Q3BspFog { readonly shader: string; readonly brush: number; readonly visibleSide: number; }
export interface Q3LightGridPoint { readonly ambient: Vec3; readonly directed: Vec3; readonly latLong: Vec2; }
export interface Q3WorldGeometry {
  readonly kind: "q3-bsp";
  readonly format: "ibsp46";
  readonly entities: string;
  readonly shaders: readonly Q3BspShader[];
  readonly planes: readonly BspPlane[];
  readonly nodes: readonly Omit<BspNode, "faces">[];
  readonly leaves: readonly Q3BspLeaf[];
  readonly leafSurfaces: readonly number[];
  readonly leafBrushes: readonly number[];
  readonly models: readonly Q3BspModel[];
  readonly brushes: readonly { readonly sides: IndexRange; readonly shader: number }[];
  readonly brushSides: readonly { readonly plane: number; readonly shader: number }[];
  readonly vertices: readonly Q3BspVertex[];
  readonly indices: readonly number[];
  readonly fogs: readonly Q3BspFog[];
  readonly surfaces: readonly Q3BspSurface[];
  readonly lightmaps: readonly Uint8Array[];
  readonly lightGrid: readonly Q3LightGridPoint[];
  readonly visibility: { readonly clusterCount: number; readonly bytesPerCluster: number; readonly bits: Uint8Array } | null;
}
export type DecodedWorld = Q1WorldGeometry | Q2WorldGeometry | Q3WorldGeometry;

export interface ModelVertex { readonly position: Vec3; readonly normal: Vec3; }
export interface ModelFrame {
  readonly name: string; readonly bounds: Bounds; readonly origin: Vec3;
  readonly vertices: readonly ModelVertex[];
}
export type TimedFrames<T> = { readonly kind: "single"; readonly frame: T }
  /** intervalSeconds is the cumulative endpoint stored by the source format. */
  | { readonly kind: "group"; readonly frames: readonly { readonly intervalSeconds: number; readonly frame: T }[] };
export interface PackedAliasVertex { readonly position: readonly [number, number, number]; readonly normalIndex: number; }
export interface Q1AliasFrame extends ModelFrame {
  readonly compressedBounds: readonly [PackedAliasVertex, PackedAliasVertex];
  readonly compressedVertices: readonly PackedAliasVertex[];
}
export type Q1AliasFrameSet = { readonly kind: "single"; readonly frame: Q1AliasFrame }
  | { readonly kind: "group"; readonly bounds: Bounds; readonly compressedBounds: readonly [PackedAliasVertex, PackedAliasVertex];
      readonly frames: readonly { readonly intervalSeconds: number; readonly frame: Q1AliasFrame }[] };
export interface Q1AliasModel {
  readonly kind: "q1-mdl";
  readonly bounds: Bounds;
  readonly flags: number;
  readonly sync: "synchronized" | "random";
  readonly eyePosition: Vec3;
  readonly scale: Vec3;
  readonly scaleOrigin: Vec3;
  readonly boundingRadius: number;
  readonly size: number;
  readonly skinWidth: number; readonly skinHeight: number;
  readonly skins: readonly TimedFrames<Uint8Array>[];
  readonly textureCoordinates: readonly { readonly onSeam: boolean; readonly s: number; readonly t: number }[];
  readonly triangles: readonly { readonly front: boolean; readonly vertices: readonly [number, number, number] }[];
  readonly frames: readonly Q1AliasFrameSet[];
}
export interface SpriteFrame {
  readonly width: number; readonly height: number;
  readonly originX: number; readonly originY: number;
  readonly pixels: Uint8Array;
}
export interface Q1SpriteModel {
  readonly kind: "q1-spr"; readonly bounds: Bounds; readonly orientation: 0 | 1 | 2 | 3 | 4;
  readonly maxWidth: number; readonly maxHeight: number; readonly boundingRadius: number;
  readonly sync: "synchronized" | "random"; readonly beamLength: number;
  readonly frames: readonly TimedFrames<SpriteFrame>[];
}
export interface Q2SpriteModel {
  readonly bounds: Bounds;
  readonly kind: "q2-sp2"; readonly frames: readonly { readonly image: string; readonly width: number;
    readonly height: number; readonly originX: number; readonly originY: number }[];
}
export type SpriteModel = Q1SpriteModel | Q2SpriteModel;
export interface Q2AliasFrame extends ModelFrame {
  readonly scale: Vec3;
  readonly translation: Vec3;
  readonly compressedVertices: readonly PackedAliasVertex[];
}
export interface Q2AliasModel {
  readonly kind: "q2-md2";
  readonly bounds: Bounds;
  readonly skinWidth: number; readonly skinHeight: number;
  readonly skins: readonly string[];
  readonly textureCoordinates: readonly Vec2[];
  readonly triangles: readonly { readonly vertices: readonly [number, number, number]; readonly texCoords: readonly [number, number, number] }[];
  readonly frames: readonly Q2AliasFrame[];
  readonly glCommands: Int32Array;
}
export interface ModelTag { readonly name: string; readonly origin: Vec3; readonly axis: Axis; }
export interface Q3MeshModel {
  readonly kind: "q3-md3";
  readonly name: string;
  readonly frames: readonly { readonly name: string; readonly bounds: Bounds; readonly localOrigin: Vec3; readonly radius: number }[];
  readonly tags: readonly (readonly ModelTag[])[];
  readonly surfaces: readonly { readonly name: string; readonly shaders: readonly string[];
    readonly textureCoordinates: readonly Vec2[]; readonly indices: readonly number[];
    readonly frames: readonly (readonly ModelVertex[])[] }[];
}
export interface Md5Joint {
  readonly name: string; readonly parent: number; readonly scalePositions: boolean;
}
export interface Md4Bone { readonly matrix: readonly [Vec4, Vec4, Vec4]; }
export interface Md4Frame { readonly bounds: Bounds; readonly localOrigin: Vec3; readonly radius: number; readonly bones: readonly Md4Bone[]; }
export interface Md4Weight { readonly boneIndex: number; readonly boneWeight: number; readonly offset: Vec3; }
export interface Md4Vertex { readonly normal: Vec3; readonly texCoords: Vec2; readonly weights: readonly Md4Weight[]; }
export interface Md4Surface {
  readonly name: string; readonly shader: string;
  readonly vertices: readonly Md4Vertex[];
  readonly triangles: readonly { readonly indices: readonly [number, number, number] }[];
  readonly boneReferences: readonly number[];
}
export interface Md4Model {
  readonly kind: "q3-md4";
  readonly version: number; readonly name: string; readonly numBones: number; readonly byteLength: number;
  readonly frames: readonly Md4Frame[];
  readonly lods: readonly { readonly surfaces: readonly Md4Surface[] }[];
}
export interface SkeletonJointPose { readonly position: Vec3; readonly orientation: Vec4; readonly scale: number; }
export interface Md5Model {
  readonly kind: "md5";
  readonly joints: readonly Md5Joint[];
  readonly frameRate: number;
  readonly frames: readonly { readonly bounds: Bounds; readonly joints: readonly SkeletonJointPose[] }[];
  readonly meshes: readonly { readonly shader: string; readonly vertices: readonly { readonly texCoord: Vec2;
    readonly normal: Vec3; readonly weights: IndexRange }[]; readonly indices: readonly number[];
    readonly weights: readonly { readonly joint: number; readonly bias: number; readonly position: Vec3 }[] }[];
  /** Q2 replacement skins come from the MD2 skin list, independently of mesh.shader. */
  readonly skinSelection: { readonly kind: "mesh-shaders" }
    | { readonly kind: "q1-mdl-replacement"; readonly meshSkinGroups: readonly (readonly TimedFrames<string>[])[];
        readonly flags: number; readonly timing: { readonly kind: "entity-frame" }
          | { readonly kind: "elapsed-time"; readonly frameRate: number } }
    | { readonly kind: "q2-md2-replacement"; readonly skins: readonly string[]; readonly sourceFrameCount: number;
        readonly scaleSource: string | null; readonly diagnostics: readonly string[] };
}
export interface ModelReplacement {
  readonly resource: ResolvedResourceReference;
  readonly model: Md5Model;
}
export type DecodedModel = ((Q1AliasModel | Q2AliasModel) & { readonly replacement?: ModelReplacement | null })
  | SpriteModel | Q3MeshModel | Md4Model | Md5Model
  | { readonly kind: "brush-model"; readonly world: DecodedWorld; readonly model: number };

export type TraceShape = { readonly kind: "point" }
  | { readonly kind: "box"; readonly bounds: Bounds }
  | { readonly kind: "capsule"; readonly bounds: Bounds };
export type TracePolicy = { readonly kind: "q1"; readonly move: "normal" | "no-monsters" | "missile"; readonly hull: number | null }
  | { readonly kind: "q2"; readonly contentsMask: number; readonly leafContents: "stored" | "merged" }
  | { readonly kind: "q3"; readonly contentsMask: number; readonly curves: boolean; readonly playerCurveClip: boolean };
export type QueryTarget = { readonly kind: "world" }
  | { readonly kind: "model"; readonly model: number; readonly origin: Vec3; readonly angles: Vec3 };
export interface TraceQuery {
  readonly start: Vec3; readonly end: Vec3; readonly shape: TraceShape;
  readonly target: QueryTarget;
  readonly policy: TracePolicy;
  readonly numeric: NumericProfile;
  readonly passActor: ActorId | null;
}
export type TraceContact = { readonly kind: "none" } | { readonly kind: "plane"; readonly plane: Plane };
export type TraceHit = { readonly kind: "none" } | { readonly kind: "world"; readonly model: number }
  | { readonly kind: "actor"; readonly actor: ActorId };
interface TraceFields {
  readonly fraction: number; readonly end: Vec3;
  readonly startSolid: boolean; readonly allSolid: boolean;
  readonly contact: TraceContact; readonly hit: TraceHit;
}
export type TraceResult = TraceFields & (
  /** Source ABI fields retain the stored plane even when contact is none. */
  { readonly kind: "q1"; readonly inOpen: boolean; readonly inWater: boolean; readonly sourcePlane: Plane; readonly surfaceFlags?: number }
  | { readonly kind: "q2"; readonly contents: number; readonly surface: Q2SurfaceInfo | null; readonly sourcePlane: BspPlane;
      readonly secondary: { readonly plane: BspPlane; readonly surface: Q2SurfaceInfo | null } | null }
  | { readonly kind: "q3"; readonly contents: number; readonly surfaceFlags: number; readonly sourcePlane: BspPlane }
);
export interface PointContentsQuery {
  readonly point: Vec3; readonly target: QueryTarget; readonly policy: TracePolicy;
  readonly numeric: NumericProfile; readonly passActor: ActorId | null;
}
export type PointContentsResult = { readonly kind: "q1"; readonly contents: number }
  | { readonly kind: "q2"; readonly stored: number; readonly merged: number }
  | { readonly kind: "q3"; readonly contents: number };
export interface LeafQueryResult { readonly leaves: readonly number[]; readonly topnode: number | null; readonly overflow: boolean; }
export interface SceneQueries {
  trace(query: TraceQuery): TraceResult;
  pointContents(query: PointContentsQuery): PointContentsResult;
  boxLeaves(bounds: Bounds, limit: number): LeafQueryResult;
  areasConnected(first: number, second: number): boolean;
  clusterVisible(from: number, to: number, kind: "pvs" | "phs"): boolean;
}

export interface ModelTransform { readonly origin: Vec3; readonly axis: Axis; readonly scale: Vec3; }
export type ModelPose = { readonly kind: "frame"; readonly frame: number; readonly previousFrame: number; readonly backLerp: number }
  | { readonly kind: "skeleton"; readonly joints: readonly SkeletonJointPose[] };
export interface SceneEntity {
  readonly opacity?: number;
  readonly actor: ActorId | null;
  readonly resource: ResolvedResourceReference;
  readonly model: DecodedModel;
  readonly transform: ModelTransform;
  readonly previousOrigin: Vec3;
  readonly pose: ModelPose;
  readonly skin: number;
  readonly color: Vec4;
  readonly shaderTime: SourceTime;
  readonly flags: { readonly kind: "q1" | "q2" | "q3"; readonly bits: number };
  readonly lightingOrigin: Vec3;
  readonly shadowPlane: number;
  readonly attachments: readonly { readonly tag: string; readonly entity: SceneEntity }[];
}
export type SceneLightProfile = { readonly kind: "q1" | "q3" }
  | { readonly kind: "q2"; readonly scale: number;
      readonly cone: { readonly direction: Vec3; readonly cosHalfAngle: number } | null;
      readonly shadow: { readonly kind: "none" } | { readonly kind: "cast"; readonly resolution: number } };
export interface SceneLight {
  readonly origin: Vec3; readonly color: Vec3; readonly radius: number; readonly additive: boolean;
  readonly profile: SceneLightProfile;
}
export type SceneParticle = { readonly kind: "indexed"; readonly origin: Vec3; readonly paletteIndex: number; readonly alpha: number; readonly size: number }
  | { readonly kind: "rgba"; readonly origin: Vec3; readonly color: Vec4; readonly size: number; readonly rotation: number };
export type SceneLightStyle = { readonly kind: "q1"; readonly style: number; readonly value: number }
  | { readonly kind: "q2"; readonly style: number; readonly rgb: Vec3; readonly white: number };
/** A retained presentation sample. Simulation and guest state remain with their owners. */
export interface SceneSnapshot {
  readonly session: SessionId;
  readonly time: SourceTime;
  readonly world: { readonly resource: ResolvedResourceReference; readonly geometry: DecodedWorld } | null;
  readonly entities: readonly SceneEntity[];
  readonly lights: readonly SceneLight[];
  readonly particles: readonly SceneParticle[];
  readonly lightStyles: readonly SceneLightStyle[];
  readonly areaBits: Uint8Array | null;
}
