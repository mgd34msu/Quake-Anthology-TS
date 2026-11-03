// SPDX-License-Identifier: GPL-2.0-or-later
import { IdIndex } from "../../foundation/id-index.ts";
import { StringTable } from "../../foundation/strings.ts";
import type { NavigationEdge, NavigationGraph } from "./types.ts";

export interface EstimateTail { readonly seconds: number; readonly firstEdge: NavigationEdge | null; }
export interface AasEstimateCache { readonly times: Uint16Array; readonly reaches: Uint8Array; }

const NO_SLOT = -1;

/**
 * An LRU cache keyed by (scope, a, b, tag) integers: the scope text is interned once, and the three numbers
 * resolve through an IdIndex, so a lookup formats and allocates nothing. `used` is the running size the owner
 * budgets against (entries or bytes).
 */
export class EstimateStore<V> {
  used = 0;
  private readonly scopes = new StringTable(() => 0);
  private readonly index = new IdIndex();
  private values: (V | undefined)[] = [];
  private scopeIds = new Uint32Array(0);
  private tags = new Uint32Array(0);
  private keysA = new Uint32Array(0);
  private keysB = new Uint32Array(0);
  private costs = new Float64Array(0);
  private stamps = new Float64Array(0);
  private live = new Uint8Array(0);
  private readonly free: number[] = [];
  private slotCount = 0;
  private liveCount = 0;
  private tick = 0;

  get size(): number { return this.liveCount; }

  private grow(): void {
    const capacity = Math.max(64, this.live.length * 2);
    const widen = <T extends Uint8Array | Uint32Array | Float64Array>(source: T, make: (length: number) => T): T => { const next = make(capacity); next.set(source); return next; };
    this.scopeIds = widen(this.scopeIds, length => new Uint32Array(length));
    this.tags = widen(this.tags, length => new Uint32Array(length));
    this.keysA = widen(this.keysA, length => new Uint32Array(length));
    this.keysB = widen(this.keysB, length => new Uint32Array(length));
    this.costs = widen(this.costs, length => new Float64Array(length));
    this.stamps = widen(this.stamps, length => new Float64Array(length));
    this.live = widen(this.live, length => new Uint8Array(length));
  }

  /** Returns the cached value and marks it most recently used. */
  find(scope: string, a: number, b: number, tag: number): V | undefined {
    const scopeId = this.scopes.find(scope);
    if (scopeId === 0) return undefined;
    const cursor = this.index.begin(a, b);
    for (let slot = this.index.next(cursor); slot !== NO_SLOT; slot = this.index.next(cursor)) {
      if (this.scopeIds[slot] === scopeId && this.tags[slot] === (tag >>> 0)) { this.stamps[slot] = ++this.tick; return this.values[slot]; }
    }
    return undefined;
  }

  put(scope: string, a: number, b: number, tag: number, value: V, cost: number): void {
    let slot = this.free.pop();
    if (slot === undefined) {
      if (this.slotCount >= this.live.length) this.grow();
      slot = this.slotCount++;
    }
    this.index.reserve(1);
    this.scopeIds[slot] = this.scopes.intern(scope);
    this.tags[slot] = tag >>> 0;
    this.keysA[slot] = a >>> 0;
    this.keysB[slot] = b >>> 0;
    this.costs[slot] = cost;
    this.stamps[slot] = ++this.tick;
    this.live[slot] = 1;
    this.values[slot] = value;
    this.index.insert(a, b, slot);
    this.liveCount++;
    this.used += cost;
  }

  /** Drops the least recently used entry and returns its cost, or 0 when empty. */
  evictOldest(): void {
    let oldest = NO_SLOT;
    for (let slot = 0; slot < this.slotCount; slot++) if (this.live[slot] === 1 && (oldest === NO_SLOT || (this.stamps[slot] ?? 0) < (this.stamps[oldest] ?? 0))) oldest = slot;
    if (oldest === NO_SLOT) return;
    this.index.removeValue(this.keysA[oldest] ?? 0, this.keysB[oldest] ?? 0, oldest);
    this.used -= this.costs[oldest] ?? 0;
    this.values[oldest] = undefined;
    this.live[oldest] = 0;
    this.free.push(oldest);
    this.liveCount--;
  }

  clear(): void {
    this.index.clear();
    this.values.fill(undefined);
    this.live.fill(0);
    this.free.length = 0;
    this.slotCount = 0;
    this.liveCount = 0;
    this.used = 0;
  }
}

/** Everything derived from one edge list: shared by every runtime over it, keyed by eligibility scope. */
export class GraphEstimateIndex {
  readonly incoming = new Map<number, NavigationEdge[]>();
  readonly edgesById = new Map<number, NavigationEdge>();
  readonly tails = new EstimateStore<ReadonlyMap<number, EstimateTail>>();
  readonly aas = new EstimateStore<AasEstimateCache>();
  constructor(graph: NavigationGraph) {
    for (const node of graph.nodes) this.incoming.set(node.id, []);
    for (const edge of graph.edges) {
      const list = this.incoming.get(edge.to);
      if (list === undefined) throw new RangeError("Estimate edge has no destination node");
      if (!Number.isFinite(edge.travelSeconds) || edge.travelSeconds < 0) throw new RangeError("Invalid estimated edge duration");
      list.push(edge);
      this.edgesById.set(edge.id, edge);
    }
  }
}

// Runtimes over copies of one graph share an edge list, so the edge list's identity is the registry key.
const indexes = new WeakMap<readonly NavigationEdge[], GraphEstimateIndex>();
export function graphEstimateIndex(graph: NavigationGraph): GraphEstimateIndex {
  let index = indexes.get(graph.edges);
  if (index === undefined) { index = new GraphEstimateIndex(graph); indexes.set(graph.edges, index); }
  return index;
}
