/* LM_CTF 6.0 g_cmds.c referee commands. GPL-2.0-or-later. */
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { LmctfMatch } from "./match.ts";
import { lmctfName, lmctfPlayer, lmctfPrint, type LmctfContext } from "./types.ts";

export function lmctfAdminCommand(context: LmctfContext, match: LmctfMatch, entity: Q2Entity, game: Q2GameServices, name: string, args: readonly string[]): boolean {
  const state = lmctfPlayer(context, entity.actor.id);
  const print = (text: string) => lmctfPrint(game, text, entity.actor.id);
  if (name === "pausematch" || name === "unpausematch" || name === "pause_match") {
    if (name !== "pause_match" || (state.extraFlags & 2) !== 0) match.togglePause(game);
    return true;
  }
  if (name === "referee") {
    const password = args.join(" ");
    if (password === context.rules.rconPassword) {
      if (password === "") print("Rcon Mode is off\n"); else { state.extraFlags |= 6; print("You are now an Rcon\n"); }
    } else if (password === context.rules.refPassword) {
      if (password === "") print("Referee Mode is off\n"); else { state.extraFlags = (state.extraFlags | 2) & ~4; print("You are now a Referee\n"); }
    } else { state.extraFlags &= ~6; print("Incorrect Referee Password\n"); }
    return true;
  }
  if (name === "match") {
    if ((state.extraFlags & 2) === 0) { print("You are not a Referee\n"); return true; }
    const map = args.join(" ");
    if (map === "") print("USAGE: match <mapname>\n");
    else if (!context.rules.mapList.includes(map)) print(`${map} is not a map from the maplist.\n`);
    else { print("Match countdown beginning.\n"); match.changeMap(map, true); }
    return true;
  }
  if (!["lock", "unlock", "startmatch", "stopmatch", "gotomap"].includes(name)) return false;
  if ((state.extraFlags & 2) === 0) { print("Referee-only command denied.\n"); return true; }
  switch (name) {
    case "lock": case "unlock": match.teamsLocked = !match.teamsLocked; lmctfPrint(game, `Teams are now ${match.teamsLocked ? "" : "un"}locked\n`); break;
    case "startmatch": if (match.phase !== "none") print("Match already running, stop it first\n"); else match.start(game); break;
    case "stopmatch": if (match.phase === "none") print("No match running\n"); else { match.stop(); lmctfPrint(game, `Match stopped by ${lmctfName(context, entity.actor.id)}\n`); } break;
    case "gotomap": {
      const map = args.join(" ").toLowerCase();
      if (map.length > 0) { if (context.rules.mapList.includes(map)) match.changeMap(map, false); else print(`${map} is not a map from the maplist.\n`); }
      break;
    }
  }
  return true;
}
