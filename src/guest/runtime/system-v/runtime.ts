// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestStorage, ModuleIdentity, NativeCallAbi } from "../../../contracts/execution.ts";
import type { GuestCallRunner } from "../../abi/index.ts";
import type { GuestCallSignature, GuestHostCallback, GuestImage, GuestImport, GuestImportResolution, GuestImportResolver, MappedGuestMemory } from "../../core/index.ts";
import { inspectElf, loadElf } from "../../elf/index.ts";
import type { ElfGuestImage, ElfTlsBindings, ElfTlsResolution } from "../../elf/index.ts";
import { readUnsigned, stringBytes, writeUnsigned } from "../common/memory.ts";
import { UnsupportedSystemVService } from "./contracts.ts";
import type { SystemVCapabilities, SystemVImplementation, SystemVImportCoverage, SystemVInitializeOptions, SystemVRuntimeOptions, SystemVServiceHost } from "./contracts.ts";
import { installLibc } from "./libc.ts";
import { installCxx } from "./cxx.ts";
import { SystemVIostreams } from "./iostream.ts";

interface SymbolEntry { readonly coverage: SystemVImportCoverage; readonly resolution: Exclude<GuestImportResolution, { readonly kind: "unresolved" }>; readonly byteLength: number | null; }
interface TlsBlock { readonly module: ModuleIdentity; readonly moduleId: bigint; readonly address: GuestAddress; readonly byteLength: number; }
interface Lifecycle { readonly image: ElfGuestImage; state: "loaded" | "initializing" | "initialized" | "finalizing" | "finalized" | "failed"; }
interface Destructor { readonly target: GuestAddress; readonly argument: GuestAddress | null; readonly dso: GuestAddress | null; called: boolean; }
const libraries = ["libc.so.6", "libm.so.6", "libstdc++.so.6", "libgcc_s.so.1", "ld-linux.so.2", "ld-linux-x86-64.so.2"];
function key(library: string, name: string, version: string | null): string { return `${library}:${name}@${version ?? ""}`; }

