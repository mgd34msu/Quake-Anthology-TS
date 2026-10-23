/* Native hull bounds come from Quake model.c. Convex BSP clipping follows
 * id Software's brush/winding representation. GPL-2.0-or-later. */
import type { Bounds, Plane } from "../../../contracts/math.ts";
import type { Q1ClipChild, Q1Hull } from "../../../contracts/scene.ts";
import { add, AXES, boxCell, boxSeparatingPlanes, cellVertices, dot, scale, splitCell, sub } from "./polyhedron.ts";
import type { ConvexCell } from "./polyhedron.ts";

function *freeCells(hull: Q1Hull, envelope: Bounds): Generator<ConvexCell, void, undefined> {
  const root: Q1ClipChild = hull.firstClipnode < 0 ? { kind: "contents", value: hull.firstClipnode } : { kind: "clipnode", index: hull.firstClipnode };
  const stack: { child: Q1ClipChild; cell: ConvexCell; depth: number }[] = [{ child: root, cell: boxCell(envelope), depth: 0 }];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    if (next.child.kind === "contents") { if (next.child.value !== -2) yield next.cell; continue; }
    if (next.depth > hull.clipnodes.length) throw new RangeError("Cycle in Quake clip-space BSP");
    const node = hull.clipnodes[next.child.index], plane = node === undefined ? undefined : hull.planes[node.plane];
    if (node === undefined || plane === undefined) throw new RangeError("Invalid Quake clip-space node");
    const { front, back } = splitCell(next.cell, plane);
    if (back !== null) stack.push({ child: node.children[1], cell: back, depth: next.depth + 1 });
    if (front !== null) stack.push({ child: node.children[0], cell: front, depth: next.depth + 1 });
  }
}

/** Subtract a convex region while retaining a convex decomposition of the rest. */
function subtractRegion(cell: ConvexCell, planes: readonly Plane[]): readonly ConvexCell[] {
  const outside: ConvexCell[] = [];
  let inside: ConvexCell | null = cell;
  for (const plane of planes) {
    const { front: remainder, back } = splitCell(inside, plane);
    if (remainder !== null) outside.push(remainder);
    inside = back;
    if (inside === null) break;
  }
  return outside;
}

/** A compiled hull S for actor box A represents solid expanded by -A.
 * S eroded by -A equals the complement of free(S) expanded by A.
 * This preserves compiler-removed clip solids for arbitrary future shapes.
 * Intersecting the two native reconstructions uses both available hulls.
 * The result is derived occupancy: lost narrow concavities can remain closed,
 * and compiler-specific bevels remain part of the available evidence. */
export function deriveQ1ClipSolids(hulls: readonly Q1Hull[], envelope: Bounds): readonly ConvexCell[] {
  let solids: readonly ConvexCell[] = [boxCell(envelope)];
  let used = false;
  for (let index = 1; index < hulls.length; index++) {
    const hull = hulls[index];
    if (hull === undefined || hull.firstClipnode < 0 && hull.firstClipnode !== -2) continue;
    used = true;
    const size = hull.clipBounds;
    const center = scale(add(size.min, size.max), 0.5), extents = scale(sub(size.max, size.min), 0.5);
    const freeEnvelope: Bounds = { min: sub(envelope.min, add(size.max, { x: 1, y: 1, z: 1 })), max: sub(envelope.max, sub(size.min, { x: 1, y: 1, z: 1 })) };
    for (const free of freeCells(hull, freeEnvelope)) {
      const expanded = boxSeparatingPlanes(free, AXES).map(plane => ({ normal: plane.normal,
        distance: plane.distance + dot(plane.normal, center) + Math.abs(plane.normal.x) * extents.x + Math.abs(plane.normal.y) * extents.y + Math.abs(plane.normal.z) * extents.z }));
      solids = solids.flatMap(cell => subtractRegion(cell, expanded));
      if (solids.length === 0) return solids;
    }
  }
  return used ? solids : [];
}

interface PreparedFreeCell {
  /** Conservative model-space bounds of the expanded (eroded) free region. */
  readonly bounds: Bounds;
  readonly expanded: readonly Plane[];
}

export type PreparedClipDeriver = (envelope: Bounds) => readonly ConvexCell[] | null;

function cellBounds(cell: ConvexCell): Bounds {
  let min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of cellVertices(cell)) {
    min = { x: Math.min(min.x, vertex.x), y: Math.min(min.y, vertex.y), z: Math.min(min.z, vertex.z) };
    max = { x: Math.max(max.x, vertex.x), y: Math.max(max.y, vertex.y), z: Math.max(max.z, vertex.z) };
  }
  return { min, max };
}

const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;

/** Precompute each hull's free-space decomposition and expanded planes once.
 * The per-envelope derivation only depends on free space inside its grown
 * free envelope (the erosion of free space farther than one hull box away
 * cannot reach the envelope), so subtracting the prepared whole-hull cells
 * whose expanded bounds overlap the envelope reproduces
 * deriveQ1ClipSolids inside the prepared bounds. Returns null for
 * envelopes escaping those bounds. */
