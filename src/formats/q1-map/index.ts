/* Quake BSP29/BSP2 reading adapted from quake-1-re-ts, Ironwail and FTE.
 * Copyright (C) 1996-2026 their respective authors. GPL-2.0-or-later. */
import type { BspLighting } from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { parseQ1Entities } from "./entities.ts";
import { bspxData, readBrushList, readBspx, readBspxMetadata, readDecoupledLightmaps } from "./extensions.ts";
import {
  index, range, readClipnodes, readEdges, readFaces, readLeaves, readModels,
  readNodes, readPlanes, readTextureInfo, records, vec3,
} from "./records.ts";
import { readTextures } from "./textures.ts";
import type { Q1BspFormat, Q1Lump, Q1LumpName, Q1Map, Q1MapOptions } from "./types.ts";

export type { Q1BspFormat, Q1BspxLump, Q1BspxMetadata, Q1Entity, Q1FaceNormals, Q1Lump, Q1LumpName, Q1Map, Q1MapOptions } from "./types.ts";
export { parseQ1Entities, q1EntityValue } from "./entities.ts";
export { q1TextureRgba } from "./textures.ts";
export { decompressQ1Pvs, findQ1Leaf, q1FaceVertices, q1LeafPvs } from "./queries.ts";

export const Q1_BSP_VERSION = 29;
export const Q1_BSP2_VERSION = 0x32505342;
export const Q1_2PSB_VERSION = 0x42535032;
export const Q1_QUAKE64_VERSION = 0x51363420;

const lumpNames: readonly Q1LumpName[] = [
  "entities", "planes", "textures", "vertices", "visibility", "nodes", "textureInfo",
  "faces", "lighting", "clipnodes", "leaves", "leafFaces", "edges", "surfaceEdges", "models",
];

function formatFor(version: number, source: string): Q1BspFormat {
  switch (version) {
    case Q1_BSP_VERSION: return "bsp29";
    case Q1_BSP2_VERSION: return "bsp2";
    case Q1_2PSB_VERSION: return "2psb";
    case Q1_QUAKE64_VERSION: return "quake64";
    default: throw new BinaryError(source, 0, `unsupported Quake BSP version ${version}`);
  }
}

export function readQ1Lit(data: Uint8Array, sampleCount: number | null = null): Uint8Array {
  const reader = new BinaryReader(data, "Quake .lit");
  reader.expectMagic("QLIT");
  const version = reader.u32();
  if (version !== 1) throw new BinaryError(reader.source, 4, `unsupported version ${version}`);
  if (reader.remaining % 3 !== 0 || sampleCount !== null && reader.remaining !== sampleCount * 3) {
    throw new BinaryError(reader.source, 8, "RGB sample count differs from BSP lighting");
  }
  return reader.bytes(reader.remaining);
}

function selectLighting(monochrome: Uint8Array, rgb: Uint8Array | null, lit: Uint8Array | undefined, packed?: Uint8Array): BspLighting {
  if (packed !== undefined && packed.length % 2 !== 0) throw new BinaryError("Quake64 lighting", 0, "incomplete packed RGB sample");
  const sampleCount = packed === undefined ? monochrome.length : packed.length / 2;
  if (lit !== undefined) return { kind: "rgb8", source: "lit", samples: readQ1Lit(lit, sampleCount > 0 ? sampleCount : null) };
  if (rgb !== null) {
    if (rgb.length % 3 !== 0 || sampleCount > 0 && rgb.length !== sampleCount * 3) {
      throw new BinaryError("BSPX RGBLIGHTING", 0, "RGB sample count differs from BSP lighting");
    }
    return { kind: "rgb8", source: "bspx", samples: rgb };
  }
  if (packed !== undefined) {
    const samples = new Uint8Array(sampleCount * 3), input = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    for (let i = 0; i < sampleCount; i++) {
      const first = input.getUint8(i * 2), second = input.getUint8(i * 2 + 1);
      samples[i * 3] = first & 0xf8;
      samples[i * 3 + 1] = ((first & 7) << 5) | ((second & 0xc0) >> 5);
      samples[i * 3 + 2] = (second & 0x3f) << 2;
    }
    return { kind: "rgb8", source: "bsp", samples };
  }
  return { kind: "luminance8", samples: monochrome };
}

