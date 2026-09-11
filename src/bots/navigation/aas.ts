// AAS v4/v5 records and BSP sampling from id Software's aasfile.h, be_aas_file.c,
// be_aas_sample.c, and quake-3-ts/src/botlib/{aas,aas-storage}.ts.
// Copyright (C) 1999-2005 Id Software, Inc. SPDX-License-Identifier: GPL-2.0-or-later
import { BinaryError, BinaryReader } from "../../core/binary/index.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";

export interface AasAsset {
  readonly kind: "aas"; readonly source: string; readonly version: 4 | 5; readonly bspChecksum: number;
  readonly lumps: readonly { readonly offset: number; readonly length: number }[];
  readonly bboxes: readonly { readonly presence: number; readonly flags: number; readonly bounds: Bounds }[];
  readonly vertices: readonly Vec3[];
  readonly planes: readonly { readonly normal: Vec3; readonly distance: number; readonly type: number }[];
  readonly edges: readonly { readonly vertices: readonly [number, number] }[];
  readonly edgeIndexes: readonly number[];
  readonly faces: readonly { readonly plane: number; readonly flags: number; readonly edgeCount: number; readonly firstEdge: number; readonly frontArea: number; readonly backArea: number }[];
  readonly faceIndexes: readonly number[];
  readonly areas: readonly { readonly number: number; readonly faceCount: number; readonly firstFace: number; readonly bounds: Bounds; readonly center: Vec3 }[];
  readonly settings: readonly { readonly contents: number; readonly flags: number; readonly presence: number; readonly cluster: number; readonly clusterArea: number; readonly reachCount: number; readonly firstReach: number }[];
  readonly reachability: readonly { readonly area: number; readonly face: number; readonly edge: number; readonly start: Vec3; readonly end: Vec3; readonly travelType: number; readonly travelTime: number; readonly padding: number }[];
  readonly nodes: readonly { readonly plane: number; readonly children: readonly [number, number] }[];
  readonly portals: readonly { readonly area: number; readonly frontCluster: number; readonly backCluster: number; readonly clusterAreas: readonly [number, number] }[];
  readonly portalIndexes: readonly number[];
  readonly clusters: readonly { readonly areaCount: number; readonly reachabilityAreaCount: number; readonly portalCount: number; readonly firstPortal: number }[];
}
function vector(r: BinaryReader): Vec3 { return { x: r.finiteF32(), y: r.finiteF32(), z: r.finiteF32() }; }
function bounds(r: BinaryReader): Bounds { return { min: vector(r), max: vector(r) }; }
function pair(r: BinaryReader): readonly [number, number] { return [r.i32(), r.i32()]; }
function index(value: number, count: number, name: string): void {
  if (value < 0 || value >= count) throw new RangeError(`AAS ${name} index ${value} exceeds ${count}`);
}
function range(first: number, count: number, length: number, name: string): void {
  if (first < 0 || count < 0 || first > length - count) throw new RangeError(`AAS ${name} range ${first}+${count} exceeds ${length}`);
}

