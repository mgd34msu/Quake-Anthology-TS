/* Classic mission-pack strings corresponding to rerelease localization keys. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1EntityServices } from "../foundation/entity-services.ts";

const classic: ReadonlyMap<string, string> = new Map([
  ["$qc_wetsuit", "Wetsuit"], ["$qc_empathy_shields", "Empathy Shields"], ["$qc_mjolnir", "Mjolnir"], ["$qc_laser_cannon", "Laser Cannon"], ["$qc_prox_gun", "Proximity Gun"],
  ["$qc_power_shield", "Power Shield"], ["$qc_anti_grav_belt", "Anti-Grav Belt"], ["$qc_vengeance_sphere", "Vengeance Sphere"], ["$qc_lava_nails", "lava nails"], ["$qc_multi_rockets", "multi rockets"],
  ["$qc_quad_damage", "Quad Damage"], ["$qc_pentagram_of_protection", "Pentagram of Protection"], ["$qc_ring_of_shadows", "Ring of Shadows"],
  ["$qc_wetsuit_fade", "Air supply in Wetsuit is running out\n"], ["$qc_empathy_fade", "Empathy Shields are running out\n"],
  ["$qc_shield_failing", "Shield failing...\n"], ["$qc_shield_lost", "Shield Lost.\n"], ["$qc_antigrav_failing", "Antigrav failing...\n"], ["$qc_antigrav_lost", "Antigrav Lost.\n"],
  ["$qc_vengeance_lost", "Vengeance Sphere Lost\n"], ["$qc_you_are_denied_vengeance", "You are denied Vengeance"],
  ["$qc_lava_enabled", "Lava Enabled\n"], ["$qc_super_lava_enabled", "Super Lava Enabled\n"], ["$qc_multi_gl_enabled", "Multi Grenades Enabled\n"], ["$qc_multi_rl_enabled", "Multi Rockets Enabled\n"], ["$qc_plasma_enabled", "Plasma Gun Enabled\n"],
  ["$qc_no_weapon", "no weapon.\n"], ["$qc_not_enough_ammo", "not enough ammo.\n"], ["$qc_got_horn", "You got the Horn of Conjuring\n"],
  ["$qc_normal_nails", "Normal Nails\n"], ["$qc_normal_grenades", "Normal Grenades\n"], ["$qc_normal_rockets", "Normal Rockets\n"], ["$qc_lightning_gun", "Lightning Gun\n"],
  ["$qc_multi_gl", "Multi Grenades\n"], ["$qc_multi_rl", "Multi Rockets\n"], ["$qc_plasma_gun", "Plasma Gun\n"],
  ["$qc_no_ammo_available", "No ammo available!\n"], ["$qc_quad_cheat", "quad cheat\n"], ["$qc_wetsuit_cheat", "wetsuit cheat\n"], ["$qc_empathy_cheat", "empathy shields cheat\n"], ["$qc_genocide_cheat", "Genocide!\n"], ["$qc_dump_player_loc", "Dumping Player Location\n"],
  ["$qc_double_shotgun", "Double-barrelled Shotgun"], ["$qc_nailgun", "Nailgun"], ["$qc_super_nailgun", "Super Nailgun"], ["$qc_grenade_launcher", "Grenade Launcher"], ["$qc_rocket_launcher", "Rocket Launcher"], ["$qc_thunderbolt", "Thunderbolt"],
]);
export function missionMessage(game: Q1EntityServices, player: ActorId | null, key: string): undefined {
  return game.message(player, game.options.edition === "classic" ? classic.get(key) ?? key : key, false);
}
export function missionPickupMessage(game: Q1EntityServices, player: ActorId, key: string): undefined {
  if (game.options.edition === "classic") return game.message(player, `You got the ${classic.get(key) ?? key}\n`, false);
  return game.message(player, "$qc_got_item", false, [key]);
}
