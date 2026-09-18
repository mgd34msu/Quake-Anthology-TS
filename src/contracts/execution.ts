/* Execution boundaries follow Quake pr_comp.h/progs.h, Quake II game.h,
 * rerelease game.h, and Quake III qfiles.h/g_public.h. GPL-2.0-or-later. */
import type { ContentDigest } from "./content.ts";
import type { ActorId, CallbackId, ProviderId } from "./identity.ts";
import type { NumericProfile, RandomState } from "./numeric.ts";

export type QuakeCApiIdentity =
  | { readonly kind: "q1-netquake"; readonly programVersion: 6; readonly systemCrc: 5927 }
  | { readonly kind: "q1-quakeworld"; readonly programVersion: 6; readonly systemCrc: 54730 };
export type Q2GameApiIdentity =
  | { readonly kind: "q2-classic-game"; readonly version: 3 }
  | { readonly kind: "q2-rerelease-game"; readonly version: 2023 };
export interface Q2CgameApiIdentity { readonly kind: "q2-rerelease-cgame"; readonly version: 2022; }
export type Q3ApiIdentity =
  | { readonly kind: "q3-qagame"; readonly version: 7 | 8 }
  | { readonly kind: "q3-cgame"; readonly version: 3 | 4 }
  | { readonly kind: "q3-ui"; readonly version: 4 | 6 };
export type GameApiIdentity = QuakeCApiIdentity | Q2GameApiIdentity | Q2CgameApiIdentity | Q3ApiIdentity;

/** Source callback entry points dispatched by the shared scheduler. */
export type SourceGameLifecycle = { readonly module: ModuleIdentity } & (
  | { readonly kind: "quakec"; readonly api: QuakeCApiIdentity; readonly startFrame: () => undefined }
  | { readonly kind: "q2-classic"; readonly api: Extract<Q2GameApiIdentity, { readonly kind: "q2-classic-game" }>; readonly runFrame: () => undefined }
  | { readonly kind: "q2-rerelease"; readonly api: Extract<Q2GameApiIdentity, { readonly kind: "q2-rerelease-game" }>; readonly runFrame: (mainLoop: boolean) => undefined; readonly prepFrame: () => undefined }
  | { readonly kind: "q3"; readonly api: Extract<Q3ApiIdentity, { readonly kind: "q3-qagame" }>; readonly runFrame: (levelTimeMilliseconds: number) => undefined }
);

/** A replacement must identify the artifact it replaces, not just a module name. */
export interface ModuleIdentity {
  readonly id: ProviderId;
  readonly artifactPath: string;
  readonly digest: ContentDigest;
  readonly revision: string;
}
export type NativeAbi =
  | { readonly kind: "windows-i386"; readonly image: "pe32"; readonly pointerBytes: 4; readonly call: "cdecl" }
  | { readonly kind: "windows-x86-64"; readonly image: "pe32+"; readonly pointerBytes: 8; readonly call: "microsoft-x64" }
  | { readonly kind: "linux-i386"; readonly image: "elf32"; readonly pointerBytes: 4; readonly call: "system-v-i386" }
  | { readonly kind: "linux-x86-64"; readonly image: "elf64"; readonly pointerBytes: 8; readonly call: "system-v-x86-64" };
/** Win32 runtime imports and callbacks can use a convention distinct from GetGameAPI. */
export type NativeCallAbi = NativeAbi
  | (Omit<Extract<NativeAbi, { readonly kind: "windows-i386" }>, "call"> & { readonly call: "stdcall" | "thiscall" | "fastcall" });

