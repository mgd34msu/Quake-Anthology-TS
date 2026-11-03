// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { decodeQ1Save, encodeQ1Save } from "../../src/persistence/q1.ts";
import { decodeQ2RereleaseServer, encodeQ2RereleaseServer, decodeQ2RereleaseLevelMetadata, encodeQ2RereleaseLevelMetadata, decodeQ2ClassicServer, encodeQ2ClassicServer } from "../../src/persistence/q2-containers.ts";
import { decodeQ2RereleaseGame, encodeQ2RereleaseGame, decodeQ2RereleaseLevel, encodeQ2RereleaseLevel, readQ2Fog } from "../../src/persistence/q2-rerelease.ts";

// No WinQuake or q2repro/rerelease engine is available to write reference saves here (see the env-gated tests in
// source-saves.test.ts). These fixtures are assembled below from the engines' documented writers with plain string and
// DataView code, independent of the repo's encoders, so a decoder or encoder drift from the documented layout fails.

/** WinQuake host_cmd.c Host_Savegame_f: version, comment, 16 spawn parms (%f), skill (%d), map, time (%f), 64 light styles, globals, edicts. */
function winQuakeSave(): { readonly text: string; readonly comment: string } {
  const comment = "start_____kills:__0/_12";
  const lines = ["5", comment.padEnd(39, "_").slice(0, 39), ...Array.from({ length: 16 }, (_, index) => (index === 1 ? 100 : index === 0 ? 0 : index === 2 ? 25 : 0).toFixed(6)),
    "1", "start", (12.5).toFixed(6)];
  for (let style = 0; style < 64; style++) lines.push(style === 1 ? "mmnmmommommnonmmonqnmmo" : style === 5 ? "mamamamamama" : "m");
  lines.push("{", '"total_secrets" "0"', '"total_monsters" "12"', '"found_secrets" "0"', '"killed_monsters" "0"', '"parm1" "0"', '"parm2" "100"', '"serverflags" "0"', "}");
  lines.push("{", '"classname" "worldspawn"', '"message" "the Slipgate Complex"', '"sounds" "6"', '"wad" "gfx/base.wad"', '"worldtype" "0"', '"model" "maps/start.bsp"', '"modelindex" "1"', '"solid" "4"', '"movetype" "7"', "}");
  lines.push("{", '"classname" "player"', '"origin" "544 288 28.03125"', '"angles" "0 90 0"', '"health" "100"', '"max_health" "100"', '"netname" "player"', '"weapon" "1"', '"items" "4097"', '"ammo_shells" "25"', "}");
  lines.push("{", "}");
  lines.push("{", '"classname" "monster_dog"', '"origin" "-128 640.5 24"', '"health" "25"', "}");
  return { text: `${lines.join("\n")}\n`, comment: comment.padEnd(39, "_").slice(0, 39) };
}

test("a WinQuake-layout version 5 save assembled from Host_Savegame_f decodes and re-encodes byte for byte", () => {
  const { text, comment } = winQuakeSave();
  const bytes = new TextEncoder().encode(text);
  const save = decodeQ1Save(bytes);
  expect(save.format).toEqual({ version: 5 });
  expect(save.comment).toBe(comment);
  expect(save.spawnParameters).toHaveLength(16);
  expect(save.spawnParameters.slice(0, 3)).toEqual([0, 100, 25]);
  expect(save.skill).toBe(1);
  expect(save.map).toBe("start");
  expect(save.time).toBe(12.5);
  expect(save.lightStyles).toHaveLength(64);
  expect(save.lightStyles[1]).toBe("mmnmmommommnonmmonqnmmo");
  expect(save.globals.find(pair => pair.key === "total_monsters")?.value).toBe("12");
  expect(save.entities).toHaveLength(4);
  expect(save.entities[0]?.find(pair => pair.key === "classname")?.value).toBe("worldspawn");
  expect(save.entities[1]?.find(pair => pair.key === "origin")?.value).toBe("544 288 28.03125");
  expect(save.entities[2]).toEqual([]);
  expect(save.entities[3]?.find(pair => pair.key === "classname")?.value).toBe("monster_dog");
  expect(encodeQ1Save(save)).toEqual(bytes);
});

test("a KEX version 6 save with a game directory line keeps the header and the free edict slots", () => {
  const { text } = winQuakeSave();
  const lines = text.split("\n"); lines[0] = "6"; lines.splice(1, 0, "id1;mg1");
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const save = decodeQ1Save(bytes);
  expect(save.format).toEqual({ version: 6, gameDirectories: "id1;mg1" });
  expect(save.map).toBe("start");
  expect(save.entities[2]).toEqual([]);
  expect(encodeQ1Save(save)).toEqual(bytes);
});

test("Quake saves reject truncated or unsupported headers instead of guessing", () => {
  const { text } = winQuakeSave();
  expect(() => decodeQ1Save(new TextEncoder().encode(text.replace(/^5/, "4")))).toThrow("unsupported save version");
  expect(() => decodeQ1Save(new TextEncoder().encode(text.slice(0, 300)))).toThrow();
});

