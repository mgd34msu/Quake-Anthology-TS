/* Solid BSP leaf cells are derived collision geometry, not recovered authored
 * brushes. Native clipnodes remain a separate source authority. GPL-2.0-or-later. */
import type { Bounds } from "../../../contracts/math.ts";
import type { BspChild, Q1WorldGeometry } from "../../../contracts/scene.ts";
import { boxCell, splitCell } from "./polyhedron.ts";
import type { ConvexCell } from "./polyhedron.ts";
export type { ConvexCell, CellFace } from "./polyhedron.ts";

export interface Q1SolidCell { readonly cell: ConvexCell; readonly leaf: number; readonly contents: number; }
export class Q1SolidSpace {
  readonly representation = "bsp-leaf-cells";
  constructor(readonly geometry: Q1WorldGeometry) {}

  /** A bounded swept shape only needs the portions of infinite leaves inside
   * its padded envelope. Repeated leaf zero references remain separate cells. */
  *cells(envelope: Bounds, modelIndex = 0, include: (contents: number) => boolean = c => c === -2): Generator<Q1SolidCell, void, undefined> {
    const model = this.geometry.models[modelIndex];
    if (model === undefined) throw new RangeError(`Unknown Quake model ${modelIndex}`);
    const root = model.headnodes[0];
    if (root === undefined) throw new RangeError("Quake model has no drawing hull");
    const first: BspChild = root < 0 ? { kind: "leaf", index: -1 - root } : { kind: "node", index: root };
    const stack: { child: BspChild; cell: ConvexCell; depth: number }[] = [{ child: first, cell: boxCell(envelope), depth: 0 }];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) break;
      if (next.child.kind === "leaf") {
        const leaf = this.geometry.leaves[next.child.index];
        if (leaf === undefined) throw new RangeError("Unknown Quake solid-space leaf");
        if (include(leaf.contents)) yield { cell: next.cell, leaf: next.child.index, contents: leaf.contents };
        continue;
      }
      if (next.depth > this.geometry.nodes.length) throw new RangeError("Cycle in Quake solid-space BSP");
      const node = this.geometry.nodes[next.child.index];
      const plane = node === undefined ? undefined : this.geometry.planes[node.plane];
      if (node === undefined || plane === undefined) throw new RangeError("Unknown Quake solid-space node/plane");
      const { front, back } = splitCell(next.cell, plane);
      if (back !== null) stack.push({ child: node.children[1], cell: back, depth: next.depth + 1 });
      if (front !== null) stack.push({ child: node.children[0], cell: front, depth: next.depth + 1 });
    }
  }
}
