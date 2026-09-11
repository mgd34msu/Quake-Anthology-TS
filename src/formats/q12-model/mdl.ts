/* MDL v6 adapted from quake-1-re-ts/ref_soft/model.ts and Quake's
 * WinQuake/modelgen.h, model.c. Copyright (C) 1996-1997 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later */
import type { Vec3 } from "../../contracts/math.ts";
import type { ModelVertex, PackedAliasVertex, Q1AliasFrame, Q1AliasFrameSet, Q1AliasModel, TimedFrames } from "../../contracts/scene.ts";
import { BinaryReader } from "../../core/binary/index.ts";
import { boundsFromPoints, count, fail, groupType, index, intervals, packedPosition, packedVertex, readTimed, syncType, unionBounds, vector, version } from "./common.ts";
import { decodeAliasNormal } from "./normals.ts";

function frame(reader: BinaryReader, vertexCount: number, scale: Vec3, translate: Vec3): Q1AliasFrame {
  reader.dataView(reader.offset, 24 + vertexCount * 4);
  const compressedBounds: readonly [PackedAliasVertex, PackedAliasVertex] = [packedVertex(reader), packedVertex(reader)];
  const name = reader.fixedByteString(16);
  const compressedVertices: PackedAliasVertex[] = [];
  const vertices: ModelVertex[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const packed = packedVertex(reader);
    index(reader, packed.normalIndex, 162, "normal");
    compressedVertices.push(packed);
    vertices.push({ position: packedPosition(packed, scale, translate), normal: decodeAliasNormal(packed.normalIndex) });
  }
  return {
    name, compressedBounds, compressedVertices, vertices,
    bounds: boundsFromPoints(compressedBounds.map(value => packedPosition(value, scale, translate))),
    origin: { x: 0, y: 0, z: 0 },
  };
}

function frameSet(reader: BinaryReader, vertexCount: number, scale: Vec3, translate: Vec3): Q1AliasFrameSet {
  if (groupType(reader) === "single") return { kind: "single", frame: frame(reader, vertexCount, scale, translate) };
  const frameCount = count(reader, "group frames");
  const compressedBounds: readonly [PackedAliasVertex, PackedAliasVertex] = [packedVertex(reader), packedVertex(reader)];
  const endpoints = intervals(reader, frameCount);
  reader.dataView(reader.offset, frameCount * (24 + vertexCount * 4));
  return {
    kind: "group", compressedBounds,
    bounds: boundsFromPoints(compressedBounds.map(value => packedPosition(value, scale, translate))),
    frames: endpoints.map(intervalSeconds => ({ intervalSeconds, frame: frame(reader, vertexCount, scale, translate) })),
  };
}

export function parseMdl(data: Uint8Array, source = "<mdl>"): Q1AliasModel {
  const reader = new BinaryReader(data, source);
  reader.expectMagic("IDPO");
  version(reader, 6);
  const scale = vector(reader);
  const scaleOrigin = vector(reader);
  const boundingRadius = reader.finiteF32();
  const eyePosition = vector(reader);
  const skinCount = count(reader, "skins");
  const skinWidth = count(reader, "skin width");
  const skinHeight = count(reader, "skin height");
  const vertexCount = count(reader, "vertices");
  const triangleCount = count(reader, "triangles");
  const frameCount = count(reader, "frames");
  const sync = syncType(reader);
  const flags = reader.i32();
  const size = reader.finiteF32();
  if (boundingRadius < 0) fail(reader, "negative model radius");
  reader.dataView(reader.offset, skinCount * (4 + skinWidth * skinHeight));
  const skins: TimedFrames<Uint8Array>[] = [];
  for (let i = 0; i < skinCount; i++) skins.push(readTimed(reader, () => reader.bytes(skinWidth * skinHeight)));

  reader.dataView(reader.offset, vertexCount * 12 + triangleCount * 16);
  const textureCoordinates: Q1AliasModel["textureCoordinates"][number][] = [];
  for (let i = 0; i < vertexCount; i++) {
    textureCoordinates.push({ onSeam: reader.i32() !== 0, s: reader.i32(), t: reader.i32() });
  }
  const triangles: Q1AliasModel["triangles"][number][] = [];
  for (let i = 0; i < triangleCount; i++) {
    const front = reader.i32() !== 0;
    triangles.push({ front, vertices: [
      index(reader, reader.i32(), vertexCount, "vertex"),
      index(reader, reader.i32(), vertexCount, "vertex"),
      index(reader, reader.i32(), vertexCount, "vertex"),
    ] });
  }
  reader.dataView(reader.offset, frameCount * (4 + 24 + vertexCount * 4));
  const frames: Q1AliasFrameSet[] = [];
  for (let i = 0; i < frameCount; i++) frames.push(frameSet(reader, vertexCount, scale, scaleOrigin));
  return {
    kind: "q1-mdl", scale, scaleOrigin, boundingRadius, eyePosition, size,
    skinWidth, skinHeight, sync, flags, skins, textureCoordinates, triangles, frames,
    bounds: unionBounds(frames.map(value => value.kind === "single" ? value.frame.bounds : value.bounds)),
  };
}
