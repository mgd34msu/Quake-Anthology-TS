import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlayerProgressStore, type PlayerProgressEvent } from "../../src/app/bootstrap/player-progress.ts";

test("participant events survive fresh file open; duplicate replay and concurrent writes do not duplicate awards", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qts-progress-"));
  try {
    const file = join(directory, "players.json"), store = await PlayerProgressStore.open(file);
    const event: PlayerProgressEvent = { kind: "achievement", source: "q1", participant: "seat-a", event: "campaign-one:award-one", award: "secret" };
    expect(await Promise.all([store.record(event), store.record(event)])).toEqual([true, false]);
    expect(await store.record({ ...event, participant: "seat-b" })).toBe(true);
    await store.record({ kind: "match-completed", source: "q2", participant: "seat-a", event: "match-2", map: "base1", score: 12 });
    const fresh = await PlayerProgressStore.open(file);
    expect(fresh.list("seat-a")).toHaveLength(2); expect(fresh.list("seat-b")).toHaveLength(1);
    expect(await fresh.record(event)).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
