// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import type { GuestImportResolver } from "../../../src/guest/core/index.ts";
import { inspectElf } from "../../../src/guest/elf/parse.ts";
import { loadElf } from "../../../src/guest/elf/index.ts";
import { elfTlsFixture } from "../../support/elf-fixtures.ts";
import { runMutations } from "../../support/mutation.ts";

const module: ModuleIdentity = { id: "test:elf-mutation", artifactPath: "authored-elf-mutation", revision: "1", digest: createContentDigest("33".repeat(32)) };
const resolver: GuestImportResolver = {
  resolve(import_) {
    return { kind: "unresolved", import: import_, detail: "authored image has no external imports" };
  },
};

const widths: readonly Parameters<typeof elfTlsFixture>[0][] = [4, 8];
for (const width of widths) {
  test(`seeded mutants of an ELF${width * 8} image inspect and load or fail with a typed error`, () => {
    const valid = elfTlsFixture(width);
    expect(inspectElf(valid).segments.length).toBeGreaterThan(0);
    const load = (bytes: Uint8Array): unknown => {
      const memory = new SparseGuestMemory({ module, pointerBytes: width });
      return loadElf({
        bytes,
        module,
        memory,
        loadBias: 0x20000000n,
        resolver,
        dependencies: new Set<string>(),
        tls: {
          current: { moduleId: 7n, threadPointerOffset: -64n },
          resolve() {
            return null;
          },
        },
        resolveIndirect: address => address,
      });
    };
    for (const seed of [61, 62, 63]) {
      const inspected = runMutations(seed, 600, valid, inspectElf);
      expect(inspected.foreign).toEqual([]);
      expect(inspected.rejected).toBeGreaterThan(0);
      const loaded = runMutations(seed + 100, 400, valid, load);
      expect(loaded.foreign).toEqual([]);
    }
  });
}
