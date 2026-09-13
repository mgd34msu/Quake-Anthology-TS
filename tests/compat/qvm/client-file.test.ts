import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountIdentity } from "../../../src/contracts/content.ts";
import type { ArchiveMount, ResolvedMountPlan } from "../../../src/contracts/content.ts";
import { digestFile, openMountPlan } from "../../../src/content/mounts/index.ts";
import { QvmClientFiles, qvmClientFileSyscall } from "../../../src/compat/qvm/client-file-syscalls.ts";
import { QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";

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
  const files = new QvmClientFiles({ mounts, writable: null, assertCurrent: () => undefined });
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
    expect(await qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 0]), f.files)).toBe(9);
    const slot = f.guest.view(256, 4).getInt32(0, true);
    expect(slot).toBe(1);
    expect(f.mounts.openedResources[0]?.provenance.mount.identity.id).toBe(f.mount.identity.id);
    f.guest.bytes.fill(99, 512, 524);
    expect(qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_READ, [512, 12, slot]), f.files)).toBe(0);
    expect(new TextDecoder().decode(f.guest.bytes.subarray(512, 521))).toBe("duplicate");
    expect([...f.guest.bytes.subarray(521, 524)]).toEqual([99, 99, 99]);
    expect(qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_FCLOSEFILE, [slot]), f.files)).toBe(0);
    expect(() => f.files.read(slot, new Uint8Array(1))).toThrow("NULL");
    expect(qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_FCLOSEFILE, [slot]), f.files)).toBe(0);
    f.guest.writeString(128, "missing.cfg", 64);
    expect(await qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 0]), f.files)).toBe(-1);
    expect(f.guest.view(256, 4).getInt32(0, true)).toBe(0);
    expect(qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_READ, [0, -1, 0]), f.files)).toBe(0);
    expect(() => qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 1]), f.files)).toThrow("no writable owner");
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
    expect(await qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_GETFILELIST, [128, 192, 512, 13]), f.files)).toBe(0);
    expect(await qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_GETFILELIST, [128, 192, 512, 14]), f.files)).toBe(1);
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
    const pending = qvmClientFileSyscall(f.call(QvmUiImport.UI_FS_FOPENFILE, [128, 256, 0]), f.files);
    f.files.closeAll();
    await expect(Promise.resolve(pending)).rejects.toThrow("closed");
    expect(f.guest.view(256, 4).getInt32(0, true)).toBe(999);
  } finally { await f.close(); }
});
