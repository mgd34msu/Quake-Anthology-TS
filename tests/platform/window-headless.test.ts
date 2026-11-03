// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { resolve } from "node:path";

test.skipIf(process.env["QUAKE_PLATFORM_HEADLESS_TEST"] !== "1")("loading the application entry maps no graphics or media native libraries", () => {
  expect(process.env["DISPLAY"]).toBeUndefined();
  expect(process.env["WAYLAND_DISPLAY"]).toBeUndefined();
  // A fresh process: earlier test files in the same run may already have loaded SDL or GL into this one.
  const probe = [
    'const { parseApplicationCommand } = await import("./src/app/bootstrap/options.ts");',
    'const launch = parseApplicationCommand(["--game", "q1", "--map", "e1m1", "--dedicated"]);',
    'if (launch.kind !== "run") throw new Error("Expected a run launch");',
    'await import("./src/app/bootstrap/application.ts");',
    'process.stdout.write(require("node:fs").readFileSync("/proc/self/maps", "utf8"));',
  ].join("\n");
  const result = Bun.spawnSync(["bun", "--eval", probe], { cwd: resolve(import.meta.dir, "../.."), env: process.env, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  const maps = new TextDecoder().decode(result.stdout);
  expect(maps.length).toBeGreaterThan(0);
  expect(maps).not.toMatch(/lib(?:SDL2|SDL3|GL\.|GLX|EGL|vorbis|freetype)/);
});
