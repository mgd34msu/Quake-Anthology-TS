// SPDX-License-Identifier: GPL-2.0-or-later
import type { ResolvedExecutionModule } from "../../../../contracts/content.ts";
import type {
  GuestAddress,
  GuestCallContext,
  GuestMappingRecord,
  ModuleIdentity,
  NativeGuestCheckpoint,
  NativeGuestHeapImage,
  NativeHeapBlock,
  WindowsHeapTables,
} from "../../../../contracts/execution.ts";
import type { MountedContent } from "../../../../content/mounts/index.ts";
import { GuestCallRunner } from "../../../../guest/abi/index.ts";
import { inspectElf } from "../../../../guest/elf/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../guest/core/index.ts";
import type { GuestProcessorState } from "../../../../guest/core/index.ts";
import { mapPeImage, parsePe } from "../../../../guest/pe/index.ts";
import { WindowsGuestRuntime } from "../../../../guest/runtime/windows/index.ts";
import type { WindowsCapabilities, WindowsFile } from "../../../../guest/runtime/windows/contracts.ts";
import { SystemVGuestRuntime } from "../../../../guest/runtime/system-v/index.ts";
import { readString } from "../../../../guest/runtime/common/memory.ts";
import { X64Cpu } from "../../../../guest/x64/index.ts";
import { I386Cpu } from "../../../../guest/x86/index.ts";
import { QvmGameExport, QvmGameImport } from "../../../../compat/qvm/abi.ts";
import { QvmGameData } from "../../../../compat/qvm/game-data.ts";
import type { Q3GameMemory } from "../../../../compat/qvm/game-memory.ts";
import type { QvmHostState } from "../../../../compat/qvm/module.ts";
import { qvmIntrinsicSyscall } from "../../../../compat/qvm/syscalls.ts";
import type { QvmHostResult, SharedHostCall } from "../../../../compat/qvm/syscalls.ts";
import {
  NativeGameMemory,
  nativeQ3GameCall,
  NativeQ3Syscalls,
  QuakeLiveGameImports,
  QuakeLiveGameModule,
  Quake3VmModule,
  nativeQ3Export,
} from "../../../../compat/q3/native/index.ts";
import type { NativeQ3GameServices } from "../../../../compat/q3/native/index.ts";
import type { Q3GameEngine, Q3GuestCheckpoint } from "./engine.ts";

type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: "native" }>;
/** A Windows PE or a Linux ELF with vmMain runs id's dllEntry(syscall) / vmMain interface; a Linux ELF without it is the Quake Live table interface. */
export type Q3NativeProfile = "q3-pe" | "q3-elf" | "quake-live-elf";

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
  if (elfMagic.every((value, index) => bytes[index] === value)) {
    return inspectElf(bytes).symbols.some(symbol => symbol.name === "vmMain" && symbol.section !== 0) ? "q3-elf" : "quake-live-elf";
  }
  throw new Error("Native Q3 server game must be a Windows PE or a Linux ELF image");
}

/** Provider admission: the selected execution form must be a native server-game for the Q3 qagame API, and its image must carry the module's entry points. */
export async function prepareQ3Native(execution: NativeExecution, mounts: MountedContent): Promise<PreparedQ3Native> {
  if (execution.role !== "server-game" || execution.api.kind !== "q3-qagame")
    throw new Error("Native Q3 guest preparation requires a q3-qagame server-game artifact");
  const bytes = await mounts.read(execution.artifact),
    profile = q3NativeProfile(bytes);
  if (profile === "q3-pe") {
    const pe = parsePe(bytes);
    if (pe.abi.kind !== "windows-i386" || execution.profile.kind !== "windows-i386") throw new Error("Native Q3 1.32 modules require the Windows i386 profile");
  } else if (execution.profile.kind === "windows-i386" || execution.profile.kind === "windows-x86-64")
    throw new Error("Native ELF module declared a Windows profile");
  else if (profile === "q3-elf" && execution.profile.kind !== "linux-i386") throw new Error("Native Q3 1.32 modules require the i386 profile");
  if (profile !== "quake-live-elf" && execution.api.version !== 8) throw new Error("Native Q3 server games implement the 1.32 game API (version 8)");
  const reference = execution.artifact;
  return {
    execution,
    bytes,
    profile,
    module: {
      id: execution.owner.provider,
      artifactPath: reference.requestedPath,
      digest: reference.digest,
      revision: `${reference.provenance.mount.identity.id}:${reference.provenance.mount.identity.generation}`,
    },
  };
}

