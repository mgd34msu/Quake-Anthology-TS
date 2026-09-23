import type { ProviderReference, ResolvedResourceReference } from "./content.ts";
import type { InventoryEntry, ItemId } from "./gameplay.ts";
import type { ActorId, OwnedActor, ProviderId } from "./identity.ts";

export type SourceItemDefinition = { readonly item: ItemId; readonly label: string; readonly source: ProviderReference } & (
  | { readonly kind: "counter" }
  | { readonly kind: "weapon"; readonly ammo: ItemId | null }
);
export interface SourceItemAdmission { readonly definition: SourceItemDefinition; readonly admission: "add" | "replace-primary"; }
export interface SourceItemStore { readonly before: InventoryEntry; readonly after: InventoryEntry; }
export interface SourceItemLease { current(): boolean; stored(changes: readonly SourceItemStore[]): undefined; close(): undefined; }
export interface WeaponReference { readonly provider: ProviderId; readonly item: ItemId; }

/** Source traversal retains animation, deadlines, ammunition and committed attacks. */
export interface SourceWeaponHandoff {
  readonly provider: ProviderId;
  accepts(item: ItemId): boolean;
  select(item: ItemId): boolean;
  holster(): void;
  isHolstered(): boolean;
  resume(item: ItemId | null): boolean;
}
export interface SourceWeaponPresentation {
  readonly source: ProviderReference;
  readonly active: ItemId | null;
  readonly pending: ItemId | null;
  readonly model: { readonly resource: ResolvedResourceReference; readonly frame: number } | null;
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
  request(actor: ActorId, weapon: WeaponReference): boolean;
}
