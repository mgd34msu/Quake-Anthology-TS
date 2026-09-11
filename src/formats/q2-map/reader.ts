/* Adapted from quake-2-re-ts/src/qcommon/qfiles.ts and q2repro/src/common/bsp_template.c.
 * Copyright (C) 1997-2001 Id Software, Inc.; 2008 Andrey Nazarov.
 * GPL-2.0-or-later. */
import type { Bounds, Vec3, Vec4 } from "../../contracts/math.ts";
import type {
  BspChild, BspEdge, BspFace, BspNode, BspPlane, IndexRange, Q2Area, Q2AreaPortal,
  Q2Brush, Q2BrushSide, Q2Leaf, Q2TextureInfo, Q2Visibility, Q2WorldModel,
} from "../../contracts/scene.ts";
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import { readQ2Bspx } from "./bspx.ts";
import type { Q2BspxDirectory } from "./bspx.ts";

export interface Q2Lump { readonly offset: number; readonly length: number; }
export interface Q2RawFace extends Omit<BspFace, "back" | "lightingOffset"> {
  readonly drawFlags: number;
  readonly lightingOffset: number;
}
export interface Q2RawTextureInfo extends Omit<Q2TextureInfo, "material" | "next"> { readonly next: number; }
export type Q2RawLeaf = Omit<Q2Leaf, "mergedContents">;

/** Source records retain on-disk bounds, indices, light offsets and animation sentinels. */
export interface Q2Bsp {
  readonly source: string;
  readonly format: "ibsp38" | "qbsp";
  readonly version: 38;
  readonly lumps: readonly Q2Lump[];
  readonly entities: string;
  readonly entityBytes: Uint8Array;
  readonly planes: readonly BspPlane[];
  readonly vertices: readonly Vec3[];
  readonly edges: readonly BspEdge[];
  readonly surfaceEdges: readonly number[];
  readonly nodes: readonly BspNode[];
  readonly leaves: readonly Q2RawLeaf[];
  readonly leafFaces: readonly number[];
  readonly leafBrushes: readonly number[];
  readonly textureInfo: readonly Q2RawTextureInfo[];
  readonly faces: readonly Q2RawFace[];
  readonly brushes: readonly Q2Brush[];
  readonly brushSides: readonly Q2BrushSide[];
  readonly models: readonly Q2WorldModel[];
  readonly areas: readonly Q2Area[];
  readonly areaPortals: readonly Q2AreaPortal[];
  readonly visibility: Q2Visibility | null;
  readonly lighting: Uint8Array;
  readonly pop: Uint8Array;
  readonly bspx: Q2BspxDirectory | null;
  readonly diagnostics: readonly string[];
}

function vector(reader: BinaryReader): Vec3 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32() };
}
function shortVector(reader: BinaryReader): Vec3 { return { x: reader.i16(), y: reader.i16(), z: reader.i16() }; }
function projection(reader: BinaryReader): Vec4 {
  return { x: reader.finiteF32(), y: reader.finiteF32(), z: reader.finiteF32(), w: reader.finiteF32() };
}
function bounds(reader: BinaryReader, extended: boolean): Bounds {
  return extended ? { min: vector(reader), max: vector(reader) } : { min: shortVector(reader), max: shortVector(reader) };
}
function index(reader: BinaryReader, extended: boolean): number { return extended ? reader.u32() : reader.u16(); }
function nullableIndex(reader: BinaryReader, extended: boolean): number {
  const value = index(reader, extended);
  return value === (extended ? 0xffffffff : 0xffff) ? -1 : value;
}
function range(reader: BinaryReader, extended: boolean): IndexRange {
  return { first: index(reader, extended), count: index(reader, extended) };
}
function child(value: number): BspChild {
  return value < 0 ? { kind: "leaf", index: -1 - value } : { kind: "node", index: value };
}
function records<T>(reader: BinaryReader, lump: Q2Lump, stride: number, read: (row: BinaryReader) => T): T[] {
  const section = reader.records(lump.offset, lump.length, stride);
  const result: T[] = [];
  while (section.remaining > 0) result.push(read(section));
  return result;
}

function visibility(reader: BinaryReader): Q2Visibility | null {
  if (reader.length === 0) return null;
  const compressed = reader.section(0, reader.length).bytes(reader.length);
  const count = reader.u32();
  reader.records(reader.offset, count * 8, 8);
  const clusters: { pvsOffset: number; phsOffset: number }[] = [];
  for (let cluster = 0; cluster < count; cluster++) {
    const pvsOffset = reader.i32();
    const phsOffset = reader.i32();
    for (const offset of [pvsOffset, phsOffset]) {
      if (offset !== -1 && (offset < 4 + count * 8 || offset >= reader.length)) {
        throw new BinaryError(reader.source, reader.offset - 8, "visibility offset is outside compressed data");
      }
    }
    clusters.push({ pvsOffset, phsOffset });
  }
  return { clusters, compressed };
}

