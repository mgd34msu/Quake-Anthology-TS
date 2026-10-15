import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, expectedProducts } from "../../../src/content/catalog/index.ts";
import { gameRootIn, resolveDefaultContentRoot } from "../../../src/content/roots.ts";

function pakWith(entries: readonly string[]): Uint8Array {
  const dataLength = entries.length, directoryOffset = 12 + dataLength;
  const bytes = new Uint8Array(directoryOffset + entries.length * 64), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setUint32(4, directoryOffset, true); view.setUint32(8, entries.length * 64, true);
  entries.forEach((entry, index) => {
    bytes[12 + index] = 6;
    const offset = directoryOffset + index * 64;
    bytes.set(new TextEncoder().encode(entry), offset);
    view.setUint32(offset + 56, 12 + index, true); view.setUint32(offset + 60, 1, true);
  });
  return bytes;
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

describe("anchor content discovery", () => {
  test("steam-style parent names resolve through base game anchors", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-anchor-layout-"));
    try {
      const files: readonly (readonly [string, Uint8Array])[] = [
        ["Quake/Id1/PAK0.PAK", pakWith(["progs.dat"])],
        ["Quake/Id1/PAK1.PAK", pakWith(["progs.dat"])],
        ["Quake/hipnotic/pak0.pak", pakWith(["progs.dat"])],
        ["Quake/rerelease/id1/pak0.pak", pakWith(["progs.dat"])],
        ["Quake 2/baseq2/pak0.pak", pakWith(["maps/base1.bsp"])],
        ["Quake 2/xatrix/pak0.pak", pakWith(["maps/xswamp.bsp"])],
        ["Quake 2/rerelease/baseq2/pak0.pak", pakWith(["maps/base1.bsp", "maps/xswamp.bsp", "maps/rmine1.bsp", "maps/q2ctf1.bsp", "maps/mguhub.bsp", "maps/q64/rtest.bsp"])],
        ["Quake 3 Arena/baseq3/pak0.pk3", zip([["vm/qagame.qvm", "x"]])],
        ["Quake 3 Arena/missionpack/pak0.pk3", zip([["vm/qagame.qvm", "x"]])],
      ];
      for (const [path, bytes] of files) {
        await mkdir(join(root, path, ".."), { recursive: true });
        await writeFile(join(root, path), bytes);
      }
      const catalog = await discoverInstalledContent({ corpusRoot: root, discoverMods: false });
      for (const id of ["q1-classic-id1", "q1-classic-hipnotic", "q1-rerelease-id1", "q2-classic-baseq2", "q2-classic-xatrix",
        "q2-rerelease-baseq2", "q2-rerelease-xatrix", "q2-rerelease-mg2", "q3-baseq3", "q3-missionpack"])
        expect(catalog.product(id).availability.kind).toBe("installed");
      expect(catalog.product("q2-classic-rogue").availability.kind).toBe("missing");
      expect(catalog.product("q1-classic-id1").looseRoot).toBe(resolve(root, "Quake/Id1"));
      const mounts = await catalog.mountsFor(catalog.require("q1-classic-hipnotic").id);
      const archives = mounts.flatMap(mount => mount.kind === "archive" ? [mount.archivePath] : []);
      expect(archives).toContain(resolve(root, "Quake/hipnotic/pak0.pak"));
      expect(archives).toContain(resolve(root, "Quake/Id1/PAK0.PAK"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("mods resolve as siblings of the anchor directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-anchor-mod-"));
    try {
      await mkdir(join(root, "Quake/Id1"), { recursive: true });
      await mkdir(join(root, "Quake/mymod"), { recursive: true });
      await writeFile(join(root, "Quake/Id1/PAK0.PAK"), pakWith(["progs.dat"]));
      await writeFile(join(root, "Quake/Id1/PAK1.PAK"), pakWith(["progs.dat"]));
      await writeFile(join(root, "Quake/mymod/progs.dat"), new Uint8Array([6]));
      const products = expectedProducts.filter(product => product.id === "q1-classic-id1");
      const catalog = await discoverInstalledContent({ corpusRoot: root, products });
      const mod = catalog.require("q1-classic-mymod");
      expect(mod.expectation.baseProduct).toBe("q1-classic-id1");
      expect(mod.looseRoot).toBe(resolve(root, "Quake/mymod"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("game roots prefer the anchor's own game folder over nested rerelease trees", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-anchor-roots-"));
    try {
      await mkdir(join(root, "Quake 2/baseq2"), { recursive: true });
      await mkdir(join(root, "Quake 2/rerelease/baseq2"), { recursive: true });
      await mkdir(join(root, "Quake/Id1"), { recursive: true });
      expect(gameRootIn(root, "q2")).toBe(resolve(root, "Quake 2"));
      expect(gameRootIn(resolve(root, "Quake 2"), "q2")).toBe(resolve(root, "Quake 2"));
      expect(gameRootIn(root, "q1")).toBe(resolve(root, "Quake"));
      expect(gameRootIn(root, "q3")).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("default search stops at own folder, then its parent, then steam", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quake-anchor-search-"));
    try {
      const home = join(root, "home"), steamCommon = join(home, ".local/share/Steam/steamapps/common");
      await mkdir(join(steamCommon, "Quake 3 Arena/baseq3"), { recursive: true });
      const parent = join(root, "games"), own = join(parent, "tool");
      await mkdir(join(parent, "Quake 2/baseq2"), { recursive: true });
      await mkdir(own, { recursive: true });
      const search = { ownDirectory: own, homeDirectory: home };
      expect(resolveDefaultContentRoot(search)).toBe(parent);
      expect(resolveDefaultContentRoot(search, true)).toBe(resolve(steamCommon));
      await mkdir(join(own, "Quake/Id1"), { recursive: true });
      expect(resolveDefaultContentRoot(search)).toBe(own);
      expect(parseApplicationCommand(["--list-content"], search)).toEqual({ kind: "list-content", corpusRoot: own });
      expect(parseApplicationCommand(["--steam", "--list-content"], search)).toEqual({ kind: "list-content", corpusRoot: resolve(steamCommon) });
      expect(parseApplicationCommand(["--content-root", join(root, "elsewhere"), "--list-content"], search))
        .toEqual({ kind: "list-content", corpusRoot: join(root, "elsewhere") });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
