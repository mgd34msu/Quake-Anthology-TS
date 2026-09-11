/* Original Quake II CTF 1.09b g_ctf.c/g_ctf.h. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { SavedActorId } from "../../../../contracts/session.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { Q2ItemModule } from "../../foundation/items.ts";
import type { Q2Weapons } from "../../foundation/weapons/index.ts";
import type { Q2PlayerState } from "../../base/player/types.ts";
import type { Q2CtfAdminSettings } from "./match.ts";

export type Q2CtfTeam = 0 | 1 | 2;
export type Q2CtfPlayingTeam = 1 | 2;
export type Q2CtfMatchPhase = "none" | "setup" | "pregame" | "game" | "post";
export type Q2CtfTech = "item_tech1" | "item_tech2" | "item_tech3" | "item_tech4";
export type Q2CtfMenuAction = "join-red" | "join-blue" | "observer" | "chase" | "credits" | "match" | "ready" | "notready" | "admin-settings" | "admin-start" | "admin-cancel" | "close";
export interface Q2CtfScoreRow { readonly slot: number; readonly name: string; readonly score: number; readonly ping: number; readonly carriedFlag: Q2CtfPlayingTeam | null; }
export type Q2CtfEvent =
  | { readonly kind: "scoreboard"; readonly actor: ActorId; readonly red: readonly Q2CtfScoreRow[]; readonly blue: readonly Q2CtfScoreRow[]; readonly spectators: readonly Q2CtfScoreRow[]; readonly captures: readonly [number, number]; readonly totals: readonly [number, number]; readonly layout: string }
  | { readonly kind: "hud"; readonly actor: ActorId; readonly captures: readonly [number, number]; readonly flagStates: readonly ["base" | "dropped" | "taken", "base" | "dropped" | "taken"]; readonly team: Q2CtfTeam; readonly carriedFlag: Q2CtfPlayingTeam | null; readonly tech: Q2CtfTech | null; readonly idTarget: ActorId | null; readonly blinkTeam: Q2CtfPlayingTeam | null; readonly match: string }
  | { readonly kind: "menu"; readonly actor: ActorId; readonly title: string; readonly entries: readonly { readonly label: string; readonly action: Q2CtfMenuAction | null }[] }
  | { readonly kind: "match-status"; readonly text: string }
  | { readonly kind: "admin-settings"; readonly actor: ActorId; readonly settings: Q2CtfAdminSettings }
  | { readonly kind: "grapple-cable"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3; readonly offset: Vec3 };

export interface Q2CtfRules {
  forceJoin: "" | "red" | "blue";
  competition: number;
  matchLock: boolean;
  electionPercentage: number;
  matchMinutes: number;
  setupMinutes: number;
  startSeconds: number;
  adminPassword: string;
  warpList: readonly string[];
  captureLimit: number;
  instantWeapons: boolean;
}
export function createQ2CtfRules(changes: Partial<Q2CtfRules> = {}): Q2CtfRules {
  return { forceJoin: "", competition: 0, matchLock: true, electionPercentage: 66, matchMinutes: 20, setupMinutes: 10,
    startSeconds: 20, adminPassword: "", warpList: ["q2ctf1", "q2ctf2", "q2ctf3", "q2ctf4", "q2ctf5"], captureLimit: 0, instantWeapons: false, ...changes };
}

/** Match-private source fields. Health, armor, inventory and score stay shared. */
export class Q2CtfPlayerState {
  team: Q2CtfTeam = 0;
  spawnState = 0;
  lastHurtCarrier: number | null = null;
  lastReturnedFlag: number | null = null;
  lastFraggedCarrier: number | null = null;
  flagSince = 0;
  voted = false;
  ready = false;
  admin = false;
  idView = true;
  ghostCode: number | null = null;
  regenTime = 0;
  techSoundTime = 0;
  lastTechMessage = 0;
  matchRespawnAt: number | null = null;
}
export interface Q2CtfGhost {
  code: number; team: Q2CtfPlayingTeam; name: string; actor: ActorId | null; score: number;
  deaths: number; kills: number; captures: number; baseDefense: number; carrierDefense: number;
}
export type Q2CtfElection = { readonly kind: "match" | "admin" | "map"; readonly target: ActorId; readonly map: string; readonly message: string; votes: number; readonly needed: number; readonly expires: number };
export class Q2CtfMatchState {
  team1 = 0; team2 = 0; total1 = 0; total2 = 0;
  lastFlagCapture: number | null = null;
  lastCaptureTeam: Q2CtfPlayingTeam | null = null;
  phase: Q2CtfMatchPhase = "none";
  matchTime = 0;
  lastTime = -1;
  election: Q2CtfElection | null = null;
  readonly ghosts = new Map<number, Q2CtfGhost>();
}

