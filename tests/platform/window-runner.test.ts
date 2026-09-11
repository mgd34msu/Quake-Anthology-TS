// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";

function isolatedEnvironment(): Record<string, string | undefined> {
  const environment = { ...process.env };
  delete environment["DISPLAY"]; delete environment["WAYLAND_DISPLAY"];
  delete environment["QUAKE_PLATFORM_NATIVE_TEST"]; delete environment["QUAKE_PLATFORM_HEADLESS_TEST"];
  delete environment["QUAKE_SDL2_LIBRARY"]; delete environment["QUAKE_GL_LIBRARY"];
  environment["SDL_AUDIODRIVER"] = "dummy";
  environment["SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS"] = "1";
  return environment;
}

async function runNative(files: readonly string[], environment: Readonly<Record<string, string | undefined>>): Promise<string> {
  const child = Bun.spawn([process.execPath, "test", ...files], {
    cwd: new URL("../../", import.meta.url).pathname, env: environment,
    stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 25_000);
  try {
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (status !== 0) throw new Error(`Native platform subprocess exited ${status}:\n${stdout}\n${stderr}`);
    return stdout + stderr;
  } finally { clearTimeout(timer); child.kill(); await child.exited; }
}

test("dedicated startup is display free with deliberately invalid native paths", async () => {
  const environment = isolatedEnvironment();
  environment["QUAKE_PLATFORM_HEADLESS_TEST"] = "1";
  environment["SDL_VIDEODRIVER"] = "unavailable-video-driver";
  for (const variable of ["QUAKE_SDL2_LIBRARY", "QUAKE_GL_LIBRARY", "QUAKE_VORBISFILE_LIBRARY", "QUAKE_FREETYPE_LIBRARY"])
    environment[variable] = "/no-native-libraries-should-be-opened";
  const output = await runNative(["tests/platform/window-headless.test.ts"], environment);
  expect(output).toContain("1 pass");
}, 30_000);

test("dummy SDL exercises partial startup failures and repeated cleanup", async () => {
  const environment = isolatedEnvironment();
  environment["QUAKE_PLATFORM_NATIVE_TEST"] = "1";
  environment["SDL_VIDEODRIVER"] = "dummy";
  const output = await runNative(["tests/platform/window-native.test.ts"], environment);
  expect(output).toContain("partial GL startup failure");
  expect(output).toContain("0 fail");
}, 30_000);

test("private Xvfb exercises real CPU presentation, OpenGL and pushed events", async () => {
  const xvfb = Bun.spawn(["Xvfb", "-displayfd", "1", "-screen", "0", "800x600x24", "-nolisten", "tcp", "-noreset"], {
    env: isolatedEnvironment(), stdout: "pipe", stderr: "pipe",
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
    const environment = isolatedEnvironment(), display = `:${number}`;
    environment["DISPLAY"] = display;
    environment["QUAKE_OWNED_DISPLAY"] = display;
    environment["QUAKE_PLATFORM_NATIVE_TEST"] = "1";
    environment["SDL_VIDEODRIVER"] = "x11";
    environment["LIBGL_ALWAYS_SOFTWARE"] = "1";
    const output = await runNative(["tests/platform/window-native.test.ts", "tests/platform/window-context.test.ts"], environment);
    expect(output).toContain("real GL procedures");
    expect(output).toContain("0 fail");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
    xvfb.kill(); await xvfb.exited; await errors;
  }
}, 45_000);
