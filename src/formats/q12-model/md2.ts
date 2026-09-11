/* MD2 v8 adapted from quake-2-re-ts/ref_gl/gl_model.ts and Q2
 * qcommon/qfiles.h. Copyright (C) 1997-2001 Id Software, Inc.
 * SPDX-License-Identifier: GPL-2.0-or-later */
import type { Vec2 } from "../../contracts/math.ts";
import type { ModelVertex, PackedAliasVertex, Q2AliasFrame, Q2AliasModel } from "../../contracts/scene.ts";
import { BinaryReader } from "../../core/binary/index.ts";
import { boundsFromPoints, count, fail, index, packedPosition, packedVertex, unionBounds, vector, version } from "./common.ts";
import { decodeAliasNormal } from "./normals.ts";

export interface Md2CommandVertex { readonly texCoord: Vec2; readonly vertex: number; }
export interface Md2Command {
  readonly kind: "strip" | "fan";
  readonly vertices: readonly Md2CommandVertex[];
}

function commands(reader: BinaryReader, vertexCount: number): Md2Command[] {
  const result: Md2Command[] = [];
  if (reader.length === 0) return result;
  while (reader.remaining > 0) {
    const command = reader.i32();
    if (command === 0) return result;
    const count = Math.abs(command);
    if (count < 3) fail(reader, "GL strip/fan must have at least three vertices");
    reader.dataView(reader.offset, count * 12);
    const vertices: Md2CommandVertex[] = [];
    for (let i = 0; i < count; i++) {
      vertices.push({ texCoord: { x: reader.finiteF32(), y: reader.finiteF32() }, vertex: index(reader, reader.i32(), vertexCount, "GL vertex") });
    }
    result.push({ kind: command > 0 ? "strip" : "fan", vertices });
  }
  return fail(reader, "GL command list lacks terminator");
}

/** Float UV bit patterns remain intact in the model's Int32Array. */
export function decodeMd2Commands(model: Q2AliasModel): readonly Md2Command[] {
  const frame = model.frames[0];
  if (frame === undefined) throw new RangeError("MD2 has no frames");
  const data = new Uint8Array(model.glCommands.length * 4);
  const view = new DataView(data.buffer);
  model.glCommands.forEach((word, index) => view.setInt32(index * 4, word, true));
  return commands(new BinaryReader(data, "<md2 GL commands>"), frame.vertices.length);
}

function section(reader: BinaryReader, offset: number, count: number, stride: number, end: number): BinaryReader {
  const size = count * stride;
  if (!Number.isSafeInteger(size) || offset < 68 || offset > end - size) {
    fail(reader, `MD2 section ${offset}+${size} exceeds header/model bounds`);
  }
  return reader.section(offset, size);
}

export function parseMd2(data: Uint8Array, source = "<md2>"): Q2AliasModel {
  const reader = new BinaryReader(data, source);
  reader.expectMagic("IDP2");
  version(reader, 8);
  const skinWidth = count(reader, "skin width");
  const skinHeight = count(reader, "skin height");
  const frameSize = count(reader, "frame size");
  const skinCount = count(reader, "skins", 0);
  const vertexCount = count(reader, "vertices");
  const coordinateCount = count(reader, "texture coordinates");
  const triangleCount = count(reader, "triangles");
  const commandCount = count(reader, "GL command words", 0);
  const frameCount = count(reader, "frames");
  const skinOffset = reader.i32();
  const coordinateOffset = reader.i32();
  const triangleOffset = reader.i32();
  const frameOffset = reader.i32();
  const commandOffset = reader.i32();
  const end = reader.i32();
  if (end < 68 || end > reader.length) fail(reader, `invalid model end ${end}`);
  if (frameSize < 40 + vertexCount * 4) fail(reader, "frame size is smaller than its vertices");
  const skinReader = section(reader, skinOffset, skinCount, 64, end);
  const coordinateReader = section(reader, coordinateOffset, coordinateCount, 4, end);
  const triangleReader = section(reader, triangleOffset, triangleCount, 12, end);
  const frameReader = section(reader, frameOffset, frameCount, frameSize, end);
  const commandReader = section(reader, commandOffset, commandCount, 4, end);
  const skins: string[] = [];
  for (let i = 0; i < skinCount; i++) skins.push(skinReader.fixedByteString(64));
  const textureCoordinates: Vec2[] = [];
  for (let i = 0; i < coordinateCount; i++) textureCoordinates.push({ x: coordinateReader.i16(), y: coordinateReader.i16() });
  const triangles: Q2AliasModel["triangles"][number][] = [];
  for (let i = 0; i < triangleCount; i++) {
    triangles.push({ vertices: [
      index(triangleReader, triangleReader.u16(), vertexCount, "vertex"),
      index(triangleReader, triangleReader.u16(), vertexCount, "vertex"),
      index(triangleReader, triangleReader.u16(), vertexCount, "vertex"),
    ], texCoords: [
      index(triangleReader, triangleReader.u16(), coordinateCount, "texture coordinate"),
      index(triangleReader, triangleReader.u16(), coordinateCount, "texture coordinate"),
      index(triangleReader, triangleReader.u16(), coordinateCount, "texture coordinate"),
    ] });
  }
  const frames: Q2AliasFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frameReader.seek(i * frameSize);
    const scale = vector(frameReader);
    const translation = vector(frameReader);
    const name = frameReader.fixedByteString(16);
    const vertices: ModelVertex[] = [];
    const compressedVertices: PackedAliasVertex[] = [];
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const packed = packedVertex(frameReader);
      index(frameReader, packed.normalIndex, 162, "normal");
      compressedVertices.push(packed);
      vertices.push({ position: packedPosition(packed, scale, translation), normal: decodeAliasNormal(packed.normalIndex) });
    }
    frames.push({ name, scale, translation, vertices, compressedVertices, origin: { x: 0, y: 0, z: 0 }, bounds: boundsFromPoints(vertices.map(vertex => vertex.position)) });
  }
  commands(commandReader, vertexCount);
  commandReader.seek(0);
  const glCommands = new Int32Array(commandCount);
  for (let i = 0; i < commandCount; i++) glCommands[i] = commandReader.i32();
  return { kind: "q2-md2", skinWidth, skinHeight, skins, textureCoordinates, triangles, frames, glCommands, bounds: unionBounds(frames.map(frame => frame.bounds)) };
}
