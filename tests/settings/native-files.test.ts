// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordingPath } from "../../src/app/bootstrap/demo-recording.ts";
import { DemoLibrary } from "../../src/app/bootstrap/demo-library.ts";
import { FrameCapture } from "../../src/capture/index.ts";
import { readSavedGame, sidecarPath, writeSavedGame } from "../../src/persistence/saved-game.ts";
import type { Q1SaveData } from "../../src/persistence/q1.ts";
import { nativeConfigLayout, type NativeConfigLayout } from "../../src/settings/native-config.ts";
import { insideNativeSaves, nativeSaveLayout } from "../../src/settings/native-saves.ts";
import { saveImageFixture } from "../support/save-fixtures.ts";

async function temporary(): Promise<string> {
  return mkdtemp(join(tmpdir(), "native-files-"));
}

const frame = { width: 2, height: 2, pixels: new Uint8Array(16).fill(255) };

test("demos use the original extension and folder for each family", () => {
  expect(recordingPath("/g", "run", { kind: "q1", protocol: 15, track: -1 })).toBe("/g/run.dem");
  expect(recordingPath("/g", "run", { kind: "qw", protocol: 28 })).toBe("/g/run.qwd");
  expect(recordingPath("/g", "run", { kind: "q2", protocol: { kind: "q2-classic", version: 34 } })).toBe("/g/demos/run.dm2");
  expect(recordingPath("/g", "run", { kind: "q3", protocol: 68 })).toBe("/g/demos/run.dm_68");
});

test("a stock game's layout names its own folder, with the test redirect receiving writes", async () => {
  const gamedir = await temporary();
  const redirect = await temporary();
  const layout = nativeConfigLayout({ family: "q2", edition: "classic", contentDirectory: "q2/baseq2", looseRoot: gamedir }, undefined, redirect, false);
  if (layout === null) throw new Error("expected a layout");
  expect(layout.directory).toBe(join(redirect, "q2/baseq2"));
  expect(layout.fallbacks).toEqual([gamedir]);
  expect(layout.screenshots).toEqual({ directory: "scrnshot", prefix: "quake", digits: 2 });
});

test("screenshots are numbered the way each original game numbers them", async () => {
  const root = await temporary();
  const readRgba = (): typeof frame => frame;
  const quake = new FrameCapture(root, { readRgba }, { directory: "", prefix: "quake", digits: 2 });
  expect((await quake.screenshot({ format: "tga" })).path).toBe(join(root, "quake00.tga"));
  expect((await quake.screenshot({ format: "tga" })).path).toBe(join(root, "quake01.tga"));
  const quake2 = new FrameCapture(root, { readRgba }, { directory: "scrnshot", prefix: "quake", digits: 2 });
  expect((await quake2.screenshot({ format: "tga" })).path).toBe(join(root, "scrnshot", "quake00.tga"));
  const quake3 = new FrameCapture(root, { readRgba });
  expect((await quake3.screenshot({ format: "jpg" })).path).toBe(join(root, "screenshots", "shot0000.jpg"));
  expect((await quake3.screenshot({ format: "tga", name: "named" })).path).toBe(join(root, "screenshots", "named.tga"));
});

test("the demo library finds recordings in the stock game's folder and still reads the user store", async () => {
  const user = await temporary();
  const native = await temporary();
  await mkdir(join(native, "demos"), { recursive: true });
  await writeFile(join(native, "first.dem"), "a");
  await writeFile(join(native, "demos", "second.dm2"), "b");
  await writeFile(join(user, "old.dem"), "c");
  const library = new DemoLibrary(user, { listFiles: async () => [], read: async () => undefined }, [native]);
  expect((await library.list()).map(entry => entry.id)).toEqual(["demos/second.dm2", "first.dem", "old.dem"]);
  expect(new TextDecoder().decode(await library.read("first.dem"))).toBe("a");
  expect(new TextDecoder().decode(await library.read("old.dem"))).toBe("c");
});

test("native save layouts follow the originals", () => {
  const folder: NativeConfigLayout = {
    format: "quake",
    script: "config.cfg",
    files: [],
    directory: "/g",
    fallbacks: [],
    screenshots: { directory: "", prefix: "quake", digits: 2 },
  };
  const q1 = nativeSaveLayout(folder, { family: "q1", edition: "classic", contentDirectory: "q1/id1" });
  expect(q1.locate("s1")).toBe("/g/s1.sav");
  expect(q1.original).toBe("v5");
  expect(nativeSaveLayout(folder, { family: "q1", edition: "rerelease", contentDirectory: "q1/rerelease/id1" }).original).toBe("v6");
  const q2 = nativeSaveLayout(folder, { family: "q2", edition: "classic", contentDirectory: "q2/baseq2" });
  // The engine-format file of a slot, and the file the original keeps there.
  expect(q2.locate("quick")).toBe("/g/save/quick/qts.sav");
  expect(q2.originalPath("quick")).toBe("/g/save/quick/server.ssv");
  expect(q2.original).toBe("q2-folder");
  expect(q2.slot("/g/save/quick/server.ssv")).toBe("quick");
  expect(q2.slot("/g/save/quick/base1.sav")).toBeNull();
  expect(() => q2.locate("current")).toThrow("current");
  expect(() => q2.locate("../x")).toThrow("Bad savedir");
  const rerelease = nativeSaveLayout(folder, { family: "q2", edition: "rerelease", contentDirectory: "q2/rerelease/baseq2" });
  expect(rerelease.locate("save0")).toBe("/g/baseq2/save/save0.sav");
  expect(rerelease.originalPath("save0")).toBe("/g/baseq2/save/save0.pak.gz");
  expect(rerelease.original).toBe("q2-pak");
  expect(rerelease.slot("/g/baseq2/save/save0.pak.gz")).toBe("save0");
  expect(q2.candidates("save0")).toEqual(["/g/save/save0/server.ssv", "/g/save/save0/qts.sav"]);
  expect(nativeSaveLayout(folder, { family: "q3", edition: "classic", contentDirectory: "q3a/baseq3" }).original).toBeNull();
  expect(insideNativeSaves(q1, "/g/s1.sav")).toBe(true);
  expect(insideNativeSaves(q1, "/elsewhere/s1.sav")).toBe(false);
});