export interface Q3NativeGuestOptions {
  readonly prepared: Q3NativeImage;
  /** Q3 1.32 modules: the server game's shared trap table, which also serves interpreted modules. */
  readonly traps?: (call: SharedHostCall) => QvmHostResult;
  /** Quake Live API 10 modules: the engine services behind the import table. */
  readonly services?: NativeQ3GameServices;
  /** Saves and restores the server game's own record; required to checkpoint. */
  readonly hostState?: QvmHostState;
  readonly windows?: WindowsCapabilities;
  readonly instructionBudget?: number;
}

type Phase = "created" | "running" | "closed";
/** The runtime's own heap tables, which move with the mappings they describe. */
interface HeapTables {
  capture(): { readonly blocks: readonly NativeHeapBlock[]; readonly windows: WindowsHeapTables | null };
  restore(blocks: readonly NativeHeapBlock[], windows: WindowsHeapTables | null): void;
}
interface Lifecycle {
  readonly imports: QuakeLiveGameImports | null;
  initialize(levelTime: number, randomSeed: number, restart: boolean): Promise<void>;
  shutdown(restart: boolean): Promise<void>;
  clientConnect(client: number, firstTime: boolean, isBot: boolean): Promise<string | null>;
  clientBegin(client: number): Promise<void>;
  clientUserinfoChanged(client: number): Promise<void>;
  clientDisconnect(client: number): Promise<void>;
  clientCommand(client: number, argv: readonly string[]): Promise<void>;
  clientCommandNow(client: number, argv: readonly string[]): void;
  clientThink(client: number): Promise<void>;
  runFrame(time: number): Promise<void>;
  consoleCommand(argv: readonly string[]): Promise<boolean>;
  botFrame(time: number): Promise<void>;
}

const STACK_LABEL = "native Q3 stack";
const PROCESSOR_LAYOUT = { id: "q3:native-processor", byteLength: 0, alignment: 1, byteOrder: "little-endian", fields: [] } as const;
const writable = (permissions: string): boolean => permissions === "read-write" || permissions === "read-write-execute";

/**
 * Hosts one native Q3 qagame module in a private guest process. A Windows i386 PE or a Linux i386 ELF runs through dllEntry(syscall)/vmMain,
 * with every trap decoded by the same table that serves interpreted modules; the Quake Live form runs through dllEntry(output, imports,
 * version) and its export table. The module owns its entity and player tables, which the server game reads through {@link data}.
 */
export class Q3NativeGuestSource implements Q3GameEngine {
  readonly kind = "native";
  readonly data: QvmGameData;
  private phase: Phase = "created";
  private readonly baseline: ReadonlySet<string>;
  private constructor(
    readonly prepared: Q3NativeImage,
    readonly memory: SparseGuestMemory,
    readonly runner: GuestCallRunner,
    private readonly lifecycle: Lifecycle,
    data: QvmGameData,
    private readonly files: Set<WindowsFile>,
    private readonly state: GuestProcessorState,
    private readonly hostState: QvmHostState | undefined,
    private readonly abi: NativeGuestCheckpoint["abi"],
    private readonly detach: () => void,
    private readonly heap: HeapTables,
  ) {
    this.data = data;
    this.baseline = new Set(describedMappings(memory).map(mappingKey));
  }

