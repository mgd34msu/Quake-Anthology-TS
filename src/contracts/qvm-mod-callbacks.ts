import type { ContentDigest } from "./content.ts";
import type { QvmAbiProfile } from "./execution.ts";
import type { ItemId } from "./gameplay.ts";
import type { ProviderId } from "./identity.ts";
import type { Vec3 } from "./math.ts";
import type { ModCallbackBinding, ModCallbackValue, ModClientInputBinding } from "./mod-callbacks.ts";

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
export type QvmModCallback = ModCallbackBinding & QvmModSourceCall;
export type QvmModActorField = { readonly offset: number } & (
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
  /** gentity_t function-pointer fields; null means this source has no such callback. */
  readonly callbacks?: { readonly touch: number | null; readonly use: number | null; readonly pain: number | null; readonly die: number | null };
}
/** Private layout and entry are admitted by the enclosing executable digest. */
export interface QvmModCombat {
  readonly abi: "q3-g-damage";
  readonly entry: number;
  readonly health: number;
  readonly takedamage: number;
  readonly flags: number;
  readonly godmode: number;
  readonly noKnockback: number;
  readonly globals: QvmModSourceCall["globals"];
  readonly client: { readonly pointer: number; readonly record: string; readonly health: number; readonly armor: number; readonly protection: number; readonly team: number } | null;
}
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
  readonly version: 1;
  readonly runtime: "qvm";
  readonly program: { readonly path: string; readonly digest: ContentDigest };
  readonly abiProfile: QvmAbiProfile;
  /** Explicit component additions, consumed only by declared source calls; absent/null is an empty stream. */
  readonly spawnEntities?: string | null;
  readonly clients?: QvmModClients;
  readonly actorRecords: readonly QvmModActorRecord[];
  readonly entityRecord: string | null;
  readonly sourceActors?: QvmModSourceActors;
  readonly combat?: QvmModCombat;
  readonly protection?: readonly QvmModProtection[];
  readonly initialize: readonly QvmModSourceCall[];
  readonly callbacks: readonly QvmModCallback[];
}

/** Source client rows are reserved separately from ordinary actor projections. */
export interface QvmModClients {
  readonly maximum: number;
  readonly records: readonly string[];
  readonly playerStateRecord: string;
  readonly admit: readonly QvmModSourceCall[];
  readonly userinfo: readonly QvmModSourceCall[];
  readonly disconnect: readonly QvmModSourceCall[];
  readonly input?: readonly ModClientInputBinding<QvmModSourceCall>[];
}
