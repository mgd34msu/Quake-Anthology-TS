// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * Loads a Linux ELF game module (i386 or x86-64) into the guest CPU and System V runtime, runs its DT_INIT and DT_INIT_ARRAY
 * initializers and then its finalizers, and reports the outcome. This is the supported way to learn whether a native Linux
 * module can be hosted before wiring it to a game API:
 *
 *   bun tools/check-guest-module.ts path/to/gamex86_64.so
 *
 * With --run the module (a Quake III Windows i386 DLL, a Quake III Linux i386 ELF or a Quake Live ELF) is instead booted through the Q3 native game host: GAME_INIT runs
 * against recording engine services, the traps it reaches are reported, and the first unbound or failing service ends the run:
 *
 *   bun tools/check-guest-module.ts --run path/to/qagamex86.dll
 */
import { createHash } from "node:crypto";
import { createContentDigest } from "../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, ModuleIdentity } from "../src/contracts/execution.ts";
import { GuestCallRunner } from "../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../src/guest/core/index.ts";
import { nativeQ3Export } from "../src/compat/q3/native/index.ts";
import { SystemVGuestRuntime } from "../src/guest/runtime/system-v/index.ts";
import { q3NativeProfile, Q3NativeGuestSource } from "../src/app/bootstrap/simulation/q3/native-guest-source.ts";
import type { Q3NativeProfile } from "../src/app/bootstrap/simulation/q3/native-guest-source.ts";
import { qvmCommonSyscall } from "../src/compat/qvm/common-syscalls.ts";
import { qvmServerInformationSyscall } from "../src/compat/qvm/server-info-syscalls.ts";
import { rejectQvmSyscall } from "../src/compat/qvm/syscalls.ts";
import { CvarRegistry } from "../src/core/cvars/index.ts";
import { createIdentityOwner } from "../src/contracts/identity.ts";
import type { NativeQ3GameServices } from "../src/compat/q3/native/index.ts";
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
  const wide = bytes[4] === 2,
    width = wide ? 8 : 4;
  const architecture = wide ? "x86-64" : "i386";
  const module: ModuleIdentity = {
    id: `check:${name}`,
    artifactPath: name,
    revision: "1",
    digest: createContentDigest(createHash("sha256").update(bytes).digest("hex")),
  };
  const memory = new SparseGuestMemory({ module, pointerBytes: width, allocationBase: 0x50000000n });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const sentinel = memory.map({ base: 0x30000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
  const callbacks = new GuestCallbackTable(memory),
    runtime = new SystemVGuestRuntime({ memory, callbacks, capabilities: { nowSeconds: () => 0n } });
  const state = createGuestProcessorState({
    architecture,
    instructionPointer: sentinel.byteOffset,
    stackPointer: 0x20000n,
    flags: 2n,
    x87ControlWord: 0x37f,
    mxcsr: 0x1f80,
    mxcsrMask: 0xffff,
  });
  const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
  const cpu = wide ? new X64Cpu({ state, memory, isHostCall }) : new I386Cpu({ state, memory, hostCall: isHostCall });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: sentinel });
  runtime.attachRunner(runner);
  const context: GuestCallContext = {
    module,
    callback: { kind: "native-guest", module, address: sentinel, abi: runtime.signature([], "void").abi },
    parent: null,
    self: null,
    other: null,
  };
  const trace = (phase: "initialize" | "finalize"): number => runtime.lifecycleTrace.filter(entry => entry.phase === phase).length;
  try {
    const image = runtime.load({ bytes, module, loadBias: 0x10000000n });
    runtime.initialize(image, { context, instructionBudget });
    runtime.finalize(image, { context, instructionBudget });
    const entries = ["dllEntry", "vmMain"].filter(symbol => nativeQ3Export(image, symbol) !== null);
    return { architecture, initializers: trace("initialize"), finalizers: trace("finalize"), entries, outcome: "ok", detail: null };
  } catch (error) {
    return {
      architecture,
      initializers: trace("initialize"),
      finalizers: trace("finalize"),
      entries: [],
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface GuestRunReport {
  readonly profile: Q3NativeProfile | null;
  readonly outcome: "ok" | "failed";
  /** Engine output the module produced while initializing and shutting down. */
  readonly output: readonly string[];
  readonly detail: string | null;
}

/** Boots a native Q3 module through the game host with recording services and runs GAME_INIT and GAME_SHUTDOWN. Failures are reported, not thrown. */
export async function runGuestModule(bytes: Uint8Array, name: string, instructionBudget = 5_000_000): Promise<GuestRunReport> {
  const output: string[] = [];
  let profile: Q3NativeProfile | null = null;
  try {
    profile = q3NativeProfile(bytes);
    const module: ModuleIdentity = {
      id: `q3:check-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      artifactPath: name,
      revision: "1",
      digest: createContentDigest(createHash("sha256").update(bytes).digest("hex")),
    };
    const configstrings = new Map<number, string>(),
      refuse = (what: string) => (): never => {
        throw new Error(`The check host has no ${what}`);
      };
    const cvars = new CvarRegistry({
      dialect: "q3",
      context: { session: createIdentityOwner("check-guest-module").session, origin: { kind: "server-console" } },
      print: text => output.push(text),
    });
    const services: NativeQ3GameServices = {
      cvars,
      commandArguments: () => [],
      milliseconds: () => 0,
      configstrings: {
        get: index => configstrings.get(index) ?? "",
        set: (index, value) => {
          configstrings.set(index, value);
        },
      },
      engine: {
        print: text => output.push(text),
        log: text => output.push(text),
        appendConsoleCommand: text => output.push(`append: ${text}`),
        executeConsoleNow: text => output.push(`now: ${text}`),
        sendServerCommand: (client, text) => output.push(`${client}: ${text}`),
        dropClient: refuse("clients"),
        getUserinfo: refuse("clients"),
        setUserinfo: refuse("clients"),
        getUserCommand: refuse("clients"),
      },
    };
    // The check host serves the traps that need no map or clients; any other trap ends the run as an unbound service.
    const common = {
      role: "qagame" as const,
      cvars,
      print: (text: string) => output.push(text),
      milliseconds: () => 0,
      arguments: () => [] as readonly string[],
      realTime: () => 0,
      commands: {
        executeNow: (text: string | null) => {
          output.push(`now: ${text ?? ""}`);
        },
        insert: (text: string) => {
          output.push(`insert: ${text}`);
        },
        append: (text: string) => {
          output.push(`append: ${text}`);
        },
      },
    };
    const info = {
      cvars,
      configstrings: {
        get: (index: number) => configstrings.get(index) ?? "",
        set: (index: number, value: string) => {
          configstrings.set(index, value);
        },
      },
    };
    const source = Q3NativeGuestSource.create({
      prepared: { bytes, profile, module },
      services,
      instructionBudget,
      traps: call => qvmCommonSyscall(call, common) ?? qvmServerInformationSyscall(call, { abiProfile: "q3-modern", ...info }) ?? rejectQvmSyscall(call),
    });
    try {
      await source.initializeAsync(0, 1);
      await source.shutdownAsync(false);
    } finally {
      source.retire();
    }
    return { profile, outcome: "ok", output, detail: null };
  } catch (error) {
    return { profile, outcome: "failed", output, detail: error instanceof Error ? error.message : String(error) };
  }
}

if (import.meta.main && Bun.argv[2] === "--run") {
  const path = Bun.argv[3];
  if (path === undefined) {
    console.error("usage: bun tools/check-guest-module.ts --run <qagame module>");
    process.exit(2);
  }
  const report = await runGuestModule(new Uint8Array(await Bun.file(path).arrayBuffer()), path);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.outcome === "ok" ? 0 : 1);
}

if (import.meta.main && Bun.argv[2] !== "--run") {
  const path = Bun.argv[2];
  if (path === undefined) {
    console.error("usage: bun tools/check-guest-module.ts [--run] <module>");
    process.exit(2);
  }
  const report = checkGuestModule(new Uint8Array(await Bun.file(path).arrayBuffer()), path);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.outcome === "ok" ? 0 : 1);
}
