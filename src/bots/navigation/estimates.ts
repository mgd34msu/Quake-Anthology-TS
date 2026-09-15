// Shared metadata estimates; execution remains in NavigationRuntime movement admission.
// SPDX-License-Identifier: GPL-2.0-or-later
import { AasNavigationEstimates } from "./estimate-aas.ts";
import type { NavigationEdge, NavigationEstimateQuery, NavigationEstimateResult, NavigationGraph } from "./types.ts";

type Eligibility = (edge: NavigationEdge, flags: number | undefined) => boolean;
interface Cost { readonly node: number; readonly seconds: number; }
interface Tail { readonly seconds: number; readonly firstEdge: NavigationEdge | null; }
class CostQueue {
  private readonly values: Cost[] = [];
  push(value: Cost): void {
    let index = this.values.length; this.values.push(value);
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2), parent = this.values[parentIndex];
      if (parent === undefined || parent.seconds <= value.seconds) break;
      this.values[index] = parent; index = parentIndex;
    }
    this.values[index] = value;
  }
  pop(): Cost | null {
    const first = this.values[0], last = this.values.pop();
    if (first === undefined || last === undefined) return null;
    if (this.values.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let childIndex = index * 2 + 1;
      const left = this.values[childIndex], right = this.values[childIndex + 1];
      if (left === undefined) break;
      if (right !== undefined && right.seconds < left.seconds) childIndex++;
      const child = this.values[childIndex];
      if (child === undefined || last.seconds <= child.seconds) break;
      this.values[index] = child; index = childIndex;
    }
    this.values[index] = last; return first;
  }
}

/** Cache identity is the graph/profile instance and explicit static-topology invalidation. */
export class NavigationEstimates {
  private readonly aas: AasNavigationEstimates | null;
  private readonly incoming = new Map<number, NavigationEdge[]>();
  private readonly caches = new Map<string, ReadonlyMap<number, Tail>>();
  constructor(readonly graph: NavigationGraph, private readonly allowed: Eligibility) {
    this.aas = graph.asset?.kind === "aas" ? new AasNavigationEstimates(graph, graph.asset, allowed) : null;
    for (const node of graph.nodes) this.incoming.set(node.id, []);
    for (const edge of graph.edges) {
      const list = this.incoming.get(edge.to);
      if (list === undefined) throw new RangeError("Estimate edge has no destination node");
      if (!Number.isFinite(edge.travelSeconds) || edge.travelSeconds < 0) throw new RangeError("Invalid estimated edge duration");
      list.push(edge);
    }
  }
  invalidate(): void { this.aas?.invalidate(); this.caches.clear(); }
  private tails(goal: number, flags: number | undefined): ReadonlyMap<number, Tail> {
    const key = `${goal}:${flags === undefined ? "all" : flags | 0}`, cached = this.caches.get(key);
    if (cached !== undefined) { this.caches.delete(key); this.caches.set(key, cached); return cached; }
    const tails = new Map<number, Tail>([[goal, { seconds: 0, firstEdge: null }]]), queue = new CostQueue();
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
    this.caches.set(key, tails);
    if (this.caches.size > 128) {
      const oldest = this.caches.keys().next();
      if (!oldest.done) this.caches.delete(oldest.value);
    }
    return tails;
  }
  estimate(query: NavigationEstimateQuery): NavigationEstimateResult {
    if (!this.incoming.has(query.startNode) || !this.incoming.has(query.goalNode)) return { kind: "unreachable" };
    if (query.travelFlags !== undefined && (!Number.isInteger(query.travelFlags) || query.travelFlags < -0x80000000 || query.travelFlags > 0xffffffff)) {
      throw new RangeError("Estimate travel flags must be a 32-bit mask");
    }
    if (query.origin !== null && (!Number.isFinite(Math.fround(query.origin.x)) || !Number.isFinite(Math.fround(query.origin.y))
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
