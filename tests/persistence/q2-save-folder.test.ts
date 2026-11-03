// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { join } from "node:path";
import { createContentDigest } from "../../src/contracts/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry, Q2CvarFlag } from "../../src/core/cvars/index.ts";
import { encodeCheckpointValue } from "../../src/persistence/value.ts";
import {
  classicPortalBytes,
  classicPortalsFrom,
  decodeQ2ClassicLevelMetadata,
  decodeQ2ClassicServer,
  encodeQ2ClassicLevelMetadata,
  encodeQ2ClassicServer,
  packConfigstrings,
  unpackConfigstrings,
} from "../../src/persistence/q2-containers.ts";
import type { Q2ClassicOriginalSave } from "../../src/persistence/q2-classic-guest.ts";
import {
  parseQ2MapCommand,
  q2ClassicFolder,
  q2ClassicFolderHeader,
  q2FilesDigest,
  q2LatchedCvars,
  q2MapCommand,
  q2SaveSlotName,
  readQ2ClassicFolder,
} from "../../src/persistence/q2-save-folder.ts";
import { Q2SaveStore } from "../../src/persistence/q2-save-store.ts";
import { decodeSaveSidecar, encodeSaveSidecar } from "../../src/persistence/saved-game.ts";
import { corpusFile, corpusTest } from "../support/corpus.ts";
import { saveImageFixture } from "../support/save-fixtures.ts";
import { trackedTempDirectories } from "../support/temp-directories.ts";

const tempDirectory = trackedTempDirectories();
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function cvarRegistry(entries: readonly (readonly [string, string, number])[]): Uint8Array {
  const scratch = new CvarRegistry({
    dialect: "q2-classic",
    context: { session: createIdentityOwner("q2-save-test").session, origin: { kind: "server-console" } },
  });
  for (const [name, value, flags] of entries) scratch.register(name, value, flags);
  return encodeCheckpointValue(scratch.captureSaveState());
}

function synthetic(overrides: Partial<Q2ClassicOriginalSave> = {}): Q2ClassicOriginalSave {
  return {
    module: { id: "q2:classic", artifactPath: "gamex86.dll", revision: "r", digest: createContentDigest("a".repeat(64)) },
    map: "maps/base2.bsp",
    api: { kind: "q2-classic-game", version: 3 },
    abi: "windows-i386",
    autosave: false,
    server: {
      cvars: cvarRegistry([
        ["maxclients", "1", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch],
        ["skill", "2", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch],
        ["dmflags", "0", Q2CvarFlag.ServerInfo],
        ["coop", "0", Q2CvarFlag.ServerInfo | Q2CvarFlag.Latch],
      ]),
      configstrings: [
        { index: 0, value: "Installation" },
        { index: 5, value: "x".repeat(150) },
        { index: 33, value: "maps/base2.bsp" },
      ],
      portals: [
        { portal: 3, open: true },
        { portal: 900, open: true },
      ],
    },
    game: text("Oct 16 1998\0game-bytes"),
    level: text("level-two"),
    visitedLevels: [
      {
        version: 1,
        map: "maps/base1.bsp",
        level: text("level-one"),
        configstrings: [{ index: 0, value: "Outer Base" }],
        portals: [{ portal: 7, open: true }],
      },
    ],
    ...overrides,
  };
}

test("a long string spills across configstring slots in the array and unpacks as one string", () => {
  const entries = [
    { index: 0, value: "Outer Base" },
    { index: 5, value: "s".repeat(150) },
    { index: 40, value: "*1" },
  ];
  const memory = packConfigstrings(entries, 2080, 64);
  // The status bar occupies slots 5, 6 and 7: 64 + 64 + 23 bytes and a NUL, with no entry of its own for 6 and 7.
  expect(memory.subarray(5 * 64, 5 * 64 + 150).every(byte => byte === 115)).toBe(true);
  expect(memory[5 * 64 + 150]).toBe(0);
  expect(unpackConfigstrings(memory, 2080, 64)).toEqual(entries);
  expect(packConfigstrings(unpackConfigstrings(memory, 2080, 64), 2080, 64)).toEqual(memory);
  expect(() => packConfigstrings([{ index: 2080, value: "x" }], 2080, 64)).toThrow("outside");
  expect(() => packConfigstrings([{ index: 1, value: "a\0b" }], 2080, 64)).toThrow("NUL");
});

