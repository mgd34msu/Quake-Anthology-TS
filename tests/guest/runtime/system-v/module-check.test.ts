// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { checkGuestModule } from "../../../../tools/check-guest-module.ts";
import { lifecycleElf } from "./lifecycle-fixture.ts";

const bias = 0x10000000n;
const scratch: ModuleIdentity = { id: "test:module-check", artifactPath: "authored-addresses", revision: "1", digest: createContentDigest("38".repeat(32)) };

test("the module check rejects bytes that are not an ELF image, without throwing", () => {
  const report = checkGuestModule(new Uint8Array(64), "not-elf.so");
  expect(report.outcome).toBe("failed");
  expect(report.detail).not.toBeNull();
  expect(report.initializers).toBe(0);
});

for (const width of [4, 8] satisfies readonly (4 | 8)[]) test(`the module check runs every ${width * 8}-bit initializer and finalizer of an authored module`, () => {
  const addresses = new SparseGuestMemory({ module: scratch, pointerBytes: width });
  const callback = addresses.pointer(bias + 0xb00n), counter = addresses.pointer(0x10000n);
  if (callback === null || counter === null) throw new Error("fixture address");
  const bytes = lifecycleElf(width, bias, callback, counter);
  bytes[0xb00] = 0xc3;
  expect(checkGuestModule(bytes, "lifecycle.so")).toEqual({ architecture: width === 4 ? "i386" : "x86-64", initializers: 3, finalizers: 3, entries: [], outcome: "ok", detail: null });
});