export function readQ2Bsp(bytes: Uint8Array, source = "<q2-map>"): Q2Bsp {
  const reader = new BinaryReader(bytes, source);
  const magic = reader.fixedByteString(4);
  if (magic !== "IBSP" && magic !== "QBSP") throw new BinaryError(source, 0, `unsupported Q2 map identifier ${magic}`);
  const version = reader.u32();
  if (version !== 38) throw new BinaryError(source, 4, `unsupported Q2 BSP version ${version}`);
  const extended = magic === "QBSP";
  const lumps: Q2Lump[] = [];
  const diagnostics: string[] = [];
  let endOfLumps = 160;
  for (let number = 0; number < 19; number++) {
    const offset = reader.u32();
    let length = reader.u32();
    // q2repro accepts the overlong entity lump produced by some older compilers.
    if (number === 0 && offset < reader.length && length > reader.length - offset) {
      length = reader.length - offset;
      diagnostics.push("Clamped entity lump to the end of the file");
    }
    reader.section(offset, length);
    lumps.push({ offset, length });
    endOfLumps = Math.max(endOfLumps, offset + length);
  }
  function lump(number: number): Q2Lump {
    const value = lumps[number];
    if (value === undefined) throw new RangeError(`Unknown Q2 lump ${number}`);
    return value;
  }
  function raw(number: number): Uint8Array {
    const value = lump(number);
    return reader.section(value.offset, value.length).bytes(value.length);
  }
  const entityBytes = raw(0);
  const entities = new BinaryReader(entityBytes, `${source}:entities`).fixedByteString(entityBytes.length);
  const planes = records(reader, lump(1), 20, row => {
    const normal = vector(row);
    const distance = row.finiteF32();
    const type = row.i32();
    const signbits = (normal.x < 0 ? 1 : 0) | (normal.y < 0 ? 2 : 0) | (normal.z < 0 ? 4 : 0);
    return { normal, distance, type, signbits };
  });
  const vertices = records(reader, lump(2), 12, vector);
  const visibilityLump = lump(3);
  const vis = visibility(reader.section(visibilityLump.offset, visibilityLump.length));
  const nodes = records<BspNode>(reader, lump(4), extended ? 44 : 28, row => ({
    plane: row.u32(), children: [child(row.i32()), child(row.i32())], bounds: bounds(row, extended), faces: range(row, extended),
  }));
  const textureInfo = records<Q2RawTextureInfo>(reader, lump(5), 76, row => ({
    projection: { s: projection(row), t: projection(row) }, flags: row.i32(), value: row.i32(),
    name: row.fixedByteString(32), next: row.i32(),
  }));
  const faces = records<Q2RawFace>(reader, lump(6), extended ? 28 : 20, row => {
    const plane = index(row, extended);
    const drawFlags = index(row, extended);
    const first = row.u32();
    const count = index(row, extended);
    const textureInfo = index(row, extended);
    const styles = [row.u8(), row.u8(), row.u8(), row.u8()];
    const lightingOffset = row.i32();
    return { plane, drawFlags, edges: { first, count }, textureInfo, styles, lightingOffset };
  });
  const lighting = raw(7);
  const leaves = records<Q2RawLeaf>(reader, lump(8), extended ? 52 : 28, row => ({
    contents: row.i32(), cluster: nullableIndex(row, extended), area: index(row, extended),
    bounds: bounds(row, extended), faces: range(row, extended), brushes: range(row, extended),
  }));
  const leafFaces = records(reader, lump(9), extended ? 4 : 2, row => index(row, extended));
  const leafBrushes = records(reader, lump(10), extended ? 4 : 2, row => index(row, extended));
  const edges = records<BspEdge>(reader, lump(11), extended ? 8 : 4, row => ({ vertices: [index(row, extended), index(row, extended)] }));
  const surfaceEdges = records(reader, lump(12), 4, row => row.i32());
  const models = records<Q2WorldModel>(reader, lump(13), 48, row => ({
    bounds: bounds(row, true), origin: vector(row), headnode: row.i32(), faces: range(row, true),
  }));
  const brushes = records<Q2Brush>(reader, lump(14), 12, row => ({ sides: range(row, true), contents: row.i32() }));
  const brushSides = records<Q2BrushSide>(reader, lump(15), extended ? 8 : 4, row => ({
    plane: index(row, extended), textureInfo: nullableIndex(row, extended),
  }));
  const pop = raw(16);
  const areas = records<Q2Area>(reader, lump(17), 8, row => {
    const count = row.u32();
    return { portals: { first: row.u32(), count } };
  });
  const areaPortals = records<Q2AreaPortal>(reader, lump(18), 8, row => ({ portal: row.u32(), otherArea: row.u32() }));
  const bspx = readQ2Bspx(reader, endOfLumps);
  const result: Q2Bsp = { source, format: extended ? "qbsp" : "ibsp38", version, lumps, entities, entityBytes,
    planes, vertices, edges, surfaceEdges, nodes, leaves, leafFaces, leafBrushes, textureInfo, faces, brushes,
    brushSides, models, areas, areaPortals, visibility: vis, lighting, pop, bspx, diagnostics };
  validateQ2Bsp(result);
  return result;
}

