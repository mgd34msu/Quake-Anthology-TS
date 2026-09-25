import type { QcWeaponStageDeclaration } from "./qc-weapon-stage.ts";
import type { SourceItemIconDeclaration } from "./source-items.ts";
import type { SourceItemActionCalls, SourceWeaponItem } from "./source-items.ts";
import type { ContentDigest } from "./content.ts";
import type { ActorId, ProviderId } from "./identity.ts";
import type { ItemId } from "./gameplay.ts";
import type { Vec3 } from "./math.ts";
import type { ModPickupRule } from "./original-pickups.ts";
import type { QcModClientPresentation } from "./mod-client-presentation.ts";

export interface ModQcEmptyArmor { readonly item: "q1:item_armor1" | "q1:item_armor2" | "q1:item_armorInv"; readonly absorption: number; }

export type ModClientInput = "view-angles" | "attack" | "jump" | "impulse" | "forward-move" | "side-move" | "up-move";
export type ModClientInputOutput =
  | { readonly kind: "set"; readonly input: "view-angles"; readonly value: Vec3 }
  | { readonly kind: "set"; readonly input: Exclude<ModClientInput, "view-angles">; readonly value: number }
  | { readonly kind: "consume"; readonly inputs: readonly Exclude<ModClientInput, "view-angles">[] };
export type ModCallbackInput = ModClientInput | "self" | "other" | "activator" | "attacker" | "inflictor" | "amount" | "damage-flags" | "regular-protection-scale" | "knockback" | "point" | "direction" | "normal" | "item" | "time" | "elapsed" | "result" | "pickup-count" | "pickup-has-count" | "pickup-dropped";
export type ModCallbackValue = { readonly kind: "input"; readonly name: ModCallbackInput }
  | { readonly kind: "float"; readonly value: number } | { readonly kind: "string"; readonly value: string } | { readonly kind: "vector"; readonly value: Vec3 };
export type ModActorField = { readonly field: string } & (
  | { readonly binding: "health" | "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" | "think" | "nextthink" | "private" | "classname" | "view-offset" }
  | { readonly binding: "client-flags"; readonly grounded?: true; readonly privateMask?: number }
  | { readonly binding: "client-input"; readonly input: ModClientInput; readonly update: "always" | "nonzero"; readonly scale?: number }
  | { readonly binding: "userinfo"; readonly key: string }
  | { readonly binding: "inventory"; readonly item: ItemId }
  | { readonly binding: "constant"; readonly value: Exclude<ModCallbackValue, { readonly kind: "input" }> }
);
export type ModActorOperation = "actor.think" | "actor.touch" | "actor.use" | "actor.pain" | "actor.die";
export type ModCallbackOperation = ModActorOperation | "damage" | "inventory.give" | "inventory.consume";
export interface ModSourceCall {
  readonly function: string;
  readonly arguments: readonly ModCallbackValue[];
  readonly globals: readonly { readonly name: string; readonly value: ModCallbackValue }[];
}
export type ModCallbackBinding = { readonly id: `${string}:${string}` } & (
  | { readonly operation: ModCallbackOperation; readonly stage: "observe" }
  | { readonly operation: "damage"; readonly stage: "transform"; readonly result: "amount" | "knockback" }
  | { readonly operation: "inventory.give" | "inventory.consume"; readonly stage: "transform"; readonly result: "amount" }
  | { readonly operation: ModActorOperation; readonly stage: "replace"; readonly result: "boolean" }
);
export type ModCallback = ModSourceCall & ModCallbackBinding;
export type ModClientInputBinding<Call, Output = never> = {
  readonly scope: "client-command" | "movement-slice";
  readonly calls: readonly Call[];
} & ({ readonly phase: "before"; readonly outputs?: readonly Output[] } | { readonly phase: "after" });
export type ModQcInputOutput =
  | { readonly kind: "field"; readonly field: string }
  | { readonly kind: "handler"; readonly function: string; readonly inputs: readonly Exclude<ModClientInput, "view-angles">[] };
export type ModRuntimeValue = Exclude<ModCallbackValue, { readonly kind: "input" }> | { readonly kind: "actor"; readonly value: ActorId | null };

export type ModConsoleValue = Exclude<ModCallbackValue, { readonly kind: "input" }>
  | { readonly kind: "argument"; readonly index: number; readonly type: "string" | "float" }
  | { readonly kind: "arguments-text" | "argument-count" };
export interface ModConsoleCommand {
  readonly name: string;
  readonly function: string;
  readonly arguments: readonly ModConsoleValue[];
  readonly globals: readonly { readonly name: string; readonly value: ModConsoleValue }[];
}

