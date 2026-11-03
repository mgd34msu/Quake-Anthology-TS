// SPDX-License-Identifier: GPL-2.0-or-later
import { expect } from "bun:test";
import { cp, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Application } from "../../../src/app/bootstrap/application.ts";
import { prepareApplicationSave } from "../../../src/app/bootstrap/original-save.ts";
import { parseApplicationCommand } from "../../../src/app/bootstrap/options.ts";
import { StartupSaves } from "../../../src/app/bootstrap/startup-saves.ts";
import { nativeSaveFolders } from "../../../src/app/bootstrap/native-settings.ts";
import { discoverInstalledContent } from "../../../src/content/catalog/index.ts";
import { parseKexQ2SaveArchive } from "../../../src/persistence/kex-q2-save.ts";
import {
  classicPortalsFrom,
  decodeQ2ClassicLevelMetadata,
  decodeQ2ClassicServer,
  decodeQ2RereleaseLevelMetadata,
  decodeQ2RereleaseServer,
} from "../../../src/persistence/q2-containers.ts";
import { q2FilesDigest } from "../../../src/persistence/q2-save-folder.ts";
import { Q2SaveStore } from "../../../src/persistence/q2-save-store.ts";
import { decodeSaveSidecar } from "../../../src/persistence/saved-game.ts";
import { encodeSaveImage } from "../../../src/persistence/save-image.ts";
import { corpusFile, corpusTest, testCorpusRoot } from "../../support/corpus.ts";
import { trackedTempDirectories } from "../../support/temp-directories.ts";

const tempDirectory = trackedTempDirectories();

/** Launches a stock game with its original game module and the native folders redirected under `root`. */
async function openStock(
  root: string,
  product: string,
  library: string | null,
  map: string,
  movement: string,
): Promise<{ readonly app: Application; readonly printed: string[] }> {
  const parsed = parseApplicationCommand([
    "--content-root",
    testCorpusRoot(),
    "--game",
    product,
    ...(library === null ? [] : ["--q2-game", library]),
    "--map",
    map,
    "--movement",
    movement,
    "--character",
    "q2",
    "--renderer",
    "cpu",
    "--hidden",
    "--width",
    "320",
    "--height",
    "240",
    "--user-content-root",
    root,
  ]);
  if (parsed.kind !== "run") throw new Error("Missing launch options");
  const printed: string[] = [];
  const app = await Application.open(
    { ...parsed.options, nativeConfigRoot: join(root, "native") },
    {
      print: text => {
        printed.push(text);
        return undefined;
      },
      saveDirectory: join(root, "saves"),
    },
  );
  return { app, printed };
}
async function command(app: Application, name: string, args: readonly string[]): Promise<void> {
  app.queueCommand(name, args, null);
  await app.step(100);
}
async function files(directory: string): Promise<string[]> {
  return (await readdir(directory).catch(() => [])).sort();
}
const health = (app: Application): number => app.simulation.playerUi(app.localPlayers[0]?.actor ?? failure("no local player")).health;
function failure(message: string): never {
  throw new Error(message);
}

