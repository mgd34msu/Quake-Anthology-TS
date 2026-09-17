import type { CvarRegistry } from "../../../core/cvars/index.ts";
import type { Q2MatchSelection } from "./types.ts";
import type { LmctfTravel } from "../../q2/multiplayer/lmctf/types.ts";

export function sourceQ2MatchSelection(provider: string, cvars: CvarRegistry, travel?: LmctfTravel): Q2MatchSelection {
  if (provider === "q2:lmctf") return { kind: "lmctf", ...(travel === undefined ? {} : { travel }) };
  if (provider === "q2:ctf") return { kind: "ctf" };
  if (provider === "q2:tag") return { kind: "tag" };
  if (provider === "q2:deathball") return { kind: "deathball", get team1Skin() { return cvars.variableString("dball_team1_skin"); },
    get team2Skin() { return cvars.variableString("dball_team2_skin"); }, get goalLimit() { return cvars.variableValue("goallimit"); } };
  return { kind: "standard" };
}
