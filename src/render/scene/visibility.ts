/* BSP visibility and source traversal from Q1/Q2 gl_rsurf.c and Q3 tr_world.c.
 * Copyright (C) 1996-2005 Id Software, Inc. GPL-2.0-or-later. */
import type { Plane, Vec3 } from "../../contracts/math.ts";
import type { BspChild, DecodedWorld } from "../../contracts/scene.ts";
import type { SceneCamera } from "../../contracts/render.ts";
import { q1LeafPvs } from "../../formats/q1-map/queries.ts";
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
}

export interface VisibleWorld {
  readonly leaf: number;
  readonly leaves: readonly number[];
  readonly surfaces: readonly number[];
}

export function visibleWorld(map: DecodedWorld, camera: SceneCamera, options: WorldVisibilityOptions = {}): VisibleWorld {
  const origin = options.pvsOrigin ?? camera.origin, eye = worldPointLeaf(map, origin);
  if (eye < 0) return { leaf: eye, leaves: [], surfaces: [] };
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
  const planes = options.noCull === true ? [] : cameraFrustum(camera), leaves: number[] = [], surfaces: number[] = [], seen = new Set<number>();
  const leafVisible = (index: number): boolean => {
    if (map.kind === "q1-bsp") return index !== 0 && (pvs === null || ((pvs[(index - 1) >> 3] ?? 0) & (1 << ((index - 1) & 7))) !== 0);
    const leaf = at<Exclude<DecodedWorld, { readonly kind: "q1-bsp" }>["leaves"][number]>(map.leaves, index);
    if (options.visibleAreas !== undefined && options.visibleAreas !== null && !options.visibleAreas.has(leaf.area)) return false;
    if (map.kind === "q3-bsp" && fromCluster < 0) return leaf.cluster !== -1;
    return pvs === null || leaf.cluster >= 0 && ((pvs[leaf.cluster >> 3] ?? 0) & (1 << (leaf.cluster & 7))) !== 0;
  };
  const pending: BspChild[] = map.nodes.length === 0 ? [{ kind: "leaf", index: 0 }] : [{ kind: "node", index: 0 }];
  while (pending.length !== 0) {
    const child = pending.pop();
    if (child === undefined) break;
    if (child.kind === "node") {
      const node = at(map.nodes, child.index);
      if (!boundsInFrustum(node.bounds, planes)) continue;
      if (map.kind === "q3-bsp") pending.push(node.children[1], node.children[0]);
      else {
        const plane = at(map.planes, node.plane), front = dot3(camera.origin, plane.normal) >= plane.distance ? 0 : 1;
        pending.push(node.children[front === 0 ? 1 : 0], node.children[front]);
      }
      continue;
    }
    if (!leafVisible(child.index)) continue;
    const leaf = at<DecodedWorld["leaves"][number]>(map.leaves, child.index);
    if (!boundsInFrustum(leaf.bounds, planes)) continue;
    leaves.push(child.index);
    const range = "surfaces" in leaf ? leaf.surfaces : leaf.faces;
    const members = map.kind === "q3-bsp" ? map.leafSurfaces : map.leafFaces;
    for (let i = 0; i < range.count; i++) {
      const surface = at(members, range.first + i);
      if (!seen.has(surface)) { seen.add(surface); surfaces.push(surface); }
    }
  }
  return { leaf: eye, leaves, surfaces };
}
