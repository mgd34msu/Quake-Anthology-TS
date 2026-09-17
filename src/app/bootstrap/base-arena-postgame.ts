import { gameAtoi } from "../../core/game-numeric.ts";
import type { ArenaProgressionResult, ArenaResult, ArenaSkill } from "./base-arena-progression.ts";

export interface ArenaPodiumPlayer { readonly client: number; readonly rank: number; readonly score: number }
export interface ArenaPostgame {
  readonly result: ArenaResult;
  readonly players: readonly ArenaPodiumPlayer[];
  readonly playerClient: number;
}

/** Arguments exclude spPostgame. Native game sends zero-based ranks with RANK_TIED bit64. */
export function parseArenaPostgame(args: readonly string[], level: number, skill: ArenaSkill): ArenaPostgame {
  const number = (index: number): number => gameAtoi((args[index] ?? "").split("\0", 1)[0]?.slice(0, 1023) ?? "");
  const count = Math.min(8, Math.max(0, number(0))), playerClient = number(1);
  const players: ArenaPodiumPlayer[] = [];
  let rank = 8;
  for (let n = 0; n < count; n++) {
    const client = number(8 + n * 3), playerRank = ((number(9 + n * 3) & ~64) + 1) | 0;
    players.push({ client, rank: playerRank, score: number(10 + n * 3) });
    if (client === playerClient) rank = playerRank;
  }
  return { playerClient, players, result: { level, skill, rank, accuracy: number(2), impressive: number(3), excellent: number(4),
    gauntlet: number(5), frags: number(6), perfect: number(7) !== 0 } };
}
export interface ArenaPostgamePresentation {
  readonly result: ArenaProgressionResult;
  readonly podium: readonly ArenaPodiumPlayer[];
  readonly musicCommand: "music music/win" | "music music/loss";
  readonly winnerAnnouncementAfterMilliseconds: 1000;
  readonly controls: readonly ["retry", "next", "main"];
}
export function arenaPostgamePresentation(game: ArenaPostgame, result: ArenaProgressionResult): ArenaPostgamePresentation {
  return { result, podium: game.players.slice(0, 3), musicCommand: result.rank === 1 ? "music music/win" : "music music/loss",
    winnerAnnouncementAfterMilliseconds: 1000, controls: ["retry", "next", "main"] };
}