export function parseAas(bytes: Uint8Array, source = "<aas>", expectedBspChecksum?: number): AasAsset {
  const r = new BinaryReader(bytes, source);
  if (r.u32() !== 0x53414145) throw new BinaryError(source, 0, "expected EAAS magic");
  const version = r.i32();
  if (version !== 4 && version !== 5) throw new BinaryError(source, 4, `unsupported AAS version ${version}`);
  const decoded = r.bytes(116);
  if (version === 5) for (let offset = 0; offset < decoded.length; offset++) {
    const byte = decoded[offset];
    if (byte === undefined) throw new BinaryError(source, offset + 8, "truncated AAS header");
    decoded[offset] = byte ^ (offset * 119 & 255);
  }
  const header = new BinaryReader(decoded, `${source}:header`), bspChecksum = header.i32();
  if (expectedBspChecksum !== undefined && bspChecksum !== (expectedBspChecksum | 0)) throw new BinaryError(source, 8, "AAS belongs to a different BSP checksum");
  const lumps: { offset: number; length: number }[] = [];
  for (let lump = 0; lump < 14; lump++) {
    const offset = header.i32(), length = header.i32();
    if (length < 0 || length > 0 && (offset < 124 || offset > bytes.length - length)) throw new BinaryError(source, 12 + lump * 8, "invalid AAS lump range");
    lumps.push({ offset, length });
  }
  const read = <T>(lump: number, stride: number, record: (reader: BinaryReader) => T): T[] => {
    const span = lumps[lump];
    if (span === undefined) throw new Error("Missing AAS lump descriptor");
    if (span.length === 0) return [];
    const data = r.records(span.offset, span.length, stride), values: T[] = [];
    while (data.remaining > 0) values.push(record(data));
    return values;
  };
  const bboxes = read(0, 32, data => ({ presence: data.i32(), flags: data.i32(), bounds: bounds(data) }));
  const vertices = read(1, 12, vector);
  const planes = read(2, 20, data => ({ normal: vector(data), distance: data.finiteF32(), type: data.i32() }));
  const edges = read(3, 8, data => ({ vertices: pair(data) }));
  const edgeIndexes = read(4, 4, data => data.i32());
  const faces = read(5, 24, data => ({ plane: data.i32(), flags: data.i32(), edgeCount: data.i32(), firstEdge: data.i32(), frontArea: data.i32(), backArea: data.i32() }));
  const faceIndexes = read(6, 4, data => data.i32());
  const areas = read(7, 48, data => ({ number: data.i32(), faceCount: data.i32(), firstFace: data.i32(), bounds: bounds(data), center: vector(data) }));
  const settings = read(8, 28, data => ({ contents: data.i32(), flags: data.i32(), presence: data.i32(), cluster: data.i32(), clusterArea: data.i32(), reachCount: data.i32(), firstReach: data.i32() }));
  const reachability = read(9, 44, data => ({ area: data.i32(), face: data.i32(), edge: data.i32(), start: vector(data), end: vector(data), travelType: data.i32(), travelTime: data.u16(), padding: data.u16() }));
  const nodes = read(10, 12, data => ({ plane: data.i32(), children: pair(data) }));
  const portals = read(11, 20, data => ({ area: data.i32(), frontCluster: data.i32(), backCluster: data.i32(), clusterAreas: pair(data) }));
  const portalIndexes = read(12, 4, data => data.i32());
  const clusters = read(13, 16, data => ({ areaCount: data.i32(), reachabilityAreaCount: data.i32(), portalCount: data.i32(), firstPortal: data.i32() }));
  if (areas.length !== settings.length) throw new BinaryError(source, 0, "AAS area/settings counts differ");
  // AAS_OptimizeAlloc reserves a cleared edge zero even when all vertices are pruned.
  for (const [number, edge] of edges.entries()) {
    if (number === 0 && edge.vertices[0] === 0 && edge.vertices[1] === 0) continue;
    for (const vertex of edge.vertices) index(vertex, vertices.length, "vertex");
  }
  for (const edge of edgeIndexes) index(Math.abs(edge), edges.length, "edge");
  for (const face of faces) {
    index(face.plane, planes.length, "face plane"); range(face.firstEdge, face.edgeCount, edgeIndexes.length, "face edges");
    index(face.frontArea, areas.length, "front area"); index(face.backArea, areas.length, "back area");
  }
  for (const face of faceIndexes) index(Math.abs(face), faces.length, "face");
  for (const [number, area] of areas.entries()) {
    if (number !== area.number) throw new BinaryError(source, 0, "AAS area ordinal differs from stored number");
    range(area.firstFace, area.faceCount, faceIndexes.length, "area faces");
  }
  for (const setting of settings) range(setting.firstReach, setting.reachCount, reachability.length, "reachability");
  for (const reach of reachability) index(reach.area, areas.length, "reachable area");
  for (const [number, node] of nodes.entries()) if (number !== 0) {
    index(node.plane, planes.length, "node plane");
    for (const child of node.children) index(Math.abs(child), child > 0 ? nodes.length : areas.length, "node child");
  }
  for (const portal of portals) {
    index(portal.area, areas.length, "portal area"); index(portal.frontCluster, clusters.length, "front cluster"); index(portal.backCluster, clusters.length, "back cluster");
  }
  for (const portal of portalIndexes) index(portal, portals.length, "portal");
  for (const cluster of clusters) range(cluster.firstPortal, cluster.portalCount, portalIndexes.length, "cluster portals");
  return { kind: "aas", source, version, bspChecksum, lumps, bboxes, vertices, planes, edges, edgeIndexes, faces, faceIndexes,
    areas, settings, reachability, nodes, portals, portalIndexes, clusters };
}

