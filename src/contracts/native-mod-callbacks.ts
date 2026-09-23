import type { ContentDigest } from "./content.ts";
import type { NativeAbi, Q2GameApiIdentity } from "./execution.ts";
import type { ModCallbackBinding, ModCallbackValue, ModClientInput, ModClientInputBinding } from "./mod-callbacks.ts";
import type { QvmModActorField } from "./qvm-mod-callbacks.ts";
import type { ItemId } from "./gameplay.ts";
import type { ProviderId } from "./identity.ts";
import type { ModPickupRule } from "./original-pickups.ts";

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
  | { readonly kind: "client"; readonly input: "self" | "other" | "activator" | "attacker" | "inflictor" }
  | { readonly kind: "userinfo"; readonly input: "self" | "other" | "activator" | "attacker" | "inflictor" }
  | { readonly kind: "user-command" }
  | { readonly kind: "time"; readonly input: "time" | "elapsed"; readonly units: "seconds" | "milliseconds"; readonly encoding: NativeModScalar }
  | { readonly kind: "address"; readonly value: NativeModAddress | null };
export interface NativeModSourceCall {
  readonly entry: NativeModEntry | { readonly kind: "game-export"; readonly name: string };
  readonly arguments: readonly NativeModValue[];
  readonly globals: readonly { readonly address: NativeModAddress; readonly value: NativeModValue }[];
  readonly returns: NativeModScalar | "void";
  /** Source-reviewed exclusions inside the original active function frame, pinned by the module digest. */
  readonly skips?: readonly { readonly entry: number; readonly join: number }[];
}
export type NativeModCallback = ModCallbackBinding & NativeModSourceCall;
export interface NativeModPickup extends ModPickupRule<NativeModSourceCall> {
  readonly context: readonly { readonly record: string; readonly offset: number;
    readonly value: { readonly kind: NativeModScalar | "vector"; readonly value: ModCallbackValue }
      | Extract<NativeModValue, { readonly kind: "time" | "address" }> }[];
}
export interface NativeModAdmissionCall extends NativeModSourceCall { readonly accepts: "always" | "nonzero"; }
export interface NativeModClientInputField {
  readonly record: string;
  readonly offset: number;
  readonly value: { readonly kind: NativeModScalar | "vector"; readonly value: ModCallbackValue }
    | Extract<NativeModValue, { readonly kind: "time" }>;
}
export type NativeModInputOutput = { readonly kind: "field"; readonly record: string; readonly offset: number }
  | { readonly kind: "handler"; readonly entry: NativeModEntry; readonly arguments: readonly NativeModValue[]; readonly inputs: readonly Exclude<ModClientInput, "view-angles">[] };
/** Private client arrays belong to the pinned module, separately from canonical client identities. */
export interface NativeModClients {
  readonly maximum: number;
  readonly records: readonly string[];
  readonly admit: readonly NativeModAdmissionCall[];
  readonly userinfo: readonly NativeModSourceCall[];
  readonly disconnect: readonly NativeModSourceCall[];
  readonly command: readonly NativeModSourceCall[];
  readonly input?: readonly ModClientInputBinding<NativeModSourceCall, NativeModInputOutput>[];
  /** Original per-client work on the existing sourceActors clock. */
  readonly frame?: readonly NativeModSourceCall[];
  /** Transient input words within declared private storage; the original module owns saved state. */
  readonly inputFields?: readonly NativeModClientInputField[];
  readonly pose?: { readonly viewHeight: NativeModArmorField; readonly crouched: { readonly field: NativeModArmorField; readonly mask: number } };
}
export type NativeModActorField = Exclude<QvmModActorField, { readonly binding: "health" | "inventory" | "constant" }>
  | { readonly offset: number; readonly binding: "address"; readonly value: NativeModAddress | null }
  | { readonly offset: number; readonly binding: "health"; readonly encoding: NativeModScalar }
  | { readonly offset: number; readonly binding: "inventory"; readonly encoding: NativeModScalar; readonly item: ItemId }
  | { readonly offset: number; readonly binding: "inventory-capacity"; readonly encoding: NativeModScalar; readonly item: ItemId }
  | { readonly offset: number; readonly binding: "constant"; readonly encoding: NativeModScalar; readonly value: number };
export interface NativeModActorRecord {
  readonly id: string;
  readonly base: { readonly kind: "entities" | "clients" } | ({ readonly kind: "address" } & NativeModAddress);
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
  readonly callbacks?: {
    readonly abi: "q2-classic" | "q2-rerelease";
    readonly touch: number | null;
    readonly pain: number | null;
    readonly die: number | null;
  };
  readonly combat?: NativeModCombat;
}
export interface NativeModScalarField { readonly offset: number; readonly encoding: NativeModScalar; }
export interface NativeModArmorField extends NativeModScalarField { readonly record: string; }
export type NativeModArmorSelection =
  | { readonly kind: "positive"; readonly field: NativeModArmorField }
  | { readonly kind: "enum"; readonly field: NativeModArmorField; readonly value: number; readonly none: number };