  static create(options: Q3NativeGuestOptions): Q3NativeGuestSource {
    const { prepared } = options,
      budget = options.instructionBudget ?? 5_000_000,
      { bytes, module } = prepared;
    const files = new Set<WindowsFile>(),
      argumentsOf: { current: readonly string[] | null } = { current: null };
    const windows = prepared.profile === "q3-pe";
    const wide = !windows && bytes[4] === 2,
      width = windows || !wide ? 4 : 8;
    const memory = new SparseGuestMemory({ module, pointerBytes: width, ...(windows ? {} : { allocationBase: 0x50000000n }) });
    try {
      const callbacks = new GuestCallbackTable(memory);
      const stackBytes = 1_048_576;
      // Variadic syscall arguments are decoded from the stack top; keep a mapped guard above the first frame.
      const stack = memory.allocate({ byteLength: stackBytes + 4096, alignment: 16n, label: STACK_LABEL });
      const returned = memory.allocate({ byteLength: 16, permissions: "read-execute", label: "native Q3 return" });
      const state = createGuestProcessorState({
        architecture: width === 8 ? "x86-64" : "i386",
        instructionPointer: 0n,
        stackPointer: stack.byteOffset + BigInt(stackBytes) - 16n,
        flags: 2n,
        x87ControlWord: 0x37f,
        mxcsr: 0x1f80,
        mxcsrMask: 0xffff,
      });
      const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
      const cpu = width === 8 ? new X64Cpu({ state, memory, isHostCall }) : new I386Cpu({ state, memory, callbacks });
      let syscalls: NativeQ3Syscalls | null = null;
      const runner = new GuestCallRunner({
        cpu,
        callbacks,
        returnAddress: returned,
        variadicLayouts: (callback, fixed) => {
          const layouts = syscalls?.variadicLayouts(callback, fixed) ?? null;
          if (layouts === null) throw new Error("Native Q3 variadic callback has no declared layout");
          return layouts;
        },
      });
      const guest = width === 4 ? new NativeGameMemory(memory) : null;
      const data = new QvmGameData(guest ?? unlocatedMemory(), "q3-modern");
      const argv = (): readonly string[] => argumentsOf.current ?? options.services?.commandArguments() ?? [];
      const withArguments = async <T>(values: readonly string[], run: () => Promise<T>): Promise<T> => {
        const previous = argumentsOf.current;
        argumentsOf.current = values;
        try {
          return await run();
        } finally {
          argumentsOf.current = previous;
        }
      };
      /** SV_GameSystemCalls: libc and math traps, then G_LOCATE_GAME_DATA, then the server game's table. */
      const trap = (words: DataView): number | Promise<number> => {
        if (guest === null || options.traps === undefined) throw new Error("A Q3 1.32 native module needs the server trap table");
        const intrinsic = qvmIntrinsicSyscall("qagame", "q3-modern", words, guest);
        if (intrinsic !== null) return intrinsic;
        const call = nativeQ3GameCall(words, guest, argumentsOf.current);
        if (call.kind === "engine" && call.code === QvmGameImport.G_LOCATE_GAME_DATA) {
          data.locate(words.getInt32(4, true), words.getInt32(8, true), words.getInt32(12, true), words.getInt32(16, true), words.getInt32(20, true));
          return 0;
        }
        return options.traps(call);
      };
      const q3Lifecycle = (game: Quake3VmModule): Lifecycle => {
        const call = (command: QvmGameExport, values: readonly number[] = []): Promise<number> => game.callAsync(command, values);
        return {
          imports: null,
          initialize: async (levelTime, seed, restart) => {
            await call(QvmGameExport.GAME_INIT, [levelTime, seed, Number(restart)]);
          },
          shutdown: async restart => {
            await call(QvmGameExport.GAME_SHUTDOWN, [Number(restart)]);
          },
          clientConnect: async (client, firstTime, isBot) => {
            const denied = await call(QvmGameExport.GAME_CLIENT_CONNECT, [client, Number(firstTime), Number(isBot)]);
            const address = denied === 0 ? null : memory.pointer(BigInt(denied >>> 0));
            return address === null ? null : readString(memory, address);
          },
          clientBegin: async client => {
            await call(QvmGameExport.GAME_CLIENT_BEGIN, [client]);
          },
          clientUserinfoChanged: async client => {
            await call(QvmGameExport.GAME_CLIENT_USERINFO_CHANGED, [client]);
          },
          clientDisconnect: async client => {
            await call(QvmGameExport.GAME_CLIENT_DISCONNECT, [client]);
          },
          clientCommand: (client, values) =>
            withArguments(values, async () => {
              await call(QvmGameExport.GAME_CLIENT_COMMAND, [client]);
            }),
          clientCommandNow: (client, values) => {
            const previous = argumentsOf.current;
            argumentsOf.current = values;
            try {
              game.call(QvmGameExport.GAME_CLIENT_COMMAND, [client]);
            } finally {
              argumentsOf.current = previous;
            }
          },
          clientThink: async client => {
            await call(QvmGameExport.GAME_CLIENT_THINK, [client]);
          },
          runFrame: async time => {
            await call(QvmGameExport.GAME_RUN_FRAME, [time]);
          },
          consoleCommand: values => withArguments(values, async () => (await call(QvmGameExport.GAME_CONSOLE_COMMAND)) !== 0),
          botFrame: async time => {
            await call(QvmGameExport.BOTAI_START_FRAME, [time]);
          },
        };
      };
      if (windows) {
        const image = mapPeImage({ bytes, memory });
        const runtime = new WindowsGuestRuntime({
          memory,
          callbacks,
          capabilities: {
            ...options.windows,
            openFile: (path, mode) => {
              const file = options.windows?.openFile?.(path, mode) ?? null;
              if (file === null) return null;
              const owned: WindowsFile = {
                read: (offset, length) => file.read(offset, length),
                write: (offset, data_) => file.write(offset, data_),
                size: () => file.size(),
                truncate: length => file.truncate(length),
                flush: () => file.flush(),
                close: () => {
                  if (files.delete(owned)) file.close();
                },
              };
              files.add(owned);
              return owned;
            },
          },
        });
        runtime.attachRunner(runner);
        const vmMain = nativeQ3Export(image, "vmMain");
        if (vmMain === null) throw new Error("Native Q3 module has no vmMain export");
        const context: GuestCallContext = {
          module,
          callback: { kind: "native-guest", module, address: vmMain, abi: image.abi },
          parent: null,
          self: null,
          other: null,
        };
        runtime.initialize(image, { context, instructionBudget: budget });
        syscalls = new NativeQ3Syscalls(callbacks, image.abi, trap);
        const game = new Quake3VmModule({ image, runner, context, instructionBudget: budget }, syscalls.address);
        return new Q3NativeGuestSource(
          prepared,
          memory,
          runner,
          q3Lifecycle(game),
          data,
          files,
          state,
          options.hostState,
          image.abi,
          () => runtime.detach(image, { context, instructionBudget: budget }),
          {
            capture: () => {
              const state = runtime.heapState();
              return { blocks: state.blocks, windows: state.tables };
            },
            restore: (blocks, tables) => {
              if (tables === null) throw new Error("Native Q3 checkpoint carries no Windows heap tables");
              runtime.restoreHeapState(blocks, tables);
            },
          },
        );
      }
      const sentinel = memory.map({ base: 0x30000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
      const nowSeconds = (): bigint => BigInt(Math.trunc((options.services?.milliseconds() ?? 0) / 1000));
      const runtime = new SystemVGuestRuntime({ memory, callbacks, capabilities: { nowSeconds } });
      runtime.attachRunner(runner);
      const abi = runtime.signature([], "void").abi;
      const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: sentinel, abi }, parent: null, self: null, other: null };
      const image = runtime.load({ bytes, module, loadBias: width === 4 ? 0x10000000n : 0x100000000n });
      runtime.initialize(image, { context, instructionBudget: budget });
      const finalize = (): void => runtime.finalize(image, { context, instructionBudget: budget });
      const heap: HeapTables = {
        capture: () => ({ blocks: runtime.heapState(), windows: null }),
        restore: blocks => {
          runtime.restoreHeapState(blocks);
        },
      };
      if (prepared.profile === "q3-elf") {
        syscalls = new NativeQ3Syscalls(callbacks, image.abi, trap);
        const game = new Quake3VmModule({ image, runner, context, instructionBudget: budget }, syscalls.address);
        return new Q3NativeGuestSource(prepared, memory, runner, q3Lifecycle(game), data, files, state, options.hostState, image.abi, finalize, heap);
      }
      if (options.services === undefined) throw new Error("A Quake Live native module needs the engine services behind its import table");
      const imports = new QuakeLiveGameImports(memory, callbacks, image.abi, { ...options.services, commandArguments: argv });
      const game = new QuakeLiveGameModule({ image, runner, context, instructionBudget: budget }, imports.address);
      const lifecycle: Lifecycle = {
        imports,
        initialize: async (levelTime, seed, restart) => {
          game.registerCvars();
          game.initialize(levelTime, seed, restart);
        },
        shutdown: async restart => {
          game.shutdown(restart);
        },
        clientConnect: async (client, firstTime, isBot) => {
          const address = game.clientConnect(client, firstTime, isBot);
          return address === null ? null : readString(memory, address);
        },
        clientBegin: async client => {
          game.clientBegin(client);
        },
        clientUserinfoChanged: async client => {
          game.clientUserinfoChanged(client);
        },
        clientDisconnect: async client => {
          game.clientDisconnect(client);
        },
        clientCommand: (client, values) =>
          withArguments(values, async () => {
            game.clientCommand(client);
          }),
        clientCommandNow: (client, values) => {
          const previous = argumentsOf.current;
          argumentsOf.current = values;
          try {
            game.clientCommand(client);
          } finally {
            argumentsOf.current = previous;
          }
        },
        clientThink: async client => {
          game.clientThink(client);
        },
        runFrame: async time => {
          game.runFrame(time);
        },
        consoleCommand: values => withArguments(values, async () => game.consoleCommand()),
        // The API 10 table has no bot frame export.
        botFrame: async () => {},
      };
      return new Q3NativeGuestSource(prepared, memory, runner, lifecycle, data, files, state, options.hostState, image.abi, finalize, heap);
    } catch (error) {
      try {
        releaseMemory(memory);
        closeFiles(files);
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Native Q3 guest construction and cleanup failed");
      }
      throw error;
    }
  }

