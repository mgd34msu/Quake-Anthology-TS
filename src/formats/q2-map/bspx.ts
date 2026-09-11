/* Adapted from quake-2-re-ts/src/qcommon/bspx.ts and q2repro/src/common/bsp.c.
 * Copyright (C) 1997-2001 Id Software, Inc.; 2008 Andrey Nazarov.
 * GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import type { DecoupledLightmap } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";

export interface Q2BspxLump {
  readonly name: string;
  readonly offset: number;
  readonly bytes: Uint8Array;
}

export interface Q2BspxDirectory {
  readonly offset: number;
  readonly lumps: ReadonlyMap<string, Q2BspxLump>;
  readonly diagnostics: readonly string[];
}

export function readQ2Bspx(reader: BinaryReader, endOfLumps: number): Q2BspxDirectory | null {
  const offset = Math.ceil(endOfLumps / 4) * 4;
  if (offset > reader.length - 8) return null;
  const directory = reader.section(offset, reader.length - offset);
  if (directory.fixedByteString(4) !== "BSPX") return null;
  const count = directory.u32();
  const diagnostics: string[] = [];
  const lumps = new Map<string, Q2BspxLump>();
  if (count > directory.remaining / 32) {
    return { offset, lumps, diagnostics: ["Truncated BSPX directory"] };
  }
  for (let index = 0; index < count; index++) {
    const name = directory.fixedByteString(24);
    const fileOffset = directory.u32();
    const length = directory.u32();
    if (length === 0 || fileOffset > reader.length - length || lumps.has(name)) {
      diagnostics.push(`Ignored empty, out-of-bounds, or duplicate BSPX lump ${name}`);
      continue;
    }
    lumps.set(name, { name, offset: fileOffset, bytes: reader.section(fileOffset, length).bytes(length) });
  }
  return { offset, lumps, diagnostics };
}

function vector(reader: BinaryReader): Vec3 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32() };
}

function integerVector(reader: BinaryReader): Vec3 {
  return { x: reader.u32(), y: reader.u32(), z: reader.u32() };
}

export interface Q2DecoupledLightmaps {
  readonly faces: readonly DecoupledLightmap[];
  readonly diagnostics: readonly string[];
}

export interface Q2FaceNormals {
  readonly normals: readonly Vec3[];
  /** Source stores three indices per face corner; q2repro consumes the first. */
  readonly cornerIndices: readonly (readonly [number, number, number])[];
}

export function readQ2FaceNormals(lump: Q2BspxLump, cornerCount: number): Q2FaceNormals {
  const reader = new BinaryReader(lump.bytes, "BSPX FACENORMALS");
  const count = reader.u32();
  reader.records(reader.offset, count * 12 + cornerCount * 12, 12);
  const normals: Vec3[] = [];
  for (let index = 0; index < count; index++) normals.push(vector(reader));
  const cornerIndices: [number, number, number][] = [];
  for (let index = 0; index < cornerCount; index++) {
    const normal = reader.u32();
    if (normal >= count) throw new BinaryError(reader.source, reader.offset - 4, "invalid face normal index");
    cornerIndices.push([normal, reader.u32(), reader.u32()]);
  }
  return { normals, cornerIndices };
}

export function readQ2DecoupledLightmaps(lump: Q2BspxLump, faceCount: number, lightingBytes: number): Q2DecoupledLightmaps {
  const reader = new BinaryReader(lump.bytes, "BSPX DECOUPLED_LM");
  reader.records(0, reader.length, 40);
  if (faceCount > reader.length / 40) throw new BinaryError(reader.source, 0, "fewer lightmaps than faces");
  const faces: DecoupledLightmap[] = [];
  const diagnostics: string[] = [];
  for (let index = 0; index < faceCount; index++) {
    const width = reader.u16();
    const height = reader.u16();
    const rawOffset = reader.u32();
    let lightingOffset: number | null = rawOffset === 0xffffffff ? null : rawOffset;
    if (lightingOffset !== null && lightingOffset >= lightingBytes) {
      diagnostics.push(`DECOUPLED_LM face ${index} has invalid lighting offset ${lightingOffset}`);
      lightingOffset = null;
    }
    const s = vector(reader);
    const x = reader.finiteF32();
    const t = vector(reader);
    const y = reader.finiteF32();
    faces.push({ width, height, lightingOffset, axes: [s, t], offset: { x, y } });
  }
  return { faces, diagnostics };
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
  readonly min: Vec3;
  readonly size: Vec3;
  readonly firstSample: number;
  readonly pointCount: number;
}
export interface Q2Lightgrid {
  readonly spacing: Vec3;
  readonly scale: Vec3;
  readonly min: Vec3;
  readonly size: Vec3;
  readonly styleCount: number;
  readonly root: Q2LightgridChild;
  readonly nodes: readonly Q2LightgridNode[];
  readonly leaves: readonly Q2LightgridLeaf[];
  /** Every grid point has styleCount entries; style 255 means no sample. */
  readonly samples: readonly Q2LightgridSample[];
}