export interface NativeModPowerArmorItem {
  readonly item: ItemId;
  readonly kind: "screen" | "shield";
  readonly selection: NativeModArmorSelection;
  readonly cells: NativeModArmorField;
  readonly enabled: { readonly field: NativeModArmorField; readonly mask: number } | null;
}
export interface NativeModRegularArmorItem {
  readonly item: ItemId | null;
  readonly selection: NativeModArmorSelection;
  readonly points: NativeModArmorField;
}
export type NativeModArmor = { readonly kind: "none" } | {
  readonly kind: "q2";
  readonly regular: readonly { readonly item: ItemId; readonly selection: NativeModArmorSelection; readonly points: NativeModArmorField;
    readonly normalProtection: number; readonly energyProtection: number }[];
  readonly power: readonly NativeModPowerArmorItem[];
} | {
  readonly kind: "source";
  readonly regular: readonly NativeModRegularArmorItem[];
  readonly power: readonly NativeModPowerArmorItem[];
};
interface NativeModProtectionClaim {
  readonly id: string;
  readonly admission?: { readonly kind: "claim" } | { readonly kind: "replace-current-primary" } | { readonly kind: "replace-primary"; readonly owner: ProviderId };
}
type NativeModProtectionCall = { readonly abi: "source-call"; readonly call: NativeModSourceCall };
interface NativeModQ2ArmorCall {
  readonly entry: NativeModEntry;
  readonly flags: "q2-classic" | "q2-rerelease";
  readonly globals?: NativeModSourceCall["globals"];
}
export type NativeModProtectionDefinition = NativeModProtectionClaim & (
  | { readonly channel: "powered"; readonly storage: readonly NativeModPowerArmorItem[];
      readonly absorb: NativeModProtectionCall | (NativeModQ2ArmorCall & { readonly abi: "q2-check-power-armor" }) }
  | { readonly channel: "regular"; readonly storage: readonly NativeModRegularArmorItem[];
      readonly absorb: NativeModProtectionCall | (NativeModQ2ArmorCall & { readonly abi: "q2-check-armor"; readonly sparks: number }) }
);
export interface NativeModDeferredDamage {
  readonly process: NativeModEntry;
  readonly attacker: number;
  readonly inflictor: number;
  readonly blood: NativeModScalarField;
  readonly knockback: NativeModScalarField;
  readonly point: number;
  readonly mod: number;
  readonly receipt: number;
}
/** A pinned source declares its internal ABI and field meanings, independently of the engine API. */
export interface NativeModCombat {
  readonly damage: { readonly entry: NativeModEntry; readonly abi: "q2-classic" | "q2-rerelease" };
  readonly causes: { readonly edition: "classic"; readonly game: "base" | "xatrix" | "rogue" | "ctf" } | { readonly edition: "rerelease" };
  readonly health: NativeModScalarField;
  readonly mass: NativeModScalarField;
  readonly takedamage: NativeModScalarField;
  readonly flags: NativeModScalarField & { readonly invulnerable: number; readonly noKnockback: number };
  readonly armor: NativeModArmor;
  readonly deferred?: NativeModDeferredDamage;
}
export interface NativeModDeclaration {
  readonly version: 1;
  readonly runtime: "native";
  readonly program: { readonly path: string; readonly digest: ContentDigest };
  readonly target:
    | { readonly api: Extract<Q2GameApiIdentity, { readonly kind: "q2-classic-game" }>; readonly abi: Extract<NativeAbi, { readonly kind: "windows-i386" }> }
    | { readonly api: Extract<Q2GameApiIdentity, { readonly kind: "q2-rerelease-game" }>; readonly abi: Extract<NativeAbi, { readonly kind: "windows-x86-64" }> };
  readonly sourceActors?: NativeModSourceActors;
  readonly protection?: readonly NativeModProtectionDefinition[];
  readonly pickups?: readonly NativeModPickup[];
  readonly clients?: NativeModClients;
  readonly cvars: readonly { readonly name: string; readonly value: string }[];
  readonly spawnEntities: string | null;
  readonly actorRecords: readonly NativeModActorRecord[];
  readonly entityRecord: string | null;
  readonly initialize: readonly NativeModSourceCall[];
  readonly project: readonly NativeModSourceCall[];
  readonly release: readonly NativeModSourceCall[];
  readonly callbacks: readonly NativeModCallback[];
}
