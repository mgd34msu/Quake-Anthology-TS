import { inventoryGive } from "./inventory.ts";
import type { InventoryEntry, InventoryTable, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { AmmoWeaponSelection, PickupAdmission, PickupAmmoGrant, PickupAmmoReceipt, PickupSelection, PickupSupplyOffer, PickupSupplyPreview, PickupSupplyProfile } from "../../contracts/pickups.ts";
import type { PickupCargoEntry } from "../../contracts/original-pickups.ts";

export type PickupGrantPlan =
  | { readonly kind: "weapon"; readonly weapons: readonly PickupAmmoGrant[]; readonly ammo: readonly PickupAmmoGrant[] }
  | { readonly kind: "ammo"; readonly acceptance: "positive" | "nonzero"; readonly ammo: readonly PickupAmmoGrant[]; readonly weapons:
      | { readonly kind: "grant"; readonly grants: readonly PickupAmmoGrant[] }
      | { readonly kind: "shared-ammo"; readonly items: readonly ItemId[] } };

/** A source-resolved grant plan; eligibility and missing-entry admission remain source-owned. */
export function previewPickupGrants(inventory: readonly InventoryEntry[], plan: PickupGrantPlan): PickupSupplyPreview {
  const weaponItems = plan.kind === "weapon" ? plan.weapons.map(grant => grant.item)
    : plan.weapons.kind === "grant" ? plan.weapons.grants.map(grant => grant.item) : plan.weapons.items;
  const entries = new Map(inventory.map(entry => [entry.item, entry]));
  for (const item of [...weaponItems, ...plan.ammo.map(grant => grant.item)]) {
    if (!entries.has(item)) throw new Error(`Pickup destination ${item} was not admitted`);
  }
  if (plan.kind === "ammo" && plan.weapons.kind === "shared-ammo") {
    for (const item of plan.weapons.items) if (!plan.ammo.some(grant => grant.item === item)) throw new Error(`Shared weapon ${item} has no ammo grant`);
  }
  const give = (grant: PickupAmmoGrant): PickupAmmoReceipt => {
    const entry = entries.get(grant.item);
    if (entry === undefined) throw new Error(`Pickup destination ${grant.item} was not admitted`);
    const transition = inventoryGive(entry, grant.amount);
    if (transition.kind === "write") entries.set(grant.item, transition.entry);
    return { item: grant.item, before: entry.count, given: transition.given };
  };
  if (plan.kind === "weapon") {
    const weapons = plan.weapons.map(give);
    return { accepted: true, weapons, ammo: plan.ammo.map(give) };
  }
  const ammo = plan.ammo.map(give), accepted = ammo.some(grant => plan.acceptance === "positive" ? grant.given > 0 : grant.given !== 0);
  const weapons = plan.weapons;
  return { accepted, ammo, weapons: !accepted ? [] : weapons.kind === "grant" ? weapons.grants.map(grant => ammo.find(receipt => receipt.item === grant.item) ?? give(grant))
    : ammo.filter(receipt => weapons.items.includes(receipt.item)) };
}

export interface SharedPickupAdmissionOptions {
  readonly inventory: InventoryTable;
  readonly profile: PickupSupplyProfile;
  ammoGranted(actor: OwnedActor, grants: readonly PickupAmmoReceipt[], autoSwitch: boolean): undefined;
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

  maps(kind: "ammo" | "weapons", item: ItemId): boolean { return this.options.profile[kind].some(mapping => mapping.source === item); }

  private destinations(kind: "ammo" | "weapons", item: ItemId): readonly ItemId[] {
    const mapping = this.options.profile[kind].find(entry => entry.source === item);
    if (mapping === undefined) throw new Error(`Pickup supply ${this.options.profile.id} has no ${kind} mapping for ${item}`);
    return mapping.destinations;
  }

  private requireEntries(actor: ActorId, items: readonly ItemId[]): readonly InventoryEntry[] {
    const inventory = this.options.inventory.entries(actor);
    for (const item of items) if (!inventory.some(entry => entry.item === item)) throw new Error(`Pickup destination ${item} was not admitted`);
    return inventory;
  }

  preview(actor: ActorId, offer: PickupSupplyOffer): PickupSupplyPreview {
    const weapons = offer.kind === "ammo" ? [] : this.destinations("weapons", offer.kind === "weapon" ? offer.offer.item : offer.offer.weapon);
    const ammo = this.resolveAmmo(offer.kind === "weapon" ? offer.offer.ammo : [offer.offer]);
    return previewPickupGrants(this.options.inventory.entries(actor), offer.kind === "weapon"
      ? { kind: "weapon", weapons: weapons.map(item => ({ item, amount: 1 })), ammo }
      : { kind: "ammo", acceptance: "positive", ammo, weapons: { kind: "grant", grants: weapons.map(item => ({ item, amount: 1 })) } });
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

  ammo(actor: OwnedActor, offer: PickupAmmoGrant, autoSwitch = true): boolean {
    const grants = this.resolveAmmo([offer]);
    this.requireEntries(actor.id, grants.map(grant => grant.item));
    const receipt = this.giveAmmo(actor, grants);
    if (!receipt.some(grant => grant.given > 0)) return false;
    this.options.ammoGranted(actor, receipt, autoSwitch);
    return true;
  }

  ammoWeapon(actor: OwnedActor, offer: PickupAmmoGrant & { readonly weapon: ItemId }, selection: AmmoWeaponSelection): boolean {
    const weapons = this.destinations("weapons", offer.weapon), ammo = this.resolveAmmo([offer]);
    this.requireEntries(actor.id, [...weapons, ...ammo.map(grant => grant.item)]);
    const receipt = this.giveAmmo(actor, ammo);
    if (!receipt.some(grant => grant.given > 0)) return false;
    for (const weapon of weapons) if (!ammo.some(grant => grant.item === weapon)) this.options.inventory.give(actor, weapon, 1);
    const select = selection.when === "always" || receipt.some(grant => grant.before === 0 && grant.given > 0);
    this.options.weaponGranted(actor, weapons, select ? selection.mode : "never");
    return true;
  }

  weapon(actor: OwnedActor, offer: { readonly item: ItemId; readonly ammo: readonly PickupAmmoGrant[] }, selection: PickupSelection): boolean {
    return this.cargo(actor, [{ kind: "weapon", item: offer.item, count: 1 }, ...offer.ammo.map(entry => ({ kind: "counter", item: entry.item, count: entry.amount } satisfies PickupCargoEntry))], selection);
  }

  /** A reached source selection branch can select an already granted weapon without granting it again. */
  selectWeapon(actor: OwnedActor, item: ItemId, selection: PickupSelection): undefined {
    const weapons = this.destinations("weapons", item);
    this.requireEntries(actor.id, weapons);
    this.options.weaponGranted(actor, weapons, selection);
    return undefined;
  }

  cargo(actor: OwnedActor, cargo: readonly PickupCargoEntry[], selection: PickupSelection): boolean {
    if (new Set(cargo.map(row => row.item)).size !== cargo.length || cargo.some(row => !Number.isFinite(row.count) || row.kind === "weapon" && row.count !== 1))
      throw new Error("Invalid pickup cargo");
    const weapons = [...new Set(cargo.filter(row => row.kind === "weapon").flatMap(row => this.destinations("weapons", row.item)))];
    const ammo = this.resolveAmmo(cargo.filter(row => row.kind === "counter").map(row => ({ item: row.item, amount: row.count })));
    this.requireEntries(actor.id, [...weapons, ...ammo.map(grant => grant.item)]);
    for (const weapon of weapons) this.options.inventory.give(actor, weapon, 1);
    this.giveAmmo(actor, ammo);
    if (weapons.length !== 0) this.options.weaponGranted(actor, weapons, selection);
    return true;
  }
}
