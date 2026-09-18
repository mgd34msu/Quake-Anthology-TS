// SPDX-License-Identifier: GPL-2.0-or-later
import type {
  GuestAddress, GuestCallContext, GuestCallResult, GuestCallValue, GuestMemory,
  GuestValueLayout, ModuleIdentity, NativeAbi, NativeCallAbi,
} from "../../contracts/execution.ts";
import type { CallbackId } from "../../contracts/identity.ts";

export type GuestPointerBytes = 4 | 8;
export type GuestAccess = "read" | "write" | "execute";
export type GuestPermissions = "none" | "read" | "read-write" | "read-execute" | "read-write-execute" | "execute";
export interface GuestMapping {
  readonly base: bigint;
  readonly byteLength: number;
  readonly permissions: GuestPermissions;
  readonly label: string;
}
export interface GuestMapOptions {
  readonly base: bigint;
  readonly byteLength: number;
  readonly permissions: GuestPermissions;
  readonly label?: string;
  /** Copied into private storage. The remainder is zero-filled. */
  readonly bytes?: Uint8Array;
}
export interface GuestAllocationOptions {
  readonly byteLength: number;
  readonly alignment?: bigint;
  readonly permissions?: GuestPermissions;
  readonly label?: string;
}
export interface GuestMemorySnapshot {
  readonly module: ModuleIdentity;
  readonly pointerBytes: GuestPointerBytes;
  readonly allocationBase: bigint;
  readonly backings: readonly Uint8Array[];
  readonly mappings: readonly (GuestMapping & { readonly backing: number; readonly backingOffset: number })[];
}
export interface MappedGuestMemory extends GuestMemory {
  readUint8(address: GuestAddress): number;
  readInt8(address: GuestAddress): number;
  readUint16(address: GuestAddress): number;
  readInt16(address: GuestAddress): number;
  readUint32(address: GuestAddress): number;
  readInt32(address: GuestAddress): number;
  readUint64(address: GuestAddress): bigint;
  readInt64(address: GuestAddress): bigint;
  readFloat32(address: GuestAddress): number;
  readFloat64(address: GuestAddress): number;
  readPointer(address: GuestAddress): GuestAddress | null;
  writeUint8(address: GuestAddress, value: number): undefined;
  writeInt8(address: GuestAddress, value: number): undefined;
  writeUint16(address: GuestAddress, value: number): undefined;
  writeInt16(address: GuestAddress, value: number): undefined;
  writeUint32(address: GuestAddress, value: number): undefined;
  writeInt32(address: GuestAddress, value: number): undefined;
  writeUint64(address: GuestAddress, value: bigint): undefined;
  writeInt64(address: GuestAddress, value: bigint): undefined;
  writeFloat32(address: GuestAddress, value: number): undefined;
  writeFloat64(address: GuestAddress, value: number): undefined;
  writePointer(address: GuestAddress, value: GuestAddress | null): undefined;
  map(options: GuestMapOptions): GuestAddress;
  allocate(options: GuestAllocationOptions): GuestAddress;
  mapAlias(options: Omit<GuestMapOptions, "bytes"> & { readonly source: GuestAddress }): GuestAddress;
  unmap(address: GuestAddress, byteLength: number): undefined;
  protect(address: GuestAddress, byteLength: number, permissions: GuestPermissions): undefined;
  mappings(): readonly GuestMapping[];
  /** Observe committed stores to this backing range, including writes through aliases. */
  observeWrites(address: GuestAddress, byteLength: number, afterWrite: () => void): () => void;
  check(address: GuestAddress, byteLength: number, access: GuestAccess): undefined;
  fetch(address: GuestAddress, byteLength: number): Uint8Array;
  /** Execute one live byte at this memory owner's processor instruction pointer. */
  fetchByte(byteOffset: bigint): number;
  checkpoint(): GuestMemorySnapshot;
}

export type GuestRegister = "rax" | "rcx" | "rdx" | "rbx" | "rsp" | "rbp" | "rsi" | "rdi"
  | "r8" | "r9" | "r10" | "r11" | "r12" | "r13" | "r14" | "r15";
export type GuestIntegerWidth = 8 | 16 | 32 | 64;
export type GuestArchitecture = "i386" | "x86-64";
export interface GuestIntegerRegisters {
  readonly architecture: GuestArchitecture;
  read(register: GuestRegister, width: GuestIntegerWidth, highByte?: boolean): bigint;
  /** A 32-bit write clears the upper half in x86-64 mode. */
  write(register: GuestRegister, width: GuestIntegerWidth, value: bigint, highByte?: boolean): undefined;
  checkpoint(): Uint8Array;
  restore(bytes: Uint8Array): undefined;
}
export type GuestFlag = "carry" | "parity" | "auxiliary-carry" | "zero" | "sign" | "trap" | "interrupt"
  | "direction" | "overflow" | "resume" | "virtual-8086" | "alignment-check" | "virtual-interrupt"
  | "virtual-interrupt-pending" | "identification";
