// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { createContentDigest } from "../../src/contracts/content.ts";
import { packKexQ2SaveArchive, parseKexQ2SaveArchive } from "../../src/persistence/kex-q2-save.ts";
import {
  decodeQ2RereleaseLevelMetadata,
  decodeQ2RereleaseServer,
  encodeQ2RereleaseLevelMetadata,
  encodeQ2RereleaseServer,
  rereleasePortalBytes,
  rereleasePortalsFrom,
} from "../../src/persistence/q2-containers.ts";
import { q2SaveSlotName } from "../../src/persistence/q2-save-folder.ts";
import { encodeCheckpointValue } from "../../src/persistence/value.ts";
import { q2RereleasePakEntries, readQ2RereleasePak } from "../../src/app/bootstrap/simulation/native-q2-rerelease-pak.ts";
import {
  encodeQ2RereleaseNativeSave,
  decodeQ2RereleaseNativeSave,
  type Q2RereleaseNativeSave,
} from "../../src/app/bootstrap/simulation/native-q2-rerelease-save.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";

/** A save0.pak.gz the rerelease engine wrote: the autosave taken entering Widow's Lair (rboss), byte for byte. */
const RETAIL_AUTOSAVE = Uint8Array.from(
  Buffer.from(
    "H4sIAAAAAAAACwpwdPbmYWBgaABiAAAAAP//Sk/MTdUrLi5jIBH0AHELEAMAAAD//ypOLSpLLSLdBAFGBoZ8JgYGAAAAAP//qubi" +
      "VErOyUzNKylWUrBS4OKM5uLkrK7l4ozVAcqAXAcRBqrjVEosLckvTixLTQGJlRSVpuqARHMTK5BMMISJAQUySzJTwYIWhpZGXJy1" +
      "ICNB+uOBTi7OzM8Dq+eqBQAAAP//ZFLJTgMxDC1iEatAYumVG9dS8QMcuHFDokfLk6SdqFmm40xHiC/gr7GToVOJw0QTP9t579lv" +
      "n68fB2LIwurYP9HjO9r2+2exFKLH/LVVJLoSt4AStglsMp4Evc5BG5Y2cAzQ+8jCJrP7HFcxNlAbdKkGUuhsWGV0OlRxs5CgN9jE" +
      "ANTbpOq96k1n1fo/+nw2jK3tnKGcf8HHnuIjvori0yEx8HfC/xWS2cxLc22qbgU+MgfTwto6V1o9jMQLP2V0kZvfvhnh0Hlwdlso" +
      "zG9HgN+rnBmx2d2I0aZDDa2hBvuQO05HsHH4xWRUdM7KeHKxqK27wCwV+lxxyIdKy4yKxGTQS+nOWtoCOhd7iFpDEhNbTAOXy4Lv" +
      "oryCk5fchvVQ42zKb5wXR4e9yiFxUPEwy3UmJgvrfJF0zVDt8W+Gsjckvu6yZRSyM78AAAD//wMA6A1+w38DAAA=",
    "base64",
  ),
);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

test("the retail autosave pak parses, its server file re-encodes exactly and its entries re-pack to the same archive", () => {
  const archive = parseKexQ2SaveArchive(RETAIL_AUTOSAVE);
  expect(archive.files).toEqual(["game.ssv", "server.ssv"]);
  expect(archive.server).toMatchObject({ kind: 1, comment: "Widow's Lair", mapCommand: "rboss", timestamp: 1717012859n });
  expect(archive.info.gameDirectory).toBe("baseq2");
  const serverBytes = archive.entries.get("server.ssv") ?? new Uint8Array(0);
  expect(encodeQ2RereleaseServer(decodeQ2RereleaseServer(serverBytes))).toEqual(serverBytes);
  const repacked = packKexQ2SaveArchive([...archive.entries]);
  expect(new Uint8Array(gunzipSync(repacked))).toEqual(new Uint8Array(gunzipSync(RETAIL_AUTOSAVE)));
  expect(archive.game).toEqual({ clients: [{}], game: { autosaved: true, maxclients: 1, maxentities: 8192 }, save_version: 1 });
});