  get profile(): Q3NativeProfile {
    return this.prepared.profile;
  }
  get module(): ModuleIdentity {
    return this.prepared.module;
  }
  get active(): boolean {
    return this.runner.depth !== 0;
  }
  /** Engine services the loaded Quake Live module has called, by import slot. */
  get coverage(): readonly { readonly name: string; readonly reached: number }[] {
    return this.lifecycle.imports?.coverage.filter(call => call.reached > 0) ?? [];
  }

  private async live<T>(run: () => Promise<T>): Promise<T> {
    if (this.phase === "closed") throw new Error("Native Q3 guest is closed");
    if (this.phase !== "running") throw new Error("Native Q3 guest has not run GAME_INIT");
    return await run();
  }
  async initializeAsync(levelTime: number, randomSeed: number, restart = false): Promise<void> {
    if (this.phase === "closed") throw new Error("Native Q3 guest is closed");
    if (this.phase !== "created" && !restart) throw new Error("Native Q3 GAME_INIT requires a fresh game or a restart");
    if (this.runner.depth !== 0) throw new Error("Native Q3 guest has an active call");
    await this.lifecycle.initialize(levelTime, randomSeed, restart);
    this.phase = "running";
  }
  shutdownAsync(restart: boolean): Promise<void> {
    return this.live(() => this.lifecycle.shutdown(restart));
  }
  clientConnectAsync(client: number, firstTime: boolean, isBot: boolean): Promise<string | null> {
    return this.live(() => this.lifecycle.clientConnect(client, firstTime, isBot));
  }
  clientBeginAsync(client: number): Promise<void> {
    return this.live(() => this.lifecycle.clientBegin(client));
  }
  clientUserinfoChangedAsync(client: number): Promise<void> {
    return this.live(() => this.lifecycle.clientUserinfoChanged(client));
  }
  clientDisconnectAsync(client: number): Promise<void> {
    return this.live(() => this.lifecycle.clientDisconnect(client));
  }
  clientCommandAsync(client: number, argv: readonly string[]): Promise<void> {
    return this.live(() => this.lifecycle.clientCommand(client, argv));
  }
  clientCommand(client: number, argv: readonly string[]): void {
    if (this.phase !== "running") throw new Error(this.phase === "closed" ? "Native Q3 guest is closed" : "Native Q3 guest has not run GAME_INIT");
    this.lifecycle.clientCommandNow(client, argv);
  }
  clientThinkAsync(client: number): Promise<void> {
    return this.live(() => this.lifecycle.clientThink(client));
  }
  runFrameAsync(time: number): Promise<void> {
    return this.live(() => this.lifecycle.runFrame(time));
  }
  consoleCommandAsync(argv: readonly string[]): Promise<boolean> {
    return this.live(() => this.lifecycle.consoleCommand(argv));
  }
  botFrameAsync(time: number): Promise<void> {
    return this.live(() => this.lifecycle.botFrame(time));
  }

