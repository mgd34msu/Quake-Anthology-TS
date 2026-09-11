// Q2 rerelease knowledge comes from mounted bots/*.txt, including dangers.txt.
// The donor incorrectly claimed Q2 shipped none and synthesized Q1-shaped files.
// Only its explicit inventory-bit adapter remains: these bits are not Q2 item IDs
// or source weapon numbers. Population resolves classnames through the game's item API.
import { BotKnowledge, type BotDataFilesT, type BotGameModeT } from "./knowledge.ts";
import type { BotSourceFiles } from "../../assets.ts";
import { readBotSourceText } from "./source-files.ts";

export interface BotWeaponBindingT {
  /** Legacy adapter label; source identity is classname, retained without rewriting. */
  readonly name: string;
  /** The bit this weapon occupies in the synthetic `items` mask. */
  readonly bit: number;
  /** The kex item classname, resolved to an item id through `Bot_GetItemID`. */
  readonly classname: string;
  /** The kex ammo item classname, or "" for a weapon that needs none. */
  readonly ammoClassname: string;
}

export const BOT_WEAPON_BINDINGS: readonly BotWeaponBindingT[] = [
  { name: "blaster", bit: 1 << 0, classname: "weapon_blaster", ammoClassname: "" },
  { name: "chainfist", bit: 1 << 1, classname: "weapon_chainfist", ammoClassname: "" },
  { name: "shotgun", bit: 1 << 2, classname: "weapon_shotgun", ammoClassname: "ammo_shells" },
  { name: "super_shotgun", bit: 1 << 3, classname: "weapon_supershotgun", ammoClassname: "ammo_shells" },
  { name: "machinegun", bit: 1 << 4, classname: "weapon_machinegun", ammoClassname: "ammo_bullets" },
  { name: "chaingun", bit: 1 << 5, classname: "weapon_chaingun", ammoClassname: "ammo_bullets" },
  { name: "etf_rifle", bit: 1 << 6, classname: "weapon_etf_rifle", ammoClassname: "ammo_flechettes" },
  { name: "grenades", bit: 1 << 7, classname: "ammo_grenades", ammoClassname: "ammo_grenades" },
  { name: "grenade_launcher", bit: 1 << 8, classname: "weapon_grenadelauncher", ammoClassname: "ammo_grenades" },
  { name: "prox_launcher", bit: 1 << 9, classname: "weapon_proxlauncher", ammoClassname: "ammo_prox" },
  { name: "rocket_launcher", bit: 1 << 10, classname: "weapon_rocketlauncher", ammoClassname: "ammo_rockets" },
  { name: "hyperblaster", bit: 1 << 11, classname: "weapon_hyperblaster", ammoClassname: "ammo_cells" },
  { name: "boomer", bit: 1 << 12, classname: "weapon_boomer", ammoClassname: "ammo_cells" },
  { name: "plasmabeam", bit: 1 << 13, classname: "weapon_plasmabeam", ammoClassname: "ammo_cells" },
  { name: "railgun", bit: 1 << 14, classname: "weapon_railgun", ammoClassname: "ammo_slugs" },
  { name: "phalanx", bit: 1 << 15, classname: "weapon_phalanx", ammoClassname: "ammo_magslug" },
  { name: "bfg", bit: 1 << 16, classname: "weapon_bfg", ammoClassname: "ammo_cells" },
  // Likewise the disruptor ships as `weapon_disintegrator`.
  { name: "disintegrator", bit: 1 << 17, classname: "weapon_disintegrator", ammoClassname: "ammo_disruptor" },
  { name: "tesla", bit: 1 << 18, classname: "ammo_tesla", ammoClassname: "ammo_tesla" },
  { name: "trap", bit: 1 << 19, classname: "ammo_trap", ammoClassname: "ammo_trap" },
  { name: "grapple", bit: 1 << 20, classname: "weapon_grapple", ammoClassname: "" },
];

/** Every ammo item the tables above name, for the inventory read in bot_world.ts. */
export const BOT_AMMO_CLASSNAMES: readonly string[] = [
  "ammo_shells",
  "ammo_bullets",
  "ammo_cells",
  "ammo_rockets",
  "ammo_grenades",
  "ammo_slugs",
  "ammo_flechettes",
  "ammo_prox",
  "ammo_tesla",
  "ammo_trap",
  "ammo_magslug",
  "ammo_disruptor",
  "ammo_nuke",
];

/** One team-owned objective pickup: the classname, and whose it is. */
export interface BotObjectiveBindingT {
  readonly classname: string;
  readonly team: number;
}


/** Standard CTF objective classnames; selected mod data can expose further objectives. */
export const BOT_OBJECTIVE_BINDINGS: readonly BotObjectiveBindingT[] = [
  { classname: "item_flag_team1", team: 1 }, { classname: "item_flag_team2", team: 2 },
];

export function Bot_BuildKnowledge(files: BotDataFilesT): BotKnowledge {
  return new BotKnowledge(files, { format: "q2", weaponNumber: classname => BOT_WEAPON_BINDINGS.find(binding => binding.classname === classname)?.bit });
}

/** All settings, including weapon stay, come from the supplied Q2 game rules. */
export function Bot_GameMode(knowledge: BotKnowledge, cvarValue: (name: string) => number): BotGameModeT {
  return knowledge.gameMode(cvarValue);
}

/** Source mount precedence is resolved before this synchronous typed boundary. */
export function Bot_LoadKnowledge(files: Pick<BotSourceFiles, "read">, platform: "PC" | "Consoles" | "Nintendo" = "PC"): BotKnowledge {
  const read = (name: string): string | null => readBotSourceText(files, `bots/${name}.txt`);
  const weapons = read("weapons"), settings = read(`settings_${platform}`);
  if (weapons === null || settings === null) throw new Error(`Q2 rerelease bot source data unavailable: weapons.txt and settings_${platform}.txt are required`);
  return Bot_BuildKnowledge({ weapons, settings, characters: read("characters") ?? "", items: read("items") ?? "",
    monsters: read("monsters") ?? "", interactables: read("interactables") ?? "", gameRules: read("game_rules") ?? "",
    teams: read("teams") ?? "", chats: read("chats") ?? "", dangers: read("dangers") ?? "" });
}
