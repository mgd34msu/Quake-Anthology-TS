// SPDX-License-Identifier: GPL-2.0-or-later
// Polls a condition against a generous wall deadline, so a slow machine delays a test
// instead of failing it. Use for events whose timing the production code owns.
export async function waitFor(condition: () => boolean, what: string, timeoutMilliseconds = 10000): Promise<void> {
  const deadline = performance.now() + timeoutMilliseconds;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}
