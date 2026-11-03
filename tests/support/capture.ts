// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

// Visual and JSON evidence is written only when QTS_TEST_CAPTURE_DIR names a directory,
// so a default run leaves no files in /tmp or the checkout and parallel runs cannot
// overwrite each other's fixed-name captures.
export function captureDirectory(): string | null {
  const directory = process.env["QTS_TEST_CAPTURE_DIR"];
  return directory === undefined || directory === "" ? null : resolve(directory);
}

export async function writeCapture(name: string, data: Uint8Array | string): Promise<void> {
  const root = captureDirectory();
  if (root === null) return;
  const target = resolve(join(root, name));
  if (!target.startsWith(root + sep)) throw new Error(`Capture name escapes the capture directory: ${name}`);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, data);
}
