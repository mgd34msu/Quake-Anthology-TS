import type { SourceWeaponItem } from "./source-items.ts";
import type { ItemId } from "./gameplay.ts";
import type { NativeModAddress, NativeModArmorField, NativeModEntry, NativeModSourceCall } from "./native-mod-callbacks.ts";

export type NativeItemField = NativeModArmorField;
export interface NativeItemPointer { readonly record: string; readonly offset: number; }
export type NativeItemCapacity = { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "field"; readonly field: NativeItemField }
  | { readonly kind: "source"; readonly address: NativeModAddress; readonly encoding: NativeItemField["encoding"] };
export type NativeItemStorage = { readonly kind: "counter"; readonly field: NativeItemField; readonly item: ItemId; readonly capacity: NativeItemCapacity }
  | { readonly kind: "bits"; readonly field: NativeItemField; readonly privateMask: number; readonly items: readonly { readonly item: ItemId; readonly mask: number }[] };
export type NativeItemTest = { readonly kind: "scalar"; readonly field: NativeItemField; readonly mask: number | null; readonly comparison: "equals" | "at-most"; readonly value: number }
  | { readonly kind: "pointer"; readonly field: NativeItemPointer; readonly value: NativeModAddress | null };
export interface NativeWeaponStage {
  readonly dispatcher: { readonly entry: NativeModEntry; readonly record: string; readonly argument: number; readonly arguments: number };
  /** Closed original input-read regions. Projection ends before the original conditional branch. */
  readonly decisions: readonly { readonly entry: number; readonly join: number; readonly fields: readonly { readonly field: NativeItemField; readonly clearMask: number }[] }[];
  readonly committedInput?: readonly (readonly NativeItemTest[])[];
  readonly continuations: readonly (readonly NativeItemTest[])[];
  readonly settled: readonly (readonly NativeItemTest[])[];
  readonly selection: { readonly active: NativeItemPointer; readonly pending: NativeItemPointer | null;
    readonly values: readonly { readonly item: ItemId; readonly address: NativeModAddress; readonly request: NativeModSourceCall }[] };
}
export interface NativeModItems {
  readonly definitions: readonly ({ readonly item: ItemId; readonly label: string; readonly admission: "add" | "replace-primary" } & (
    { readonly kind: "counter" } | SourceWeaponItem))[];
  readonly storage: readonly NativeItemStorage[];
  readonly weapons?: NativeWeaponStage;
}
