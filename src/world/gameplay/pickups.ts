import { inventoryGive, type SharedInventoryTable } from "./inventory.ts";
import type { InventoryEntry, ItemId } from "../../contracts/gameplay.ts";
import type { ActorId, OwnedActor } from "../../contracts/identity.ts";
import type { AmmoWeaponSelection, SourcePickupQuantity, PickupAdmission, PickupAmmoGrant, PickupAmmoReceipt, PickupSelection, PickupSupplyOffer, PickupSupplyPreview, PickupSupplyProfile } from "../../contracts/pickups.ts";
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

type PickupQuantityResolver = (entry: InventoryEntry) => number | SourcePickupQuantity;

export interface SharedPickupAdmissionOptions {
  readonly inventory: Pick<SharedInventoryTable, "entries" | "count" | "consume" | "give" | "configure">;
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

  private resolveAmmo(offers: readonly PickupAmmoGrant[], sourceQuantity = false): readonly PickupAmmoGrant[] {
    return offers.flatMap(offer => {
      if (!Number.isFinite(offer.amount) || !sourceQuantity && offer.amount < 0) throw new RangeError("Pickup amount must be finite and nonnegative");
      return this.destinations("ammo", offer.item).map(item => ({ item, amount: offer.amount }));
    });
  }

  private quantities(actor: ActorId, grants: readonly PickupAmmoGrant[], resolve?: PickupQuantityResolver) {
    const exact = new Set<ItemId>(); let accepted: boolean | undefined;
    const ammo = grants.map(grant => {
      if (resolve === undefined) return grant;
      const entry = this.options.inventory.entries(actor).find(entry => entry.item === grant.item);
      if (entry === undefined) throw new Error("Source quantity requires an admitted destination pool");
      const quantity = resolve(entry), amount = typeof quantity === "number" ? quantity : quantity.amount;
      if (!Number.isFinite(amount) || typeof quantity === "number" && amount < 0) throw new RangeError("Original pickup quantity is invalid");
      if (typeof quantity !== "number") { exact.add(grant.item); accepted = (accepted ?? false) || quantity.accepted; }
      return { item: grant.item, amount };
    });
    return { ammo, exact, accepted };
  }

  private giveAmmo(actor: OwnedActor, grants: readonly PickupAmmoGrant[], exact: ReadonlySet<ItemId> = new Set()): readonly PickupAmmoReceipt[] {
    return grants.map(grant => {
      const before = this.options.inventory.count(actor.id, grant.item);
      if (!exact.has(grant.item)) return { item: grant.item, before, given: this.options.inventory.give(actor, grant.item, grant.amount) };
      const entry = this.options.inventory.entries(actor.id).find(entry => entry.item === grant.item);
      if (entry === undefined) throw new Error("Original pickup lost its admitted destination");
      this.options.inventory.configure(actor, { ...entry, count: before + grant.amount });
      return { item: grant.item, before, given: this.options.inventory.count(actor.id, grant.item) - before };
    });
  }

  ammo(actor: OwnedActor, offer: PickupAmmoGrant, autoSwitch = true, quantity?: PickupQuantityResolver): boolean {
    return this.grantAmmo(actor, this.resolveAmmo([offer], quantity !== undefined), autoSwitch, quantity);
  }

  private grantAmmo(actor: OwnedActor, ammo: readonly PickupAmmoGrant[], autoSwitch: boolean, quantity?: PickupQuantityResolver): boolean {
    const grants = this.quantities(actor.id, ammo, quantity);
    this.requireEntries(actor.id, grants.ammo.map(grant => grant.item));
    const receipt = this.giveAmmo(actor, grants.ammo, grants.exact);
    if (!(grants.accepted ?? receipt.some(grant => grant.given > 0))) return false;
    this.options.ammoGranted(actor, receipt, autoSwitch);
    return true;
  }

  ammoWeapon(actor: OwnedActor, offer: PickupAmmoGrant & { readonly weapon: ItemId }, selection: AmmoWeaponSelection,
    quantity?: PickupQuantityResolver): boolean {
    return this.grantAmmoWeapon(actor, this.destinations("weapons", offer.weapon), this.resolveAmmo([offer], quantity !== undefined), selection, quantity);
  }

  private grantAmmoWeapon(actor: OwnedActor, weapons: readonly ItemId[], ammo: readonly PickupAmmoGrant[], selection: AmmoWeaponSelection,
    quantity?: PickupQuantityResolver): boolean {
    const grants = this.quantities(actor.id, ammo, quantity);
    this.requireEntries(actor.id, [...weapons, ...grants.ammo.map(grant => grant.item)]);
    const receipt = this.giveAmmo(actor, grants.ammo, grants.exact);
    if (!(grants.accepted ?? receipt.some(grant => grant.given > 0))) return false;
    for (const weapon of weapons) if (!grants.ammo.some(grant => grant.item === weapon)) this.options.inventory.give(actor, weapon, 1);
    const select = selection.when === "always" || receipt.some(grant => grant.before === 0 && grant.given > 0);
    this.options.weaponGranted(actor, weapons, select ? selection.mode : "never");
    return true;
  }

  weapon(actor: OwnedActor, offer: { readonly item: ItemId; readonly ammo: readonly PickupAmmoGrant[] }, selection: PickupSelection,
    quantity?: PickupQuantityResolver): boolean {
    return this.giveCargo(actor, [{ kind: "weapon", item: offer.item, count: 1 }, ...offer.ammo.map(entry => ({ kind: "counter", item: entry.item, count: entry.amount } satisfies PickupCargoEntry))], selection, quantity);
  }

