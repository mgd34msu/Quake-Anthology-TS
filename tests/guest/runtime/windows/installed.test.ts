// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { ModuleIdentity, GuestCallContext, GuestAddress } from "../../../../src/contracts/execution.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { GuestCallRunner, GuestCallStopped } from "../../../../src/guest/abi/index.ts";
import { I386Cpu } from "../../../../src/guest/x86/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { mapPeImage, parsePe } from "../../../../src/guest/pe/index.ts";
import { UnsupportedWindowsImport, WindowsGuestRuntime } from "../../../../src/guest/runtime/windows/index.ts";

for (const relativePath of ["ctf/gamex86.dll", "lmctf/gamex86.dll", "rerelease/baseq2/game_x64.dll"]) {
  const path = join(homedir(), "Projects/qfiles/q2", relativePath);
  test.skipIf(!existsSync(path))(`actual ${relativePath} performs Windows DLL attach and detach through guest instructions`, async () => {
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const digest = createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    const module: ModuleIdentity = { id: "test:windows-startup", artifactPath: path, revision: "installed", digest };
    const width = parsePe(bytes).abi.pointerBytes;
    const memory = new SparseGuestMemory({ module, pointerBytes: width, allocationBase: 0x10000000n });
    const image = mapPeImage({ bytes, memory });
    const callbacks = new GuestCallbackTable(memory);
    const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { nowMilliseconds: () => 1789084800000, performanceCounter: () => 123456789n } });
    const stack = memory.allocate({ byteLength: 0x100000, alignment: 4096n, label: "Windows thread stack" });
    const returnAddress = memory.allocate({ byteLength: 16, permissions: "read-execute" });
    const state = createGuestProcessorState({ architecture: width === 4 ? "i386" : "x86-64", instructionPointer: returnAddress.byteOffset,
      stackPointer: stack.byteOffset + 0x100000n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
    runtime.prepareImage(image);
    if (image.tlsIndexAddress !== null && image.tls !== null) {
      const block = memory.readPointer(memory.offset(runtime.staticTls, BigInt(memory.readUint32(image.tlsIndexAddress) * width)));
      if (block === null) throw new Error("Static TLS block missing");
      expect(memory.copy(block, image.tls.initialized.length)).toEqual(image.tls.initialized);
    }
    const traps = new Set(callbacks.checkpoint().map(entry => entry.byteOffset));
    const isHostCall = (address: GuestAddress): boolean => traps.has(address.byteOffset);
    const cpu = width === 4 ? new I386Cpu({ memory, state, hostCall: isHostCall }) : new X64Cpu({ memory, state, isHostCall });
    const runner = new GuestCallRunner({ cpu, callbacks, returnAddress }); runtime.attachRunner(runner);
    const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: image.base, abi: image.abi }, parent: null, self: null, other: null };
    try {
      runtime.initialize(image, { context, instructionBudget: 1000000 });
      expect(runtime.coverage.some(entry => entry.reached > 0)).toBe(true);
      expect(runtime.coverage.filter(entry => !entry.supported && entry.reached > 0)).toEqual([]);
      if (width === 8 && image.loadConfiguration?.securityCookieAddress !== null && image.loadConfiguration?.securityCookieAddress !== undefined) {
        expect(memory.readUint64(image.loadConfiguration.securityCookieAddress)).not.toBe(0x2b992ddfa232n);
        expect(runtime.coverage.some(entry => entry.name === "guard-dispatch-check" && entry.reached > 0)).toBe(true);
        const index = image.tlsIndexAddress; if (index === null || image.tls === null) throw new Error("Installed rerelease TLS metadata missing");
        const block = memory.readPointer(memory.offset(runtime.staticTls, BigInt(memory.readUint32(index) * width)));
        if (block === null) throw new Error("Static TLS block missing");
        expect(memory.readUint32(memory.offset(block, 4n))).toBe(0x80000001);
      }
      runtime.detach(image, { context, instructionBudget: 1000000 });
      if (width === 8) {
        const lookup = runtime.resolveAddress("kernel32.dll", "RtlLookupFunctionEntry"), guard = runtime.resolveAddress("quake-runtime.dll", "guard-dispatch-check");
        if (lookup === null || guard === null) throw new Error("Missing Windows unwind/CFG services");
        const imageBaseOutput = memory.allocate({ byteLength: 8 });
        const result = callbacks.invoke(lookup, context, [{ kind: "uint64", value: image.base.byteOffset + 0x1000n }, { kind: "pointer", value: imageBaseOutput }, { kind: "pointer", value: null }]);
        expect(result.kind === "pointer" ? result.value?.byteOffset : null).toBe(image.base.byteOffset + 0x299000n);
        expect(memory.readUint64(imageBaseOutput)).toBe(image.base.byteOffset);
        expect(() => callbacks.invoke(guard, context, [{ kind: "pointer", value: image.base }])).toThrow(UnsupportedWindowsImport);
      }
    } catch (error) {
      if (error instanceof GuestCallStopped) console.error(relativePath, error.stop);
      console.error("Reached Windows services:", runtime.coverage.filter(entry => entry.reached > 0)); throw error;
    }
    expect(createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"))).toBe(digest);
  });
}
