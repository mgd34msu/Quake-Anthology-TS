import type { ItemId } from "./gameplay.ts";
import type { PickupResource } from "./original-pickups.ts";

export type QcPickupScalar = { readonly kind: "field"; readonly name: string } | { readonly kind: "global"; readonly word: number };
interface QcPickupItem {
  readonly item: ItemId;
  readonly resource: PickupResource | null;
  readonly count?: QcPickupScalar;
}
export interface QcPickupCallerDeclaration {
  readonly function: string;
  readonly descriptor: ({ readonly kind: "constant" } & QcPickupItem)
    | { readonly kind: "string"; readonly field: string; readonly values: readonly (QcPickupItem & { readonly value: string })[] }
    | { readonly kind: "float"; readonly field: string; readonly values: readonly (QcPickupItem & { readonly value: number })[] };
  readonly dropped?: QcPickupScalar;
  readonly regions: readonly {
    readonly entry: number;
    readonly exit: number;
    readonly statements: readonly { readonly opcode: number; readonly a: number; readonly b: number; readonly c: number }[];
    readonly operation: { readonly kind: "decision"; readonly word: number; readonly accepted: number }
      | { readonly kind: "admission" | "grant" | "consume" };
  }[];
}