test("the retail autosave imports as a game state with no level file, which spawns the map fresh", () => {
  const imported = readQ2RereleasePak(parseKexQ2SaveArchive(RETAIL_AUTOSAVE));
  expect(imported.map).toBe("maps/rboss.bsp");
  expect(imported.spawnPoint).toBe("");
  expect(imported.autosave).toBe(true);
  expect(imported.level).toBeNull();
  expect(imported.visitedLevels).toEqual([]);
  expect(imported.server.configstrings).toEqual([]);
  expect(new TextDecoder().decode(imported.game.native)).toContain('"autosaved" : true');
  expect(imported.server.latched.find(cvar => cvar.name === "gamename")?.value).toBe("baseq2");
  expect(imported.server.latched.find(cvar => cvar.name === "g_coop_instanced_items")?.value).toBe("1");
});

function registry(entries: readonly (readonly [string, string, number])[]): Uint8Array {
  const scratch = new CvarRegistry({
    dialect: "q2-rerelease",
    context: { session: createIdentityOwner("rr-pak").session, origin: { kind: "server-console" } },
  });
  for (const [name, value, flags] of entries) scratch.register(name, value, flags);
  return encodeCheckpointValue(scratch.captureSaveState());
}
function nativeSave(overrides: Partial<Q2RereleaseNativeSave> = {}): Q2RereleaseNativeSave {
  const json = (value: unknown) => ({ native: text(JSON.stringify(value)), deferredDamage: [], projections: [] });
  return {
    module: { id: "q2:rerelease", artifactPath: "game_x64.dll", revision: "r", digest: createContentDigest("b".repeat(64)) },
    map: "maps/base2.bsp",
    api: { kind: "q2-rerelease-game", version: 2023 },
    abi: "windows-x86-64",
    autosave: false,
    server: {
      cvars: registry([
        ["gamename", "baseq2", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch],
        ["skill", "1", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch],
        ["g_coop_num_lives", "2", Q2CvarFlag.Latch],
        ["sv_gravity", "800", 0],
      ]),
      configstrings: [
        { index: 0, value: "Installation" },
        { index: 5, value: "bar ".repeat(75) },
        { index: 63, value: "maps/base2.bsp" },
      ],
      portals: [
        { portal: 1, open: true },
        { portal: 7, open: true },
      ],
    },
    game: json({ save_version: 1, clients: [{ health: 100 }] }),
    level: json({ save_version: 1, entities: { "1": { classname: "player" } } }),
    visitedLevels: [
      {
        version: 1,
        map: "maps/base1.bsp",
        level: json({ save_version: 1, entities: {} }),
        configstrings: [{ index: 0, value: "Outer Base" }],
        portals: [{ portal: 2, open: true }],
      },
    ],
    ...overrides,
  };
}
const counts = (map: string): number => (map === "maps/base1.bsp" ? 5 : 9);
const context = { spawnPoint: "base1", now: new Date(1717012859000), portalCount: counts };

test("a native save becomes the retail pak layout and imports back to the same game, level and server state", async () => {
  const save = nativeSave();
  const entries = await q2RereleasePakEntries(save, context);
  expect(entries.map(([name]) => name)).toEqual(["game.ssv", "server.ssv", "base2.sav", "base2.sv2", "base1.sav", "base1.sv2"]);
  const archive = parseKexQ2SaveArchive(packKexQ2SaveArchive(entries));
  expect(archive.server).toMatchObject({ kind: 0, comment: "Installation", mapCommand: "base2$base1", timestamp: 1717012859n });
  expect(archive.server.cvars.map(cvar => cvar.name)).toEqual(["g_coop_num_lives", "skill", "gamename"]);
  expect(decodeQ2RereleaseLevelMetadata(archive.entries.get("base2.sv2") ?? new Uint8Array(0)).portalBytes).toEqual(
    Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 1, 0]),
  );
  expect(decodeQ2RereleaseLevelMetadata(archive.entries.get("base1.sv2") ?? new Uint8Array(0)).portalBytes.length).toBe(5);
  const imported = readQ2RereleasePak(archive);
  expect(imported.map).toBe("maps/base2.bsp");
  expect(imported.spawnPoint).toBe("base1");
  expect(imported.autosave).toBe(false);
  expect(imported.game.native).toEqual(save.game.native);
  expect(imported.level?.native).toEqual(save.level?.native);
  expect(imported.server.configstrings).toEqual(save.server.configstrings);
  expect(imported.server.portals).toEqual(save.server.portals);
  expect(imported.visitedLevels).toEqual(save.visitedLevels.map(level => ({ ...level, level: { ...level.level } })));
  expect(imported.server.latched).toEqual(archive.server.cvars);
});

