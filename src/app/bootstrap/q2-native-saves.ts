// SPDX-License-Identifier: GPL-2.0-or-later
// Writing a Quake II save in the original game's layout beside the engine's own image.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { SaveImage } from "../../contracts/session.ts";
import { packKexQ2SaveArchive } from "../../persistence/kex-q2-save.ts";
import { encodeSaveSidecar, SIDECAR_EXTENSION } from "../../persistence/saved-game.ts";
import { q2ClassicFolder, q2FilesDigest, q2MapCommand } from "../../persistence/q2-save-folder.ts";
import { Q2SaveStore } from "../../persistence/q2-save-store.ts";
import { writeContainedNativeFile } from "../../persistence/save-policy.ts";
import type { NativeSaveLayout } from "../../settings/native-saves.ts";
import { q2RereleasePakEntries } from "./simulation/native-q2-rerelease-pak.ts";
import { nativeQ2OriginalSave, nativeQ2RereleaseSave, savedSimulationSettings } from "./simulation/save.ts";

export interface Q2NativeSaveRequest {
  readonly native: NativeSaveLayout;
  readonly slot: string;
  readonly image: SaveImage;
  readonly now: Date;
  /** The area portal count of a map; the rerelease level file records it and the engine checks it on load. */
  portalCount(map: string): Promise<number>;
}

/** The engine-format file that sits beside original files, and is never copied or wiped by the original's own save logic. */
const SIDECAR_NAME = `qts${SIDECAR_EXTENSION}`;

/**
 * Writes the original-format save for the image's native game module: a `save/SLOT/` folder through id's `current`
 * workflow, or the rerelease's `SLOT.pak.gz`. Returns false when the image holds no original state to write, which is the
 * case when the engine's own game logic ran the game.
 */
export async function writeQ2NativeSave(request: Q2NativeSaveRequest): Promise<boolean> {
  const { native, slot, image } = request;
  if (native.original === "q2-folder") {
    const original = nativeQ2OriginalSave(image);
    if (original === null) return false;
    const files = q2ClassicFolder(original, {
      mapCommand: q2MapCommand(original.map, savedSimulationSettings(image).initialSpawnPoint),
      now: request.now,
    });
    const store = new Q2SaveStore(native.root);
    await store.save(slot, files);
    await rm(join(store.folder(slot), "qts.sav"), { force: true });
    await writeContainedNativeFile(native.root, join(store.folder(slot), SIDECAR_NAME), encodeSaveSidecar(q2FilesDigest(files), image));
    return true;
  }
  if (native.original === "q2-pak") {
    const original = nativeQ2RereleaseSave(image);
    if (original === null) return false;
    const entries = await q2RereleasePakEntries(original, {
      spawnPoint: savedSimulationSettings(image).initialSpawnPoint,
      now: request.now,
      portalCount: request.portalCount,
    });
    const pak = join(native.root, `${slot}.pak.gz`);
    await writeContainedNativeFile(native.root, pak, packKexQ2SaveArchive(entries));
    await writeContainedNativeFile(native.root, join(native.root, `${slot}${SIDECAR_EXTENSION}`), encodeSaveSidecar(q2FilesDigest(new Map(entries)), image));
    await rm(join(native.root, `${slot}.sav`), { force: true });
    return true;
  }
  return false;
}

/** After an engine-format save takes a slot, the original files that were there would be loaded in its place. */
export async function clearQ2OriginalFiles(native: NativeSaveLayout, slot: string): Promise<void> {
  if (native.original === "q2-folder") {
    const store = new Q2SaveStore(native.root);
    for (const file of (await store.read(slot)).keys())
      if (/^(?:server\.ssv|game\.ssv|.+\.sv2)$/i.test(file) || (/\.sav$/i.test(file) && file.toLowerCase() !== "qts.sav"))
        await rm(join(store.folder(slot), file), { force: true });
    await rm(join(store.folder(slot), SIDECAR_NAME), { force: true });
  } else if (native.original === "q2-pak") {
    await rm(join(native.root, `${slot}.pak.gz`), { force: true });
    await rm(join(native.root, `${slot}${SIDECAR_EXTENSION}`), { force: true });
  }
}