/** Composition supplies existing player lifecycle and session presentation services. */
export interface Q2CtfHooks {
  readonly items: Q2ItemModule;
  readonly weapons: Q2Weapons;
  player(actor: ActorId): Q2PlayerState | null;
  setSkin(actor: ActorId, skin: string): undefined;
  spawnPlayer(entity: Q2Entity, game: Q2GameServices): undefined;
  observer(entity: Q2Entity, game: Q2GameServices): undefined;
  teleport(entity: Q2Entity, game: Q2GameServices, origin: Vec3, angles: Vec3, velocity: Vec3): undefined;
  chase(actor: ActorId): undefined;
  setGrapplePrediction(actor: ActorId, suppressed: boolean): undefined;
  gravity(): number;
  emit(event: Q2CtfEvent): undefined;
  endLevel(game: Q2GameServices, map: string | null): undefined;
  kick(actor: ActorId): undefined;
  setDeathmatchFlags(flags: number): undefined;
  chatAllowed(actor: ActorId, game: Q2GameServices): boolean;
}
export interface Q2CtfContext {
  readonly hooks: Q2CtfHooks;
  readonly rules: Q2CtfRules;
  readonly states: Map<ActorId, Q2CtfPlayerState>;
  readonly match: Q2CtfMatchState;
}
export const CTF_FLAGS: Readonly<Record<Q2CtfPlayingTeam, { readonly classname: string; readonly item: ItemId; readonly model: string; readonly icon: string; readonly effect: number }>> = {
  1: { classname: "item_flag_team1", item: "q2:item_flag_team1", model: "players/male/flag1.md2", icon: "i_ctf1", effect: 0x40000 },
  2: { classname: "item_flag_team2", item: "q2:item_flag_team2", model: "players/male/flag2.md2", icon: "i_ctf2", effect: 0x80000 },
};
export function otherCtfTeam(team: Q2CtfPlayingTeam): Q2CtfPlayingTeam { return team === 1 ? 2 : 1; }
export function ctfTeamName(team: Q2CtfTeam): string { return team === 1 ? "RED" : team === 2 ? "BLUE" : "UNKNOWN"; }
export function ctfPlayer(context: Q2CtfContext, actor: ActorId): Q2CtfPlayerState {
  const state = context.states.get(actor); if (state === undefined) throw new Error("CTF player has not been admitted to the shared match"); return state;
}
export function ctfPrint(game: Q2GameServices, text: string, actor: ActorId | null = null, level: "high" | "medium" | "chat" = "high"): undefined { return game.host.emit({ kind: "print", actor, level, text }); }
export function ctfName(context: Q2CtfContext, actor: ActorId): string { return context.hooks.player(actor)?.name ?? "player"; }
export function ctfScore(context: Q2CtfContext, actor: ActorId, amount: number): undefined { const player = context.hooks.player(actor); if (player === null) throw new Error("CTF score requires the shared player state"); player.score += amount; return undefined; }
export function saveCtfActor(actor: ActorId): SavedActorId { return { slot: actor.slot, generation: actor.generation }; }
export function ctfCarriedFlag(game: Q2GameServices, actor: ActorId): Q2CtfPlayingTeam | null { return game.host.inventory.count(actor, CTF_FLAGS[1].item) > 0 ? 1 : game.host.inventory.count(actor, CTF_FLAGS[2].item) > 0 ? 2 : null; }
