import { expect, test } from "bun:test";
import { readdirSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountIdentity } from "../../../src/contracts/content.ts";
import type { ArchiveMount, ResolvedMountPlan } from "../../../src/contracts/content.ts";
import { digestFile, openMountPlan } from "../../../src/content/mounts/index.ts";
import { QvmFiles, qvmFileSyscall } from "../../../src/compat/qvm/file-syscalls.ts";
import { QvmGameImport, QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { UserFileStore } from "../../../src/platform/files/writable.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { createQvmSystemCall, rejectQvmSyscall } from "../../../src/compat/qvm/syscalls.ts";

function gameCalls(guest: QvmMemory, files: QvmFiles) {
  const system = createQvmSystemCall("qagame", call => qvmFileSyscall(call, files) ?? rejectQvmSyscall(call));
  return (code: QvmGameImport, args: readonly number[] = []) => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4));
    words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32(4 + index * 4, value, true));
    return system({ words, memory: guest.bytes, invoke: () => { throw new Error("Unexpected VM reentry"); },
      invokeAsync: async () => { throw new Error("Unexpected async VM reentry"); } });
  };
}

function descriptorsWithin(root: string): number {
  return readdirSync("/proc/self/fd").filter(name => {
    try { return readlinkSync(`/proc/self/fd/${name}`).startsWith(`${root}/`); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; }
  }).length;
}

function zip(entries: readonly (readonly [string, string])[]): Uint8Array {
  const locals: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  for (const [path, text] of entries) {
    const name = new TextEncoder().encode(path), data = new TextEncoder().encode(text), crc = Bun.hash.crc32(data);
    const local = new Uint8Array(30 + name.length + data.length), a = new DataView(local.buffer);
    a.setUint32(0, 0x04034b50, true); a.setUint16(4, 20, true); a.setUint32(14, crc, true);
    a.setUint32(18, data.length, true); a.setUint32(22, data.length, true); a.setUint16(26, name.length, true);
    local.set(name, 30); local.set(data, 30 + name.length); locals.push(local);
    const central = new Uint8Array(46 + name.length), b = new DataView(central.buffer);
    b.setUint32(0, 0x02014b50, true); b.setUint16(4, 20, true); b.setUint16(6, 20, true); b.setUint32(16, crc, true);
    b.setUint32(20, data.length, true); b.setUint32(24, data.length, true); b.setUint16(28, name.length, true); b.setUint32(42, offset, true);
    central.set(name, 46); directory.push(central); offset += local.length;
  }
  const directoryLength = directory.reduce((sum, bytes) => sum + bytes.length, 0), result = new Uint8Array(offset + directoryLength + 22);
  let position = 0;
  for (const bytes of [...locals, ...directory]) { result.set(bytes, position); position += bytes.length; }
  const end = new DataView(result.buffer, position);
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, directoryLength, true); end.setUint32(16, offset, true);
  return result;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "qvm-files-"));
  await mkdir(join(root, "scripts"));
  await writeFile(join(root, "scripts/loose.cfg"), "0123456789");
  await writeFile(join(root, "scripts/loose.arena"), "loose");
  const archivePath = join(root, "selected.pk3");
  await writeFile(archivePath, zip([["scripts/first.arena", "0123456789"], ["scripts/sub/second.arena", "second"],
    ["scripts/sub/too/deep.arena", "excluded"], ["scripts/FIRST.arena", "duplicate"]]));
  const mount: ArchiveMount = { kind: "archive", format: "pk3", archivePath, archiveDigest: await digestFile(archivePath),
    identity: createMountIdentity("mount:files:archive", "q3:classic:baseq3:installed", 1) };
  const loose = { kind: "loose", identity: createMountIdentity("mount:files:loose", "q3:classic:baseq3:installed", 1), rootPath: root } satisfies ResolvedMountPlan["mounts"][number];
  const plan: ResolvedMountPlan = { id: "mount-plan:files:1", mounts: [mount, loose], defaultOrder: [mount.identity.id, loose.identity.id], prefixOrders: [] };
  const mounts = await openMountPlan(plan), pure = await openMountPlan(plan, { pure: { archives: [mount.archiveDigest] } });
  const guest = new QvmMemory(new Uint8Array(4096));
  const files = new QvmFiles({ mounts, writable: null, assertCurrent: () => undefined });
  const call = (code: QvmUiImport, args: readonly number[] = []): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4));
    words.setInt32(0, code, true); args.forEach((value, index) => words.setInt32(4 + index * 4, value, true));
    return { kind: "engine", role: "ui", code, words, guest, memory: guest.bytes, commandArguments: null,
      invoke: () => { throw new Error("Unexpected VM reentry"); }, invokeAsync: async () => { throw new Error("Unexpected async VM reentry"); } };
  };
  const close = async (): Promise<void> => { files.closeAll(); mounts.close(); pure.close(); await rm(root, { recursive: true, force: true }); };
  return { root, mount, mounts, pure, guest, files, call, close };
}