  /**
   * The process image between calls: the writable mappings the module or its runtime owns, every mapping startup did not create (heap blocks
   * and reservations game code made), the allocator and heap tables behind them, the processor registers, and the server game's record.
   * The runtime's own other bookkeeping is rebuilt deterministically on restore.
   */
  checkpoint(): NativeGuestCheckpoint {
    if (this.phase !== "running") throw new Error("Native Q3 checkpoint requires an initialized game");
    if (this.runner.depth !== 0) throw new Error("Native Q3 checkpoint requires a completed game call");
    if (this.hostState === undefined) throw new Error("Native Q3 host has not bound checkpoint services");
    const host = this.hostState.checkpoint(),
      layout = describedMappings(this.memory);
    const regions = layout
      .filter(mapping => writable(mapping.permissions) || !this.baseline.has(mappingKey(mapping)))
      .map(mapping => {
        const address = this.memory.pointer(mapping.base);
        if (address === null) throw new Error("Native Q3 mapping has no address");
        return {
          base: mapping.base,
          permissions: mapping.permissions,
          bytes: this.readable(address, mapping, () => this.memory.copy(address, mapping.byteLength)),
        };
      });
    const tables = this.heap.capture();
    return {
      kind: "native-guest",
      version: 2,
      module: this.prepared.module,
      random: host.random,
      callbacks: host.callbacks,
      abi: this.abi,
      regions,
      heap: { layout, allocator: this.memory.allocatorImage(), blocks: tables.blocks, windows: tables.windows },
      processorLayout: { ...PROCESSOR_LAYOUT, pointerBytes: this.memory.pointerBytes },
      processorState: this.state.registers.checkpoint(),
      runtimeState: { ...host.state, bytes: host.state.bytes.slice() },
    };
  }