corpusTest("q2/baseq2/pak0.pak", "q2/baseq2/gamex86.dll", "q2/baseq2/save/save0/server.ssv")(
  "a stock classic game on its original module saves as id's folder, autosaves as save0, and loads its own and the original's files",
  async () => {
    const root = await tempDirectory("q2-original-save-");
    const saves = join(root, "native", "q2", "baseq2", "save");
    const { app, printed } = await openStock(root, "q2-classic-baseq2", "gamex86.dll", "base1", "q2");
    try {
      const local = app.localPlayers[0] ?? failure("no local player");
      for (let frame = 0; frame < 5; frame++) await app.step(50);
      // Entering a level writes save0 the way SV_GameMap_f does: server and game files, and no file for the level just entered.
      const store = new Q2SaveStore(saves);
      expect(await files(join(saves, "save0"))).toEqual(["game.ssv", "qts.qtsave", "server.ssv"]);
      const entered = decodeQ2ClassicServer((await store.read("save0")).get("server.ssv") ?? new Uint8Array(0));
      expect(entered.comment).toBe("ENTERING Outer Base");
      expect(entered.mapCommand).toBe("base1");

      app.simulation.playerCommand(local.actor, "give", ["health", "137"]);
      await app.step(100);
      const origin = app.simulation.playerView(local.actor).origin;
      await command(app, "save", ["mysave"]);
      expect(printed.join("")).toContain(join(saves, "mysave", "server.ssv"));
      // `save NAME` writes every file the original does, through its `current` folder.
      expect(await files(join(saves, "mysave"))).toEqual(["base1.sav", "base1.sv2", "game.ssv", "qts.qtsave", "server.ssv"]);
      expect(await files(join(saves, "current"))).toEqual(["base1.sav", "base1.sv2", "game.ssv", "server.ssv"]);

      // The same structure as the real save in the corpus: field widths, cvar names, the level file size and the module's date stamp.
      const written = await store.read("mysave"),
        reference = await new Q2SaveStore(corpusFile("q2/baseq2/save")).read("save0");
      const server = decodeQ2ClassicServer(written.get("server.ssv") ?? new Uint8Array(0));
      expect(written.get("server.ssv")?.length).toBe(160 + 256 * server.cvars.length);
      expect(server.comment).toMatch(/^[ \d]\d:\d\d [ \d]\d\/[ \d]\d {2}Outer Base$/);
      expect(server.mapCommand).toBe("base1");
      const referenceCvars = new Map(decodeQ2ClassicServer(reference.get("server.ssv") ?? new Uint8Array(0)).cvars.map(cvar => [cvar.name, cvar.value]));
      for (const cvar of server.cvars) if (referenceCvars.has(cvar.name)) expect(cvar.value).toBe(referenceCvars.get(cvar.name) ?? "");
      for (const name of ["maxentities", "gamedate", "gamename", "maxclients", "coop", "deathmatch", "skill", "cheats"])
        expect(server.cvars.some(cvar => cvar.name === name)).toBe(true);
      expect(written.get("base1.sv2")?.length).toBe(reference.get("base1.sv2")?.length ?? -1);
      const level = decodeQ2ClassicLevelMetadata(written.get("base1.sv2") ?? new Uint8Array(0));
      expect(level.configstrings.find(entry => entry.index === 0)?.value).toBe("Outer Base");
      expect(level.configstrings.find(entry => entry.index === 33)?.value).toBe("maps/base1.bsp");
      expect(level.configstrings.find(entry => entry.index === 5)?.value.length).toBeGreaterThan(64);
      expect(classicPortalsFrom(level.portalBytes).every(entry => entry.open)).toBe(true);
      expect(new TextDecoder().decode((written.get("game.ssv") ?? new Uint8Array(0)).subarray(0, 11))).toBe("Oct 16 1998");
      expect(Buffer.from(written.get("base1.sav") ?? new Uint8Array(0)).toString("latin1")).toContain("worldspawn");

      // Loading reads the folder. With the sidecar beside it the engine restores everything; the same files load alone without it.
      await command(app, "load", ["mysave"]);
      expect(health(app)).toBe(137);
      expect(app.simulation.playerView(app.localPlayers[0]?.actor ?? failure("no local player")).origin).toEqual(origin);
      await Bun.file(join(saves, "mysave", "qts.qtsave")).delete();
      await command(app, "load", ["mysave"]);
      await app.step(50);
      expect(health(app)).toBe(137);
      expect(app.simulation.playerView(app.localPlayers[0]?.actor ?? failure("no local player")).origin).toEqual(origin);
      // Saving again over a name replaces the unit's files and leaves nothing of the old ones.
      await command(app, "save", ["mysave"]);
      expect(await files(join(saves, "mysave"))).toEqual(["base1.sav", "base1.sv2", "game.ssv", "qts.qtsave", "server.ssv"]);
      expect(await files(join(saves, "mysave"))).toContain("qts.qtsave");
      await command(app, "save", ["current"]);
      expect(printed.join("")).toContain("Can't save to 'current'");
    } finally {
      await app.close();
    }
  },
  300_000,
);

