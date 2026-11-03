// SPDX-License-Identifier: GPL-2.0-or-later
import { basename, dirname, join, resolve, relative, isAbsolute } from "node:path";
import { q2SaveSlotName } from "../persistence/q2-save-folder.ts";
import type { GameFamily } from "../contracts/content.ts";
import type { NativeConfigLayout } from "./native-config.ts";

/** The original format a stock game's native save location can be written in. */
export type NativeSaveOriginal = "v5" | "v6" | "q2-folder" | "q2-pak";

/**
 * Where a stock game keeps saves the way the original does, and which format the engine can write there.
 * Quake writes `sN.sav` beside the game (NetQuake v5; the rerelease v6 in its Saved Games folder). Quake II keeps a
 * folder per save, `save/NAME/` with `server.ssv`, `game.ssv` and each level's `MAP.sav` and `MAP.sv2`; the rerelease
 * packs the same files as `save/NAME.pak.gz`. The engine writes those when the original game module runs the game, with
 * its own format beside them for state they cannot carry. Where the engine's own game logic runs, only the engine
 * format is written, at the same place. Quake III has no savegame feature and keeps the engine format under `save/`.
 */
export interface NativeSaveLayout {
  /** Folder all native saves are contained in. */
  readonly root: string;
  /** Folders listed for saves, writes first, each scanned to `depth` levels. */
  readonly scan: readonly string[];
  /** Subfolder levels scanned below each `scan` folder. */
  readonly depth: number;
  /** How a save slot is laid out below a scanned folder. */
  readonly arrangement: "files" | "folders";
  /** The original format the engine can write there, or null when only the engine format fits. */
  readonly original: NativeSaveOriginal | null;
  /** The engine-format file of a slot. */
  locate(name: string): string;
  /** The file that identifies a slot in the original format (Quake II `server.ssv`, the rerelease pak), or null. */
  originalPath(name: string): string | null;
  /** Every file that could hold a slot, original format first, across the folders a stock game reads. */
  candidates(name: string): readonly string[];
  /** The slot a save file below `root` belongs to, whichever of its files the path names; null when it is not one. */
  slot(path: string): string | null;
}

interface SlotPaths {
  locate(name: string): string;
  originalPath(name: string): string | null;
}
export function nativeSaveLayout(
  layout: NativeConfigLayout,
  product: {
    readonly family: GameFamily;
    readonly edition: string;
    readonly contentDirectory: string;
  },
): NativeSaveLayout {
  const gameDirectory = basename(product.contentDirectory);
  const folders = [layout.directory, ...layout.fallbacks];
  const describe = (
    root: string,
    scan: readonly string[],
    depth: number,
    arrangement: NativeSaveLayout["arrangement"],
    original: NativeSaveOriginal | null,
    paths: (root: string) => SlotPaths,
  ): NativeSaveLayout => {
    const own = paths(root);
    return {
      root,
      scan,
      depth,
      arrangement,
      original,
      locate: own.locate,
      originalPath: own.originalPath,
      candidates: name =>
        scan.flatMap(folder => [paths(folder).originalPath(name), paths(folder).locate(name)].filter((path): path is string => path !== null)),
      slot: path => slotOf(original, root, path),
    };
  };
  if (product.family === "q1" && product.edition !== "quakeworld") {
    const files = (root: string): SlotPaths => ({ locate: name => join(root, withExtension(name)), originalPath: name => join(root, withExtension(name)) });
    return describe(layout.directory, folders, 0, "files", product.edition === "rerelease" ? "v6" : "v5", files);
  }
  if (product.family === "q2" && product.edition === "rerelease")
    return describe(
      join(layout.directory, gameDirectory, "save"),
      folders.map(folder => join(folder, gameDirectory, "save")),
      0,
      "files",
      "q2-pak",
      root => ({
        locate: name => join(root, withExtension(q2SaveSlotName(name))),
        originalPath: name => join(root, `${q2SaveSlotName(name)}.pak.gz`),
      }),
    );
  const saveFolders = folders.map(folder => join(folder, "save"));
  if (product.family === "q2")
    return describe(join(layout.directory, "save"), saveFolders, 1, "folders", "q2-folder", root => ({
      locate: name => join(root, q2SaveSlotName(name), "qts.sav"),
      originalPath: name => join(root, q2SaveSlotName(name), "server.ssv"),
    }));
  return describe(join(layout.directory, "save"), saveFolders, 0, "files", null, root => ({
    locate: name => join(root, withExtension(name)),
    originalPath: () => null,
  }));
}

function slotOf(original: NativeSaveOriginal | null, root: string, path: string): string | null {
  if (original === "q2-folder") return dirname(dirname(path)) === root && /^(?:qts\.sav|server\.ssv)$/i.test(basename(path)) ? basename(dirname(path)) : null;
  if (dirname(path) !== root) return null;
  return basename(path).replace(original === "q2-pak" ? /\.(?:sav|pak\.gz)$/i : /\.sav$/i, "");
}

function withExtension(name: string): string {
  return /\.sav$/i.test(name) ? name : `${name}.sav`;
}

/** True when `path` is inside the native save root. */
export function insideNativeSaves(layout: NativeSaveLayout, path: string): boolean {
  const name = relative(resolve(layout.root), resolve(path));
  return name !== "" && !isAbsolute(name) && name !== ".." && !name.startsWith("../");
}
