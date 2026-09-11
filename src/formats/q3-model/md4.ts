/*
 * MD4 v1 loading translated from Quake III Arena's qcommon/qfiles.h and
 * renderer/tr_model.c, with bone indexing from renderer/tr_animation.c.
 * Copyright (C) 1999-2005 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import type { Vec3, Vec4 } from "../../core/math.ts";

const MD4_IDENT = 0x34504449;
const HEADER_SIZE = 100;
const SURFACE_SIZE = 168;
const LOD_SIZE = 12;

import type { Md4Bone, Md4Frame, Md4Model, Md4Surface, Md4Vertex, Md4Weight, ModelVertex } from "../../contracts/scene.ts";
import { at } from "./text.ts";
export type { Md4Bone, Md4Frame, Md4Model, Md4Surface, Md4Vertex, Md4Weight } from "../../contracts/scene.ts";
export type Md4Triangle = Md4Surface["triangles"][number];
export type Md4Lod = Md4Model["lods"][number];

export interface DecodedMd4Model extends Md4Model {
  readonly source: string;
  readonly bytes: Uint8Array;
  readonly boneNames: readonly string[] | null;
}

function fail(reader: BinaryReader, offset: number, message: string): never {
  throw new BinaryError(reader.source, offset, message);
}

function range(reader: BinaryReader, offset: number, length: number, start: number, end: number, field: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < start || length < 0 || offset > end - length) {
    fail(reader, field, `MD4 range ${offset}+${length} exceeds ${start}..${end}`);
  }
}

function count(reader: BinaryReader, maximum = 0x7fffffff): number {
  const offset = reader.offset;
  const value = reader.i32();
  if (value < 0 || value > maximum) fail(reader, offset, `MD4 count ${value} outside 0..${maximum}`);
  return value;
}

function index(reader: BinaryReader, maximum: number, label: string): number {
  const offset = reader.offset;
  const value = reader.i32();
  if (value < 0 || value >= maximum) fail(reader, offset, `${label} ${value} outside 0..${maximum - 1}`);
  return value;
}

function cString(reader: BinaryReader): string {
  let result = "";
  const bytes = reader.bytes(64);
  for (const byte of bytes) {
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

function vec3(reader: BinaryReader): Vec3 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32() };
}

function row(reader: BinaryReader): Vec4 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32(), w: reader.finiteF32() };
}

function parseSurface(reader: BinaryReader, sourceOffset: number, lodEnd: number, numBones: number): {
  readonly surface: Md4Surface; readonly nextOffset: number;
} {
  range(reader, sourceOffset, SURFACE_SIZE, HEADER_SIZE, lodEnd, sourceOffset);
  reader.seek(sourceOffset);
  reader.i32(); // R_LoadMD4 replaces the disk ident with SF_MD4 without checking it.
  const name = cString(reader).replace(/[A-Z]/g, letter => letter.toLowerCase());
  const shader = cString(reader);
  reader.i32(); // Replaced by actual shader registration, outside the binary reader.
  const ofsHeader = reader.i32();
  if (sourceOffset + ofsHeader !== 0) fail(reader, sourceOffset + 136, "MD4 surface does not point back to its model header");
  const numVerts = count(reader, 1000);
  const ofsVerts = reader.i32();
  const numTriangles = count(reader, 2000);
  const ofsTriangles = reader.i32();
  const numBoneReferences = count(reader);
  const ofsBoneReferences = reader.i32();
  const ofsEnd = reader.i32();
  range(reader, sourceOffset, ofsEnd, sourceOffset, lodEnd, sourceOffset + 164);
  if (ofsEnd < SURFACE_SIZE) fail(reader, sourceOffset + 164, "MD4 surface end precedes its header");
  const end = sourceOffset + ofsEnd;
  if (numVerts > 0) range(reader, ofsVerts, numVerts * 24, SURFACE_SIZE, ofsEnd, sourceOffset + 144);
  if (numTriangles > 0) range(reader, ofsTriangles, numTriangles * 12, SURFACE_SIZE, ofsEnd, sourceOffset + 152);
  if (numBoneReferences > 0) range(reader, ofsBoneReferences, numBoneReferences * 4, SURFACE_SIZE, ofsEnd, sourceOffset + 160);

  const triangles: Md4Triangle[] = [];
  if (numTriangles > 0) reader.seek(sourceOffset + ofsTriangles);
  for (let triangle = 0; triangle < numTriangles; triangle++) {
    triangles.push({ indices: [index(reader, numVerts, "triangle vertex"), index(reader, numVerts, "triangle vertex"), index(reader, numVerts, "triangle vertex")] });
  }
  const boneReferences: number[] = [];
  if (numBoneReferences > 0) reader.seek(sourceOffset + ofsBoneReferences);
  for (let bone = 0; bone < numBoneReferences; bone++) boneReferences.push(index(reader, numBones, "bone reference"));

  const vertices: Md4Vertex[] = [];
  if (numVerts > 0) reader.seek(sourceOffset + ofsVerts);
  for (let vertex = 0; vertex < numVerts; vertex++) {
    range(reader, reader.offset, 24, sourceOffset + SURFACE_SIZE, end, reader.offset);
    const normal = vec3(reader);
    const texCoords = { x: reader.finiteF32(), y: reader.finiteF32() };
    const numWeights = count(reader);
    range(reader, reader.offset, numWeights * 20, sourceOffset + SURFACE_SIZE, end, reader.offset - 4);
    const weights: Md4Weight[] = [];
    for (let weight = 0; weight < numWeights; weight++) {
      weights.push({ boneIndex: index(reader, numBones, "weight bone"), boneWeight: reader.finiteF32(), offset: vec3(reader) });
    }
    vertices.push({ normal, texCoords, weights });
  }
  return { surface: { name, shader, vertices, triangles, boneReferences }, nextOffset: end };
}

/** Decode owned MD4 records. Bytes after ofsEnd and unused bone-name metadata are ignored by the source loader. */
export function parseMd4(bytes: Uint8Array, source = "<md4>"): DecodedMd4Model {
  const reader = new BinaryReader(bytes, source);
  range(reader, 0, HEADER_SIZE, 0, reader.length, 0);
  const ident = reader.u32();
  if (ident !== MD4_IDENT) fail(reader, 0, "expected IDP4 model magic");
  const version = reader.i32();
  if (version !== 1) fail(reader, 4, `unsupported MD4 version ${version}`);
  const name = cString(reader);
  const numFrames = count(reader);
  if (numFrames === 0) fail(reader, 72, "MD4 model has no frames");
  const numBones = count(reader, 128);
  const ofsBoneNames = reader.i32();
  const ofsFrames = reader.i32();
  const numLODs = count(reader);
  const ofsLODs = reader.i32();
  const ofsEnd = reader.i32();
  range(reader, 0, ofsEnd, 0, reader.length, 96);
  if (ofsEnd < HEADER_SIZE) fail(reader, 96, "MD4 model end precedes its header");
  const frameSize = 40 + numBones * 48;
  range(reader, ofsFrames, numFrames * frameSize, HEADER_SIZE, ofsEnd, 84);
  if (numLODs > 0) range(reader, ofsLODs, numLODs * LOD_SIZE, HEADER_SIZE, ofsEnd, 92);

  reader.seek(ofsFrames);
  const frames: Md4Frame[] = [];
  for (let frame = 0; frame < numFrames; frame++) {
    const bounds = { min: vec3(reader), max: vec3(reader) };
    const localOrigin = vec3(reader);
    const radius = reader.finiteF32();
    const bones: Md4Bone[] = [];
    for (let bone = 0; bone < numBones; bone++) bones.push({ matrix: [row(reader), row(reader), row(reader)] });
    frames.push({ bounds, localOrigin, radius, bones });
  }

  const lods: Md4Lod[] = [];
  let sourceOffset = ofsLODs;
  for (let lod = 0; lod < numLODs; lod++) {
    range(reader, sourceOffset, LOD_SIZE, HEADER_SIZE, ofsEnd, sourceOffset);
    reader.seek(sourceOffset);
    const numSurfaces = count(reader);
    const ofsSurfaces = reader.i32();
    const lodLength = reader.i32();
    range(reader, sourceOffset, lodLength, sourceOffset, ofsEnd, sourceOffset + 8);
    if (lodLength < LOD_SIZE) fail(reader, sourceOffset + 8, "MD4 LOD end precedes its header");
    if (numSurfaces > 0) range(reader, ofsSurfaces, numSurfaces * SURFACE_SIZE, LOD_SIZE, lodLength, sourceOffset + 4);
    const surfaces: Md4Surface[] = [];
    let surfaceOffset = sourceOffset + ofsSurfaces;
    for (let surface = 0; surface < numSurfaces; surface++) {
      const parsed = parseSurface(reader, surfaceOffset, sourceOffset + lodLength, numBones);
      surfaces.push(parsed.surface);
      surfaceOffset = parsed.nextOffset;
    }
    lods.push({ surfaces });
    sourceOffset += lodLength;
  }
  let boneNames: string[] | null = null;
  // The renderer ignores this field. Decode names only when the unused table is present.
  if (ofsBoneNames >= HEADER_SIZE && ofsBoneNames <= ofsEnd - numBones * 64) {
    reader.seek(ofsBoneNames);
    boneNames = Array.from({ length: numBones }, () => cString(reader));
  }
  return { kind: "q3-md4", source, bytes: bytes.slice(0, ofsEnd), boneNames, version, name, numBones, byteLength: ofsEnd, frames, lods };
}

