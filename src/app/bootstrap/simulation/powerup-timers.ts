import type { ActivePowerupTimer } from "../../../contracts/gameplay.ts";
import type { Q2PlayerPowerups } from "../../../content/q2/foundation/items.ts";
import type { Q2MissionPackPowerups } from "../../../content/q2/missionpacks/items.ts";
import type { Q1Powerup } from "../../../content/q1/foundation/types.ts";
import type { GameClient } from "../../../content/q3/base/game/state.ts";
import { Powerup } from "../../../content/q3/base/shared/definitions.ts";
import { MoveFlags } from "../../../content/q3/base/shared/player-state.ts";

export function q2PowerupTimers(base: Readonly<Q2PlayerPowerups>, expansion: Readonly<Q2MissionPackPowerups> | undefined, now: number): readonly ActivePowerupTimer[] {
  const timers: readonly ActivePowerupTimer[] = [
    { item: "q2:item_quad", label: "Quad Damage", remainingSeconds: base.quadUntil - now },
    { item: "q2:item_quadfire", label: "DualFire Damage", remainingSeconds: (expansion?.quadFireUntil ?? 0) - now },
    { item: "q2:item_double", label: "Double Damage", remainingSeconds: (expansion?.doubleUntil ?? 0) - now },
    { item: "q2:item_invulnerability", label: "Invulnerability", remainingSeconds: base.invulnerabilityUntil - now },
    { item: "q2:item_enviro", label: "Environment Suit", remainingSeconds: base.enviroUntil - now },
    { item: "q2:item_breather", label: "Rebreather", remainingSeconds: base.breatherUntil - now },
    { item: "q2:item_ir_goggles", label: "IR Goggles", remainingSeconds: (expansion?.irUntil ?? 0) - now },
  ];
  return timers.filter(timer => timer.remainingSeconds > 0);
}

const q1Timers: Readonly<Record<Q1Powerup, { readonly item: ActivePowerupTimer["item"]; readonly label: string }>> = {
  quad: { item: "q1:item_artifact_super_damage", label: "Quad Damage" },
  invulnerability: { item: "q1:item_artifact_invulnerability", label: "Invulnerability" },
  invisibility: { item: "q1:item_artifact_invisibility", label: "Invisibility" },
  suit: { item: "q1:item_artifact_envirosuit", label: "Environment Suit" },
  "mg3:lavasuit": { item: "q1:item_artifact_lavasuit", label: "Lava Suit" },
  "hipnotic:wetsuit": { item: "q1:item_artifact_wetsuit", label: "Wetsuit" },
  "hipnotic:empathy": { item: "q1:item_artifact_empathy_shields", label: "Empathy Shields" },
  "rogue:shield": { item: "q1:item_powerup_shield", label: "Power Shield" },
  "rogue:antigrav": { item: "q1:item_powerup_belt", label: "Anti-gravity Belt" },
};

export function q1PowerupTimers(powerups: ReadonlyMap<Q1Powerup, number>, nowSeconds: number): readonly ActivePowerupTimer[] {
  return [...powerups].flatMap(([kind, expires]) => expires > nowSeconds ? [{ ...q1Timers[kind], remainingSeconds: expires - nowSeconds }] : []);
}

const q3Timers = [
  { powerup: Powerup.PW_QUAD, item: "q3:item_quad", label: "Quad Damage" },
  { powerup: Powerup.PW_BATTLESUIT, item: "q3:item_enviro", label: "Battle Suit" },
  { powerup: Powerup.PW_HASTE, item: "q3:item_haste", label: "Haste" },
  { powerup: Powerup.PW_INVIS, item: "q3:item_invis", label: "Invisibility" },
  { powerup: Powerup.PW_REGEN, item: "q3:item_regen", label: "Regeneration" },
  { powerup: Powerup.PW_FLIGHT, item: "q3:item_flight", label: "Flight" },
] satisfies readonly { readonly powerup: Powerup; readonly item: ActivePowerupTimer["item"]; readonly label: string }[];

export function q3PublicPowerupTimers(expires: (powerup: number) => number, nowMilliseconds: number): readonly ActivePowerupTimer[] {
  return q3Timers.map(({ powerup, ...timer }) => ({ ...timer, remainingSeconds: (expires(powerup) - nowMilliseconds) / 1000 }))
    .filter(timer => timer.remainingSeconds > 0);
}

export function q3PowerupTimers(client: Readonly<GameClient>, nowMilliseconds: number, clientAt: (clientNumber: number) => Readonly<GameClient>): readonly ActivePowerupTimer[] {
  const viewed = (client.ps.pmFlags & MoveFlags.FOLLOW) !== 0 ? clientAt(client.ps.clientNum) : client;
  const timers: ActivePowerupTimer[] = [...q3PublicPowerupTimers(powerup => viewed.ps.powerups.get(powerup), nowMilliseconds)];
  timers.push({ item: "q3:holdable_invulnerability", label: "Invulnerability", remainingSeconds: (viewed.invulnerabilityTime - nowMilliseconds) / 1000 });
  return timers.filter(timer => timer.remainingSeconds > 0);
}
