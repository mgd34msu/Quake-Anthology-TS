// SPDX-License-Identifier: GPL-2.0-or-later
/* Stencil shadow volume silhouettes from Quake III tr_shadows.c (RB_ShadowTessEnd, R_RenderShadowEdges). GPL-2.0-or-later. */
import type { Vec3 } from "../../../contracts/math.ts";

/** SHADER_MAX_VERTEXES / 2: id skips the surface when the tessellation is larger. */
export const STENCIL_SHADOW_MAX_VERTEXES = 500;
const MAX_EDGE_DEFS = 32;
const SHADOW_EXTRUSION = 512;

// Storage sized once, like id's static edgeDefs/numEdgeDefs/facing tables.
const edgeCounts = new Int32Array(STENCIL_SHADOW_MAX_VERTEXES);
const edgeTargets = new Int32Array(STENCIL_SHADOW_MAX_VERTEXES * MAX_EDGE_DEFS);
const edgeFacing = new Uint8Array(STENCIL_SHADOW_MAX_VERTEXES * MAX_EDGE_DEFS);

export interface StencilShadowVolume {
  /** The surface vertices followed by the same vertices pushed 512 units away from the light. */
  readonly positions: readonly Vec3[];
  /** Two triangles per silhouette edge, in the winding of id's triangle strip (v, s, v2, s2). */
  readonly indices: readonly number[];
}

/** lightDir points toward the light in the surface's own space. Returns null where id draws nothing. */
export function stencilShadowVolume(positions: readonly Vec3[], indices: readonly number[], lightDir: Vec3): StencilShadowVolume | null {
  const count = positions.length;
  if (count >= STENCIL_SHADOW_MAX_VERTEXES || indices.length % 3 !== 0) return null;
  const f = Math.fround;
  edgeCounts.fill(0, 0, count);
  const addEdge = (from: number, to: number, facing: number): void => {
    const used = edgeCounts[from] ?? 0;
    if (used === MAX_EDGE_DEFS) return;
    edgeTargets[from * MAX_EDGE_DEFS + used] = to;
    edgeFacing[from * MAX_EDGE_DEFS + used] = facing;
    edgeCounts[from] = used + 1;
  };
  const triangles = indices.length / 3,
    facingTriangles = new Uint8Array(triangles);
  for (let triangle = 0; triangle < triangles; triangle++) {
    const i1 = indices[triangle * 3],
      i2 = indices[triangle * 3 + 1],
      i3 = indices[triangle * 3 + 2];
    const v1 = i1 === undefined ? undefined : positions[i1],
      v2 = i2 === undefined ? undefined : positions[i2],
      v3 = i3 === undefined ? undefined : positions[i3];
    if (i1 === undefined || i2 === undefined || i3 === undefined || v1 === undefined || v2 === undefined || v3 === undefined) return null;
    const d1x = f(v2.x - v1.x),
      d1y = f(v2.y - v1.y),
      d1z = f(v2.z - v1.z),
      d2x = f(v3.x - v1.x),
      d2y = f(v3.y - v1.y),
      d2z = f(v3.z - v1.z);
    const nx = f(f(d1y * d2z) - f(d1z * d2y)),
      ny = f(f(d1z * d2x) - f(d1x * d2z)),
      nz = f(f(d1x * d2y) - f(d1y * d2x));
    const facing = f(f(f(nx * lightDir.x) + f(ny * lightDir.y)) + f(nz * lightDir.z)) > 0 ? 1 : 0;
    facingTriangles[triangle] = facing;
    addEdge(i1, i2, facing);
    addEdge(i2, i3, facing);
    addEdge(i3, i1, facing);
  }
  const volume: Vec3[] = positions.slice();
  for (const position of positions)
    volume.push({
      x: f(position.x + f(-SHADOW_EXTRUSION * lightDir.x)),
      y: f(position.y + f(-SHADOW_EXTRUSION * lightDir.y)),
      z: f(position.z + f(-SHADOW_EXTRUSION * lightDir.z)),
    });
  const result: number[] = [];
  for (let vertex = 0; vertex < count; vertex++) {
    for (let edge = 0; edge < (edgeCounts[vertex] ?? 0); edge++) {
      if (edgeFacing[vertex * MAX_EDGE_DEFS + edge] === 0) continue;
      const other = edgeTargets[vertex * MAX_EDGE_DEFS + edge] ?? 0;
      let frontHits = 0;
      for (let candidate = 0; candidate < (edgeCounts[other] ?? 0); candidate++)
        if (edgeTargets[other * MAX_EDGE_DEFS + candidate] === vertex && edgeFacing[other * MAX_EDGE_DEFS + candidate] === 1) frontHits++;
      // A front-facing edge that no other front-facing triangle shares is on the silhouette.
      if (frontHits === 0) result.push(vertex, count + vertex, other, other, count + vertex, count + other);
    }
  }
  return { positions: volume, indices: result };
}