/** RB_SurfaceAnim uses global bone indices, including when boneReferences is sparse. */
export function skinMd4Surface(model: Md4Model, surface: Md4Surface, frame: number, previousFrame = frame, backLerp = 0): readonly ModelVertex[] {
  if (!Number.isInteger(frame) || frame < 0 || !Number.isInteger(previousFrame) || previousFrame < 0 || !Number.isFinite(backLerp)) throw new RangeError("Invalid MD4 frame selection");
  const current = at(model.frames, frame, "MD4 frame");
  const back = frame === previousFrame ? 0 : Math.fround(backLerp);
  const old = back === 0 ? current : at(model.frames, previousFrame, "MD4 previous frame");
  const front = Math.fround(1 - back);
  const f = Math.fround;
  const blend = (a: number, b: number): number => back === 0 ? a : f(f(front * a) + f(back * b));
  const bones = current.bones.map((bone, index): Md4Bone => {
    const before = at(old.bones, index, "MD4 bone");
    const row = (a: Vec4, b: Vec4): Vec4 => ({ x: blend(a.x, b.x), y: blend(a.y, b.y), z: blend(a.z, b.z), w: blend(a.w, b.w) });
    return { matrix: [row(bone.matrix[0], before.matrix[0]), row(bone.matrix[1], before.matrix[1]), row(bone.matrix[2], before.matrix[2])] };
  });
  const dot = (row: Vec4, value: Vec3): number => f(f(f(row.x * value.x) + f(row.y * value.y)) + f(row.z * value.z));
  return surface.vertices.map(vertex => {
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
    for (const weight of vertex.weights) {
      const [a, b, c] = at(bones, weight.boneIndex, "MD4 weight bone").matrix;
      x = f(x + f(weight.boneWeight * f(dot(a, weight.offset) + a.w)));
      y = f(y + f(weight.boneWeight * f(dot(b, weight.offset) + b.w)));
      z = f(z + f(weight.boneWeight * f(dot(c, weight.offset) + c.w)));
      nx = f(nx + f(weight.boneWeight * dot(a, vertex.normal)));
      ny = f(ny + f(weight.boneWeight * dot(b, vertex.normal)));
      nz = f(nz + f(weight.boneWeight * dot(c, vertex.normal)));
    }
    return { position: { x, y, z }, normal: { x: nx, y: ny, z: nz } };
  });
}