  /** A reached source selection branch can select an already granted weapon without granting it again. */
  selectWeapon(actor: OwnedActor, item: ItemId, selection: PickupSelection): undefined {
    const weapons = this.destinations("weapons", item);
    this.requireEntries(actor.id, weapons);
    this.options.weaponGranted(actor, weapons, selection);
    return undefined;
  }

  cargo(actor: OwnedActor, cargo: readonly PickupCargoEntry[], selection: PickupSelection): boolean {
    return this.giveCargo(actor, cargo, selection);
  }

  /** A source drop retains the already selected item; it must not expand through source aliases again. */
  canonical(actor: OwnedActor, offer: PickupSupplyOffer, selection: PickupSelection, quantity?: PickupQuantityResolver): boolean {
    if (offer.kind === "ammo") return this.grantAmmo(actor, [offer.offer], true, quantity);
    if (offer.kind === "ammoWeapon") return this.grantAmmoWeapon(actor, [offer.offer.weapon], [offer.offer], { mode: selection, when: "empty-ammo" }, quantity);
    return this.giveResolvedCargo(actor, [offer.offer.item], offer.offer.ammo, selection, quantity);
  }

  private giveCargo(actor: OwnedActor, cargo: readonly PickupCargoEntry[], selection: PickupSelection, quantity?: PickupQuantityResolver): boolean {
    if (new Set(cargo.map(row => row.item)).size !== cargo.length || cargo.some(row => !Number.isFinite(row.count) || row.kind === "weapon" && row.count !== 1))
      throw new Error("Invalid pickup cargo");
    const weapons = [...new Set(cargo.filter(row => row.kind === "weapon").flatMap(row => this.destinations("weapons", row.item)))];
    const mappedAmmo = this.resolveAmmo(cargo.filter(row => row.kind === "counter").map(row => ({ item: row.item, amount: row.count })), quantity !== undefined);
    return this.giveResolvedCargo(actor, weapons, mappedAmmo, selection, quantity);
  }

  private giveResolvedCargo(actor: OwnedActor, weapons: readonly ItemId[], ammo: readonly PickupAmmoGrant[], selection: PickupSelection,
    quantity?: PickupQuantityResolver): boolean {
    this.requireEntries(actor.id, [...weapons, ...ammo.map(grant => grant.item)]);
    const grants = this.quantities(actor.id, ammo, quantity);
    for (const weapon of weapons) this.options.inventory.give(actor, weapon, 1);
    this.giveAmmo(actor, grants.ammo, grants.exact);
    if (weapons.length !== 0) this.options.weaponGranted(actor, weapons, selection);
    return true;
  }
}

type PickupWeapon = { readonly item: ItemId; readonly ammo: ItemId | null };
export type SelectedPickupWeapon = PickupWeapon & { readonly drop: "supply" | "none" };

/** Resolve declared supply relationships before admitting players; never choose an ambiguous alias by ordering. */
export function selectedWeaponSources(profile: PickupSupplyProfile, selected: readonly SelectedPickupWeapon[], original: readonly PickupWeapon[]): ReadonlyMap<ItemId, ItemId | null> {
  const result = new Map<ItemId, ItemId | null>(), owners = new Map<ItemId, ItemId>();
  for (const row of profile.weaponOwners ?? []) {
    if (owners.has(row.item) || !profile.weapons.some(mapping => mapping.source === row.source && mapping.destinations.includes(row.item)))
      throw new Error(`Selected weapon ${row.item} has an invalid or duplicate original owner in ${profile.id}`);
    owners.set(row.item, row.source);
  }
  for (const weapon of selected) {
    if (weapon.drop === "none") { result.set(weapon.item, null); continue; }
    if (original.some(source => source.item === weapon.item)) { result.set(weapon.item, weapon.item); continue; }
    const owner = owners.get(weapon.item);
    if (owner !== undefined) {
      if (!original.some(source => source.item === owner)) throw new Error(`Selected weapon ${weapon.item} names an unavailable original owner ${owner}`);
      result.set(weapon.item, owner); continue;
    }
    let candidates = original.filter(source => profile.weapons.some(row => row.source === source.item && row.destinations.includes(weapon.item)));
    if (candidates.length === 0 && weapon.ammo !== null) {
      const ammo = weapon.ammo;
      candidates = original.filter(source => profile.ammo.some(row => row.source === source.ammo && row.destinations.includes(ammo)));
    }
    if (candidates.length > 1 && weapon.ammo !== null) {
      const ammo = weapon.ammo, owner = profile.ammoOwners?.find(row => row.item === ammo)?.source;
      const canonical = original.filter(source => source.ammo === owner && profile.ammo.some(row => row.source === owner && row.destinations.includes(ammo)));
      if (canonical.length === 1) candidates = canonical;
    }
    const source = candidates.length === 1 ? candidates[0] : undefined;
    if (source === undefined) throw new Error(`Selected weapon ${weapon.item} has ${candidates.length === 0 ? "no" : "ambiguous"} original drop mapping in ${profile.id}${candidates.length === 0 ? "" : `: ${candidates.map(item => item.item).join(", ")}`}`);
    result.set(weapon.item, source.item);
  }
  return result;
}
