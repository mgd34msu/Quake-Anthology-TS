// SPDX-License-Identifier: GPL-2.0-or-later
// Client-array submission adapted from Q3 tr_shade.c and the Q3 TypeScript port.
import type { DrawBatch } from "../../contracts/render.ts";

export interface GeometryArrays {
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly coordinates: Float32Array;
  readonly coordinates2: Float32Array;
  readonly worldPositions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

/** Own every native client pointer until the draw disables its arrays. */
export function packGeometry(batch: DrawBatch): GeometryArrays {
  const { vertices, indices } = batch;
  const size = batch.primitive === "lines" ? 2 : 3;
  if (indices.length % size !== 0 || indices.length > 0x7fffffff)
    throw new RangeError("OpenGL primitive index count is invalid");
  if (vertices.length > 0x1fffffff) throw new RangeError("OpenGL vertex allocation is too large");
  if (batch.primitive === "lines" && (!Number.isFinite(Math.fround(batch.lineWidth)) || batch.lineWidth <= 0))
    throw new RangeError("OpenGL line width must be positive and finite");
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length)
      throw new RangeError("OpenGL vertex index is outside its allocation");
  }
  const arrays: GeometryArrays = {
    positions: new Float32Array(vertices.length * 4), colors: new Float32Array(vertices.length * 4),
    coordinates: new Float32Array(vertices.length * 2), coordinates2: new Float32Array(vertices.length * 2),
    worldPositions: new Float32Array(batch.lighting.kind === "vertex" ? 0 : vertices.length * 3),
    normals: new Float32Array(batch.lighting.kind === "q2-world" ? vertices.length * 3 : 0),
    indices: new Uint32Array(indices),
  };
  let four = 0, two = 0;
  for (const vertex of vertices) {
    const { position, color, texCoord } = vertex;
    arrays.positions[four] = position.x; arrays.positions[four + 1] = position.y;
    arrays.positions[four + 2] = position.z; arrays.positions[four + 3] = position.w;
    arrays.colors[four] = color.x; arrays.colors[four + 1] = color.y;
    arrays.colors[four + 2] = color.z; arrays.colors[four + 3] = color.w;
    arrays.coordinates[two] = texCoord.x; arrays.coordinates[two + 1] = texCoord.y;
    four += 4; two += 2;
  }
  if (batch.texturing === "pair") {
    let offset = 0;
    for (const vertex of batch.vertices) {
      arrays.coordinates2[offset] = vertex.texCoord2.x; arrays.coordinates2[offset + 1] = vertex.texCoord2.y;
      offset += 2;
    }
  }
  if (batch.lighting.kind !== "vertex") {
    if (batch.lighting.worldPositions.length !== vertices.length) throw new RangeError("Q2 world positions must match the draw's vertex count");
    let offset = 0;
    for (const position of batch.lighting.worldPositions) {
      arrays.worldPositions[offset] = position.x; arrays.worldPositions[offset + 1] = position.y; arrays.worldPositions[offset + 2] = position.z;
      offset += 3;
    }
    if (batch.lighting.kind === "q2-world") {
      if (batch.lighting.normals.length !== vertices.length) throw new RangeError("Q2 normals must match the draw's vertex count");
      offset = 0;
      for (const normal of batch.lighting.normals) {
        arrays.normals[offset] = normal.x; arrays.normals[offset + 1] = normal.y; arrays.normals[offset + 2] = normal.z;
        offset += 3;
      }
    }
  }
  for (const values of [arrays.positions, arrays.colors, arrays.coordinates, arrays.coordinates2, arrays.worldPositions, arrays.normals]) {
    for (let index = 0; index < values.length; index++) {
      if (!Number.isFinite(values[index])) throw new RangeError("OpenGL attributes must be finite float32 values");
    }
  }
  return arrays;
}
