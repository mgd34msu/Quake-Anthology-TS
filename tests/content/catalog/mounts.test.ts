import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createMountIdentity } from "../../../src/contracts/content.ts";
import type { ArchiveMount, ContentMount, ResolvedMountPlan } from "../../../src/contracts/content.ts";
import { userProductDirectory } from "../../../src/content/user-data.ts";
import type { ProductExpectation } from "../../../src/content/catalog/products.ts";
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


const overlayProduct: ProductExpectation = { id: "q3-overlay", family: "q3", edition: "classic", campaign: "baseq3", title: "Overlay fixture",
  contentDirectory: "q3a/baseq3", baseProduct: null, requiredContentArchives: ["q3a/baseq3/pak0.pk3"], requiredPrograms: [], mapWitness: null, unresolvedReason: null };

test("user archives and loose content override corpus by directory while retaining pure restrictions and provenance", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "content-overlay-"));
  const corpusRoot = resolve(root, "corpus"), userContentRoot = resolve(root, "user");
  const corpus = userProductDirectory(corpusRoot, overlayProduct.contentDirectory), user = userProductDirectory(userContentRoot, overlayProduct.contentDirectory);
  try {
    await mkdir(corpus, { recursive: true }); await mkdir(resolve(user, "maps"), { recursive: true });
    const corpusBytes = zip([["maps/stock.bsp", "stock"], ["shared.txt", "corpus"], ["loose-wins.txt", "corpus"]]);
    await writeFile(resolve(corpus, "pak0.pk3"), corpusBytes);
    await writeFile(resolve(user, "aaa-download.pk3"), zip([["maps/download.bsp", "download"], ["shared.txt", "user archive"]]));
    await writeFile(resolve(user, "shared.txt"), "user loose"); await writeFile(resolve(user, "loose-wins.txt"), "user loose wins");
    await writeFile(resolve(user, "autoexec.cfg"), "set user_overlay 1"); await writeFile(resolve(user, "maps/loose.bsp"), "loose map");
    const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [overlayProduct], discoverMods: false });
    const product = catalog.require(overlayProduct.id), mounts = await catalog.mountsFor(product.id);
    expect(product.archives).toHaveLength(2); expect(product.userContent?.root).toBe(user);
    expect(mounts.map(mount => mount.kind === "archive" ? mount.archivePath : mount.rootPath)).toEqual([resolve(user, "aaa-download.pk3"), user, resolve(corpus, "pak0.pk3"), corpus]);
    const plan: ResolvedMountPlan = { id: "mount-plan:overlay:1", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] };
    using opened = await openMountPlan(plan);
    expect(new TextDecoder().decode(await opened.read("shared.txt"))).toBe("user archive");
    const loose = await opened.open("loose-wins.txt"); expect(new TextDecoder().decode(loose?.bytes)).toBe("user loose wins");
    expect(loose?.reference.provenance.kind).toBe("loose");
    expect(loose?.reference.provenance.mount.identity.content).toBe(product.id);
    if (loose?.reference.provenance.kind !== "loose") throw new Error("Expected loose provenance");
    expect(loose.reference.provenance.mount.rootPath).toBe(user);
    expect(catalog.mapsFor(product.id).map(map => map.path).sort()).toEqual(["maps/download.bsp", "maps/loose.bsp", "maps/stock.bsp"]);
    using pure = await openMountPlan(plan, { pure: { archives: [await digestFile(resolve(corpus, "pak0.pk3"))] } });
    expect(await pure.open("maps/download.bsp")).toBeNull(); expect(await pure.open("maps/loose.bsp")).toBeNull();
    expect(new TextDecoder().decode(await pure.read("autoexec.cfg"))).toBe("set user_overlay 1");
    expect(new TextDecoder().decode(await pure.read("shared.txt"))).toBe("corpus");
    expect(Array.from(await Bun.file(resolve(corpus, "pak0.pk3")).bytes())).toEqual(Array.from(corpusBytes));
    const witness = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [{ ...overlayProduct, mapWitness: "maps/download.bsp" }], discoverMods: false });
    expect(witness.product(overlayProduct.id).availability.kind).toBe("missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("absent user directories stay mounted for new guest cfg files and downloaded archives appear on rediscovery", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "content-overlay-late-"));
  const corpusRoot = resolve(root, "corpus"), userContentRoot = resolve(root, "user");
  const corpus = userProductDirectory(corpusRoot, overlayProduct.contentDirectory), user = userProductDirectory(userContentRoot, overlayProduct.contentDirectory);
  try {
    await mkdir(corpus, { recursive: true }); await writeFile(resolve(corpus, "pak0.pk3"), zip([["maps/stock.bsp", "stock"]]));
    const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [overlayProduct], discoverMods: false });
    expect(existsSync(user)).toBe(false);
    const product = catalog.require(overlayProduct.id), mounts = await catalog.mountsFor(product.id);
    using opened = await openMountPlan({ id: "mount-plan:overlay:late", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
    expect(await opened.open("guest.cfg")).toBeNull();
    await mkdir(user, { recursive: true }); await writeFile(resolve(user, "guest.cfg"), "guest wrote this");
    const cfg = await opened.open("guest.cfg"); expect(new TextDecoder().decode(cfg?.bytes)).toBe("guest wrote this");
    expect(cfg?.reference.provenance.kind).toBe("loose");
    await writeFile(resolve(user, "custom.pk3"), zip([["maps/downloaded.bsp", "non-stock map"]]));
    const refreshed = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [overlayProduct], discoverMods: false, generation: 1 });
    expect(refreshed.mapsFor(product.id).some(map => map.path === "maps/downloaded.bsp")).toBe(true);
    const refreshedMounts = await refreshed.mountsFor(product.id);
    using remounted = await openMountPlan({ id: "mount-plan:overlay:refreshed", mounts: refreshedMounts, defaultOrder: refreshedMounts.map(mount => mount.identity.id), prefixOrders: [] });
    const map = await remounted.open("maps/downloaded.bsp"); expect(new TextDecoder().decode(map?.bytes)).toBe("non-stock map");
    expect(map?.reference.provenance.mount.identity.generation).toBe(1);
    await rm(resolve(corpus, "pak0.pk3"));
    await writeFile(resolve(user, "pak0.pk3"), zip([["maps/stock.bsp", "user cannot supply retail requirement"]]));
    const missing = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [overlayProduct], discoverMods: false });
    expect(missing.product(overlayProduct.id).availability.kind).toBe("missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("Q1 and Q2 user roots retain native per-directory PAK priority without crossing content scopes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "content-overlay-families-"));
  const corpusRoot = resolve(root, "corpus"), userContentRoot = resolve(root, "user");
  const products: readonly ProductExpectation[] = ["q1", "q2"].map((family): ProductExpectation => ({ ...overlayProduct,
    id: `${family}-overlay`, family: family === "q1" ? "q1" : "q2", campaign: "base", contentDirectory: `${family}/base`, requiredContentArchives: [`${family}/base/pak0.pak`] }));
  try {
    for (const product of products) {
      const corpus = userProductDirectory(corpusRoot, product.contentDirectory), user = userProductDirectory(userContentRoot, product.contentDirectory);
      await mkdir(corpus, { recursive: true }); await mkdir(user, { recursive: true });
      await writeFile(resolve(corpus, "pak0.pak"), pak("shared.txt", "corpus"));
      await writeFile(resolve(user, "pak0.pak"), pak("shared.txt", "user pak0"));
      await writeFile(resolve(user, "pak1.pak"), pak("shared.txt", `${product.family} user pak1`));
      await writeFile(resolve(user, "shared.txt"), "user loose");
    }
    const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, products, discoverMods: false });
    for (const product of products) {
      const selected = catalog.require(product.id), mounts = await catalog.mountsFor(selected.id);
      expect(mounts.every(mount => mount.identity.content === selected.id)).toBe(true);
      using opened = await openMountPlan({ id: "mount-plan:overlay:families", mounts, defaultOrder: mounts.map(mount => mount.identity.id), prefixOrders: [] });
      expect(new TextDecoder().decode(await opened.read("shared.txt"))).toBe(`${product.family} user pak1`);
    }
    expect(() => userProductDirectory(userContentRoot, "../corpus")).toThrow("Invalid relative");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("user-only mods inherit installed base dependencies and downloaded archive diagnostics do not hide retail", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "content-overlay-mod-"));
  const corpusRoot = resolve(root, "corpus"), userContentRoot = resolve(root, "user");
  try {
    const corpus = userProductDirectory(corpusRoot, overlayProduct.contentDirectory);
    const user = userProductDirectory(userContentRoot, overlayProduct.contentDirectory), mod = userProductDirectory(userContentRoot, "q3a/custom");
    await mkdir(corpus, { recursive: true }); await mkdir(user, { recursive: true }); await mkdir(mod, { recursive: true });
    await writeFile(resolve(corpus, "pak0.pk3"), zip([["maps/stock.bsp", "stock"]]));
    await writeFile(resolve(user, "bad.pk3"), "not a zip"); await writeFile(resolve(mod, "custom.pk3"), zip([["maps/custom.bsp", "custom"]]));
    const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [overlayProduct] });
    expect(catalog.require(overlayProduct.id).diagnostics).toHaveLength(1);
    const custom = catalog.require("q3-classic-custom");
    expect(catalog.mapsFor(custom.id).map(map => map.path).sort()).toEqual(["maps/custom.bsp", "maps/stock.bsp"]);
    await rm(resolve(corpus, "pak0.pk3"));
    const missing = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [overlayProduct] });
    expect(missing.product(custom.id).availability.kind).toBe("missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const edition of ["classic", "rerelease"] satisfies readonly ProductExpectation["edition"][]) {
  test(`Q2 ${edition} mounts PKZ with source numeric package order and per-root precedence`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "q2-pkz-"));
    const corpusRoot = resolve(root, "corpus"), userContentRoot = resolve(root, "user");
    const product: ProductExpectation = { ...overlayProduct, id: `q2-${edition}-pkz`, family: "q2", edition,
      campaign: "baseq2", contentDirectory: `q2-${edition}/baseq2`, requiredContentArchives: [`q2-${edition}/baseq2/pak0.pak`] };
    const corpus = userProductDirectory(corpusRoot, product.contentDirectory), user = userProductDirectory(userContentRoot, product.contentDirectory);
    const names = ["zzz.PKZ", "custom.pak", "pak17.pkz", "pak17.pak", "pak10.pak", "pak2.pkz", "pak0.pak"];
    try {
      await mkdir(corpus, { recursive: true }); await mkdir(user, { recursive: true });
      await writeFile(resolve(corpus, "pak0.pak"), pak("shared.txt", "corpus"));
      await writeFile(resolve(corpus, "zzzz.pkz"), zip([["shared.txt", "corpus custom"], ["user-loose.txt", "corpus package"]]));
      for (const name of names) await writeFile(resolve(user, name), name.toLowerCase().endsWith(".pkz")
        ? zip([["shared.txt", name], ["maps/download.bsp", name]]) : pak("shared.txt", name));
      await writeFile(resolve(user, "zzzzz.zip"), zip([["shared.txt", "not a Q2 package"]]));
      await writeFile(resolve(user, "shared.txt"), "user loose");
      await writeFile(resolve(user, "user-loose.txt"), "user loose overrides corpus package");
      const catalog = await discoverInstalledContent({ corpusRoot, userContentRoot, products: [product], discoverMods: false });
      const selected = catalog.require(product.id), mounts = await catalog.mountsFor(selected.id);
      expect(mounts.map(mount => mount.kind === "archive" ? mount.archivePath : mount.rootPath)).toEqual([
        ...names.map(name => resolve(user, name)), user, resolve(corpus, "zzzz.pkz"), resolve(corpus, "pak0.pak"), corpus,
      ]);
      expect(mounts.filter(mount => mount.kind === "archive" && mount.archivePath.endsWith("zzz.PKZ")).map(mount => mount.kind === "archive" ? mount.format : null)).toEqual(["zip"]);
      expect(catalog.mapsFor(selected.id).map(map => map.path)).toEqual(["maps/download.bsp"]);
      // Open each suffix to prove every adjacent source-priority collision with actual archive bytes.
      for (let index = 0; index < names.length; index++) {
        const expected = names[index];
        if (expected === undefined) throw new Error("Missing package expectation");
        const remaining = mounts.slice(index);
        using mounted = await openMountPlan({ id: "mount-plan:q2:pkz", mounts: remaining, defaultOrder: remaining.map(mount => mount.identity.id), prefixOrders: [] });
        expect(new TextDecoder().decode(await mounted.read("shared.txt"))).toBe(expected);
        expect(new TextDecoder().decode(await mounted.read("user-loose.txt"))).toBe("user loose overrides corpus package");
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