test("classic portal state is the original's 1024 ints and lists only open portals", () => {
  const bytes = classicPortalBytes([
    { portal: 0, open: true },
    { portal: 1023, open: true },
    { portal: 5, open: false },
  ]);
  expect(bytes.length).toBe(4096);
  expect(classicPortalsFrom(bytes)).toEqual([
    { portal: 0, open: true },
    { portal: 1023, open: true },
  ]);
  expect(() => classicPortalBytes([{ portal: 1024, open: true }])).toThrow("MAX_MAP_AREAPORTALS");
  expect(() => classicPortalsFrom(new Uint8Array(10))).toThrow("MAX_MAP_AREAPORTALS");
});

test("slot names and map commands follow SV_Savegame_f and SV_Map", () => {
  expect(q2SaveSlotName("save1.sav")).toBe("save1");
  expect(() => q2SaveSlotName("current")).toThrow("Can't save to 'current'");
  expect(() => q2SaveSlotName("CURRENT")).toThrow("current");
  for (const bad of ["../x", "a/b", "a\\b", "x..y", ""]) expect(() => q2SaveSlotName(bad)).toThrow("Bad savedir");
  expect(parseQ2MapCommand("*base1")).toEqual({ map: "maps/base1.bsp", spawnPoint: "" });
  expect(parseQ2MapCommand("base2$base1")).toEqual({ map: "maps/base2.bsp", spawnPoint: "base1" });
  expect(() => parseQ2MapCommand("intro.cin+base1")).toThrow("unsupported map command");
  expect(q2MapCommand("maps/base2.bsp", "base1")).toBe("base2$base1");
  expect(q2MapCommand("maps/base2.bsp", "")).toBe("base2");
});

test("the latched cvars recorded are exactly the CVAR_LATCH ones, newest registration first", () => {
  const cvars = q2LatchedCvars(synthetic().server.cvars, "q2-classic");
  expect(cvars).toEqual([
    { name: "coop", value: "0" },
    { name: "skill", value: "2" },
    { name: "maxclients", value: "1" },
  ]);
});

test("a save written by the engine decodes back to the structure the original files carry", () => {
  const now = new Date(2026, 9, 12, 14, 5);
  const save = synthetic();
  const files = q2ClassicFolder(save, { mapCommand: q2MapCommand(save.map, "base1"), now });
  expect([...files.keys()].sort()).toEqual(["base1.sav", "base1.sv2", "base2.sav", "base2.sv2", "game.ssv", "server.ssv"]);
  const server = decodeQ2ClassicServer(files.get("server.ssv") ?? new Uint8Array(0));
  expect(server.comment).toBe("14:05 10/12  Installation");
  expect(server.mapCommand).toBe("base2$base1");
  expect(files.get("server.ssv")?.length).toBe(32 + 128 + 3 * 256);
  expect(files.get("base2.sv2")?.length).toBe(2080 * 64 + 4096);
  expect(files.get("game.ssv")).toEqual(save.game);
  const header = q2ClassicFolderHeader(files.get("server.ssv") ?? new Uint8Array(0));
  expect(header).toEqual({ comment: "14:05 10/12  Installation", map: "maps/base2.bsp", spawnPoint: "base1", autosave: false });

  const read = readQ2ClassicFolder(files);
  expect(read.map).toBe("maps/base2.bsp");
  expect(read.spawnPoint).toBe("base1");
  expect(read.autosave).toBe(false);
  expect(read.game).toEqual(save.game);
  expect(read.level).toEqual(save.level);
  expect(read.server.latched).toEqual(server.cvars);
  expect(read.server.configstrings).toEqual(save.server.configstrings);
  expect(read.server.portals).toEqual(save.server.portals);
  expect(read.visitedLevels).toEqual(save.visitedLevels);
});

