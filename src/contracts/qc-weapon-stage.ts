import type { ModSourceCall } from "./mod-callbacks.ts";

export interface QcWeaponStageDeclaration {
  readonly dispatcher: string;
  readonly continuations: readonly string[];
  readonly repeats: readonly {
    readonly function: string;
    readonly entry: number;
    readonly exit: number;
    readonly result: { readonly word: number; readonly value: 0 | 1 };
    readonly statements: readonly { readonly opcode: number; readonly a: number; readonly b: number; readonly c: number }[];
  }[];
}
export interface QcPrimaryWeaponStageDeclaration extends QcWeaponStageDeclaration {
  readonly client: {
    readonly spawn: string | ModSourceCall;
    readonly selectSpawn: string | ModSourceCall;
    readonly objectives: { readonly kind: "none" } | { readonly kind: "call"; readonly function: string } | { readonly kind: "call"; readonly call: ModSourceCall };
  };
}
