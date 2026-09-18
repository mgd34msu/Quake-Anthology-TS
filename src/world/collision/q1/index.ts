/* Quake hull selection/PVS derive from id Software world.c/model.c.
 * Arbitrary shapes use derived BSP cells or authored BSPX BRUSHLIST.
 * Copyright (C) 1996 Id Software, Inc. GPL-2.0-or-later. */
import type { Axis, Bounds, Plane, Vec3 } from "../../../contracts/math.ts";
import type { BspChild, LeafQueryResult, PointContentsQuery, Q1Hull, Q1WorldGeometry, SceneQueries, TracePolicy, TraceQuery, TraceResult } from "../../../contracts/scene.ts";
import { angleVectors } from "../../../core/math.ts";
import { createNumericOperations } from "../../../core/numeric.ts";
import { q1SurfaceKind } from "../../../materials/legacy.ts";
import { q1FaceAtContact, q1LeafPvs } from "../../../formats/q1-map/queries.ts";
import { Q1SolidSpace } from "../../geometry/q1-solid/index.ts";
import { deriveQ1ClipSolids } from "../../geometry/q1-solid/clipspace.ts";
import { add, AXES, boxCell, clipCell, dot, lerp, scale, sub } from "../../geometry/q1-solid/polyhedron.ts";
import type { ConvexCell } from "../../geometry/q1-solid/polyhedron.ts";
import { shapeSupport, sweepBoxCell, sweepCapsuleCell } from "../../geometry/q1-solid/sweep.ts";
import type { CellShape, SweepInterval } from "../../geometry/q1-solid/sweep.ts";
import { createQ1Hulls, Q1_DISTANCE_EPSILON, Q1_HULL_BOUNDS, q1HullPointContents, traceQ1Hull } from "./hull.ts";
export { createQ1Hulls, Q1_CONTENTS_EMPTY, Q1_CONTENTS_SOLID, Q1_DISTANCE_EPSILON, Q1_HULL_BOUNDS, q1HullPointContents, traceQ1Hull } from "./hull.ts";
export type { Q1HullTrace } from "./hull.ts";

export type Q1CollisionTrace = Extract<TraceResult, { kind: "q1" }> & { readonly contents: number };
export interface Q1CollisionOptions { readonly blocksContents?: (contents: number, policy: TracePolicy) => boolean; }
const zero: Vec3 = { x: 0, y: 0, z: 0 };
const zeroPlane: Plane = { normal: zero, distance: 0 };
const envelopeCoordinate = (value: number): string => Object.is(value, -0) ? "-0" : String(value);
const dimensions = (bounds: Bounds): Vec3 => sub(bounds.max, bounds.min);
function equal(a: Vec3, b: Vec3): boolean { return a.x === b.x && a.y === b.y && a.z === b.z; }
function basis(angles: Vec3): Axis {
  if (equal(angles, zero)) return AXES;
  const vectors = angleVectors(angles);
  return [vectors.forward, scale(vectors.right, -1), vectors.up];
}
const toLocal = (v: Vec3, axis: Axis): Vec3 => ({ x: dot(v, axis[0]), y: dot(v, axis[1]), z: dot(v, axis[2]) });
const fromLocal = (v: Vec3, axis: Axis): Vec3 => add(add(scale(axis[0], v.x), scale(axis[1], v.y)), scale(axis[2], v.z));
function worldPlane(plane: Plane, axis: Axis, origin: Vec3): Plane {
  const normal = fromLocal(plane.normal, axis);
  return { normal, distance: plane.distance + dot(normal, origin) };
}