test("an autosave is named ENTERING and carries no file for the level just entered", () => {
  const save = synthetic({ autosave: true, level: null });
  const files = q2ClassicFolder(save, { mapCommand: "base2", now: new Date(2026, 0, 1) });
  expect([...files.keys()].sort()).toEqual(["base1.sav", "base1.sv2", "game.ssv", "server.ssv"]);
  const read = readQ2ClassicFolder(files);
  expect(read.autosave).toBe(true);
  expect(read.level).toBeNull();
  expect(read.server.configstrings).toEqual([]);
  expect(decodeQ2ClassicServer(files.get("server.ssv") ?? new Uint8Array(0)).comment).toBe("ENTERING Installation");
  // The comment is a 32 byte field with its NUL, so a longer name is cut.
  const long = synthetic({ server: { ...synthetic().server, configstrings: [{ index: 0, value: "A very long level name indeed" }] } });
  expect(
    decodeQ2ClassicServer(q2ClassicFolder(long, { mapCommand: "base2", now: new Date(2026, 0, 1) }).get("server.ssv") ?? new Uint8Array(0)).comment.length,
  ).toBe(31);
});

test("a folder missing a file the original needs is refused with the file named", () => {
  const files = q2ClassicFolder(synthetic(), { mapCommand: "base2", now: new Date(2026, 0, 1) });
  const without = (name: string) => new Map([...files].filter(([file]) => file !== name));
  expect(() => readQ2ClassicFolder(without("server.ssv"))).toThrow("no server.ssv");
  expect(() => readQ2ClassicFolder(without("game.ssv"))).toThrow("no game.ssv");
  expect(() => readQ2ClassicFolder(without("base1.sv2"))).toThrow("base1.sv2");
});

corpusTest("q2/baseq2/save/save0/server.ssv")("the real classic autosave decodes and re-encodes byte for byte, spill and all", async () => {
  const folder = corpusFile("q2/baseq2/save/save0");
  const files = await new Q2SaveStore(join(folder, "..")).read("save0");
  const serverBytes = files.get("server.ssv") ?? new Uint8Array(0);
  const server = decodeQ2ClassicServer(serverBytes);
  expect(server.comment).toBe("ENTERING Installation");
  expect(encodeQ2ClassicServer(server)).toEqual(serverBytes);
  const levelBytes = files.get("base1.sv2") ?? new Uint8Array(0);
  const level = decodeQ2ClassicLevelMetadata(levelBytes);
  expect(levelBytes.length).toBe(2080 * 64 + 4096);
  // CS_STATUSBAR (5) is one string even though the original stores it across slots 5 to 9.
  expect(level.configstrings.find(entry => entry.index === 5)?.value.length).toBeGreaterThan(64 * 4);
  expect(level.configstrings.some(entry => entry.index === 6)).toBe(false);
  expect(level.configstrings.find(entry => entry.index === 0)?.value).toBe("Outer Base");
  expect(encodeQ2ClassicLevelMetadata(level)).toEqual(levelBytes);
  expect(classicPortalBytes(classicPortalsFrom(level.portalBytes))).toEqual(level.portalBytes);

  const read = readQ2ClassicFolder(files);
  // The autosave was taken entering the next level, so the level just left is the one visited and the new one is unwritten.
  expect(read.autosave).toBe(true);
  expect(read.map).toBe("maps/base2ex.bsp");
  expect(read.level).toBeNull();
  expect(read.visitedLevels.map(visited => visited.map)).toEqual(["maps/base1.bsp"]);
  expect(read.visitedLevels[0]?.level).toEqual(files.get("base1.sav") ?? new Uint8Array(0));
  expect(read.game).toEqual(files.get("game.ssv") ?? new Uint8Array(0));
  expect(read.server.latched.map(cvar => cvar.name)).toEqual(server.cvars.map(cvar => cvar.name));
  expect(read.server.latched.find(cvar => cvar.name === "skill")?.value).toBe("1");
});

