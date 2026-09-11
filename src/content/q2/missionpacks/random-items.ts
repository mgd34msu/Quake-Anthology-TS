/* Rogue g_newdm.c and rerelease rogue/g_rogue_newdm.cpp item substitution. */
import type { Q2ItemDefinition } from "../foundation/items.ts";
import type { Q2Entity, Q2GameServices } from "../foundation/host.ts";

export interface Q2RandomItemSettings { readonly enabled: boolean; readonly noMines: boolean; readonly noNukes: boolean; readonly noSpheres: boolean; }
type ItemCategory = "weapon" | "ammo" | "power" | "key";

// Order within each category is the original itemlist order used by the random index.
const classic: Readonly<Record<ItemCategory, readonly string[]>> = {
  weapon: ["weapon_blaster", "weapon_shotgun", "weapon_supershotgun", "weapon_machinegun", "weapon_chaingun", "weapon_etf_rifle", "weapon_grenadelauncher", "weapon_proxlauncher", "weapon_rocketlauncher", "weapon_hyperblaster", "weapon_plasmabeam", "weapon_railgun", "weapon_bfg", "weapon_chainfist"],
  ammo: ["ammo_grenades", "ammo_shells", "ammo_bullets", "ammo_cells", "ammo_rockets", "ammo_slugs", "ammo_flechettes", "ammo_prox", "ammo_tesla"],
  power: ["ammo_nuke", "item_quad", "item_invulnerability", "item_silencer", "item_breather", "item_enviro", "item_ir_goggles", "item_double", "item_compass", "item_sphere_vengeance", "item_sphere_hunter", "item_sphere_defender", "item_doppleganger"],
  key: ["key_data_cd", "key_power_cube", "key_pyramid", "key_data_spinner", "key_pass", "key_blue_key", "key_red_key", "key_commander_head", "key_airstrike_target", "key_nuke_container", "key_nuke"],
};
const rerelease: Readonly<Record<ItemCategory, readonly string[]>> = {
  weapon: ["weapon_chainfist", "weapon_shotgun", "weapon_supershotgun", "weapon_machinegun", "weapon_etf_rifle", "weapon_chaingun", "weapon_grenadelauncher", "weapon_proxlauncher", "weapon_rocketlauncher", "weapon_hyperblaster", "weapon_boomer", "weapon_plasmabeam", "weapon_railgun", "weapon_phalanx", "weapon_bfg", "weapon_disintegrator"],
  ammo: ["ammo_grenades", "ammo_trap", "ammo_tesla", "ammo_shells", "ammo_bullets", "ammo_cells", "ammo_rockets", "ammo_slugs", "ammo_magslug", "ammo_flechettes", "ammo_prox", "ammo_disruptor"],
  power: ["ammo_nuke", "item_quad", "item_quadfire", "item_invulnerability", "item_invisibility", "item_silencer", "item_breather", "item_enviro", "item_adrenaline", "item_bandolier", "item_pack", "item_ir_goggles", "item_double", "item_sphere_vengeance", "item_sphere_hunter", "item_sphere_defender", "item_doppleganger", "item_health_mega"],
  key: ["key_data_cd", "key_power_cube", "key_explosive_charges", "key_yellow_key", "key_power_core", "key_pyramid", "key_data_spinner", "key_pass", "key_blue_key", "key_red_key", "key_green_key", "key_commander_head", "key_airstrike_target", "key_nuke_container", "key_nuke"],
};

function category(classname: string, table: Readonly<Record<ItemCategory, readonly string[]>>): ItemCategory | null {
  for (const kind of ["weapon", "ammo", "power", "key"] satisfies readonly ItemCategory[]) if (table[kind].includes(classname)) return kind;
  return null;
}

export function q2RandomItem(entity: Q2Entity, item: Q2ItemDefinition, game: Q2GameServices, settings: Q2RandomItemSettings): string | null {
  if (!settings.enabled) return null;
  if (game.options.edition === "classic") {
    if (item.kind === "power-armor") return null;
    if (item.kind === "health" || item.classname === "item_adrenaline") {
      if (entity.classname === "item_health_small") return null;
      const chance = game.host.random();
      return chance < 0.6 ? "item_health" : chance < 0.9 ? "item_health_large" : chance < 0.99 ? "item_adrenaline" : "item_health_mega";
    }
    if (item.kind === "armor") {
      const chance = game.host.random();
      return chance < 0.6 ? "item_armor_jacket" : chance < 0.9 ? "item_armor_combat" : "item_armor_body";
    }
    if (item.kind === "shard") return null;
    const kind = category(item.classname, classic);
    if (kind === null) return null;
    // The original two passes check the old entity classname, including this misspelled defender alias.
    if (settings.noSpheres && ["item_sphere_vengeance", "item_sphere_hunter", "item_spehre_defender"].includes(entity.classname) ||
      settings.noNukes && entity.classname === "ammo_nuke" || settings.noMines && ["ammo_prox", "ammo_tesla"].includes(entity.classname)) return null;
    const choices = classic[kind], pick = Math.ceil(game.host.random() * choices.length);
    return choices[pick - 1] ?? null;
  }
  if (["item_flag_team1", "item_flag_team2", "dm_tag_token"].includes(item.classname)) return null;
  if (["item_health_small", "item_armor_shard"].includes(item.classname)) {
    const choice = game.host.rereleaseRandom?.integer(2) ?? Math.floor(game.host.random() * 2);
    return choice === 0 ? "item_health_small" : "item_armor_shard";
  }
  if (["item_health", "item_health_large"].includes(item.classname)) return game.host.random() < 0.6 ? "item_health" : "item_health_large";
  if (["item_armor_jacket", "item_armor_combat", "item_armor_body", "item_power_screen", "item_power_shield"].includes(item.classname)) {
    const chance = game.host.random();
    return chance < 0.4 ? "item_armor_jacket" : chance < 0.6 ? "item_armor_combat" : chance < 0.8 ? "item_armor_body" : chance < 0.9 ? "item_power_screen" : "item_power_shield";
  }
  // Non-random weapons still use their category when they are the item being replaced.
  const kind = item.classname === "weapon_blaster" || item.classname === "weapon_grapple" ? "weapon" : category(item.classname, rerelease);
  if (kind === null) return null;
  const choices = rerelease[kind].filter(classname => !(settings.noSpheres && classname.startsWith("item_sphere_") ||
    settings.noNukes && classname === "ammo_nuke" || settings.noMines && ["ammo_prox", "ammo_tesla", "ammo_trap", "weapon_proxlauncher"].includes(classname)));
  if (choices.length === 0) return null;
  return choices[game.host.rereleaseRandom?.integer(choices.length) ?? Math.floor(game.host.random() * choices.length)] ?? null;
}
