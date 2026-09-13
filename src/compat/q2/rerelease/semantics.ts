// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../../contracts/execution.ts";
import type { RereleaseGuestModule } from "./module.ts";
import { guestPointer } from "./module.ts";
import { retailRereleaseClientProfile } from "./client-profile.ts";
import type { RereleaseInventoryItem } from "./source-state.ts";

// g_items.cpp itemlist classnames; disabled beta disintegrator is not an item.
const classnames: readonly string[] = [
  "item_armor_body",
  "item_armor_combat",
  "item_armor_jacket",
  "item_armor_shard",
  "item_power_screen",
  "item_power_shield",
  "weapon_grapple",
  "weapon_blaster",
  "weapon_chainfist",
  "weapon_shotgun",
  "weapon_supershotgun",
  "weapon_machinegun",
  "weapon_etf_rifle",
  "weapon_chaingun",
  "ammo_grenades",
  "ammo_trap",
  "ammo_tesla",
  "weapon_grenadelauncher",
  "weapon_proxlauncher",
  "weapon_rocketlauncher",
  "weapon_hyperblaster",
  "weapon_boomer",
  "weapon_plasmabeam",
  "weapon_railgun",
  "weapon_phalanx",
  "weapon_bfg",
  "weapon_disintegrator",
  "ammo_shells",
  "ammo_bullets",
  "ammo_cells",
  "ammo_rockets",
  "ammo_slugs",
  "ammo_magslug",
  "ammo_flechettes",
  "ammo_prox",
  "ammo_nuke",
  "ammo_disruptor",
  "item_quad",
  "item_quadfire",
  "item_invulnerability",
  "item_invisibility",
  "item_silencer",
  "item_breather",
  "item_enviro",
  "item_ancient_head",
  "item_legacy_head",
  "item_adrenaline",
  "item_bandolier",
  "item_pack",
  "item_ir_goggles",
  "item_double",
  "item_sphere_vengeance",
  "item_sphere_hunter",
  "item_sphere_defender",
  "item_doppleganger",
  "key_data_cd",
  "key_power_cube",
  "key_explosive_charges",
  "key_yellow_key",
  "key_power_core",
  "key_pyramid",
  "key_data_spinner",
  "key_pass",
  "key_blue_key",
  "key_red_key",
  "key_green_key",
  "key_commander_head",
  "key_airstrike_target",
  "key_nuke_container",
  "key_nuke",
  "item_health_small",
  "item_health",
  "item_health_large",
  "item_health_mega",
  "item_flag_team1",
  "item_flag_team2",
  "item_tech1",
  "item_tech2",
  "item_tech3",
  "item_tech4",
  "item_flashlight",
  "item_compass",
];
const ammoSlots: ReadonlyMap<string, number> = new Map([
  ["ammo_bullets", 0], ["ammo_shells", 1], ["ammo_rockets", 2], ["ammo_grenades", 3],
  ["ammo_cells", 4], ["ammo_slugs", 5], ["ammo_magslug", 6], ["ammo_trap", 7],
  ["ammo_flechettes", 8], ["ammo_tesla", 9], ["ammo_disruptor", 10], ["ammo_prox", 11],
]);

/** Resolve the pinned retail item roster through its native API, never source-header ordinals. */
export function rereleaseInventoryItems(module: RereleaseGuestModule, string: (value: string) => GuestAddress): readonly RereleaseInventoryItem[] {
  const profile = retailRereleaseClientProfile;
  if (profile.authority.kind !== "artifact" || module.memory.module.digest !== profile.authority.digest) throw new Error("Inventory roster requires the verified retail artifact");
  const indices = new Set<number>([0]);
  const items: RereleaseInventoryItem[] = [{ item: "q2:none", sourceIndex: 0, capacity: { kind: "fixed", count: 0 } }];
  for (const classname of classnames) {
    const result = module.callGame("Bot_GetItemID", [guestPointer(string(classname))]);
    if (result.kind !== "int32" || result.value <= 0 || result.value >= profile.inventoryCount || indices.has(result.value)) throw new Error("Native item roster mismatch: " + classname);
    indices.add(result.value);
    const ammo = ammoSlots.get(classname);
    // Non-ammo counts are native int32 counters. Source pickup rules own their gameplay limits.
    items.push({ item: `q2:${classname}`, sourceIndex: result.value, capacity: ammo === undefined ? { kind: "fixed", count: 0x7fffffff } : { kind: "ammo", sourceIndex: ammo } });
  }
  const unnamed = Array.from({ length: profile.inventoryCount }, (_, index) => index).filter(index => !indices.has(index));
  if (unnamed.length !== 1 || unnamed[0] === undefined) throw new Error("Native item roster does not contain exactly one unnamed tag token");
  // IT_ITEM_TAG_TOKEN has no classname; it is the sole non-null hole in the verified roster.
  items.push({ item: "q2:item_tag_token", sourceIndex: unnamed[0], capacity: { kind: "fixed", count: 0x7fffffff } });
  return Object.freeze(items.sort((a, b) => a.sourceIndex - b.sourceIndex).map(item => Object.freeze(item)));
}
