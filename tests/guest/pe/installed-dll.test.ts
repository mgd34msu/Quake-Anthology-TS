// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContentDigest } from "../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";
import { SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { mapPeImage, resolvePeExport } from "../../../src/guest/pe/index.ts";

// Export RVAs and relocated words were independently read using objdump -p/-s.
// Commercial DLL bytes stay in the user's installed content; none are fixture assets.
const cases: readonly {
  readonly relativePath: string; readonly sha256: string; readonly width: 4 | 8;
  readonly preferred: bigint; readonly gameApiRva: bigint; readonly relocationRva: bigint; readonly originalPointer: bigint;
}[] = [
  { relativePath: "ctf/gamex86.dll", sha256: "18c4b8b84aa9ff977dfa14bca01bf9ee9f701028f831a07660354fc8ad20a4c9",
    width: 4, preferred: 0x20000000n, gameApiRva: 0x13d6fn, relocationRva: 0x1008n, originalPointer: 0x20053cacn },
  { relativePath: "rerelease/baseq2/game_x64.dll", sha256: "045d49c53722d9b922caf14f168dd28a97d4c514a6e443a3140560f8668baccd",
    width: 8, preferred: 0x180000000n, gameApiRva: 0x6bcd0n, relocationRva: 0x13b4c8n, originalPointer: 0x180047620n },
];
for (const entry of cases) {
  const path = join(homedir(), "Projects/qfiles/q2", entry.relativePath);
  test.skipIf(!existsSync(path))(`installed ${entry.relativePath} maps exports and relocations without executing native code`, async () => {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    const module: ModuleIdentity = { id: "test:installed-pe", artifactPath: path, revision: entry.sha256, digest: createContentDigest(entry.sha256) };
    for (const delta of [0n, 0x10000000n]) {
      const memory = new SparseGuestMemory({ module, pointerBytes: entry.width });
      const image = mapPeImage({ bytes, memory, base: entry.preferred + delta });
      const exported = resolvePeExport(image, { kind: "name", name: "GetGameAPI", version: null }, () => null);
      expect(exported.address.byteOffset).toBe(entry.preferred + delta + entry.gameApiRva);
      expect(memory.readPointer(memory.offset(image.base, entry.relocationRva))?.byteOffset).toBe(entry.originalPointer + delta);
      if (entry.width === 4) {
        expect(image.imports.length).toBe(50);
        expect(image.tls).toBeNull();
        expect(memory.fetch(memory.offset(image.base, 0x1000n), 8)).toEqual(new Uint8Array([0x55, 0x8b, 0xec, 0x83, 0xec, 0x0c, 0x83, 0x3d]));
      } else {
        expect(resolvePeExport(image, { kind: "name", name: "GetCGameAPI", version: null }, () => null).address.byteOffset).toBe(image.base.byteOffset + 0x49f60n);
        expect(image.imports.length).toBe(140);
        expect(image.tls?.initialized.length).toBe(8);
        expect(image.tlsIndexAddress).not.toBeNull();
        expect(image.unwind.length).toBe(5480);
        expect(image.unwindRecords[0]?.unwindInfoRva).toBe(0x17bc88);
        expect(image.loadConfiguration?.bytes.length).toBe(0x140);
      }
    }
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
  });
}