export function prepareQ1ClipSolids(hulls: readonly Q1Hull[]): PreparedClipDeriver {
  const margin = 4096;
  let bounds: Bounds | null = null;
  const perHull: PreparedFreeCell[][] = [];
  let used = false;
  for (let index = 1; index < hulls.length; index++) {
    const hull = hulls[index];
    if (hull === undefined || hull.firstClipnode < 0 && hull.firstClipnode !== -2) continue;
    used = true;
    const size = hull.clipBounds;
    bounds = bounds === null ? { min: { ...size.min }, max: { ...size.max } }
      : { min: { x: Math.min(bounds.min.x, size.min.x), y: Math.min(bounds.min.y, size.min.y), z: Math.min(bounds.min.z, size.min.z) },
          max: { x: Math.max(bounds.max.x, size.max.x), y: Math.max(bounds.max.y, size.max.y), z: Math.max(bounds.max.z, size.max.z) } };
  }
  if (!used || bounds === null) return () => [];
  const prepared: Bounds = {
    min: { x: bounds.min.x - margin, y: bounds.min.y - margin, z: bounds.min.z - margin },
    max: { x: bounds.max.x + margin, y: bounds.max.y + margin, z: bounds.max.z + margin } };
  for (let index = 1; index < hulls.length; index++) {
    const hull = hulls[index];
    if (hull === undefined || hull.firstClipnode < 0 && hull.firstClipnode !== -2) continue;
    const size = hull.clipBounds;
    const center = scale(add(size.min, size.max), 0.5), extents = scale(sub(size.max, size.min), 0.5);
    const freeEnvelope: Bounds = { min: sub(prepared.min, add(size.max, { x: 1, y: 1, z: 1 })), max: sub(prepared.max, sub(size.min, { x: 1, y: 1, z: 1 })) };
    const entries: PreparedFreeCell[] = [];
    for (const free of freeCells(hull, freeEnvelope)) {
      const expanded = boxSeparatingPlanes(free, AXES).map(plane => ({ normal: plane.normal,
        distance: plane.distance + dot(plane.normal, center) + Math.abs(plane.normal.x) * extents.x + Math.abs(plane.normal.y) * extents.y + Math.abs(plane.normal.z) * extents.z }));
      const freeBounds = cellBounds(free);
      entries.push({ expanded, bounds: {
        min: sub(freeBounds.min, add(size.max, { x: 1, y: 1, z: 1 })),
        max: sub(freeBounds.max, sub(size.min, { x: 1, y: 1, z: 1 })) } });
    }
    perHull.push(entries);
  }
  // Spatial index over expanded bounds so a trace only subtracts nearby
  // free cells. Entries spanning many grid cells are few (outer void) and
  // are checked on every query instead.
  const GRID = 512;
  const gridKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  const indexed = perHull.map(entries => {
    const grid = new Map<string, number[]>(), always: number[] = [];
    entries.forEach((entry, index) => {
      const x0 = Math.floor(entry.bounds.min.x / GRID), x1 = Math.floor(entry.bounds.max.x / GRID);
      const y0 = Math.floor(entry.bounds.min.y / GRID), y1 = Math.floor(entry.bounds.max.y / GRID);
      const z0 = Math.floor(entry.bounds.min.z / GRID), z1 = Math.floor(entry.bounds.max.z / GRID);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 16) { always.push(index); return; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const key = gridKey(x, y, z), list = grid.get(key);
        if (list === undefined) grid.set(key, [index]); else list.push(index);
      }
    });
    return { entries, grid, always, seen: new Int32Array(entries.length), stamp: 0 };
  });
  return (envelope: Bounds): readonly ConvexCell[] | null => {
    if (!overlaps(envelope, prepared)
      || envelope.min.x < prepared.min.x || envelope.min.y < prepared.min.y || envelope.min.z < prepared.min.z
      || envelope.max.x > prepared.max.x || envelope.max.y > prepared.max.y || envelope.max.z > prepared.max.z) return null;
    let solids: readonly ConvexCell[] = [boxCell(envelope)];
    const x0 = Math.floor(envelope.min.x / GRID), x1 = Math.floor(envelope.max.x / GRID);
    const y0 = Math.floor(envelope.min.y / GRID), y1 = Math.floor(envelope.max.y / GRID);
    const z0 = Math.floor(envelope.min.z / GRID), z1 = Math.floor(envelope.max.z / GRID);
    for (const hullIndex of indexed) {
      hullIndex.stamp++;
      const consider = (index: number): boolean => {
        if (hullIndex.seen[index] === hullIndex.stamp) return true;
        hullIndex.seen[index] = hullIndex.stamp;
        const entry = hullIndex.entries[index];
        if (entry !== undefined && overlaps(entry.bounds, envelope)) {
          solids = solids.flatMap(cell => subtractRegion(cell, entry.expanded));
        }
        return solids.length > 0;
      };
      for (const index of hullIndex.always) if (!consider(index)) return solids;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const list = hullIndex.grid.get(gridKey(x, y, z));
        if (list === undefined) continue;
        for (const index of list) if (!consider(index)) return solids;
      }
    }
    return solids;
  };
}
