import type { ItemId } from "./gameplay.ts";
import type { ActorId, OwnedActor } from "./identity.ts";

export interface PickupAmmoGrant { readonly item: ItemId; readonly amount: number; }
export type PickupSelection = "never" | "always" | "better";
export interface AmmoWeaponSelection { readonly mode: PickupSelection; readonly when: "always" | "empty-ammo"; }

/** Source touch callbacks retain targets, placement, retention, and respawn. */
export interface PickupAdmission {
  owns(actor: ActorId, sourceWeapon: ItemId): boolean;
  ammo(actor: OwnedActor, offer: PickupAmmoGrant): boolean;
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
