import { expect, spyOn, test } from "bun:test";
import { applicationPreset, LoadedApplicationContent, loadApplicationContent } from "../../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { Q3ApplicationPackages } from "../../../src/app/bootstrap/network/q3-downloads.ts";
import { Q3ClientContent } from "../../../src/app/bootstrap/network/q3-client-content.ts";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../../src/content/catalog/index.ts";
import type { ProductExpectation } from "../../../src/content/catalog/products.ts";
import { openMountPlan } from "../../../src/content/mounts/index.ts";
import { decodeQ3World } from "../../../src/formats/q3-map/index.ts";
import { q3Fixture } from "../../formats/q3-map/fixture.ts";

test("Q3 server policy reaches map and provider mounts without inheriting seed references", async () => {
  const parsed = parseApplicationCommand(["--game", "q3-baseq3", "--map", "q3dm1", "--hidden"]);
  if (parsed.kind !== "run") throw new Error("Missing Q3 options");
  const seed = await loadApplicationContent(parsed.options);
  try {
    const packages = await Q3ApplicationPackages.open(seed, 123);
    const base = packages.packs.find(pak => pak.pack.basename === "pak0");
    if (base === undefined) throw new Error("Missing retail baseq3 pak0");
    // These real seed opens must not count as module loads in the replacement filesystem.
    expect(await seed.mounts.open("vm/cgame.qvm")).not.toBeNull();
    expect(await seed.mounts.open("vm/ui.qvm")).not.toBeNull();
    const info = `\\sv_pure\\1\\sv_paks\\${base.pack.checksum | 0}\\fs_game\\`;
    const client = await Q3ClientContent.open(parsed.options, info, 123, seed);
    try {
      expect(client.pure).toBe(true);
      expect(client.content).not.toBe(seed);
      expect(client.policy?.archives).toEqual([base.mount.archiveDigest]);
      expect(client.content.mounts.options.pure).toEqual(client.policy);
      expect(client.content.recipe.map.geometry.provenance.mount.identity.id).toBe(base.mount.identity.id);
      const provider = await client.content.forContent(client.content.recipe.map.entities.content);
      expect(provider.options.pure).toEqual(client.policy);
      const model = await provider.open("models/players/sarge/lower.md3");
      expect(model?.reference.provenance.mount.identity.id).toBe(base.mount.identity.id);
      client.packages.collect();
      expect(client.packages.references.references.snapshot().find(reference => reference.pack.basename === "pak0")?.flags).toBe(1);
      expect(() => client.referencedPureCommand(99)).toThrow("actually loaded cgame");
      expect(client.matches(info, 123)).toBe(true);
      expect(client.matches(info, 124)).toBe(false);
      expect(client.matches(info.replace("\\sv_pure\\1", "\\sv_pure\\0"), 123)).toBe(false);
      const restarted = await Q3ClientContent.open(parsed.options, info, 124, client.content);
      try {
        expect(restarted.content.mounts).not.toBe(client.content.mounts);
        expect(await restarted.content.forContent(restarted.content.recipe.map.entities.content)).not.toBe(provider);
        expect(restarted.packages.packs.find(pak => pak.pack.basename === "pak0")?.pack.pureChecksum).not.toBe(base.pack.pureChecksum);
        expect(() => restarted.referencedPureCommand(100)).toThrow("actually loaded cgame");
      } finally { await restarted.close(); }
    } finally { await client.close(); }
    expect(client.matches(info, 123)).toBe(false);
    expect(() => client.referencedPureCommand(99)).toThrow("closed");
  } finally { await seed.close(); }
}, 60000);


