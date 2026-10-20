import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { testCorpusRoot } from "../../support/corpus.ts";
import { homedir } from "node:os";
import { nightdiveAddonDirectories } from "../../../src/content/roots.ts";

function lengthString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value), out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true); out.set(bytes, 4); return out;
}
function kexServerSave(comment: string, map: string, gamename: string): Uint8Array {
  const parts = [new TextEncoder().encode("EVAS"), new Uint8Array([1]), lengthString(comment),
    new Uint8Array(8), lengthString(map), lengthString("gamename"), lengthString(gamename), lengthString("")];
  const total = parts.reduce((sum, part) => sum + part.length, 0), result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function pakWith(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  let offset = 12;
  const placed = entries.map(([name, bytes]) => { const entry = { name, bytes, offset }; offset += bytes.length; return entry; });
  const pak = new Uint8Array(offset + entries.length * 64), view = new DataView(pak.buffer);
  pak.set(new TextEncoder().encode("PACK")); view.setUint32(4, offset, true); view.setUint32(8, entries.length * 64, true);
  for (const [index, entry] of placed.entries()) {
    pak.set(entry.bytes, entry.offset);
    pak.set(new TextEncoder().encode(entry.name), offset + index * 64);
    view.setUint32(offset + index * 64 + 56, entry.offset, true); view.setUint32(offset + index * 64 + 60, entry.bytes.length, true);
  }
  return pak;
}

test.skipIf(!existsSync(join(testCorpusRoot(), "q2/rerelease/baseq2/pak0.pak")))("retail KEX transition save loads as a fresh spawn on its recorded map", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-kex-load-"));
  try {
    const path = join(root, "save0.pak.gz");
    await writeFile(path, gzipSync(pakWith([
      ["server.ssv", kexServerSave("Transition", "base1", "baseq2")],
      ["game.ssv", new TextEncoder().encode(JSON.stringify({ clients: [{}], game: { autosaved: true, maxclients: 1, maxentities: 8192 }, save_version: 1 }))],
    ])));
    const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q2-rerelease-baseq2", "--map", "base1",
      "--movement", "q2", "--character", "q2", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const app = await Application.open(parsed.options, { print: () => undefined });
    try {
      await app.loadGame(path);
      const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
      for (let index = 0; index < 10; index++) await app.step(50);
      expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
      expect(app.simulation.recipe.map.geometry.requestedPath).toContain("base1");
    } finally { await app.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 180000);

test.skipIf(!existsSync(join(testCorpusRoot(), "q2/rerelease/baseq2/pak0.pak")))("retail KEX save with recorded client state is refused, not partially restored", async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-kex-refuse-"));
  try {
    const path = join(root, "save0.pak.gz");
    await writeFile(path, gzipSync(pakWith([
      ["server.ssv", kexServerSave("Mid-level", "base1", "baseq2")],
      ["game.ssv", new TextEncoder().encode(JSON.stringify({ clients: [{ pers: { health: 37 } }], game: { autosaved: false, maxclients: 1 }, save_version: 1 }))],
    ])));
    const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q2-rerelease-baseq2", "--map", "base1",
      "--movement", "q2", "--character", "q2", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
    if (parsed.kind !== "run") throw new Error("Missing launch");
    const app = await Application.open(parsed.options, { print: () => undefined });
    try {
      await expect(app.loadGame(path)).rejects.toThrow("cannot be restored");
    } finally { await app.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 180000);

const realQ2Root = nightdiveAddonDirectories(homedir()).find(root => root.family === "q2")?.root;
const realQ2SavePath = realQ2Root === undefined ? "" : join(realQ2Root, "baseq2/save/save0.pak.gz");
test.skipIf(realQ2Root === undefined || !existsSync(realQ2SavePath) || !existsSync(join(testCorpusRoot(), "q2/rerelease/baseq2/pak0.pak")))("the installed steam q2 save loads on its recorded map", async () => {
  const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q2-rerelease-baseq2", "--map", "base1",
    "--movement", "q2", "--character", "q2", "--mode", "singleplayer", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "240"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    await app.loadGame(realQ2SavePath);
    const local = app.localPlayers[0]; if (local === undefined) throw new Error("Missing local player");
    for (let index = 0; index < 10; index++) await app.step(50);
    expect(app.simulation.playerUi(local.actor).health).toBeGreaterThan(0);
    expect(app.simulation.recipe.map.geometry.requestedPath).toContain("rboss");
  } finally { await app.close(); }
}, 180000);
