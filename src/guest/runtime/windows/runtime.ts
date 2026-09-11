// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage, NativeCallAbi } from "../../../contracts/execution.ts";
import { GuestCallRunner } from "../../abi/index.ts";
import type { GuestCallSignature, GuestImage, GuestImport, GuestImportResolution, GuestImportResolver, GuestHostCallback, MappedGuestMemory } from "../../core/index.ts";
import { bindPeImports, resolvePeExport } from "../../pe/index.ts";
import type { PeImage } from "../../pe/index.ts";
import { readUnsigned, writePointer, writeUnsigned } from "../common/memory.ts";
import { UnsupportedWindowsImport } from "./contracts.ts";
import type { WindowsCapabilities, WindowsImportCoverage, WindowsImportImplementation, WindowsInitializeOptions, WindowsRuntimeOptions, WindowsServiceHost } from "./contracts.ts";
import { installKernel } from "./kernel.ts";
import { installCrt } from "./crt.ts";
import { installMsvcStreams } from "./msvc/streams.ts";

function canonical(library: string): string { const base = library.replaceAll("\\", "/").split("/").at(-1) ?? library; return base.toLowerCase().endsWith(".dll") ? base.toLowerCase() : `${base.toLowerCase()}.dll`; }
interface ImportEntry { readonly library: string; readonly name: string; readonly callback: GuestHostCallback; readonly address: GuestAddress; readonly supported: boolean; reached: number; failed: number; lastFailure: string | null; }
interface HeapAllocation { readonly address: GuestAddress; readonly size: number; readonly heap: bigint; }

/** One emulated Windows thread, sharing the caller's CPU, memory and callback table. */
export class WindowsGuestRuntime implements GuestImportResolver, WindowsServiceHost {
  readonly memory: MappedGuestMemory;
  readonly capabilities: WindowsCapabilities;
  readonly pointerStorage: "uint32" | "uint64";
  readonly processId: number;
  readonly threadId: number;
  readonly teb: GuestAddress;
  readonly peb: GuestAddress;
  readonly staticTls: GuestAddress;
  readonly #imports = new Map<string, ImportEntry>();
  readonly #data = new Map<string, GuestAddress>();
  readonly #requested = new Set<string>();
  readonly #libraries = new Map<string, GuestAddress>();
  readonly #images: PeImage[] = [];
  readonly #prepared = new Set<PeImage>();
  readonly #initialized = new Set<PeImage>();
  readonly #allocations = new Map<bigint, HeapAllocation>();
  readonly #tlsBlocks = new Map<PeImage, GuestAddress>();
  readonly #cfgTargets = new Set<bigint>();
  #cfgCheck: GuestAddress | null = null;
  #cfgDispatch: GuestAddress | null = null;
  #runner: GuestCallRunner | null = null;
  #budget = 1000000;

