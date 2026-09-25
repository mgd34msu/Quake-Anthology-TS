import { encodeCheckpointValue, decodeCheckpointValue } from "../../../src/persistence/value.ts";
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMountIdentity } from "../../../src/contracts/content.ts";
import { openMountPlan } from "../../../src/content/mounts/index.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { QvmClientScripts, qvmClientScriptSyscall } from "../../../src/compat/qvm/client-script-syscalls.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { ScriptGlobalDefines, ScriptSourceReader } from "../../../src/ui/common/legacy/script/preprocessor.ts";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "qvm-scripts-"));
  await writeFile(join(root, "root.menu"), '#define TWICE(x) ((x)+(x))\n"before"\n#include "nested.inc"\n#define KEEP 1\n"after"\nVALUE TWICE(3)\n');
  await writeFile(join(root, "nested.inc"), '"middle"\n#include "deep.inc"\n');
  await writeFile(join(root, "deep.inc"), '"deep"\n');
  await writeFile(join(root, "error.menu"), '#include "absent.inc"\n');
  const mount = createMountIdentity("mount:parser:loose", "q3:classic:baseq3:installed", 1);
  const mounts = await openMountPlan({ id: "mount-plan:parser:1", mounts: [{ kind: "loose", identity: mount, rootPath: root }], defaultOrder: [mount.id], prefixOrders: [] });
  const globals = new ScriptGlobalDefines(), printed: string[] = [], guest = new QvmMemory(new Uint8Array(4096));
  const scripts = new QvmClientScripts({ mounts, globals, assertCurrent: () => undefined, print: text => { printed.push(text); } });
  const call = (code: QvmUiImport, args: readonly number[]): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4));
    words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32(4 + index * 4, value, true));
    return { kind: "engine", role: "ui", code, words, guest, memory: guest.bytes, commandArguments: null,
      cancelFunction: () => { throw new Error("Unexpected cancellation"); }, invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  };
  const close = async (): Promise<void> => { scripts.closeAll(); globals.clear(); mounts.close(); await rm(root, { recursive: true, force: true }); };
  return { root, mounts, globals, printed, guest, scripts, call, close };
}

test("PC traps retain nested include and adjacent-string continuations, globals and function macros", async () => {
  const f = await fixture();
  try {
    f.guest.writeString(128, "VALUE 7", 64);
    expect(qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_ADD_GLOBAL_DEFINE, [128]), f.scripts)).toBe(1);
    f.guest.writeString(128, "root.menu", 64);
    const handle = await qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_LOAD_SOURCE, [128]), f.scripts);
    if (handle === null) throw new Error("Unhandled source load");
    expect(handle).toBe(1);
    const tokens: string[] = [];
    expect(await qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_READ_TOKEN, [handle, 512]), f.scripts)).toBe(1);
    expect(f.guest.view(512, 16).getInt32(0, true)).toBe(1);
    tokens.push(f.guest.readString(528));
    expect(await qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_READ_TOKEN, [handle, 512]), f.scripts)).toBe(1);
    expect(f.guest.view(512, 16).getInt32(0, true)).toBe(3);
    expect(f.guest.view(512, 16).getInt32(8, true)).toBe(7);
    expect(f.guest.view(512, 16).getFloat32(12, true)).toBe(7);
    tokens.push(f.guest.readString(528));
    while (await qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_READ_TOKEN, [handle, 512]), f.scripts)) tokens.push(f.guest.readString(528));
    expect(tokens).toEqual(["beforemiddledeepafter", "7", "(", "(", "3", ")", "+", "(", "3", ")", ")"]);
    expect(f.mounts.openedResources.map(resource => resource.requestedPath)).toEqual(["root.menu", "nested.inc", "deep.inc"]);
    expect(qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_SOURCE_FILE_AND_LINE, [handle, 128, 256]), f.scripts)).toBe(1);
    expect(f.guest.readString(128)).toBe("root.menu");
    expect(f.guest.view(256, 4).getInt32(0, true)).toBeGreaterThan(1);
    expect(qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_FREE_SOURCE, [handle]), f.scripts)).toBe(1);
    expect(qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_FREE_SOURCE, [handle]), f.scripts)).toBe(0);
    expect(await qvmClientScriptSyscall(f.call(QvmUiImport.UI_PC_READ_TOKEN, [handle, 0]), f.scripts)).toBe(0);
  } finally { await f.close(); }
});

