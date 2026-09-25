import type { WeaponHudIcon } from "./ui.ts";
import type { ProviderReference, ResolvedResourceReference } from "./content.ts";
import type { InventoryEntry, ItemId } from "./gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "./identity.ts";
import type { HeldWeaponDeclaration } from "./held-weapon.ts";

export interface SourceEquipmentContext { readonly provider: ProviderId; readonly item: ItemId | null; }

export function sourceEquipmentItem(contexts: readonly SourceEquipmentContext[], provider: ProviderId): ItemId | null {
  const matches = contexts.filter(context => context.provider === provider), context = matches[0];
  if (context === undefined) throw new Error(`Equipment ${provider} has no declared original cadence context`);
  if (matches.length !== 1) throw new Error(`Equipment ${provider} has duplicate original cadence contexts`);
  return context.item;
}

export type SourceItemAction = "use" | "drop";
export interface SourceItemActionCalls<Call> { readonly use?: Call; readonly drop?: Call; }
export function sourceItemActionNames<Call>(calls: SourceItemActionCalls<Call>): readonly SourceItemAction[] {
  const names: SourceItemAction[] = [];
  if (calls.use !== undefined) names.push("use");
  if (calls.drop !== undefined) names.push("drop");
  return names;
}

/** Exact canonical IDs take precedence over display names shared by composed sources. */
export function sourceItemNamed<Item extends { readonly item: ItemId; readonly label: string }>(items: readonly Item[], text: string, original: ItemId | null = null):
  { readonly kind: "match"; readonly item: Item; readonly exact: boolean } | { readonly kind: "ambiguous"; readonly items: readonly Item[] } | null {
  const requested = text.toLowerCase().replaceAll(" ", "");
  const exact = items.find(item => item.item.toLowerCase() === requested);
  if (exact !== undefined) return { kind: "match", item: exact, exact: true };
  const primary = original === null ? undefined : items.find(item => item.item === original);
  if (primary !== undefined) return { kind: "match", item: primary, exact: false };
  const matches = items.filter(item => item.label.toLowerCase().replaceAll(" ", "") === requested);
  const item = matches[0];
  return matches.length > 1 ? { kind: "ambiguous", items: matches } : item === undefined ? null : { kind: "match", item, exact: false };
}
export type SourceItemIconDeclaration =
  | { readonly kind: "image"; readonly path: string }
  | { readonly kind: "wad-picture"; readonly path: string; readonly lump: string }
  | { readonly kind: "shader"; readonly name: string };

export interface SourceWeaponItem { readonly kind: "weapon"; readonly ammo: ItemId | null; readonly held?: HeldWeaponDeclaration; }

export type SourceItemDefinition = { readonly item: ItemId; readonly label: string; readonly source: ProviderReference; readonly icon?: WeaponHudIcon | null; readonly actions?: readonly SourceItemAction[] } & (
  | { readonly kind: "counter" }
  | SourceWeaponItem
);
export interface SourceItemAdmission { readonly definition: SourceItemDefinition; readonly admission: "add" | "replace-primary"; }
export interface SourceItemStore { readonly before: InventoryEntry; readonly after: InventoryEntry; }
export interface SourceItemLease { current(): boolean; stored(changes: readonly SourceItemStore[]): undefined; close(): undefined; }
/** Identifies only retirement of the exact source lease delivering a committed store. */
export class SourceItemRetired extends Error {
  constructor(readonly lease: SourceItemLease, readonly actor: OwnedActor, readonly owner: ProviderId) {
    super("Committed inventory source is no longer current");
  }
}
export interface WeaponReference { readonly provider: ProviderId; readonly item: ItemId; }

/** Source traversal retains animation, deadlines, ammunition and committed attacks. */
interface SourceWeaponHandoffBase {
  readonly provider: ProviderId;
  accepts(item: ItemId): boolean;
  select(item: ItemId): boolean;
  holster(): void;
  isHolstered(): boolean;
}
export interface SourceWeaponRequest {
  readonly id: number;
  status(): "pending" | "accepted" | "refused";
  cancel(): void;
}
export type SourceWeaponHandoff = SourceWeaponHandoffBase & (
  | { readonly kind: "immediate"; resume(item: ItemId | null): boolean }
  | { readonly kind: "source-input"; resume(item: ItemId | null): SourceWeaponRequest;
      restoreRequest(id: number, item: ItemId | null): SourceWeaponRequest }
);
export interface SourceWeaponPresentation {
  readonly source: ProviderReference;
  readonly active: ItemId | null;
  readonly pending: ItemId | null;
  readonly model: ({ readonly kind: "resolved"; readonly resource: ResolvedResourceReference } | { readonly kind: "source-path"; readonly path: string }) & { readonly frame: number } | null;
  readonly items: readonly SourceItemDefinition[];
}
export interface SourceWeaponBinding {
  readonly handoff: SourceWeaponHandoff;
  current(): boolean;
  read(): SourceWeaponPresentation;
}
/** Implemented by the actor's existing weapon slot, with no independent selection state. */
export interface SourceWeaponServices {
  bind(actor: OwnedActor, binding: SourceWeaponBinding): () => undefined;
  selected(actor: ActorId, provider: ProviderId): boolean;
  presented(actor: ActorId, provider: ProviderId): boolean;
  request(actor: ActorId, weapon: WeaponReference): boolean;
}
