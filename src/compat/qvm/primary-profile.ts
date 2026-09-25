import type { ResolvedResourceReference } from "../../contracts/content.ts";
import type { Q3GuestWeapon } from "../../content/q3/guest-items.ts";
import { q3PrimaryWeaponProfile } from "../../content/q3/equipment/weapon-profile.ts";
import { q3NativeInventoryProfile } from "../../content/q3/equipment/inventory-profile.ts";
import { q3NativePickupProfile } from "../../content/q3/equipment/pickup-profile.ts";
import { q3NativeCombatProfile } from "../../content/q3/equipment/combat-profile.ts";
import { q3InputProfile } from "../../content/q3/input-profile.ts";
import type { QvmPrimaryWeaponProfile } from "./game-weapons.ts";
import type { QvmPrimaryCombatProfile } from "./game-combat-binding.ts";
import type { QvmInventoryProfile } from "./game-inventory.ts";
import type { QvmPickupProfile } from "./game-pickups.ts";
import type { QvmInputDefinition } from "./game-input.ts";
import type { QvmModuleOptions } from "./module.ts";
import type { QvmItemLayout } from "./item-catalog.ts";
import type { SaveReader } from "../../persistence/value.ts";
import { readQvmPrimaryInput, readQvmPrimaryWeapons, readQvmPrimaryCombat } from "./primary-player-profile.ts";
import { readQvmPrimaryInventoryProfile } from "./primary-inventory-profile.ts";
import { readQvmPrimaryPickupProfile } from "./primary-pickup-profile.ts";
import { isDeepStrictEqual } from "node:util";

export interface QvmPrimaryProfile {
  readonly declaration: ResolvedResourceReference | null;
  readonly input: QvmInputDefinition | null;
  readonly weapons: QvmPrimaryWeaponProfile | null;
  readonly inventory: QvmInventoryProfile | null;
  readonly pickups: QvmPickupProfile | null;
  readonly combat: QvmPrimaryCombatProfile | null;
}

export function builtinQvmPrimaryProfile(artifact: QvmModuleOptions["artifact"], catalog: readonly Q3GuestWeapon[]): QvmPrimaryProfile {
  return { declaration: null, input: q3InputProfile(artifact), weapons: q3PrimaryWeaponProfile(artifact, catalog),
    inventory: q3NativeInventoryProfile(artifact), pickups: q3NativePickupProfile(artifact), combat: q3NativeCombatProfile(artifact) };
}

/** An external primary is admitted as a complete original-source interface, never piecemeal. */
export function readQvmPrimaryProfile(reader: SaveReader, artifact: QvmModuleOptions["artifact"], catalog: readonly Q3GuestWeapon[] | null,
  items: QvmItemLayout, declaration: ResolvedResourceReference): QvmPrimaryProfile {
  const input = readQvmPrimaryInput(reader.field("input"), artifact), weapons = readQvmPrimaryWeapons(reader.field("weapons"), artifact, catalog);
  const inventory = readQvmPrimaryInventoryProfile(reader.field("inventory"), artifact, weapons), pickups = readQvmPrimaryPickupProfile(reader.field("pickups"), artifact);
  const combat = readQvmPrimaryCombat(reader.field("combat"), artifact);
  if (input.entityStride !== weapons.entityStride || input.clientStride !== weapons.clientStride || input.clientPointer !== weapons.clientPointer
    || input.entityStride !== pickups.entityStride || input.clientStride !== pickups.clientStride || input.clientPointer !== pickups.fields.client
    || input.entityStride !== combat.entityStride || input.clientStride !== combat.clientStride || input.clientPointer !== combat.fields.client
    || input.entries.move !== weapons.equipmentMovement.move || input.entries.slice !== weapons.equipmentMovement.slice)
    return reader.fail("primary interfaces disagree about their original player records or movement entries");
  if (!isDeepStrictEqual(items, pickups.items)) return reader.field("items").fail("primary catalog and pickup interfaces name different item tables");
  if ("storage" in inventory) {
    const stored = new Set(inventory.storage.flatMap(value => value.kind === "counter" ? [value.item] : value.items.map(item => item.item)));
    if (weapons.stage.selection.values.some(value => !stored.has(value.item))) return reader.field("inventory").fail("original weapon selection lacks private inventory storage");
    if (weapons.drop.ammo !== "inventory" || pickups.grants.some(grant => grant.operation.kind === "region" && grant.operation.weapon !== undefined && grant.operation.weapon.storage !== "inventory"))
      return reader.field("inventory").fail("private inventory requires original pickup/drop projection through its declared storage");
  } else if (weapons.stage.selection.values.some(value => value.value > 15)) return reader.field("inventory").fail("original weapon selection exceeds public inventory storage");
  return { declaration, input, weapons, inventory, pickups, combat };
}
