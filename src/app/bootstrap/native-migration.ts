// SPDX-License-Identifier: GPL-2.0-or-later
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { InstalledCatalog } from "../../content/catalog/index.ts";
import { isMissingFile } from "../../content/mounts/paths.ts";
import { defaultUserContentRoot, userDataDirectory, userProductDirectory } from "../../content/user-data.ts";
import { readSaveHeader } from "../../persistence/saved-game.ts";
import { nativeSaveLayout } from "../../settings/native-saves.ts";
import type { ApplicationOptions } from "./options.ts";
import { stockNativeConfig } from "./native-settings.ts";

const DEMO_FILE = /\.(dem|qwd|dm2|mvd|dm_\d+)$/i;
const done = new Set<string>();

/**
 * Move one file without ever losing it: copy beside the destination, rename into place, then drop the source.
 * An interrupted run leaves the source (and at worst a temporary copy), and the next run finishes the job. A
 * destination that already holds a different file is never overwritten; the source stays where it is.
 */
async function moveInto(source: string, destination: string): Promise<boolean> {
  const existing = await stat(destination).catch((error: unknown) => {
    if (isMissingFile(error)) return null;
    throw error;
  });
  const original = await stat(source);
  if (existing !== null) {
    if (existing.size !== original.size) return false;
    await rm(source);
    return true;
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  await rm(source);
  return true;
}

async function files(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFile(error)) return [];
    throw error;
  });
  return entries.filter(entry => entry.isFile()).map(entry => entry.name);
}

/**
 * Moves what earlier versions kept for stock games in the user store (demos, saves) into the folders the original
 * games use. Reads keep falling back to the user store, so anything left behind stays usable. Screenshots there
 * were shared by every game and cannot be attributed to one, so they stay. Runs once per process and is safe to
 * interrupt and rerun.
 */
export async function migrateNativeData(catalog: InstalledCatalog, options: Pick<ApplicationOptions, "userContentRoot" | "nativeConfigRoot">): Promise<void> {
  const userRoot = options.userContentRoot ?? defaultUserContentRoot();
  const key = `${userRoot}\0${options.nativeConfigRoot ?? process.env["QTS_TEST_GAME_WRITE_ROOT"] ?? ""}`;
  if (done.has(key)) return;
  done.add(key);
  const saves = userDataDirectory("saves", options.userContentRoot);
  const topLevelSaves = await files(saves);
  for (const product of catalog.products) {
    if (product.availability.kind !== "installed") continue;
    const native = stockNativeConfig(catalog, product.id, [product.id], options.nativeConfigRoot);
    if (native === null) continue;
    const store = product.userContent?.root ?? userProductDirectory(userRoot, product.expectation.contentDirectory);
    if (store === native.layout.directory) continue;
    try {
      for (const directory of ["", "demos"]) {
        for (const name of await files(join(store, directory))) {
          if (DEMO_FILE.test(name)) await moveInto(join(store, directory, name), join(native.layout.directory, directory, name));
        }
      }
      const layout = nativeSaveLayout(native.layout, product.expectation);
      const candidates = [
        ...(await files(join(saves, product.id))).map(name => join(saves, product.id, name)),
        ...topLevelSaves.map(name => join(saves, name)),
      ];
      for (const path of candidates) {
        const name = basename(path);
        if (!name.toLowerCase().endsWith(".sav") || name.toLowerCase() === "autosave.sav") continue;
        // Only engine-format saves carry the product they belong to; original-format files stay where they are.
        const header = await readSaveHeader(path).catch(() => null);
        if (header === null || header.content !== product.id) continue;
        await moveInto(path, layout.locate(name));
      }
    } catch (error) {
      // A folder that cannot be written leaves its data in the user store, which is still read.
      console.error(`Could not move ${product.id} data to ${native.layout.directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
