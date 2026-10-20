import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StartupSaves, resolveExternalSavePath } from "../../src/app/bootstrap/startup-saves.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { nightdiveAddonDirectories } from "../../src/content/roots.ts";
import { decodeKexQ2ServerSave, readKexQ2SaveInfo } from "../../src/persistence/kex-q2-save.ts";
import { encodeQ1Save, type Q1SaveData } from "../../src/persistence/q1.ts";
import { testCorpusRoot } from "../support/corpus.ts";

function lengthString(value: string): Uint8Array {
  const bytes = new Uint8Array(4 + value.length);
  new DataView(bytes.buffer).setUint32(0, value.length, true);
  bytes.set(new TextEncoder().encode(value), 4);
  return bytes;
}

function kexServerSave(comment: string, map: string, gamename: string): Uint8Array {
  const stamp = new Uint8Array(8);
  const parts = [new TextEncoder().encode("EVAS"), new Uint8Array([1]), lengthString(comment),
    stamp, lengthString(map), lengthString("gamename"), lengthString(gamename), lengthString("")];
  new DataView(stamp.buffer).setUint32(0, 1717012859, true);
  const total = parts.reduce((sum, part) => sum + part.length, 0), result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function pakWith(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  let dataOffset = 12;
  const directory = entries.map(([name, data]) => { const record = { name, data, offset: dataOffset }; dataOffset += data.length; return record; });
  const bytes = new Uint8Array(dataOffset + entries.length * 64), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PACK"));
  view.setUint32(4, dataOffset, true); view.setUint32(8, entries.length * 64, true);
  for (const entry of directory) {
    bytes.set(entry.data, entry.offset);
    const at = dataOffset + directory.indexOf(entry) * 64;
    bytes.set(new TextEncoder().encode(entry.name), at);
    view.setUint32(at + 56, entry.offset, true); view.setUint32(at + 60, entry.data.length, true);
  }
  return bytes;
}

function q1Save(map: string): Q1SaveData {
  return { format: { version: 6, gameDirectories: "id1" }, comment: "kex_save",
    spawnParameters: Array.from({ length: 16 }, (_, index) => index), skill: 1, map, time: 12,
    lightStyles: Array.from({ length: 64 }, () => "m"), globals: [{ key: "serverflags", value: "0" }],
    entities: [[{ key: "classname", value: "worldspawn" }], [{ key: "health", value: "100" }]], extensionText: "" };
}

test("kex q2 server saves decode comment, map and game directory", () => {
  const info = decodeKexQ2ServerSave(kexServerSave("Widow's Lair", "rboss", "baseq2"));
  expect(info.comment).toBe("Widow's Lair");
  expect(info.mapCommand).toBe("rboss");
  expect(info.gameDirectory).toBe("baseq2");
  expect(info.timestamp).toBe(1717012859n);
  expect(() => decodeKexQ2ServerSave(new TextEncoder().encode("NOPE"))).toThrow("EVAS");
});

const steamRoots = nightdiveAddonDirectories(homedir());
const realQ1Root = steamRoots.find(root => root.family === "q1")?.root;
const realQ1SavePath = realQ1Root === undefined ? "" : join(realQ1Root, "s1.sav");
test.skipIf(realQ1Root === undefined || !existsSync(realQ1SavePath))("the installed steam q1 save decodes and roundtrips its world records", async () => {
  const { decodeSavedGame } = await import("../../src/persistence/saved-game.ts");
  const first = decodeSavedGame(await Bun.file(realQ1SavePath).bytes());
  if (first.kind !== "q1-source") throw new Error("Expected a KEX Q1 source save");
  expect(first.data.format.version).toBe(6);
  expect(first.data.entities.length).toBeGreaterThan(2);
  const second = decodeSavedGame(encodeQ1Save(first.data));
  if (second.kind !== "q1-source") throw new Error("Roundtrip lost the source format");
  expect(second.data.entities).toEqual(first.data.entities);
  expect(second.data.globals).toEqual(first.data.globals);
  expect(second.data.map).toBe(first.data.map);
  expect(Math.abs(second.data.time - first.data.time)).toBeLessThan(0.001);
});
const realQ2Save = steamRoots.find(root => root.family === "q2")?.root;
const realQ2SavePath = realQ2Save === undefined ? "" : join(realQ2Save, "baseq2/save/save0.pak.gz");
test.skipIf(realQ2Save === undefined || !existsSync(realQ2SavePath))("the installed steam q2 save identifies its map and game", async () => {
  const info = await readKexQ2SaveInfo(realQ2SavePath);
  expect(info.mapCommand).not.toBe("");
  expect(info.gameDirectory).toBe("baseq2");
});

test.skipIf(!existsSync(testCorpusRoot()))("external nightdive saves list beside own saves and resolve by name", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "quake-kex-saves-"));
  try {
    const own = join(root, "saves"), external = join(root, "steam/Quake");
    await mkdir(own, { recursive: true });
    await mkdir(join(root, "steam/Quake", "honey"), { recursive: true });
    await mkdir(join(root, "steam/Quake II/baseq2/save"), { recursive: true });
    await writeFile(join(external, "s1.sav"), encodeQ1Save(q1Save("e1m1")));
    await writeFile(join(external, "honey/s2.sav"), encodeQ1Save(q1Save("e1m2")));
    await writeFile(join(root, "steam/Quake II/baseq2/save/save0.pak.gz"),
      gzipSync(pakWith([["server.ssv", kexServerSave("Widow's Lair", "rboss", "baseq2")], ["game.ssv", new TextEncoder().encode("{}")]])));
    const catalog = await discoverInstalledContent({ corpusRoot: testCorpusRoot(), discoverMods: false });
    const saves = new StartupSaves(catalog, own, [external, join(root, "steam/Quake II")]);
    await saves.refresh();
    const rows = saves.list.rows;
    expect(rows).toHaveLength(3);
    const s1 = rows.find(row => row.id === "external/0/s1.sav");
    expect(s1?.unavailable).toBeNull();
    expect(s1?.map).toBe("e1m1");
    expect(s1?.game).toContain("rerelease");
    expect(saves.path("external/0/s1.sav")).toBe(join(external, "s1.sav"));
    const q2 = rows.find(row => row.id.endsWith("save0.pak.gz"));
    expect(q2?.label).toBe("Widow's Lair");
    expect(q2?.map).toBe("rboss");
    expect(q2?.unavailable).toContain("cannot be restored");
    expect(await resolveExternalSavePath([external], "s1")).toBe(join(external, "s1.sav"));
    expect(await resolveExternalSavePath([external], "s2")).toBe(join(external, "honey/s2.sav"));
    expect(await resolveExternalSavePath([external], "missing")).toBeNull();
    expect(await resolveExternalSavePath([external], "../s1")).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});
