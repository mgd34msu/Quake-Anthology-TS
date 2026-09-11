// Ground-face sampling follows AAS reachability's floor-normal/step clearance tests.
// All occupancy and support decisions use shared collision; movement admission happens in routing.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec3 } from "../../contracts/math.ts";
import type { DecodedWorld } from "../../contracts/scene.ts";
import type { NavigationEdge, NavigationGraph, NavigationMapIdentity, NavigationNode, NavigationProfile, NavigationSource, NavigationWorld, TraversalRequest } from "./types.ts";
import { at, clear, contents, crouchedProfile, distance, midpoint, trace, translated, validateProfile } from "./helpers.ts";
import { navigationClusters } from "./graph.ts";

export interface NavigationConnection extends TraversalRequest {
  /** Source entity ordinal or host-owned connection identifier, retained in diagnostics. */
  readonly id: number;
}
export interface NavigationConstruction {
  readonly geometry: DecodedWorld; readonly map: NavigationMapIdentity; readonly profile: NavigationProfile; readonly world: NavigationWorld;
  readonly spacing?: number; readonly linkDistance?: number; readonly maximumNodes?: number;
  /** Endpoints come from spawned map entities and their actual movement/trigger authority. */
  readonly connections?: readonly NavigationConnection[];
}
interface Candidate { readonly point: Vec3; readonly source: NavigationSource; }
function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const x = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  const y = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  const z = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const length = Math.hypot(x, y, z);
  return length === 0 ? { x: 0, y: 0, z: 0 } : { x: x / length, y: y / length, z: z / length };
}
function inside(point: Vec3, polygon: readonly Vec3[]): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = at(polygon, i), b = at(polygon, (i + 1) % polygon.length);
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 0.001) continue;
    if (sign !== 0 && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}
