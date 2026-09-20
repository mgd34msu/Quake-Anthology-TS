import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QvmFiles } from "../../../src/compat/qvm/file-syscalls.ts";
import { createMountIdentity, type ContentMount } from "../../../src/contracts/content.ts";
import { digestBytes, openMountPlan } from "../../../src/content/mounts/index.ts";
import { borrowModFileMounts, ModUserFiles } from "../../../src/world/session/mod-files.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
function pack(path: string, text: string): Uint8Array {
  const content = encode(text), bytes = new Uint8Array(12 + content.length + 64), view = new DataView(bytes.buffer);
  bytes.set(encode("PACK")); view.setUint32(4, 12 + content.length, true); view.setUint32(8, 64, true);
  bytes.set(content, 12); bytes.set(encode(path), 12 + content.length);
  view.setUint32(12 + content.length + 56, 12, true); view.setUint32(12 + content.length + 60, content.length, true);
  return bytes;
}

test("component files persist separately and borrow restricted installed mounts without taking their handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "component-files-")), installed = join(root, "installed"), user = join(root, "user");
  await mkdir(installed); const archived = pack("package.cfg", "package");
  await writeFile(join(installed, "content.pak"), archived); await writeFile(join(installed, "settings.cfg"), "package"); await writeFile(join(installed, "private.txt"), "restricted-primary");
  const archive: ContentMount = { kind: "archive", format: "pak", archivePath: join(installed, "content.pak"), archiveDigest: digestBytes(archived),
    identity: createMountIdentity("mount:mod-files:archive", "q3:classic:source:test", 0) };
  const loose: ContentMount = { kind: "loose", rootPath: installed, identity: createMountIdentity("mount:mod-files:primary", "q3:classic:source:test", 0) };
  using mounted = await openMountPlan({ id: "mount-plan:mod-files:source", mounts: [archive, loose], defaultOrder: [archive.identity.id, loose.identity.id],
    prefixOrders: [{ prefix: "scripts/", mounts: [archive.identity.id, loose.identity.id] }] },
    { pure: { archives: [archive.archiveDigest] }, links: [{ sourcePrefix: "scripts/", targetPrefix: "", mount: loose.identity.id }] });
  const stores = new ModUserFiles(user), first = { product: "q3-source", id: "rules/a" }, second = { product: "q3-source", id: "rules/b" };
  const firstStore = stores.for(first), secondStore = stores.for(second);
  using firstMounts = borrowModFileMounts(first, "q3:classic:source:test", mounted, firstStore);
  using secondMounts = borrowModFileMounts(second, "q3:classic:source:test", mounted, secondStore);
  const firstFiles = new QvmFiles({ mounts: firstMounts, writable: firstStore, assertCurrent() {} });
  const secondFiles = new QvmFiles({ mounts: secondMounts, writable: secondStore, assertCurrent() {} });
  let restored: QvmFiles | null = null;
  try {
    expect(firstStore.root).toBe(join(user, ".mods/q3-source/rules%2Fa")); expect(firstStore.root).not.toBe(secondStore.root);
    firstFiles.openWrite("scripts/settings.cfg", "write", slot => { firstFiles.write(slot, encode("component")); firstFiles.close(slot); });
    expect(new TextDecoder().decode((await firstMounts.open("scripts/settings.cfg"))?.bytes)).toBe("component");
    expect(new TextDecoder().decode((await secondMounts.open("scripts/settings.cfg"))?.bytes)).toBe("package");
    firstFiles.openWrite("stats.txt", "append-sync", slot => { expect(slot).toBe(1); firstFiles.write(slot, encode("first")); });
    expect(await firstFiles.list("", ".txt")).toEqual(["stats.txt"]);
    expect(await firstMounts.open("private.txt")).toBeNull(); expect(await secondMounts.open("stats.txt")).toBeNull();
    expect(await firstFiles.open("stats.txt", slot => expect(slot).toBe(2))).toBe(5);
    const bytes = new Uint8Array(2); firstFiles.seek(2, 1, 2); firstFiles.read(2, bytes); expect(new TextDecoder().decode(bytes)).toBe("ir");
    const checkpoint = firstFiles.captureCheckpoint(); firstFiles.closeAll();
    const nextStore = new ModUserFiles(user).for(first); expect(nextStore.root).toBe(firstStore.root);
    restored = new QvmFiles({ mounts: firstMounts, writable: nextStore, assertCurrent() {} }); restored.restoreCheckpoint(checkpoint);
    restored.read(2, bytes); expect(new TextDecoder().decode(bytes)).toBe("st");
    restored.write(1, encode("-continued")); expect(await readFile(join(nextStore.root, "stats.txt"), "utf8")).toBe("first-continued");
    secondFiles.openWrite("stats.txt", "append", slot => { secondFiles.write(slot, encode("second")); secondFiles.close(slot); });
    expect(await readFile(join(secondStore.root, "stats.txt"), "utf8")).toBe("second");
    restored.closeAll(); firstMounts.close();
    expect(new TextDecoder().decode((await mounted.open("package.cfg"))?.bytes)).toBe("package");
    expect(new TextDecoder().decode((await secondMounts.open("stats.txt"))?.bytes)).toBe("second");
    expect(await readFile(join(installed, "private.txt"), "utf8")).toBe("restricted-primary");
  } finally { restored?.closeAll(); firstFiles.closeAll(); secondFiles.closeAll(); await rm(root, { recursive: true, force: true }); }
});
