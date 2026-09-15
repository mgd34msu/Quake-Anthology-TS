/* AAS area/portal cost relaxation from id Software be_aas_route.c and quake-3-ts routing.ts.
 * Copyright (C) 1999-2005 Id Software, Inc. SPDX-License-Identifier: GPL-2.0-or-later */
import type { Vec3 } from "../../contracts/math.ts";
import type { AasAsset } from "./aas.ts";
import { aasAreaTravelFlags, aasTravelFlag } from "./graph.ts";
import type { NavigationEdge, NavigationEstimateQuery, NavigationEstimateResult, NavigationGraph } from "./types.ts";

function at<T>(values: ArrayLike<T>, index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing AAS estimate metadata ${index}`);
  return value;
}

export function aasEstimateAreaTime(settings: Pick<AasAsset["settings"][number], "presence" | "flags">, start: Vec3, end: Vec3): number {
  const f = Math.fround, x = f(f(start.x) - f(end.x)), y = f(f(start.y) - f(end.y)), z = f(f(start.z) - f(end.z));
  const distance = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  const factor = (settings.presence & 2) === 0 ? f(1.3) : (settings.flags & 4) !== 0 ? 1 : f(0.33);
  const value = Math.trunc(f(distance * factor));
  if (!Number.isFinite(value) || value > 0x7fffffff) throw new RangeError("AAS estimate distance exceeds source int range");
  return Math.max(1, value) & 0xffff;
}
interface Incoming { readonly area: number; readonly reach: number; }
interface Topology {
  readonly incoming: readonly (readonly Incoming[])[];
  readonly crossings: readonly (readonly Uint16Array[])[];
  readonly portalMaxima: readonly number[];
}
const topologies = new WeakMap<AasAsset, Topology>();
function topology(asset: AasAsset): Topology {
  const existing = topologies.get(asset);
  if (existing !== undefined) return existing;
  const incoming: Incoming[][] = asset.areas.map(() => []);
  for (let area = 1; area < asset.areas.length; area++) {
    const settings = at(asset.settings, area);
    for (let offset = 0; offset < Math.min(settings.reachCount, 128); offset++) {
      const reach = settings.firstReach + offset;
      at(incoming, at(asset.reachability, reach).area).push({ area, reach });
    }
  }
  for (const links of incoming) links.reverse();
  const crossings = asset.settings.map((settings, area) => Array.from({ length: settings.reachCount }, (_, offset) => {
    const start = at(asset.reachability, settings.firstReach + offset).start;
    return Uint16Array.from(at(incoming, area), link => aasEstimateAreaTime(settings, at(asset.reachability, link.reach).end, start));
  }));
  const portalMaxima = asset.portals.map(portal => {
    let maximum = 0;
    for (const row of at(crossings, portal.area)) for (const time of row) maximum = Math.max(maximum, time);
    return maximum;
  });
  const result = { incoming, crossings, portalMaxima };
  topologies.set(asset, result); return result;
}
interface Cache { readonly times: Uint16Array; readonly reaches: Uint8Array; }
interface Update { area: number; cluster: number; time: number; row: Uint16Array; queued: boolean; }
function update(): Update { return { area: 0, cluster: 0, time: 0, row: new Uint16Array(0), queued: false }; }

/** Immutable AAS metadata plus explicit static eligibility; no world or movement services. */
export class AasNavigationEstimates {
  private readonly topology: Topology;
  private readonly edges: ReadonlyMap<number, NavigationEdge>;
  private readonly caches = new Map<string, Cache>();
  private cacheBytes = 0;
  constructor(readonly graph: NavigationGraph, readonly asset: AasAsset,
    private readonly allowed: (edge: NavigationEdge, flags: number | undefined) => boolean) {
    this.topology = topology(asset);
    this.edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  }
  invalidate(): void { this.caches.clear(); this.cacheBytes = 0; }
  private remember(key: string, cache: Cache): Cache {
    this.caches.set(key, cache); this.cacheBytes += cache.times.byteLength + cache.reaches.byteLength;
    while (this.cacheBytes > 16 * 1024 * 1024 && this.caches.size > 1) {
      const oldest = this.caches.entries().next();
      if (oldest.done) break;
      this.caches.delete(oldest.value[0]); this.cacheBytes -= oldest.value[1].times.byteLength + oldest.value[1].reaches.byteLength;
    }
    return cache;
  }
  private cached(key: string): Cache | undefined {
    const cache = this.caches.get(key);
    if (cache !== undefined) { this.caches.delete(key); this.caches.set(key, cache); }
    return cache;
  }
  private clusterArea(cluster: number, area: number): number {
    const settings = at(this.asset.settings, area);
    if (settings.cluster > 0) return settings.clusterArea;
    const portal = at(this.asset.portals, -settings.cluster);
    return portal.clusterAreas[portal.frontCluster === cluster ? 0 : 1];
  }
  private areaCache(cluster: number, goal: number, flags: number): Cache {
    const key = `a:${cluster}:${goal}:${flags}`, cached = this.cached(key);
    if (cached !== undefined) return cached;
    const count = at(this.asset.clusters, cluster).reachabilityAreaCount;
    const cache = { times: new Uint16Array(count), reaches: new Uint8Array(count) };
    const goalIndex = this.clusterArea(cluster, goal);
    if (goalIndex >= count) return this.remember(key, cache);
    const updates = Array.from({ length: count }, update), first = at(updates, goalIndex);
    first.area = goal; first.time = 1; first.row = new Uint16Array(at(this.topology.incoming, goal).length);
    cache.times[goalIndex] = 1;
    const queue = [first];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = at(queue, cursor); current.queued = false;
      for (const [ordinal, link] of at(this.topology.incoming, current.area).entries()) {
        const reach = at(this.asset.reachability, link.reach), edge = this.edges.get(link.reach);
        if (edge === undefined || (aasTravelFlag(reach.travelType) & ~flags) !== 0 || !this.allowed(edge, flags)
          || (aasAreaTravelFlags(at(this.asset.settings, reach.area)) & ~flags) !== 0) continue;
        const settings = at(this.asset.settings, link.area);
        if (settings.cluster > 0 && settings.cluster !== cluster) continue;
        const index = this.clusterArea(cluster, link.area);
        if (index >= count) continue;
        const time = (current.time + at(current.row, ordinal) + reach.travelTime) & 0xffff, previous = at(cache.times, index);
        if (previous !== 0 && previous <= time) continue;
        cache.times[index] = time;
        const offset = link.reach - settings.firstReach;
        cache.reaches[index] = offset;
        const next = at(updates, index);
        next.area = link.area; next.time = time; next.row = at(at(this.topology.crossings, link.area), offset);
        if (!next.queued) { next.queued = true; queue.push(next); }
      }
    }
    return this.remember(key, cache);
  }
  private portalCache(cluster: number, goal: number, flags: number): Cache {
    const key = `p:${goal}:${flags}`, cached = this.cached(key);
    if (cached !== undefined) return cached;
    const count = this.asset.portals.length, cache = { times: new Uint16Array(count), reaches: new Uint8Array(count) };
    const updates = Array.from({ length: count + 1 }, update), first = at(updates, count);
    first.cluster = cluster; first.area = goal; first.time = 1;
    const goalCluster = at(this.asset.settings, goal).cluster;
    if (goalCluster < 0) cache.times[-goalCluster] = 1;
    const queue = [first];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = at(queue, cursor); current.queued = false;
      const record = at(this.asset.clusters, current.cluster), local = this.areaCache(current.cluster, current.area, flags);
      for (let offset = 0; offset < record.portalCount; offset++) {
        const number = at(this.asset.portalIndexes, record.firstPortal + offset), portal = at(this.asset.portals, number);
        if (portal.area === current.area) continue;
        const index = this.clusterArea(current.cluster, portal.area);
        if (index >= record.reachabilityAreaCount) continue;
        const localTime = at(local.times, index);
        if (localTime === 0) continue;
        const time = (localTime + current.time) & 0xffff, previous = at(cache.times, number);
        if (previous !== 0 && previous <= time) continue;
        cache.times[number] = time;
        const next = at(updates, number);
        next.cluster = portal.frontCluster === current.cluster ? portal.backCluster : portal.frontCluster;
        next.area = portal.area; next.time = (time + at(this.topology.portalMaxima, number)) & 0xffff;
        if (!next.queued) { next.queued = true; queue.push(next); }
      }
    }
    return this.remember(key, cache);
  }
  estimate(query: NavigationEstimateQuery): NavigationEstimateResult {
    const area = query.startNode, goal = query.goalNode;
    if (!Number.isInteger(area) || area <= 0 || area >= this.asset.areas.length
      || !Number.isInteger(goal) || goal <= 0 || goal >= this.asset.areas.length) return { kind: "unreachable" };
    if (area === goal) return { kind: "estimate", travelTime: 1, firstEdge: null };
    const start = at(this.asset.settings, area), end = at(this.asset.settings, goal);
    let flags = (query.travelFlags ?? 0x011c0fbe) | 0;
    if (((start.contents | end.contents) & 256) !== 0) flags |= 0x00800000;
    let cluster = start.cluster, goalCluster = end.cluster;
    if (cluster < 0 && goalCluster > 0) {
      const portal = at(this.asset.portals, -cluster);
      if (portal.frontCluster === goalCluster || portal.backCluster === goalCluster) cluster = goalCluster;
    } else if (cluster > 0 && goalCluster < 0) {
      const portal = at(this.asset.portals, -goalCluster);
      if (portal.frontCluster === cluster || portal.backCluster === cluster) goalCluster = cluster;
    }
    if (cluster > 0 && cluster === goalCluster) {
      const cache = this.areaCache(cluster, goal, flags), index = this.clusterArea(cluster, area);
      if (index >= at(this.asset.clusters, cluster).reachabilityAreaCount) return { kind: "unreachable" };
      const time = at(cache.times, index);
      if (time !== 0) {
        if (query.origin === null) return { kind: "estimate", travelTime: time, firstEdge: null };
        const reach = start.firstReach + at(cache.reaches, index);
        return { kind: "estimate", travelTime: time + aasEstimateAreaTime(start, query.origin, at(this.asset.reachability, reach).start),
          firstEdge: this.edges.get(reach) ?? null };
      }
    }
    cluster = start.cluster; goalCluster = end.cluster;
    if (goalCluster < 0) goalCluster = at(this.asset.portals, -goalCluster).frontCluster;
    const portalCache = this.portalCache(goalCluster, goal, flags);
    if (cluster < 0) return { kind: "estimate", travelTime: at(portalCache.times, -cluster),
      firstEdge: query.origin === null ? null : this.edges.get(start.firstReach + at(portalCache.reaches, -cluster)) ?? null };
    let best: NavigationEstimateResult = { kind: "unreachable" }, bestTime = 0;
    const record = at(this.asset.clusters, cluster);
    for (let offset = 0; offset < record.portalCount; offset++) {
      const number = at(this.asset.portalIndexes, record.firstPortal + offset), portalTime = at(portalCache.times, number);
      if (portalTime === 0) continue;
      const portal = at(this.asset.portals, number), local = this.areaCache(cluster, portal.area, flags), index = this.clusterArea(cluster, area);
      if (index >= record.reachabilityAreaCount) continue;
      const localTime = at(local.times, index);
      if (localTime === 0) continue;
      const reach = query.origin === null ? null : start.firstReach + at(local.reaches, index);
      let time = (portalTime + localTime) & 0xffff;
      time = (time + at(this.topology.portalMaxima, number)) & 0xffff;
      if (query.origin !== null && reach !== null) time = (time + aasEstimateAreaTime(start, query.origin, at(this.asset.reachability, reach).start)) & 0xffff;
      if (bestTime === 0 || time < bestTime) {
        bestTime = time; best = { kind: "estimate", travelTime: time, firstEdge: reach === null ? null : this.edges.get(reach) ?? null };
      }
    }
    return best;
  }
}
