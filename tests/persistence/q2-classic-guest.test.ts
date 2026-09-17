import { expect, test } from "bun:test";
import { createContentDigest } from "../../src/contracts/content.ts";
import { ClassicOriginalSaveFiles, decodeQ2ClassicOriginalSave, encodeQ2ClassicOriginalSave, type Q2ClassicOriginalIdentity } from "../../src/persistence/q2-classic-guest.ts";
import { encodeCheckpointValue } from "../../src/persistence/value.ts";
import type { WindowsFile } from "../../src/guest/runtime/windows/contracts.ts";

const identity: Q2ClassicOriginalIdentity = { module: { id: "q2:classic", artifactPath: "gamex86.dll", revision: "source-build",
  digest: createContentDigest("a".repeat(64)) }, map: "maps/base1.bsp" };
const server = { configstrings: [{ index: 0, value: "base1" }], portals: [{ portal: 1, open: true }], cvars: encodeCheckpointValue({ skill: "1" }) };
function write(files: ClassicOriginalSaveFiles, path: string, bytes: Uint8Array): void {
  const file = files.openFile(path, { read: false, write: true, creation: 2 });
  if (file === null) throw new Error("Missing callback file");
  try { expect(file.write(0, bytes)).toBe(bytes.length); file.flush(); } finally { file.close(); }
}

test("original native callbacks capture and restore exact files through the same CRT capability", () => {
  const files = new ClassicOriginalSaveFiles();
  const save = files.capture(identity, () => server, (game, level, autosave) => {
    expect(autosave).toBe(true); write(files, game, Uint8Array.of(1, 2, 3)); write(files, level, Uint8Array.of(4, 5));
  }, true);
  const decoded = decodeQ2ClassicOriginalSave(encodeQ2ClassicOriginalSave(save), identity);
  expect(decoded).toEqual(save);
  files.restore(decoded, identity, (game, level) => {
    for (const [path, expected] of [[game, save.game], [level, save.level]] satisfies readonly (readonly [string, Uint8Array])[]) {
      const file = files.openFile(path, { read: true, write: false, creation: 3 });
      if (file === null) throw new Error("Missing callback file");
      expect(file.read(0, file.size())).toEqual(expected); file.close();
    }
  });
  expect(() => files.openFile("__qts_original_save/game.ssv", { read: true, write: false, creation: 3 })).toThrow("outside");
});

test("module mismatch rejects before callbacks, and partial or leaked captures cannot publish", () => {
  const files = new ClassicOriginalSaveFiles();
  const save = files.capture(identity, () => server, (game, level) => { write(files, game, Uint8Array.of(1)); write(files, level, Uint8Array.of(2)); });
  let calls = 0;
  expect(() => files.restore(save, { ...identity, module: { ...identity.module, revision: "changed" } }, () => { calls++; })).toThrow("differs");
  expect(calls).toBe(0);
  expect(() => files.restore(save, identity, () => {})).toThrow("consume both");
  expect(() => files.capture(identity, () => server, game => write(files, game, Uint8Array.of(1)))).toThrow("both");
  const retained: WindowsFile[] = [];
  expect(() => files.capture(identity, () => server, (game, level) => {
    const file = files.openFile(game, { read: false, write: true, creation: 2 });
    if (file === null) throw new Error("Missing callback file");
    retained.push(file); file.write(0, Uint8Array.of(1)); write(files, level, Uint8Array.of(2));
  })).toThrow("retained");
  expect(() => retained[0]?.size()).toThrow("retired");
  const recovered = files.capture(identity, () => server, (game, level) => { write(files, game, Uint8Array.of(6)); write(files, level, Uint8Array.of(7)); });
  expect(recovered.game).toEqual(Uint8Array.of(6));
});

test("save overlay delegates ordinary files and refuses restore-time writes", () => {
  const delegated: string[] = [];
  const files = new ClassicOriginalSaveFiles(path => { delegated.push(path); return null; });
  expect(files.openFile("game.log", { read: false, write: true, creation: 4 })).toBeNull();
  expect(delegated).toEqual(["game.log"]);
  const save = files.capture(identity, () => server, (game, level) => { write(files, game, Uint8Array.of(1)); write(files, level, Uint8Array.of(2)); });
  expect(() => files.restore(save, identity, game => { files.openFile(game, { read: true, write: true, creation: 3 }); })).toThrow("read-only");
});