/** q2repro src/server/save.c: the server.ssv magic "SSV2", version 1, a 64-bit timestamp, a kind byte, then C strings; the cvar list ends with an empty name. */
function rereleaseServer(): Uint8Array {
  const parts: number[] = [];
  const u32 = (value: number): void => { const view = new DataView(new ArrayBuffer(4)); view.setUint32(0, value, true); parts.push(...new Uint8Array(view.buffer)); };
  const text = (value: string): void => { parts.push(...new TextEncoder().encode(value), 0); };
  u32(0x32565353); u32(1); u32(0x6531a2b4); u32(0x1); parts.push(1);
  text("Outer Base"); text("gamemap \"*base1\"");
  for (const [name, value] of [["skill", "1"], ["deathmatch", "0"], ["coop", "0"], ["g_coop_squad_respawn", "1"]] as const) { text(name); text(value); }
  text("");
  return Uint8Array.from(parts);
}

/** The level metadata container: "SAV2", version 1, (u16 index, C string) pairs up to the terminator index, then a length-prefixed portal bitmap. */
function rereleaseLevel(configstringEnd: number): Uint8Array {
  const parts: number[] = [];
  const u16 = (value: number): void => { parts.push(value & 255, value >>> 8); };
  const u32 = (value: number): void => { parts.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); };
  const text = (value: string): void => { parts.push(...new TextEncoder().encode(value), 0); };
  u32(0x32564153); u32(1);
  for (const [index, value] of [[0, "Outer Base"], [3, "maps/base1.bsp"], [34, "base1"], [1500, "#w_blaster"]] as const) { u16(index); text(value); }
  u16(configstringEnd); parts.push(3, 0xff, 0x01, 0x80);
  return Uint8Array.from(parts);
}

test("a hand-assembled rerelease server.ssv and level container decode and re-encode byte for byte", () => {
  const server = rereleaseServer();
  const decoded = decodeQ2RereleaseServer(server);
  expect(decoded.kind).toBe(1);
  expect(decoded.timestamp).toBe((1n << 32n) | 0x6531a2b4n);
  expect(decoded.comment).toBe("Outer Base");
  expect(decoded.mapCommand).toBe('gamemap "*base1"');
  expect(decoded.cvars.map(cvar => cvar.name)).toEqual(["skill", "deathmatch", "coop", "g_coop_squad_respawn"]);
  expect(encodeQ2RereleaseServer(decoded)).toEqual(server);
  expect(() => decodeQ2RereleaseServer(server.slice(0, server.length - 4))).toThrow();
  const bad = server.slice(); bad[4] = 2;
  expect(() => decodeQ2RereleaseServer(bad)).toThrow("unsupported server save version");

  const end = 2048 + 20;
  const level = rereleaseLevel(end);
  const metadata = decodeQ2RereleaseLevelMetadata(level, end);
  expect(metadata.configstrings.map(entry => entry.index)).toEqual([0, 3, 34, 1500]);
  expect(metadata.portalBytes).toEqual(Uint8Array.from([0xff, 0x01, 0x80]));
  expect(encodeQ2RereleaseLevelMetadata(metadata, end)).toEqual(level);
  expect(() => decodeQ2RereleaseLevelMetadata(level, end - 5000)).toThrow();
});

test("a hand-written rerelease game and level JSON keep their numbers and entity indices through a roundtrip", () => {
  const game = '{"save_version":1,"game":{"helpmessage1":"","maxclients":1,"max_ammo":[200,50,100]},"clients":[{"pers.health":100,"pers.max_health":100,"pers.weapon":"weapon_blaster"}]}';
  const decodedGame = decodeQ2RereleaseGame(game);
  expect(decodedGame.clients).toHaveLength(1);
  expect(encodeQ2RereleaseGame(decodedGame)).toBe(game);
  const levelText = '{"save_version":1,"level":{"time":1250,"level_name":"base1","fog":{"color":[0.5,0.5,0.6],"density":0.25,"sky_factor":0.0}},"entities":{"0":{"classname":"worldspawn","fog.density":0.25,"fog.color":[0.5,0.5,0.6],"fog.sky_factor":0.0,"fog.color_off":[0,0,0],"fog.density_off":0.0,"fog.sky_factor_off":0.0},"1":{"classname":"player","origin":[544,288,28.03125]},"7":{"classname":"monster_soldier","health":30}}}';
  const level = decodeQ2RereleaseLevel(levelText);
  expect([...level.entities.keys()]).toEqual([0, 1, 7]);
  expect(encodeQ2RereleaseLevel(level)).toBe(levelText);
  const world = level.entities.get(0); if (world === undefined) throw new Error("worldspawn missing");
  expect(readQ2Fog(world).density).toBe(0.25);
  expect(() => decodeQ2RereleaseLevel(levelText.replace('"save_version":1', '"save_version":2'))).toThrow("unsupported game save version");
  expect(() => decodeQ2RereleaseLevel(levelText.replace('"7":', '"07":'))).toThrow("invalid source entity index");
});

test("a classic Quake II server.ssv assembled from the fixed 32, 128 and 128 byte fields roundtrips", () => {
  const field = (value: string, width: number): string => value + "\0".repeat(width - value.length);
  const text = field("Outer Base", 32) + field("base1", 128) + field("skill", 128) + field("1", 128) + field("coop", 128) + field("0", 128);
  const bytes = Uint8Array.from([...text].map(character => character.charCodeAt(0)));
  const server = decodeQ2ClassicServer(bytes);
  expect(server.cvars).toEqual([{ name: "skill", value: "1" }, { name: "coop", value: "0" }]);
  expect(encodeQ2ClassicServer(server)).toEqual(bytes);
});
