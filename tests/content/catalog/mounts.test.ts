import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createMountIdentity } from "../../../src/contracts/content.ts";
import type { ArchiveMount, ContentMount, ResolvedMountPlan } from "../../../src/contracts/content.ts";
import { discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import { canDownloadResource, digestFile, openMountPlan } from "../../../src/content/mounts/index.ts";

function pak(path: string, text: string): Uint8Array {
  const bytes = new Uint8Array(12 + text.length + 64);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setUint32(4, 12 + text.length, true);
  view.setUint32(8, 64, true);
  bytes.set(new TextEncoder().encode(text), 12);
  bytes.set(new TextEncoder().encode(path), 12 + text.length);
  view.setUint32(12 + text.length + 56, 12, true);
  view.setUint32(12 + text.length + 60, text.length, true);
  return bytes;
}

test("reads selected archive, preserves pure order, and detects replacement loose bytes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "quake-mounts-"));
  try {
    const lowPath = resolve(root, "low.pak"), highPath = resolve(root, "high.pak");
    await writeFile(lowPath, pak("maps/test.bsp", "low"));
    await writeFile(highPath, pak("maps/test.bsp", "high"));
    await mkdir(resolve(root, "maps"));
    await writeFile(resolve(root, "maps/loose.bsp"), "loose");
    const low: ArchiveMount = { kind: "archive", identity: createMountIdentity("mount:test:low", "q2:classic:baseq2:installed", 0), format: "pak", archivePath: lowPath, archiveDigest: await digestFile(lowPath) };
    const high: ArchiveMount = { kind: "archive", identity: createMountIdentity("mount:test:high", "q2:rerelease:baseq2:installed", 0), format: "pak", archivePath: highPath, archiveDigest: await digestFile(highPath) };
    const loose: ContentMount = { kind: "loose", identity: createMountIdentity("mount:test:loose", "q2:classic:baseq2:installed", 0), rootPath: root };
    const plan: ResolvedMountPlan = { id: "mount-plan:test:1", mounts: [high, low, loose], defaultOrder: [high.identity.id, low.identity.id, loose.identity.id], prefixOrders: [] };
    using mounted = await openMountPlan(plan);
    const selected = await mounted.open("MAPS/test.bsp");
    expect(new TextDecoder().decode(selected?.bytes)).toBe("high");
    if (selected === null) throw new Error("Missing selected resource");
    expect(canDownloadResource(selected.reference)).toBe(false);
    expect(new TextDecoder().decode(await mounted.read(selected.reference))).toBe("high");
    using pure = await openMountPlan(plan, { pure: { archives: [low.archiveDigest, high.archiveDigest] } });
    expect(new TextDecoder().decode(await pure.read("maps/test.bsp"))).toBe("low");
    expect(await pure.open("maps/loose.bsp")).toBeNull();
    const before = await mounted.resolve("maps/loose.bsp");
    if (before === null) throw new Error("Missing loose resource");
    await writeFile(resolve(root, "maps/loose.bsp"), "changed");
    expect(mounted.read(before)).rejects.toThrow("bytes changed");
    expect(mounted.read("../outside")).rejects.toThrow("Invalid relative");
  } finally { await rm(root, { recursive: true, force: true }); }
});

const corpusRoot = resolve(import.meta.dir, "../../../../qfiles");
test.skipIf(!existsSync(corpusRoot))("rerelease rules read rerelease assets while classic map geometry wins", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot });
  const classic = catalog.product("q2-classic-baseq2").id;
  const rerelease = catalog.product("q2-rerelease-baseq2").id;
  const plan = await catalog.createMountPlan({ id: "mount-plan:real:1", assets: classic, geometry: classic, rules: rerelease });
  using mounted = await openMountPlan(plan);
  const map = await mounted.open("maps/base1.bsp"), icon = await mounted.open("pics/damage_indicator.png");
  expect(map?.reference.provenance.mount.identity.content).toBe(classic);
  expect(map?.reference.resolution.kind).toBe("prefix-order");
  expect(icon?.reference.provenance.mount.identity.content).toBe(rerelease);
  expect(icon?.reference.resolution.kind).toBe("default-order");
  expect(map?.bytes.length).toBeGreaterThan(1000);
  expect(icon?.bytes.slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]));
});