test("mounted include failure reports source error and module teardown leaves shared defines intact", async () => {
  const f = await fixture();
  try {
    f.globals.add("VALUE 7");
    const handle = await f.scripts.load("error.menu");
    expect(await f.scripts.read(handle, () => {})).toBe(0);
    expect(f.printed.some(text => text.includes("absent.inc") && text.includes("not found"))).toBe(true);
    f.scripts.closeAll();
    const reader = ScriptSourceReader.open({ path: "other", text: "VALUE" }, { resolve: () => undefined }, { globals: f.globals });
    try { expect(reader.next()?.token.text).toBe("7"); } finally { reader.dispose(); }
  } finally { await f.close(); }
});

test("a pending nested include excludes concurrent token reads and retirement stops publication", async () => {
  const f = await fixture();
  try {
    const handle = await f.scripts.load("root.menu");
    let published = false;
    const pending = f.scripts.read(handle, () => { published = true; });
    await expect(f.scripts.read(handle, () => {})).rejects.toThrow("pending token read");
    f.scripts.closeAll();
    await expect(pending).rejects.toThrow("closed");
    expect(published).toBe(false);
  } finally { await f.close(); }
});

test("sync parser rejects promised includes while the shared async path preserves lookahead state", async () => {
  let resolve: () => void = () => { throw new Error("Uninitialized gate"); };
  const gate = new Promise<void>(done => { resolve = done; });
  const reader = ScriptSourceReader.open({ path: "root", text: '"first"\n#include "child"\n#define KEEP 1\n"last"' }, {
    resolve: async () => { await gate; return { path: "child", text: '"middle"' }; },
  });
  try {
    const pending = reader.nextAsync();
    expect(() => reader.next()).toThrow("pending token read");
    resolve();
    expect((await pending)?.token.text).toBe('"firstmiddlelast"');
  } finally { reader.dispose(); }
  const synchronous = ScriptSourceReader.open({ path: "root", text: '#include "child"' }, { resolve: () => Promise.resolve(undefined) });
  try { expect(() => synchronous.next()).toThrow("synchronous includes"); } finally { synchronous.dispose(); }
});

test("client parser checkpoint retains macro expansion, lookahead and original source slot", async () => {
  const f = await fixture(), globals = new ScriptGlobalDefines();
  const restored = new QvmClientScripts({ mounts: f.mounts, globals, assertCurrent: () => {}, print: text => f.printed.push(text) });
  try {
    f.scripts.addDefine("VALUE 7");
    const discarded = await f.scripts.load("root.menu"), handle = await f.scripts.load("root.menu");
    f.scripts.free(discarded);
    expect(handle).toBe(2);
    expect(await f.scripts.read(handle, () => {})).toBe(1);
    const checkpoint = decodeCheckpointValue(encodeCheckpointValue(f.scripts.captureCheckpoint()));
    restored.restoreCheckpoint(checkpoint);
    const read = async (owner: QvmClientScripts) => { const result: string[] = []; let next = ""; while (await owner.read(handle, reader => { next = reader.rawToken.string; })) result.push(next); return result; };
    const next = await read(restored); expect(next).toEqual(await read(f.scripts));
    expect(next).toEqual(["7", "(", "(", "3", ")", "+", "(", "3", ")", ")"]);
    expect(await restored.load("error.menu")).toBe(1);
  } finally { restored.closeAll(); globals.clear(); await f.close(); }
});
