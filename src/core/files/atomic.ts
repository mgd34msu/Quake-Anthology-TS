/* Atomic writable-file helpers. GPL-2.0-or-later. */
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function settingsPath(root: string, name: string): string {
  const path = resolve(root, name), child = relative(resolve(root), path);
  if (child === "" || child === ".." || child.startsWith("../") || isAbsolute(child)) throw new Error("Settings path escapes the writable directory");
  return path;
}
export async function writeAtomic(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(contents); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}
