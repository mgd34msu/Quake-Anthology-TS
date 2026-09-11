/* LM_CTF 5.2/6.0 g_local.h, g_ctffunc.h and q_shared.h. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { ItemId } from "../../../../contracts/gameplay.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { Q2CtfHooks, Q2CtfPlayingTeam, Q2CtfTeam } from "../ctf/types.ts";

export type LmctfTeam = Q2CtfTeam;
export type LmctfPlayingTeam = Q2CtfPlayingTeam;
export type LmctfRune = "damage" | "resist" | "haste" | "regen" | "vampire";
export interface LmctfRuneDefinition { readonly kind: LmctfRune; readonly bit: number; readonly classname: string; readonly item: ItemId; readonly model: string; readonly icon: string; readonly name: string; }
export const LMCTF_RUNES: readonly LmctfRuneDefinition[] = [
  { kind: "damage", bit: 1, classname: "damage_rune", item: "q2:damage_rune", model: "models/ctf/damage/tris.md2", icon: "a_strength", name: "Damage Artifact" },
  { kind: "haste", bit: 4, classname: "haste_rune", item: "q2:haste_rune", model: "models/ctf/haste/tris.md2", icon: "a_haste", name: "Haste Artifact" },
  { kind: "resist", bit: 2, classname: "resist_rune", item: "q2:resist_rune", model: "models/ctf/resist/tris.md2", icon: "a_resist", name: "Resist Artifact" },
  { kind: "regen", bit: 8, classname: "regen_rune", item: "q2:regen_rune", model: "models/ctf/regen/tris.md2", icon: "a_regen", name: "Regen Artifact" },
  { kind: "vampire", bit: 16, classname: "vampire_rune", item: "q2:vampire_rune", model: "models/ctf/resist/tris.md2", icon: "k_redkey", name: "Vampire Artifact" },
];
export interface LmctfRules {
  ctfFlags: number; refFlags: number; runes: number; skinSet: number; flagInit: boolean; disabledWeapons: number;
  timeLimitMinutes: number; fragLimit: number; mapList: readonly string[]; rconPassword: string;
  fastSwitch: boolean; refPassword: string; autoLock: boolean; countdownSeconds: number; quadSeconds: number;
}
export function createLmctfRules(changes: Partial<LmctfRules> = {}): LmctfRules {
  return { ctfFlags: 0, refFlags: 0, runes: 15, skinSet: 0, flagInit: false, disabledWeapons: 0,
    timeLimitMinutes: 0, fragLimit: 0, mapList: [], rconPassword: "",
    fastSwitch: false, refPassword: "", autoLock: false, countdownSeconds: 15, quadSeconds: 30, ...changes };
}
export interface LmctfScoreRow { readonly actor: ActorId; readonly slot: number; readonly name: string; readonly team: LmctfTeam; readonly score: number; readonly ping: number; }
export type LmctfEvent =
  | { readonly kind: "grapple-cable"; readonly actor: ActorId; readonly start: Vec3; readonly end: Vec3; readonly offset: Vec3 }
  | { readonly kind: "menu"; readonly actor: ActorId; readonly title: string; readonly entries: readonly { readonly label: string; readonly command: string | null }[] }
  | { readonly kind: "scoreboard"; readonly actor: ActorId; readonly rows: readonly LmctfScoreRow[]; readonly layout: string }
  | { readonly kind: "hud"; readonly actor: ActorId; readonly team: LmctfTeam; readonly carriedFlag: boolean; readonly rune: LmctfRune | null; readonly layout: string }
  | { readonly kind: "score-log"; readonly actor: ActorId; readonly victim: ActorId | null; readonly name: string; readonly amount: number; readonly seconds: number };
export interface LmctfHooks extends Omit<Q2CtfHooks, "emit"> { emit(event: LmctfEvent): undefined; }

/** Source-private fields; player score, health, armor and item counts remain shared. */
export class LmctfPlayerState {
  plasmaMode = false;
  team: LmctfTeam = 0;
  observerTeam: LmctfTeam = 0;
  rune: ActorId | null = null;
  hook: ActorId | null = null;
  hookState: 0 | 1 | 2 = 0;
  hookLength = 0;
  hookHeld = false;
  regenFrame = 0;
  killCarrierTime = 0;
  hitCarrierTime = 0;
  returnFlagTime = 0;
  defendFlagTime = 0;
  extraFlags = 16 | 32;
  spawnState = 0;
  readonly statistics = new Map<string, number>();
}
export interface LmctfContext {
  plasmaQuad: boolean;
  readonly hooks: LmctfHooks;
  readonly rules: LmctfRules;
  readonly states: Map<ActorId, LmctfPlayerState>;
  canScore(): boolean;
  flagsTouchable(): boolean;
}
export function lmctfPlayer(context: LmctfContext, actor: ActorId): LmctfPlayerState {
  const state = context.states.get(actor); if (state === undefined) throw new Error("LMCTF player has not been admitted"); return state;
}
export function lmctfName(context: LmctfContext, actor: ActorId): string { return context.hooks.player(actor)?.name ?? "player"; }
export function lmctfPrint(game: Q2GameServices, text: string, actor: ActorId | null = null): undefined { return game.host.emit({ kind: "print", actor, level: "high", text }); }
export function lmctfStat(context: LmctfContext, actor: ActorId, name: string, amount: number): undefined {
  const state = lmctfPlayer(context, actor); if (context.canScore()) state.statistics.set(name, (state.statistics.get(name) ?? 0) + amount); return undefined;
}
export function lmctfScore(context: LmctfContext, game: Q2GameServices, actor: ActorId, amount: number, name: string, victim: ActorId | null = null): undefined {
  const player = context.hooks.player(actor); if (player === null) throw new Error("LMCTF score requires the shared player state");
  player.score += amount; lmctfStat(context, actor, "score", amount);
  return context.hooks.emit({ kind: "score-log", actor, victim, name, amount, seconds: game.host.now() });
}
export function lmctfActive(context: LmctfContext, game: Q2GameServices, actor: ActorId): boolean {
  const state = context.states.get(actor), player = context.hooks.player(actor);
  return state !== undefined && player !== null && player.connected && !player.spectator && (state.team !== 0 || game.options.mode !== "deathmatch") && game.host.actors.isLive(actor);
}
export function lmctfToss(entity: Q2Entity, player: Q2Entity, game: Q2GameServices, forward: Vec3): undefined {
  const body = game.body(player), origin = { x: body.origin.x + forward.x * 24, y: body.origin.y + forward.y * 24, z: body.origin.z + forward.z * 24 - 16 };
  return game.move(entity, { origin: game.host.trace({ start: body.origin, end: origin, bounds: game.body(entity).bounds, ignore: player.actor.id, mask: 1 }).end,
    velocity: { x: forward.x * 200, y: forward.y * 200, z: 300 } });
}
