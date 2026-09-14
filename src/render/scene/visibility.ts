/* BSP visibility and source traversal from Q1/Q2 gl_rsurf.c and Q3 tr_world.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Bounds, Plane, Vec3 } from "../../contracts/math.ts";
import type { BspChild, DecodedWorld } from "../../contracts/scene.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { q1LeafPvs } from "../../formats/q1-map/queries.ts";
import { splitDlightMask } from "../../materials/dlight.ts";
import type { DynamicLight } from "../../materials/q3-lighting.ts";
import { dot3 } from "../../core/math.ts";
import { boundsInFrustum, cameraFrustum } from "./view.ts";

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`World visibility index ${index} outside ${items.length}`);
  return value;
}

export function worldPointLeaf(map: DecodedWorld, point: Vec3): number {
  if (map.nodes.length === 0) return map.leaves.length === 0 ? -1 : 0;
  let child: BspChild = { kind: "node", index: 0 };
  while (child.kind === "node") {
    const node: DecodedWorld["nodes"][number] = at(map.nodes, child.index);
    const plane: Plane = at(map.planes, node.plane);
    child = node.children[dot3(point, plane.normal) > plane.distance ? 0 : 1];
  }
  return child.index;
}

function q2Pvs(map: Extract<DecodedWorld, { readonly kind: "q2-bsp" }>, cluster: number): Uint8Array | null {
  const visibility = map.visibility;
  if (visibility === null || cluster < 0) return null;
  const bytes = visibility.compressed, entry = at(visibility.clusters, cluster);
  const result = new Uint8Array(Math.ceil(visibility.clusters.length / 8));
  let read = entry.pvsOffset, write = 0;
  if (read < 0) return null;
  while (write < result.length) {
    const value = bytes[read++];
    if (value === undefined) throw new RangeError("Truncated Q2 PVS");
    if (value !== 0) result[write++] = value;
    else {
      const count = bytes[read++];
      if (count === undefined || count === 0 || write + count > result.length) throw new RangeError("Invalid Q2 PVS run");
      write += count;
    }
  }
  return result;
}

export interface WorldVisibilityOptions {
  readonly pvsOrigin?: Vec3;
  readonly noVis?: boolean;
  readonly noCull?: boolean;
  /** Adapters normalize Q2 visible bits and Q3 excluded bits to this set. */
  readonly visibleAreas?: ReadonlySet<number> | null;
  readonly secondaryCluster?: number | null;
  readonly q3Lights?: readonly DynamicLight[];
}

export interface VisibleWorld {
  readonly leaf: number;
  readonly leaves: readonly number[];
  readonly surfaces: readonly number[];
  readonly surfaceDlightMasks: ReadonlyMap<number, number>;
}

function remainingFrustumPlanes(bounds: Bounds, planes: readonly Plane[], bits: number): number | null {
  for (const [index, plane] of planes.entries()) {
    const bit = 1 << index;
    if ((bits & bit) === 0) continue;
    const front = { x: plane.normal.x < 0 ? bounds.min.x : bounds.max.x,
      y: plane.normal.y < 0 ? bounds.min.y : bounds.max.y, z: plane.normal.z < 0 ? bounds.min.z : bounds.max.z };
    if (Math.fround(dot3(front, plane.normal) - plane.distance) < 0) return null;
    const back = { x: plane.normal.x < 0 ? bounds.max.x : bounds.min.x,
      y: plane.normal.y < 0 ? bounds.max.y : bounds.min.y, z: plane.normal.z < 0 ? bounds.max.z : bounds.min.z };
    if (Math.fround(dot3(back, plane.normal) - plane.distance) >= 0) bits &= ~bit;
  }
  return bits;
}