/** One Linux guest process and thread, using the existing memory, callback namespace and CPU. */
export class SystemVGuestRuntime implements GuestImportResolver, SystemVServiceHost {
  readonly memory: MappedGuestMemory;
  readonly capabilities: SystemVCapabilities;
  readonly pointerStorage: "uint32" | "uint64";
  readonly signedPointerStorage: "int32" | "int64";
  readonly uniqueSymbols = new Map<string, GuestAddress>();
  readonly threadPointer: GuestAddress;
  readonly emptyStringRepresentation: GuestAddress;
  readonly iostreams: SystemVIostreams;
  readonly #errno: GuestAddress;
  readonly #dtv: GuestAddress;
  readonly #argv: GuestAddress;
  readonly #envp: GuestAddress;
  readonly #symbols = new Map<string, SymbolEntry>();
  readonly #images: Lifecycle[] = [];
  readonly #heap = new Map<bigint, { readonly address: GuestAddress; readonly size: number }>();
  readonly #tls: TlsBlock[] = [];
  readonly #destructors: Destructor[] = [];
  readonly #lifecycleTrace: { readonly image: ModuleIdentity; readonly phase: "initialize" | "finalize"; readonly target: GuestAddress }[] = [];
  #runner: GuestCallRunner | null = null;
  #loading = false;
  #budget = 100000;
  #tlsUsed = 0n;
  constructor(readonly options: SystemVRuntimeOptions) {
    this.memory = options.memory;
    if (options.callbacks.memory !== this.memory) throw new TypeError("System V callback table belongs to another memory");
    this.capabilities = options.capabilities ?? {};
    this.pointerStorage = this.memory.pointerBytes === 4 ? "uint32" : "uint64";
    this.signedPointerStorage = this.memory.pointerBytes === 4 ? "int32" : "int64";
    const tlsArea = this.memory.allocate({ byteLength: 0x11000, alignment: 4096n, label: "System V static TLS and TCB" });
    this.threadPointer = this.memory.offset(tlsArea, 0x10000n);
    this.memory.writePointer(this.threadPointer, this.threadPointer);
    this.memory.writePointer(this.memory.offset(this.threadPointer, BigInt(2 * this.memory.pointerBytes)), this.threadPointer);
    const dtvAllocation = this.memory.allocate({ byteLength: 1026 * 2 * this.memory.pointerBytes, alignment: 16n, label: "System V thread dynamic vector" });
    this.#dtv = this.memory.offset(dtvAllocation, BigInt(2 * this.memory.pointerBytes));
    writeUnsigned(this.memory, dtvAllocation, this.memory.pointerBytes, 1024n);
    writeUnsigned(this.memory, this.#dtv, this.memory.pointerBytes, 1n);
    this.memory.writePointer(this.memory.offset(this.threadPointer, BigInt(this.memory.pointerBytes)), this.#dtv);
    this.#errno = this.memory.allocate({ byteLength: 4, alignment: 4n, label: "System V thread errno" });
    this.#argv = this.#strings(options.argv ?? []); this.#envp = this.#strings(options.environment ?? []);
    this.emptyStringRepresentation = this.memory.allocate({ byteLength: this.memory.pointerBytes * 4, alignment: 16n, label: "GLIBCXX_3.4 shared empty string representation" });
    this.data("libstdc++.so.6", "_ZNSs4_Rep20_S_empty_rep_storageE", "GLIBCXX_3.4", this.emptyStringRepresentation, this.memory.pointerBytes * 4);
    installLibc(this); installCxx(this); this.iostreams = new SystemVIostreams(this);
  }
  get runner(): GuestCallRunner { if (this.#runner === null) throw new Error("Attach the shared GuestCallRunner before System V execution"); return this.#runner; }
  get images(): readonly ElfGuestImage[] { return this.#images.map(entry => entry.image); }
  get coverage(): readonly SystemVImportCoverage[] { return [...this.#symbols.values()].map(entry => ({ ...entry.coverage })); }
  get lifecycleTrace(): readonly { readonly image: ModuleIdentity; readonly phase: "initialize" | "finalize"; readonly target: GuestAddress }[] { return this.#lifecycleTrace; }
  get errno(): number { return this.memory.readInt32(this.#errno); }
  set errno(value: number) { this.memory.writeInt32(this.#errno, value); }
  get errnoAddress(): GuestAddress { return this.#errno; }
  get dependencies(): ReadonlySet<string> { return new Set([...libraries, ...this.images.flatMap(image => image.soname === null ? [] : [image.soname])]); }
  attachRunner(runner: GuestCallRunner): void {
    if (runner.options.cpu.memory !== this.memory || runner.options.callbacks !== this.options.callbacks) throw new TypeError("System V runner belongs to another process");
    this.#runner = runner;
    if (this.memory.pointerBytes === 8) runner.options.cpu.state.segments.fs.base = this.threadPointer.byteOffset;
    else runner.options.cpu.state.segments.gs.base = this.threadPointer.byteOffset;
  }
  signature(parameters: readonly GuestStorage[], result: GuestStorage | "void"): GuestCallSignature {
    const abi: NativeCallAbi = this.memory.pointerBytes === 8 ? { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" }
      : { kind: "linux-i386", image: "elf32", pointerBytes: 4, call: "system-v-i386" };
    return { abi, parameters: parameters.map(storage => ({ kind: "scalar", storage })), result: result === "void" ? "void" : { kind: "scalar", storage: result }, variadic: false };
  }
  service(library: string, name: string, versions: readonly (string | null)[], parameters: readonly GuestStorage[], result: GuestStorage | "void", invoke: SystemVImplementation): void {
    for (const version of versions) this.#function(library, name, version, this.signature(parameters, result), invoke, "implemented");
  }
  unavailable(library: string, name: string, parameters: readonly GuestStorage[], result: GuestStorage | "void", detail: string): GuestAddress {
    return this.#function(library, name, null, this.signature(parameters, result), context => {
      throw new UnsupportedSystemVService(library, name, null, context, detail);
    }, "unsupported-function").resolution.address;
  }
  #function(library: string, name: string, version: string | null, signature: GuestCallSignature, invoke: SystemVImplementation, support: "implemented" | "unsupported-function"): SymbolEntry {
    const id = key(library, name, version);
    if (this.#symbols.has(id)) throw new Error(`Duplicate System V symbol ${id}`);
    let reached = 0;
    const callback: GuestHostCallback = { id: `system-v:${id}`, signature, invoke: (context, args) => {
      reached++;
      this.#symbols.set(id, { ...entry, coverage: { ...entry.coverage, reached } });
      return invoke(context, args);
    } };
    const address = this.options.callbacks.bind(callback);
    const entry: SymbolEntry = { coverage: { library, name, version, support, reached }, resolution: { kind: "host", address, callback }, byteLength: null };
    this.#symbols.set(id, entry); return entry;
  }
  data(library: string, name: string, version: string | null, address: GuestAddress, byteLength: number): void {
    this.memory.check(address, byteLength, "read");
    const id = key(library, name, version);
    if (this.#symbols.has(id)) throw new Error(`Duplicate System V data ${id}`);
    this.#symbols.set(id, { coverage: { library, name, version, support: "implemented", reached: 0 }, resolution: { kind: "guest", address, module: this.memory.module }, byteLength });
  }
  resolve(import_: GuestImport, requesting: GuestImage): GuestImportResolution {
    if (import_.symbol.kind !== "name") return { kind: "unresolved", import: import_, detail: "ELF has no ordinal import namespace" };
    const { name, version } = import_.symbol;
    for (const image of this.images) {
      if (image === requesting || import_.library !== "" && image.soname !== import_.library) continue;
      const exported = image.exports.find(entry => entry.symbol.kind === "name" && entry.symbol.name === name && entry.symbol.version === version);
      if (exported?.target.kind === "address") return { kind: "guest", address: exported.target.address, module: image.module };
    }
    const provider = import_.library === "" ? [...this.#symbols.values()].find(entry => entry.coverage.name === name && entry.coverage.version === version)
      : this.#symbols.get(key(import_.library, name, version));
    if (provider !== undefined) return provider.resolution;
    if (import_.weak || import_.library === "" && requesting.exports.some(entry => entry.symbol.kind === "name" && entry.symbol.name === name)) {
      return { kind: "unresolved", import: import_, detail: "No provider in this process; preserve weak-null or local definition" };
    }
    const dataSymbol = name.startsWith("_ZTV") || name.startsWith("_ZTI");
    if (dataSymbol) {
      const address = this.memory.allocate({ byteLength: 4096, alignment: 4096n, permissions: this.#loading ? "read" : "none", label: `Unsupported System V data ${name}@${version ?? ""}` });
      const entry: SymbolEntry = { coverage: { library: import_.library, name, version, support: "unsupported-data", reached: 0 }, resolution: { kind: "guest", address, module: this.memory.module }, byteLength: null };
      this.#symbols.set(key(import_.library, name, version), entry); return entry.resolution;
    }
    return this.#function(import_.library, name, version, this.signature([], "void"), context => {
      throw new UnsupportedSystemVService(import_.library, name, version, context, "no implementation for this exact symbol version");
    }, "unsupported-function").resolution;
  }
  resolveAddress(library: string, name: string, version: string | null): GuestAddress | null { return this.#symbols.get(key(library, name, version))?.resolution.address ?? null; }
  resolveSymbolSize(import_: GuestImport): number | null {
    if (import_.symbol.kind !== "name") return null;
    return this.#symbols.get(key(import_.library, import_.symbol.name, import_.symbol.version))?.byteLength ?? null;
  }
  allocate(size: number): GuestAddress {
    if (!Number.isSafeInteger(size) || size < 0 || size > 0x10000000) throw new RangeError("System V guest allocation exceeds supported size");
    const actual = Math.max(size, 1), address = this.memory.allocate({ byteLength: actual, alignment: 16n, label: "System V guest heap" });
    this.#heap.set(address.byteOffset, { address, size: actual }); return address;
  }
  free(address: GuestAddress | null): void {
    if (address === null) return;
    this.memory.offset(address, 0n);
    const entry = this.#heap.get(address.byteOffset);
    if (entry === undefined) throw new Error("System V free of a non-live allocation");
    this.memory.unmap(entry.address, entry.size); this.#heap.delete(address.byteOffset);
  }
  allocationSize(address: GuestAddress): number | null { this.memory.offset(address, 0n); return this.#heap.get(address.byteOffset)?.size ?? null; }
  invoke(context: GuestCallContext, target: GuestAddress, parameters: readonly GuestStorage[], result: GuestStorage | "void", args: readonly GuestCallValue[]): GuestCallResult {
    const signature = this.signature(parameters, result);
    return this.runner.invoke({ target, signature, arguments: args, context: { ...context, callback: { kind: "native-guest", module: context.module, address: target, abi: signature.abi } }, instructionBudget: this.#budget });
  }
  load(options: { readonly bytes: Uint8Array; readonly module: ModuleIdentity; readonly loadBias: bigint }): ElfGuestImage {
    if (this.#loading) throw new Error("System V recursive image loading is unsupported");
    const inspection = inspectElf(options.bytes), segment = inspection.segments.find(entry => entry.type === 7);
    const moduleId = BigInt(this.#tls.length + 1);
    if (moduleId > 1024n) throw new RangeError("System V thread TLS module limit exceeded");
    const size = segment?.memorySize ?? 0, alignment = segment === undefined || segment.alignment === 0n ? 1n : segment.alignment;
    if (alignment > 4096n) throw new RangeError("System V static TLS alignment exceeds the thread allocation alignment");
    const next = (this.#tlsUsed + BigInt(size) + alignment - 1n) / alignment * alignment;
    if (next > 0x10000n) throw new RangeError("System V static TLS exceeds thread allocation");
    const block = this.memory.offset(this.threadPointer, -next);
    const tls: ElfTlsBindings = { current: { moduleId, threadPointerOffset: -next }, resolve: import_ => this.#resolveTls(import_) };
    // Relocation validates provider addresses. No guest code runs while unresolved data
    // reservations are readable; execution sees inaccessible pages, never fabricated RTTI.
    for (const entry of this.#symbols.values()) if (entry.coverage.support === "unsupported-data") this.memory.protect(entry.resolution.address, 4096, "read");
    let image: ElfGuestImage;
    this.#loading = true;
    try {
      image = loadElf({ ...options, memory: this.memory, resolver: this, dependencies: this.dependencies, uniqueSymbols: this.uniqueSymbols,
        tls, resolveSymbolSize: import_ => this.resolveSymbolSize(import_) });
    } finally {
      this.#loading = false;
      for (const entry of this.#symbols.values()) if (entry.coverage.support === "unsupported-data") this.memory.protect(entry.resolution.address, 4096, "none");
    }
    if (image.tls !== null) {
      this.memory.write(block, image.tls.initialized);
      this.memory.writePointer(this.memory.offset(this.#dtv, moduleId * BigInt(2 * this.memory.pointerBytes)), block);
      writeUnsigned(this.memory, this.#dtv, this.memory.pointerBytes, moduleId + 1n);
      this.#tls.push({ module: image.module, moduleId, address: block, byteLength: size }); this.#tlsUsed = next;
    }
    this.#images.push({ image, state: "loaded" }); return image;
  }
  tlsAddress(moduleId: bigint, offset: bigint): GuestAddress {
    const block = this.#tls.find(entry => entry.moduleId === moduleId);
    if (block === undefined || offset < 0n || offset >= BigInt(block.byteLength)) throw new RangeError("System V TLS index outside loaded module block");
    const dtv = this.memory.readPointer(this.memory.offset(this.threadPointer, BigInt(this.memory.pointerBytes)));
    if (dtv === null || moduleId > readUnsigned(this.memory, this.memory.offset(dtv, -BigInt(2 * this.memory.pointerBytes)), this.memory.pointerBytes)) throw new Error("System V guest DTV has no requested module");
    const address = this.memory.readPointer(this.memory.offset(dtv, moduleId * BigInt(2 * this.memory.pointerBytes)));
    if (address === null) throw new Error("System V guest DTV module is unallocated");
    return this.memory.offset(address, offset);
  }
  #resolveTls(import_: GuestImport): ElfTlsResolution | null {
    if (import_.symbol.kind !== "name") return null;
    const symbol = import_.symbol;
    for (const image of this.images) {
      if (import_.library !== "" && image.soname !== import_.library) continue;
      const entry = image.tlsExports.find(entry => entry.symbol.kind === "name" && entry.symbol.name === symbol.name && entry.symbol.version === symbol.version);
      const block = this.#tls.find(entry => entry.module.id === image.module.id && entry.module.digest === image.module.digest);
      if (entry !== undefined && block !== undefined) return { moduleId: block.moduleId, threadPointerOffset: block.address.byteOffset - this.threadPointer.byteOffset, offset: entry.offset };
    }
    return null;
  }
  initialize(image: ElfGuestImage, options: SystemVInitializeOptions): void {
    const entry = this.#images.find(entry => entry.image === image);
    if (entry === undefined) throw new Error("System V image is not loaded in this process");
    if (entry.state === "initialized" || entry.state === "initializing") return;
    if (entry.state !== "loaded") throw new Error(`Cannot initialize System V image in state ${entry.state}`);
    this.#budget = options.instructionBudget; entry.state = "initializing";
    try {
      for (const target of image.preinitializers) this.#initializer(image, target, options.context);
      for (const dependency of image.neededLibraries) {
        const other = this.images.find(candidate => candidate.soname === dependency);
        if (other !== undefined) this.initialize(other, options);
      }
      for (const target of image.initializers) this.#initializer(image, target, options.context);
      entry.state = "initialized";
    } catch (error) { entry.state = "failed"; throw error; }
  }
  #initializer(image: ElfGuestImage, target: GuestAddress, context: GuestCallContext): void {
    this.invoke(context, target, ["int32", "pointer", "pointer"], "void",
      [{ kind: "int32", value: this.options.argv?.length ?? 0 }, { kind: "pointer", value: this.#argv }, { kind: "pointer", value: this.#envp }]);
    this.#lifecycleTrace.push({ image: image.module, phase: "initialize", target });
  }
  finalize(image: ElfGuestImage, options: SystemVInitializeOptions): void {
    const entry = this.#images.find(entry => entry.image === image);
    if (entry?.state === "finalized") return;
    if (entry?.state !== "initialized") throw new Error("Only an initialized System V image can finalize");
    this.#budget = options.instructionBudget; entry.state = "finalizing";
    try {
      for (const target of image.finalizers) {
        this.invoke(options.context, target, [], "void", []);
        this.#lifecycleTrace.push({ image: image.module, phase: "finalize", target });
      }
      entry.state = "finalized";
    } catch (error) { entry.state = "failed"; throw error; }
  }
  registerDestructor(target: GuestAddress, argument: GuestAddress | null, dso: GuestAddress | null): void {
    this.memory.check(target, 1, "execute"); this.#destructors.push({ target, argument, dso, called: false });
  }
  finalizeDestructors(context: GuestCallContext, dso: GuestAddress | null): void {
    for (;;) {
      const entry = [...this.#destructors].reverse().find(entry => !entry.called && (dso === null || entry.dso?.byteOffset === dso.byteOffset));
      if (entry === undefined) return;
      entry.called = true;
      this.invoke(context, entry.target, ["pointer"], "void", [{ kind: "pointer", value: entry.argument }]);
    }
  }
  #strings(values: readonly string[]): GuestAddress {
    const vector = this.memory.allocate({ byteLength: (values.length + 1) * this.memory.pointerBytes, alignment: 16n, label: "System V argument vector" });
    values.forEach((value, index) => {
      const bytes = stringBytes(value), address = this.memory.allocate({ byteLength: bytes.length, label: "System V argument string" });
      this.memory.write(address, bytes); this.memory.writePointer(this.memory.offset(vector, BigInt(index * this.memory.pointerBytes)), address);
    });
    return vector;
  }
}
