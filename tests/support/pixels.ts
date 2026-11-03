// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";

// A raw RGBA frame has to show a rendered world, not just a HUD or console strip: the
// upper 60% of the frame (above any status bar) must hold many distinct RGB colours and
// a large share of pixels that differ from its dominant colour.
export function expectWorldRegion(pixels: Uint8Array, width: number, height: number): void {
  expect(pixels.length).toBe(width * height * 4);
  const rows = Math.floor(height * 0.6),
    counts = new Map<number, number>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4,
        key = ((pixels[at] ?? 0) << 16) | ((pixels[at + 1] ?? 0) << 8) | (pixels[at + 2] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const total = rows * width,
    dominant = Math.max(...counts.values());
  expect(counts.size).toBeGreaterThanOrEqual(32);
  expect((total - dominant) / total).toBeGreaterThanOrEqual(0.1);
}
