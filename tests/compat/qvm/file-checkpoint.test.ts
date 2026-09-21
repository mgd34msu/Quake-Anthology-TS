import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMountPlan } from "../../../src/content/mounts/index.ts";
import { QvmFiles } from "../../../src/compat/qvm/file-syscalls.ts";
import { UserFileStore } from "../../../src/platform/files/writable.ts";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../../src/persistence/value.ts";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
function descriptors(root: string): number {
  return readdirSync("/proc/self/fd").filter(name => {
    try { return readlinkSync(`/proc/self/fd/${name}`).startsWith(`${root}/`); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
  }).length;
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "qvm-checkpoint-"));
  const mounts = await openMountPlan({ id: "mount-plan:checkpoint:1", mounts: [{ kind: "loose", rootPath: root,
    identity: { id: "mount:checkpoint:loose", content: "q3:classic:baseq3:installed", generation: 1 } }], defaultOrder: ["mount:checkpoint:loose"], prefixOrders: [] });
  const owners: QvmFiles[] = [];
  const create = (): QvmFiles => { const files = new QvmFiles({ mounts, writable: new UserFileStore(root), assertCurrent() {} }); owners.push(files); return files; };
  return { root, create, close() { for (const files of owners) files.closeAll(); mounts.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("QVM files restore exact read bytes, cursors, external writes, append modes and free slots", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.root, "read.cfg"), "abcdef");
    const original = f.create();
    await original.open("read.cfg", slot => expect(slot).toBe(1));
    original.openWrite("gap", "write", slot => expect(slot).toBe(2));
    original.openWrite("state", "write", slot => expect(slot).toBe(3));
    original.openWrite("log", "append", slot => expect(slot).toBe(4));
    original.openWrite("sync-log", "append-sync", slot => expect(slot).toBe(5));
    original.close(2);
    const read = new Uint8Array(2); original.read(1, read);
    original.write(3, bytes("012345")); original.seek(3, 2, 2);
    original.write(4, bytes("before")); original.seek(4, 0, 2);
    original.write(5, bytes("before")); original.seek(5, 0, 2);
    const checkpoint = decodeCheckpointValue(encodeCheckpointValue(original.captureCheckpoint()));
    original.write(3, bytes("XY")); original.write(4, bytes("later")); original.write(5, bytes("later"));
    original.closeAll();
    writeFileSync(join(f.root, "read.cfg"), "REPLACED");
    const restored = f.create(); restored.restoreCheckpoint(checkpoint);
    expect(readFileSync(join(f.root, "state"), "utf8")).toBe("01XY45");
    restored.read(1, read); expect(new TextDecoder().decode(read)).toBe("cd");
    restored.write(3, bytes("Z")); expect(readFileSync(join(f.root, "state"), "utf8")).toBe("01ZY45");
    restored.write(4, bytes("after")); restored.write(5, bytes("after"));
    expect(readFileSync(join(f.root, "log"), "utf8")).toBe("beforelaterafter");
    expect(readFileSync(join(f.root, "sync-log"), "utf8")).toBe("beforelaterafter");
    await restored.open("read.cfg", slot => expect(slot).toBe(2));
    restored.close(1); restored.close(4);
    await restored.open("read.cfg", slot => expect(slot).toBe(1));
    await restored.open("read.cfg", slot => expect(slot).toBe(4));
  } finally { f.close(); }
});

test("QVM failed restore releases staged descriptors and never creates or changes files", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.root, "existing"), "persistent");
    const files = f.create(), before = descriptors(f.root);
    const valid = { slot: 1, kind: "write", file: { path: "existing", mode: "write", position: 99 } };
    expect(() => files.restoreCheckpoint({ handles: [valid, { ...valid, slot: 2, file: { ...valid.file, path: "missing/child" } }] })).toThrow();
    expect(descriptors(f.root)).toBe(before);
    expect(readFileSync(join(f.root, "existing"), "utf8")).toBe("persistent");
    expect(readdirSync(f.root)).toEqual(["existing"]);
    expect(files.captureCheckpoint().handles).toEqual([]);
    expect(() => files.restoreCheckpoint({ handles: [valid, valid] })).toThrow("duplicate");
    expect(() => files.restoreCheckpoint({ handles: [{ ...valid, file: { ...valid.file, path: "../escape" } }] })).toThrow("stay inside its storage directory");
    expect(() => files.restoreCheckpoint({ handles: [{ ...valid, file: { ...valid.file, position: -1 } }] })).toThrow();
    files.restoreCheckpoint({ handles: [valid] });
    files.write(1, bytes("x")); expect(readFileSync(join(f.root, "existing")).length).toBe(100);
  } finally { f.close(); }
});

