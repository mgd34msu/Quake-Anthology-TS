import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containedSaveName, saveCommandPath, saveUnavailable, TimedAutosave, writeContainedSave } from "../../src/persistence/save-policy.ts";

test("console save names resolve in the save directory and preserve explicit import paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "save-command-"));
  try {
    const directory = join(root, "saves"), path = saveCommandPath(directory, "quicksave");
    expect(path).toBe(join(directory, "quicksave.sav"));
    expect(saveCommandPath(directory, "quicksave.sav")).toBe(path);
    expect(saveCommandPath(directory, "campaign/manual")).toBe(join(directory, "campaign", "manual.sav"));
    expect(saveCommandPath(directory, path)).toBe(path);
    const imported = join(root, "original.sav");
    expect(saveCommandPath(directory, imported)).toBe(imported);
    expect(() => containedSaveName(directory, imported)).toThrow(`outside the save directory: ${directory}`);
    expect(() => containedSaveName(directory, saveCommandPath(directory, "../outside"))).toThrow("outside the save directory");
    expect(() => saveCommandPath(directory, "")).toThrow("save name");
    await writeContainedSave(directory, path, Uint8Array.of(7, 3));
    expect(new Uint8Array(await readFile(saveCommandPath(directory, "quicksave")))).toEqual(Uint8Array.of(7, 3));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("timed autosave counts eligible play and retries once per interval", () => {
  const timer = new TimedAutosave(100);
  expect(timer.advance(60, true)).toBe(false);
  expect(timer.advance(1000, false)).toBe(false);
  expect(timer.advance(40, true)).toBe(true);
  expect(timer.advance(1000, true)).toBe(false);
  timer.completed();
  expect(timer.advance(99, true)).toBe(false);
  expect(timer.advance(1, true)).toBe(true);
  timer.worldChanged();
  expect(timer.advance(1, true)).toBe(false);
});

test("public saves reject dead players, deathmatch, intermission and network authority", () => {
  const state = { family: "q2", authority: "offline", mode: "coop", active: true, intermission: false, playerHealth: [100, 40] } satisfies Parameters<typeof saveUnavailable>[0];
  expect(saveUnavailable(state, "manual")).toBeNull();
  expect(saveUnavailable({ ...state, family: "q3", mode: "deathmatch", playerHealth: [0], intermission: true }, "manual")).toBeNull();
  for (const change of [{ playerHealth: [100, 0] }, { mode: "deathmatch" }, { intermission: true }, { authority: "server" }, { authority: "remote" }] satisfies readonly Partial<Parameters<typeof saveUnavailable>[0]>[])
    expect(saveUnavailable({ ...state, ...change }, "manual")).not.toBeNull();
  expect(saveUnavailable({ ...state, authority: "server", playerHealth: [] }, "transition")).toBeNull();
  expect(saveUnavailable({ ...state, authority: "remote" }, "transition")).not.toBeNull();
});

test("contained atomic save cannot follow a linked parent or overwrite reserved transition state", async () => {
  const root = await mkdtemp(join(tmpdir(), "save-policy-"));
  try {
    const directory = join(root, "saves"), outside = join(root, "outside");
    await mkdir(outside);
    const path = join(directory, "game", "manual.sav");
    await writeContainedSave(directory, path, Uint8Array.of(1, 2));
    await writeContainedSave(directory, path, Uint8Array.of(3, 4));
    expect(new Uint8Array(await readFile(path))).toEqual(Uint8Array.of(3, 4));
    expect(() => containedSaveName(directory, join(outside, "bad.sav"))).toThrow();
    expect(() => containedSaveName(directory, join(directory, "current.sav"))).toThrow("reserved");
    await symlink(outside, join(directory, "escape"));
    await expect(writeContainedSave(directory, join(directory, "escape", "bad.sav"), Uint8Array.of(9))).rejects.toThrow();
    expect(await Bun.file(join(outside, "bad.sav")).exists()).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
