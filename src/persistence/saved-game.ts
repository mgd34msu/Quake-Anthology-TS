// SPDX-License-Identifier: GPL-2.0-or-later
import type { SaveImage } from "../contracts/session.ts";
import { decodeSaveImage, encodeSaveImage } from "./save-image.ts";
import { decodeQ1Save, encodeQ1Save, type Q1SaveData } from "./q1.ts";
import { SaveFormatError } from "./value.ts";
import { writeContainedSave } from "./save-policy.ts";

export type SavedGame = { readonly kind: "shared"; readonly image: SaveImage } | { readonly kind: "q1-source"; readonly data: Q1SaveData };

/** Inspect the signature before choosing a codec; malformed shared saves never fall back to source parsing. */
export function decodeSavedGame(bytes: Uint8Array): SavedGame {
  if (bytes[0] === 81 && bytes[1] === 84) return { kind: "shared", image: decodeSaveImage(bytes) };
  const data = decodeQ1Save(bytes);
  if (!/^[A-Za-z0-9_/-]+$/.test(data.map) || data.map.split("/").some(part => part === "" || part === "." || part === ".."))
    throw new SaveFormatError("q1.map", "invalid source map name");
  if (data.time < 0 || data.skill < 0 || data.skill > 3 || data.entities.length < 2 || data.entities[0]?.length === 0)
    throw new SaveFormatError("q1", "save has no valid singleplayer world");
  return { kind: "q1-source", data };
}

/**
 * A save in the original format cannot hold everything this engine keeps (mixed or engine-only state), so the engine
 * writes that state beside it: a sidecar holding the shared container behind a signature and the SHA-256 of the
 * original-format file or files it belongs to. Loading the original save restores from the sidecar while the two still
 * match, and from the original files alone when they do not.
 */
const SIDECAR_SIGNATURE = new TextEncoder().encode("QTSIDE1\n");
export const SIDECAR_EXTENSION = ".qtsave";
export function sidecarPath(path: string): string {
  return path.replace(/\.(?:sav|pak\.gz)$/i, SIDECAR_EXTENSION);
}
export function digestBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(new Bun.CryptoHasher("sha256").update(bytes).digest());
}
/** `digest` identifies the original-format content the image was captured with. */
export function encodeSaveSidecar(digest: Uint8Array, image: SaveImage): Uint8Array {
  const body = encodeSaveImage(image),
    out = new Uint8Array(SIDECAR_SIGNATURE.length + 32 + body.length);
  out.set(SIDECAR_SIGNATURE, 0);
  out.set(digest, SIDECAR_SIGNATURE.length);
  out.set(body, SIDECAR_SIGNATURE.length + 32);
  return out;
}
/** The image when the sidecar was written beside exactly the original content `digest` names; null when it was not. */
export function decodeSaveSidecar(bytes: Uint8Array, digest: Uint8Array): SaveImage | null {
  const header = SIDECAR_SIGNATURE.length + 32;
  if (bytes.length <= header || !SIDECAR_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  if (!digest.every((byte, index) => bytes[SIDECAR_SIGNATURE.length + index] === byte)) return null;
  return decodeSaveImage(bytes.subarray(header));
}
export async function readSavedGame(path: string): Promise<SavedGame> {
  const bytes = await Bun.file(path).bytes();
  if (bytes[0] !== 81 || bytes[1] !== 84) {
    const sidecar = Bun.file(sidecarPath(path));
    if (await sidecar.exists()) {
      const image = decodeSaveSidecar(await sidecar.bytes(), digestBytes(bytes));
      if (image !== null) return { kind: "shared", image };
    }
  }
  return decodeSavedGame(bytes);
}
export async function writeSavedGame(directory: string, path: string, save: SavedGame, sidecar?: SaveImage): Promise<void> {
  const bytes = save.kind === "shared" ? encodeSaveImage(save.image) : encodeQ1Save(save.data);
  await writeContainedSave(directory, path, bytes);
  if (sidecar !== undefined && save.kind === "q1-source")
    await writeContainedSave(directory, sidecarPath(path), encodeSaveSidecar(digestBytes(bytes), sidecar), SIDECAR_EXTENSION);
}
export { readSaveHeader, type SaveHeader } from "./save-image.ts";
