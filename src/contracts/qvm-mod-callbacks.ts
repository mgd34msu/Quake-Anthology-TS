import type { QvmCombatCall, QvmCombatMass, QvmCombatTeam, QvmDamageFlags, QvmDamageRole } from "./qvm-combat.ts";
import type { ModClientOutputDeclaration } from "./mod-client-outputs.ts";
import type { SourceObjectiveDeclaration, SourceMatchField } from "./source-match.ts";
import type { QvmModActorFrame } from "./qvm-mod-actor-frame.ts";
import type { QvmModItems } from "./qvm-mod-items.ts";
import type { ContentDigest } from "./content.ts";
import type { QvmAbiProfile } from "./execution.ts";
import type { ItemId } from "./gameplay.ts";
import type { ProviderId } from "./identity.ts";
import type { Vec3 } from "./math.ts";
import type { ModCallbackBinding, ModCallbackValue, ModClientInput, ModClientInputBinding } from "./mod-callbacks.ts";
import type { QvmModPresentationDeclaration } from "./qvm-mod-presentation.ts";
import type { ModPickupRule } from "./original-pickups.ts";

export type QvmModScalar = "int32" | "float32";
export type QvmModValue =
  | { readonly kind: QvmModScalar | "vector" | "string"; readonly value: ModCallbackValue }
  | { readonly kind: "actor"; readonly record: string; readonly input: "self" | "other" | "activator" | "attacker" | "inflictor" }
  | { readonly kind: "client"; readonly input: "self" | "other" | "activator" | "attacker" | "inflictor" }
  | { readonly kind: "time"; readonly input: "time" | "elapsed"; readonly units: "seconds" | "milliseconds"; readonly encoding: QvmModScalar }
  | { readonly kind: "address"; readonly value: number };

export interface QvmModSourceCall {
  readonly entry: number;
  readonly arguments: readonly QvmModValue[];
  readonly globals: readonly { readonly address: number; readonly value: QvmModValue }[];
  readonly returns: QvmModScalar | "void";
}
/** Synchronous original pickup calls borrow private words on the actual offered actor's projection. */
export interface QvmModPickup extends ModPickupRule<QvmModSourceCall> {
  readonly context: readonly { readonly record: string; readonly offset: number; readonly value: QvmModValue }[];
}
export type QvmModCallback = ModCallbackBinding & QvmModSourceCall;
export type QvmModActorField = { readonly offset: number; readonly access?: "read-only" | "read-write" } & (
  | (SourceMatchField & { readonly encoding: QvmModScalar })
  | { readonly binding: "health"; readonly encoding: QvmModScalar }
  | { readonly binding: "inventory"; readonly encoding: QvmModScalar; readonly item: ItemId }
  | { readonly binding: "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" }
  | { readonly binding: "record"; readonly record: string }
  | { readonly binding: "constant"; readonly encoding: QvmModScalar; readonly value: number }
  | { readonly binding: "constant-vector"; readonly value: Vec3 }
  | { readonly binding: "private"; readonly byteLength: number }
);
/** Exact source arrays can include separate entity/client/private records linked by guest pointers. */
export interface QvmModActorRecord {
  readonly id: string;
  readonly address: number;
  readonly stride: number;
  readonly capacity: number;
  readonly fields: readonly QvmModActorField[];
}
/** Entry points and private fields are declared against the exact executable digest. */
export interface QvmModSourceActors {
  readonly allocate: number;
  readonly release: { readonly entry: number; readonly argument: number };
  readonly inuse: number;
  readonly eventEntityType: number;
  readonly update: QvmModSourceCall | null;
  readonly frame?: QvmModActorFrame;
  /** Exact CONST-address/CONST-value/STORE4 instructions, applied only at fresh initialization. */
  readonly initialStores?: readonly number[];
  /** gentity_t function-pointer fields; null means this source has no such callback. */
  readonly callbacks?: { readonly touch: number | null; readonly use: number | null; readonly pain: number | null; readonly die: number | null };
}
/** Private layout and entry are admitted by the enclosing executable digest. */
interface QvmModCombatFields {
  readonly entry: number;
  readonly health: number;
  readonly takedamage: number;
  readonly flags: number;
  readonly godmode: number;
  readonly noKnockback: number;
  readonly globals: QvmModSourceCall["globals"];
  readonly client: { readonly pointer: number; readonly record: string; readonly health: number; readonly armor: number; readonly protection: number; readonly team: number } | null;
}
export interface QvmModCombatCalls {
  readonly damage: QvmCombatCall<QvmDamageRole>;
  readonly touch: QvmCombatCall<"target" | "other" | "trace">;
  readonly use: QvmCombatCall<"target" | "other" | "activator">;
  readonly pain: QvmCombatCall<"target" | "attacker" | "amount">;
  readonly die: QvmCombatCall<"target" | "inflictor" | "attacker" | "amount" | "method">;
}
export type QvmModCombat = QvmModCombatFields & (
  | { readonly abi: "q3-g-damage" }
  | { readonly abi: "declared"; readonly calls: QvmModCombatCalls; readonly damageFlags: QvmDamageFlags;
      readonly mass: QvmCombatMass; readonly teams: readonly QvmCombatTeam[] }
);
export interface QvmModProtectionScalar { readonly record: string; readonly offset: number; readonly encoding: QvmModScalar; }
export interface QvmModProtectionSelection<Value> {
  readonly field: QvmModProtectionScalar;
  readonly mask: number | null;
  readonly values: readonly { readonly value: number; readonly selected: Value }[];
}
interface QvmModProtectionCall {
  readonly id: string;
  readonly admission: { readonly kind: "claim" | "replace-current-primary" } | { readonly kind: "replace-primary"; readonly owner: ProviderId };
  readonly absorb: QvmModSourceCall;
  readonly flags: { readonly noArmor: number; readonly noPowerArmor: number; readonly noRegularArmor: number; readonly energy: number; readonly radius: number };
}
/** Storage describes live source state; absorption always executes the declared original function. */
export type QvmModProtection = QvmModProtectionCall & (
  | { readonly channel: "regular"; readonly storage: { readonly points: QvmModProtectionScalar;
      readonly item: ItemId | null; readonly selection?: QvmModProtectionSelection<ItemId | null> } }
  | { readonly channel: "powered"; readonly storage: { readonly cells: QvmModProtectionScalar;
      readonly selection: QvmModProtectionSelection<"none" | "screen" | "shield"> } }
);
export interface QvmModCallbackDeclaration {
  readonly objectives?: readonly SourceObjectiveDeclaration<{ readonly address: QvmModObjectiveAddress; readonly encoding: QvmModScalar }, QvmModObjectiveAddress, QvmModSourceCall>[];
  readonly version: 1;
  readonly runtime: "qvm";
  readonly program: { readonly path: string; readonly digest: ContentDigest };
  readonly abiProfile: QvmAbiProfile;
  readonly presentation?: QvmModPresentationDeclaration;
  /** Explicit component additions, consumed only by declared source calls; absent/null is an empty stream. */
  readonly spawnEntities?: string | null;
  readonly clients?: QvmModClients;
  readonly actorRecords: readonly QvmModActorRecord[];
  readonly entityRecord: string | null;
  readonly sourceActors?: QvmModSourceActors;
  readonly combat?: QvmModCombat;
  readonly protection?: readonly QvmModProtection[];
  readonly pickups?: readonly QvmModPickup[];
  readonly items?: QvmModItems;
  readonly initialize: readonly QvmModSourceCall[];
  readonly callbacks: readonly QvmModCallback[];
}

