import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("version 1 progress files still load and the next write upgrades them to version 2 with ranked results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "progress-v1-")), file = join(directory, "player-progress.json");
  try {
    await writeFile(file, JSON.stringify({ version: 1, events: [{ kind: "match-completed", source: "q2", participant: "local-seat:0", event: "m:1", map: "q2dm1", score: 3 }] }));
    const store = await PlayerProgressStore.open(file);
    expect(store.all()).toHaveLength(1);
    await store.record({ kind: "ranked-match", source: "q3", participant: "Host", event: "m:2", map: "q3dm1", score: 5, won: true, rules: "q3:ffa" });
    const reopened = await PlayerProgressStore.open(file);
    expect(reopened.all().map(event => event.kind)).toEqual(["match-completed", "ranked-match"]);
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
