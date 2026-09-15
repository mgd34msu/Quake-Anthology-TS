/* UI_CalcPostGameStats and postGameInfo_t, code/ui/ui_atoms.c and ui_local.h.
 * Copyright (C) 1999-2005 Id Software, Inc. SPDX-License-Identifier: GPL-2.0-or-later */
import { gameAtoi } from "../../core/game-numeric.ts";
import { qvmFloatToInt } from "../../core/numeric.ts";

export interface TeamArenaPostgameStats {
  readonly accuracy: number; readonly impressives: number; readonly excellents: number;
  readonly defends: number; readonly assists: number; readonly gauntlets: number;
  readonly baseScore: number; readonly perfects: number; readonly redScore: number;
  readonly blueScore: number; readonly endTime: number; readonly captures: number;
}
export interface TeamArenaScore extends Omit<TeamArenaPostgameStats, "endTime"> {
  readonly score: number; readonly time: number; readonly timeBonus: number;
  readonly shutoutBonus: number; readonly skillBonus: number;
}
export interface TeamArenaScoreInput {
  readonly stats: TeamArenaPostgameStats;
  readonly matchStartTime: number; readonly skill: number; readonly timeToBeat: number;
}
export interface TeamArenaScoreFiles {
  readonly readFile: (path: string) => Promise<Uint8Array | null>;
  readonly writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
}
export interface TeamArenaScoreResult {
  readonly score: TeamArenaScore; readonly previous: TeamArenaScore;
  readonly newHighScore: boolean; readonly newBestTime: boolean; readonly won: boolean;
}

/** Arguments exclude the command name, as CommandInvocation.args does. */
export function parseTeamArenaPostgame(args: readonly string[]): TeamArenaPostgameStats {
  const arg = (index: number): number => gameAtoi((args[index] ?? "").split("\0", 1)[0]?.slice(0, 1023) ?? "");
  return { accuracy: arg(2), impressives: arg(3), excellents: arg(4), defends: arg(5),
    assists: arg(6), gauntlets: arg(7), baseScore: arg(8), perfects: arg(9),
    redScore: arg(10), blueScore: arg(11), endTime: arg(12), captures: arg(13) };
}

export function calculateTeamArenaScore(input: TeamArenaScoreInput, previous: TeamArenaScore): TeamArenaScoreResult {
  const { endTime, ...stats } = input.stats;
  const time = qvmFloatToInt(Math.fround(Math.fround(Math.fround(endTime) - Math.fround(input.matchStartTime)) / 1000));
  const timeBonus = time < input.timeToBeat ? Math.imul((input.timeToBeat - time) | 0, 10) : 0;
  const won = stats.redScore > stats.blueScore;
  const shutoutBonus = won && stats.blueScore <= 0 ? 100 : 0;
  const skillBonus = Math.max(1, qvmFloatToInt(input.skill));
  const score: TeamArenaScore = { ...stats, time, timeBonus, shutoutBonus, skillBonus,
    score: Math.imul((stats.baseScore + shutoutBonus + timeBonus) | 0, skillBonus) };
  return { score, previous, won, newHighScore: won && score.score > previous.score, newBestTime: time < previous.time };
}

export function teamArenaScorePath(map: string, gameType: number): string {
  return `games/${map.split("\0", 1)[0]?.slice(0, 63) ?? ""}_${gameType | 0}.game`.slice(0, 63);
}

/** Native little-endian header plus the sixteen int32 fields of postGameInfo_t. */
export function encodeTeamArenaScore(info: TeamArenaScore): Uint8Array {
  const bytes = new Uint8Array(68), view = new DataView(bytes.buffer);
  view.setInt32(0, 64, true);
  [info.score, info.redScore, info.blueScore, info.perfects, info.accuracy, info.impressives,
    info.excellents, info.defends, info.assists, info.gauntlets, info.captures, info.time,
    info.timeBonus, info.shutoutBonus, info.skillBonus, info.baseScore]
    .forEach((value, index) => view.setInt32(4 + index * 4, value, true));
  return bytes;
}

/** Source zero-initializes both header and record before accepting short reads. */
export function decodeTeamArenaScore(bytes: Uint8Array | null): TeamArenaScore {
  const padded = new Uint8Array(68);
  if (bytes !== null) padded.set(bytes.subarray(0, 68));
  const view = new DataView(padded.buffer);
  if (view.getInt32(0, true) !== 64) padded.fill(0);
  const field = (index: number): number => view.getInt32(4 + index * 4, true);
  return { score: field(0), redScore: field(1), blueScore: field(2), perfects: field(3),
    accuracy: field(4), impressives: field(5), excellents: field(6), defends: field(7),
    assists: field(8), gauntlets: field(9), captures: field(10), time: field(11),
    timeBonus: field(12), shutoutBonus: field(13), skillBonus: field(14), baseScore: field(15) };
}

export async function recordTeamArenaScore(input: TeamArenaScoreInput & { readonly map: string; readonly gameType: number }, files: TeamArenaScoreFiles): Promise<TeamArenaScoreResult> {
  const path = teamArenaScorePath(input.map, input.gameType);
  const result = calculateTeamArenaScore(input, decodeTeamArenaScore(await files.readFile(path)));
  if (result.newHighScore) await files.writeFile(path, encodeTeamArenaScore(result.score));
  return result;
}