export interface ModQcDamageScale {
  readonly function: string;
  readonly entry: number;
  readonly exit: number;
  readonly damage: number;
  readonly statements: readonly { readonly opcode: number; readonly a: number; readonly b: number; readonly c: number }[];
}

export interface ModQcArmorStage {
  readonly function: string;
  readonly entry: number;
  readonly exit: number;
  readonly target: number;
  readonly damage: number;
  readonly saved: number;
  /** Original callers may temporarily scale their own armor before entering damage. */
  readonly regularScale?: readonly { readonly caller: string; readonly statement: number; readonly scale: number }[];
  readonly flags: { readonly kind: "none" } | { readonly kind: "bits"; readonly word: number;
    readonly noArmor: number; readonly noPowerArmor: number; readonly noRegularArmor: number; readonly energy: number };
  /** Exact source instructions, including the join, qualified by the declaring artifact. */
  readonly statements: readonly { readonly opcode: number; readonly a: number; readonly b: number; readonly c: number }[];
}

export type ModQcProtection = {
  readonly id: string;
  readonly admission?: { readonly kind: "claim" | "replace-current-primary" } | { readonly kind: "replace-primary"; readonly owner: ProviderId };
  readonly absorb: { readonly kind: "function"; readonly call: ModSourceCall }
    | { readonly kind: "region"; readonly call: ModSourceCall; readonly stage: ModQcArmorStage };
  readonly flags: { readonly noArmor: number; readonly noPowerArmor: number; readonly noRegularArmor: number; readonly energy: number; readonly radius: number };
} & (
  | { readonly channel: "regular"; readonly storage: { readonly points: string; readonly item: ItemId | null;
      readonly selection?: { readonly field: string; readonly mask?: number; readonly values: readonly { readonly value: number; readonly item: ItemId | null }[] } } }
  | { readonly channel: "powered"; readonly storage: { readonly cells: string; readonly kind: "screen" | "shield";
      readonly selection?: { readonly field: string; readonly mask?: number; readonly values: readonly { readonly value: number; readonly kind: "none" | "screen" | "shield" }[] } } }
);

export interface ModQcItems {
  readonly definitions: readonly ({ readonly item: ItemId; readonly label: string; readonly icon?: SourceItemIconDeclaration | null; readonly admission: "add" | "replace-primary"; readonly actions?: SourceItemActionCalls<ModSourceCall> } & (
    { readonly kind: "counter" } | SourceWeaponItem
  ))[];
  readonly storage: readonly (
    { readonly kind: "counter"; readonly field: string; readonly item: ItemId; readonly capacity: { readonly kind: "constant"; readonly value: number } | { readonly kind: "field"; readonly field: string } }
    | { readonly kind: "bits"; readonly field: string; readonly privateMask: number; readonly items: readonly { readonly item: ItemId; readonly mask: number }[] }
  )[];
  readonly weapons?: {
    readonly stage: QcWeaponStageDeclaration;
    readonly selected: { readonly field: string; readonly values: readonly { readonly value: number; readonly item: ItemId }[] };
    readonly select: { readonly field: string; readonly values: readonly { readonly value: number; readonly item: ItemId }[]; readonly call: ModSourceCall };
    readonly resume: readonly ModSourceCall[];
    readonly model: { readonly field: string; readonly frame: string };
  };
}

export interface ModCallbackDeclaration {
  readonly clientPresentation?: QcModClientPresentation;
  readonly version: 1;
  readonly runtime: "quakec";
  readonly program: { readonly path: string; readonly digest: ContentDigest };
  readonly actorFields: readonly ModActorField[];
  readonly callbacks: readonly ModCallback[];
  readonly clients?: { readonly maximum: number; readonly admit: readonly ModSourceCall[];
    readonly userinfo: readonly ModSourceCall[]; readonly disconnect: readonly ModSourceCall[];
    readonly frame?: readonly ModSourceCall[];
    readonly input?: readonly ModClientInputBinding<ModSourceCall, ModQcInputOutput>[] };
  readonly cvars?: readonly { readonly name: string; readonly value: string }[];
  readonly initialize?: readonly ModSourceCall[];
  readonly frame?: ModSourceCall;
  /** Explicit console names and argument lowering into original compiled functions. */
  readonly commands?: readonly ModConsoleCommand[];
  /** Declared lowering of canonical damage into the artifact's verified T_Damage ABI. */
  readonly combat?: { readonly damage: ModSourceCall; readonly damageScale?: ModQcDamageScale; readonly armorStage?: ModQcArmorStage; readonly emptyArmor?: ModQcEmptyArmor };
  /** Independent protection executes original source armor over its private client storage. */
  readonly protection?: readonly ModQcProtection[];
  readonly pickups?: readonly ModPickupRule<ModSourceCall>[];
  readonly items?: ModQcItems;
}
