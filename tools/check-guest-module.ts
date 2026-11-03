// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * Loads a Linux ELF game module (i386 or x86-64) into the guest CPU and System V runtime, runs its DT_INIT and DT_INIT_ARRAY
 * initializers and then its finalizers, and reports the outcome. This is the supported way to learn whether a native Linux
 * module can be hosted before wiring it to a game API:
 *
 *   bun tools/check-guest-module.ts path/to/gamex86_64.so
 */
import { createHash } from "node:crypto";
import { createContentDigest } from "../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, ModuleIdentity } from "../src/contracts/execution.ts";
import { GuestCallRunner } from "../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../src/guest/core/index.ts";
import { nativeQ3Export } from "../src/compat/q3/native/index.ts";
import { SystemVGuestRuntime } from "../src/guest/runtime/system-v/index.ts";
import { X64Cpu } from "../src/guest/x64/index.ts";
import { I386Cpu } from "../src/guest/x86/index.ts";

export interface GuestModuleReport {
  readonly architecture: "i386" | "x86-64";
  readonly initializers: number;
  readonly finalizers: number;
  /** Quake III style entry points the image exports; the game API that would host it is chosen by the caller. */
  readonly entries: readonly string[];
  readonly outcome: "ok" | "failed";
  readonly detail: string | null;
}

/** Hosts one ELF image in a private guest process. Faults and unsupported services are reported, not thrown. */
export function checkGuestModule(bytes: Uint8Array, name: string, instructionBudget = 5_000_000): GuestModuleReport {
  const wide = bytes[4] === 2, width = wide ? 8 : 4;
  const architecture = wide ? "x86-64" : "i386";
  const module: ModuleIdentity = { id: `check:${name}`, artifactPath: name, revision: "1", digest: createContentDigest(createHash("sha256").update(bytes).digest("hex")) };
  const memory = new SparseGuestMemory({ module, pointerBytes: width, allocationBase: 0x50000000n });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const sentinel = memory.map({ base: 0x30000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
  const callbacks = new GuestCallbackTable(memory), runtime = new SystemVGuestRuntime({ memory, callbacks, capabilities: { nowSeconds: () => 0n } });
  const state = createGuestProcessorState({ architecture, instructionPointer: sentinel.byteOffset, stackPointer: 0x20000n,
    flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
  const cpu = wide ? new X64Cpu({ state, memory, isHostCall }) : new I386Cpu({ state, memory, hostCall: isHostCall });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: sentinel });
  runtime.attachRunner(runner);
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: sentinel, abi: runtime.signature([], "void").abi }, parent: null, self: null, other: null };
  const trace = (phase: "initialize" | "finalize"): number => runtime.lifecycleTrace.filter(entry => entry.phase === phase).length;
  try {
    const image = runtime.load({ bytes, module, loadBias: 0x10000000n });
    runtime.initialize(image, { context, instructionBudget });
    runtime.finalize(image, { context, instructionBudget });
    const entries = ["dllEntry", "vmMain"].filter(symbol => nativeQ3Export(image, symbol) !== null);
    return { architecture, initializers: trace("initialize"), finalizers: trace("finalize"), entries, outcome: "ok", detail: null };
  } catch (error) {
    return { architecture, initializers: trace("initialize"), finalizers: trace("finalize"), entries: [], outcome: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

if (import.meta.main) {
  const path = Bun.argv[2];
  if (path === undefined) { console.error("usage: bun tools/check-guest-module.ts <module.so>"); process.exit(2); }
  const report = checkGuestModule(new Uint8Array(await Bun.file(path).arrayBuffer()), path);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.outcome === "ok" ? 0 : 1);
}
