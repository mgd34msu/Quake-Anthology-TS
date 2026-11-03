// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResolvedExecutionModule } from "../../../../contracts/content.ts";
import type { GuestAddress, GuestCallContext, ModuleIdentity } from "../../../../contracts/execution.ts";
import type { MountedContent } from "../../../../content/mounts/index.ts";
import { GuestCallRunner } from "../../../../guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../guest/core/index.ts";
import { mapPeImage, parsePe } from "../../../../guest/pe/index.ts";
import { WindowsGuestRuntime } from "../../../../guest/runtime/windows/index.ts";
import type { WindowsCapabilities, WindowsFile } from "../../../../guest/runtime/windows/contracts.ts";
import { SystemVGuestRuntime } from "../../../../guest/runtime/system-v/index.ts";
import { readString } from "../../../../guest/runtime/common/memory.ts";
import { X64Cpu } from "../../../../guest/x64/index.ts";
import { I386Cpu } from "../../../../guest/x86/index.ts";
import { QvmGameExport } from "../../../../compat/qvm/abi.ts";
import { NativeQ3GameData, nativeQ3GameSyscalls, NativeQ3Syscalls, QuakeLiveGameImports, QuakeLiveGameModule, Quake3VmModule, nativeQ3Export } from "../../../../compat/q3/native/index.ts";
import type { NativeQ3GameServices } from "../../../../compat/q3/native/index.ts";

type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: "native" }>;
export type Q3NativeProfile = "q3-pe" | "quake-live-elf";

/** A native Q3 or Quake Live module image: its bytes, which API profile its format implies, and the identity every guest call is attributed to. */
export interface Q3NativeImage {
  readonly bytes: Uint8Array;
  readonly profile: Q3NativeProfile;
  readonly module: ModuleIdentity;
}
/** The image of a selected execution module in the unified provider model. */
export interface PreparedQ3Native extends Q3NativeImage {
  readonly execution: NativeExecution;
}

const elfMagic = [0x7f, 0x45, 0x4c, 0x46];
export function q3NativeProfile(bytes: Uint8Array): Q3NativeProfile {
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return "q3-pe";
  if (elfMagic.every((value, index) => bytes[index] === value)) return "quake-live-elf";
  throw new Error("Native Q3 server game must be a Windows PE or a Linux ELF image");
}

/** Provider admission: the selected execution form must be a native server-game for the Q3 qagame API, and its image must carry the module's entry points. */
export async function prepareQ3Native(execution: NativeExecution, mounts: MountedContent): Promise<PreparedQ3Native> {
  if (execution.role !== "server-game" || execution.api.kind !== "q3-qagame") throw new Error("Native Q3 guest preparation requires a q3-qagame server-game artifact");
  const bytes = await mounts.read(execution.artifact), profile = q3NativeProfile(bytes);
  if (profile === "q3-pe") {
    const pe = parsePe(bytes);
    if (pe.abi.kind !== "windows-i386" || execution.profile.kind !== "windows-i386") throw new Error("Native Q3 1.32 modules require the Windows i386 profile");
    if (execution.api.version !== 7 && execution.api.version !== 8) throw new Error("Native Q3 server games implement game API 7 or 8");
  } else if (execution.profile.kind === "windows-i386" || execution.profile.kind === "windows-x86-64") throw new Error("Native ELF module declared a Windows profile");
  const reference = execution.artifact;
  return { execution, bytes, profile, module: { id: execution.owner.provider, artifactPath: reference.requestedPath, digest: reference.digest,
    revision: `${reference.provenance.mount.identity.id}:${reference.provenance.mount.identity.generation}` } };
}

/** QvmGame's lifecycle shape over a native module, so the Q3 runtime can select either execution form for the same provider. */
export interface Q3ServerGameModule {
  initialize(levelTime: number, randomSeed: number, restart?: boolean): void;
  shutdown(restart: boolean): void;
  clientConnect(client: number, firstTime: boolean, isBot: boolean): string | null;
  clientBegin(client: number): void;
  clientUserinfoChanged(client: number): void;
  clientDisconnect(client: number): void;
  clientCommand(client: number, arguments_: readonly string[]): void;
  clientThink(client: number): void;
  runFrame(time: number): void;
  consoleCommand(arguments_: readonly string[]): boolean;
  botFrame(time: number): void;
}

