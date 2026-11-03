// Shared metadata estimates; execution remains in NavigationRuntime movement admission.
// SPDX-License-Identifier: GPL-2.0-or-later
import { MinHeap } from "./heap.ts";
import { AasNavigationEstimates } from "./estimate-aas.ts";
import { EstimateStore, type EstimateTail, graphEstimateIndex } from "./estimate-store.ts";
import type { NavigationEdge, NavigationEstimateQuery, NavigationEstimateResult, NavigationGraph } from "./types.ts";

/** About 16 MB of cached tails per store, matching the AAS estimate cache. */
const MAXIMUM_CACHED_ENTRIES = 200_000;
type Eligibility = (edge: NavigationEdge, flags: number | undefined) => boolean;
interface Cost { readonly node: number; readonly seconds: number; }
/**
 * Cache identity is the graph and an eligibility scope. Runtimes over one edge
 * list whose `scope` strings match share tails, because the tails are a pure
 * function of the graph and what `allowed` answers; a runtime whose eligibility
 * changes takes a new scope instead of clearing what the others still use.
 * Without a scope the cache is private and `invalidate` clears it.
 */
export class NavigationEstimates {
  private readonly aas: AasNavigationEstimates | null;
  private readonly incoming: ReadonlyMap<number, NavigationEdge[]>;
  private readonly store: EstimateStore<ReadonlyMap<number, EstimateTail>>;
  constructor(readonly graph: NavigationGraph, private readonly allowed: Eligibility, private readonly scope: (() => string) | null = null) {
    const index = graphEstimateIndex(graph);
    this.incoming = index.incoming;
    this.store = scope === null ? new EstimateStore() : index.tails;
    this.aas = graph.asset?.kind === "aas" ? new AasNavigationEstimates(graph, graph.asset, allowed, scope) : null;
  }
  invalidate(): void {
    if (this.scope !== null) return;
    this.aas?.invalidate(); this.store.clear();
  }
  private tails(goal: number, flags: number | undefined): ReadonlyMap<number, EstimateTail> {
    const scope = this.scope?.() ?? "", b = flags === undefined ? 0 : flags >>> 0, tag = flags === undefined ? 1 : 0, cached = this.store.find(scope, goal, b, tag);
    if (cached !== undefined) return cached;
    const tails = new Map<number, EstimateTail>([[goal, { seconds: 0, firstEdge: null }]]), queue = new MinHeap<Cost>(cost => cost.seconds);
    queue.push({ node: goal, seconds: 0 });
    for (let current = queue.pop(); current !== null; current = queue.pop()) {
      if (tails.get(current.node)?.seconds !== current.seconds) continue;
      for (const edge of this.incoming.get(current.node) ?? []) {
        if (!this.allowed(edge, flags)) continue;
        const seconds = current.seconds + edge.travelSeconds;
        if (seconds >= (tails.get(edge.from)?.seconds ?? Infinity)) continue;
        tails.set(edge.from, { seconds, firstEdge: edge }); queue.push({ node: edge.from, seconds });
      }
    }
    this.store.put(scope, goal, b, tag, tails, tails.size);
    // Each cache holds one entry per reachable node, so the budget counts entries, not tables.
    while (this.store.size > 1 && (this.store.size > 128 || this.store.used > MAXIMUM_CACHED_ENTRIES)) this.store.evictOldest();
    return tails;
  }
  estimate(query: NavigationEstimateQuery): NavigationEstimateResult {
    // AAS_AreaRouteToGoalArea answers equal areas before it range-tests them.
    if (this.aas !== null && query.startNode === query.goalNode && !this.incoming.has(query.startNode)) return { kind: "estimate", travelTime: 1, firstEdge: null };
    if (!this.incoming.has(query.startNode) || !this.incoming.has(query.goalNode)) return { kind: "unreachable" };
    if (query.travelFlags !== undefined && (!Number.isInteger(query.travelFlags) || query.travelFlags < -0x80000000 || query.travelFlags > 0xffffffff)) {
      throw new RangeError("Estimate travel flags must be a 32-bit mask");
    }
    if (this.aas === null && query.origin !== null && (!Number.isFinite(Math.fround(query.origin.x)) || !Number.isFinite(Math.fround(query.origin.y))
      || !Number.isFinite(Math.fround(query.origin.z)))) throw new RangeError("Estimate origin must contain finite float32 coordinates");
    if (this.aas !== null) return this.aas.estimate(query);
    if (query.startNode === query.goalNode) return { kind: "estimate", travelTime: 1, firstEdge: null };
    const tail = this.tails(query.goalNode, query.travelFlags).get(query.startNode);
    if (tail === undefined) return { kind: "unreachable" };
    let seconds = tail.seconds;
    if (query.origin !== null && tail.firstEdge !== null) {
      const start = tail.firstEdge.start, origin = query.origin;
      const heuristic = this.graph.asset?.kind === "nav2" || this.graph.asset?.kind === "nav3" ? this.graph.asset.heuristic : 1;
      seconds += Math.hypot(start.x - origin.x, start.y - origin.y, start.z - origin.z) * heuristic / 320;
    }
    return { kind: "estimate", travelTime: Math.max(1, Math.trunc(Math.fround(seconds * 100))),
      firstEdge: query.origin === null ? null : tail.firstEdge };
  }
}