  /** Runs `access` with the mapping temporarily readable and writable, then returns it to its own permissions. */
  private readable<T>(address: GuestAddress, mapping: GuestMappingRecord, access: () => T): T {
    if (writable(mapping.permissions)) return access();
    this.memory.protect(address, mapping.byteLength, "read-write");
    try {
      return access();
    } finally {
      this.memory.protect(address, mapping.byteLength, mapping.permissions);
    }
  }

  /** Overlays a saved process image on this freshly started, identical process, then restores the server game's record from it. */
  restore(checkpoint: Q3GuestCheckpoint): void {
    if (checkpoint.kind !== "native-guest") throw new Error("Native Q3 restore requires a native-guest checkpoint");
    if (this.phase !== "created") throw new Error("Native Q3 restore requires a freshly started module");
    if (this.hostState === undefined) throw new Error("Native Q3 host has not bound checkpoint services");
    const saved = checkpoint.module,
      module = this.prepared.module;
    if (
      saved.id !== module.id ||
      saved.digest !== module.digest ||
      saved.revision !== module.revision ||
      saved.artifactPath !== module.artifactPath ||
      checkpoint.abi.kind !== this.abi.kind ||
      checkpoint.runtimeState.module.digest !== module.digest
    )
      throw new Error("Native Q3 checkpoint belongs to a different module");
    const layoutError = (): never => {
      throw new Error("Native Q3 checkpoint memory layout differs from the started module");
    };
    const current = describedMappings(this.memory);
    // A checkpoint without a heap image (version 1) records a process whose layout is the one startup produces.
    const image: NativeGuestHeapImage | null = checkpoint.heap;
    const wanted = image === null ? current : image.layout;
    if (image === null && current.filter(mapping => writable(mapping.permissions)).length !== checkpoint.regions.length) layoutError();
    const regions = new Map(checkpoint.regions.map(region => [region.base, region]));
    if (regions.size !== checkpoint.regions.length) layoutError();
    const shape = (mapping: GuestMappingRecord): string => `${mapping.base}:${mapping.byteLength}:${mapping.label}`;
    const wantedShapes = new Map(wanted.map(mapping => [shape(mapping), mapping]));
    const haveShapes = new Map(current.map(mapping => [shape(mapping), mapping]));
    const at = (base: bigint): GuestAddress => {
      const address = this.memory.pointer(base);
      if (address === null) throw new Error("Native Q3 mapping has no address");
      return address;
    };
    for (const mapping of current) {
      if (!wantedShapes.has(shape(mapping))) this.memory.unmap(at(mapping.base), mapping.byteLength);
    }
    for (const mapping of wanted) {
      const have = haveShapes.get(shape(mapping));
      if (have === undefined) this.memory.map({ base: mapping.base, byteLength: mapping.byteLength, permissions: "read-write", label: mapping.label });
      else if (have.permissions !== mapping.permissions) this.memory.protect(at(mapping.base), mapping.byteLength, mapping.permissions);
    }
    const wantedByBase = new Map(wanted.map(mapping => [mapping.base, mapping]));
    for (const region of checkpoint.regions) {
      const target = wantedByBase.get(region.base);
      if (target === undefined || target.permissions !== region.permissions || target.byteLength !== region.bytes.byteLength) layoutError();
    }
    for (const mapping of wanted) {
      const region = regions.get(mapping.base),
        created = !haveShapes.has(shape(mapping));
      if (region === undefined) {
        if (created || (writable(mapping.permissions) && image === null)) layoutError();
        continue;
      }
      const address = at(mapping.base);
      if (created) {
        this.memory.write(address, region.bytes);
        if (mapping.permissions !== "read-write") this.memory.protect(address, mapping.byteLength, mapping.permissions);
      } else this.readable(address, mapping, () => this.memory.write(address, region.bytes));
    }
    if (image !== null) {
      this.memory.restoreAllocator(image.allocator);
      this.heap.restore(image.blocks, image.windows);
    }
    this.state.registers.restore(checkpoint.processorState);
    this.phase = "running";
    this.hostState.restore({ state: checkpoint.runtimeState, random: checkpoint.random, callbacks: checkpoint.callbacks });
  }

