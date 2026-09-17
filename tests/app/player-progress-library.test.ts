import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PlayerProgressStore } from "../../src/app/bootstrap/player-progress.ts";
import { PlayerProgressLibrary } from "../../src/app/bootstrap/player-progress-library.ts";

test("library reads persisted achievements and completed levels for the retained seat only", async () => {
  const root = await mkdtemp(join(tmpdir(), "player-progress-menu-"));
  try {
    const file = join(root, "player-progress.json"), writer = await PlayerProgressStore.open(file);
    await writer.record({ kind: "achievement", source: "q1", participant: "local-seat:0", event: "award-one", award: "ACH_COMPLETE_E1" });
    await writer.record({ kind: "level-completed", source: "q2", participant: "local-seat:0", event: "level-one", map: "base1" });
    await writer.record({ kind: "achievement", source: "q1", participant: "local-seat:1", event: "award-two", award: "OTHER_PLAYER" });
    const reopened = PlayerProgressStore.open(file);
    let participant = "local-seat:0";
    const service = new PlayerProgressLibrary(() => reopened, () => participant);
    await service.load();
    expect(service.entries().map(entry => entry.label)).toEqual(["ACH_COMPLETE_E1", "base1"]);
    expect(service.entries()[1]?.detail).toBe("Q2 · Level completed");
    const first = service.entries()[0]; if (first === undefined) throw new Error("Missing actual stored achievement");
    service.activate(first.id); expect(service.status()).toContain("Achievement earned");
    participant = "local-seat:1"; await service.load(); expect(service.entries().map(entry => entry.label)).toEqual(["OTHER_PLAYER"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