test("actual mounted files preserve provenance, ABI EOF bytes, missing and closed handles", async () => {
  const f = await fixture();
  try {
    f.guest.writeString(128, "scripts/first.arena", 64);
    expect(await qvmFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 0]), f.files)).toBe(9);
    const slot = f.guest.view(256, 4).getInt32(0, true);
    expect(slot).toBe(1);
    expect(f.mounts.openedResources[0]?.provenance.mount.identity.id).toBe(f.mount.identity.id);
    f.guest.bytes.fill(99, 512, 524);
    expect(qvmFileSyscall(f.call(QvmUiImport.UI_FS_READ, [512, 12, slot]), f.files)).toBe(0);
    expect(new TextDecoder().decode(f.guest.bytes.subarray(512, 521))).toBe("duplicate");
    expect([...f.guest.bytes.subarray(521, 524)]).toEqual([99, 99, 99]);
    expect(qvmFileSyscall(f.call(QvmUiImport.UI_FS_FCLOSEFILE, [slot]), f.files)).toBe(0);
    expect(() => f.files.read(slot, new Uint8Array(1))).toThrow("NULL");
    expect(qvmFileSyscall(f.call(QvmUiImport.UI_FS_FCLOSEFILE, [slot]), f.files)).toBe(0);
    f.guest.writeString(128, "missing.cfg", 64);
    expect(await qvmFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 0]), f.files)).toBe(-1);
    expect(f.guest.view(256, 4).getInt32(0, true)).toBe(0);
    expect(qvmFileSyscall(f.call(QvmUiImport.UI_FS_READ, [0, -1, 0]), f.files)).toBe(0);
    expect(() => qvmFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 1]), f.files)).toThrow("no writable owner");
  } finally { await f.close(); }
});

test("packed and streamed regular seeks follow their distinct source rules", async () => {
  const f = await fixture();
  try {
    const slots: number[] = [];
    await f.files.open("scripts/first.arena", slot => { slots.push(slot); });
    await f.files.open("scripts/loose.cfg", slot => { slots.push(slot); });
    const packed = slots[0], loose = slots[1]; if (packed === undefined || loose === undefined) throw new Error("Missing slots");
    expect(f.files.seek(packed, 3, 0)).toBe(3);
    const data = new Uint8Array(2); f.files.read(packed, data); expect(new TextDecoder().decode(data)).toBe("li");
    expect(f.files.seek(packed, 0, 2)).toBe(0);
    expect(() => f.files.seek(packed, 65536, 2)).toThrow("NOT YET IMPLEMENTED");
    expect(f.files.seek(loose, 2, 0)).toBe(0); f.files.read(loose, data); expect(new TextDecoder().decode(data)).toBe("45");
    expect(f.files.seek(loose, -1, 1)).toBe(0); f.files.read(loose, data); expect(data[0]).toBe(57);
    f.files.seek(loose, 3, 2);
    expect(f.files.seek(loose, -2, 0)).toBe(-1);
    f.files.read(loose, data); expect(data[0]).toBe(49);
  } finally { await f.close(); }
});

