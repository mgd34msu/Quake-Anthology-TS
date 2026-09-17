import { expect, test } from "bun:test";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { BaseArenaProgression, type ArenaResult } from "../../src/app/bootstrap/base-arena-progression.ts";

function create() {
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("progress").session, origin: { kind: "server-console" } } });
  return { cvars, progress: new BaseArenaProgression(cvars, { regularLevels: 4, training: 4, final: 5, totalLevels: 6 }) };
}
const result: ArenaResult = { level: 0, skill: 2, rank: 1, accuracy: 55, impressive: 2, excellent: 1, gauntlet: 0, frags: 99, perfect: false };
test("source best-rank tie chooses highest skill; training, tier and final preserve ordering", () => {
  const { progress } = create();
  expect(progress.currentLevel()).toBe(4);
  expect(progress.record({ ...result, level: 4 }).unlockedMovie).toBe(1);
  expect(progress.currentLevel()).toBe(0);
  progress.record(result); progress.record({ ...result, skill: 5 });
  expect(progress.best(0)).toEqual({ rank: 1, skill: 5 });
  progress.record({ ...result, skill: 5, rank: 3 });
  expect(progress.best(0)).toEqual({ rank: 1, skill: 5 });
  for (const level of [1, 2]) progress.record({ ...result, level });
  expect(progress.movieUnlocked(2)).toBe(false);
  expect(progress.record({ ...result, level: 3 }).unlockedMovie).toBe(2);
  expect(progress.currentLevel()).toBe(5);
  expect(progress.record({ ...result, level: 3 }).unlockedMovie).toBeNull();
  expect(progress.record({ ...result, level: 5 }).completedTier).toBe(2);
});
test("medals retain source thresholds and archive values across a new owner", () => {
  const { cvars, progress } = create();
  progress.record(result);
  const next = progress.record({ ...result, accuracy: 49, frags: 2, perfect: true });
  expect(next.awards).toContainEqual({ medal: 4, amount: 100 });
  expect(progress.award(0)).toBe(1);
  expect(progress.award(5)).toBe(1);
  const reopened = new BaseArenaProgression(cvars, progress.catalog);
  expect(reopened.best(0)).toEqual({ rank: 1, skill: 2 });
  reopened.unlockMedals(); expect(reopened.award(5)).toBe(100);
  reopened.unlockLevels(); expect(reopened.movieUnlocked(8)).toBe(true);
  reopened.reset(); expect(reopened.best(0).rank).toBe(0); expect(reopened.award(5)).toBe(0);
});

test("postgame parses source tied ranks and preserves podium order and single-shot music", async () => {
  const { parseArenaPostgame, arenaPostgamePresentation } = await import("../../src/app/bootstrap/base-arena-postgame.ts");
  const game = parseArenaPostgame(["2", "4", "51", "3", "2", "1", "101", "1", "4", "64", "10", "8", "1", "9"], 0, 3);
  expect(game.result.rank).toBe(1); expect(game.result.perfect).toBe(true);
  const view = arenaPostgamePresentation(game, create().progress.record(game.result));
  expect(view.podium.map(player => player.client)).toEqual([4, 8]);
  expect(view.musicCommand).toBe("music music/win"); expect(view.winnerAnnouncementAfterMilliseconds).toBe(1000);
});

test("training locks ordinary tiers; archived cvars reopen on a distinct registry", () => {
  const { cvars, progress } = create();
  expect(progress.levelAvailable(0)).toBe(false);
  progress.record({ ...result, level: 4 });
  expect(progress.levelAvailable(3)).toBe(true); expect(progress.levelAvailable(5)).toBe(false);
  progress.record(result);
  const fresh = create();
  for (const value of cvars.archiveEntries()) fresh.cvars.set(value.name, value.value, true);
  expect(fresh.progress.best(0)).toEqual({ rank: 1, skill: 2 });
  expect(fresh.progress.award(0)).toBe(2);
});
