// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test.skipIf(process.env["QUAKE_PLATFORM_HEADLESS_TEST"] !== "1")("loading the application entry maps no graphics or media native libraries", async () => {
  expect(process.env["DISPLAY"]).toBeUndefined();
  expect(process.env["WAYLAND_DISPLAY"]).toBeUndefined();
  const { parseApplicationCommand } = await import("../../src/app/bootstrap/options.ts");
  const launch = parseApplicationCommand(["--game", "q1", "--map", "e1m1", "--dedicated"]);
  expect(launch.kind).toBe("run");
  await import("../../src/app/bootstrap/application.ts");
  expect(readFileSync("/proc/self/maps", "utf8")).not.toMatch(/lib(?:SDL2|SDL3|GL\.|GLX|EGL|vorbis|freetype)/);
});
