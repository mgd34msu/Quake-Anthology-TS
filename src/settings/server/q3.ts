import { q3GameCvarDefinitions } from "../../content/q3/base/settings.ts";
import type { CvarDefinition } from "../../content/q3/base/settings.ts";
import { GameType } from "../../content/q3/base/shared/definitions.ts";
import type { Product } from "../../content/q3/base/shared/definitions.ts";
import { serverFriendlyFire, serverLimit } from "./common.ts";
import type { ServerSettingCollection } from "./types.ts";

function sourceDefault(product: Product, name: string): CvarDefinition {
  const definition = q3GameCvarDefinitions(product).find(definition => definition.name === name);
  if (definition === undefined) throw new Error(`Missing Q3 setting definition ${name}`);
  return definition;
}
export function q3LimitSettings(product: Product): ServerSettingCollection {
  return { id: "q3:limits", definitions: [
    serverLimit("server:time-limit", "timelimit", "Time limit (minutes)", Number(sourceDefault(product, "timelimit").value), "End play after this many minutes. Zero disables the limit."),
    serverLimit("server:frag-limit", "fraglimit", "Frag limit", Number(sourceDefault(product, "fraglimit").value), "End applicable matches at this score. Zero disables the limit."),
    serverLimit("server:capture-limit", "capturelimit", "Capture limit", Number(sourceDefault(product, "capturelimit").value), "End applicable team matches at this capture count. Zero disables the limit."),
  ] };
}
export function q3CombatSettings(product: Product): ServerSettingCollection {
  return { id: "q3:combat", definitions: [serverFriendlyFire({ kind: "value", name: "g_friendlyFire" }, Number(sourceDefault(product, "g_friendlyFire").value) !== 0)] };
}
export function q3MatchSettings(product: Product): ServerSettingCollection {
  const modes = [{ value: GameType.GT_FFA, label: "Free for all" }, { value: GameType.GT_TOURNAMENT, label: "Tournament" },
    { value: GameType.GT_SINGLE_PLAYER, label: "Single player" }, { value: GameType.GT_TEAM, label: "Team deathmatch" }, { value: GameType.GT_CTF, label: "Capture the flag" },
    ...(product === "missionpack" ? [{ value: GameType.GT_1FCTF, label: "One flag CTF" }, { value: GameType.GT_OBELISK, label: "Overload" }, { value: GameType.GT_HARVESTER, label: "Harvester" }] : [])];
  return { id: "q3:match", definitions: [{ id: "server:q3.game-type", kind: "choice", label: "Q3 match type", description: "Select source match rules for the next map. Equipment selections stay independent.",
    target: { kind: "value", name: "g_gametype" }, defaultValue: sourceDefault(product, "g_gametype").value, applyAt: "next-map",
    choices: modes.map(mode => ({ id: String(mode.value), label: mode.label })) }] };
}