export interface Q3NativeGuestOptions {
  readonly prepared: Q3NativeImage;
  readonly services: NativeQ3GameServices;
  readonly windows?: WindowsCapabilities;
  readonly instructionBudget?: number;
}

type Phase = "created" | "running" | "closed";
type Lifecycle = Q3ServerGameModule & { readonly syscalls: NativeQ3Syscalls | null; readonly imports: QuakeLiveGameImports | null };

/**
 * Hosts one native Q3 qagame module in a private guest process. The Windows i386 form runs through dllEntry(syscall)/vmMain; the Quake Live
 * form runs through dllEntry(output, imports, version) and its export table. Both reach the same engine services and the same record locator.
 */
export class Q3NativeGuestSource implements Q3ServerGameModule {
  readonly data: NativeQ3GameData;
  private phase: Phase = "created";
  private constructor(readonly prepared: Q3NativeImage, readonly memory: SparseGuestMemory, readonly runner: GuestCallRunner, private readonly lifecycle: Lifecycle,
    data: NativeQ3GameData, private readonly files: Set<WindowsFile>, private readonly detach: () => void) {
    this.data = data;
  }

  static create(options: Q3NativeGuestOptions): Q3NativeGuestSource {
    const { prepared, services } = options, budget = options.instructionBudget ?? 5_000_000, { bytes, module } = prepared;
    const files = new Set<WindowsFile>(), argumentsOf: { current: readonly string[] | null } = { current: null };
    const windows = prepared.profile === "q3-pe";
    const wide = !windows && bytes[4] === 2, width = windows || !wide ? 4 : 8;
    const memory = new SparseGuestMemory({ module, pointerBytes: width, ...(windows ? {} : { allocationBase: 0x50000000n }) });
    try {
      const callbacks = new GuestCallbackTable(memory);
      const stackBytes = 1_048_576;
      // Variadic syscall arguments are decoded from the stack top; keep a mapped guard above the first frame.
      const stack = memory.allocate({ byteLength: stackBytes + 4096, alignment: 16n, label: "native Q3 stack" });
      const returned = memory.allocate({ byteLength: 16, permissions: "read-execute", label: "native Q3 return" });
      const state = createGuestProcessorState({ architecture: width === 8 ? "x86-64" : "i386", instructionPointer: 0n, stackPointer: stack.byteOffset + BigInt(stackBytes) - 16n,
        flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
      const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
      const cpu = width === 8 ? new X64Cpu({ state, memory, isHostCall }) : new I386Cpu({ state, memory, callbacks });
      let syscalls: NativeQ3Syscalls | null = null;
      const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: returned, variadicLayouts: (callback, fixed) => {
        const layouts = syscalls?.variadicLayouts(callback, fixed) ?? null;
        if (layouts === null) throw new Error("Native Q3 variadic callback has no declared layout");
        return layouts;
      } });
      const data = new NativeQ3GameData(memory), argv = (): readonly string[] => argumentsOf.current ?? services.commandArguments();
      if (windows) {
        const image = mapPeImage({ bytes, memory });
        const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { ...options.windows, openFile: (path, mode) => {
          const file = options.windows?.openFile?.(path, mode) ?? null;
          if (file === null) return null;
          const owned: WindowsFile = { read: (offset, length) => file.read(offset, length), write: (offset, data_) => file.write(offset, data_), size: () => file.size(),
            truncate: length => file.truncate(length), flush: () => file.flush(), close: () => { if (files.delete(owned)) file.close(); } };
          files.add(owned); return owned;
        } } });
        runtime.attachRunner(runner);
        const vmMain = nativeQ3Export(image, "vmMain");
        if (vmMain === null) throw new Error("Native Q3 module has no vmMain export");
        const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: vmMain, abi: image.abi }, parent: null, self: null, other: null };
        runtime.initialize(image, { context, instructionBudget: budget });
        syscalls = new NativeQ3Syscalls(callbacks, image.abi, nativeQ3GameSyscalls(memory, services, data, argv));
        const game = new Quake3VmModule({ image, runner, context, instructionBudget: budget }, syscalls.address);
        const call = (command: QvmGameExport, values: readonly number[] = []): number => game.call(command, values);
        const lifecycle: Lifecycle = { syscalls, imports: null,
          initialize: (levelTime, seed, restart = false) => { call(QvmGameExport.GAME_INIT, [levelTime, seed, Number(restart)]); },
          shutdown: restart => { call(QvmGameExport.GAME_SHUTDOWN, [Number(restart)]); },
          clientConnect: (client, firstTime, isBot) => {
            const denied = call(QvmGameExport.GAME_CLIENT_CONNECT, [client, Number(firstTime), Number(isBot)]);
            const address = denied === 0 ? null : memory.pointer(BigInt(denied >>> 0));
            return address === null ? null : readString(memory, address);
          },
          clientBegin: client => { call(QvmGameExport.GAME_CLIENT_BEGIN, [client]); },
          clientUserinfoChanged: client => { call(QvmGameExport.GAME_CLIENT_USERINFO_CHANGED, [client]); },
          clientDisconnect: client => { call(QvmGameExport.GAME_CLIENT_DISCONNECT, [client]); },
          clientCommand: (client, arguments_) => { argumentsOf.current = arguments_; try { call(QvmGameExport.GAME_CLIENT_COMMAND, [client]); } finally { argumentsOf.current = null; } },
          clientThink: client => { call(QvmGameExport.GAME_CLIENT_THINK, [client]); },
          runFrame: time => { call(QvmGameExport.GAME_RUN_FRAME, [time]); },
          consoleCommand: arguments_ => { argumentsOf.current = arguments_; try { return call(QvmGameExport.GAME_CONSOLE_COMMAND) !== 0; } finally { argumentsOf.current = null; } },
          botFrame: time => { call(QvmGameExport.BOTAI_START_FRAME, [time]); },
        };
        return new Q3NativeGuestSource(prepared, memory, runner, lifecycle, data, files, () => runtime.detach(image, { context, instructionBudget: budget }));
      }
      const sentinel = memory.map({ base: 0x30000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
      const runtime = new SystemVGuestRuntime({ memory, callbacks, capabilities: { nowSeconds: () => BigInt(Math.trunc(services.milliseconds() / 1000)) } });
      runtime.attachRunner(runner);
      const abi = runtime.signature([], "void").abi;
      const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: sentinel, abi }, parent: null, self: null, other: null };
      const image = runtime.load({ bytes, module, loadBias: width === 4 ? 0x10000000n : 0x100000000n });
      runtime.initialize(image, { context, instructionBudget: budget });
      const imports = new QuakeLiveGameImports(memory, callbacks, image.abi, { ...services, commandArguments: argv });
      const game = new QuakeLiveGameModule({ image, runner, context, instructionBudget: budget }, imports.address);
      const unverified = (name: string) => (): never => { throw new Error(`Quake Live export ${name} is outside the verified API 10 table`); };
      const lifecycle: Lifecycle = { syscalls: null, imports,
        initialize: (levelTime, seed, restart = false) => { game.registerCvars(); game.initialize(levelTime, seed, restart); },
        shutdown: restart => { game.shutdown(restart); },
        clientConnect: (client, firstTime, isBot) => {
          const address = game.clientConnect(client, firstTime, isBot);
          return address === null ? null : readString(memory, address);
        },
        clientBegin: unverified("ClientBegin"), clientUserinfoChanged: unverified("ClientUserinfoChanged"), clientDisconnect: unverified("ClientDisconnect"),
        clientCommand: unverified("ClientCommand"), clientThink: unverified("ClientThink"),
        runFrame: time => { game.runFrame(time); },
        consoleCommand: arguments_ => { argumentsOf.current = arguments_; try { return game.consoleCommand(); } finally { argumentsOf.current = null; } },
        botFrame: unverified("BotAIStartFrame"),
      };
      return new Q3NativeGuestSource(prepared, memory, runner, lifecycle, data, files, () => runtime.finalize(image, { context, instructionBudget: budget }));
    } catch (error) {
      try { releaseMemory(memory); closeFiles(files); } catch (cleanup) { throw new AggregateError([error, cleanup], "Native Q3 guest construction and cleanup failed"); }
      throw error;
    }
  }

  get profile(): Q3NativeProfile { return this.prepared.profile; }
  /** Engine services the loaded module has called, by trap or import slot. */
  get coverage(): readonly { readonly name: string; readonly reached: number }[] { return this.lifecycle.imports?.coverage.filter(call => call.reached > 0) ?? []; }
  private running<T>(run: () => T): T {
    if (this.phase === "closed") throw new Error("Native Q3 guest is closed");
    if (this.runner.depth !== 0) throw new Error("Native Q3 guest has an active call");
    return run();
  }
  initialize(levelTime: number, randomSeed: number, restart = false): void {
    if (this.phase !== "created" && !restart) throw new Error("Native Q3 GAME_INIT requires a fresh game or a restart");
    this.running(() => this.lifecycle.initialize(levelTime, randomSeed, restart)); this.phase = "running";
  }
  shutdown(restart: boolean): void { this.live(() => this.lifecycle.shutdown(restart)); }
  clientConnect(client: number, firstTime: boolean, isBot: boolean): string | null { return this.live(() => this.lifecycle.clientConnect(client, firstTime, isBot)); }
  clientBegin(client: number): void { this.live(() => this.lifecycle.clientBegin(client)); }
  clientUserinfoChanged(client: number): void { this.live(() => this.lifecycle.clientUserinfoChanged(client)); }
  clientDisconnect(client: number): void { this.live(() => this.lifecycle.clientDisconnect(client)); }
  clientCommand(client: number, arguments_: readonly string[]): void { this.live(() => this.lifecycle.clientCommand(client, arguments_)); }
  clientThink(client: number): void { this.live(() => this.lifecycle.clientThink(client)); }
  runFrame(time: number): void { this.live(() => this.lifecycle.runFrame(time)); }
  consoleCommand(arguments_: readonly string[]): boolean { return this.live(() => this.lifecycle.consoleCommand(arguments_)); }
  botFrame(time: number): void { this.live(() => this.lifecycle.botFrame(time)); }
  private live<T>(run: () => T): T {
    if (this.phase === "closed") throw new Error("Native Q3 guest is closed");
    if (this.phase !== "running") throw new Error("Native Q3 guest has not run GAME_INIT");
    return this.running(run);
  }

  /** Shuts the running game down, runs the image's finalizers, and releases the guest process. */
  close(): void {
    if (this.phase === "closed") return;
    if (this.runner.depth !== 0) throw new Error("Native Q3 guest shutdown requires a completed game call");
    const errors: unknown[] = [], initialized = this.phase === "running";
    this.runner.recover(); this.phase = "closed";
    if (initialized) { try { this.lifecycle.shutdown(false); } catch (error) { errors.push(error); } }
    try { this.detach(); } catch (error) { errors.push(error); }
    try { closeFiles(this.files); } catch (error) { errors.push(error); }
    try { releaseMemory(this.memory); } catch (error) { errors.push(error); }
    if (errors.length !== 0) throw new AggregateError(errors, "Native Q3 guest shutdown failed");
  }
}

function releaseMemory(memory: SparseGuestMemory): void {
  for (const mapping of memory.mappings()) {
    const address = memory.pointer(mapping.base); if (address !== null) memory.unmap(address, mapping.byteLength);
  }
}
function closeFiles(files: Set<WindowsFile>): void {
  const errors: unknown[] = [];
  for (const file of [...files]) { try { file.close(); } catch (error) { errors.push(error); } }
  if (errors.length !== 0) throw new AggregateError(errors, "Native Q3 guest file cleanup failed");
}
