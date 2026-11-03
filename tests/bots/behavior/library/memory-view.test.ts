// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { allocationView, BotMemory } from "../../../../src/bots/behavior/library/memory.ts";

test("a manager allocation hands out one DataView over its payload until it is freed", () => {
  const memory = new BotMemory(),
    allocation = memory.allocate(16, "heap", true);
  const view = allocationView(allocation);
  expect(allocationView(allocation)).toBe(view);
  view.setInt32(4, 0x1234, true);
  expect(new DataView(allocation.bytes.buffer, allocation.bytes.byteOffset, allocation.bytes.byteLength).getInt32(4, true)).toBe(0x1234);
  expect(view.byteLength).toBe(16);
  memory.free(allocation);
  expect(() => allocationView(allocation)).toThrow("freed");
});

test("an allocation without a cached view still yields a view of its bytes", () => {
  const bytes = new Uint8Array(8);
  const view = allocationView({ bytes });
  view.setUint8(3, 9);
  expect(bytes[3]).toBe(9);
});
