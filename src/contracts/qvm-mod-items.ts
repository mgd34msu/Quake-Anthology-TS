import type { SourceItemIconDeclaration } from "./source-items.ts";
import type { SourceItemActionCalls, SourceWeaponItem } from "./source-items.ts";
import type { ItemId } from "./gameplay.ts";
import type { QvmModInputPointer, QvmModSourceCall } from "./qvm-mod-callbacks.ts";

export interface QvmItemField { readonly record: string; readonly offset: number; }
export interface QvmItemTest {
  readonly field: QvmItemField;
  readonly mask: number | null;
  readonly comparison: "equals" | "at-most";
  readonly value: number;
}
/** Constants are read from the declared executable, and selectors from its live globals. */
export type QvmItemCapacity =
  | { readonly kind: "constant"; readonly value: number }
  | { readonly kind: "field"; readonly field: QvmItemField }
  | { readonly kind: "source"; readonly instruction: number;
      readonly overrides: readonly { readonly address: number; readonly comparison: "equals" | "not-equals";
        readonly value: number; readonly instruction: number }[] };
export type QvmItemStorage =
  | { readonly kind: "counter"; readonly field: QvmItemField; readonly item: ItemId; readonly capacity: QvmItemCapacity }
  | { readonly kind: "bits"; readonly field: QvmItemField; readonly privateMask: number;
      readonly items: readonly { readonly item: ItemId; readonly mask: number }[] };
export interface QvmWeaponActor {
  readonly record: string;
  readonly pointer: QvmModInputPointer;
}
export interface QvmWeaponStage {
  readonly dispatcher: { readonly entry: number; readonly actor: QvmWeaponActor };
  /** Only these original conditional decisions are changed while another source owns new attacks. */
  readonly predicates: readonly { readonly instruction: number; readonly unselected: boolean }[];
  /** All tests describe the source's actual completed-action state. */
  readonly settled: readonly QvmItemTest[];
  readonly selection: { readonly field: QvmItemField; readonly values: readonly { readonly value: number; readonly item: ItemId }[] };
  readonly request: { readonly entry: number; readonly argument: number; readonly accepted: readonly QvmItemTest[] };
  /** Original setup reaches its own return edge; the live caller still owns pmove and its extensions. */
  readonly continuation: { readonly entry: number; readonly actor: QvmWeaponActor;
    readonly instruction: number; readonly originalTaken: boolean;
    readonly when: readonly QvmItemTest[];
    readonly predicates: readonly { readonly instruction: number; readonly unselected: boolean }[];
    readonly projection: { readonly movement: QvmModInputPointer; readonly byteLength: number; readonly minimum: number; readonly maximum: number;
      readonly viewHeight: QvmItemField; readonly ground: QvmItemField };
    readonly calls: readonly { readonly instruction: number; readonly call: QvmModSourceCall }[] };
}
export interface QvmModItems {
  readonly definitions: readonly ({ readonly item: ItemId; readonly label: string; readonly icon?: SourceItemIconDeclaration | null; readonly admission: "add" | "replace-primary"; readonly actions?: SourceItemActionCalls<QvmModSourceCall> } & (
    | { readonly kind: "counter" }
    | SourceWeaponItem
  ))[];
  readonly storage: readonly QvmItemStorage[];
  readonly weapons?: { readonly input: { readonly entry: number; readonly clock: QvmItemField }; readonly stage: QvmWeaponStage };
}
