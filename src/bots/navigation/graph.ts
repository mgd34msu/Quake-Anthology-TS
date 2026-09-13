// Travel vocabulary: id Software be_aas.h; Q1 NAV2 and q2repro inc/server/nav.h.
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Vec3 } from "../../contracts/math.ts";
import type { AasAsset } from "./aas.ts";
import type { KexNavigationAsset } from "./nav.ts";
import type { NavigationEdge, NavigationGraph, NavigationMapIdentity, NavigationNode, NavigationProfile, NavigationWorld, TravelMode } from "./types.ts";
import { at, clear, contents, crouchedProfile, distance, trace, translated, validateProfile } from "./helpers.ts";

const aasModes: readonly TravelMode[] = ["unknown", "unknown", "walk", "crouch", "jump", "jump", "ladder", "drop", "swim", "water-jump",
  "teleport", "mover", "rocket-jump", "bfg-jump", "grapple", "double-jump", "ramp-jump", "strafe-jump", "jump-pad", "mover"];
const kexModes: readonly TravelMode[] = ["walk", "jump", "teleport", "drop", "jump-pad", "jump", "mover", "mover", "jump", "crouch", "ladder", "jump", "jump", "rocket-jump", "unknown"];
export function aasTravelMode(type: number): TravelMode { return aasModes[type & 0xffffff] ?? "unknown"; }
export function kexTravelMode(type: number): TravelMode { return kexModes[type] ?? "unknown"; }
/** Source travel flags preserve the unused bit between LADDER and WALKOFFLEDGE. */
export function aasTravelFlag(type: number): number {
  const index = type & 0xffffff;
  return index < 2 || index > 19 ? 1 : index === 19 ? 0x01000000 : 1 << (index >= 7 ? index : index - 1);
}
export function aasAreaTravelFlags(setting: AasAsset["settings"][number]): number {
  const value = setting.contents;
  return ((value & 1) !== 0 ? 0x00100000 : (value & 4) !== 0 ? 0x00200000 : (value & 2) !== 0 ? 0x00400000 : 0x00080000)
    | ((value & 256) !== 0 ? 0x00800000 : 0) | ((value & 2048) !== 0 ? 0x08000000 : 0)
    | ((value & 4096) !== 0 ? 0x10000000 : 0) | ((setting.flags & 16) !== 0 ? 0x04000000 : 0);
}

/** Directed components support drops/teleports without falsely declaring reverse reachability. */
export function navigationClusters(nodes: readonly NavigationNode[], edges: readonly NavigationEdge[]): readonly (readonly number[])[] {
  const outgoing = new Map<number, number[]>(), incoming = new Map<number, number[]>();
  for (const node of nodes) { outgoing.set(node.id, []); incoming.set(node.id, []); }
  for (const edge of edges) { outgoing.get(edge.from)?.push(edge.to); incoming.get(edge.to)?.push(edge.from); }
  const seen = new Set<number>(), order: number[] = [];
  for (const node of nodes) {
    const stack = [{ node: node.id, exit: false }];
    while (stack.length > 0) {
      const frame = stack.pop();
      if (frame === undefined) break;
      if (frame.exit) { order.push(frame.node); continue; }
      if (seen.has(frame.node)) continue;
      seen.add(frame.node); stack.push({ node: frame.node, exit: true });
      for (const next of outgoing.get(frame.node) ?? []) if (!seen.has(next)) stack.push({ node: next, exit: false });
    }
  }
  seen.clear();
  const clusters: number[][] = [];
  for (const start of order.reverse()) {
    if (seen.has(start)) continue;
    const cluster: number[] = [], stack = [start];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined || seen.has(node)) continue;
      seen.add(node); cluster.push(node);
      for (const next of incoming.get(node) ?? []) if (!seen.has(next)) stack.push(next);
    }
    clusters.push(cluster);
  }
  return clusters;
}

