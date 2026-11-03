// SPDX-License-Identifier: GPL-2.0-or-later
import { basename, join, resolve, relative, isAbsolute } from "node:path";
import type { GameFamily } from "../contracts/content.ts";
import type { NativeConfigLayout } from "./native-config.ts";

/**
 * Where a stock game keeps saves the way the original does, and which format the engine can write there.
 * Quake writes `sN.sav` beside the game (NetQuake v5; the rerelease v6 in its Saved Games folder). The other
 * games cannot be written in their original format, so the engine's own format goes under the original naming
 * scheme: Quake II `save/NAME/`, rerelease Quake II `GAMEDIR/save/`, Quake III `save/`.
 */
export interface NativeSaveLayout {
  /** Folder all native saves are contained in. */
  readonly root: string;
  /** Folders listed for saves, writes first, each scanned to `depth` levels. */
  readonly scan: readonly string[];
  /** Subfolder levels scanned below each `scan` folder. */
  readonly depth: number;
  /** The original format written, or null when only the engine format fits. */
  readonly original: "v5" | "v6" | null;
  locate(name: string): string;
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
  if (product.family === "q1" && product.edition !== "quakeworld") {
    const rerelease = product.edition === "rerelease";
    return {
      root: layout.directory,
      scan: folders,
      depth: 0,
      original: rerelease ? "v6" : "v5",
      locate: name => join(layout.directory, withExtension(name)),
    };
  }
  if (product.family === "q2") {
    if (product.edition === "rerelease") {
      const root = join(layout.directory, gameDirectory, "save");
      return {
        root,
        scan: folders.map(folder => join(folder, gameDirectory, "save")),
        depth: 0,
        original: null,
        locate: name => join(root, withExtension(name)),
      };
    }
    const root = join(layout.directory, "save");
    return {
      root,
      scan: folders.map(folder => join(folder, "save")),
      depth: 1,
      original: null,
      locate: name => join(root, name.replace(/\.sav$/i, ""), "qts.sav"),
    };
  }
  const root = join(layout.directory, "save");
  return {
    root,
    scan: folders.map(folder => join(folder, "save")),
    depth: 0,
    original: null,
    locate: name => join(root, withExtension(name)),
  };
}

function withExtension(name: string): string {
  return /\.sav$/i.test(name) ? name : `${name}.sav`;
}

/** True when `path` is inside the native save root. */
export function insideNativeSaves(layout: NativeSaveLayout, path: string): boolean {
  const name = relative(resolve(layout.root), resolve(path));
  return name !== "" && !isAbsolute(name) && name !== ".." && !name.startsWith("../");
}
