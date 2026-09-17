import type { SaveImage } from "../contracts/session.ts";
import { decodeSaveImage, encodeSaveImage } from "./save-image.ts";
import { decodeQ1Save, encodeQ1Save, type Q1SaveData } from "./q1.ts";
import { SaveFormatError } from "./value.ts";
import { writeContainedSave } from "./save-policy.ts";

export type SavedGame = { readonly kind: "shared"; readonly image: SaveImage }
  | { readonly kind: "q1-source"; readonly data: Q1SaveData };

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
export async function readSavedGame(path: string): Promise<SavedGame> {
  return decodeSavedGame(await Bun.file(path).bytes());
}
export async function writeSavedGame(directory: string, path: string, save: SavedGame): Promise<void> {
  const bytes = save.kind === "shared" ? encodeSaveImage(save.image) : encodeQ1Save(save.data);
  await writeContainedSave(directory, path, bytes);
}