/** Decodes authored geometry. Hull dimensions and collision construction belong to the movement profile. */
export function readQ1Bsp(data: Uint8Array, options: Q1MapOptions = {}): Q1Map {
  const source = options.source ?? "<Quake BSP>";
  const reader = new BinaryReader(data, source);
  const version = reader.u32();
  const format = formatFor(version, source);
  const layout = format === "quake64" ? "bsp29" : format;
  const directory = reader.section(4, 120);
  const lumps: Q1Lump[] = [];
  for (const name of lumpNames) {
    const offset = directory.i32();
    const length = directory.i32();
    if (length > 0 && offset < 124) throw new BinaryError(source, offset, `${name} overlaps BSP header`);
    lumps.push({ name, offset, length, data: reader.section(offset, length).bytes(length) });
  }
  const lump = (name: Q1LumpName): BinaryReader => {
    const entry = lumps.find((item) => item.name === name);
    if (entry === undefined) throw new Error(`Missing required BSP directory entry ${name}`);
    return new BinaryReader(entry.data, `${source}:${name}`);
  };
  const bspx = readBspx(reader, lumps);
  const planes = readPlanes(lump("planes"));
  const vertices = records(lump("vertices"), 12, vec3);
  const textureData = readTextures(lump("textures"), format === "quake64");
  const faces = readFaces(lump("faces"), layout).map(face => {
    if (format !== "quake64" || face.lightingOffset === null) return face;
    if (face.lightingOffset % 2 !== 0) throw new BinaryError(source, face.lightingOffset, "unaligned Quake64 lighting offset");
    return { ...face, lightingOffset: face.lightingOffset / 2 };
  });
  const models = readModels(lump("models"));
  const bspxMetadata = readBspxMetadata(bspx, faces.length, vertices.length, faces.reduce((sum, face) => sum + face.edges.count, 0));
  const embeddedEntities = lump("entities");
  const entityReader = options.entities === undefined ? embeddedEntities : new BinaryReader(options.entities, `${source}:.ent`);
  const entities = entityReader.fixedByteString(entityReader.length);
  const lightReader = lump("lighting");
  const storedLighting = lightReader.bytes(lightReader.remaining);
  const monochromeLighting = format === "quake64" ? new Uint8Array() : storedLighting;
  const visibilityReader = lump("visibility");
  const map: Q1Map = {
    kind: "q1-bsp", format, source, version, lumps, bspx, bspxMetadata,
    extensions: bspx.map((entry) => ({ name: entry.name, bytes: entry.data })),
    entities, entityList: parseQ1Entities(entities), planes, vertices,
    textures: textureData.textures, textureOffsets: textureData.offsets, mipOffsets: textureData.mipOffsets,
    textureInfo: readTextureInfo(lump("textureInfo")), faces, models,
    nodes: readNodes(lump("nodes"), layout), leaves: readLeaves(lump("leaves"), layout),
    edges: readEdges(lump("edges"), layout), clipnodes: readClipnodes(lump("clipnodes"), layout),
    surfaceEdges: records(lump("surfaceEdges"), 4, (r) => r.i32()),
    leafFaces: records(lump("leafFaces"), layout === "bsp29" ? 2 : 4, (r) => layout === "bsp29" ? r.u16() : r.u32()),
    visibility: visibilityReader.bytes(visibilityReader.remaining), monochromeLighting,
    lighting: selectLighting(monochromeLighting, bspxMetadata.rgbLighting, options.lit, format === "quake64" ? storedLighting : undefined),
    decoupledLightmaps: readDecoupledLightmaps(bspxData(bspx, "DECOUPLED_LM"), faces.length),
    brushList: readBrushList(bspxData(bspx, "BRUSHLIST"), models.length),
  };
  validateReferences(map);
  return map;
}

function validateReferences(map: Q1Map): void {
  const source = map.source;
  for (const edge of map.edges) for (const vertex of edge.vertices) index(vertex, map.vertices.length, `${source}:edge vertex`);
  for (const edge of map.surfaceEdges) index(Math.abs(edge), map.edges.length, `${source}:surface edge`);
  for (const face of map.leafFaces) index(face, map.faces.length, `${source}:leaf face`);
  for (const info of map.textureInfo) {
    if (map.textures.length > 0) index(info.texture, map.textures.length, `${source}:miptex`);
  }
  const lightingCount = Math.max(map.monochromeLighting.length,
    map.lighting.kind === "rgb8" ? map.lighting.samples.length / 3 : map.lighting.samples.length,
    map.bspxMetadata.hdrLighting?.length ?? 0);
  for (const face of map.faces) {
    index(face.plane, map.planes.length, `${source}:face plane`);
    index(face.textureInfo, map.textureInfo.length, `${source}:face texture info`);
    range(face.edges, map.surfaceEdges.length, `${source}:face edges`);
    if (face.lightingOffset !== null && lightingCount > 0) index(face.lightingOffset, lightingCount, `${source}:face lighting`);
  }
  for (const leaf of map.leaves) {
    range(leaf.faces, map.leafFaces.length, `${source}:leaf faces`);
    if (leaf.visibilityOffset !== null && map.visibility.length > 0) index(leaf.visibilityOffset, map.visibility.length, `${source}:leaf visibility`);
  }
  for (const node of map.nodes) {
    index(node.plane, map.planes.length, `${source}:node plane`);
    range(node.faces, map.faces.length, `${source}:node faces`);
    for (const child of node.children) index(child.index, child.kind === "node" ? map.nodes.length : map.leaves.length, `${source}:node child`);
  }
  for (const node of map.clipnodes) {
    index(node.plane, map.planes.length, `${source}:clipnode plane`);
    for (const child of node.children) if (child.kind === "clipnode") index(child.index, map.clipnodes.length, `${source}:clipnode child`);
  }
  for (const model of map.models) {
    range(model.faces, map.faces.length, `${source}:model faces`);
    range({ first: 0, count: model.visibleLeaves }, Math.max(0, map.leaves.length - 1), `${source}:model visible leaves`);
    for (const [hull, headnode] of model.headnodes.entries()) {
      if (hull === 0) {
        if (headnode >= 0) index(headnode, map.nodes.length, `${source}:model headnode`);
        else index(-1 - headnode, map.leaves.length, `${source}:model head leaf`);
      } else if (hull < 3 && headnode >= 0 && (map.clipnodes.length > 0 || map.brushList === null)) {
        index(headnode, map.clipnodes.length, `${source}:model clip headnode`);
      }
    }
  }
}
