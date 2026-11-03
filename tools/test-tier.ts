// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Runs `bun test` in one of three tiers so a missing environment is a named
 * choice and not a silent skip:
 *   unit   - no game data, no native window; data-dependent tests skip.
 *   corpus - needs QTS_TEST_CORPUS; a guard that finds its file missing fails.
 *   gl     - needs QTS_TEST_CORPUS and a GL-capable SDL video driver
 *            (SDL_VIDEODRIVER=offscreen by default); enables the native opt-in gates.
 * Extra arguments go to `bun test` (paths, -t filters).
 */
const tier = process.argv[2],
  rest = process.argv.slice(3);
if (tier !== "unit" && tier !== "corpus" && tier !== "gl") {
  console.error("Usage: bun tools/test-tier.ts <unit|corpus|gl> [bun test arguments]");
  process.exit(2);
}

const env: Record<string, string | undefined> = { ...process.env };
const corpusVariables: readonly string[] = ["QTS_TEST_CORPUS"];
const nativeGates: readonly string[] = [
  "QUAKE_GL_SMOKE",
  "QUAKE_UI_NATIVE_SMOKE",
  "QUAKE_STARTUP_NATIVE_TEST",
  "QUAKE_PLATFORM_NATIVE_TEST",
  "QUAKE_MEDIA_NATIVE",
  "QUAKE_FLARE_RENDER",
  "QUAKE_DEBUG_SHAPES_NATIVE",
  "QUAKE_Q2_NATIVE_APP",
  "QUAKE_STARTUP_RETAIL_TEST",
  "QUAKE_VIEWWEAPON_RENDER",
  "QUAKE_WORLD_TEXT_APP",
  "QUAKE_DOWNLOAD_WORKFLOW_TEST",
  "QUAKE_DEATH_APPLICATION_TEST",
  "QUAKE_ARENA_PUBLIC_TEST",
  "QUAKE_BARREL_SHADOW",
  "QUAKE_DEBUG_SHAPES_APP",
  "QUAKE_FLASHLIGHT_RENDER",
  "QUAKE_HELD_WEAPON_APP",
  "QUAKE_HUD_READABILITY_APP",
  "QUAKE_IMAGE_HUD",
  "QUAKE_PLATFORM_HEADLESS_TEST",
  "QUAKE_PRIVATE_NATIVE",
  "QUAKE_ROUND_AUDIO_DEVICE",
];

if (tier === "unit") {
  for (const name of corpusVariables) delete env[name];
  for (const name of nativeGates) delete env[name];
} else {
  if (corpusVariables.every(name => (env[name] ?? "") === "")) {
    console.error(`The ${tier} tier needs QTS_TEST_CORPUS pointing at the assembled game data (q1/, q2/, q3a/ or the Steam layout).`);
    process.exit(2);
  }
  env["QTS_TEST_REQUIRE_CORPUS"] = "1";
  if (tier === "gl") {
    env["SDL_VIDEODRIVER"] ??= "offscreen";
    // Native gates must never draw on the developer's desktop: the offscreen driver needs no display.
    if (env["SDL_VIDEODRIVER"] === "offscreen") {
      delete env["DISPLAY"];
      delete env["WAYLAND_DISPLAY"];
    }
    env["SDL_AUDIODRIVER"] ??= "dummy";
    for (const name of nativeGates) env[name] = "1";
  }
}

const child = Bun.spawn(["bun", "test", ...rest], { env, stdin: "inherit", stdout: "pipe", stderr: "pipe" });
let transcript = "";
async function forward(stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    sink.write(chunk);
    transcript += decoder.decode(chunk, { stream: true });
  }
}
await Promise.all([forward(child.stdout, process.stdout), forward(child.stderr, process.stderr)]);
const code = await child.exited;

// Skips are only acceptable when named: count them per subsystem so a tier that
// silently lost coverage shows up in the run summary.
const skipped = new Map<string, number>();
let file = "";
for (const line of transcript.split("\n")) {
  const header = /^(tests\/\S+\.ts):\s*$/.exec(line);
  if (header?.[1] !== undefined) file = header[1];
  else if (line.startsWith("(skip)")) {
    const subsystem = file.split("/").slice(0, 2).join("/") || "unknown";
    skipped.set(subsystem, (skipped.get(subsystem) ?? 0) + 1);
  }
}
if (skipped.size > 0) {
  console.error(`\nSkipped tests by subsystem (${tier} tier):`);
  for (const [subsystem, count] of [...skipped].sort((left, right) => right[1] - left[1])) console.error(`  ${String(count).padStart(5)}  ${subsystem}`);
}
process.exit(code);
