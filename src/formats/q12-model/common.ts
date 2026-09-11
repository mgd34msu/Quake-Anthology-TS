/* Adapted from Q1 model.c, Q2 gl_model.c and quake-3-ts assets/md3.ts.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import type { PackedAliasVertex, TimedFrames } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";

export function fail(reader: BinaryReader, message: string): never {
  throw new BinaryError(reader.source, reader.offset, message);
}

export function count(reader: BinaryReader, label: string, minimum = 1): number {
  const value = reader.i32();
  if (value < minimum) fail(reader, `${label} ${value} is below ${minimum}`);
  return value;
}

export function version(reader: BinaryReader, expected: number): void {
  const actual = reader.i32();
  if (actual !== expected) fail(reader, `version ${actual}, expected ${expected}`);
}

export function vector(reader: BinaryReader): Vec3 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32() };
}

export function syncType(reader: BinaryReader): "synchronized" | "random" {
  const value = reader.i32();
  if (value === 0) return "synchronized";
  if (value === 1) return "random";
  return fail(reader, `invalid synchronization type ${value}`);
}

export function groupType(reader: BinaryReader): "single" | "group" {
  const value = reader.i32();
  if (value === 0) return "single";
  if (value === 1) return "group";
  return fail(reader, `invalid frame/skin type ${value}`);
}

export function intervals(reader: BinaryReader, frameCount: number): number[] {
  reader.dataView(reader.offset, frameCount * 4);
  const result: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const endpoint = reader.finiteF32();
    if (endpoint <= 0) fail(reader, "group interval must be positive");
    result.push(endpoint);
  }
  return result;
}

export function readTimed<T>(reader: BinaryReader, readFrame: () => T): TimedFrames<T> {
  if (groupType(reader) === "single") return { kind: "single", frame: readFrame() };
  const endpoints = intervals(reader, count(reader, "group frames"));
  return { kind: "group", frames: endpoints.map(intervalSeconds => ({ intervalSeconds, frame: readFrame() })) };
}

export function expandPosition(position: Vec3, scale: Vec3, translate: Vec3): Vec3 {
  return {
    x: Math.fround(Math.fround(position.x * scale.x) + translate.x),
    y: Math.fround(Math.fround(position.y * scale.y) + translate.y),
    z: Math.fround(Math.fround(position.z * scale.z) + translate.z),
  };
}

export function packedVertex(reader: BinaryReader): PackedAliasVertex {
  return { position: [reader.u8(), reader.u8(), reader.u8()], normalIndex: reader.u8() };
}

export function packedPosition(vertex: PackedAliasVertex, scale: Vec3, translate: Vec3): Vec3 {
  return expandPosition({ x: vertex.position[0], y: vertex.position[1], z: vertex.position[2] }, scale, translate);
}

export function boundsFromPoints(points: readonly Vec3[]): Bounds {
  const first = points[0];
  if (first === undefined) throw new RangeError("Cannot bound an empty model");
  let minX = first.x, minY = first.y, minZ = first.z;
  let maxX = first.x, maxY = first.y, maxZ = first.z;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); maxZ = Math.max(maxZ, point.z);
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

export function unionBounds(bounds: readonly Bounds[]): Bounds {
  return boundsFromPoints(bounds.flatMap(value => [value.min, value.max]));
}

export function index(reader: BinaryReader, value: number, limit: number, label: string): number {
  if (value < 0 || value >= limit) fail(reader, `${label} index ${value} outside 0..${limit - 1}`);
  return value;
}

export function at<T>(values: readonly T[], offset: number, label: string): T {
  const value = values[offset];
  if (value === undefined) throw new RangeError(`Missing ${label} ${offset}`);
  return value;
}
