import { access, copyFile, mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { identifyFile } from "../environment.ts";
import type { FileIdentity } from "../schema.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const steam = join(homedir(), ".local/share/Steam/steamapps/common");
const wine = join(steam, "Proton - Experimental/files/bin/wine");
const wineserver = join(steam, "Proton - Experimental/files/bin/wineserver");
const original = join(steam, "Quake/Winquake.exe");
const corpus = resolve(project, "../qfiles/q1/id1");

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function command(argv: readonly string[], cwd: string, env: Record<string, string>, timeoutMs: number) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const log = join(cwd, `process-${startedAt.replaceAll(":", "-")}`);
  const child = Bun.spawn([...argv], { cwd, env, stdin: "ignore",
    stdout: Bun.file(log + ".stdout.txt"), stderr: Bun.file(log + ".stderr.txt") });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
  try {
    const exitCode = await child.exited;
    const [stdout, stderr] = await Promise.all([readFile(log + ".stdout.txt", "utf8"), readFile(log + ".stderr.txt", "utf8")]);
    return { command: argv, cwd, environment: env, startedAt, durationMs: performance.now() - start,
      pid: child.pid, exitCode, timedOut, stdout, stderr };
  } finally { clearTimeout(timer); }
}

function waits(count: number): string { return "wait\n".repeat(count); }

export function captureConfig(): string {
  return [
    "echo Q1_RETAIL_BEGIN", "version", "developer 1", "skill 1", "deathmatch 0", "coop 0",
    "host_framerate 0.05", "sys_ticrate 0.05", "cl_forwardspeed 200", "cl_backspeed 200",
    "cl_sidespeed 350", "cl_upspeed 200", "cl_movespeedkey 2", "vid_mode 2", "viewsize 100",
    "fov 90", "gamma 1", "record retail-reference start", waits(60),
    "echo Q1_RETAIL_MAP_READY", "status", "host_framerate", "sys_ticrate", "cl_forwardspeed",
    "save retail-before", "screenshot", "+forward", waits(20), "-forward", waits(2),
    "save retail-moved", "screenshot", "stop", "load retail-before", waits(30),
    "save retail-restored", "screenshot", "echo Q1_RETAIL_DONE", "toggleconsole", "quit", "",
  ].join("\n");
}

export async function captureRetail() {
  const directory = join(project, ".artifacts/q1-retail", new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-"));
  const game = join(directory, "game");
  const id1 = join(game, "id1");
  const prefix = join(directory, "wineprefix");
  const privateHome = join(directory, "home");
  await mkdir(directory, { recursive: true });
  await Promise.all([mkdir(id1, { recursive: true }), mkdir(prefix), mkdir(privateHome)]);
  await copyFile(fileURLToPath(import.meta.url), join(directory, "capture-driver.ts"));
  const assets: FileIdentity[] = [];
  for (const { source, target } of [{ source: "PAK0.PAK", target: "pak0.pak" }, { source: "PAK1.PAK", target: "pak1.pak" }]) {
    const path = join(corpus, source);
    assets.push(await identifyFile(path));
    await symlink(path, join(id1, target));
  }
  const executable = await identifyFile(original);
  await copyFile(original, join(game, "Winquake.exe"));
  await Bun.write(join(id1, "config.cfg"), "// Private retail reference profile\n");
  await Bun.write(join(id1, "autoexec.cfg"), "// Private retail reference profile\n");
  const config = captureConfig();
  await Bun.write(join(id1, "reference.cfg"), config);
  let number = 25000 + process.pid % 10000;
  while (await exists(`/tmp/.X11-unix/X${number}`) || await exists(`/tmp/.X${number}-lock`)) number++;
  const display = `:${number}`;
  const environment = { PATH: "/usr/bin:/bin", HOME: privateHome, LC_ALL: "C", TZ: "UTC",
    WINEPREFIX: prefix, WINEDEBUG: "-all", WINEDLLOVERRIDES: "winemenubuilder.exe=d", DISPLAY: display,
    LIBGL_ALWAYS_SOFTWARE: "1", MESA_LOADER_DRIVER_OVERRIDE: "llvmpipe" };
  const displayCommand = ["/usr/bin/Xvfb", display, "-screen", "0", "800x600x24", "-nolisten", "tcp", "-noreset"];
  const xvfb = Bun.spawn(displayCommand, { cwd: directory, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const displayOut = new Response(xvfb.stdout).text();
  const displayErr = new Response(xvfb.stderr).text();
  let observed: Awaited<ReturnType<typeof command>> | null = null;
  let cleanup: Awaited<ReturnType<typeof command>> | null = null;
  let failure: string | null = null;
  try {
    const deadline = performance.now() + 5000;
    while (!await exists(`/tmp/.X11-unix/X${number}`)) {
      if (xvfb.exitCode !== null || performance.now() > deadline) throw new Error("Private Xvfb failed to start");
      await Bun.sleep(25);
    }
    observed = await command([wine, join(game, "Winquake.exe"), "-startwindowed", "-dibonly", "-nocdaudio", "-nosound", "-nojoy", "-nomouse", "-condebug", "+exec", "reference.cfg"], game, environment, 90_000);
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally {
    cleanup = await command([wineserver, "-k"], directory, environment, 5000);
    if (xvfb.exitCode === null) xvfb.kill("SIGTERM");
    await xvfb.exited;
  }
  const outputs: FileIdentity[] = [];
  for (const item of await readdir(id1, { withFileTypes: true })) {
    if (item.isFile()) outputs.push(await identifyFile(join(id1, item.name)));
  }
  const consolePath = join(id1, "qconsole.log");
  const consoleText = await exists(consolePath) ? await readFile(consolePath, "utf8") : "";
  const result = { schemaVersion: 1, capturedAt: new Date().toISOString(), classification: "independent-retail-executable-observation",
    directory, provenance: { executable, stagedExecutable: await identifyFile(join(game, "Winquake.exe")), assets,
      runtime: await identifyFile(wine), wineserver: await identifyFile(wineserver), driver: await identifyFile(join(directory, "capture-driver.ts")) },
    config, observed, cleanup, failure,
    display: { command: displayCommand, environment, pid: xvfb.pid, exitCode: xvfb.exitCode, stdout: await displayOut, stderr: await displayErr },
    consoleText, outputs, checks: { processExitedSuccessfully: observed?.exitCode === 0 && observed.timedOut === false,
      mapCheckpointObserved: consoleText.includes("Q1_RETAIL_MAP_READY"), doneCheckpointObserved: consoleText.includes("Q1_RETAIL_DONE") },
    limitations: ["Installed executable identity establishes the observed bytes, not vendor authenticity or equivalence to current source.",
      "The reference.cfg schedule uses requested host_framerate and wait commands. Simulation and command acceptance must be checked against observed artifacts.",
      "No TypeScript engine comparison, multiplayer interoperability, mission pack, rerelease, or image tolerance is established."] };
  await Bun.write(join(directory, "capture.json"), JSON.stringify(result, null, 2) + "\n");
  await Bun.write(join(project, "verification/reference-cases/q1-retail/latest.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ directory, checks: result.checks, failure, outputCount: outputs.length }) + "\n");
  return result;
}

if (import.meta.main) {
  const result = await captureRetail();
  if (result.failure !== null || Object.values(result.checks).some(value => !value)) process.exitCode = 1;
}