function polygonCandidates(polygon: readonly Vec3[], normal: Vec3, spacing: number, source: NavigationSource, publish: (candidate: Candidate) => void): void {
  if (polygon.length < 3 || normal.z <= 0) return;
  const center = polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length, z: sum.z + point.z / polygon.length }), { x: 0, y: 0, z: 0 });
  publish({ point: center, source });
  for (const vertex of polygon) publish({ point: midpoint(center, vertex), source });
  const first = at(polygon, 0), plane = first.x * normal.x + first.y * normal.y + first.z * normal.z;
  const minX = Math.min(...polygon.map(point => point.x)), maxX = Math.max(...polygon.map(point => point.x));
  const minY = Math.min(...polygon.map(point => point.y)), maxY = Math.max(...polygon.map(point => point.y));
  for (let x = Math.ceil(minX / spacing) * spacing; x <= maxX; x += spacing) for (let y = Math.ceil(minY / spacing) * spacing; y <= maxY; y += spacing) {
    const point = { x, y, z: (plane - x * normal.x - y * normal.y) / normal.z };
    if (inside(point, polygon)) publish({ point, source });
  }
}
function geometryCandidates(world: DecodedWorld, spacing: number, slope: number, publish: (candidate: Candidate) => void): void {
  const model = world.models[0];
  if (model === undefined) throw new RangeError("Navigation construction requires a world model");
  if (world.kind !== "q3-bsp" && "faces" in model) {
    for (let index = model.faces.first; index < model.faces.first + model.faces.count; index++) {
      const face = at(world.faces, index), plane = at(world.planes, face.plane), sign = face.back ? -1 : 1;
      const normal = { x: plane.normal.x * sign, y: plane.normal.y * sign, z: plane.normal.z * sign };
      if (normal.z < slope) continue;
      const polygon: Vec3[] = [];
      for (let edgeIndex = face.edges.first; edgeIndex < face.edges.first + face.edges.count; edgeIndex++) {
        const signed = at(world.surfaceEdges, edgeIndex), edge = at(world.edges, Math.abs(signed));
        polygon.push(at(world.vertices, edge.vertices[signed < 0 ? 1 : 0]));
      }
      polygonCandidates(polygon, normal, spacing, { kind: "constructed", surface: index, leaf: null }, publish);
    }
  } else if (world.kind === "q3-bsp") {
    const q3Model = at(world.models, 0);
    for (let index = q3Model.surfaces.first; index < q3Model.surfaces.first + q3Model.surfaces.count; index++) {
      const surface = at(world.surfaces, index), source: NavigationSource = { kind: "constructed", surface: index, leaf: null };
      if (surface.kind === "flare") continue;
      if (surface.kind === "patch") {
        for (let row = 0; row + 1 < surface.height; row++) for (let column = 0; column + 1 < surface.width; column++) {
          const first = surface.vertices.first + row * surface.width + column;
          const polygon = [at(world.vertices, first).position, at(world.vertices, first + 1).position,
            at(world.vertices, first + surface.width + 1).position, at(world.vertices, first + surface.width).position];
          let normal = triangleNormal(at(polygon, 0), at(polygon, 1), at(polygon, 2));
          const authoredNormal = at(world.vertices, first).normal;
          if (normal.x * authoredNormal.x + normal.y * authoredNormal.y + normal.z * authoredNormal.z < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
          if (normal.z >= slope) polygonCandidates(polygon, normal, spacing, source, publish);
        }
      } else for (let offset = surface.indices.first; offset + 2 < surface.indices.first + surface.indices.count; offset += 3) {
        const polygon = [at(world.vertices, surface.vertices.first + at(world.indices, offset)).position,
          at(world.vertices, surface.vertices.first + at(world.indices, offset + 1)).position,
          at(world.vertices, surface.vertices.first + at(world.indices, offset + 2)).position];
        let normal = triangleNormal(at(polygon, 0), at(polygon, 1), at(polygon, 2));
        const authoredNormal = at(world.vertices, surface.vertices.first + at(world.indices, offset)).normal;
        if (normal.x * authoredNormal.x + normal.y * authoredNormal.y + normal.z * authoredNormal.z < 0) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
        if (normal.z >= slope) polygonCandidates(polygon, normal, spacing, source, publish);
      }
    }
  }
}

function grounded(world: NavigationWorld, profile: NavigationProfile, point: Vec3): Vec3 | null {
  const height = -profile.shape.bounds.min.z;
  const end = { ...point, z: point.z + height - profile.maximumStep - 4 };
  let result = trace(world, profile, { ...point, z: point.z + height + profile.maximumStep + 2 }, end);
  if (result.startSolid) result = trace(world, profile, { ...point, z: point.z + height + 1 }, end);
  if (result.startSolid || result.allSolid || result.fraction === 1 || result.contact.kind !== "plane" || result.contact.plane.normal.z < profile.minimumFloorNormal) return null;
  return result.end;
}

export function constructNavigation(options: NavigationConstruction): NavigationGraph {
  const { geometry, map, profile, world } = options;
  validateProfile(profile);
  if (map.format !== geometry.kind) throw new TypeError("Navigation map identity and decoded geometry disagree");
  const spacing = options.spacing ?? 48, linkDistance = options.linkDistance ?? spacing * 2.1, maximumNodes = options.maximumNodes ?? 100000;
  if (!Number.isFinite(spacing) || spacing < 8 || !Number.isFinite(linkDistance) || linkDistance < spacing || !Number.isInteger(maximumNodes) || maximumNodes < 1) throw new RangeError("Invalid navigation construction limits");
  const nodes: NavigationNode[] = [], edges: NavigationEdge[] = [], seen = new Set<string>();
  const rejected: { source: NavigationSource; reason: string }[] = [];
  const crouched = crouchedProfile(profile);
  const insert = (origin: Vec3, source: NavigationSource, posture = profile): void => {
    const key = `${Math.round(origin.x / 8)}:${Math.round(origin.y / 8)}:${Math.round(origin.z / 4)}`;
    if (seen.has(key) || !clear(world, posture, origin, origin)) return;
    const medium = contents(world, profile, origin);
    if ((medium & 6) !== 0) return;
    if (nodes.length >= maximumNodes) throw new RangeError(`Navigation construction exceeds ${maximumNodes} nodes; no partial graph was published`);
    seen.add(key);
    nodes.push({ id: nodes.length, origin, bounds: translated(origin, posture.shape.bounds), radius: spacing / 2,
      contents: medium, flags: 0, presence: posture === profile ? 2 : 4, sourceCluster: null, source });
  };
  geometryCandidates(geometry, spacing, profile.minimumFloorNormal, candidate => {
    const origin = grounded(world, profile, candidate.point);
    if (origin !== null) insert(origin, candidate.source);
    else if (crouched !== null) {
      const crouchOrigin = grounded(world, crouched, candidate.point);
      if (crouchOrigin !== null) insert(crouchOrigin, candidate.source, crouched);
    }
  });
  for (const [index, leaf] of geometry.leaves.entries()) {
    const center = midpoint(leaf.bounds.min, leaf.bounds.max), medium = contents(world, profile, center);
    if ((medium & 9) !== 0 && (medium & 6) === 0) insert(center, { kind: "constructed", surface: null, leaf: index });
  }
  const bins = new Map<string, number[]>();
  const key = (point: Vec3, dx = 0, dy = 0): string => `${Math.floor(point.x / linkDistance) + dx}:${Math.floor(point.y / linkDistance) + dy}`;
  for (const node of nodes) { const bucket = bins.get(key(node.origin)) ?? []; bucket.push(node.id); bins.set(key(node.origin), bucket); }
  for (const node of nodes) for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (const otherId of bins.get(key(node.origin, x, y)) ?? []) {
    if (node.id === otherId) continue;
    const other = at(nodes, otherId), rise = other.origin.z - node.origin.z;
    if (Math.hypot(node.origin.x - other.origin.x, node.origin.y - other.origin.y) > linkDistance || Math.abs(rise) > Math.max(profile.maximumDrop, linkDistance)) continue;
    const mode = (node.contents & 1) !== 0 && (other.contents & 1) !== 0 ? "swim"
      : (node.contents & 8) !== 0 && (other.contents & 8) !== 0 ? "ladder"
        : rise > profile.maximumStep ? "jump" : rise < -profile.maximumStep ? "drop" : node.presence === 4 || other.presence === 4 ? "crouch" : "walk";
    if (!profile.capabilities.has(mode) || mode === "drop" && -rise > profile.maximumDrop) continue;
    if (mode === "walk" || mode === "crouch") {
      const posture = mode === "crouch" ? crouched ?? profile : profile;
      const up = profile.maximumStep + 1;
      if (!clear(world, posture, node.origin, other.origin)
        && !clear(world, posture, { ...node.origin, z: node.origin.z + up }, { ...other.origin, z: other.origin.z + up })) continue;
      const middle = midpoint(node.origin, other.origin), foot = { ...middle, z: middle.z + profile.shape.bounds.min.z };
      if (grounded(world, posture, foot) === null) continue;
    } else if (mode === "swim" && !clear(world, profile, node.origin, other.origin)) continue;
    edges.push({ id: edges.length, from: node.id, to: other.id, mode, start: node.origin, end: other.origin,
      travelSeconds: Math.max(0.01, distance(node.origin, other.origin) / 320), sourceTravelType: 0, sourceFlags: 0, hint: null, entity: null, source: node.source });
  }
  const nearest = (point: Vec3): NavigationNode | null => {
    let selected: NavigationNode | null = null, best = linkDistance * 2;
    for (const node of nodes) { const d = distance(node.origin, point); if (d < best) { selected = node; best = d; } }
    return selected;
  };
  for (const connection of options.connections ?? []) {
    const from = nearest(connection.from), to = nearest(connection.to);
    if (from === null || to === null) {
      rejected.push({ source: { kind: "constructed", surface: null, leaf: null }, reason: `Source connection ${connection.id} has no nearby navigation ${from === null ? "start" : "destination"}` });
      continue;
    }
    edges.push({ id: edges.length, from: from.id, to: to.id, mode: connection.mode, start: connection.from, end: connection.to,
      travelSeconds: 0.01, sourceTravelType: connection.id, sourceFlags: 0, hint: connection.hint, entity: connection.entity,
      source: { kind: "constructed", surface: null, leaf: null } });
  }
  return { map, profile, asset: null, nodes, edges, clusters: navigationClusters(nodes, edges), rejected };
}
