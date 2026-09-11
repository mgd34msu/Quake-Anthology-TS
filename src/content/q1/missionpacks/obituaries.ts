/* Mission-pack ClientObituary differences. The session alone applies returned scores. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import { q1Obituary } from "../base/rules.ts";
import type { Q1Obituary } from "../base/rules.ts";
import { classicMonsterObituaries, classicObituaryText } from "../base/messages.ts";
import type { Q1MissionPack } from "./types.ts";

export type Q1MissionPackObituaryInput = Parameters<typeof q1Obituary>[0];
export interface MissionPackObituaryContext {
  readonly pack: Q1MissionPack;
  readonly inflictorClassname: string;
  readonly attackerDeathType: string;
  readonly victimSavedTeam: number;
  readonly gamecfg: number;
  readonly tagScore?: () => number;
}
const classic: ReadonlyMap<string, string> = new Map([
  ["$qc_death_empathy1", "{0} shares {1}'s pain\n"], ["$qc_death_empathy2", "{0} feels {1}'s pain\n"],
  ["$qc_death_bomb1", "{0} got too friendly with {1}'s bomb\n"], ["$qc_death_bomb2", "{0} did the rhumba with {1}'s bomb\n"],
  ["$qc_death_laser1", "{0} was toasted by {1}'s laser\n"], ["$qc_death_laser2", "{0} was radiated by {1}'s laser\n"], ["$qc_death_hammer", "{0} was slammed by {1}'s hammer\n"],
  ["$qc_death_grappled", "{0} was grappled by {1}\n"], ["$qc_death_burned", "{0} was burned by {1}\n"], ["$qc_death_fused", "{0} was fused by {1}\n"], ["$qc_death_blasted", "{0} was blasted to bits by {1}\n"],
  ["$qc_death_vengeance", "{0} was purged by the Vengeance Sphere\n"], ["$qc_death_smashed", "{0} was smashed by {1}\n"],
  ["$qc_changed_teams", "{0} changed teams\n"], ["$qc_tried_change_teams", "{0} tried to change teams\n"], ["$qc_suicide_loaded", "{0} checks if his weapon is loaded\n"],
  ["$qc_ks_dragon1", "{0} was annihilated by the Dragon\n"], ["$qc_ks_dragon2", "{0} was squashed by the Dragon\n"], ["$qc_ks_eel", "{0} was electrified by an Eel\n"],
  ["$qc_ks_wrath", "{0} was disintegrated by a Wrath\n"], ["$qc_ks_overlord", "{0} was obliterated by an Overlord\n"], ["$qc_ks_swordsman", "{0} was slit open by a Phantom Swordsman\n"],
  ["$qc_ks_hephaestus", "{0} fries in Hephaestus' fury\n"], ["$qc_ks_guardian", "{0} was crushed by a Guardian\n"], ["$qc_ks_mummy", "{0} was Mummified\n"],
  ["$qc_ks_gremlin", "{0} was outsmarted by a Gremlin\n"], ["$qc_ks_centroid", "{0} was stung by a Centroid\n"], ["$qc_ks_armagon", "{0} was outgunned by Armagon\n"],
  ["$qc_ks_blew_up", "{0} blew up\n"], ["$qc_ks_spiked", "{0} was spiked\n"], ["$qc_ks_lavaball", "{0} ate a lavaball\n"], ["$qc_ks_tried_leave", "{0} tried to leave\n"],
  ["$qc_ks_rode_lightning", "{0} rode the lightning\n"], ["$qc_ks_cleaved", "{0} was cleaved in two\n"], ["$qc_ks_sliced", "{0} was sliced to pieces\n"], ["$qc_ks_plasma", "{0} was turned to plasma\n"],
]);
const monsters: ReadonlyMap<string, string> = new Map([
  ["monster_army", "$qc_ks_grunt"], ["monster_demon1", "$qc_ks_fiend"], ["monster_dog", "$qc_ks_rottweiler"], ["monster_dragon", "$qc_ks_dragon"], ["monster_dragon_dead", "$qc_ks_dragon2"],
  ["monster_enforcer", "$qc_ks_enforcer"], ["monster_fish", "$qc_ks_rotfish"], ["monster_hell_knight", "$qc_ks_deathknight"], ["monster_knight", "$qc_ks_knight"], ["monster_ogre", "$qc_ks_ogre"],
  ["monster_oldone", "$qc_ks_shub"], ["monster_shalrath", "$qc_ks_vore"], ["monster_shambler", "$qc_ks_shambler"], ["monster_tarbaby", "$qc_ks_spawn"], ["monster_vomit", "$qc_ks_vomitus"], ["monster_wizard", "$qc_ks_scrag"], ["monster_zombie", "$qc_ks_zombie"],
  ["monster_gremlin", "$qc_ks_gremlin"], ["monster_scourge", "$qc_ks_centroid"], ["monster_armagon", "$qc_ks_armagon"], ["monster_eel", "$qc_ks_eel"], ["monster_wrath", "$qc_ks_wrath"], ["monster_super_wrath", "$qc_ks_overlord"],
  ["monster_sword", "$qc_ks_swordsman"], ["monster_lava_man", "$qc_ks_hephaestus"], ["monster_morph", "$qc_ks_guardian"], ["monster_mummy", "$qc_ks_mummy"],
]);
function classicText(key: string, args: readonly string[]): string {
  const template = classic.get(key); return template === undefined ? classicObituaryText(key, args) : template.replace(/\{([0-9]+)\}/gu, (_match: string, index: string) => args[Number(index)] ?? "");
}
export function missionPackObituary(input: Q1MissionPackObituaryInput, context: MissionPackObituaryContext): Q1Obituary {
  const { victim, attacker } = input, firstRoll = input.random(); let replay = true;
  const fallback = (override: Partial<Q1MissionPackObituaryInput> = {}): Q1Obituary => q1Obituary({ ...input, ...override, random: () => { if (replay) { replay = false; return firstRoll; } return input.random(); } });
  const result = (key: string, actor: ActorId | null, delta = 0, args: readonly string[] = [victim.name], classicOverride?: string): Q1Obituary => ({
    message: key === "" ? null : input.edition === "rerelease" ? { text: key, arguments: args } : { text: classicOverride ?? classicText(key, args), arguments: [] }, score: actor === null ? null : { actor, delta }, achievement: null,
  });
  if (!victim.isPlayer || attacker?.classname === "teledeath" || attacker?.classname === "teledeath2") return fallback();
  if (attacker?.isPlayer) {
    if (sameActor(victim.actor, attacker.actor)) {
      if (victim.weapon === "lightning" && victim.waterLevel > 1 || victim.weapon === "grenadelauncher") return fallback();
      if (context.pack === "hipnotic") return result(input.edition === "classic" ? firstRoll > 0.4 ? "$qc_suicide_bored" : "$qc_suicide_loaded" : firstRoll !== 0 ? "$qc_suicide_bored" : "$qc_suicide_loaded", victim.actor, -1);
      if (input.edition === "rerelease" && firstRoll < 0.5) return result("$qc_suicide_bored", victim.actor, -1);
      if (input.teamplay !== 0 && victim.team !== context.victimSavedTeam) return result((context.gamecfg & 16) !== 0 ? "$qc_changed_teams" : "$qc_tried_change_teams", victim.actor, -1);
      return result(input.edition === "classic" ? "$qc_suicide_bored" : "$qc_suicide_loaded", victim.actor, -1);
    }
    if (input.teamplay === 2 && victim.team > 0 && victim.team === attacker.team) return fallback();
    const points = context.pack === "rogue" && input.teamplay === 3 ? context.tagScore?.() ?? 1 : 1;
    const message = (key: string): Q1Obituary => result(key, attacker.actor, points, [victim.name, attacker.name]);
    if (context.pack === "hipnotic") {
      if (input.deathType === "hipnotic:empathy") return message(input.random() < 0.5 ? "$qc_death_empathy1" : "$qc_death_empathy2");
      if (context.inflictorClassname === "proximity_grenade") return message(input.random() < 0.5 ? "$qc_death_bomb1" : "$qc_death_bomb2");
      if (attacker.weapon === "hipnotic:laser") return message(input.random() < 0.5 ? "$qc_death_laser1" : "$qc_death_laser2");
      if (attacker.weapon === "hipnotic:mjolnir") return message("$qc_death_hammer");
    } else {
      if (attacker.weapon === "rogue:grapple") return message("$qc_death_grappled");
      if (attacker.weapon === "rogue:lava-nailgun" || attacker.weapon === "rogue:lava-supernailgun") return message("$qc_death_burned");
      if (attacker.weapon === "rogue:plasma") return message("$qc_death_fused");
      if (attacker.weapon === "rogue:multi-grenade" || attacker.weapon === "rogue:multi-rocket") return message("$qc_death_blasted");
    }
    const base = fallback(); return { ...base, score: { actor: attacker.actor, delta: points } };
  }
  if (context.pack === "hipnotic") {
    if (context.attackerDeathType !== "") return result(context.attackerDeathType, victim.actor, -1, [victim.name], `${victim.name} ${context.attackerDeathType}\n`);
    if (victim.waterType !== "empty") return fallback({ attacker: null });
  }
  if (attacker?.isMonster) {
    const key = context.pack === "rogue" && attacker.classname === "monster_dragon" ? "$qc_ks_dragon1" : monsters.get(attacker.classname) ?? "";
    const old = classicMonsterObituaries.get(attacker.classname);
    return result(key, victim.actor, -1, [victim.name], classic.has(key) || old === undefined ? undefined : victim.name + old);
  }
  if (attacker?.classname === "explo_box") return result("$qc_ks_blew_up", victim.actor, -1);
  if (attacker?.brush && attacker.classname !== "worldspawn") return result("$qc_death_squish", victim.actor, -1);
  if (context.pack === "hipnotic" && input.deathType === "falling") return result("$qc_death_fall", victim.actor, -1);
  const trap = attacker?.classname;
  if (trap === "trap_shooter" || trap === "trap_spikeshooter") return result("$qc_ks_spiked", victim.actor, -1);
  if (trap === "fireball") return result("$qc_ks_lavaball", victim.actor, -1);
  if (trap === "trigger_changelevel") return result("$qc_ks_tried_leave", victim.actor, -1);
  if (context.pack === "rogue") {
    if (trap === "ltrail_start" || trap === "ltrail_relay") return result("$qc_ks_rode_lightning", victim.actor, -1);
    if (trap === "pendulum" || trap === "buzzsaw" || trap === "plasma") return result(trap === "pendulum" ? "$qc_ks_cleaved" : trap === "buzzsaw" ? "$qc_ks_sliced" : "$qc_ks_plasma", victim.actor, -1);
    if (trap === "Vengeance") return result("$qc_death_vengeance", null);
    if (trap === "power_shield" && input.telefragOwner !== null) return result("$qc_death_smashed", input.telefragOwner.actor, 1, [victim.name, input.telefragOwner.name]);
  }
  return fallback();
}
