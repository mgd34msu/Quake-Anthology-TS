// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { openPlatform } from "../../src/platform/index.ts";

test.skipIf(process.env["QUAKE_PLATFORM_HEADLESS_TEST"] !== "1")("dedicated startup imports no graphics or media native libraries", () => {
  expect(process.env["DISPLAY"]).toBeUndefined();
  expect(process.env["WAYLAND_DISPLAY"]).toBeUndefined();
  const platform = openPlatform({ kind: "dedicated" });
  expect(platform.kind).toBe("dedicated");
  expect(platform.closed).toBe(false);
  const mappings = readFileSync("/proc/self/maps", "utf8");
  expect(mappings).not.toMatch(/lib(?:SDL2|SDL3|GL\.|GLX|EGL|vorbis|freetype)/);
  platform.close(); platform.close();
  expect(platform.closed).toBe(true);
});