test("an original-format save carries the engine sidecar until the original file changes", async () => {
  const directory = await temporary();
  const data: Q1SaveData = {
    format: { version: 5 },
    comment: "native_save",
    spawnParameters: Array.from({ length: 16 }, () => 0),
    skill: 1,
    map: "e1m1",
    time: 1,
    lightStyles: Array.from({ length: 64 }, () => "m"),
    globals: [],
    entities: [[{ key: "classname", value: "worldspawn" }], [{ key: "health", value: "100" }]],
    extensionText: "",
  };
  const image = saveImageFixture();
  const path = join(directory, "s1.sav");
  await writeSavedGame(directory, path, { kind: "q1-source", data }, image);
  expect((await readdir(directory)).sort()).toEqual(["s1.qtsave", "s1.sav"]);
  expect(sidecarPath(path)).toBe(join(directory, "s1.qtsave"));
  expect((await readSavedGame(path)).kind).toBe("shared");
  // The original game rewrote the slot: the sidecar no longer belongs to it.
  await writeSavedGame(directory, path, { kind: "q1-source", data: { ...data, time: 2 } });
  const reloaded = await readSavedGame(path);
  expect(reloaded.kind).toBe("q1-source");
  expect((await readFile(path))[0]).not.toBe(81);
});

test("migration moves a stock game's demos into its own folder, never overwrites, and is safe to rerun", async () => {
  const { discoverInstalledContent } = await import("../../src/content/catalog/index.ts");
  const { migrateNativeData } = await import("../../src/app/bootstrap/native-migration.ts");
  const { testCorpusRoot } = await import("../support/corpus.ts");
  const userContentRoot = await temporary();
  const nativeConfigRoot = await temporary();
  const store = join(userContentRoot, "q1", "id1");
  await mkdir(store, { recursive: true });
  await writeFile(join(store, "moved.dem"), "demo");
  await writeFile(join(store, "clash.dem"), "mine");
  await mkdir(join(nativeConfigRoot, "q1", "id1"), { recursive: true });
  await writeFile(join(nativeConfigRoot, "q1", "id1", "clash.dem"), "different original");
  const catalog = await discoverInstalledContent({ corpusRoot: testCorpusRoot(), userContentRoot });
  await migrateNativeData(catalog, { userContentRoot, nativeConfigRoot });
  expect(await readFile(join(nativeConfigRoot, "q1", "id1", "moved.dem"), "utf8")).toBe("demo");
  expect(await readdir(store)).toEqual(["clash.dem"]);
  expect(await readFile(join(store, "clash.dem"), "utf8")).toBe("mine");
  expect(await readFile(join(nativeConfigRoot, "q1", "id1", "clash.dem"), "utf8")).toBe("different original");
});

test("the QuakeWorld client keeps config.cfg in its own qw folder", () => {
  const layout = nativeConfigLayout({ family: "q1", edition: "quakeworld", contentDirectory: "q1/qw", looseRoot: "/games/quake/qw" });
  expect(layout?.files.map(file => file.path)).toEqual(["/games/quake/qw/config.cfg"]);
  expect(layout?.format).toBe("quake");
});

test("rerelease Quake key names and in_ actions cover the executable's tables", async () => {
  const { NativeConfig } = await import("../../src/settings/native-config.ts");
  const directory = await temporary();
  await writeFile(
    join(directory, "kexengine.cfg"),
    [
      'bind pageup "impulse 3"',
      'bind rctrl "*in_strafe"',
      'bind mouse_misc1 "*in_lookup"',
      'bind left "*in_left"',
      'bind joy_3 "impulse 4"',
      'bind kp_8 "*in_forward"',
    ].join("\n") + "\n",
  );
  const layout = nativeConfigLayout({ family: "q1", edition: "rerelease", contentDirectory: "q1/rerelease/id1", looseRoot: null }, undefined, directory, true);
  if (layout === null) throw new Error("expected a layout");
  const native = new NativeConfig({
    ...layout,
    files: layout.files.map(file => ({ ...file, path: join(directory, "kexengine.cfg"), redirected: join(directory, "kexengine.cfg") })),
  });
  expect(await native.readBindings()).toEqual([
    ["pgup", "impulse 3"],
    ["ctrl", "+strafe"],
    ["mouse4", "+lookup"],
    ["leftarrow", "+left"],
    ["joy4", "impulse 4"],
    ["kp_uparrow", "+forward"],
  ]);
  await native.writeBindings([
    ["pgup", "impulse 3"],
    ["kp_uparrow", "+forward"],
  ]);
  expect(await readFile(join(directory, "kexengine.cfg"), "utf8")).toBe('bind pageup "impulse 3"\nbind kp_8 "*in_forward"\n');
});
