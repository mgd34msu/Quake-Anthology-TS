/* Native hull traversal adapted from Quake WinQuake/world.c and quake-1-re-ts.
 * Copyright (C) 1996 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Plane, Vec3 } from "../../../contracts/math.ts";
import type { NumericOperations, NumericProfile } from "../../../contracts/numeric.ts";
import type { Q1ClipChild, Q1Hull, Q1WorldGeometry } from "../../../contracts/scene.ts";
import { createNumericOperations } from "../../../core/numeric.ts";

export const Q1_CONTENTS_EMPTY = -1;
export const Q1_CONTENTS_SOLID = -2;
export const Q1_DISTANCE_EPSILON = 1 / 32;
const zero: Vec3 = { x: 0, y: 0, z: 0 };
export const Q1_HULL_BOUNDS: readonly Bounds[] = [
  { min: zero, max: zero },
  { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } },
  { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } },
];
export interface Q1HullTrace {
  fraction: number; end: Vec3; startSolid: boolean; allSolid: boolean;
  inOpen: boolean; inWater: boolean; plane: Plane; contents: number;
}

export function createQ1Hulls(map: Q1WorldGeometry, modelIndex = 0): readonly Q1Hull[] {
  const model = map.models[modelIndex];
  if (model === undefined) throw new RangeError(`Unknown Quake model ${modelIndex}`);
  const drawing = map.nodes.map(node => {
    const convert = (child: typeof node.children[number]): Q1ClipChild => {
      if (child.kind === "node") return { kind: "clipnode", index: child.index };
      const leaf = map.leaves[child.index];
      if (leaf === undefined) throw new RangeError("Unknown Quake hull-zero leaf");
      return { kind: "contents", value: leaf.contents };
    };
    const children: readonly [Q1ClipChild, Q1ClipChild] = [convert(node.children[0]), convert(node.children[1])];
    return { plane: node.plane, children };
  });
  return Q1_HULL_BOUNDS.map((clipBounds, index) => {
    let firstClipnode = model.headnodes[index];
    if (firstClipnode === undefined) throw new RangeError(`Missing Quake hull ${index}`);
    if (index === 0 && firstClipnode < 0) {
      const leaf = map.leaves[-1 - firstClipnode];
      if (leaf === undefined) throw new RangeError("Unknown Quake hull root leaf");
      firstClipnode = leaf.contents;
    }
    const clipnodes = index === 0 ? drawing : map.clipnodes;
    return { clipnodes, planes: map.planes, firstClipnode, lastClipnode: clipnodes.length - 1, clipBounds };
  });
}

function planeDistance(hull: Q1Hull, planeIndex: number, point: Vec3, n: NumericOperations): number {
  const plane = hull.planes[planeIndex];
  if (plane === undefined) throw new RangeError("Invalid Quake hull plane");
  if (plane.type === 0) return n.subtract(point.x, plane.distance);
  if (plane.type === 1) return n.subtract(point.y, plane.distance);
  if (plane.type === 2) return n.subtract(point.z, plane.distance);
  return n.subtract(n.add(n.add(n.multiply(point.x, plane.normal.x), n.multiply(point.y, plane.normal.y)), n.multiply(point.z, plane.normal.z)), plane.distance);
}
function childNumber(child: Q1ClipChild): number { return child.kind === "clipnode" ? child.index : child.value; }
function nodeAt(hull: Q1Hull, node: number) {
  if (node < hull.firstClipnode || node > hull.lastClipnode) throw new RangeError(`Invalid Quake hull node ${node}`);
  const value = hull.clipnodes[node];
  if (value === undefined) throw new RangeError(`Missing Quake hull node ${node}`);
  return value;
}
function contents(hull: Q1Hull, point: Vec3, node: number, n: NumericOperations): number {
  let visits = 0;
  while (node >= 0) {
    if (++visits > hull.clipnodes.length) throw new RangeError("Cycle in Quake hull");
    const clip = nodeAt(hull, node);
    node = childNumber(clip.children[planeDistance(hull, clip.plane, point, n) < 0 ? 1 : 0]);
  }
  return node;
}
export function q1HullPointContents(hull: Q1Hull, point: Vec3, numeric: NumericProfile, startNode = hull.firstClipnode): number {
  return contents(hull, point, startNode, createNumericOperations(numeric));
}

export function traceQ1Hull(hull: Q1Hull, start: Vec3, end: Vec3, numeric: NumericProfile,
  blocks: (contents: number) => boolean = c => c === Q1_CONTENTS_SOLID): Q1HullTrace {
  const n = createNumericOperations(numeric);
  const trace: Q1HullTrace = { fraction: 1, end, startSolid: false, allSolid: true, inOpen: false, inWater: false, plane: { normal: zero, distance: 0 }, contents: Q1_CONTENTS_EMPTY };
  const interpolate = (a: Vec3, b: Vec3, fraction: number): Vec3 => ({
    x: n.store(n.add(a.x, n.multiply(fraction, n.subtract(b.x, a.x)))),
    y: n.store(n.add(a.y, n.multiply(fraction, n.subtract(b.y, a.y)))),
    z: n.store(n.add(a.z, n.multiply(fraction, n.subtract(b.z, a.z)))),
  });
  function walk(node: number, p1f: number, p2f: number, p1: Vec3, p2: Vec3, depth: number): boolean {
    if (depth > hull.clipnodes.length) throw new RangeError("Cycle in Quake trace hull");
    if (node < 0) {
      if (blocks(node)) { trace.startSolid = true; trace.contents = node; }
      else { trace.allSolid = false; if (node === Q1_CONTENTS_EMPTY) trace.inOpen = true; else trace.inWater = true; }
      return true;
    }
    const clip = nodeAt(hull, node);
    const t1 = planeDistance(hull, clip.plane, p1, n), t2 = planeDistance(hull, clip.plane, p2, n);
    if (t1 >= 0 && t2 >= 0) return walk(childNumber(clip.children[0]), p1f, p2f, p1, p2, depth + 1);
    if (t1 < 0 && t2 < 0) return walk(childNumber(clip.children[1]), p1f, p2f, p1, p2, depth + 1);
    let fraction = Math.max(0, Math.min(1, n.divide(n.add(t1, t1 < 0 ? Q1_DISTANCE_EPSILON : -Q1_DISTANCE_EPSILON), n.subtract(t1, t2))));
    let midf = n.add(p1f, n.multiply(n.subtract(p2f, p1f), fraction));
    let mid = interpolate(p1, p2, fraction);
    const near = clip.children[t1 < 0 ? 1 : 0], far = clip.children[t1 < 0 ? 0 : 1];
    if (!walk(childNumber(near), p1f, midf, p1, mid, depth + 1)) return false;
    const farContents = contents(hull, mid, childNumber(far), n);
    if (!blocks(farContents)) return walk(childNumber(far), midf, p2f, mid, p2, depth + 1);
    if (trace.allSolid) return false;
    const plane = hull.planes[clip.plane];
    if (plane === undefined) throw new RangeError("Invalid Quake collision plane");
    trace.plane = t1 < 0 ? { normal: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }, distance: -plane.distance } : plane;
    trace.contents = farContents;
    while (blocks(contents(hull, mid, hull.firstClipnode, n))) {
      fraction = n.subtract(fraction, 0.1);
      if (fraction < 0) { trace.fraction = midf; trace.end = mid; return false; }
      midf = n.add(p1f, n.multiply(n.subtract(p2f, p1f), fraction));
      mid = interpolate(p1, p2, fraction);
    }
    trace.fraction = midf; trace.end = mid; trace.contents = farContents;
    return false;
  }
  walk(hull.firstClipnode, 0, 1, start, end, 0);
  return trace;
}