corpusTest("q2/baseq2/save/current/server.ssv")("every level file of the real current folder pairs and re-encodes exactly", async () => {
  const files = await new Q2SaveStore(corpusFile("q2/baseq2/save")).read("current");
  const levels = [...files.keys()].filter(name => /\.sav$/i.test(name));
  expect(levels.length).toBeGreaterThan(20);
  for (const name of levels) {
    const metadata = files.get(name.replace(/\.sav$/i, ".sv2"));
    if (metadata === undefined) throw new Error(`${name} has no metadata`);
    expect(encodeQ2ClassicLevelMetadata(decodeQ2ClassicLevelMetadata(metadata))).toEqual(metadata);
  }
  const read = readQ2ClassicFolder(files);
  expect(read.visitedLevels.length).toBe(levels.length);
});

test("save and load move a slot through the current folder the way SV_CopySaveGame does", async () => {
  const root = await tempDirectory("q2-store-");
  const store = new Q2SaveStore(root);
  const first = q2ClassicFolder(synthetic(), { mapCommand: "base2", now: new Date(2026, 0, 1) });
  await store.save("slot", first);
  expect([...(await store.read("slot")).keys()].sort()).toEqual([...first.keys()].sort());
  expect([...(await store.read("current")).keys()].sort()).toEqual([...first.keys()].sort());
  // A later save leaves nothing of the earlier unit behind in either folder, and keeps files the original does not own.
  await Bun.write(join(root, "slot", "steam_autocloud.vdf"), "keep");
  await Bun.write(join(root, "slot", "qts.qtsave"), "sidecar");
  const second = q2ClassicFolder(synthetic({ visitedLevels: [] }), { mapCommand: "base2", now: new Date(2026, 0, 1) });
  await store.save("slot", second);
  const after = await store.read("slot");
  expect([...after.keys()].sort()).toEqual(["base2.sav", "base2.sv2", "game.ssv", "qts.qtsave", "server.ssv", "steam_autocloud.vdf"]);
  expect(after.get("steam_autocloud.vdf")).toEqual(text("keep"));
  expect([...(await store.read("current")).keys()].sort()).toEqual(["base2.sav", "base2.sv2", "game.ssv", "server.ssv"]);
  // load: the slot becomes current.
  await store.save("other", first);
  const loaded = await store.load("slot");
  expect([...loaded.keys()].sort()).toEqual(["base2.sav", "base2.sv2", "game.ssv", "server.ssv"]);
  expect(loaded.get("server.ssv")).toEqual(second.get("server.ssv"));
  expect(await store.read("missing")).toEqual(new Map<string, Uint8Array>());
});

test("the engine sidecar is used only while it agrees with the original files", () => {
  const files = q2ClassicFolder(synthetic(), { mapCommand: "base2", now: new Date(2026, 0, 1) });
  const image = saveImageFixture();
  const sidecar = encodeSaveSidecar(q2FilesDigest(files), image);
  expect(decodeSaveSidecar(sidecar, q2FilesDigest(files))?.recipe.id).toBe(image.recipe.id);
  // The digest ignores the case of file names, as the original's file system does.
  const upper = new Map([...files].map(([name, bytes]) => [name.toUpperCase(), bytes] satisfies [string, Uint8Array]));
  expect(q2FilesDigest(upper)).toEqual(q2FilesDigest(files));
  // Any changed byte, added file or removed file breaks the agreement and the original files load alone.
  const changed = new Map(files);
  const server = (changed.get("server.ssv") ?? new Uint8Array(0)).slice();
  server[0] = (server[0] ?? 0) ^ 1;
  changed.set("server.ssv", server);
  expect(decodeSaveSidecar(sidecar, q2FilesDigest(changed))).toBeNull();
  expect(decodeSaveSidecar(sidecar, q2FilesDigest(new Map([...files, ["extra.sav", text("x")]])))).toBeNull();
  expect(decodeSaveSidecar(sidecar, q2FilesDigest(new Map([...files].filter(([name]) => name !== "base1.sav"))))).toBeNull();
  expect(decodeSaveSidecar(text("not a sidecar"), q2FilesDigest(files))).toBeNull();
});