function validateQ2Bsp(map: Q2Bsp): void {
  function fail(message: string): never { throw new BinaryError(map.source, 0, message); }
  function reference(value: number, count: number, label: string): void {
    if (value < 0 || value >= count) fail(`Invalid ${label} index ${value} for ${count} records`);
  }
  function span(value: IndexRange, count: number, label: string): void {
    if (value.first < 0 || value.count < 0 || value.first > count - value.count) fail(`Invalid ${label} range`);
  }
  function nodeReference(value: BspChild): void {
    reference(value.index, value.kind === "node" ? map.nodes.length : map.leaves.length, value.kind);
  }
  if (map.models.length === 0 || map.nodes.length === 0 || map.leaves.length === 0) fail("Map must contain models, nodes and leaves");
  if (map.leaves[0]?.contents !== 1) fail("Map leaf 0 is not CONTENTS_SOLID");
  for (const edge of map.edges) for (const vertex of edge.vertices) reference(vertex, map.vertices.length, "vertex");
  for (const edge of map.surfaceEdges) reference(Math.abs(edge), map.edges.length, "surface edge");
  for (const face of map.faces) {
    reference(face.plane, map.planes.length, "face plane");
    reference(face.textureInfo, map.textureInfo.length, "face texture");
    span(face.edges, map.surfaceEdges.length, "face edges");
    if (face.edges.count < 3) fail("Face has fewer than three edges");
    if (face.lightingOffset < -1 || (map.lighting.length > 0 && face.lightingOffset >= map.lighting.length)) fail("Invalid face lighting offset");
  }
  for (const texture of map.textureInfo) if (texture.next > 0) reference(texture.next, map.textureInfo.length, "animated texture");
  for (const brush of map.brushes) span(brush.sides, map.brushSides.length, "brush sides");
  for (const side of map.brushSides) {
    reference(side.plane, map.planes.length, "brush plane");
    if (side.textureInfo !== -1) reference(side.textureInfo, map.textureInfo.length, "brush texture");
  }
  for (const brush of map.leafBrushes) reference(brush, map.brushes.length, "leaf brush");
  for (const face of map.leafFaces) reference(face, map.faces.length, "leaf face");
  for (const leaf of map.leaves) {
    span(leaf.faces, map.leafFaces.length, "leaf faces");
    span(leaf.brushes, map.leafBrushes.length, "leaf brushes");
    reference(leaf.area, map.areas.length, "leaf area");
    if (map.visibility !== null && leaf.cluster !== -1) reference(leaf.cluster, map.visibility.clusters.length, "leaf cluster");
  }
  for (const node of map.nodes) {
    reference(node.plane, map.planes.length, "node plane");
    span(node.faces, map.faces.length, "node faces");
    for (const value of node.children) nodeReference(value);
  }
  for (const model of map.models) {
    nodeReference(child(model.headnode));
    span(model.faces, map.faces.length, "model faces");
  }
  for (const area of map.areas) span(area.portals, map.areaPortals.length, "area portals");
  for (const portal of map.areaPortals) {
    reference(portal.otherArea, map.areas.length, "portal area");
    reference(portal.portal, map.areaPortals.length, "portal");
  }
  // Iterative traversal also accepts the deep trees in Call of the Machine.
  const complete = new Set<number>();
  const active = new Set<number>();
  for (const model of map.models) {
    const pending: { child: BspChild; leaving: boolean }[] = [{ child: child(model.headnode), leaving: false }];
    while (pending.length > 0) {
      const item = pending.pop();
      if (item === undefined || item.child.kind === "leaf") continue;
      const number = item.child.index;
      if (item.leaving) { active.delete(number); complete.add(number); continue; }
      if (active.has(number)) fail("Cycle in BSP nodes");
      if (complete.has(number)) continue;
      const node = map.nodes[number];
      if (node === undefined) fail("Invalid BSP node");
      active.add(number);
      pending.push({ child: item.child, leaving: true });
      pending.push({ child: node.children[1], leaving: false }, { child: node.children[0], leaving: false });
    }
  }
}

/** PVS and PHS offsets are relative to the complete visibility lump, including its header. */
export function decompressQ2Visibility(visibility: Q2Visibility | null, cluster: number, kind: "pvs" | "phs", clusterCount = 0): Uint8Array {
  const count = visibility?.clusters.length ?? clusterCount;
  const row = new Uint8Array(Math.ceil(count / 8));
  if (cluster === -1) return row;
  if (visibility === null) return row.fill(255);
  const entry = visibility.clusters[cluster];
  if (entry === undefined) throw new RangeError(`Invalid Q2 visibility cluster ${cluster}`);
  const offset = kind === "pvs" ? entry.pvsOffset : entry.phsOffset;
  if (offset === -1) return row.fill(255);
  const reader = new BinaryReader(visibility.compressed, `Q2 ${kind} cluster ${cluster}`);
  reader.seek(offset);
  let output = 0;
  while (output < row.length) {
    const value = reader.u8();
    if (value !== 0) { row[output++] = value; continue; }
    const run = reader.u8();
    if (run === 0 || run > row.length - output) throw new BinaryError(reader.source, reader.offset - 1, "invalid visibility zero run");
    output += run;
  }
  return row;
}