export interface GuestFlags {
  value: bigint;
  get(flag: GuestFlag): boolean;
  set(flag: GuestFlag, value: boolean): undefined;
}
export interface GuestSegment {
  selector: number;
  base: bigint;
  limit: bigint;
}
export interface GuestSegments {
  readonly cs: GuestSegment;
  readonly ds: GuestSegment;
  readonly es: GuestSegment;
  readonly ss: GuestSegment;
  readonly fs: GuestSegment;
  readonly gs: GuestSegment;
}
/** Eight physical 80-bit slots; TOP remains in statusWord and tags remain source bits. */
export interface GuestX87State {
  readonly registers: Uint8Array;
  controlWord: number;
  statusWord: number;
  tagWord: number;
  lastOpcode: number;
  instructionPointer: bigint;
  dataPointer: bigint;
  instructionSelector: number;
  dataSelector: number;
}
/** Raw lanes retain NaN payloads, signed zeros, integer aliases, and MXCSR flags. */
export interface GuestSimdState {
  readonly xmm: Uint8Array;
  mxcsr: number;
  mxcsrMask: number;
}
export interface GuestProcessorState {
  readonly architecture: GuestArchitecture;
  readonly registers: GuestIntegerRegisters;
  instructionPointer: bigint;
  readonly flags: GuestFlags;
  readonly segments: GuestSegments;
  readonly x87: GuestX87State;
  readonly simd: GuestSimdState;
}
export interface GuestInstruction {
  readonly address: GuestAddress;
  readonly bytes: Uint8Array;
  readonly mnemonic: string;
}
export type GuestException =
  | { readonly kind: "processor"; readonly vector: number; readonly errorCode: bigint | null; readonly instruction: GuestAddress; readonly detail: string }
  | { readonly kind: "memory"; readonly access: GuestAccess; readonly address: GuestAddress; readonly byteLength: number; readonly detail: string }
  | { readonly kind: "windows"; readonly code: number; readonly flags: number; readonly address: GuestAddress; readonly arguments: readonly bigint[] }
  | { readonly kind: "cxx"; readonly object: GuestAddress; readonly typeInfo: GuestAddress | null; readonly destructor: GuestAddress | null; readonly abi: NativeAbi };
export type GuestExecutionStop =
  | { readonly kind: "budget"; readonly instructions: number }
  | { readonly kind: "return"; readonly instructions: number; readonly address: GuestAddress }
  | { readonly kind: "host-call"; readonly instructions: number; readonly address: GuestAddress }
  | { readonly kind: "halt"; readonly instructions: number; readonly address: GuestAddress }
  | { readonly kind: "exception"; readonly instructions: number; readonly exception: GuestException }
  | { readonly kind: "unsupported"; readonly instructions: number; readonly instruction: GuestInstruction; readonly detail: string };
export interface GuestCpu {
  readonly state: GuestProcessorState;
  readonly memory: MappedGuestMemory;
  run(options: { readonly instructionBudget: number; readonly returnAddress: GuestAddress | null }): GuestExecutionStop;
}
export interface GuestCallSignature {
  readonly abi: NativeCallAbi;
  readonly parameters: readonly GuestValueLayout[];
  readonly result: GuestValueLayout | "void";
  readonly variadic: boolean;
}
export interface GuestHostCallback {
  readonly id: CallbackId;
  readonly signature: GuestCallSignature;
  readonly invoke: (context: GuestCallContext, arguments_: readonly GuestCallValue[]) => GuestCallResult;
}
export interface GuestAbiAdapter {
  readonly abi: NativeCallAbi;
  enter(cpu: GuestCpu, target: GuestAddress, signature: GuestCallSignature, arguments_: readonly GuestCallValue[], returnAddress: GuestAddress): undefined;
  arguments(cpu: GuestCpu, signature: GuestCallSignature): readonly GuestCallValue[];
  returnValue(cpu: GuestCpu, signature: GuestCallSignature): GuestCallResult;
  leave(cpu: GuestCpu, signature: GuestCallSignature, result: GuestCallResult): undefined;
}
export type GuestSymbolName = { readonly kind: "name"; readonly name: string; readonly version: string | null }
  | { readonly kind: "ordinal"; readonly ordinal: number };
export interface GuestImport {
  readonly library: string;
  readonly symbol: GuestSymbolName;
  readonly slot: GuestAddress;
  readonly weak: boolean;
}
export type GuestImportResolution =
  | { readonly kind: "guest"; readonly address: GuestAddress; readonly module: ModuleIdentity }
  | { readonly kind: "host"; readonly address: GuestAddress; readonly callback: GuestHostCallback }
  | { readonly kind: "unresolved"; readonly import: GuestImport; readonly detail: string };
export interface GuestImportResolver {
  resolve(import_: GuestImport, requesting: GuestImage): GuestImportResolution;
}
export interface GuestExport {
  readonly symbol: GuestSymbolName;
  readonly target: { readonly kind: "address"; readonly address: GuestAddress }
    | { readonly kind: "forward"; readonly library: string; readonly symbol: GuestSymbolName };
}
export interface GuestTlsTemplate {
  readonly image: ModuleIdentity;
  readonly initialized: Uint8Array;
  readonly zeroFillBytes: number;
  readonly alignment: bigint;
  readonly callbacks: readonly GuestAddress[];
}
export interface GuestThreadTls {
  readonly threadId: bigint;
  readonly threadPointer: GuestAddress;
  readonly modules: ReadonlyMap<ModuleIdentity, GuestAddress>;
}
export interface GuestUnwindRegion {
  readonly start: GuestAddress;
  readonly end: GuestAddress;
  readonly format: "pe-x64-unwind" | "elf-eh-frame" | "elf-debug-frame";
  readonly metadata: Uint8Array;
}
export interface GuestImage {
  readonly module: ModuleIdentity;
  readonly abi: NativeAbi;
  readonly base: GuestAddress;
  readonly preferredBase: bigint;
  readonly byteLength: bigint;
  readonly entryPoint: GuestAddress | null;
  readonly mappings: readonly GuestMapping[];
  readonly imports: readonly GuestImport[];
  readonly exports: readonly GuestExport[];
  readonly tls: GuestTlsTemplate | null;
  readonly initializers: readonly GuestAddress[];
  readonly finalizers: readonly GuestAddress[];
  readonly unwind: readonly GuestUnwindRegion[];
}
