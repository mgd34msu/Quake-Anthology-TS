/* LM_CTF 6.0 p_hud.c compact team scoreboard protocol. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { LmctfContext, LmctfScoreRow } from "./types.ts";

export function lmctfScoreboard(context: LmctfContext, actor: ActorId): undefined {
  const rows: LmctfScoreRow[] = [];
  for (const [id, state] of context.states) {
    const player = context.hooks.player(id);
    if (player !== null && player.connected) rows.push({ actor: id, slot: player.slot, name: player.name, team: state.team, score: state.statistics.get("score") ?? 0, ping: Math.min(player.ping, 999) });
  }
  rows.sort((a, b) => b.score - a.score);
  let layout = 'xv 0 yv 32 string2 "Scr Png Name        " xv 0 yv 40 string2 "------------------- " xv 160 yv 32 string2 "Scr Png Name        " xv 160 yv 40 string2 "------------------- " ';
  for (const team of [1, 2]) {
    for (const [index, row] of rows.filter(row => row.team === team).slice(0, 21).entries()) {
      const entry = `ctf ${team === 1 ? 0 : 160} ${48 + index * 8} ${row.slot} ${row.score} ${row.ping} `;
      if (layout.length + entry.length <= 1024) layout += entry;
    }
  }
  return context.hooks.emit({ kind: "scoreboard", actor, rows, layout });
}


export function lmctfMenu(context: LmctfContext, actor: ActorId): undefined {
  const entries: { readonly label: string; readonly command: string | null }[] = [
    { label: "Join Red Team", command: "team red" }, { label: "Join Blue Team", command: "team blue" }, { label: "Become Observer", command: "observe" },
  ];
  if ((context.rules.ctfFlags & 32768) === 0) entries.push({ label: "Voting Menu", command: "lmctf-vote" });
  return context.hooks.emit({ kind: "menu", actor, title: "LMCTF Menu", entries });
}
