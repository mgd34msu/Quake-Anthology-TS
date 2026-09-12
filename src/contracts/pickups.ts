import type { ItemId } from "./gameplay.ts";
import type { ActorId, OwnedActor } from "./identity.ts";

export interface PickupAmmoGrant { readonly item: ItemId; readonly amount: number; }
export type PickupSelection = "never" | "always" | "better";
export interface AmmoWeaponSelection { readonly mode: PickupSelection; readonly when: "always" | "empty-ammo"; }

export type PickupSupplyOffer =
  | { readonly kind: "ammo"; readonly offer: PickupAmmoGrant }
  | { readonly kind: "ammoWeapon"; readonly offer: PickupAmmoGrant & { readonly weapon: ItemId } }
  | { readonly kind: "weapon"; readonly offer: { readonly item: ItemId; readonly ammo: readonly PickupAmmoGrant[] } };

/** Supply acceptance only; source touch eligibility and lifecycle remain with the pickup owner. */
export interface PickupSupplyPreview {
  readonly accepted: boolean;
  readonly ammo: readonly PickupAmmoReceipt[];
  readonly weapons: readonly PickupAmmoReceipt[];
}

/** Source touch callbacks retain targets, placement, retention, and respawn. */
export interface PickupAdmission {
  preview(actor: ActorId, offer: PickupSupplyOffer): PickupSupplyPreview;
  owns(actor: ActorId, sourceWeapon: ItemId): boolean;
  ammo(actor: OwnedActor, offer: PickupAmmoGrant, autoSwitch?: boolean): boolean;
  ammoWeapon(actor: OwnedActor, offer: PickupAmmoGrant & { readonly weapon: ItemId }, selection: AmmoWeaponSelection): boolean;
  weapon(actor: OwnedActor, offer: { readonly item: ItemId; readonly ammo: readonly PickupAmmoGrant[] }, selection: PickupSelection): boolean;
}

export interface PickupSupplyProfile {
  readonly id: ItemId;
  readonly weaponOwnership: "all-destinations";
  readonly ammo: readonly { readonly source: ItemId; readonly destinations: readonly [ItemId, ...ItemId[]] }[];
  readonly weapons: readonly { readonly source: ItemId; readonly destinations: readonly [ItemId, ...ItemId[]] }[];
}

export interface PickupAmmoReceipt {
  readonly item: ItemId;
  readonly before: number;
  readonly given: number;
}
