// SPDX-License-Identifier: GPL-2.0-or-later
// The `save/` folder of a Quake II game directory and the working folder workflow of id's sv_ccmds.c:
// SV_WipeSavegame and SV_CopySaveGame move a save between `current/` and `save/NAME/`.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeContainedNativeFile } from "./save-policy.ts";
import type { Q2SaveFiles } from "./q2-save-folder.ts";

/** The working folder the game module writes level files into. */
export const Q2_CURRENT_SAVE = "current";
/** The files SV_WipeSavegame removes: server.ssv, game.ssv, every *.sav and every *.sv2. */
const WIPED = /^(?:server\.ssv|game\.ssv|.+\.sav|.+\.sv2)$/i;
/** The files SV_CopySaveGame carries: server.ssv, game.ssv, and each *.sav with its *.sv2. */
const COPIED = /^(?:server\.ssv|game\.ssv|.+\.sav|.+\.sv2)$/i;
/** A bound on one save file; a retail Quake II level file is a few MB. */
const MAX_SAVE_FILE_BYTES = 256 * 1024 * 1024;

export class Q2SaveStore {
  /** `root` is the game directory's `save` folder. */
  constructor(readonly root: string) {}

  folder(name: string): string {
    return join(this.root, name);
  }

  /** Every regular file of a slot, by name. A missing slot has no files. */
  async read(name: string): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>();
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.folder(name), { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return files;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = Bun.file(join(this.folder(name), entry.name));
      if (file.size > MAX_SAVE_FILE_BYTES) throw new RangeError(`Save file ${entry.name} is implausibly large`);
      files.set(entry.name, await file.bytes());
    }
    return files;
  }

  /** SV_WipeSavegame. */
  async wipe(name: string): Promise<void> {
    for (const file of (await this.read(name)).keys()) if (WIPED.test(file)) await rm(join(this.folder(name), file), { force: true });
  }

  async write(name: string, files: Q2SaveFiles): Promise<void> {
    for (const [file, bytes] of files) await writeContainedNativeFile(this.root, join(this.folder(name), file), bytes);
  }

  /** SV_CopySaveGame: the destination is wiped, then receives the source's save files. */
  async copy(from: string, to: string): Promise<void> {
    const source = await this.read(from);
    await this.wipe(to);
    await this.write(to, new Map([...source].filter(([file]) => COPIED.test(file))));
  }

  /** `save NAME`: the level and server files go to `current/`, which is then copied to the slot. */
  async save(name: string, files: Q2SaveFiles): Promise<void> {
    await this.wipe(Q2_CURRENT_SAVE);
    await this.write(Q2_CURRENT_SAVE, files);
    await this.copy(Q2_CURRENT_SAVE, name);
  }

  /** `load NAME`: the slot is copied to `current/` and the files are read from there. */
  async load(name: string): Promise<Map<string, Uint8Array>> {
    await this.copy(name, Q2_CURRENT_SAVE);
    return this.read(Q2_CURRENT_SAVE);
  }
}
