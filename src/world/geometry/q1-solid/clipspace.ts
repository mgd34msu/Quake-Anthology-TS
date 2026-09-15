/* Native hull bounds come from Quake model.c. Convex BSP clipping follows
 * id Software's brush/winding representation. GPL-2.0-or-later. */
import type { Bounds, Plane } from "../../../contracts/math.ts";
import type { Q1ClipChild, Q1Hull } from "../../../contracts/scene.ts";
import { add, AXES, boxCell, boxSeparatingPlanes, dot, scale, splitCell, sub } from "./polyhedron.ts";
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
