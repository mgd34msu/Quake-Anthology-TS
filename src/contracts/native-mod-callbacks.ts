import type { ContentDigest } from "./content.ts";
import type { NativeAbi, Q2GameApiIdentity } from "./execution.ts";
import type { ModCallbackBinding, ModCallbackValue } from "./mod-callbacks.ts";
import type { QvmModActorField } from "./qvm-mod-callbacks.ts";
import type { ItemId } from "./gameplay.ts";

export type NativeModScalar = "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "int64" | "uint64" | "float32" | "float64";
/** Image-relative addresses are rebound after each original source save restoration. */
export interface NativeModAddress {
  readonly rva: number;
  readonly indirections: readonly number[];
}
export type NativeModEntry = { readonly kind: "export"; readonly name: string } | { readonly kind: "rva"; readonly rva: number };
export type NativeModValue =
  | { readonly kind: NativeModScalar | "vector" | "string"; readonly value: ModCallbackValue }
  | { readonly kind: "actor"; readonly record: string; readonly input: "self" | "other" | "activator" | "attacker" | "inflictor" }
  | { readonly kind: "time"; readonly input: "time" | "elapsed"; readonly units: "seconds" | "milliseconds"; readonly encoding: NativeModScalar }
  | { readonly kind: "address"; readonly value: NativeModAddress | null };
export interface NativeModSourceCall {
  readonly entry: NativeModEntry;
  readonly arguments: readonly NativeModValue[];
  readonly globals: readonly { readonly address: NativeModAddress; readonly value: NativeModValue }[];
  readonly returns: NativeModScalar | "void";
}
export type NativeModCallback = ModCallbackBinding & NativeModSourceCall;
export type NativeModActorField = Exclude<QvmModActorField, { readonly binding: "health" | "inventory" | "constant" }>
  | { readonly offset: number; readonly binding: "address"; readonly value: NativeModAddress | null }
  | { readonly offset: number; readonly binding: "health"; readonly encoding: NativeModScalar }
  | { readonly offset: number; readonly binding: "inventory"; readonly encoding: NativeModScalar; readonly item: ItemId }
  | { readonly offset: number; readonly binding: "constant"; readonly encoding: NativeModScalar; readonly value: number };
export interface NativeModActorRecord {
  readonly id: string;
  readonly base: { readonly kind: "entities" } | ({ readonly kind: "address" } & NativeModAddress);
  readonly stride: number;
  readonly firstSlot: number;
  readonly capacity: number;
  readonly fields: readonly NativeModActorField[];
}
/** Original q2 allocator/free and per-entity update ABIs; offsets belong to the pinned module. */
export interface NativeModSourceActors {
  readonly allocate: NativeModEntry;
  readonly release: NativeModEntry;
  readonly update: { readonly entry: NativeModEntry; readonly returns: NativeModScalar | "void" };
  readonly frameSeconds: number;
  readonly clock: readonly { readonly address: NativeModAddress; readonly input: "time" | "frame"; readonly encoding: NativeModScalar; readonly units: "seconds" | "milliseconds" }[];
  readonly fields: {
    readonly velocity: number;
    readonly ground: number;
    readonly use: number | null;
    readonly think: number;
    readonly nextthink: { readonly offset: number; readonly encoding: NativeModScalar; readonly units: "seconds" | "milliseconds" };
  };
}
export interface NativeModDeclaration {
  readonly version: 1;
  readonly runtime: "native";
  readonly program: { readonly path: string; readonly digest: ContentDigest };
  readonly target:
    | { readonly api: Extract<Q2GameApiIdentity, { readonly kind: "q2-classic-game" }>; readonly abi: Extract<NativeAbi, { readonly kind: "windows-i386" }> }
    | { readonly api: Extract<Q2GameApiIdentity, { readonly kind: "q2-rerelease-game" }>; readonly abi: Extract<NativeAbi, { readonly kind: "windows-x86-64" }> };
  readonly sourceActors?: NativeModSourceActors;
  readonly cvars: readonly { readonly name: string; readonly value: string }[];
  readonly spawnEntities: string | null;
  readonly actorRecords: readonly NativeModActorRecord[];
  readonly entityRecord: string | null;
  readonly initialize: readonly NativeModSourceCall[];
  readonly project: readonly NativeModSourceCall[];
  readonly release: readonly NativeModSourceCall[];
  readonly callbacks: readonly NativeModCallback[];
}
