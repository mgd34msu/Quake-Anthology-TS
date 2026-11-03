// CM collision records from id Software's code/qcommon/cm_load.c and cm_local.h.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.
import type { Q3WorldGeometry, Q3BspShader as BspShader } from "../../../contracts/scene.ts";
import { add3, sub3, vec3 } from "../../../core/math.ts";
import type { Bounds, Plane, Vec3 } from "../../../core/math.ts";
import { generatePatchCollide } from "./patch.ts";
import type { CollisionDebugSurface, PatchCollide } from "./patch.ts";

export interface CollisionPlane extends Plane { readonly type: number; readonly signbits: number }
export interface CollisionNode { readonly plane: number; readonly children: readonly [number, number] }
export interface CollisionLeaf {
  readonly cluster: number; readonly area: number;
  readonly firstBrush: number; readonly brushCount: number;
  readonly firstSurface: number; readonly surfaceCount: number;
}
export interface CollisionIndexes { readonly length: number; at(index: number): number }
export interface CollisionModel {
  readonly bounds: Bounds; readonly brushes: CollisionIndexes; readonly surfaces: CollisionIndexes;
}
export interface CollisionBrush {
  readonly shader: number; readonly contents: number; readonly bounds: Bounds;
  readonly firstSide: number; readonly sideCount: number;
  checkCount: number;
}
export interface CollisionBrushSide { readonly plane: number; readonly shader: number; readonly surfaceFlags: number }
export interface CollisionPatch { readonly contents: number; readonly surfaceFlags: number; readonly collide: PatchCollide; checkCount: number }
export interface CollisionArea { flood: number; floodValid: number }
export interface CollisionPortalCounts { at(index: number): number; set(index: number, value: number): void }
export interface CollisionBoxStorage {
  readonly bounds: Bounds; readonly brush: CollisionBrush; readonly checkCount: number;
  readSide(index: number): { readonly plane: CollisionPlane; readonly surfaceFlags: number };
  setBounds(mins: Vec3, maxs: Vec3, capsule: boolean): void;
}

/** CM consumers borrow these records. The asset parser remains a separate diagnostic reader. */
export interface CollisionMapData {
  readonly kind: "collision-map";
  checkCount: number;
  readonly entities: string;
  readonly shaders: readonly BspShader[];
  readonly planes: readonly CollisionPlane[];
  readonly nodes: readonly CollisionNode[];
  readonly leaves: readonly CollisionLeaf[];
  readonly leafBrushes: CollisionIndexes;
  readonly leafSurfaces: CollisionIndexes;
  readonly brushes: readonly CollisionBrush[];
  readonly brushSides: readonly CollisionBrushSide[];
  readonly models: readonly CollisionModel[];
  patch(index: number): CollisionPatch | null;
  readonly areas: readonly CollisionArea[];
  readonly portals: CollisionPortalCounts;
  readonly clusterCount: number;
  readonly visibility: Uint8Array;
  readonly visibilityRowBytes: number | null;
  readonly box: CollisionBoxStorage | null;
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`CM source record ${index} outside allocation`);
  return value;
}
function indexOffset(index: number, stride: number, length: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError(`CM source index ${index} outside allocation of ${length} records`);
  }
  return index * stride;
}

function diagnosticIndexes(values: readonly number[]): CollisionIndexes {
  return { length: values.length, at(index: number): number { return at(values, index); } };
}

/** Decoded world geometry shares the same collision records as source CM_LoadMap. */
export function decodedCollisionMap(map: Q3WorldGeometry, debug: CollisionDebugSurface | null): CollisionMapData {
  const planes = map.planes.map(value => ({ ...value,
    type: value.normal.x === 1 ? 0 : value.normal.y === 1 ? 1 : value.normal.z === 1 ? 2 : 3,
    signbits: Number(value.normal.x < 0) | (Number(value.normal.y < 0) << 1) | (Number(value.normal.z < 0) << 2),
  }));
  const patches = new Map<number, CollisionPatch>();
  for (const [index, surface] of map.surfaces.entries()) {
    if (surface.kind !== "patch") continue;
    const shader = at(map.shaders, surface.shader);
    patches.set(index, { checkCount: 0, contents: shader.contentFlags, surfaceFlags: shader.surfaceFlags,
      collide: generatePatchCollide(surface.width, surface.height,
        map.vertices.slice(surface.vertices.first, surface.vertices.first + surface.vertices.count).map(vertex => vertex.position), debug) });
  }
  let areaCount = 0, clusterCount = 0;
  for (const leaf of map.leaves) { areaCount = Math.max(areaCount, leaf.area + 1); clusterCount = Math.max(clusterCount, leaf.cluster + 1); }
  const areas = Array.from({ length: areaCount }, () => ({ flood: 0, floodValid: 0 }));
  const portals = new Int32Array(areaCount * areaCount);
  const visibility = map.visibility === null ? new Uint8Array((clusterCount + 31) & ~31).fill(255) : new Uint8Array(map.visibility.bits.length + 8);
  if (map.visibility !== null) visibility.set(map.visibility.bits);
  return {
    kind: "collision-map", checkCount: 0, entities: map.entities, shaders: map.shaders, planes, nodes: map.nodes.map(node => ({ plane: node.plane, children: [node.children[0].kind === "node" ? node.children[0].index : -1-node.children[0].index, node.children[1].kind === "node" ? node.children[1].index : -1-node.children[1].index] })), leaves: map.leaves.map(leaf => ({ cluster: leaf.cluster, area: leaf.area, firstBrush: leaf.brushes.first, brushCount: leaf.brushes.count, firstSurface: leaf.surfaces.first, surfaceCount: leaf.surfaces.count })),
    leafBrushes: diagnosticIndexes(map.leafBrushes), leafSurfaces: diagnosticIndexes(map.leafSurfaces),
    brushes: map.brushes.map(brush => ({ shader: brush.shader, firstSide: brush.sides.first, sideCount: brush.sides.count, checkCount: 0, contents: at(map.shaders, brush.shader).contentFlags,
      // Tests can deliberately supply fewer than six sides; bounds are consumed only by the reached source test.
      get bounds(): Bounds {
        const distance = (side: number): number => at(planes, at(map.brushSides, brush.sides.first + side).plane).distance;
        return { min: vec3(-distance(0), -distance(2), -distance(4)), max: vec3(distance(1), distance(3), distance(5)) };
      },
    })),
    brushSides: map.brushSides.map(side => ({ ...side, surfaceFlags: at(map.shaders, side.shader).surfaceFlags })),
    models: map.models.map(model => ({ bounds: { min: sub3(model.bounds.min, vec3(1, 1, 1)), max: add3(model.bounds.max, vec3(1, 1, 1)) },
      brushes: diagnosticIndexes(Array.from({ length: model.brushes.count }, (_, index) => model.brushes.first + index)),
      surfaces: diagnosticIndexes(Array.from({ length: model.surfaces.count }, (_, index) => model.surfaces.first + index)),
    })),
    patch(index: number): CollisionPatch | null {
      at(map.surfaces, index);
      return patches.get(index) ?? null;
    },
    areas, portals: {
      at(index: number): number { indexOffset(index, 4, portals.length); const value = portals[index]; if (value === undefined) throw new RangeError("CM portal outside allocation"); return value; },
      set(index: number, value: number): void { indexOffset(index, 4, portals.length); portals[index] = value; },
    },
    clusterCount: map.visibility?.clusterCount ?? clusterCount, visibility,
    visibilityRowBytes: map.visibility?.bytesPerCluster ?? null, box: null,
  };
}
