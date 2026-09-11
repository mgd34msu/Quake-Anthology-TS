import { copyFile, mkdir, mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyFile } from "../environment.ts";
import { query, unusedPort } from "../q2-native/udp.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const steam = "/home/buzzkill/.local/share/Steam/steamapps/common";
const retail = join(steam, "Quake 3 Arena/quake3.exe");
const runtime = join(steam, "Proton - Experimental/files");
const wine = join(runtime, "bin/wine");
const corpus = resolve(project, "../qfiles/q3a");
const originalSource = resolve(project, "../qsrc/quake-iii-arena");

async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

function spawnObserved(command: string[], cwd: string, environment: Record<string, string>, timeoutMs: number) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const child = Bun.spawn(command, { cwd, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  let timeout = false;
  const timer = setTimeout(() => { timeout = true; child.kill("SIGKILL"); }, timeoutMs);
  let observed: Promise<{ command: string[]; cwd: string; environment: Record<string, string>; startedAt: string;
    durationMs: number; pid: number; exitCode: number; timeout: boolean; stdout: string; stderr: string }> | null = null;
  return {
    pid: child.pid,
    alive: (): boolean => child.exitCode === null,
    stop: (): void => { if (child.exitCode === null) child.kill("SIGTERM"); },
    finish() {
      if (observed === null) observed = (async () => {
        const exitCode = await child.exited;
        clearTimeout(timer);
        return { command, cwd, environment, startedAt, durationMs: performance.now() - start, pid: child.pid,
          exitCode, timeout, stdout: await stdout, stderr: await stderr };
      })();
      return observed;
    },
  };
}

function sandbox(root: string, command: string[]): string[] {
  return ["/usr/bin/bwrap", "--ro-bind", "/", "/", "--bind", root, root,
    "--bind", join(root, "tmp"), "/tmp", "--dev", "/dev", "--proc", "/proc",
    "--unshare-pid", "--die-with-parent", "--", ...command];
}

function windows(path: string): string { return `Z:${path.replaceAll("/", "\\")}`; }
function settings(values: Readonly<Record<string, string>>): string[] {
  return Object.entries(values).flatMap(([name, value]) => ["+set", name, value]);
}

async function waitForLog(path: string, marker: string, process: ReturnType<typeof spawnObserved>, timeoutMs: number): Promise<string> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (text.includes(marker)) return text;
    if (!process.alive()) throw new Error(`Exited before ${marker}: ${text.slice(-2500)}`);
    await Bun.sleep(50);
  }
  throw new Error(`Missing ${marker}: ${(await readFile(path, "utf8").catch(() => "")).slice(-2500)}`);
}

