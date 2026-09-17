/* Quake BSP records, derived from id Software bspfile.h, Ironwail and FTE.
 * Copyright (C) 1996-2026 their respective authors. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import type { Q1WorldGeometry } from "../../contracts/scene.ts";

export type Q1BspFormat = "bsp29" | "bsp2" | "2psb" | "quake64";
export type Q1LumpName = "entities" | "planes" | "textures" | "vertices" | "visibility"
  | "nodes" | "textureInfo" | "faces" | "lighting" | "clipnodes" | "leaves"
  | "leafFaces" | "edges" | "surfaceEdges" | "models";

export interface Q1Lump {
  readonly name: Q1LumpName;
  readonly offset: number;
  readonly length: number;
  readonly data: Uint8Array;
}

export interface Q1BspxLump {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly data: Uint8Array;
}

export interface Q1Entity {
  /** Ordered pairs retain duplicate keys and source spelling. */
  readonly properties: readonly { readonly key: string; readonly value: string }[];
}

export interface Q1FaceNormals {
  readonly vectors: readonly Vec3[];
  /** Normal, tangent and bitangent vector indices for each face corner. */
  readonly indices: readonly (readonly [number, number, number])[];
}

export interface Q1BspxMetadata {
  readonly lightmapShifts: Uint8Array | null;
  readonly lightmapOffsets: readonly (number | null)[] | null;
  readonly lightmapStyles: readonly (readonly number[])[] | null;
  readonly lightmapStyles16: readonly (readonly number[])[] | null;
  readonly rgbLighting: Uint8Array | null;
  readonly hdrLighting: readonly number[] | null;
  readonly lightingDirections: Uint8Array | null;
  readonly vertexNormals: readonly Vec3[] | null;
  readonly faceNormals: Q1FaceNormals | null;
}

export interface Q1Map extends Q1WorldGeometry {
  readonly source: string;
  readonly version: number;
  readonly lumps: readonly Q1Lump[];
  /** Every directory entry is retained, including unknown and empty lumps. */
  readonly bspx: readonly Q1BspxLump[];
  readonly bspxMetadata: Q1BspxMetadata;
  readonly entityList: readonly Q1Entity[];
  readonly monochromeLighting: Uint8Array;
  readonly textureOffsets: readonly (number | null)[];
  readonly mipOffsets: readonly (readonly [number, number, number, number] | null)[];
}

export interface Q1MapOptions {
  readonly source?: string;
  /** Already resolved .ent replacement, preserving mount priority outside the reader. */
  readonly entities?: Uint8Array;
  /** Already resolved QLIT version 1 file. */
  readonly lit?: Uint8Array;
}
