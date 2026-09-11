import { Weapon } from "../../../../movement/q3/constants.ts";
export { MoveType, WeaponState, Powerup, Holdable, Weapon, EntityEvent } from "../../../../movement/q3/constants.ts";
// Ported from id Software's code/game/bg_public.h and q_shared.h.
// Copyright (C) 1999-2005 Id Software, Inc. GPL-2.0-or-later.

export type Product = "baseq3" | "missionpack";

export const DEFAULT_GRAVITY = 800;
export const GIB_HEALTH = -40;
export const ARMOR_PROTECTION = 0.66;
export const MAX_ITEMS = 256;
export const EVENT_VALID_MSEC = 300;
export const EV_EVENT_BIT1 = 0x100;
export const EV_EVENT_BIT2 = 0x200;
export const EV_EVENT_BITS = 0x300;

export enum GameType {
  GT_FFA = 0,
  GT_TOURNAMENT = 1,
  GT_SINGLE_PLAYER = 2,
  GT_TEAM = 3,
  GT_CTF = 4,
  GT_1FCTF = 5,
  GT_OBELISK = 6,
  GT_HARVESTER = 7,
  GT_MAX_GAME_TYPE = 8,
}







export enum Team {
  TEAM_FREE = 0,
  TEAM_RED = 1,
  TEAM_BLUE = 2,
  TEAM_SPECTATOR = 3,
  TEAM_NUM_TEAMS = 4,
}

export enum ItemType {
  IT_BAD = 0,
  IT_WEAPON = 1,
  IT_AMMO = 2,
  IT_ARMOR = 3,
  IT_HEALTH = 4,
  IT_POWERUP = 5,
  IT_HOLDABLE = 6,
  IT_PERSISTANT_POWERUP = 7,
  IT_TEAM = 8,
}

export enum EntityType {
  ET_GENERAL = 0,
  ET_PLAYER = 1,
  ET_ITEM = 2,
  ET_MISSILE = 3,
  ET_MOVER = 4,
  ET_BEAM = 5,
  ET_PORTAL = 6,
  ET_SPEAKER = 7,
  ET_PUSH_TRIGGER = 8,
  ET_TELEPORT_TRIGGER = 9,
  ET_INVISIBLE = 10,
  ET_GRAPPLE = 11,
  ET_TEAM = 12,
  ET_EVENTS = 13,
}

export enum PersistentIndex {
  PERS_SCORE = 0,
  PERS_HITS = 1,
  PERS_RANK = 2,
  PERS_TEAM = 3,
  PERS_SPAWN_COUNT = 4,
  PERS_PLAYEREVENTS = 5,
  PERS_ATTACKER = 6,
  PERS_ATTACKEE_ARMOR = 7,
  PERS_KILLED = 8,
  PERS_IMPRESSIVE_COUNT = 9,
  PERS_EXCELLENT_COUNT = 10,
  PERS_DEFEND_COUNT = 11,
  PERS_ASSIST_COUNT = 12,
  PERS_GAUNTLET_FRAG_COUNT = 13,
  PERS_CAPTURES = 14,
}

export enum BaseStatIndex {
  STAT_HEALTH = 0,
  STAT_HOLDABLE_ITEM = 1,
  STAT_WEAPONS = 2,
  STAT_ARMOR = 3,
  STAT_DEAD_YAW = 4,
  STAT_CLIENTS_READY = 5,
  STAT_MAX_HEALTH = 6,
}

export enum MissionpackStatIndex {
  STAT_HEALTH = 0,
  STAT_HOLDABLE_ITEM = 1,
  STAT_PERSISTANT_POWERUP = 2,
  STAT_WEAPONS = 3,
  STAT_ARMOR = 4,
  STAT_DEAD_YAW = 5,
  STAT_CLIENTS_READY = 6,
  STAT_MAX_HEALTH = 7,
}

export interface StatSchema {
  readonly health: number;
  readonly holdableItem: number;
  readonly weapons: number;
  readonly armor: number;
  readonly deadYaw: number;
  readonly clientsReady: number;
  readonly maxHealth: number;
}

const baseStats = Object.freeze({
  product: "baseq3",
  health: BaseStatIndex.STAT_HEALTH,
  holdableItem: BaseStatIndex.STAT_HOLDABLE_ITEM,
  weapons: BaseStatIndex.STAT_WEAPONS,
  armor: BaseStatIndex.STAT_ARMOR,
  deadYaw: BaseStatIndex.STAT_DEAD_YAW,
  clientsReady: BaseStatIndex.STAT_CLIENTS_READY,
  maxHealth: BaseStatIndex.STAT_MAX_HEALTH,
} satisfies StatSchema & { readonly product: "baseq3" });

const missionpackStats = Object.freeze({
  product: "missionpack",
  health: MissionpackStatIndex.STAT_HEALTH,
  holdableItem: MissionpackStatIndex.STAT_HOLDABLE_ITEM,
  persistentPowerup: MissionpackStatIndex.STAT_PERSISTANT_POWERUP,
  weapons: MissionpackStatIndex.STAT_WEAPONS,
  armor: MissionpackStatIndex.STAT_ARMOR,
  deadYaw: MissionpackStatIndex.STAT_DEAD_YAW,
  clientsReady: MissionpackStatIndex.STAT_CLIENTS_READY,
  maxHealth: MissionpackStatIndex.STAT_MAX_HEALTH,
} satisfies StatSchema & { readonly product: "missionpack"; readonly persistentPowerup: number });

export function statSchema(product: Product): typeof baseStats | typeof missionpackStats {
  return product === "baseq3" ? baseStats : missionpackStats;
}

export function weaponCount(product: Product): number {
  return product === "baseq3" ? 11 : 14;
}

export function weaponAvailable(product: Product, weapon: Weapon): boolean {
  return weapon > Weapon.WP_NONE && weapon < weaponCount(product);
}