function planeDistance(plane: AasAsset["planes"][number], point: Vec3): number {
  return Math.fround(Math.fround(Math.fround(Math.fround(point.x * plane.normal.x) + Math.fround(point.y * plane.normal.y))
    + Math.fround(point.z * plane.normal.z)) - plane.distance);
}
export function aasPointArea(asset: AasAsset, point: Vec3): number {
  let number = 1;
  for (let visits = 0; number > 0; visits++) {
    if (visits >= asset.nodes.length) throw new RangeError("Cyclic AAS BSP tree");
    const node = asset.nodes[number], plane = node === undefined ? undefined : asset.planes[node.plane];
    if (node === undefined || plane === undefined) throw new RangeError("Missing AAS BSP node/plane");
    number = planeDistance(plane, point) > 0 ? node.children[0] : node.children[1];
  }
  return -number;
}

export interface AasAreaCrossing { readonly area: number; readonly point: Vec3; }
/** AAS_TraceAreas: split near side first; solid leaves do not stop area enumeration. */
export function aasTraceAreas(asset: AasAsset, start: Vec3, end: Vec3, maximum = asset.areas.length): readonly AasAreaCrossing[] {
  if (!Number.isInteger(maximum) || maximum < 0) throw new RangeError("Invalid AAS area limit");
  const output: AasAreaCrossing[] = [], stack = [{ node: 1, start, end, depth: 0 }];
  while (stack.length > 0 && output.length < maximum) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (frame.node <= 0) { if (frame.node < 0) output.push({ area: -frame.node, point: frame.start }); continue; }
    if (frame.depth >= asset.nodes.length) throw new RangeError("Cyclic AAS BSP tree");
    const node = asset.nodes[frame.node], plane = node === undefined ? undefined : asset.planes[node.plane];
    if (node === undefined || plane === undefined) throw new RangeError("Missing AAS BSP node/plane");
    const front = planeDistance(plane, frame.start), back = planeDistance(plane, frame.end), depth = frame.depth + 1;
    if (front > 0 && back > 0) { stack.push({ ...frame, node: node.children[0], depth }); continue; }
    if (front <= 0 && back <= 0) { stack.push({ ...frame, node: node.children[1], depth }); continue; }
    const fraction = Math.max(0, Math.min(1, Math.fround(front / Math.fround(front - back))));
    const interpolate = (a: number, b: number): number => Math.fround(a + Math.fround(Math.fround(b - a) * fraction));
    const middle = { x: interpolate(frame.start.x, frame.end.x), y: interpolate(frame.start.y, frame.end.y), z: interpolate(frame.start.z, frame.end.z) };
    const near = front < 0 ? node.children[1] : node.children[0], far = front < 0 ? node.children[0] : node.children[1];
    stack.push({ node: far, start: middle, end: frame.end, depth }, { node: near, start: frame.start, end: middle, depth });
  }
  return output;
}

/** AAS_BBoxAreas uses BSP planes, including oblique area boundaries; each area appears once. */
export function aasBBoxAreas(asset: AasAsset, bounds: Bounds, maximum = asset.areas.length): readonly number[] {
  if (!Number.isInteger(maximum) || maximum < 0) throw new RangeError("Invalid AAS area limit");
  const found = new Set<number>(), stack = [{ node: 1, depth: 0 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (frame.node <= 0) { if (frame.node < 0) found.add(-frame.node); continue; }
    if (frame.depth >= asset.nodes.length) throw new RangeError("Cyclic AAS BSP tree");
    const node = asset.nodes[frame.node], plane = node === undefined ? undefined : asset.planes[node.plane];
    if (node === undefined || plane === undefined) throw new RangeError("Missing AAS BSP node/plane");
    const front = { x: plane.normal.x < 0 ? bounds.min.x : bounds.max.x,
      y: plane.normal.y < 0 ? bounds.min.y : bounds.max.y, z: plane.normal.z < 0 ? bounds.min.z : bounds.max.z };
    const back = { x: plane.normal.x < 0 ? bounds.max.x : bounds.min.x,
      y: plane.normal.y < 0 ? bounds.max.y : bounds.min.y, z: plane.normal.z < 0 ? bounds.max.z : bounds.min.z };
    if (planeDistance(plane, front) >= 0) stack.push({ node: node.children[0], depth: frame.depth + 1 });
    if (planeDistance(plane, back) < 0) stack.push({ node: node.children[1], depth: frame.depth + 1 });
  }
  return [...found].reverse().slice(0, maximum);
}