test("an autosave pak holds the game and server files plus only the levels already left", async () => {
  const entries = await q2RereleasePakEntries(nativeSave({ autosave: true, level: null }), context);
  expect(entries.map(([name]) => name)).toEqual(["game.ssv", "server.ssv", "base1.sav", "base1.sv2"]);
  expect(parseKexQ2SaveArchive(packKexQ2SaveArchive(entries)).server.kind).toBe(1);
});

test("a level whose portal count differs from the map's is refused instead of written wrong", async () => {
  await expect(q2RereleasePakEntries(nativeSave(), { ...context, portalCount: () => 4 })).rejects.toThrow("portal");
  expect(() => rereleasePortalBytes([{ portal: 3, open: true }], 3)).toThrow("portal count");
  expect(rereleasePortalsFrom(Uint8Array.from([0, 1, 1]))).toEqual([
    { portal: 1, open: true },
    { portal: 2, open: true },
  ]);
});

test("a long status bar crosses 96 byte slots as the rerelease engine writes it and unpacks as one string", () => {
  const bar = "stat ".repeat(60);
  const bytes = encodeQ2RereleaseLevelMetadata({ configstrings: [{ index: 5, value: bar }], portalBytes: new Uint8Array(0) });
  // Four entries: slots 5, 6 and 7 hold 96 bytes each and slot 8 the last 12; then the -1 terminator and a zero portal count.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lengths: number[] = [];
  for (let offset = 0; view.getUint32(offset, true) !== 0xffffffff; ) {
    lengths.push(view.getUint8(offset + 4));
    offset += 5 + view.getUint8(offset + 4);
  }
  expect(lengths).toEqual([96, 96, 96, 12]);
  expect(decodeQ2RereleaseLevelMetadata(bytes).configstrings).toEqual([{ index: 5, value: bar }]);
});

test("archives with unknown entries, repeated names or unpaired level files are refused", () => {
  const entries: [string, Uint8Array][] = [
    ["game.ssv", text("{}")],
    ["server.ssv", encodeQ2RereleaseServer({ timestamp: 0n, kind: 0, comment: "", mapCommand: "base1", cvars: [] })],
  ];
  expect(() => readQ2RereleasePak(parseKexQ2SaveArchive(packKexQ2SaveArchive([...entries, ["notes.txt", text("x")]])))).toThrow("unknown entry");
  expect(() => readQ2RereleasePak(parseKexQ2SaveArchive(packKexQ2SaveArchive([...entries, ["base1.sav", text("{}")]])))).toThrow("both");
  expect(() => packKexQ2SaveArchive([...entries, ["GAME.ssv", text("{}")]])).toThrow("repeats");
  expect(() => packKexQ2SaveArchive([["a/b", text("{}")]])).toThrow("invalid");
  // The engine's map-restart backup entries are not part of the saved game.
  const withBackup = readQ2RereleasePak(parseKexQ2SaveArchive(packKexQ2SaveArchive([...entries, [".restart.sav", text("{}")], [".restart.sv2", text("x")]])));
  expect(withBackup.visitedLevels).toEqual([]);
  expect(q2SaveSlotName("save0.pak.gz".replace(/\.pak\.gz$/, ""))).toBe("save0");
});

test("the provider record keeps decoding a version 1 save and records an absent level in version 2", () => {
  const save = nativeSave();
  const record = encodeQ2RereleaseNativeSave(save);
  expect(record.version).toBe(2);
  expect(decodeQ2RereleaseNativeSave(record, save)).toEqual(save);
  const absent = encodeQ2RereleaseNativeSave(nativeSave({ level: null }));
  expect(decodeQ2RereleaseNativeSave(absent, save).level).toBeNull();
  // Version 1 had no way to say a level was absent; its record always carried one.
  expect(decodeQ2RereleaseNativeSave({ ...record, version: 1 }, save)).toEqual(save);
  expect(() => decodeQ2RereleaseNativeSave({ ...absent, version: 1 }, save)).toThrow();
  expect(() => decodeQ2RereleaseNativeSave({ ...record, version: 3 }, save)).toThrow("Unsupported");
});
