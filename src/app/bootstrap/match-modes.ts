import type { GameFamily } from "../../contracts/content.ts";

export type MatchRules = "standard" | "ctf" | "lmctf" | "tag" | "deathball" | "horde";
export interface MatchModeSelection {
  readonly family: GameFamily;
  readonly edition: string;
  readonly campaign: string;
  readonly mode: "singleplayer" | "coop" | "deathmatch";
  readonly rules: MatchRules;
}
export function matchModeUnavailable(selection: MatchModeSelection): string | null {
  const { family, mode, rules } = selection;
  if (rules === "standard") return null;
  if (rules === "horde") return family === "q3" ? null : mode === "deathmatch" ? "Horde requires single player or cooperative mode" : null;
  if (rules === "tag") return family !== "q2" ? "Tag requires a Quake II source game" : mode !== "deathmatch" ? "Tag requires deathmatch mode" : null;
  if (rules === "ctf" && (family === "q3" || family === "q1")) return mode !== "deathmatch" ? "Capture the Flag requires deathmatch mode" : null;
  if (family !== "q2") return "These match rules require a Quake II source game";
  if (mode !== "deathmatch") return "These match rules require deathmatch mode";
  if (rules === "ctf" || rules === "lmctf") return null;
  return null;
}
/** Geometry is never guessed: source-specific objectives must be authored or explicitly placed. */
export function matchMapUnavailable(selection: MatchModeSelection, classnames: readonly string[]): string | null {
  const unavailable = matchModeUnavailable(selection); if (unavailable !== null) return unavailable;
  const classes = new Set(classnames);
  if (selection.rules === "deathball") {
    const required = ["dm_dball_ball", "dm_dball_ball_start", "dm_dball_goal", "dm_dball_team1_start", "dm_dball_team2_start"];
    const missing = required.filter(name => !classes.has(name));
    if (missing.length !== 0) return `DeathBall map is missing: ${missing.join(", ")}`;
  }
  if (selection.rules === "horde" && selection.family !== "q3" && (!classes.has("horde_manager") || ![...classes].some(name => name.startsWith("info_monster_start"))))
    return "Horde requires an authored horde_manager and monster spawn points";
  if (selection.rules === "ctf" || selection.rules === "lmctf") {
    const flags = selection.family === "q3" ? ["team_CTF_redflag", "team_CTF_blueflag"] : ["item_flag_team1", "item_flag_team2"];
    const missing = flags.filter(name => !classes.has(name));
    if (missing.length !== 0) return `CTF map is missing: ${missing.join(", ")}`;
  }
  if (selection.mode === "deathmatch" && selection.rules !== "deathball" && !classes.has("info_player_deathmatch") && !(selection.family === "q3" && classes.has("team_CTF_redplayer") && classes.has("team_CTF_blueplayer")))
    return "Deathmatch requires an authored player spawn";
  return null;
}