test("retained travel captures only level bytes and returns the new owner after consuming them", () => {
  const files = new ClassicOriginalSaveFiles();
  const bytes = files.captureTravelLevel(path => {
    expect(() => files.openFile("__qts_original_save/game.ssv", { read: false, write: true, creation: 2 })).toThrow("outside");
    write(files, path, Uint8Array.of(8, 9, 10));
  });
  expect(bytes).toEqual(Uint8Array.of(8, 9, 10));
  const owner = { generation: 2 };
  const result = files.withTravelLevel(bytes, path => {
    const file = files.openFile(path, { read: true, write: false, creation: 3 });
    if (file === null) throw new Error("Missing travel file");
    bytes[0] = 99;
    expect(file.read(0, file.size())).toEqual(Uint8Array.of(8, 9, 10));
    file.close();
    return owner;
  });
  expect(result).toBe(owner);
});

test("failed or incomplete travel callbacks retire handles and allow the next operation", () => {
  const files = new ClassicOriginalSaveFiles(), retained: WindowsFile[] = [];
  expect(() => files.captureTravelLevel(() => {})).toThrow("write a level");
  expect(() => files.captureTravelLevel(path => {
    const file = files.openFile(path, { read: false, write: true, creation: 2 });
    if (file === null) throw new Error("Missing travel file");
    retained.push(file); file.write(0, Uint8Array.of(1));
  })).toThrow("retained");
  expect(() => retained[0]?.size()).toThrow("retired");
  expect(() => files.withTravelLevel(new Uint8Array(0), () => {})).toThrow("level bytes");
  expect(() => files.withTravelLevel(Uint8Array.of(1), () => {})).toThrow("consume");
  expect(() => files.withTravelLevel(Uint8Array.of(1), path => {
    expect(() => files.captureTravelLevel(() => {})).toThrow("overlap");
    const file = files.openFile(path, { read: true, write: false, creation: 3 });
    if (file === null) throw new Error("Missing travel file");
    retained.push(file); file.read(0, 1);
    throw new Error("travel failed");
  })).toThrow("travel failed");
  expect(() => retained[1]?.size()).toThrow("retired");
  expect(files.captureTravelLevel(path => write(files, path, Uint8Array.of(2)))).toEqual(Uint8Array.of(2));
});

test("native original payload retains versioned departed levels and accepts older saves without history", () => {
  const files = new ClassicOriginalSaveFiles();
  const current = files.capture(identity, () => server, (game, level) => { write(files, game, Uint8Array.of(1)); write(files, level, Uint8Array.of(2)); });
  const visited = { version: 1, map: "maps/base2.bsp", level: Uint8Array.of(3, 4), configstrings: [{ index: 1, value: "departed" }], portals: [{ portal: 2, open: false }] } satisfies import("../../src/persistence/q2-classic-guest.ts").Q2ClassicVisitedLevel;
  const history = { ...current, visitedLevels: [visited] };
  expect(decodeQ2ClassicOriginalSave(encodeQ2ClassicOriginalSave(history), identity)).toEqual(history);
  const { visitedLevels: omitted, ...legacy } = current;
  expect(omitted).toEqual([]);
  const legacyRecord = { ...encodeQ2ClassicOriginalSave(current), bytes: encodeCheckpointValue(legacy) };
  expect(decodeQ2ClassicOriginalSave(legacyRecord, identity).visitedLevels).toEqual([]);
  for (const changed of [
    { ...visited, map: identity.map }, { ...visited, map: "maps/../escape.bsp" }, { ...visited, map: "base2.bsp" }, { ...visited, map: "maps/a:b.bsp" },
    { ...visited, level: new Uint8Array(0) }, { ...visited, configstrings: [...visited.configstrings, ...visited.configstrings] },
    { ...visited, portals: [...visited.portals, ...visited.portals] },
    { ...visited, configstrings: [{ index: 2080, value: "invalid" }] }, { ...visited, portals: [{ portal: 1024, open: true }] },
  ]) expect(() => encodeQ2ClassicOriginalSave({ ...current, visitedLevels: [changed] })).toThrow();
  expect(() => encodeQ2ClassicOriginalSave({ ...current, visitedLevels: [visited, visited] })).toThrow("visited");
  const future = { ...encodeQ2ClassicOriginalSave(current), bytes: encodeCheckpointValue({ ...current, visitedLevels: [{ ...visited, version: 2 }] }) };
  expect(() => decodeQ2ClassicOriginalSave(future, identity)).toThrow();
});