export function visibleWorld(map: DecodedWorld, camera: SceneCamera, options: WorldVisibilityOptions = {}): VisibleWorld {
  const origin = options.pvsOrigin ?? camera.origin, eye = worldPointLeaf(map, origin);
  if (eye < 0) return { leaf: eye, leaves: [], surfaces: [], surfaceDlightMasks: new Map<number, number>() };
  let pvs: Uint8Array | null = null;
  let fromCluster = -1;
  if (options.noVis !== true) switch (map.kind) {
    case "q1-bsp": pvs = q1LeafPvs(map, eye); break;
    case "q2-bsp": {
      fromCluster = at(map.leaves, eye).cluster;
      pvs = q2Pvs(map, fromCluster);
      let second = options.secondaryCluster;
      if (second === undefined) {
        const leaf = at(map.leaves, eye);
        const probe = worldPointLeaf(map, { ...origin, z: origin.z + (leaf.contents === 0 ? -16 : 16) });
        const other = at(map.leaves, probe);
        second = (other.contents & 1) === 0 && other.cluster !== fromCluster ? other.cluster : null;
      }
      if (second !== null && second >= 0 && pvs !== null) {
        const other = q2Pvs(map, second);
        if (other === null) pvs = null;
        else for (let i = 0; i < pvs.length; i++) pvs[i] = (pvs[i] ?? 0) | (other[i] ?? 0);
      }
      break;
    }
    case "q3-bsp": {
      fromCluster = at(map.leaves, eye).cluster;
      const vis = map.visibility;
      if (vis !== null && fromCluster >= 0 && fromCluster < vis.clusterCount)
        pvs = vis.bits.subarray(fromCluster * vis.bytesPerCluster, (fromCluster + 1) * vis.bytesPerCluster);
      break;
    }
  }
  const planes = options.noCull === true ? [] : map.kind === "q3-bsp" ? cameraFrustum(camera).slice(0, 4) : cameraFrustum(camera), leaves: number[] = [], surfaces: number[] = [], seen = new Set<number>();
  const leafVisible = (index: number): boolean => {
    if (map.kind === "q1-bsp") return index !== 0 && (pvs === null || ((pvs[(index - 1) >> 3] ?? 0) & (1 << ((index - 1) & 7))) !== 0);
    const leaf = at<Exclude<DecodedWorld, { readonly kind: "q1-bsp" }>["leaves"][number]>(map.leaves, index);
    if (options.visibleAreas !== undefined && options.visibleAreas !== null && !options.visibleAreas.has(leaf.area)) return false;
    if (map.kind === "q3-bsp" && fromCluster < 0) return leaf.cluster !== -1;
    return pvs === null || leaf.cluster >= 0 && ((pvs[leaf.cluster >> 3] ?? 0) & (1 << (leaf.cluster & 7))) !== 0;
  };
  const lights = options.q3Lights ?? [], surfaceDlightMasks = new Map<number, number>();
  if (lights.length > 32) throw new RangeError("Q3 world lighting supports the source 32-light mask");
  const initialMask = lights.length === 32 ? -1 : (1 << lights.length) - 1;
  const pending: { readonly child: BspChild; readonly mask: number; readonly planes: number }[] = [{
    child: map.nodes.length === 0 ? { kind: "leaf", index: 0 } : { kind: "node", index: 0 }, mask: initialMask, planes: (1 << planes.length) - 1,
  }];
  while (pending.length !== 0) {
    const item = pending.pop();
    if (item === undefined) break;
    const { child, mask } = item;
    if (child.kind === "node") {
      const node = at(map.nodes, child.index);
      const remaining = map.kind === "q3-bsp" ? remainingFrustumPlanes(node.bounds, planes, item.planes)
        : boundsInFrustum(node.bounds, planes) ? item.planes : null;
      if (remaining === null) continue;
      if (map.kind === "q3-bsp") {
        const masks = splitDlightMask(lights, mask, at(map.planes, node.plane));
        pending.push({ child: node.children[1], mask: masks[1], planes: remaining }, { child: node.children[0], mask: masks[0], planes: remaining });
      }
      else {
        const plane = at(map.planes, node.plane), front = dot3(camera.origin, plane.normal) >= plane.distance ? 0 : 1;
        pending.push({ child: node.children[front === 0 ? 1 : 0], mask, planes: remaining }, { child: node.children[front], mask, planes: remaining });
      }
      continue;
    }
    if (!leafVisible(child.index)) continue;
    const leaf = at<DecodedWorld["leaves"][number]>(map.leaves, child.index);
    if (map.kind === "q3-bsp" ? remainingFrustumPlanes(leaf.bounds, planes, item.planes) === null : !boundsInFrustum(leaf.bounds, planes)) continue;
    leaves.push(child.index);
    const range = "surfaces" in leaf ? leaf.surfaces : leaf.faces;
    const members = map.kind === "q3-bsp" ? map.leafSurfaces : map.leafFaces;
    for (let i = 0; i < range.count; i++) {
      const surface = at(members, range.first + i);
      if (!seen.has(surface)) { seen.add(surface); surfaces.push(surface); surfaceDlightMasks.set(surface, mask); }
    }
  }
  return { leaf: eye, leaves, surfaces, surfaceDlightMasks };
}
