// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { ucrtQuickSort } from "../../../../src/guest/runtime/windows/crt.ts";

function sortKeys(keys: number[], compare = (a: number, b: number) => a - b): { readonly order: number[]; readonly comparisons: number } {
  const identity = keys.map((_, index) => index);
  let comparisons = 0;
  ucrtQuickSort(
    keys.length,
    (left, right) => {
      comparisons++;
      return compare(keys[identity[left] ?? 0] ?? 0, keys[identity[right] ?? 0] ?? 0);
    },
    (left, right) => {
      const held = identity[left] ?? 0;
      identity[left] = identity[right] ?? 0;
      identity[right] = held;
    },
  );
  return { order: identity, comparisons };
}

test("the UCRT quicksort sorts every length and key pattern, permuting without loss", () => {
  let seed = 7;
  const random = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 8;
  };
  for (let length = 0; length < 140; length++) {
    for (const range of [2, 5, 1000]) {
      const keys = Array.from({ length }, () => random() % range);
      const { order } = sortKeys(keys);
      expect([...order].sort((a, b) => a - b)).toEqual(keys.map((_, index) => index));
      const sorted = order.map(index => keys[index] ?? 0);
      expect(sorted).toEqual([...keys].sort((a, b) => a - b));
    }
  }
});

test("runs of eight or fewer use the selection sort, which moves the last maximum to the end first", () => {
  // Hand-traced from __shortsort: swap the first maximum with the last slot, then shrink the run.
  expect(sortKeys([1, 1, 1, 1]).order).toEqual([1, 2, 3, 0]);
  expect(sortKeys([2, 1, 2, 1]).order).toEqual([1, 3, 2, 0]);
});

test("already ordered and reversed inputs stay within a quicksort comparison budget", () => {
  const ascending = Array.from({ length: 4096 }, (_, index) => index);
  expect(sortKeys(ascending).comparisons).toBeLessThan(4096 * 24);
  expect(sortKeys([...ascending].reverse()).comparisons).toBeLessThan(4096 * 24);
});