corpusTest("q2/baseq2/pak0.pak", "q2/baseq2/gamex86.dll", "q2/baseq2/save/save0/server.ssv")(
  "level changes autosave to save0 with the departed levels, and the original's own level file loads when the unit returns",
  async () => {
    const root = await tempDirectory("q2-original-travel-");
    const saves = join(root, "native", "q2", "baseq2", "save");
    const { app, printed } = await openStock(root, "q2-classic-baseq2", "gamex86.dll", "base1", "q2");
    try {
      for (let frame = 0; frame < 5; frame++) await app.step(50);
      app.queueCommand("gamemap", ["base2$base1"], null);
      for (let frame = 0; frame < 6; frame++) await app.step(100);
      const store = new Q2SaveStore(saves);
      expect(await files(join(saves, "save0"))).toEqual(["base1.sav", "base1.sv2", "game.ssv", "qts.qtsave", "server.ssv"]);
      const autosave = decodeQ2ClassicServer((await store.read("save0")).get("server.ssv") ?? new Uint8Array(0));
      expect(autosave.comment).toBe("ENTERING Installation");
      expect(autosave.mapCommand).toBe("base2$base1");

      await command(app, "save", ["two"]);
      expect(await files(join(saves, "two"))).toEqual(["base1.sav", "base1.sv2", "base2.sav", "base2.sv2", "game.ssv", "qts.qtsave", "server.ssv"]);

      // The real autosave of the corpus, resumed at the transition it was taken for: its game.ssv is the shipped module's own,
      // its level file the original game's, and returning to Outer Base reads that file.
      await cp(corpusFile("q2/baseq2/save/save0"), join(saves, "original"), { recursive: true });
      const server = new Uint8Array(await Bun.file(join(saves, "original", "server.ssv")).bytes());
      server.fill(0, 32, 160);
      server.set(new TextEncoder().encode("base2$base1"), 32);
      await writeFile(join(saves, "original", "server.ssv"), server);
      await command(app, "load", ["original"]);
      await app.step(100);
      expect(app.simulation.options.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");
      app.queueCommand("gamemap", ["base1"], null);
      for (let frame = 0; frame < 6; frame++) await app.step(100);
      expect(app.simulation.options.recipe.map.geometry.requestedPath).toBe("maps/base1.bsp");
      expect(printed.join("")).not.toMatch(/error|failed|stopped/i);
    } finally {
      await app.close();
    }
  },
  300_000,
);

corpusTest("q2/baseq2/pak0.pak", "q2/baseq2/gamex86.dll", "q2/baseq2/save/save0/server.ssv")(
  "the sidecar is preferred only while it agrees with the original files",
  async () => {
    const root = await tempDirectory("q2-original-agree-");
    const saves = join(root, "native", "q2", "baseq2", "save");
    const { app } = await openStock(root, "q2-classic-baseq2", "gamex86.dll", "base1", "q2");
    try {
      for (let frame = 0; frame < 3; frame++) await app.step(50);
      await command(app, "save", ["slot"]);
    } finally {
      await app.close();
    }
    const catalog = await discoverInstalledContent({ corpusRoot: testCorpusRoot(), discoverMods: false });
    const parsed = parseApplicationCommand(["--content-root", testCorpusRoot(), "--game", "q2-classic-baseq2", "--map", "base1", "--hidden"]);
    if (parsed.kind !== "run") throw new Error("Missing launch options");
    const store = new Q2SaveStore(saves);
    const stored = await store.read("slot");
    const originals = new Map([...stored].filter(([name]) => name !== "qts.qtsave"));
    const sidecarImage = decodeSaveSidecar(stored.get("qts.qtsave") ?? new Uint8Array(0), q2FilesDigest(originals));
    if (sidecarImage === null) throw new Error("The sidecar does not belong to the files written beside it");
    // Agreeing files: the engine's own image comes back untouched.
    const agreed = await prepareApplicationSave(parsed.options, catalog, join(saves, "slot", "server.ssv"));
    expect(encodeSaveImage(agreed.image)).toEqual(encodeSaveImage(sidecarImage));
    // The original game rewrote the slot (here its comment): the sidecar is ignored and the files start the module.
    const rewritten = (stored.get("server.ssv") ?? new Uint8Array(0)).slice();
    rewritten.set(new TextEncoder().encode("ENTERING Elsewhere"), 0);
    await writeFile(join(saves, "slot", "server.ssv"), rewritten);
    const disagreed = await prepareApplicationSave(parsed.options, catalog, join(saves, "slot", "server.ssv"));
    expect(encodeSaveImage(disagreed.image)).not.toEqual(encodeSaveImage(sidecarImage));
    expect(disagreed.image.recipe.map.geometry.requestedPath).toBe("maps/base1.bsp");
  },
  300_000,
);

corpusTest("q2/baseq2/pak0.pak", "q2/baseq2/save/save0/server.ssv")(
  "a stock game on the engine's own logic cannot write the original's files, keeps its image in the same slot, and loads the original's files on the original module",
  async () => {
    const root = await tempDirectory("q2-engine-logic-save-");
    const saves = join(root, "native", "q2", "baseq2", "save");
    const { app } = await openStock(root, "q2-classic-baseq2", null, "base1", "q2");
    try {
      for (let frame = 0; frame < 3; frame++) await app.step(50);
      expect(app.simulation.q2Native()).toBeNull();
      await command(app, "save", ["mine"]);
      expect(await files(join(saves, "mine"))).toEqual(["qts.sav"]);
      // An original-format slot that was there is replaced rather than loaded in its place.
      await cp(corpusFile("q2/baseq2/save/save0"), join(saves, "mine"), { recursive: true, force: true });
      await command(app, "save", ["mine"]);
      expect(await files(join(saves, "mine"))).toEqual(["qts.sav", "steam_autocloud.vdf"]);
      await command(app, "load", ["mine"]);
      expect(app.simulation.q2Native()).toBeNull();
      // A folder in the original format always runs the original module, whichever logic launched the game.
      await cp(corpusFile("q2/baseq2/save/save0"), join(saves, "orig"), { recursive: true });
      const transition = new Uint8Array(await Bun.file(join(saves, "orig", "server.ssv")).bytes());
      transition.fill(0, 32, 160);
      transition.set(new TextEncoder().encode("base2$base1"), 32);
      await writeFile(join(saves, "orig", "server.ssv"), transition);
      await command(app, "load", ["orig"]);
      expect(app.simulation.q2Native()?.edition).toBe("classic");
      expect(app.simulation.options.recipe.map.geometry.requestedPath).toBe("maps/base2.bsp");

      // Both kinds are listed once each, and no level file is mistaken for a save.
      const catalog = await discoverInstalledContent({ corpusRoot: testCorpusRoot(), discoverMods: false });
      const list = new StartupSaves(catalog, join(root, "saves"), [], nativeSaveFolders(catalog, join(root, "native")));
      await list.refresh();
      const rows = list.list.rows.filter(row => list.path(row.id).startsWith(saves)).map(row => list.path(row.id).slice(saves.length + 1));
      expect(rows.sort()).toEqual(["mine/qts.sav", "orig/server.ssv"]);
      const original = list.list.rows.find(row => row.id.endsWith("orig/server.ssv"));
      expect(original?.label).toBe("ENTERING Installation");
      expect(original?.game).toContain("Quake II");
      expect(original?.unavailable).toBeNull();
    } finally {
      await app.close();
    }
  },
  300_000,
);

async function pakFiles(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true })).filter(name => /\.(?:pak\.gz|qtsave)$/.test(name)).sort();
}

