// SPDX-License-Identifier: GPL-2.0-or-later

/** An LRU-ordered cache plus the running size the owner budgets against (entries or bytes). */
export interface EstimateStore<V> { readonly entries: Map<string, V>; used: number; }
export function estimateStore<V>(): EstimateStore<V> { return { entries: new Map(), used: 0 }; }
/** The store every runtime over `owner` shares; created on first use. */
export function sharedEstimateStore<V>(pool: WeakMap<object, EstimateStore<V>>, owner: object): EstimateStore<V> {
  const existing = pool.get(owner);
  if (existing !== undefined) return existing;
  const created = estimateStore<V>();
  pool.set(owner, created);
  return created;
}
