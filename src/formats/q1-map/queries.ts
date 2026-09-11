/* Quake model traversal and visibility RLE, adapted from id Software model.c.
 * Copyright (C) 1996 Id Software, Inc. GPL-2.0-or-later. */
import type { Vec3 } from "../../contracts/math.ts";
import type { Q1WorldGeometry } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { index } from "./records.ts";

export function decompressQ1Pvs(data: Uint8Array, offset: number | null, visibleLeaves: number): Uint8Array {
  if (!Number.isSafeInteger(visibleLeaves) || visibleLeaves < 0) throw new RangeError("Invalid visible leaf count");
  const output = new Uint8Array(Math.ceil(visibleLeaves / 8));
  if (offset === null || data.length === 0) return output.fill(255);
  const reader = new BinaryReader(data, "Quake PVS");
  reader.seek(offset);
  let position = 0;
  while (position < output.length) {
    const value = reader.u8();
    if (value !== 0) { output[position++] = value; continue; }
    const count = reader.u8();
    if (count === 0 || count > output.length - position) throw new BinaryError(reader.source, reader.offset - 1, `invalid zero run ${count}`);
    position += count;
  }
  return output;
}

/** PVS bit zero denotes leaf one. The shared solid leaf zero sees every leaf. */
export function q1LeafPvs(map: Q1WorldGeometry, leafIndex: number): Uint8Array {
  index(leafIndex, map.leaves.length, "Quake PVS leaf");
  const leaf = map.leaves[leafIndex];
  if (leaf === undefined) throw new RangeError("Missing Quake leaf");
  const world = map.models[0];
  const count = world?.visibleLeaves ?? Math.max(0, map.leaves.length - 1);
  return decompressQ1Pvs(map.visibility, leafIndex === 0 ? null : leaf.visibilityOffset, count);
}

export function findQ1Leaf(map: Q1WorldGeometry, point: Vec3, modelIndex = 0): number {
  index(modelIndex, map.models.length, "Quake model");
  const model = map.models[modelIndex];
  const root = model?.headnodes[0];
  if (root === undefined) throw new RangeError("Missing Quake model root");
  let next = root;
  for (let visited = 0; visited <= map.nodes.length; visited++) {
    if (next < 0) { const leaf = -1 - next; index(leaf, map.leaves.length, "Quake leaf"); return leaf; }
    const node = map.nodes[next];
    if (node === undefined) throw new RangeError(`Missing Quake node ${next}`);
    const plane = map.planes[node.plane];
    if (plane === undefined) throw new RangeError(`Missing Quake plane ${node.plane}`);
    const distance = point.x * plane.normal.x + point.y * plane.normal.y + point.z * plane.normal.z - plane.distance;
    const child = node.children[distance > 0 ? 0 : 1];
    if (child.kind === "leaf") return child.index;
    next = child.index;
  }
  throw new Error("Cycle in Quake BSP nodes");
}

export function q1FaceVertices(map: Q1WorldGeometry, faceIndex: number): readonly Vec3[] {
  index(faceIndex, map.faces.length, "Quake face");
  const face = map.faces[faceIndex];
  if (face === undefined) throw new RangeError("Missing Quake face");
  const vertices: Vec3[] = [];
  for (let i = 0; i < face.edges.count; i++) {
    const edgeIndex = map.surfaceEdges[face.edges.first + i];
    if (edgeIndex === undefined) throw new RangeError("Missing Quake surface edge");
    const edge = map.edges[Math.abs(edgeIndex)];
    if (edge === undefined) throw new RangeError("Missing Quake edge");
    const vertex = map.vertices[edge.vertices[edgeIndex >= 0 ? 0 : 1]];
    if (vertex === undefined) throw new RangeError("Missing Quake vertex");
    vertices.push(vertex);
  }
  return vertices;
}