  /** Runs the image's finalizers and releases the guest process. Callers run GAME_SHUTDOWN first. */
  retire(): void {
    if (this.phase === "closed") return;
    if (this.runner.depth !== 0) throw new Error("Native Q3 guest retirement requires a completed game call");
    const errors: unknown[] = [];
    this.runner.recover();
    this.phase = "closed";
    try {
      this.detach();
    } catch (error) {
      errors.push(error);
    }
    try {
      closeFiles(this.files);
    } catch (error) {
      errors.push(error);
    }
    try {
      releaseMemory(this.memory);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length !== 0) throw new AggregateError(errors, "Native Q3 guest retirement failed");
  }

  /** Shuts the running game down, then retires the process. */
  async close(): Promise<void> {
    if (this.phase === "closed") return;
    const initialized = this.phase === "running",
      errors: unknown[] = [];
    if (initialized) {
      try {
        this.runner.recover();
        await this.lifecycle.shutdown(false);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.retire();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length !== 0) throw new AggregateError(errors, "Native Q3 guest shutdown failed");
  }
}

/** Every mapping except the call stack, which holds nothing between calls. */
function describedMappings(memory: SparseGuestMemory): GuestMappingRecord[] {
  return memory
    .mappings()
    .filter(mapping => mapping.label !== STACK_LABEL)
    .map(({ base, byteLength, permissions, label }) => ({ base, byteLength, permissions, label }));
}
const mappingKey = (mapping: GuestMappingRecord): string => `${mapping.base}:${mapping.byteLength}:${mapping.permissions}:${mapping.label}`;
/** The Quake Live table interface never locates game data through G_LOCATE_GAME_DATA; any access to this memory is a defect. */
function unlocatedMemory(): Q3GameMemory {
  const refuse = (): never => {
    throw new Error("The Quake Live table interface locates no Q3 game data");
  };
  return {
    pointer: refuse,
    span: refuse,
    view: refuse,
    readString: refuse,
    writeString: refuse,
    address: refuse,
    pointerWord: refuse,
    viewAt: refuse,
    regionView: refuse,
    regionWrite: refuse,
    regionFill: refuse,
  };
}
function releaseMemory(memory: SparseGuestMemory): void {
  for (const mapping of memory.mappings()) {
    const address = memory.pointer(mapping.base);
    if (address !== null) memory.unmap(address, mapping.byteLength);
  }
}
function closeFiles(files: Set<WindowsFile>): void {
  const errors: unknown[] = [];
  for (const file of [...files]) {
    try {
      file.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length !== 0) throw new AggregateError(errors, "Native Q3 guest file cleanup failed");
}