test("listing keeps native order, depth, deduplication, pure filtering and byte capacity", async () => {
  const f = await fixture();
  try {
    expect(await f.mounts.listFiles("scripts", ".arena")).toEqual(["first.arena", "sub/second.arena", "loose.arena"]);
    expect(await f.pure.listFiles("scripts", ".arena")).toEqual(["first.arena", "sub/second.arena"]);
    expect(await f.pure.listFiles("scripts", ".cfg")).toEqual([]);
    expect(f.pure.openedResources).toEqual([]);
    f.guest.writeString(128, "scripts", 64); f.guest.writeString(192, ".arena", 64);
    expect(await qvmFileSyscall(f.call(QvmUiImport.UI_FS_GETFILELIST, [128, 192, 512, 13]), f.files)).toBe(0);
    expect(await qvmFileSyscall(f.call(QvmUiImport.UI_FS_GETFILELIST, [128, 192, 512, 14]), f.files)).toBe(1);
    expect(f.guest.readString(512)).toBe("first.arena");
    await expect(f.files.list("$modlist", "")).rejects.toThrow("catalog owner");
    await expect(f.mounts.listFiles("../escape", "")).rejects.toThrow("Invalid relative");
    await symlink("/etc", join(f.root, "outside"));
    await expect(f.mounts.listFiles("outside", "")).rejects.toThrow("escapes root");
  } finally { await f.close(); }
});

test("retiring while file open is pending never publishes a guest handle", async () => {
  const f = await fixture();
  try {
    f.guest.writeString(128, "scripts/first.arena", 64); f.guest.view(256, 4).setInt32(0, 999, true);
    const pending = qvmFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 0]), f.files);
    f.files.closeAll();
    await expect(Promise.resolve(pending)).rejects.toThrow("closed");
    expect(f.guest.view(256, 4).getInt32(0, true)).toBe(999);
  } finally { await f.close(); }
});

test("guest write, append and append-sync use scoped descriptors and mounted readback", async () => {
  const f = await fixture();
  const userRoot = join(f.root, "user-content"), user = { kind: "loose", rootPath: userRoot,
    identity: createMountIdentity("mount:files:user", "q3:classic:baseq3:installed", 1) } satisfies ResolvedMountPlan["mounts"][number];
  const mounted = await openMountPlan({ ...f.mounts.plan, mounts: [user, ...f.mounts.plan.mounts], defaultOrder: [user.identity.id, ...f.mounts.plan.defaultOrder] });
  const files = new QvmFiles({ mounts: mounted, writable: new UserFileStore(userRoot), assertCurrent: () => undefined });
  try {
    f.guest.writeString(128, "profiles/test.cfg", 64);
    const open = (mode: number) => qvmFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, mode]), files);
    const write = (slot: number, text: string) => {
      const bytes = new TextEncoder().encode(text); f.guest.bytes.set(bytes, 512);
      return qvmFileSyscall(f.call(QvmUiImport.UI_FS_WRITE, [512, bytes.length, slot]), files);
    };
    expect(open(1)).toBe(0);
    const first = f.guest.view(256, 4).getInt32(0, true);
    expect(write(first, "abc")).toBe(0);
    expect(files.seek(first, 1, 2)).toBe(0); write(first, "Z");
    expect(files.seek(first, 2, 1)).toBe(0); write(first, "!");
    files.close(first);
    expect(open(2)).toBe(0);
    const append = f.guest.view(256, 4).getInt32(0, true);
    files.seek(append, 0, 2); write(append, "+");
    expect(open(3)).toBe(0);
    const synchronous = f.guest.view(256, 4).getInt32(0, true);
    expect(synchronous).not.toBe(append);
    files.seek(synchronous, 0, 2); write(synchronous, "+");
    const active = await mounted.open("profiles/test.cfg");
    expect(active?.reference.provenance.mount.identity.id).toBe(user.identity.id);
    expect([...(active?.bytes ?? [])]).toEqual([97, 90, 99, 0, 0, 33, 43, 43]);
    files.close(append); files.close(synchronous);
    expect(await open(0)).toBe(8);
    const read = f.guest.view(256, 4).getInt32(0, true), actual = new Uint8Array(8);
    files.read(read, actual); expect([...actual]).toEqual([97, 90, 99, 0, 0, 33, 43, 43]); files.close(read);
    expect(open(1)).toBe(0);
    const truncated = f.guest.view(256, 4).getInt32(0, true); files.close(truncated);
    expect((await mounted.open("profiles/test.cfg"))?.bytes.length).toBe(0);
    expect(() => files.openWrite("../escape", "write", () => {})).toThrow("contained relative path");
    await symlink(f.root, join(userRoot, "outside"));
    expect(() => files.openWrite("outside/retail-overwrite", "write", () => {})).toThrow();
    expect(open(3)).toBe(0);
    const retired = f.guest.view(256, 4).getInt32(0, true);
    expect(descriptorsWithin(userRoot)).toBe(1);
    files.closeAll();
    expect(descriptorsWithin(userRoot)).toBe(0);
    expect(() => files.write(retired, Uint8Array.of(1))).toThrow("closed");
    expect(() => files.closeAll()).not.toThrow();
  } finally { files.closeAll(); mounted.close(); await f.close(); }
});

