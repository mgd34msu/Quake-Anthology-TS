import type { ContentDigest } from "./content.ts";
import type { ActorId } from "./identity.ts";
import type { ItemId } from "./gameplay.ts";
import type { Vec3 } from "./math.ts";

export type ModCallbackInput = "self" | "other" | "activator" | "attacker" | "inflictor" | "amount" | "knockback" | "point" | "direction" | "normal" | "item" | "time" | "elapsed" | "result";
export type ModCallbackValue = { readonly kind: "input"; readonly name: ModCallbackInput }
  | { readonly kind: "float"; readonly value: number } | { readonly kind: "string"; readonly value: string } | { readonly kind: "vector"; readonly value: Vec3 };
export type ModActorField = { readonly field: string } & (
  | { readonly binding: "health" | "origin" | "velocity" | "angles" | "bounds-min" | "bounds-max" | "think" | "nextthink" | "private" | "classname" | "client-flags" | "view-offset" }
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

export interface ModCallbackDeclaration {
  readonly version: 1;
  readonly runtime: "quakec";
  readonly program: { readonly path: string; readonly digest: ContentDigest };
  readonly actorFields: readonly ModActorField[];
  readonly callbacks: readonly ModCallback[];
  readonly cvars?: readonly { readonly name: string; readonly value: string }[];
  readonly initialize?: readonly ModSourceCall[];
  readonly frame?: ModSourceCall;
  /** Explicit console names and argument lowering into original compiled functions. */
  readonly commands?: readonly ModConsoleCommand[];
  /** Declared lowering of canonical damage into the artifact's verified T_Damage ABI. */
  readonly combat?: { readonly damage: ModSourceCall };
}
