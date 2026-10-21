import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAudioSettings } from "../../src/app/bootstrap/audio-settings.ts";
import { loadCvarArchive } from "../../src/app/bootstrap/cvar-archives.ts";
import { ConfigStore } from "../../src/settings/config.ts";

// A saved user document that cannot be decoded behaves like the absent
// one every loader already admits (defaults), never a dead boot.
test("undecodable settings documents load as absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-settings-bad-"));
  try {
    const store = new ConfigStore(root);
    await mkdir(join(root, "input"), { recursive: true });
    await writeFile(join(root, "input/seat-1.json"), "{ torn write");
    await writeFile(join(root, "input/routing.json"), "not json at all");
    await writeFile(join(root, "input/global-tuning.json"), "[1, 2");
    await writeFile(join(root, "gyro.json"), "\x00\x01\x02");
    await writeFile(join(root, "audio.json"), "{");
    await mkdir(join(root, "cvars/source"), { recursive: true });
    await writeFile(join(root, "cvars/source/test.json"), "{bad");
    expect(await store.loadSeat("input/seat-1.json")).toBeNull();
    expect(await store.loadInputRouting("input/routing.json")).toBeNull();
    expect(await store.loadGlobalTuning("input/global-tuning.json")).toBeNull();
    expect(await store.loadGyro("gyro.json")).toBeNull();
    expect(await loadAudioSettings(store)).toEqual({});
    expect(await loadCvarArchive(store, ["source", "test"], "q3")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