async function captureCase(root: string, display: string, content: string, edition: "baseq3" | "missionpack", mode: "dedicated" | "render") {
  const directory = join(root, `${edition}-${mode}`);
  const home = join(directory, "profile");
  const map = edition === "baseq3" ? "q3dm1" : "mpteam1";
  await mkdir(join(home, edition), { recursive: true });
  await mkdir(join(home, "baseq3"), { recursive: true });
  const config = mode === "dedicated"
    ? `map ${map}\nstatus\nserverinfo\nfs_homepath\nfs_basepath\nprotocol\nsv_fps\necho Q3_RETAIL_READY\n`
    : `map ${map}\nwait 180\nviewpos\nrecord retail-reference\nwait 30\nscreenshot before\n+forward\nwait 60\n-forward\nviewpos\nscreenshot after\nwait 30\nstoprecord\nstatus\ngfxinfo\nfs_homepath\nfs_basepath\nprotocol\necho Q3_RETAIL_CAPTURE_DONE\nquit\n`;
  await Bun.write(join(home, edition, "reference.cfg"), config);
  await Bun.write(join(home, edition, "q3config.cfg"), "// owned empty reference profile\n");
  const port = await unusedPort();
  const environment = { PATH: "/usr/bin:/bin", HOME: join(directory, "wine-home"), WINEPREFIX: join(directory, "wine-prefix"),
    WINEDEBUG: "-all", WINEDLLOVERRIDES: "mscoree,mshtml=", DISPLAY: display, LC_ALL: "C", TZ: "UTC",
    LIBGL_ALWAYS_SOFTWARE: "1", MESA_LOADER_DRIVER_OVERRIDE: "llvmpipe", XDG_CACHE_HOME: join(directory, "cache") };
  await mkdir(environment.HOME, { recursive: true });
  const values = { fs_basepath: windows(content), fs_homepath: windows(home), fs_cdpath: "", fs_copyfiles: "0",
    fs_game: edition === "baseq3" ? "" : edition, dedicated: mode === "dedicated" ? "1" : "0", net_ip: "127.0.0.1",
    net_port: String(port), sv_master1: "", sv_pure: "0", sv_maxclients: "4", sv_hostname: `q3-retail-${edition}`,
    cl_motd: "0", cl_allowDownload: "0", sv_allowDownload: "0", rconPassword: "reference-private", logfile: "2", developer: "1", bot_enable: "0",
    com_hunkMegs: "128", com_zoneMegs: "32", com_maxfps: "60", r_mode: "3", r_fullscreen: "0", r_allowSoftwareGL: "1",
    r_colorbits: "24", r_depthbits: "24", r_stencilbits: "8", r_swapInterval: "0", s_initsound: "0", in_mouse: "0",
    g_gametype: edition === "baseq3" ? "0" : "4", g_doWarmup: "0", g_log: "games.log", g_logSync: "1",
    vm_game: "1", vm_cgame: "1", vm_ui: "1", com_introplayed: "1" };
  const command = sandbox(root, [wine, windows(join(root, "bin/quake3.exe")), ...settings(values), "+exec", "reference.cfg"]);
  const process = spawnObserved(command, directory, environment, 90_000);
  await Bun.write(join(root, "live.json"), JSON.stringify({ display, pid: process.pid, directory, prefix: environment.WINEPREFIX }));
  processOutput(`${edition} ${mode} started PID ${process.pid}`);
  const queries: Awaited<ReturnType<typeof query>>[] = [];
  let failure: string | null = null;
  try {
    await waitForLog(join(home, edition, "qconsole.log"), mode === "dedicated" ? "Q3_RETAIL_READY" : "Q3_RETAIL_CAPTURE_DONE", process, 80_000);
    if (mode === "dedicated") {
      for (const request of ["getstatus q3-retail", "getinfo q3-retail", "getchallenge"]) queries.push(await query(port, request));
      queries.push(await query(port, "rcon reference-private status"));
      queries.push(await query(port, "rcon reference-private quit"));
      process.stop();
    }
  } catch (error) { failure = error instanceof Error ? error.message : String(error); process.stop(); }
  const observation = await process.finish();
  const outputs = await Promise.all((await filesBelow(home)).map(identifyFile));
  const log = await readFile(join(home, edition, "qconsole.log"), "utf8").catch(() => "");
  const qualification = { mapInitialized: log.includes(`------ Server Initialization ------`) && log.includes(`map: ${map}`),
    vmExecuted: log.includes("Game Initialization") || log.includes("InitGame:"),
    protocolReplies: queries.filter(item => item.response.length > 0).length,
    demoRecorded: outputs.some(item => item.path.endsWith(".dm_68") && item.size > 16),
    renderFrames: outputs.filter(item => item.path.endsWith(".tga")).length };
  await Bun.write(join(directory, "process.json"), JSON.stringify(observation, null, 2) + "\n");
  processOutput(`${edition} ${mode}: ${JSON.stringify(qualification)}${failure === null ? "" : ` failure ${failure}`}`);
  return { edition, mode, map, directory, requestedSettings: values, input: config, observation,
    qualification, failure, queries, outputs, log, home, environment };
}