export interface QuakeCBuiltinBinding {
  readonly kind: "numbered" | "named";
  readonly number: number;
  readonly name: string;
  readonly callback: CallbackId;
}
export interface QuakeCHostProfile {
  readonly api: QuakeCApiIdentity;
  readonly programSearchOrder: readonly string[];
  readonly globalsLayout: GuestLayout;
  readonly entityVariablesLayout: GuestLayout;
  readonly builtins: readonly QuakeCBuiltinBinding[];
  readonly extensions: readonly string[];
}
export type ExecutionProfile =
  | { readonly kind: "typescript"; readonly module: ModuleIdentity; readonly api: GameApiIdentity; readonly implementation: ProviderId; readonly numeric: NumericProfile }
  | { readonly kind: "quakec"; readonly module: ModuleIdentity; readonly host: QuakeCHostProfile; readonly numeric: NumericProfile }
  | { readonly kind: "qvm"; readonly module: ModuleIdentity; readonly api: Q3ApiIdentity; readonly magic: 0x12721444; readonly numeric: NumericProfile }
  | { readonly kind: "native-guest"; readonly module: ModuleIdentity; readonly api: Q2GameApiIdentity | Q2CgameApiIdentity | Q3ApiIdentity; readonly abi: NativeAbi; readonly numeric: NumericProfile };

/** The owning memory validates addresses. Pointers intentionally have no actor generation. */
export interface GuestAddress {
  readonly kind: "guest-address";
  readonly addressSpace: symbol;
  readonly byteOffset: bigint;
}
export type GuestStorage = "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "float32" | "float64" | "pointer";
export interface GuestFieldLayout {
  readonly name: string;
  readonly byteOffset: number;
  readonly storage: GuestStorage;
  readonly count: number;
}
export interface GuestLayout {
  readonly id: `${string}:${string}`;
  readonly byteLength: number;
  readonly alignment: number;
  readonly pointerBytes: 4 | 8;
  readonly byteOrder: "little-endian";
  readonly fields: readonly GuestFieldLayout[];
}
export interface GuestMemory {
  readonly module: ModuleIdentity;
  readonly addressSpace: symbol;
  readonly pointerBytes: 4 | 8;
  /** Decode the source's null representation before exposing a dereferenceable address. */
  readonly pointer: (rawValue: bigint) => GuestAddress | null;
  readonly offset: (address: GuestAddress, displacement: bigint) => GuestAddress;
  /** A live view, including overlapping aliases and bytes outside host-known fields. */
  readonly borrow: (address: GuestAddress, byteLength: number) => DataView;
  readonly copy: (address: GuestAddress, byteLength: number) => Uint8Array;
  readonly write: (address: GuestAddress, bytes: Uint8Array) => undefined;
}
export interface RawEntityView {
  readonly module: ModuleIdentity;
  readonly slot: number;
  readonly address: GuestAddress;
  readonly strideBytes: number;
  readonly publicLayout: GuestLayout;
  /** Includes the complete source-owned record; this view is never a network snapshot. */
  readonly bytes: DataView;
  /** Resolve on access because freeing/reusing a source slot changes shared authority. */
  readonly currentActor: () => ActorId | null;
}
export interface RawEntityTable {
  readonly module: ModuleIdentity;
  readonly base: GuestAddress;
  readonly strideBytes: number;
  readonly count: number;
  readonly capacity: number;
  readonly layout: GuestLayout;
  readonly atSlot: (slot: number) => RawEntityView;
  readonly fromPointer: (address: GuestAddress) => RawEntityView;
}

export type GuestCallbackReference =
  | { readonly kind: "typescript"; readonly provider: ProviderId; readonly callback: CallbackId }
  | { readonly kind: "quakec"; readonly module: ModuleIdentity; readonly functionIndex: number }
  | { readonly kind: "qvm"; readonly module: ModuleIdentity; readonly instructionIndex: number }
  | { readonly kind: "native-guest"; readonly module: ModuleIdentity; readonly address: GuestAddress; readonly abi: NativeCallAbi };
export type GuestCallValue =
  | { readonly kind: "int32"; readonly value: number }
  | { readonly kind: "uint32"; readonly value: number }
  | { readonly kind: "int64"; readonly value: bigint }
  | { readonly kind: "uint64"; readonly value: bigint }
  | { readonly kind: "float32"; readonly value: number }
  | { readonly kind: "float64"; readonly value: number }
  | { readonly kind: "pointer"; readonly value: GuestAddress | null }
  | { readonly kind: "aggregate"; readonly layout: GuestLayout; readonly bytes: Uint8Array };
