import { closeSync, constants, mkdirSync, openSync } from "node:fs";

export function containedFileParts(name: string): readonly string[] {
  const parts = name.split("/");
  if (name.length === 0 || name.includes("\\") || name.includes("\0") || name.includes(":" ) || parts.some(part => part.length === 0 || part === "." || part === "..")) throw new RangeError("Download needs a contained relative path");
  return parts;
}
function isExists(error: unknown): boolean { return error instanceof Error && "code" in error && error.code === "EEXIST"; }

/** Linux directory descriptors keep all child operations anchored despite path renames. */
export function openContainedParent(root: string, name: string, create: boolean): { readonly descriptor: number; readonly leaf: string } {
  if (process.platform !== "linux") throw new Error("Contained download storage currently requires Linux directory descriptors");
  const parts = containedFileParts(name), leaf = parts.at(-1);
  if (leaf === undefined) throw new RangeError("Download has no filename");
  let descriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const part of parts.slice(0, -1)) {
      const path = `/proc/self/fd/${descriptor}/${part}`;
      if (create) { try { mkdirSync(path); } catch (error) { if (!isExists(error)) throw error; } }
      const next = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(descriptor); descriptor = next;
    }
    return { descriptor, leaf };
  } catch (error) { closeSync(descriptor); throw error; }
}

