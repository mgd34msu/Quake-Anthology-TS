/* Material geometry uses the source Q3 vertex byte colors until stage evaluation.
 * Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Q3BspVertex } from "../contracts/scene.ts";
/** Byte units, 0..255; stage evaluation returns normalized renderer colors. */
export type MaterialVertex = Q3BspVertex;

export interface MaterialGeometry {
  readonly vertices: readonly MaterialVertex[];
  readonly indices: readonly number[];
}

export class MaterialDeformState {
  constructor(private geometry: MaterialGeometry, readonly refdefTime: number,
    readonly renderText: readonly string[] = [], readonly material: { readonly name: string } | null = null) {}

  snapshotGeometry(): MaterialGeometry { return this.geometry; }
  replaceGeometry(geometry: MaterialGeometry): void { this.geometry = geometry; }
  resetGeometry(): void { this.geometry = { vertices: [], indices: [] }; }
  textQuad(): readonly [MaterialVertex, MaterialVertex, MaterialVertex, MaterialVertex] {
    const [a, b, c, d] = this.geometry.vertices;
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error("Text deformation requires a four-vertex source quad");
    return [a, b, c, d];
  }
  appendGeometry(geometry: MaterialGeometry, _kind: "stamp"): void {
    const offset = this.geometry.vertices.length;
    this.geometry = { vertices: [...this.geometry.vertices, ...geometry.vertices],
      indices: [...this.geometry.indices, ...geometry.indices.map(index => offset + index)] };
  }
}