function providerPk3(entries: readonly (readonly [string, string])[]): Uint8Array {
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

test("borrowed application providers expose only their own Q3 package references", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "q3-provider-reuse-"));
  try {
    const baseDirectory = resolve(root, "baseq3"), modDirectory = resolve(root, "custom");
    await mkdir(resolve(modDirectory, "maps"), { recursive: true }); await mkdir(baseDirectory);
    await writeFile(resolve(baseDirectory, "pak0.pk3"), providerPk3([["vm/cgame.qvm", "base module"], ["shared.txt", "base"]]));
    await writeFile(resolve(modDirectory, "pak0.pk3"), providerPk3([["shared.txt", "mod"], ["vm/ui.qvm", "mod module"]]));
    const map = q3Fixture();
    await writeFile(resolve(modDirectory, "maps/test.bsp"), map);
    const base: ProductExpectation = { id: "q3-baseq3", family: "q3", edition: "classic", campaign: "baseq3", title: "Base fixture",
      contentDirectory: "baseq3", baseProduct: null, requiredContentArchives: ["baseq3/pak0.pk3"], requiredPrograms: [], mapWitness: null, unresolvedReason: null };
    const mod: ProductExpectation = { ...base, id: "q3-custom", campaign: "custom", title: "Mod fixture", contentDirectory: "custom",
      baseProduct: base.id, requiredContentArchives: ["custom/pak0.pk3"] };
    const extra: ProductExpectation = { ...base, id: "q3-extra", campaign: "extra", contentDirectory: "extra", requiredContentArchives: ["extra/pak0.pk3"] };
    await mkdir(resolve(root, "extra"));
    await writeFile(resolve(root, "extra/pak0.pk3"), providerPk3([["extra.txt", "extra"]]));
    const catalog = await discoverInstalledContent({ corpusRoot: root, products: [base, mod, extra], discoverMods: false });
    const parsed = parseApplicationCommand(["--game", "q3-custom", "--map", "test", "--movement", "q3", "--character", "q3"]);
    if (parsed.kind !== "run") throw new Error("Expected fixture application options");
    const preset = applicationPreset(catalog, parsed.options);
    const recipe = await resolveLaunch({ catalog, preset, choice: presetChoice(preset.id) });
    const baseId = catalog.require(base.id).id, modId = catalog.require(mod.id).id;
    const baseDigests = (await catalog.mountsFor(baseId)).flatMap(mount => mount.kind === "archive" ? [mount.archiveDigest] : []);
    for (const archives of [[], baseDigests]) {
      const pure = { archives };
      const mounts = await openMountPlan(recipe.mounts, { pure });
      const content = new LoadedApplicationContent(catalog, recipe, decodeQ3World(map), mounts, null, pure);
      try {
        const packages = await Q3ApplicationPackages.open(content, 123);
        const borrowing = spyOn(mounts, "borrowMountPlan");
        const provider = await content.forContent(baseId), modProvider = await content.forContent(modId);
        try {
          expect(borrowing).toHaveReturnedWith(provider);
          expect(borrowing).toHaveReturnedWith(modProvider);
          expect(await content.forContent(baseId)).toBe(provider);
          expect(borrowing).toHaveBeenCalledTimes(2);
        } finally { borrowing.mockRestore(); }
        expect(content.openedMounts()).toEqual([mounts, provider, modProvider]);
        expect(mounts.openedResources).toEqual([]);
        expect(provider.openedResources).toEqual([]);
        const module = await provider.open("vm/cgame.qvm");
        if (module === null) throw new Error("Missing provider module");
        expect(provider.openedResources).toEqual([module.reference]);
        expect(modProvider.openedResources).toEqual([]);
        expect(mounts.openedResources).toEqual([]);
        packages.collect();
        expect(packages.references.references.snapshot().find(entry => entry.pack.game === "baseq3")?.flags).toBe(5);
        expect(packages.references.references.snapshot().find(entry => entry.pack.game === "custom")?.flags).toBe(0);
        expect(await provider.open("vm/ui.qvm")).toBeNull();
        const modUi = await modProvider.open("vm/ui.qvm");
        expect(modUi === null).toBe(archives.length > 0);
        packages.collect();
        expect(packages.references.references.snapshot().find(entry => entry.pack.game === "custom")?.flags).toBe(archives.length > 0 ? 0 : 3);
        const resolved = await modProvider.open("shared.txt");
        expect(new TextDecoder().decode(resolved?.bytes)).toBe(archives.length > 0 ? "base" : "mod");
        provider.close();
        await expect(provider.read(module.reference)).rejects.toThrow("closed");
        expect(new TextDecoder().decode(await modProvider.read("shared.txt"))).toBe(archives.length > 0 ? "base" : "mod");
        expect(await mounts.read(module.reference)).toEqual(module.bytes);
        if (archives.length > 0) await expect(content.forContent(catalog.require(extra.id).id)).rejects.toThrow("No server-approved archives provide");
        else {
          const fallback = spyOn(mounts, "borrowMountPlan");
          try {
            const extraProvider = await content.forContent(catalog.require(extra.id).id);
            expect(fallback).toHaveReturnedWith(null);
            expect(new TextDecoder().decode(await extraProvider.read("extra.txt"))).toBe("extra");
          } finally { fallback.mockRestore(); }
        }
        await content.close();
        await expect(modProvider.read("shared.txt")).rejects.toThrow("closed");
        expect(content.openedMounts()).toEqual([]);
        expect(() => content.forContent(baseId)).toThrow("closed");
      } finally { await content.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