/** Source client rows are reserved separately from ordinary actor projections. */
export type QvmModObjectiveAddress = number | Extract<QvmModInputPointer, { readonly kind: "global" }>;

export interface QvmModClients {
  readonly outputs?: readonly ModClientOutputDeclaration<QvmModProtectionScalar, { readonly record: string; readonly offset: number }>[];
  readonly maximum: number;
  readonly records: readonly string[];
  readonly playerStateRecord: string;
  readonly admit: readonly QvmModSourceCall[];
  readonly userinfo: readonly QvmModSourceCall[];
  readonly disconnect: readonly QvmModSourceCall[];
  readonly frame?: readonly QvmModSourceCall[];
  readonly input?: readonly ModClientInputBinding<QvmModSourceCall, QvmModInputOutput>[];
}

/** Addresses are resolved only while the declared original source frame is live. */
export type QvmModInputPointer = ({ readonly kind: "argument"; readonly index: number }
  | { readonly kind: "global"; readonly address: number }) & {
    readonly indirections: readonly number[];
    readonly offset: number;
  };
interface QvmModInputHandler {
  readonly entry: number;
  readonly actor: { readonly record: string; readonly pointer: QvmModInputPointer };
}
export type QvmModInputOutput =
  | { readonly kind: "field"; readonly record: string; readonly offset: number;
      readonly value: { readonly input: "view-angles" } | {
        readonly input: Exclude<ModClientInput, "view-angles">; readonly encoding: QvmModScalar; readonly scale: number;
      } }
  | (QvmModInputHandler & { readonly kind: "handler"; readonly inputs: readonly Exclude<ModClientInput, "view-angles">[];
      readonly returns?: { readonly encoding: QvmModScalar; readonly value: number } })
  | (QvmModInputHandler & { readonly kind: "command"; readonly command: QvmModInputPointer;
      readonly inputs: readonly Exclude<ModClientInput, "impulse">[] });