test("writable publication failure closes its descriptor without retaining a guest handle", async () => {
  const f = await fixture();
  const files = new QvmFiles({ mounts: f.mounts, writable: new UserFileStore(join(f.root, "user")), assertCurrent: () => undefined });
  try {
    expect(() => files.openWrite("test.cfg", "write", () => { throw new Error("Publication cancelled"); })).toThrow("Publication cancelled");
    expect(descriptorsWithin(join(f.root, "user"))).toBe(0);
    const handles: number[] = [];
    expect(files.openWrite("test.cfg", "append-sync", slot => { handles.push(slot); })).toBe(0);
    expect(handles).toEqual([1]);
    files.closeAll();
  } finally { files.closeAll(); await f.close(); }
});

test("qagame file imports read, seek and list the actual pure mounts with native returns", async () => {
  const f = await fixture(), files = new QvmFiles({ mounts: f.pure, writable: null, assertCurrent: () => undefined }), call = gameCalls(f.guest, files);
  try {
    f.guest.writeString(128, "scripts/first.arena", 64);
    expect(await call(QvmGameImport.G_FS_FOPEN_FILE, [128, 256, 0])).toBe(9);
    const slot = f.guest.view(256, 4).getInt32(0, true);
    expect(f.pure.openedResources[0]?.provenance.mount.identity.id).toBe(f.mount.identity.id);
    expect(call(QvmGameImport.G_FS_SEEK, [slot, 3, 0])).toBe(3);
    expect(call(QvmGameImport.G_FS_READ, [512, 2, slot])).toBe(0);
    expect(new TextDecoder().decode(f.guest.bytes.subarray(512, 514))).toBe("li");
    expect(call(QvmGameImport.G_FS_FCLOSE_FILE, [slot])).toBe(0);
    expect(() => call(QvmGameImport.G_FS_READ, [512, 1, slot])).toThrow("NULL");
    expect(await call(QvmGameImport.G_FS_FOPEN_FILE, [128, 0, 0])).toBe(1);
    f.guest.writeString(128, "scripts/loose.arena", 64);
    expect(await call(QvmGameImport.G_FS_FOPEN_FILE, [128, 256, 0])).toBe(-1);
    expect(f.guest.view(256, 4).getInt32(0, true)).toBe(0);
    f.guest.writeString(128, "scripts", 64); f.guest.writeString(192, ".arena", 64);
    expect(await call(QvmGameImport.G_FS_GETFILELIST, [128, 192, 512, 128])).toBe(2);
    expect(f.guest.readString(512)).toBe("first.arena");
    expect(call(QvmGameImport.G_FS_READ, [0, -1, 0])).toBe(0);
    expect(call(QvmGameImport.G_FS_WRITE, [0, -1, 0])).toBe(0);
    expect(() => call(QvmGameImport.G_FS_FOPEN_FILE, [0, 0, 1])).toThrow("nonnull handle");
    expect(() => call(QvmGameImport.G_FS_FOPEN_FILE, [0, 4095, 0])).toThrow(RangeError);
    expect(() => call(QvmGameImport.G_PRINT, [128])).toThrow("Unbound qagame");
  } finally { files.closeAll(); await f.close(); }
});