/** Raw results retain Q1 contents. Shared collision translates other API dialects. */
export class Q1Collision implements SceneQueries {
  readonly solidSpace: Q1SolidSpace;
  private readonly hulls = new Map<number, readonly Q1Hull[]>();
  private readonly contactFaces = new Map<number, ReadonlyMap<string, readonly number[]>>();
  private readonly pvs = new Map<number, Uint8Array>();
  private readonly phs = new Map<number, Uint8Array>();
  private readonly blocks: (contents: number, policy: TracePolicy) => boolean;
  private readonly clipHullIds = new WeakMap<readonly Q1Hull[], number>();
  private nextClipHullId = 0;
  private readonly clipCells = new Map<string, { readonly cells: readonly ConvexCell[]; readonly faces: number; readonly vertices: number }>();
  private clipCellCount = 0;
  private clipFaceCount = 0;
  private clipVertexCount = 0;
  constructor(readonly geometry: Q1WorldGeometry, options: Q1CollisionOptions = {}) {
    this.solidSpace = new Q1SolidSpace(geometry);
    this.blocks = options.blocksContents ?? (contents => contents === -2);
  }
  nativeHulls(model = 0): readonly Q1Hull[] {
    let hulls = this.hulls.get(model);
    if (hulls === undefined) { hulls = createQ1Hulls(this.geometry, model); this.hulls.set(model, hulls); }
    return hulls;
  }
  /** The inverse native-hull construction retains clip-only evidence, with
   * native-sized concavities conservatively closed when compilation lost them. */
  geometryCoverage(model = 0): { readonly arbitraryShapes: "bspx-brushes" | "drawing-bsp-cells"; readonly clipOnly: "brushes" | "derived-native-clipspace" } {
    const brushes = this.geometry.brushList?.find(entry => entry.model === model);
    return brushes === undefined ? { arbitraryShapes: "drawing-bsp-cells", clipOnly: "derived-native-clipspace" } : { arbitraryShapes: "bspx-brushes", clipOnly: "brushes" };
  }
  private surfaceFlags(model: number, point: Vec3, plane: Plane): number | undefined {
    const key = (value: Plane): string => `${value.normal.x},${value.normal.y},${value.normal.z},${value.distance}`;
    let indexed = this.contactFaces.get(model);
    if (indexed === undefined) {
      const range = this.geometry.models[model]?.faces;
      if (range === undefined) throw new RangeError(`Unknown Quake model ${model}`);
      const faces = new Map<string, number[]>();
      for (let i = range.first; i < range.first + range.count; i++) {
        const face = this.geometry.faces[i], authored = face === undefined ? undefined : this.geometry.planes[face.plane];
        if (face === undefined || authored === undefined) throw new RangeError("Missing Quake face plane");
        const oriented = face.back ? { normal: scale(authored.normal, -1), distance: -authored.distance } : authored;
        const id = key(oriented), entries = faces.get(id);
        if (entries === undefined) faces.set(id, [i]); else entries.push(i);
      }
      indexed = faces;
      this.contactFaces.set(model, indexed);
    }
    const candidates = indexed.get(key(plane));
    if (candidates === undefined) return undefined;
    const index = q1FaceAtContact(this.geometry, candidates, point, plane);
    if (index === null) return undefined;
    const face = this.geometry.faces[index], info = face === undefined ? undefined : this.geometry.textureInfo[face.textureInfo];
    const texture = info === undefined ? undefined : this.geometry.textures[info.texture];
    // Q1 model.c SURF_DRAWSKY derives from the authored miptexture name.
    return texture === undefined || texture === null ? undefined : q1SurfaceKind(texture.name) === "sky" ? 4 : 0;
  }
  trace(query: TraceQuery): Q1CollisionTrace {
    createNumericOperations(query.numeric);
    const model = query.target.kind === "world" ? 0 : query.target.model;
    const origin = query.target.kind === "world" ? zero : query.target.origin;
    const axis = basis(query.target.kind === "world" ? zero : query.target.angles);
    const bounds = query.shape.kind === "point" ? Q1_HULL_BOUNDS[0] : query.shape.bounds;
    if (bounds === undefined) throw new Error("Missing Quake point hull bounds");
    let hullIndex: number | null = null;
    if (query.shape.kind === "point") hullIndex = 0;
    if (query.policy.kind === "q1") {
      if (query.policy.hull !== null) hullIndex = query.policy.hull;
      else if (query.shape.kind === "box") {
        const size = dimensions(bounds);
        const index = Q1_HULL_BOUNDS.findIndex(hull => equal(dimensions(hull), size));
        if (index >= 0) hullIndex = index;
      }
    }
    if (hullIndex !== null) {
      const hull = this.nativeHulls(model)[hullIndex];
      if (hull === undefined) throw new RangeError(`Unsupported Quake native hull ${hullIndex}`);
      const offset = add(origin, sub(hull.clipBounds.min, bounds.min));
      const trace = traceQ1Hull(hull, toLocal(sub(query.start, offset), axis), toLocal(sub(query.end, offset), axis), query.numeric, contents => this.blocks(contents, query.policy));
      const plane = worldPlane(trace.plane, axis, offset);
      const hit = trace.fraction < 1 || trace.startSolid;
      const surfaceFlags = hullIndex === 0 && trace.fraction < 1 && !trace.allSolid ? this.surfaceFlags(model, trace.end, trace.plane) : undefined;
      return { kind: "q1", ...(surfaceFlags === undefined ? {} : { surfaceFlags }), fraction: trace.fraction, end: trace.fraction === 1 ? query.end : add(fromLocal(trace.end, axis), offset),
        startSolid: trace.startSolid, allSolid: trace.allSolid, inOpen: trace.inOpen, inWater: trace.inWater,
        sourcePlane: { normal: plane.normal, distance: trace.plane.distance }, contact: trace.fraction < 1 ? { kind: "plane", plane } : { kind: "none" },
        hit: hit ? { kind: "world", model } : { kind: "none" }, contents: trace.contents };
    }
    const centerOffset = scale(add(bounds.min, bounds.max), 0.5), extents = scale(dimensions(bounds), 0.5);
    const centerStart = toLocal(sub(add(query.start, centerOffset), origin), axis), centerEnd = toLocal(sub(add(query.end, centerOffset), origin), axis);
    const localAxes: Axis = [toLocal(AXES[0], axis), toLocal(AXES[1], axis), toLocal(AXES[2], axis)];
    const radius = Math.min(extents.x, extents.y, extents.z);
    const shape: CellShape = query.shape.kind === "capsule"
      ? { kind: "capsule", axis: localAxes[2], radius, halfSegment: Math.max(0, extents.z - radius) }
      : { kind: "box", axes: localAxes, extents };
    const pad = { x: shapeSupport(shape, AXES[0]) + 1, y: shapeSupport(shape, AXES[1]) + 1, z: shapeSupport(shape, AXES[2]) + 1 };
    const envelope: Bounds = { min: { x: Math.min(centerStart.x, centerEnd.x) - pad.x, y: Math.min(centerStart.y, centerEnd.y) - pad.y, z: Math.min(centerStart.z, centerEnd.z) - pad.z },
      max: { x: Math.max(centerStart.x, centerEnd.x) + pad.x, y: Math.max(centerStart.y, centerEnd.y) + pad.y, z: Math.max(centerStart.z, centerEnd.z) + pad.z } };
    const intervals: (SweepInterval & { readonly contents: number })[] = [];
    for (const solid of this.cells(envelope, model, query.policy)) {
      const interval = shape.kind === "box" ? sweepBoxCell(solid.cell, centerStart, centerEnd, shape, Q1_DISTANCE_EPSILON) : sweepCapsuleCell(solid.cell, centerStart, centerEnd, shape, Q1_DISTANCE_EPSILON);
      if (interval !== null) intervals.push({ ...interval, contents: solid.contents });
    }
    intervals.sort((a, b) => a.enter - b.enter);
    let startSolid = false, covered = -Infinity, fraction = 1, plane = zeroPlane, contents = -1;
    for (const interval of intervals) {
      if (interval.enter <= 0) { startSolid = true; contents = interval.contents; covered = Math.max(covered, interval.exit); continue; }
      if (startSolid && interval.enter <= covered + 1e-8) { covered = Math.max(covered, interval.exit); continue; }
      fraction = Math.max(0, interval.contact); plane = interval.plane; contents = interval.contents; break;
    }
    const pointHull = this.nativeHulls(model)[0];
    if (pointHull === undefined) throw new Error("Missing Quake point hull");
    const environment = traceQ1Hull(pointHull, toLocal(sub(query.start, origin), axis),
      toLocal(sub(lerp(query.start, query.end, fraction), origin), axis), query.numeric);
    const transformed = worldPlane(plane, axis, origin);
    return { kind: "q1", fraction, end: fraction === 1 ? query.end : lerp(query.start, query.end, fraction), startSolid, allSolid: startSolid && covered >= 1,
      inOpen: environment.inOpen, inWater: environment.inWater, sourcePlane: { normal: transformed.normal, distance: plane.distance },
      contact: fraction < 1 ? { kind: "plane", plane: transformed } : { kind: "none" }, hit: fraction < 1 || startSolid ? { kind: "world", model } : { kind: "none" }, contents };
  }
  private *cells(envelope: Bounds, model: number, policy: TracePolicy): Generator<{ cell: ConvexCell; contents: number }, void, undefined> {
    const authored = this.geometry.brushList?.find(entry => entry.model === model);
    if (authored === undefined) {
      yield* this.solidSpace.cells(envelope, model, contents => this.blocks(contents, policy));
      if (this.blocks(-2, policy)) for (const cell of this.derivedClipCells(this.nativeHulls(model), envelope)) yield { cell, contents: -2 };
      return;
    }
    for (const brush of authored.brushes) {
      if (!this.blocks(brush.contents, policy)) continue;
      let cell: ConvexCell | null = boxCell(brush.bounds);
      for (const plane of brush.planes) { cell = clipCell(cell, plane); if (cell === null) break; }
      if (cell !== null) yield { cell, contents: brush.contents };
    }
  }
  private derivedClipCells(hulls: readonly Q1Hull[], envelope: Bounds): readonly ConvexCell[] {
    const { min, max } = envelope;
    if (!Number.isFinite(min.x) || !Number.isFinite(min.y) || !Number.isFinite(min.z)
      || !Number.isFinite(max.x) || !Number.isFinite(max.y) || !Number.isFinite(max.z)) return deriveQ1ClipSolids(hulls, envelope);
    let hullId = this.clipHullIds.get(hulls);
    if (hullId === undefined) { hullId = this.nextClipHullId++; this.clipHullIds.set(hulls, hullId); }
    const key = `${hullId}:${envelopeCoordinate(min.x)},${envelopeCoordinate(min.y)},${envelopeCoordinate(min.z)},${envelopeCoordinate(max.x)},${envelopeCoordinate(max.y)},${envelopeCoordinate(max.z)}`;
    const cached = this.clipCells.get(key);
    if (cached !== undefined) { this.clipCells.delete(key); this.clipCells.set(key, cached); return cached.cells; }
    const cells = deriveQ1ClipSolids(hulls, envelope);
    if (cells.length > 1024) return cells;
    let faces = 0, vertices = 0;
    for (const cell of cells) {
      faces += cell.faces.length;
      if (faces > 4096) return cells;
      for (const face of cell.faces) {
        vertices += face.vertices.length;
        if (vertices > 16384) return cells;
      }
    }
    while (this.clipCells.size >= 128 || this.clipCellCount + cells.length > 1024
      || this.clipFaceCount + faces > 4096 || this.clipVertexCount + vertices > 16384) {
      const oldest = this.clipCells.entries().next().value;
      if (oldest === undefined) throw new Error("Quake clip-cell cache accounting is inconsistent");
      this.clipCells.delete(oldest[0]);
      this.clipCellCount -= oldest[1].cells.length; this.clipFaceCount -= oldest[1].faces; this.clipVertexCount -= oldest[1].vertices;
    }
    this.clipCells.set(key, { cells, faces, vertices });
    this.clipCellCount += cells.length; this.clipFaceCount += faces; this.clipVertexCount += vertices;
    return cells;
  }
  pointContents(query: PointContentsQuery): { readonly kind: "q1"; readonly contents: number } {
    const model = query.target.kind === "world" ? 0 : query.target.model;
    const point = query.target.kind === "world" ? query.point : toLocal(sub(query.point, query.target.origin), basis(query.target.angles));
    const hull = this.nativeHulls(model)[0];
    if (hull === undefined) throw new Error("Missing Quake point hull");
    return { kind: "q1", contents: q1HullPointContents(hull, point, query.numeric) };
  }
  leafAt(point: Vec3, model = 0): number {
    const root = this.geometry.models[model]?.headnodes[0];
    if (root === undefined) throw new RangeError(`Unknown Quake model ${model}`);
    let child: BspChild = root < 0 ? { kind: "leaf", index: -1 - root } : { kind: "node", index: root };
    for (let depth = 0; depth <= this.geometry.nodes.length; depth++) {
      if (child.kind === "leaf") return child.index;
      const node = this.geometry.nodes[child.index], plane = node === undefined ? undefined : this.geometry.planes[node.plane];
      if (node === undefined || plane === undefined) throw new RangeError("Invalid Quake BSP node");
      child = node.children[dot(point, plane.normal) - plane.distance < 0 ? 1 : 0];
    }
    throw new RangeError("Cycle in Quake BSP");
  }
  pointLeaf(point: Vec3, model = 0): number { return this.leafAt(point, model); }
  leafCluster(leaf: number): number { return leaf === 0 ? -1 : leaf - 1; }
  leafArea(_leaf: number): number { return 0; }
  modelBounds(model: number): Bounds {
    const value = this.geometry.models[model];
    if (value === undefined) throw new RangeError(`Unknown Quake model ${model}`);
    return value.bounds;
  }
  areaBits(_area: number): Uint8Array { return Uint8Array.of(1); }
  areasConnected(first: number, second: number): boolean { return first === 0 && second === 0; }
  boxLeaves(bounds: Bounds, limit: number): LeafQueryResult {
    const root = this.geometry.models[0]?.headnodes[0];
    if (root === undefined) throw new RangeError("Missing Quake world root");
    const leaves: number[] = [], seen = new Set<number>();
    let topnode: number | null = null, overflow = false;
    const stack: BspChild[] = [root < 0 ? { kind: "leaf", index: -1 - root } : { kind: "node", index: root }];
    while (stack.length > 0) {
      const child = stack.pop();
      if (child === undefined) break;
      if (child.kind === "leaf") {
        if (child.index === 0 || seen.has(child.index)) continue;
        seen.add(child.index);
        if (leaves.length < limit) leaves.push(child.index); else overflow = true;
        continue;
      }
      const node = this.geometry.nodes[child.index], plane = node === undefined ? undefined : this.geometry.planes[node.plane];
      if (node === undefined || plane === undefined) throw new RangeError("Invalid Quake leaf query node");
      const center = scale(add(bounds.min, bounds.max), 0.5), extents = scale(sub(bounds.max, bounds.min), 0.5);
      const d = dot(center, plane.normal) - plane.distance, r = Math.abs(plane.normal.x) * extents.x + Math.abs(plane.normal.y) * extents.y + Math.abs(plane.normal.z) * extents.z;
      if (d >= r) stack.push(node.children[0]);
      else if (d < -r) stack.push(node.children[1]);
      else { if (topnode === null) topnode = child.index; stack.push(node.children[1], node.children[0]); }
    }
    return { leaves, topnode, overflow };
  }
  private visibility(leaf: number, kind: "pvs" | "phs"): Uint8Array {
    const cache = kind === "pvs" ? this.pvs : this.phs;
    let row = cache.get(leaf);
    if (row !== undefined) return row;
    row = q1LeafPvs(this.geometry, leaf).slice();
    if (kind === "phs") {
      const source = row.slice();
      for (let i = 1; i < this.geometry.leaves.length; i++) {
        if (((source[(i - 1) >> 3] ?? 0) & (1 << ((i - 1) & 7))) === 0) continue;
        const visible = this.visibility(i, "pvs");
        for (let j = 0; j < row.length; j++) row[j] = (row[j] ?? 0) | (visible[j] ?? 0);
      }
    }
    cache.set(leaf, row); return row;
  }
  clusterVisible(from: number, to: number, kind: "pvs" | "phs" = "pvs"): boolean {
    if (to < 0) return false;
    if (from < 0) return true;
    const row = this.visibility(from + 1, kind);
    return ((row[to >> 3] ?? 0) & (1 << (to & 7))) !== 0;
  }
}
export function createQ1Collision(geometry: Q1WorldGeometry, options: Q1CollisionOptions = {}): Q1Collision {
  return new Q1Collision(geometry, options);
}