function child(reader: BinaryReader): Q2LightgridChild {
  const value = reader.u32();
  if ((value & 0x40000000) !== 0) return { kind: "occluded" };
  if ((value & 0x80000000) !== 0) return { kind: "leaf", index: value & 0x7fffffff };
  return { kind: "node", index: value };
}

const occludedSample: Q2LightgridSample = { style: 255, rgb: { x: 255, y: 255, z: 255 } };

/** The file header orders spacing, size, minimum, styles, root, and node count. */
export function readQ2Lightgrid(lump: Q2BspxLump): Q2Lightgrid {
  const reader = new BinaryReader(lump.bytes, "BSPX LIGHTGRID_OCTREE");
  const spacing = vector(reader);
  if (spacing.x <= 0 || spacing.y <= 0 || spacing.z <= 0) {
    throw new BinaryError(reader.source, 0, "lightgrid spacing must be positive");
  }
  const scale = { x: 1 / spacing.x, y: 1 / spacing.y, z: 1 / spacing.z };
  const size = integerVector(reader);
  const min = vector(reader);
  const styleCount = reader.u8();
  if (styleCount < 1 || styleCount > 4) throw new BinaryError(reader.source, 36, "invalid lightgrid style count");
  const root = child(reader);
  const nodeCount = reader.u32();
  reader.records(reader.offset, nodeCount * 44, 44);
  const nodes: Q2LightgridNode[] = [];
  for (let index = 0; index < nodeCount; index++) {
    nodes.push({ point: integerVector(reader), children: [child(reader), child(reader), child(reader), child(reader),
      child(reader), child(reader), child(reader), child(reader)] });
  }
  const leafCount = reader.u32();
  if (leafCount > reader.remaining / 24) throw new BinaryError(reader.source, reader.offset - 4, "invalid lightgrid leaf count");
  const leaves: Q2LightgridLeaf[] = [];
  const samples: Q2LightgridSample[] = [];
  for (let index = 0; index < leafCount; index++) {
    const leafMin = integerVector(reader);
    const leafSize = integerVector(reader);
    const pointCount = leafSize.x * leafSize.y * leafSize.z;
    if (!Number.isSafeInteger(pointCount) || pointCount > reader.remaining) {
      throw new BinaryError(reader.source, reader.offset, "invalid lightgrid point count");
    }
    const firstSample = samples.length;
    for (let point = 0; point < pointCount; point++) {
      const count = reader.u8();
      if (count !== 255 && count > styleCount) throw new BinaryError(reader.source, reader.offset - 1, "too many sample styles");
      for (let style = 0; style < styleCount; style++) {
        samples.push(count !== 255 && style < count
          ? { style: reader.u8(), rgb: { x: reader.u8(), y: reader.u8(), z: reader.u8() } }
          : occludedSample);
      }
    }
    leaves.push({ min: leafMin, size: leafSize, firstSample, pointCount });
  }
  const pending = [root];
  const visited = new Set<number>();
  while (pending.length > 0 && leaves.length > 0) {
    const next = pending.pop();
    if (next === undefined || next.kind === "occluded") continue;
    if (next.kind === "leaf") {
      if (next.index >= leaves.length) throw new BinaryError(reader.source, 37, "invalid lightgrid leaf reference");
      continue;
    }
    const node = nodes[next.index];
    if (node === undefined || visited.has(next.index)) throw new BinaryError(reader.source, 37, "invalid or repeated lightgrid node");
    visited.add(next.index);
    pending.push(...node.children);
  }
  return { spacing, scale, min, size, styleCount, root, nodes, leaves, samples };
}

/** point is an integer grid coordinate; callers convert world coordinates using min and scale. */
export function lookupQ2Lightgrid(grid: Q2Lightgrid, point: Vec3): readonly Q2LightgridSample[] | null {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || !Number.isInteger(point.z)) return null;
  let next = grid.root;
  while (next.kind === "node") {
    const node = grid.nodes[next.index];
    if (node === undefined) return null;
    const octant = (point.x >= node.point.x ? 4 : 0) | (point.y >= node.point.y ? 2 : 0) | (point.z >= node.point.z ? 1 : 0);
    const selected = node.children[octant];
    if (selected === undefined) return null;
    next = selected;
  }
  if (next.kind === "occluded") return null;
  const leaf = grid.leaves[next.index];
  if (leaf === undefined) return null;
  const x = point.x - leaf.min.x;
  const y = point.y - leaf.min.y;
  const z = point.z - leaf.min.z;
  if (x < 0 || y < 0 || z < 0 || x >= leaf.size.x || y >= leaf.size.y || z >= leaf.size.z) return null;
  const first = leaf.firstSample + (leaf.size.x * (leaf.size.y * z + y) + x) * grid.styleCount;
  return grid.samples.slice(first, first + grid.styleCount);
}
