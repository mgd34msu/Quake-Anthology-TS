import type { InventoryTable, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { AmmoWeaponSelection, PickupAdmission, PickupAmmoGrant, PickupAmmoReceipt, PickupSelection, PickupSupplyProfile } from "../../contracts/pickups.ts";

export interface SharedPickupAdmissionOptions {
  readonly inventory: InventoryTable;
  readonly profile: PickupSupplyProfile;
  ammoGranted(actor: OwnedActor, grants: readonly PickupAmmoReceipt[]): undefined;
  weaponGranted(actor: OwnedActor, weapons: readonly ItemId[], selection: PickupSelection): undefined;
}

/** Exact authored IDs resolve before any mutation; unrelated inventory never aliases. */
export class SharedPickupAdmission implements PickupAdmission {
  constructor(private readonly options: SharedPickupAdmissionOptions) {
    for (const mappings of [options.profile.ammo, options.profile.weapons]) {
      const sources = new Set<ItemId>();
      for (const mapping of mappings) {
        if (sources.has(mapping.source)) throw new Error(`Duplicate pickup mapping for ${mapping.source}`);
        sources.add(mapping.source);
        if (new Set(mapping.destinations).size !== mapping.destinations.length) throw new Error(`Duplicate pickup destination for ${mapping.source}`);
      }
    }
  }

  private destinations(kind: "ammo" | "weapons", item: ItemId): readonly ItemId[] {
    const mapping = this.options.profile[kind].find(entry => entry.source === item);
    if (mapping === undefined) throw new Error(`Pickup supply ${this.options.profile.id} has no ${kind} mapping for ${item}`);
    return mapping.destinations;
  }

  private requireEntries(actor: ActorId, items: readonly ItemId[]): undefined {
    const inventory = this.options.inventory.entries(actor);
    for (const item of items) if (!inventory.some(entry => entry.item === item)) throw new Error(`Pickup destination ${item} was not admitted`);
    return undefined;
  }

  owns(actor: ActorId, sourceWeapon: ItemId): boolean {
    // The profile declares ownership of the complete destination grant.
    return this.destinations("weapons", sourceWeapon).every(item => this.options.inventory.count(actor, item) > 0);
  }

  private resolveAmmo(offers: readonly PickupAmmoGrant[]): readonly PickupAmmoGrant[] {
    return offers.flatMap(offer => {
      if (!Number.isFinite(offer.amount) || offer.amount < 0) throw new RangeError("Pickup amount must be finite and nonnegative");
      return this.destinations("ammo", offer.item).map(item => ({ item, amount: offer.amount }));
    });
  }

  private giveAmmo(actor: OwnedActor, grants: readonly PickupAmmoGrant[]): readonly PickupAmmoReceipt[] {
    return grants.map(grant => ({ item: grant.item, before: this.options.inventory.count(actor.id, grant.item),
      given: this.options.inventory.give(actor, grant.item, grant.amount) }));
  }

  ammo(actor: OwnedActor, offer: PickupAmmoGrant): boolean {
    const grants = this.resolveAmmo([offer]);
    this.requireEntries(actor.id, grants.map(grant => grant.item));
    const receipt = this.giveAmmo(actor, grants);
    if (!receipt.some(grant => grant.given > 0)) return false;
    this.options.ammoGranted(actor, receipt);
    return true;
  }

  ammoWeapon(actor: OwnedActor, offer: PickupAmmoGrant & { readonly weapon: ItemId }, selection: AmmoWeaponSelection): boolean {
    const weapons = this.destinations("weapons", offer.weapon), ammo = this.resolveAmmo([offer]);
    this.requireEntries(actor.id, [...weapons, ...ammo.map(grant => grant.item)]);
    const receipt = this.giveAmmo(actor, ammo);
    if (!receipt.some(grant => grant.given > 0)) return false;
    for (const weapon of weapons) this.options.inventory.give(actor, weapon, 1);
    const select = selection.when === "always" || receipt.some(grant => grant.before === 0 && grant.given > 0);
    this.options.weaponGranted(actor, weapons, select ? selection.mode : "never");
    return true;
  }

  weapon(actor: OwnedActor, offer: { readonly item: ItemId; readonly ammo: readonly PickupAmmoGrant[] }, selection: PickupSelection): boolean {
    const weapons = this.destinations("weapons", offer.item), ammo = this.resolveAmmo(offer.ammo);
    this.requireEntries(actor.id, [...weapons, ...ammo.map(grant => grant.item)]);
    for (const weapon of weapons) this.options.inventory.give(actor, weapon, 1);
    this.giveAmmo(actor, ammo);
    this.options.weaponGranted(actor, weapons, selection);
    return true;
  }
}
