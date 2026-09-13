import type { EnemySelection, GameFamily, MonsterSelectionTarget, ProviderReference } from "../../contracts/content.ts";
import { monsterSources } from "./definitions.ts";

export type MonsterRole = "trooper" | "ranged" | "melee" | "leaper" | "grenadier" | "rocket" | "artillery" | "hybrid" | "heavy" | "flying" | "aquatic" | "boss" | "special";
export interface MonsterRosterSlot { readonly classname: string; readonly role: MonsterRole; }
type Roles = Readonly<Record<MonsterRole, readonly string[]>>;

/* Authored entry points in quakec_{id1,hipnotic,rogue,mg1,mg3} and Q2 rerelease g_spawn.cpp.
 * Roles describe a replacement preference, not behavioral equivalence. */
const q1: Roles = {
  trooper: ["monster_army", "monster_army_infected"],
  ranged: ["monster_enforcer", "monster_enforcer_infected"],
  melee: ["monster_dog", "monster_knight", "monster_knight_infected"],
  leaper: ["monster_demon1", "monster_demodog"],
  grenadier: ["monster_ogre", "monster_ogre_marksman"],
  rocket: ["monster_ogre_rocket"],
  artillery: ["monster_shalrath", "monster_scourge"],
  hybrid: ["monster_hell_knight", "monster_hell_knight_infected", "monster_ranged_knight"],
  heavy: ["monster_shambler"],
  flying: ["monster_wizard", "monster_wrath"],
  aquatic: ["monster_fish", "monster_eel"],
  boss: ["monster_boss", "monster_oldone", "monster_armagon", "monster_dragon", "monster_super_wrath", "monster_boss_final", "monster_oldone_new", "monster_super_shambler"],
  special: ["monster_zombie", "monster_tarbaby", "monster_gremlin", "monster_decoy", "monster_spikemine", "monster_sword", "monster_lava_man", "monster_morph", "monster_mummy", "monster_vomit", "monster_dragon_dead", "monster_ghost", "monster_orb", "monster_szombie"],
};
const q2: Roles = {
  trooper: ["monster_soldier", "monster_soldier_light"],
  ranged: ["monster_infantry", "monster_soldier_ss", "monster_soldier_hypergun", "monster_soldier_lasergun", "monster_soldier_ripper"],
  melee: ["monster_berserk"],
  leaper: ["monster_mutant"],
  grenadier: ["monster_gunner", "monster_guncmdr"],
  rocket: ["monster_chick", "monster_chick_heat"],
  artillery: ["monster_gladiator", "monster_gladb", "monster_arachnid"],
  hybrid: ["monster_brain"],
  heavy: ["monster_tank", "monster_tank_commander", "monster_shambler"],
  flying: ["monster_flyer", "monster_floater", "monster_hover", "monster_daedalus"],
  aquatic: ["monster_flipper"],
  boss: ["monster_supertank", "monster_boss2", "monster_boss3_stand", "monster_jorg", "monster_makron", "monster_guardian", "monster_boss5", "monster_carrier", "monster_widow", "monster_widow2"],
  special: ["monster_parasite", "monster_medic", "monster_medic_commander", "monster_fixbot", "monster_gekk", "monster_stalker", "monster_turret", "monster_kamikaze", "monster_tank_stand", "monster_commander_body"],
};
const preferred: Readonly<Record<"q1" | "q2", Readonly<Record<MonsterRole, string | null>>>> = {
  q1: { trooper: "monster_army", ranged: "monster_enforcer", melee: "monster_demon1", leaper: "monster_demon1", grenadier: "monster_ogre",
    rocket: "monster_shalrath", artillery: "monster_shalrath", hybrid: "monster_hell_knight", heavy: "monster_shambler", flying: "monster_wizard", aquatic: "monster_fish", boss: null, special: null },
  q2: { trooper: "monster_soldier", ranged: "monster_infantry", melee: "monster_berserk", leaper: "monster_mutant", grenadier: "monster_gunner",
    rocket: "monster_chick", artillery: "monster_gladiator", hybrid: "monster_brain", heavy: "monster_tank", flying: "monster_flyer", aquatic: "monster_flipper", boss: null, special: null },
};

function slots(roles: Roles): readonly MonsterRosterSlot[] {
  const result: MonsterRosterSlot[] = [];
  for (const role of ["trooper", "ranged", "melee", "leaper", "grenadier", "rocket", "artillery", "hybrid", "heavy", "flying", "aquatic", "boss", "special"] satisfies readonly MonsterRole[])
    for (const classname of roles[role]) result.push({ classname, role });
  return result.sort((first, second) => first.classname.localeCompare(second.classname));
}
const q1Slots = slots(q1), q2Slots = slots(q2);

export function campaignMonsterSlots(family: GameFamily): readonly MonsterRosterSlot[] {
  switch (family) { case "q1": return q1Slots; case "q2": return q2Slots; case "q3": return []; }
}

export function defaultMonsterRoster(authoredFamily: "q1" | "q2", target: ProviderReference,
  overrides: Readonly<Record<string, MonsterSelectionTarget>> = {}): Extract<EnemySelection, { readonly kind: "replace" }> {
  const selected = monsterSources.find(source => source.provider === target.provider);
  if (selected === undefined) throw new RangeError(`Unknown monster source: ${target.provider}`);
  const byClassname: Record<string, MonsterSelectionTarget> = {};
  for (const slot of campaignMonsterSlots(authoredFamily)) {
    const classname = slot.role === "boss" || slot.role === "special" ? null : selected.family === authoredFamily && Object.hasOwn(selected.creatures, slot.classname)
      ? slot.classname : preferred[selected.family][slot.role];
    byClassname[slot.classname] = classname !== null && Object.hasOwn(selected.creatures, classname)
      ? { source: target, classname } : { kind: "map-defined" };
  }
  return { kind: "replace", default: { kind: "map-defined" }, byClassname: { ...byClassname, ...overrides } };
}