corpusTest("q2/rerelease/baseq2/pak0.pak", "q2/rerelease/baseq2/game_x64.dll")(
  "a stock rerelease game on its original module saves saveN.pak.gz with the engine's entries and restores client and level state",
  async () => {
    const root = await tempDirectory("q2-rerelease-save-");
    const { app } = await openStock(root, "q2-rerelease-baseq2", "game_x64.dll", "base1", "q2-rerelease-baseq2");
    try {
      const local = app.localPlayers[0] ?? failure("no local player");
      for (let frame = 0; frame < 5; frame++) await app.step(50);
      app.simulation.playerCommand(local.actor, "give", ["health", "137"]);
      await app.step(100);
      const origin = app.simulation.playerView(local.actor).origin;
      const folder = join(root, "native");
      // Entering the level wrote the autosave slot; it has the retail autosave's entries.
      const initial = await pakFiles(folder);
      expect(initial.map(name => name.replace(/^.*\//, ""))).toEqual(["save0.pak.gz", "save0.qtsave"]);
      const autosave = parseKexQ2SaveArchive(await Bun.file(join(folder, initial.find(name => name.endsWith("save0.pak.gz")) ?? "")).bytes());
      expect(autosave.files).toEqual(["game.ssv", "server.ssv"]);
      expect(autosave.server).toMatchObject({ kind: 1, mapCommand: "base1" });
      expect(autosave.info.gameDirectory).toBe("baseq2");

      await command(app, "save", ["mysave"]);
      const pak = (await pakFiles(folder)).find(name => name.endsWith("mysave.pak.gz")) ?? failure("no pak written");
      const archive = parseKexQ2SaveArchive(await Bun.file(join(folder, pak)).bytes());
      expect(archive.files).toEqual(["game.ssv", "server.ssv", "base1.sav", "base1.sv2"]);
      expect(archive.server.kind).toBe(0);
      expect(archive.server.mapCommand).toBe("base1");
      expect(archive.server.cvars.find(cvar => cvar.name === "gamename")?.value).toBe("baseq2");
      expect(archive.game).toMatchObject({ save_version: 1, game: { maxclients: 1 } });
      const level: unknown = JSON.parse(new TextDecoder().decode(archive.entries.get("base1.sav")));
      expect(level).toMatchObject({ save_version: 1 });
      const metadata = decodeQ2RereleaseLevelMetadata(archive.entries.get("base1.sv2") ?? new Uint8Array(0));
      const geometry = app.simulation.scene.geometry;
      expect(geometry.kind === "q2-bsp" ? metadata.portalBytes.length : -1).toBe(geometry.kind === "q2-bsp" ? geometry.areaPortals.length : -2);
      expect(decodeQ2RereleaseServer(archive.entries.get("server.ssv") ?? new Uint8Array(0)).comment).not.toBe("");

      await command(app, "load", ["mysave"]);
      expect(health(app)).toBe(137);
      await Bun.file(join(folder, pak.replace(/\.pak\.gz$/, ".qtsave"))).delete();
      await command(app, "load", ["mysave"]);
      await app.step(50);
      expect(health(app)).toBe(137);
      // The module settles the player onto the floor on the first frame after a load, so the height may differ by a fraction of a unit.
      const restored = app.simulation.playerView(app.localPlayers[0]?.actor ?? failure("no local player")).origin;
      expect([restored.x, restored.y]).toEqual([origin.x, origin.y]);
      expect(Math.abs(restored.z - origin.z)).toBeLessThan(0.25);
    } finally {
      await app.close();
    }
  },
  900_000,
);