test("qagame writes use the injected private owner and mounted readback", async () => {
  const f = await fixture(), root = join(f.root, "server-user"), user = { kind: "loose", rootPath: root,
    identity: createMountIdentity("mount:files:server-user", "q3:classic:baseq3:installed", 1) } satisfies ResolvedMountPlan["mounts"][number];
  const mounts = await openMountPlan({ ...f.mounts.plan, mounts: [user, ...f.mounts.plan.mounts], defaultOrder: [user.identity.id, ...f.mounts.plan.defaultOrder] });
  const files = new QvmFiles({ mounts, writable: new UserFileStore(root), assertCurrent: () => undefined }), call = gameCalls(f.guest, files);
  try {
    f.guest.writeString(128, "profiles/server.cfg", 64); f.guest.bytes.set(new TextEncoder().encode("abc"), 512);
    expect(call(QvmGameImport.G_FS_FOPEN_FILE, [128, 256, 1])).toBe(0);
    const slot = f.guest.view(256, 4).getInt32(0, true);
    expect(call(QvmGameImport.G_FS_WRITE, [512, 3, slot])).toBe(0);
    expect(call(QvmGameImport.G_FS_SEEK, [slot, 1, 2])).toBe(0); f.guest.bytes[512] = 90;
    expect(call(QvmGameImport.G_FS_WRITE, [512, 1, slot])).toBe(0);
    expect(call(QvmGameImport.G_FS_FCLOSE_FILE, [slot])).toBe(0);
    expect(descriptorsWithin(root)).toBe(0);
    expect(await call(QvmGameImport.G_FS_FOPEN_FILE, [128, 256, 0])).toBe(3);
    expect(mounts.openedResources.at(-1)?.provenance.mount.identity.id).toBe(user.identity.id);
    expect(call(QvmGameImport.G_FS_READ, [512, 3, f.guest.view(256, 4).getInt32(0, true)])).toBe(0);
    expect(new TextDecoder().decode(f.guest.bytes.subarray(512, 515))).toBe("aZc");
  } finally { files.closeAll(); mounts.close(); await f.close(); }
});

test("qagame retired asynchronous open and listing never publish into guest memory", async () => {
  const f = await fixture(); let current = true;
  const files = new QvmFiles({ mounts: f.mounts, writable: null, assertCurrent: () => { if (!current) throw new Error("Retired qagame files"); } }), call = gameCalls(f.guest, files);
  try {
    f.guest.writeString(128, "scripts/first.arena", 64); f.guest.view(256, 4).setInt32(0, 999, true);
    const open = call(QvmGameImport.G_FS_FOPEN_FILE, [128, 256, 0]); current = false;
    await expect(Promise.resolve(open)).rejects.toThrow("Retired qagame"); expect(f.guest.view(256, 4).getInt32(0, true)).toBe(999);
    current = true; f.guest.writeString(128, "scripts", 64); f.guest.writeString(192, ".arena", 64); f.guest.bytes[512] = 99;
    const list = call(QvmGameImport.G_FS_GETFILELIST, [128, 192, 512, 128]); current = false;
    await expect(Promise.resolve(list)).rejects.toThrow("Retired qagame"); expect(f.guest.bytes[512]).toBe(99);
  } finally { files.closeAll(); await f.close(); }
});
