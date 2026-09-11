/* Q2 map conversion adapted from quake-2-re-ts qcommon/cmodel.ts, ref_gl/gl_model.ts
 * and q2repro/src/common/bsp.c. GPL-2.0-or-later. */
import type { BspFace, DecoupledLightmap, Q2Leaf, Q2TextureInfo, Q2WorldGeometry } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { readQ2DecoupledLightmaps, readQ2FaceNormals, readQ2Lightgrid } from "./bspx.ts";
import type { Q2FaceNormals, Q2Lightgrid } from "./bspx.ts";
import { readQ2Bsp } from "./reader.ts";
import type { Q2Bsp } from "./reader.ts";

export { readQ2Bsp, decompressQ2Visibility } from "./reader.ts";
export type { Q2Bsp, Q2Lump, Q2RawFace, Q2RawLeaf, Q2RawTextureInfo } from "./reader.ts";
export { readQ2Bspx, readQ2DecoupledLightmaps, readQ2FaceNormals, readQ2Lightgrid, lookupQ2Lightgrid } from "./bspx.ts";
export type {
  Q2BspxDirectory, Q2BspxLump, Q2DecoupledLightmaps, Q2FaceNormals, Q2Lightgrid, Q2LightgridChild,
  Q2LightgridNode, Q2LightgridLeaf, Q2LightgridSample,
} from "./bspx.ts";

export interface Q2DecodedMap extends Q2WorldGeometry {
  readonly source: Q2Bsp;
  readonly lightgrid: Q2Lightgrid | null;
  readonly faceNormals: Q2FaceNormals | null;
  readonly diagnostics: readonly string[];
}

export interface Q2MapResources {
  /** Resolve textures/<texinfo name>.mat through the caller's content mount. */
  readMaterial(path: string): Uint8Array | null;
}

function textures(map: Q2Bsp, resources: Q2MapResources | undefined, diagnostics: string[]): Q2TextureInfo[] {
  const materials = new Map<string, string>();
  return map.textureInfo.map(texture => {
    const name = texture.name.slice(0, 31);
    const key = name.toLowerCase();
    let material = materials.get(key);
    if (material === undefined) {
      const path = `textures/${name}.mat`;
      const bytes = resources?.readMaterial(path) ?? null;
      material = bytes === null ? "" : new BinaryReader(bytes, path).fixedByteString(Math.min(bytes.length, 15));
      if (material.length > 0 && !/^[a-zA-Z0-9_-]+$/.test(material)) {
        diagnostics.push(`Invalid material in ${path}`);
        material = "";
      }
      materials.set(key, material);
    }
    // Q2 animates only positive nexttexinfo values; zero and negative values end the chain.
    return { ...texture, material, next: texture.next > 0 ? texture.next : null };
  });
}

export function toQ2WorldGeometry(map: Q2Bsp, resources?: Q2MapResources): Q2DecodedMap {
  const diagnostics = [...map.diagnostics, ...map.bspx?.diagnostics ?? []];
  let decoupledLightmaps: readonly DecoupledLightmap[] | null = null;
  let lightgrid: Q2Lightgrid | null = null;
  let faceNormals: Q2FaceNormals | null = null;
  const decoupled = map.bspx?.lumps.get("DECOUPLED_LM");
  if (decoupled !== undefined) {
    try {
      const result = readQ2DecoupledLightmaps(decoupled, map.faces.length, map.lighting.length);
      decoupledLightmaps = result.faces;
      diagnostics.push(...result.diagnostics);
    } catch (error) {
      if (!(error instanceof BinaryError)) throw error;
      diagnostics.push(error.message);
    }
  }
  const octree = map.bspx?.lumps.get("LIGHTGRID_OCTREE");
  if (octree !== undefined) {
    try {
      lightgrid = readQ2Lightgrid(octree);
    } catch (error) {
      if (!(error instanceof BinaryError)) throw error;
      diagnostics.push(error.message);
    }
  }
  const normals = map.bspx?.lumps.get("FACENORMALS");
  if (normals !== undefined) {
    try {
      faceNormals = readQ2FaceNormals(normals, map.faces.reduce((total, face) => total + face.edges.count, 0));
    } catch (error) {
      if (!(error instanceof BinaryError)) throw error;
      diagnostics.push(error.message);
    }
  }
  const leaves: Q2Leaf[] = map.leaves.map((leaf, index) => {
    let mergedContents = leaf.contents;
    if (index !== 0) {
      const end = leaf.brushes.first + leaf.brushes.count;
      for (let offset = leaf.brushes.first; offset < end; offset++) {
        const brushIndex = map.leafBrushes[offset];
        const brush = brushIndex === undefined ? undefined : map.brushes[brushIndex];
        if (brush === undefined) throw new BinaryError(map.source, 0, "invalid leaf brush reference");
        mergedContents |= brush.contents;
      }
    }
    return { ...leaf, mergedContents, cluster: leaf.cluster !== -1 && map.visibility === null ? 0 : leaf.cluster };
  });
  const faces: BspFace[] = map.faces.map((face, index) => {
    const lightmap = decoupledLightmaps?.[index];
    const lightingOffset = lightmap === undefined
      ? face.lightingOffset === -1 || map.lighting.length === 0 ? null : face.lightingOffset
      : lightmap.lightingOffset;
    return { plane: face.plane, back: (face.drawFlags & 1) !== 0, edges: face.edges, textureInfo: face.textureInfo,
      styles: face.styles, lightingOffset };
  });
  const textureInfo = textures(map, resources, diagnostics);
  // The loader expands submodel bounds by one unit, as both Q2 renderers and cmodel do.
  const models = map.models.map(model => ({ ...model, bounds: {
    min: { x: model.bounds.min.x - 1, y: model.bounds.min.y - 1, z: model.bounds.min.z - 1 },
    max: { x: model.bounds.max.x + 1, y: model.bounds.max.y + 1, z: model.bounds.max.z + 1 },
  } }));
  return { kind: "q2-bsp", format: map.format, entities: map.entities, planes: map.planes, vertices: map.vertices,
    edges: map.edges, surfaceEdges: map.surfaceEdges, nodes: map.nodes, leaves, leafFaces: map.leafFaces,
    leafBrushes: map.leafBrushes, textureInfo, faces, brushes: map.brushes, brushSides: map.brushSides,
    models, areas: map.areas, areaPortals: map.areaPortals, visibility: map.visibility,
    lighting: { kind: "rgb8", samples: map.lighting, source: "bsp" }, decoupledLightmaps,
    extensions: [...map.bspx?.lumps.values() ?? []].map(lump => ({ name: lump.name, bytes: lump.bytes })),
    source: map, lightgrid, faceNormals, diagnostics };
}

export function decodeQ2Map(bytes: Uint8Array, source = "<q2-map>", resources?: Q2MapResources): Q2DecodedMap {
  return toQ2WorldGeometry(readQ2Bsp(bytes, source), resources);
}
