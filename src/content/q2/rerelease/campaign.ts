import type { Q2GameServices } from "../foundation/host.ts";
import { numberField } from "../foundation/fields.ts";
import type { Q2RereleasePlayers } from "./players.ts";

export interface Q2RereleaseLevelEntry {
  readonly map: string;
  name: string;
  visitOrder: number;
  totalSecrets: number;
  foundSecrets: number;
  totalMonsters: number;
  killedMonsters: number;
  time: number;
}
export interface Q2RereleaseCampaignState {
  crossUnitFlags: number;
  visitedMaps: Set<string>;
  readonly levels: Map<string, Q2RereleaseLevelEntry>;
  readonly mission: { primary: string; secondary: string; primaryChanges: number; secondaryChanges: number };
}
export function createQ2RereleaseCampaignState(): Q2RereleaseCampaignState { return { crossUnitFlags: 0, visitedMaps: new Set<string>(), levels: new Map<string, Q2RereleaseLevelEntry>(), mission: { primary: "", secondary: "", primaryChanges: 0, secondaryChanges: 0 } }; }
function addLevel(campaign: Q2RereleaseCampaignState, map: string): Q2RereleaseLevelEntry | null {
  const previous = campaign.levels.get(map);
  if (previous !== undefined) return previous;
  if (campaign.levels.size >= 8) return null;
  const entry = { map, name: "", visitOrder: 0, totalSecrets: 0, foundSecrets: 0, totalMonsters: 0, killedMonsters: 0, time: 0 };
  campaign.levels.set(map, entry); return entry;
}
export function enterQ2RereleaseLevel(game: Q2GameServices, players: Q2RereleasePlayers, campaign: Q2RereleaseCampaignState): undefined {
  const world = game.entity(game.host.worldActor());
  if (game.options.mode === "deathmatch" || world !== null && numberField(world.spawn, "hub_map") !== 0) return undefined;
  const entry = addLevel(campaign, game.options.mapName);
  if (entry === null) { game.host.diagnostic("More than 8 maps in unit; cannot track remaining levels"); return undefined; }
  if (entry.name === "") {
    entry.name = world?.message || game.options.mapName;
    entry.visitOrder = Math.max(0, ...[...campaign.levels.values()].map(value => value.visitOrder)) + 1;
    campaign.visitedMaps.add(game.options.mapName);
    if (players.rereleaseOptions.coopLives) for (const extra of players.rereleaseStates.values()) extra.lives = Math.min(players.rereleaseOptions.coopNumLives + 1, extra.lives + 1);
  }
  for (const entity of game.entities.values()) {
    if (entity.classname !== "target_changelevel" || entity.map === "" || entity.map.includes("*")) continue;
    const destination = entity.map.slice(entity.map.indexOf("+") + 1);
    if (destination.includes(".cin") || destination.includes(".pcx")) continue;
    const map = destination.split("$")[0];
    if (map !== undefined && map !== "" && addLevel(campaign, map) === null) { game.host.diagnostic("More than 8 maps in unit; cannot track remaining levels"); return undefined; }
  }
  return undefined;
}
export function updateQ2RereleaseLevel(game: Q2GameServices, campaign: Q2RereleaseCampaignState): undefined {
  const entry = campaign.levels.get(game.options.mapName);
  if (entry !== undefined) {
    entry.foundSecrets = game.counters.foundSecrets; entry.totalSecrets = game.counters.totalSecrets;
    entry.killedMonsters = game.counters.killedMonsters; entry.totalMonsters = game.counters.totalMonsters;
  }
  return undefined;
}
export function q2RereleaseUnitReport(campaign: Q2RereleaseCampaignState): readonly Readonly<Q2RereleaseLevelEntry>[] {
  const order = (entry: Q2RereleaseLevelEntry): number => entry.visitOrder || (entry.name === "" ? 10 : 9);
  return [...campaign.levels.values()].sort((left, right) => order(left) - order(right)).map(entry => ({ ...entry }));
}
