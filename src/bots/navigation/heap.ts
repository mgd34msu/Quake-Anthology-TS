// SPDX-License-Identifier: GPL-2.0-or-later
/** Binary min-heap shared by every shortest-path search in navigation; ties pop in heap order. */
export class MinHeap<T> {
  private readonly values: T[] = [];
  constructor(private readonly key: (value: T) => number) {}
  get size(): number { return this.values.length; }
  push(value: T): void {
    const cost = this.key(value);
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2), parent = this.values[parentIndex];
      if (parent === undefined || this.key(parent) <= cost) break;
      this.values[index] = parent; index = parentIndex;
    }
    this.values[index] = value;
  }
  pop(): T | null {
    const result = this.values[0], tail = this.values.pop();
    if (result === undefined || tail === undefined) return null;
    if (this.values.length === 0) return result;
    const tailCost = this.key(tail);
    let index = 0;
    while (index * 2 + 1 < this.values.length) {
      let childIndex = index * 2 + 1;
      const right = this.values[childIndex + 1], left = this.values[childIndex];
      if (left === undefined) break;
      if (right !== undefined && this.key(right) < this.key(left)) childIndex++;
      const child = this.values[childIndex];
      if (child === undefined || tailCost <= this.key(child)) break;
      this.values[index] = child; index = childIndex;
    }
    this.values[index] = tail;
    return result;
  }
}
