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

type AllocateGeometry = (vertices: number, indices: number, lighting: DrawBatch["lighting"]["kind"]) => GeometryArrays;

/** Storage belongs to one prepared draw until its native pointers are disabled. */
export class GeometryBuffer {
  private storage = new ArrayBuffer(0);
  private arrays: GeometryArrays | null = null;
  private readonly layouts: GeometryArrays[] = [];
  private nextLayout = 0;

  private readonly allocate: AllocateGeometry = (vertices, indices, lighting) => {
    const world = lighting === "vertex" ? 0 : vertices * 3;
    const normals = lighting === "q2-world" ? vertices * 3 : 0;
    const bytes = (vertices * 12 + world + normals + indices) * 4;
    if (this.storage.byteLength < bytes) {
      this.storage = new ArrayBuffer(Math.max(bytes, this.storage.byteLength * 2));
      this.layouts.length = 0;
      this.nextLayout = 0;
    }
    const previous = this.arrays;
    if (previous !== null && previous.positions.buffer === this.storage && previous.positions.length === vertices * 4
      && previous.worldPositions.length === world && previous.normals.length === normals && previous.indices.length === indices) return previous;
    for (const layout of this.layouts) {
      if (layout.positions.length === vertices * 4 && layout.worldPositions.length === world
        && layout.normals.length === normals && layout.indices.length === indices) {
        this.arrays = layout;
        return layout;
      }
    }
    let offset = 0;
    const floats = (length: number): Float32Array => {
      const array = new Float32Array(this.storage, offset, length);
      offset += length * 4;
      return array;
    };
    const positions = floats(vertices * 4), colors = floats(vertices * 4);
    const coordinates = floats(vertices * 2), coordinates2 = floats(vertices * 2);
    const worldPositions = floats(world), normalValues = floats(normals);
    this.arrays = { positions, colors, coordinates, coordinates2, worldPositions, normals: normalValues,
      indices: new Uint32Array(this.storage, offset, indices) };
    this.layouts[this.nextLayout] = this.arrays;
    this.nextLayout = (this.nextLayout + 1) % 8;
    return this.arrays;
  };

  pack(batch: DrawBatch): GeometryArrays { return pack(batch, this.allocate); }
}

const allocateFresh: AllocateGeometry = (vertices, indices, lighting) => ({
  positions: new Float32Array(vertices * 4), colors: new Float32Array(vertices * 4),
  coordinates: new Float32Array(vertices * 2), coordinates2: new Float32Array(vertices * 2),
  worldPositions: new Float32Array(lighting === "vertex" ? 0 : vertices * 3),
  normals: new Float32Array(lighting === "q2-world" ? vertices * 3 : 0), indices: new Uint32Array(indices),
});

/** Own every native client pointer until the draw disables its arrays. */
export function packGeometry(batch: DrawBatch): GeometryArrays {
  return pack(batch, allocateFresh);
}

function pack(batch: DrawBatch, allocate: AllocateGeometry): GeometryArrays {
  const { vertices, indices } = batch;
  const size = batch.primitive === "lines" ? 2 : 3;
  if (indices.length % size !== 0 || indices.length > 0x7fffffff)
    throw new RangeError("OpenGL primitive index count is invalid");
  if (vertices.length > 0x1fffffff) throw new RangeError("OpenGL vertex allocation is too large");
  if (batch.primitive === "lines" && (!Number.isFinite(Math.fround(batch.lineWidth)) || batch.lineWidth <= 0))
    throw new RangeError("OpenGL line width must be positive and finite");
  for (let offset = 0; offset < indices.length; offset++) {
    const index = indices[offset] ?? -1;
    if (!(index >= 0) || index >= vertices.length || (index | 0) !== index)
      throw new RangeError("OpenGL vertex index is outside its allocation");
  }
  const arrays = allocate(vertices.length, indices.length, batch.lighting.kind);
  arrays.indices.set(indices);
  if (batch.texturing === "single") arrays.coordinates2.fill(0);
  // The finite-float32 contract is checked on the source values while they
  // are packed: the running maximum magnitude stays finite and in range
  // exactly when every stored float32 would (NaN poisons the maximum).
  let worst = 0;
  const positions = arrays.positions, colors = arrays.colors, coordinates = arrays.coordinates;
  let four = 0, two = 0;
  for (const vertex of vertices) {
    const { position, color, texCoord } = vertex;
    positions[four] = position.x; positions[four + 1] = position.y;
    positions[four + 2] = position.z; positions[four + 3] = position.w;
    colors[four] = color.x; colors[four + 1] = color.y;
    colors[four + 2] = color.z; colors[four + 3] = color.w;
    coordinates[two] = texCoord.x; coordinates[two + 1] = texCoord.y;
    // Math.max propagates NaN exactly like the guarded running maximum.
    worst = Math.max(worst, Math.abs(position.x), Math.abs(position.y), Math.abs(position.z), Math.abs(position.w),
      Math.abs(color.x), Math.abs(color.y), Math.abs(color.z), Math.abs(color.w), Math.abs(texCoord.x), Math.abs(texCoord.y));
    four += 4; two += 2;
  }
  if (batch.texturing === "pair") {
    let offset = 0;
    for (const vertex of batch.vertices) {
      arrays.coordinates2[offset] = vertex.texCoord2.x; arrays.coordinates2[offset + 1] = vertex.texCoord2.y;
      worst = Math.max(worst, Math.abs(vertex.texCoord2.x), Math.abs(vertex.texCoord2.y));
      offset += 2;
    }
  }
  if (batch.lighting.kind !== "vertex") {
    if (batch.lighting.worldPositions.length !== vertices.length) throw new RangeError("Q2 world positions must match the draw's vertex count");
    let offset = 0;
    for (const position of batch.lighting.worldPositions) {
      arrays.worldPositions[offset] = position.x; arrays.worldPositions[offset + 1] = position.y; arrays.worldPositions[offset + 2] = position.z;
      worst = Math.max(worst, Math.abs(position.x), Math.abs(position.y), Math.abs(position.z));
      offset += 3;
    }
    if (batch.lighting.kind === "q2-world") {
      if (batch.lighting.normals.length !== vertices.length) throw new RangeError("Q2 normals must match the draw's vertex count");
      offset = 0;
      for (const normal of batch.lighting.normals) {
        arrays.normals[offset] = normal.x; arrays.normals[offset + 1] = normal.y; arrays.normals[offset + 2] = normal.z;
        worst = Math.max(worst, Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
        offset += 3;
      }
    }
  }
  // The bound is the float32 overflow midpoint: magnitudes at or below it
  // round to a finite float32, exactly matching the stored-value scan.
  if (!(worst < 3.4028235677973366e38))
    throw new RangeError("OpenGL attributes must be finite float32 values");
  return arrays;
}
