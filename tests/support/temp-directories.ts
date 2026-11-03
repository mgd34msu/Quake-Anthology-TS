// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Returns a temporary-directory factory whose directories are removed after
 * every test, so a failure between creation and a test's own `try` cannot leak
 * one. Call once at the top level of a test file.
 */
export function trackedTempDirectories(): (prefix: string) => Promise<string> {
  const created = new Set<string>();
  afterEach(async () => {
    const pending = [...created];
    created.clear();
    await Promise.all(pending.map(directory => rm(directory, { recursive: true, force: true })));
  });
  return async prefix => {
    const directory = await mkdtemp(join(tmpdir(), prefix));
    created.add(directory);
    return directory;
  };
}
