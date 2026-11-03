// SPDX-License-Identifier: GPL-2.0-or-later
/** Bounded recency cache for interpolated poses. Poses are keyed by object identity plus a lerp string, and the total
 * entry count is capped, because interpolation fractions are continuous and rarely repeat. */
export class PoseLru<V> {
  private readonly entries = new Map<string, V>();
  private readonly ids = new WeakMap<object, number>();
  private nextId = 0;
  constructor(private readonly limit: number) {}

  key(owners: readonly object[], suffix: string): string {
    let key = suffix;
    for (const owner of owners) {
      let id = this.ids.get(owner);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(owner, id);
      }
      key = `${id}|${key}`;
    }
    return key;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
