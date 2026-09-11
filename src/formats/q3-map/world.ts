/* Q3 scene adaptation from qfiles.h and cm_load.c. GPL-2.0-or-later. */
import type { BspChild, BspPlane, Q3BspSurface, Q3WorldGeometry } from "../../contracts/scene.ts";
import type { BspMap, BspSurface } from "./decode.ts";
import { parseQ3Bsp } from "./decode.ts";

function child(value: number): BspChild {
  return value < 0 ? { kind: "leaf", index: -value - 1 } : { kind: "node", index: value };
}

function plane(value: BspMap["planes"][number]): BspPlane {
  const { normal } = value;
  const type = normal.x === 1 ? 0 : normal.y === 1 ? 1 : normal.z === 1 ? 2 : 3;
  const signbits = (normal.x < 0 ? 1 : 0) | (normal.y < 0 ? 2 : 0) | (normal.z < 0 ? 4 : 0);
  return { ...value, type, signbits };
}

function surface(value: BspSurface): Q3BspSurface {
  const fields = {
    shader: value.shader,
    fog: value.fog,
    vertices: { first: value.firstVertex, count: value.vertexCount },
    indices: { first: value.firstIndex, count: value.indexCount },
    lightmap: {
      image: value.lightmap,
      x: value.lightmapX, y: value.lightmapY,
      width: value.lightmapWidth, height: value.lightmapHeight,
      origin: value.lightmapOrigin, vectors: value.lightmapVectors,
    },
  };
  switch (value.type) {
    case "planar": return { ...fields, kind: "planar" };
    case "triangles": return { ...fields, kind: "triangles" };
    case "flare": return { ...fields, kind: "flare" };
    case "patch": return { ...fields, kind: "patch", width: value.patchWidth, height: value.patchHeight };
  }
}

/** Keep source units, local draw indices, byte RGBA and patch LOD bounds unchanged. */
export function adaptQ3Bsp(map: BspMap): Q3WorldGeometry {
  return {
    kind: "q3-bsp", format: "ibsp46", entities: map.entities,
    shaders: map.shaders,
    planes: map.planes.map(plane),
    nodes: map.nodes.map(node => ({ plane: node.plane,
      children: [child(node.children[0]), child(node.children[1])], bounds: node.bounds })),
    leaves: map.leaves.map(leaf => ({
      cluster: leaf.cluster, area: leaf.area, bounds: leaf.bounds,
      surfaces: { first: leaf.firstSurface, count: leaf.surfaceCount },
      brushes: { first: leaf.firstBrush, count: leaf.brushCount },
    })),
    leafSurfaces: map.leafSurfaces, leafBrushes: map.leafBrushes,
    models: map.models.map(model => ({
      bounds: model.bounds,
      surfaces: { first: model.firstSurface, count: model.surfaceCount },
      brushes: { first: model.firstBrush, count: model.brushCount },
    })),
    brushes: map.brushes.map(brush => ({
      sides: { first: brush.firstSide, count: brush.sideCount }, shader: brush.shader,
    })),
    brushSides: map.brushSides,
    vertices: map.vertices, indices: map.indices,
    fogs: map.fogs, surfaces: map.surfaces.map(surface),
    lightmaps: map.lightmaps, lightGrid: map.lightGrid, visibility: map.visibility,
  };
}

export function decodeQ3World(data: Uint8Array, source = "<bsp>"): Q3WorldGeometry {
  return adaptQ3Bsp(parseQ3Bsp(data, source));
}