export type GuestCallResult = { readonly kind: "void" } | GuestCallValue;
export interface GuestCallbackBinding {
  readonly id: CallbackId;
  readonly reference: GuestCallbackReference;
  readonly parameters: readonly GuestValueLayout[];
  readonly result: GuestValueLayout | "void";
}
export type GuestValueLayout =
  | { readonly kind: "scalar"; readonly storage: GuestStorage }
  | { readonly kind: "aggregate"; readonly layout: GuestLayout };
/** Saved native offsets are rebound into the restored address space. */
export type SavedGuestCallbackReference =
  | Exclude<GuestCallbackReference, { readonly kind: "native-guest" }>
  | { readonly kind: "native-guest"; readonly module: ModuleIdentity; readonly byteOffset: bigint; readonly abi: NativeCallAbi };
export interface SavedGuestCallbackBinding extends Omit<GuestCallbackBinding, "reference"> {
  readonly reference: SavedGuestCallbackReference;
}
export interface GuestCallContext {
  readonly module: ModuleIdentity;
  readonly callback: GuestCallbackReference;
  readonly parent: GuestCallContext | null;
  readonly self: RawEntityView | null;
  readonly other: RawEntityView | null;
}
export interface GuestExecutor {
  readonly profile: ExecutionProfile;
  /** Nested host callbacks and their mutations finish before the enclosing call returns. */
  readonly invoke: (context: GuestCallContext, arguments_: readonly GuestCallValue[]) => GuestCallResult;
  readonly checkpoint: () => GuestCheckpoint;
  readonly restore: (checkpoint: GuestCheckpoint) => undefined;
}

/** Serialized source-private bytes always carry their owning artifact and format. */
export interface GuestPrivateState {
  readonly module: ModuleIdentity;
  readonly format: `${string}:${string}`;
  readonly bytes: Uint8Array;
}
export interface GuestMemoryRegion {
  readonly base: bigint;
  readonly permissions: "read" | "read-write" | "read-execute" | "read-write-execute";
  readonly bytes: Uint8Array;
}
interface CheckpointBase {
  readonly module: ModuleIdentity;
  readonly random: readonly RandomState[];
  readonly callbacks: readonly SavedGuestCallbackBinding[];
}
export interface QuakeCStackFrame {
  readonly statement: number;
  readonly functionIndex: number;
}
export interface QuakeCCheckpoint extends CheckpointBase {
  readonly kind: "quakec";
  readonly api: QuakeCApiIdentity;
  readonly globals: Uint8Array;
  readonly entities: Uint8Array;
  readonly entityStrideBytes: number;
  readonly entityCount: number;
  readonly strings: Uint8Array;
  readonly statement: number;
  readonly functionIndex: number;
  readonly argumentCount: number;
  readonly callStack: readonly QuakeCStackFrame[];
  readonly locals: Uint8Array;
  readonly hostState: GuestPrivateState;
}
export type QvmAbiProfile = "q3-modern" | "q3-1.16n-base";

export interface QvmCheckpoint extends CheckpointBase {
  readonly abiProfile?: QvmAbiProfile;
  readonly kind: "qvm";
  readonly api: Q3ApiIdentity;
  readonly data: Uint8Array;
  readonly instructionIndex: number;
  readonly programStack: number;
  readonly operandStack: readonly number[];
  readonly hostState: GuestPrivateState;
}
export interface NativeGuestCheckpoint extends CheckpointBase {
  readonly kind: "native-guest";
  readonly abi: NativeAbi;
  readonly regions: readonly GuestMemoryRegion[];
  /** Layout includes registers, flags, x87 control/tag state, and SSE control/registers. */
  readonly processorLayout: GuestLayout;
  readonly processorState: Uint8Array;
  readonly runtimeState: GuestPrivateState;
}
export interface TypeScriptGuestCheckpoint extends CheckpointBase {
  readonly kind: "typescript";
  readonly api: GameApiIdentity;
  readonly state: GuestPrivateState;
}
/** Restoring bytes must also rebind callbacks and recreate memory ownership. */
export type GuestCheckpoint = QuakeCCheckpoint | QvmCheckpoint | NativeGuestCheckpoint | TypeScriptGuestCheckpoint;
