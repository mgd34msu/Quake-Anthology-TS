// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isolatedEnvironment(): Record<string, string | undefined> {
  const environment = { ...process.env };
  delete environment["DISPLAY"];
  delete environment["WAYLAND_DISPLAY"];
  delete environment["QUAKE_PLATFORM_NATIVE_TEST"];
  delete environment["QUAKE_PLATFORM_HEADLESS_TEST"];
  delete environment["QUAKE_SDL2_LIBRARY"];
  delete environment["QUAKE_GL_LIBRARY"];
  environment["SDL_AUDIODRIVER"] = "dummy";
  environment["SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS"] = "1";
  return environment;
}

/** Child results come from Bun's JUnit report, since the text reporter prints only totals when stdout is not a terminal. */
async function runNative(files: readonly string[], environment: Readonly<Record<string, string | undefined>>): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "window-runner-")),
    report = join(directory, "report.xml");
  const child = Bun.spawn([process.execPath, "test", ...files, "--reporter=junit", `--reporter-outfile=${report}`], {
    cwd: new URL("../../", import.meta.url).pathname,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status !== 0) throw new Error(`Native platform subprocess exited ${status}:\n${stdout}\n${stderr}`);
    return readFileSync(report, "utf8");
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}

function suiteTotals(report: string): { readonly tests: number; readonly failures: number; readonly skipped: number } {
  const root = /<testsuites [^>]*>/.exec(report)?.[0];
  if (root === undefined) throw new Error(`Child produced no JUnit totals:\n${report}`);
  const read = (name: string): number => Number(new RegExp(` ${name}="(\\d+)"`).exec(root)?.[1] ?? Number.NaN);
  return { tests: read("tests"), failures: read("failures"), skipped: read("skipped") };
}

test("dedicated startup is display free with deliberately invalid native paths", async () => {
  const environment = isolatedEnvironment();
  environment["QUAKE_PLATFORM_HEADLESS_TEST"] = "1";
  environment["SDL_VIDEODRIVER"] = "unavailable-video-driver";
  for (const variable of ["QUAKE_SDL2_LIBRARY", "QUAKE_GL_LIBRARY", "QUAKE_VORBISFILE_LIBRARY", "QUAKE_FREETYPE_LIBRARY"])
    environment[variable] = "/no-native-libraries-should-be-opened";
  const output = await runNative(["tests/platform/window-headless.test.ts"], environment);
  expect(suiteTotals(output)).toEqual({ tests: 1, failures: 0, skipped: 0 });
}, 30_000);

test("dummy SDL exercises partial startup failures and repeated cleanup", async () => {
  const environment = isolatedEnvironment();
  environment["QUAKE_PLATFORM_NATIVE_TEST"] = "1";
  environment["SDL_VIDEODRIVER"] = "dummy";
  const output = await runNative(["tests/platform/window-native.test.ts"], environment);
  expect(output).toContain("partial GL startup failure");
  expect(suiteTotals(output).failures).toBe(0);
  expect(suiteTotals(output).tests).toBeGreaterThan(0);
}, 30_000);

test.skipIf(Bun.which("Xvfb") === null)(
  "private Xvfb exercises real CPU presentation, OpenGL and pushed events",
  async () => {
    const xvfb = Bun.spawn(["Xvfb", "-displayfd", "1", "-screen", "0", "800x600x24", "-nolisten", "tcp", "-noreset"], {
      env: isolatedEnvironment(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const errors = new Response(xvfb.stderr).text();
    const reader = xvfb.stdout.getReader();
    const timer = setTimeout(() => xvfb.kill("SIGKILL"), 40_000);
    try {
      let number = "";
      while (!number.includes("\n")) {
        const next = await reader.read();
        if (next.done) throw new Error(`Xvfb did not publish a display: ${await errors}`);
        number += new TextDecoder().decode(next.value);
      }
      number = number.trim();
      if (!/^\d+$/.test(number)) throw new Error(`Xvfb returned an invalid display: ${number}`);
      const environment = isolatedEnvironment(),
        display = `:${number}`;
      environment["DISPLAY"] = display;
      environment["QUAKE_OWNED_DISPLAY"] = display;
      environment["QUAKE_PLATFORM_NATIVE_TEST"] = "1";
      environment["SDL_VIDEODRIVER"] = "x11";
      environment["LIBGL_ALWAYS_SOFTWARE"] = "1";
      const output = await runNative(["tests/platform/window-native.test.ts", "tests/platform/window-context.test.ts"], environment);
      expect(output).toContain("real GL procedures");
      expect(suiteTotals(output).failures).toBe(0);
      expect(suiteTotals(output).tests).toBeGreaterThan(0);
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
      xvfb.kill();
      await xvfb.exited;
      await errors;
    }
  },
  45_000,
);