function processOutput(message: string): void { process.stdout.write(`${message}\n`); }

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error("Usage: bun tools/reference/q3-retail/capture.ts");
  const artifacts = join(project, ".artifacts/q3-retail");
  await mkdir(artifacts, { recursive: true });
  const root = await mkdtemp(join(artifacts, "capture-"));
  for (const path of ["tmp/.X11-unix", "bin", "content/baseq3", "content/missionpack"]) await mkdir(join(root, path), { recursive: true });
  await copyFile(retail, join(root, "bin/quake3.exe"));
  const archives: Awaited<ReturnType<typeof identifyFile>>[] = [];
  for (const edition of ["baseq3", "missionpack"]) {
    for (const name of (await readdir(join(corpus, edition))).filter(name => /^pak[0-9]+\.pk3$/.test(name)).sort()) {
      const source = join(corpus, edition, name);
      archives.push(await identifyFile(source));
      await symlink(source, join(root, "content", edition, name));
    }
  }
  const display = ":23173";
  const displayEnvironment = { PATH: "/usr/bin:/bin", LC_ALL: "C", HOME: root, LIBGL_ALWAYS_SOFTWARE: "1",
    __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/50_mesa.json" };
  const server = spawnObserved(sandbox(root, ["/usr/bin/Xvfb", display, "-screen", "0", "640x480x24", "-nolisten", "tcp", "-noreset", "-extension", "GLX"]), root, displayEnvironment, 120_000);
  const cases: Awaited<ReturnType<typeof captureCase>>[] = [];
  let failure: string | null = null;
  try {
    await Bun.sleep(500);
    if (!server.alive()) throw new Error("Private Xvfb exited");
    cases.push(await captureCase(root, display, join(root, "content"), "baseq3", "dedicated"));
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally { server.stop(); }
  const displayObservation = await server.finish();
  const manifest = { schemaVersion: 1, classification: "independent-retail-executable-observation", capturedAt: new Date().toISOString(), root,
    command: [process.execPath, fileURLToPath(import.meta.url)], executable: await identifyFile(retail), copiedExecutable: await identifyFile(join(root, "bin/quake3.exe")),
    captureProgram: await identifyFile(fileURLToPath(import.meta.url)), runtime: await Promise.all([
      wine, join(runtime, "bin/wineserver"), join(runtime, "lib/wine/i386-windows/ntdll.dll"), join(runtime, "lib/wine/x86_64-unix/ntdll.so"),
      process.execPath, "/usr/bin/bwrap", "/usr/bin/Xvfb"].map(identifyFile)),
    sourceContext: { classification: "filesystem-review-only-not-retail-build-provenance", files: await Promise.all([
      "code/qcommon/files.c", "code/win32/win_main.c", "code/client/cl_main.c"].map(path => identifyFile(join(originalSource, path)))),
      review: "FS_FOpenFileWrite/Append and FS_SV_FOpenFileWrite use fs_homepath; fs_copyfiles is disabled. Retail writes are independently restricted by a read-only host mount and owned writable root." },
    content: { archives, order: "For each game directory pk3 names mount in reverse lexical order, and missionpack precedes baseq3. Actual search paths are retained in each engine log.",
      selection: "Only selected pakN.pk3 symlinks; existing external configs, q3key, logs and donor executables are excluded." },
    isolation: { writableRoot: root, display, tmp: join(root, "tmp"), policy: "bubblewrap read-only root; only artifact root and owned /tmp writable; private PID namespace dies with each process; no Proton launcher; no host display; loopback engine binding" },
    displayObservation, cases, failure, limits: ["No retail build source provenance is asserted. Source hashes describe only the filesystem safety review.",
      "This bounded independent capture does not establish a TypeScript implementation comparison, campaign completion, multi-seat behavior, audio, or performance acceptance.",
      "Requested cvars and input schedules are retained alongside actual logs and output identities; wall-clock timing is environment-specific."] };
  const output = join(project, "verification/reference-cases/q3-retail/latest.json");
  await mkdir(dirname(output), { recursive: true });
  await Bun.write(output, JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(join(root, "live.json"), JSON.stringify({ state: "reaped", displayPid: server.pid, casePids: cases.map(item => item.observation.pid) }));
  processOutput(output);
  if (failure !== null || cases.some(item => item.failure !== null)) process.exitCode = 1;
}

if (import.meta.main) await main();
