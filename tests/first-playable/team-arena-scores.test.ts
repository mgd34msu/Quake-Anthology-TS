import { describe, expect, test } from "bun:test";
import { calculateTeamArenaScore, decodeTeamArenaScore, encodeTeamArenaScore, parseTeamArenaPostgame, recordTeamArenaScore, teamArenaScorePath } from "../../src/app/bootstrap/team-arena-scores.ts";
import type { TeamArenaScoreInput } from "../../src/app/bootstrap/team-arena-scores.ts";

const input: TeamArenaScoreInput = {
  stats: parseTeamArenaPostgame(["8", "0", "50", "1", "2", "3", "4", "5", "20", "1", "10", "0", "61000", "6"]),
  matchStartTime: 1000, skill: 3, timeToBeat: 90,
};
const empty = decodeTeamArenaScore(null);

describe("Team Arena native postgame scores", () => {
  test("source command arguments and time, shutout, and skill bonuses", () => {
    const result = calculateTeamArenaScore(input, empty);
    expect(result.score).toEqual({ accuracy: 50, impressives: 1, excellents: 2, defends: 3,
      assists: 4, gauntlets: 5, baseScore: 20, perfects: 1, redScore: 10, blueScore: 0,
      captures: 6, time: 60, timeBonus: 300, shutoutBonus: 100, skillBonus: 3, score: 1260 });
    expect(result.newHighScore).toBe(true);
    expect(result.newBestTime).toBe(false);
  });
  test("native record field order and short-read zero padding", () => {
    const bytes = encodeTeamArenaScore(calculateTeamArenaScore(input, empty).score);
    const words = new DataView(bytes.buffer);
    expect(Array.from({ length: 17 }, (_, i) => words.getInt32(i * 4, true)))
      .toEqual([64, 1260, 10, 0, 1, 50, 1, 2, 3, 4, 5, 6, 60, 300, 100, 3, 20]);
    expect(decodeTeamArenaScore(bytes)).toEqual(calculateTeamArenaScore(input, empty).score);
    expect(decodeTeamArenaScore(bytes.subarray(0, 8)).score).toBe(1260);
    expect(decodeTeamArenaScore(bytes.subarray(0, 8)).time).toBe(0);
    expect(decodeTeamArenaScore(new Uint8Array([63]))).toEqual(empty);
    expect(teamArenaScorePath("mpteam1", 4)).toBe("games/mpteam1_4.game");
  });
  test("losses and tied scores do not replace record, even with a faster time", async () => {
    const previous = calculateTeamArenaScore(input, empty).score;
    const writes: string[] = [];
    const files = { readFile: async () => encodeTeamArenaScore(previous),
      writeFile: async (path: string) => { writes.push(path); } };
    const loss = await recordTeamArenaScore({ ...input, map: "mpteam1", gameType: 4,
      stats: { ...input.stats, redScore: 0, blueScore: 10, endTime: 31000 } }, files);
    expect(loss.newBestTime).toBe(true);
    expect(loss.newHighScore).toBe(false);
    await recordTeamArenaScore({ ...input, map: "mpteam1", gameType: 4 }, files);
    expect(writes).toEqual([]);
    await recordTeamArenaScore({ ...input, skill: 4, map: "mpteam1", gameType: 4 }, files);
    expect(writes).toEqual(["games/mpteam1_4.game"]);
  });
  test("skill truncates with minimum one; expired time gets no bonus", () => {
    const result = calculateTeamArenaScore({ ...input, skill: -2, timeToBeat: 60 }, empty);
    expect(result.score.skillBonus).toBe(1);
    expect(result.score.timeBonus).toBe(0);
    expect(calculateTeamArenaScore({ ...input, skill: 2.9 }, empty).score.skillBonus).toBe(2);
  });
});
