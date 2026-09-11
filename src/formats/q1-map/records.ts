/* Adapted from quake-1-re-ts/common/bspfile.ts and Ironwail gl_model.c.
 * Copyright (C) 1996-2026 their respective authors. GPL-2.0-or-later. */
import type { Bounds, Vec3, Vec4 } from "../../contracts/math.ts";
import type {
  BspChild, BspEdge, BspFace, BspNode, BspPlane, IndexRange, Q1ClipChild,
  Q1ClipNode, Q1Leaf, Q1TextureInfo, Q1WorldModel,
} from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import type { Q1BspFormat } from "./types.ts";

export function vec3(reader: BinaryReader): Vec3 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32() };
}

export function vec4(reader: BinaryReader): Vec4 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32(), w: reader.finiteF32() };
}

function shortVec3(reader: BinaryReader): Vec3 {
  return { x: reader.i16(), y: reader.i16(), z: reader.i16() };
}

export function bounds(reader: BinaryReader, floats = true): Bounds {
  const read = floats ? vec3 : shortVec3;
  return { min: read(reader), max: read(reader) };
}

export function records<T>(reader: BinaryReader, stride: number, read: (reader: BinaryReader) => T): T[] {
  if (reader.length % stride !== 0) {
    throw new BinaryError(reader.source, 0, `lump length ${reader.length} is not a multiple of ${stride}`);
  }
  const result: T[] = [];
  while (reader.remaining > 0) result.push(read(reader));
  return result;
}

export function index(value: number, count: number, source: string): void {
  if (!Number.isInteger(value) || value < 0 || value >= count) {
    throw new BinaryError(source, 0, `index ${value} outside ${count} records`);
  }
}

export function range(value: IndexRange, count: number, source: string): void {
  if (!Number.isInteger(value.first) || !Number.isInteger(value.count)
    || value.first < 0 || value.count < 0 || value.first > count - value.count) {
    throw new BinaryError(source, 0, `range ${value.first}+${value.count} outside ${count} records`);
  }
}

export function optionalOffset(value: number): number | null {
  return value === -1 || value === 0xffffffff ? null : value;
}

export function readPlanes(reader: BinaryReader): BspPlane[] {
  return records(reader, 20, (r) => {
    const normal = vec3(r);
    const distance = r.finiteF32();
    const type = r.i32();
    const signbits = (normal.x < 0 ? 1 : 0) | (normal.y < 0 ? 2 : 0) | (normal.z < 0 ? 4 : 0);
    return { normal, distance, type, signbits };
  });
}

function nodeChild(reader: BinaryReader, format: Q1BspFormat, nodeCount: number): BspChild {
  if (format === "bsp29") {
    const value = reader.u16();
    return value < nodeCount ? { kind: "node", index: value } : { kind: "leaf", index: 65535 - value };
  }
  const value = reader.i32();
  return value >= 0 ? { kind: "node", index: value } : { kind: "leaf", index: -1 - value };
}

export function readNodes(reader: BinaryReader, format: Q1BspFormat): BspNode[] {
  const stride = format === "bsp29" ? 24 : format === "2psb" ? 32 : 44;
  const count = reader.length / stride;
  return records(reader, stride, (r) => {
    const plane = r.i32();
    const children: [BspChild, BspChild] = [nodeChild(r, format, count), nodeChild(r, format, count)];
    const box = bounds(r, format === "bsp2");
    const faces = format === "bsp29" ? { first: r.u16(), count: r.u16() } : { first: r.u32(), count: r.u32() };
    return { plane, children, bounds: box, faces };
  });
}

function clipChild(reader: BinaryReader, format: Q1BspFormat, count: number): Q1ClipChild {
  let value = format === "bsp29" ? reader.u16() : reader.i32();
  if (format === "bsp29" && value >= count) value -= 65536;
  return value < 0 ? { kind: "contents", value } : { kind: "clipnode", index: value };
}

export function readClipnodes(reader: BinaryReader, format: Q1BspFormat): Q1ClipNode[] {
  const stride = format === "bsp29" ? 8 : 12;
  const count = reader.length / stride;
  return records(reader, stride, (r) => ({
    plane: r.i32(), children: [clipChild(r, format, count), clipChild(r, format, count)],
  }));
}

export function readLeaves(reader: BinaryReader, format: Q1BspFormat): Q1Leaf[] {
  const stride = format === "bsp29" ? 28 : format === "2psb" ? 32 : 44;
  return records(reader, stride, (r) => {
    const contents = r.i32();
    const visibilityOffset = optionalOffset(r.i32());
    const box = bounds(r, format === "bsp2");
    const faces = format === "bsp29" ? { first: r.u16(), count: r.u16() } : { first: r.u32(), count: r.u32() };
    return { contents, visibilityOffset, bounds: box, faces, ambientSound: [r.u8(), r.u8(), r.u8(), r.u8()] };
  });
}

export function readEdges(reader: BinaryReader, format: Q1BspFormat): BspEdge[] {
  return records(reader, format === "bsp29" ? 4 : 8, (r) => ({
    vertices: format === "bsp29" ? [r.u16(), r.u16()] : [r.u32(), r.u32()],
  }));
}

export function readFaces(reader: BinaryReader, format: Q1BspFormat): BspFace[] {
  return records(reader, format === "bsp29" ? 20 : 28, (r) => {
    const plane = format === "bsp29" ? r.u16() : r.u32();
    const side = format === "bsp29" ? r.u16() : r.u32();
    if (side !== 0 && side !== 1) throw new BinaryError(r.source, r.offset, `invalid face side ${side}`);
    const first = r.i32();
    const count = format === "bsp29" ? r.u16() : r.u32();
    const textureInfo = format === "bsp29" ? r.u16() : r.u32();
    const styles = [r.u8(), r.u8(), r.u8(), r.u8()];
    return { plane, back: side === 1, edges: { first, count }, textureInfo, styles, lightingOffset: optionalOffset(r.i32()) };
  });
}

export function readTextureInfo(reader: BinaryReader): Q1TextureInfo[] {
  return records(reader, 40, (r) => ({ projection: { s: vec4(r), t: vec4(r) }, texture: r.i32(), flags: r.i32() }));
}

export function readModels(reader: BinaryReader): Q1WorldModel[] {
  return records(reader, 64, (r) => ({
    bounds: bounds(r), origin: vec3(r), headnodes: [r.i32(), r.i32(), r.i32(), r.i32()],
    visibleLeaves: r.i32(), faces: { first: r.i32(), count: r.i32() },
  }));
}