  constructor(readonly options: WindowsRuntimeOptions) {
    this.memory = options.memory;
    if (options.callbacks.memory !== this.memory) throw new TypeError("Windows callbacks require the same guest memory");
    this.capabilities = options.capabilities ?? {};
    this.pointerStorage = this.memory.pointerBytes === 4 ? "uint32" : "uint64";
    this.processId = options.processId ?? 1; this.threadId = options.threadId ?? 1;
    this.teb = this.memory.allocate({ byteLength: 0x2000, alignment: 4096n, label: "Windows TEB" });
    this.peb = this.memory.allocate({ byteLength: 0x1000, alignment: 4096n, label: "Windows PEB" });
    this.staticTls = this.memory.allocate({ byteLength: this.memory.pointerBytes * 1024, alignment: 16n, label: "Windows static TLS vector" });
    const width = this.memory.pointerBytes;
    writePointer(this.memory, this.memory.offset(this.teb, width === 4 ? 0x18n : 0x30n), this.teb);
    writePointer(this.memory, this.memory.offset(this.teb, width === 4 ? 0x30n : 0x60n), this.peb);
    writePointer(this.memory, this.memory.offset(this.teb, width === 4 ? 0x2cn : 0x58n), this.staticTls);
    writeUnsigned(this.memory, this.teb, width, (1n << BigInt(width * 8)) - 1n);
    writeUnsigned(this.memory, this.memory.offset(this.teb, width === 4 ? 0x20n : 0x40n), width, BigInt(this.processId));
    writeUnsigned(this.memory, this.memory.offset(this.teb, width === 4 ? 0x24n : 0x48n), width, BigInt(this.threadId));
    installKernel(this); installCrt(this); installMsvcStreams(this);
    // Microsoft STL xlocale: locale::id contains size_t _Id; its shared counter is int.
    this.registerData("msvcp140.dll", "?_Id_cnt@id@locale@std@@0HA", new Uint8Array(4));
    this.registerData("msvcp140.dll", "?id@?$numpunct@D@std@@2V0locale@2@A", new Uint8Array(width));
  }
  get runner(): GuestCallRunner { if (this.#runner === null) throw new Error("Attach the shared GuestCallRunner before Windows execution"); return this.#runner; }
  get images(): readonly PeImage[] { return this.#images; }
  get lastError(): number { return Number(readUnsigned(this.memory, this.memory.offset(this.teb, this.memory.pointerBytes === 4 ? 0x34n : 0x68n), 4)); }
  set lastError(value: number) { writeUnsigned(this.memory, this.memory.offset(this.teb, this.memory.pointerBytes === 4 ? 0x34n : 0x68n), 4, BigInt(value)); }
  get coverage(): readonly WindowsImportCoverage[] { return [...this.#imports.values()].filter(entry => this.#requested.has(`${entry.library}!${entry.name}`) || entry.reached > 0)
    .map(({ library, name, supported, reached, failed, lastFailure }) => ({ library, name, supported, reached, failed, lastFailure })); }
  attachRunner(runner: GuestCallRunner): void {
    if (runner.options.cpu.memory !== this.memory || runner.options.callbacks !== this.options.callbacks) throw new TypeError("Windows runner belongs to different guest state");
    this.#runner = runner;
    const state = runner.options.cpu.state;
    const stack = state.registers.read("rsp", this.memory.pointerBytes === 4 ? 32 : 64);
    const mapping = this.memory.mappings().find(entry => stack > entry.base && stack <= entry.base + BigInt(entry.byteLength));
    if (mapping === undefined) throw new Error("Windows thread stack must already be mapped");
    writeUnsigned(this.memory, this.memory.offset(this.teb, BigInt(this.memory.pointerBytes)), this.memory.pointerBytes, mapping.base + BigInt(mapping.byteLength));
    writeUnsigned(this.memory, this.memory.offset(this.teb, BigInt(this.memory.pointerBytes * 2)), this.memory.pointerBytes, mapping.base);
    if (this.memory.pointerBytes === 4) state.segments.fs.base = this.teb.byteOffset; else state.segments.gs.base = this.teb.byteOffset;
  }
  signature(library: string, parameters: readonly GuestStorage[], result: GuestStorage | "void"): GuestCallSignature {
    const abi: NativeCallAbi = this.memory.pointerBytes === 8 ? { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" }
      : { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: canonical(library) === "kernel32.dll" ? "stdcall" : "cdecl" };
    return { abi, parameters: parameters.map(storage => ({ kind: "scalar", storage })), result: result === "void" ? "void" : { kind: "scalar", storage: result }, variadic: false };
  }
  service(library: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: WindowsImportImplementation): void {
    this.register(library, name, this.signature(library, parameters, result), invoke);
  }
  register(library: string, name: string, signature: GuestCallSignature, invoke: WindowsImportImplementation): void { this.#register(library, name, signature, invoke, true); }
  registerData(library: string, name: string, bytes: Uint8Array): GuestAddress {
    const key = `${canonical(library)}!${name}`; if (this.#data.has(key) || this.#imports.has(key)) throw new Error(`Duplicate Windows data export ${key}`);
    const address = this.memory.allocate({ byteLength: bytes.length, alignment: 16n, label: key }); this.memory.write(address, bytes); this.#data.set(key, address); return address;
  }
  #register(library: string, name: string, signature: GuestCallSignature, invoke: WindowsImportImplementation, supported: boolean): ImportEntry {
    const normalized = canonical(library), key = `${normalized}!${name}`;
    if (this.#imports.has(key)) throw new Error(`Windows import already registered: ${key}`);
    let reached = 0;
    const callback: GuestHostCallback = { id: `windows:${key}`, signature, invoke: (context, args) => {
      reached++; const entry = this.#imports.get(key); if (entry !== undefined) entry.reached = reached;
      try { return invoke(context, args); } catch (error) { if (entry !== undefined) { entry.failed++; entry.lastFailure = error instanceof Error ? error.message : String(error); } throw error; }
    } };
    const address = this.options.callbacks.bind(callback);
    const entry: ImportEntry = { library: normalized, name, callback, address, supported, reached, failed: 0, lastFailure: null };
    this.#imports.set(key, entry);
    if (!this.#libraries.has(normalized)) this.#libraries.set(normalized, this.memory.allocate({ byteLength: 16, label: `Windows library handle ${normalized}` }));
    return entry;
  }
  resolve(import_: GuestImport, requesting: GuestImage): GuestImportResolution {
    const name = import_.symbol.kind === "name" ? import_.symbol.name : `#${import_.symbol.ordinal}`;
    const library = canonical(import_.library);
    this.#requested.add(`${library}!${name}`);
    const data = this.#data.get(`${library}!${name}`); if (data !== undefined) return { kind: "guest", address: data, module: this.memory.module };
    const guest = this.#images.find(image => canonical(image.module.artifactPath) === library);
    if (guest !== undefined && guest !== requesting) {
      const target = resolvePeExport(guest, import_.symbol, forwarded => this.#images.find(image => canonical(image.module.artifactPath) === canonical(forwarded)) ?? null);
      return { kind: "guest", address: target.address, module: target.image.module };
    }
    let entry = this.#imports.get(`${library}!${name}`);
    if (entry === undefined) entry = this.#register(library, name, this.signature(library, [], "void"), context => { throw new UnsupportedWindowsImport(library, name, context); }, false);
    return { kind: "host", address: entry.address, callback: entry.callback };
  }
  resolveAddress(library: string, name: string): GuestAddress | null { const key = `${canonical(library)}!${name}`; return this.#imports.get(key)?.address ?? this.#data.get(key) ?? null; }
  libraryHandle(library: string): GuestAddress | null { return this.#libraries.get(canonical(library)) ?? this.#images.find(image => canonical(image.module.artifactPath) === canonical(library))?.base ?? null; }
  libraryName(handle: GuestAddress): string | null { return [...this.#libraries].find(([, address]) => address.byteOffset === handle.byteOffset)?.[0] ?? this.#images.find(image => image.base.byteOffset === handle.byteOffset)?.module.artifactPath ?? null; }
  allocate(size: number, heap = 0n): GuestAddress | null {
    if (!Number.isSafeInteger(size) || size < 0 || size > 0x10000000) { this.lastError = 8; return null; }
    const address = this.memory.allocate({ byteLength: Math.max(size, 1), alignment: 16n, label: "Windows guest heap" });
    this.#allocations.set(address.byteOffset, { address, size: Math.max(size, 1), heap });
    return address;
  }
  free(address: GuestAddress | null, heap = 0n): boolean {
    if (address === null) return true;
    const allocation = this.#allocations.get(address.byteOffset);
    if (allocation === undefined || allocation.heap !== heap) { this.lastError = 87; return false; }
    this.memory.unmap(allocation.address, allocation.size); this.#allocations.delete(address.byteOffset); return true;
  }
  allocationSize(address: GuestAddress, heap = 0n): number | null { const entry = this.#allocations.get(address.byteOffset); return entry?.heap === heap ? entry.size : null; }
  destroyHeap(heap: bigint): void { for (const entry of this.#allocations.values()) if (entry.heap === heap) this.free(entry.address, heap); }
  prepareImage(image: PeImage): void {
    if (this.#prepared.has(image)) return;
    if (image.base.addressSpace !== this.memory.addressSpace) throw new Error("Windows image belongs to another memory");
    if (!this.#images.includes(image)) this.#images.push(image);
    bindPeImports(image, this.memory, this);
    if (image.tls !== null) {
      if (image.tlsIndexAddress === null || this.#tlsBlocks.size >= 1024) throw new Error("Invalid Windows static TLS index");
      const index = this.#tlsBlocks.size;
      const block = this.memory.allocate({ byteLength: Math.max(1, image.tls.initialized.length + image.tls.zeroFillBytes), alignment: image.tls.alignment < 16n ? 16n : image.tls.alignment, label: `${image.module.id}: TLS` });
      this.memory.write(block, image.tls.initialized);
      writeUnsigned(this.memory, image.tlsIndexAddress, 4, BigInt(index));
      writePointer(this.memory, this.memory.offset(this.staticTls, BigInt(index * this.memory.pointerBytes)), block);
      this.#tlsBlocks.set(image, block);
    }
    // The CRT entry initializes its own cookie/complement. The guest loader owns CFG dispatch.
    this.#prepareCfg(image);
    this.#prepared.add(image);
  }
  #prepareCfg(image: PeImage): void {
    const config = image.loadConfiguration;
    if (config === null || (config.guardFlags & 0x100) === 0) return;
    const width = this.memory.pointerBytes, tableOffset = width === 4 ? 80 : 128;
    if (config.bytes.length < tableOffset + width * 2) throw new Error("Truncated CFG load configuration");
    const table = readUnsigned(this.memory, this.memory.offset(config.address, BigInt(tableOffset)), width);
    const count = readUnsigned(this.memory, this.memory.offset(config.address, BigInt(tableOffset + width)), width);
    const extra = config.guardFlags >>> 28, stride = extra + 4;
    if (count > image.byteLength / BigInt(stride)) throw new Error("Invalid CFG target count");
    const base = this.memory.pointer(table); if (count !== 0n && base === null) throw new Error("Null CFG target table");
    if (base !== null) {
      const entries = this.memory.copy(base, Number(count) * stride), view = new DataView(entries.buffer);
      let previous = -1;
      for (let index = 0; index < Number(count); index++) {
        const rva = view.getUint32(index * stride, true), flags = extra === 0 ? 0 : view.getUint8(index * stride + 4);
        if (rva <= previous || BigInt(rva) >= image.byteLength || (flags & ~3) !== 0 || entries.subarray(index * stride + 5, (index + 1) * stride).some(byte => byte !== 0)) throw new Error("Invalid/unsupported CFG function metadata");
        previous = rva;
        if ((flags & 1) !== 0 || (flags & 2) !== 0 && (config.guardFlags & 0x8000) !== 0) continue;
        const address = this.memory.offset(image.base, BigInt(rva)); this.memory.check(address, 1, "execute"); this.#cfgTargets.add(address.byteOffset);
      }
    }
    if (this.#cfgCheck === null) {
      this.service("quake-runtime.dll", "guard-check", [], "void", context => {
        const target = this.runner.options.cpu.state.registers.read(width === 4 ? "rcx" : "rax", width === 4 ? 32 : 64);
        this.#validateCfg(target, context); return { kind: "void" };
      });
      this.#cfgCheck = this.resolveAddress("quake-runtime.dll", "guard-check");
      if (width === 8) {
        this.service("quake-runtime.dll", "guard-dispatch-check", ["pointer"], "void", (context, args) => {
          const arg = args[0]; if (arg?.kind !== "pointer") throw new TypeError("CFG dispatch target missing");
          this.#validateCfg(arg.value?.byteOffset ?? 0n, context); return { kind: "void" };
        });
        const check = this.resolveAddress("quake-runtime.dll", "guard-dispatch-check"); if (check === null) throw new Error("CFG checker binding missing");
        const immediate = Array.from({ length: 8 }, (_, index) => Number(check.byteOffset >> BigInt(index * 8) & 255n));
        // Preserve the target and Windows register arguments around the checked host trap, then tail-jump.
        const code = new Uint8Array([0x50, 0x51, 0x52, 0x41, 0x50, 0x41, 0x51, 0x48, 0x83, 0xec, 0x20,
          0x48, 0x89, 0xc1, 0x48, 0xb8, ...immediate, 0xff, 0xd0, 0x48, 0x83, 0xc4, 0x20, 0x41, 0x59, 0x41, 0x58, 0x5a, 0x59, 0x58, 0xff, 0xe0]);
        const address = this.memory.allocate({ byteLength: code.length, alignment: 16n, label: "Guest CFG dispatch instructions" }); this.memory.write(address, code); this.memory.protect(address, code.length, "read-execute"); this.#cfgDispatch = address;
      } else {
        this.service("quake-runtime.dll", "guard-dispatch-check", [], "void", context => { throw new UnsupportedWindowsImport("quake-runtime.dll", "guard-dispatch-check", context, "i386 CFG dispatch convention is not implemented"); });
        this.#cfgDispatch = this.resolveAddress("quake-runtime.dll", "guard-dispatch-check");
      }
    }
    const patch = (slot: GuestAddress | null, value: GuestAddress | null): void => {
      if (slot === null || value === null) return;
      const region = this.memory.mappings().find(mapping => slot.byteOffset >= mapping.base && slot.byteOffset + BigInt(width) <= mapping.base + BigInt(mapping.byteLength));
      if (region === undefined) throw new Error("Unmapped CFG pointer slot");
      this.memory.protect(slot, width, "read-write"); try { writePointer(this.memory, slot, value); } finally { this.memory.protect(slot, width, region.permissions); }
    };
    patch(config.guardCheckSlot, this.#cfgCheck); patch(config.guardDispatchSlot, this.#cfgDispatch);
  }
  #validateCfg(target: bigint, context: GuestCallContext): void {
    const valid = this.#cfgTargets.has(target) || this.options.callbacks.checkpoint().some(callback => callback.byteOffset === target && callback.binding === "bound");
    const address = this.memory.pointer(target);
    if (!valid || address === null) throw new UnsupportedWindowsImport("quake-runtime.dll", "control-flow-guard", context, `invalid indirect target 0x${target.toString(16)}`);
    this.memory.check(address, 1, "execute");
  }
  invoke(context: GuestCallContext, target: GuestAddress, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[]): GuestCallResult {
    return this.runner.invoke({ target, signature: this.signature("ucrtbase.dll", parameters, result), arguments: args,
      context: { ...context, callback: { kind: "native-guest", module: context.module, address: target, abi: this.signature("ucrtbase.dll", [], "void").abi } }, instructionBudget: this.#budget });
  }
  initialize(image: PeImage, options: WindowsInitializeOptions): void {
    if (this.#initialized.has(image)) return;
    this.prepareImage(image); this.#budget = options.instructionBudget;
    for (const callback of image.tls?.callbacks ?? []) this.#notification(image, callback, 1, options, "void");
    if (image.entryPoint !== null) {
      const result = this.#notification(image, image.entryPoint, 1, options, "int32");
      if (result.kind !== "int32" || result.value === 0) throw new Error(`Windows DLL_PROCESS_ATTACH failed: ${image.module.id}`);
    }
    this.#initialized.add(image);
  }
  detach(image: PeImage, options: WindowsInitializeOptions): void {
    if (!this.#initialized.has(image)) return;
    this.#budget = options.instructionBudget;
    if (image.entryPoint !== null) this.#notification(image, image.entryPoint, 0, options, "int32");
    for (const callback of image.tls?.callbacks ?? []) this.#notification(image, callback, 0, options, "void");
    this.#initialized.delete(image);
  }
  #notification(image: PeImage, target: GuestAddress, reason: number, options: WindowsInitializeOptions, result: "void" | "int32"): GuestCallResult {
    const signature = this.signature("kernel32.dll", ["pointer", "uint32", "pointer"], result);
    return this.runner.invoke({ target, signature, arguments: [{ kind: "pointer", value: image.base }, { kind: "uint32", value: reason }, { kind: "pointer", value: null }],
      context: { ...options.context, callback: { kind: "native-guest", module: options.context.module, address: target, abi: signature.abi } }, instructionBudget: options.instructionBudget });
  }
}