export function navigationFromAsset(map: NavigationMapIdentity, asset: AasAsset | KexNavigationAsset,
  profile: NavigationProfile, world: NavigationWorld): NavigationGraph {
  validateProfile(profile);
  const nodes: NavigationNode[] = [], edges: NavigationEdge[] = [];
  if (asset.kind === "aas") {
    for (let number = 1; number < asset.areas.length; number++) {
      const area = at(asset.areas, number), setting = at(asset.settings, number);
      const posture = (setting.presence & 2) === 0 && (setting.presence & 4) !== 0 ? crouchedProfile(profile) ?? profile : profile;
      let origin = area.center;
      if ((setting.flags & 1) !== 0) {
        const floor = trace(world, posture, area.center, { ...area.center, z: area.bounds.min.z + posture.shape.bounds.min.z - profile.maximumStep });
        if (!floor.startSolid && !floor.allSolid && floor.fraction < 1 && floor.contact.kind === "plane" && floor.contact.plane.normal.z >= profile.minimumFloorNormal) origin = floor.end;
        else for (let index = setting.firstReach; index < setting.firstReach + setting.reachCount; index++) {
          const reach = at(asset.reachability, index);
          if (clear(world, posture, reach.start, reach.start)) { origin = reach.start; break; }
        }
      }
      nodes.push({ id: number, origin, bounds: area.bounds, radius: 0, contents: contents(world, profile, origin),
        flags: setting.flags, presence: setting.presence, sourceCluster: setting.cluster, source: { kind: "aas", area: number, reachability: null } });
      for (let index = setting.firstReach; index < setting.firstReach + setting.reachCount; index++) {
        const reach = at(asset.reachability, index), mode = aasTravelMode(reach.travelType);
        if (reach.area === 0) continue;
        const moving = mode === "mover" || mode === "teleport" || mode === "jump-pad";
        const model = mode === "mover" ? reach.face & 0xffff : null;
        edges.push({ id: index, from: number, to: reach.area, mode, start: reach.start, end: reach.end,
          travelSeconds: Math.max(1, reach.travelTime) / 100, sourceTravelType: reach.travelType, sourceFlags: 0, hint: null,
          entity: moving ? { model, bounds: area.bounds, raw: [reach.face, reach.edge] } : null,
          source: { kind: "aas", area: number, reachability: index } });
      }
    }
  } else {
    const rise = -profile.shape.bounds.min.z;
    const lift = (point: Vec3): Vec3 => ({ ...point, z: point.z + rise });
    for (const [number, node] of asset.nodes.entries()) nodes.push({ id: number, origin: lift(node.origin),
      bounds: translated(lift(node.origin), profile.shape.bounds), radius: node.radius,
      flags: node.flags, contents: contents(world, profile, lift(node.origin)), presence: 0, sourceCluster: null,
      source: { kind: asset.kind, node: number, link: null } });
    const entityLinks = new Map(asset.entities.map(entity => [entity.link, entity]));
    for (const [number, node] of asset.nodes.entries()) for (let index = node.firstLink; index < node.firstLink + node.linkCount; index++) {
      const link = at(asset.links, index), entity = entityLinks.get(index), rawHint = link.traversal === null ? null : at(asset.traversals, link.traversal);
      const hint = rawHint === null ? null : { ...rawHint, funnel: lift(rawHint.funnel), start: lift(rawHint.start), end: lift(rawHint.end) };
      const start = hint?.start ?? at(nodes, number).origin, end = hint?.end ?? at(nodes, link.target).origin;
      const mode = kexTravelMode(link.type);
      edges.push({ id: index, from: number, to: link.target, mode, start, end, sourceTravelType: link.type, sourceFlags: link.flags,
        travelSeconds: mode === "teleport" ? 0.01 : Math.max(0.01, distance(start, end) * asset.heuristic / 320), hint,
        entity: entity === undefined ? mode === "teleport" || mode === "jump-pad" || mode === "mover"
          ? { model: null, bounds: at(nodes, number).bounds, raw: [] } : null : {
            model: asset.kind === "nav3" && entity.model !== null
              ? entity.model <= 1 || entity.model === 255 ? null : entity.model - (entity.model > 255 ? 2 : 1)
              : entity.model,
            bounds: entity.bounds, raw: entity.tail },
        source: { kind: asset.kind, node: number, link: index } });
    }
  }
  return { map, profile, asset, nodes, edges, clusters: navigationClusters(nodes, edges),
    rejected: edges.filter(edge => edge.mode === "unknown").map(edge => ({ source: edge.source, reason: `Unsupported source travel type ${edge.sourceTravelType}` })) };
}