test("QVM read checkpoint rejects altered byte identity and invalid slot or cursor", async () => {
  const f = await fixture();
  try {
    writeFileSync(join(f.root, "read.cfg"), "abcdef");
    const files = f.create(); await files.open("read.cfg", () => {});
    const state = files.captureCheckpoint(), handle = state.handles[0];
    if (handle?.kind !== "read") throw new Error("Missing read fixture");
    const restored = f.create();
    expect(() => restored.restoreCheckpoint({ handles: [{ ...handle, resource: { ...handle.resource, bytes: bytes("ghijkl") } }] })).toThrow("identity");
    expect(() => restored.restoreCheckpoint({ handles: [{ ...handle, slot: 64 }] })).toThrow("slot");
    expect(() => restored.restoreCheckpoint({ handles: [{ ...handle, position: NaN }] })).toThrow("integer");
    restored.restoreCheckpoint({ handles: [{ ...handle, position: 100 }] });
    const output = new Uint8Array([99]); restored.read(1, output); expect(output[0]).toBe(99);
    expect(restored.captureCheckpoint().handles[0]).toEqual({ ...handle, position: 100 });
  } finally { f.close(); }
});

test("QVM append checkpoint resumes in a fresh managed directory without truncating existing logs", async () => {
  const f = await fixture();
  try {
    for (const mode of ["append", "append-sync"] satisfies readonly ("append" | "append-sync")[]) {
      const root = join(f.root, mode, "content", "q3a", "mod");
      const files = new QvmFiles({ mounts: (await openMountPlan({ id: "mount-plan:empty:1", mounts: [], defaultOrder: [], prefixOrders: [] })), writable: new UserFileStore(root), assertCurrent() {} });
      try {
        const checkpoint: ReturnType<QvmFiles["captureCheckpoint"]> = { handles: [{ slot: 1, kind: "write", file: { path: "logs/games.log", mode, position: 495 } }] };
        files.restoreCheckpoint(checkpoint);
        expect(files.captureCheckpoint()).toEqual(checkpoint);
        files.write(1, bytes("continued"));
        expect(readFileSync(join(root, "logs/games.log"), "utf8")).toBe("continued");
      } finally { files.closeAll(); files.services.mounts.close(); }
      const resumed = new UserFileStore(root).resume({ path: "logs/games.log", mode, position: 495 });
      try { resumed.write(bytes(" again")); }
      finally { resumed.close(); }
      expect(readFileSync(join(root, "logs/games.log"), "utf8")).toBe("continued again");
    }
    const missing = join(f.root, "missing-write-root");
    expect(() => new UserFileStore(missing).resume({ path: "state", mode: "write", position: 0 })).toThrow();
    expect(existsSync(missing)).toBe(false);
    const outside = join(f.root, "outside"), root = join(f.root, "contained");
    mkdirSync(outside); mkdirSync(root);
    symlinkSync(outside, join(root, "logs"));
    expect(() => new UserFileStore(root).resume({ path: "logs/games.log", mode: "append", position: 495 })).toThrow();
    expect(readdirSync(outside)).toEqual([]);
    symlinkSync(join(outside, "games.log"), join(root, "games.log"));
    expect(() => new UserFileStore(root).resume({ path: "games.log", mode: "append", position: 495 })).toThrow();
    expect(readdirSync(outside)).toEqual([]);
    const staged = f.create(), before = descriptors(f.root);
    expect(() => staged.restoreCheckpoint({ handles: [
      { slot: 1, kind: "write", file: { path: "staged.log", mode: "append", position: 495 } },
      { slot: 2, kind: "write", file: { path: "absent-state", mode: "write", position: 0 } },
    ] })).toThrow();
    expect(descriptors(f.root)).toBe(before);
    expect(staged.captureCheckpoint().handles).toEqual([]);
  } finally { f.close(); }
});
