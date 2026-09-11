import { access, copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyFile, observeCommand } from "../environment.ts";
import type { CommandObservation, FileIdentity } from "../schema.ts";
import { stageContent } from "./content.ts";
import { startObserved } from "./process.ts";
import type { ObservedProcess } from "./process.ts";
import { query, unusedPort } from "./udp.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = resolve(project, "../qsrc/q2repro");
const build = join(source, "build");
const corpus = resolve(project, "../qfiles/q2");
type ProcessObservation = Awaited<ReturnType<ObservedProcess["finish"]>> & { readonly name: string };
type Output = { readonly kind: "png"; readonly identity: FileIdentity; readonly width: number; readonly height: number }
  | { readonly kind: "file"; readonly identity: FileIdentity };
function isUnknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }
const definitions = [
  { id: "classic", module: join(build, "baseq2/gamex86_64.so"),
    archives: [join(corpus, "baseq2/pak0.pak"), join(corpus, "baseq2/pak1.pak"), join(corpus, "baseq2/pak2.pak")] },
  { id: "rerelease", module: join(build, "baseq2/game_x86_64.so"),
    archives: [join(corpus, "rerelease/baseq2/pak0.pak")] },
];

async function filesBelow(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function sourceInputs() {
  const raw: unknown = JSON.parse(await readFile(join(build, "compile_commands.json"), "utf8"));
  if (!isUnknownArray(raw)) throw new Error("Expected compilation database array");
  const paths = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || !("directory" in entry) || !("file" in entry)
      || typeof entry.directory !== "string" || typeof entry.file !== "string") throw new Error("Invalid compilation database entry");
    paths.add(resolve(entry.directory, entry.file));
  }
  const identities: FileIdentity[] = [];
  for (const path of [...paths].sort()) identities.push(await identifyFile(path));
  return identities;
}

async function provenance(directory: string) {
  const records = ["config.h", "build.ninja", "compile_commands.json", ".ninja_log", ".ninja_deps",
    "meson-info/intro-projectinfo.json", "meson-info/intro-targets.json", "meson-info/intro-compilers.json",
    "meson-info/intro-buildoptions.json", "meson-info/intro-dependencies.json", "meson-logs/meson-log.txt"];
  const binaries = [join(build, "q2repro"), join(build, "q2reproded"), ...definitions.map(item => item.module)];
  const observations: { identity: FileIdentity; header: CommandObservation; linked: CommandObservation }[] = [];
  const dependencies = new Set<string>();
  for (const path of binaries) {
    const header = await observeCommand(["file", "--brief", path], project);
    const linked = await observeCommand(["ldd", path], project);
    for (const line of linked.stdout.split("\n")) {
      const match = line.match(/(?:=>\s*)?(\/\S+)\s+\(/);
      if (match?.[1] !== undefined) dependencies.add(match[1]);
    }
    observations.push({ identity: await identifyFile(path), header, linked });
  }
  const buildRecords: FileIdentity[] = [];
  for (const record of records) buildRecords.push(await identifyFile(join(build, record)));
  const dependencyFiles: FileIdentity[] = [];
  for (const path of [...dependencies].sort()) dependencyFiles.push(await identifyFile(path));
  const inventoryPath = join(project, "verification/reference-environment.json");
  const originalInventory = await identifyFile(inventoryPath);
  const capturedInventoryPath = join(directory, "reference-environment.json");
  await copyFile(inventoryPath, capturedInventoryPath);
  const environmentManifest = await identifyFile(capturedInventoryPath);
  if (originalInventory.sha256 !== environmentManifest.sha256) throw new Error("Environment inventory changed during capture");
  return { classification: "independent-executable-observation", binaries: observations, buildRecords,
    buildConfigText: await readFile(join(build, "config.h"), "utf8"), currentCompilationInputs: await sourceInputs(),
    dependencies: dependencyFiles, environmentManifest,
    limitation: "Existing binaries were not rebuilt. Build records, current compilation inputs and source inventory do not prove that current source bytes produced these binaries. Header dependencies are represented by the existing Ninja dependency record, not a reconstructed source closure. No current-HEAD build equivalence is claimed." };
}

function settings(values: Readonly<Record<string, string>>): string[] {
  return Object.entries(values).flatMap(([key, value]) => ["+set", key, value]);
}

async function makeHome(path: string): Promise<void> {
  await mkdir(join(path, "baseq2"), { recursive: true });
  for (const name of ["autoexec.cfg", "q2config.cfg", "config.cfg"]) await Bun.write(join(path, "baseq2", name), "// isolated native reference\n");
}

async function inspectOutputs(home: string) {
  const results: Output[] = [];
  for (const path of await filesBelow(home)) {
    const identity = await identifyFile(path);
    if (path.endsWith(".png")) {
      const data = Buffer.from(await Bun.file(path).slice(0, 24).arrayBuffer());
      if (data.length !== 24 || data.toString("hex", 0, 8) !== "89504e470d0a1a0a") throw new Error(`Invalid PNG: ${path}`);
      results.push({ kind: "png", identity, width: data.readUInt32BE(16), height: data.readUInt32BE(20) });
    } else results.push({ kind: "file", identity });
  }
  return results;
}

export async function privateDisplay(directory: string, environment: Record<string, string>) {
  for (let index = 0; index < 100; index++) {
    const number = 13000 + (process.pid % 10000) + index;
    const socket = `/tmp/.X11-unix/X${number}`;
    const lock = `/tmp/.X${number}-lock`;
    const exists = await Promise.all([access(socket).then(() => true, () => false), access(lock).then(() => true, () => false)]);
    if (exists.some(Boolean)) continue;
    const display = `:${number}`;
    const child = startObserved(["/usr/bin/Xvfb", display, "-screen", "0", "640x480x24", "-nolisten", "tcp", "-noreset"], directory, environment, 180_000);
    try {
      const deadline = performance.now() + 5000;
      while (!await access(socket).then(() => true, () => false)) {
        if (performance.now() > deadline) throw new Error("Private Xvfb did not create its socket");
        await Bun.sleep(25);
      }
      return { display, process: child };
    } catch (error) { await child.finish(join(directory, "xvfb-failed")); throw error; }
  }
  throw new Error("No unused private display number in reserved search range");
}

async function runCase(definition: typeof definitions[number], contentDirectory: string, directory: string,
  mode: "dedicated-network" | "singleplayer-save", display: string) {
  await mkdir(directory, { recursive: true });
  const serverHome = join(directory, "server");
  const clientHome = join(directory, "client");
  await makeHome(serverHome);
  await makeHome(clientHome);
  const port = await unusedPort();
  const common = { basedir: contentDirectory, libdir: build, sys_forcegamelib: definition.module,
    public: "0", net_ip: "127.0.0.1", net_enable_ipv6: "0", net_port: String(port),
    hostname: `q2-native-${definition.id}`, allow_download: "0", logfile: "0", sys_console: "1" };
  const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", DISPLAY: display,
    SDL_VIDEODRIVER: "x11", SDL_AUDIODRIVER: "dummy", LIBGL_ALWAYS_SOFTWARE: "1", MESA_LOADER_DRIVER_OVERRIDE: "llvmpipe" };
  const processes: { name: string; process: ObservedProcess }[] = [];
  const observations: ProcessObservation[] = [];
  const queries: Awaited<ReturnType<typeof query>>[] = [];
  let failure: string | null = null;
  try {
    if (mode === "dedicated-network") {
      const server = startObserved([join(build, "q2reproded"), ...settings({ ...common, homedir: serverHome,
        deathmatch: "1", maxclients: "4" }), "+map", "q2dm1", "+status", "+serverinfo", "+echo", "NATIVE_SERVER_READY"], directory, environment);
      processes.push({ name: "dedicated", process: server });
      await server.waitFor("NATIVE_SERVER_READY");
      if (!server.output().includes("Current map: q2dm1")) throw new Error("Dedicated map did not load");
      for (const request of ["status", "info 34", "getchallenge"]) queries.push(await query(port, request));
      if (queries.some(item => item.response.length === 0)) throw new Error("Missing UDP reference response");
    }
    const client = startObserved([join(build, "q2repro"), ...settings({ ...common, homedir: clientHome,
      deathmatch: "0", s_enable: "0", cl_autopause: "0", cl_maxfps: "60", cl_async: "0", vid_driver: "x11",
      vid_geometry: "640x480", vid_fullscreen: "0", r_screenshot_async: "0", r_screenshot_format: "png", con_notifytime: "0",
      name: "native-reference", cl_protocol: "0" }),
      ...(mode === "dedicated-network" ? ["+connect", `127.0.0.1:${port}`] : ["+map", "base1"]),
      "+echo", "NATIVE_CLIENT_READY"], directory, environment);
    processes.push({ name: "client", process: client });
    await client.waitFor("NATIVE_CLIENT_READY");
    await Bun.sleep(2500);
    await client.send("strings\nviewpos\nrecord native-reference\necho NATIVE_RECORD_REQUESTED");
    await client.waitFor("NATIVE_RECORD_REQUESTED");
    await Bun.sleep(300);
    await client.send("screenshot png\n+forward\necho NATIVE_FORWARD_START");
    await client.waitFor("NATIVE_FORWARD_START");
    await Bun.sleep(400);
    await client.send("-forward\nviewpos\nscreenshot png\necho NATIVE_FORWARD_STOP");
    await client.waitFor("NATIVE_FORWARD_STOP");
    await Bun.sleep(300);
    if (mode === "singleplayer-save") {
      await client.send("save native-reference\necho NATIVE_SAVE_REQUESTED");
      await client.waitFor("NATIVE_SAVE_REQUESTED");
      await Bun.sleep(300);
      await client.send("load native-reference\necho NATIVE_LOAD_REQUESTED");
      await client.waitFor("NATIVE_LOAD_REQUESTED");
      await Bun.sleep(500);
      await client.send("viewpos\nstatus\nscreenshot png\necho NATIVE_RELOAD_OBSERVED");
      await client.waitFor("NATIVE_RELOAD_OBSERVED");
    } else {
      const server = processes.find(item => item.name === "dedicated");
      if (server === undefined) throw new Error("Dedicated process absent");
      await server.process.send("status\nstatus p\nstatus t\nsv_fps\necho NATIVE_CLIENT_STATUS");
      await server.process.waitFor("NATIVE_CLIENT_STATUS");
      queries.push(await query(port, "status"));
    }
    await client.send("stop\necho NATIVE_CAPTURE_DONE");
    await client.waitFor("NATIVE_CAPTURE_DONE");
    await Bun.sleep(200);
    await client.send("quit");
    await Bun.sleep(200);
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally {
    for (const item of [...processes].reverse()) observations.push({ name: item.name,
      ...await item.process.finish(join(directory, item.name + "-logs")) });
  }
  const outputs = [...await inspectOutputs(serverHome), ...await inspectOutputs(clientHome)];
  const screenshots = outputs.filter(item => item.kind === "png");
  const demo = outputs.find(item => item.identity.path.endsWith(".dm2"));
  const clientOutput = observations.find(item => item.name === "client")?.stdout ?? "";
  const checks = {
    checkpointSequenceCompleted: failure === null,
    screenshots640x480: screenshots.length >= 2 && screenshots.every(item => item.width === 640 && item.height === 480),
    demoWritten: demo !== undefined && demo.identity.size > 1024,
    loopbackReply: mode === "singleplayer-save" || queries.every(item => item.response.some(packet => packet.from === "127.0.0.1" && packet.port === port)),
    nativeClientConnected: observations.some(item => item.name === "client" && item.stdout.includes("Connected to ")),
    softwareRendererObserved: clientOutput.includes("llvmpipe"),
    saveAndReloadObserved: mode === "dedicated-network" || clientOutput.includes("Game saved.")
      && clientOutput.includes("Current map: base1")
      && clientOutput.split("Connected to loopback").length >= 3
      && outputs.some(item => item.identity.path.endsWith("/save/native-reference/base1.sav") && item.identity.size > 0)
      && outputs.some(item => item.identity.path.endsWith("/save/native-reference/game.ssv") && item.identity.size > 0),
  };
  const result = { id: `${definition.id}-${mode}`, classification: "independent-executable-observation",
    mode, port, failure, checks, observed: Object.values(checks).every(Boolean), queries, processes: observations, outputs,
    limitations: ["Input durations and checkpoints use wall-clock scheduling; they are not a deterministic simulation clock.",
      "Screenshots are native llvmpipe observations; no TypeScript renderer comparison or image tolerance is established.",
      "Demo files contain native server messages; this lane records their bytes without claiming complete protocol decoding.",
      "A save/load request is accepted only when its console and files show success; unsupported game save formats remain unsupported."] };
  await Bun.write(join(directory, "case.json"), JSON.stringify(result, null, 2) + "\n");
  return result;
}

export async function capture(): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(project, ".artifacts/q2-native", runId);
  await mkdir(directory, { recursive: true });
  const identity = await provenance(directory);
  await Bun.write(join(directory, "provenance.json"), JSON.stringify(identity, null, 2) + "\n");
  const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const display = await privateDisplay(directory, environment);
  const cases: Awaited<ReturnType<typeof runCase>>[] = [];
  const content: (Awaited<ReturnType<typeof stageContent>> & { readonly id: string })[] = [];
  let displayObservation: Awaited<ReturnType<ObservedProcess["finish"]>> | null = null;
  try {
    for (const definition of definitions) {
      const mounted = await stageContent(definition.archives, join(directory, definition.id, "data"), ["maps/base1.bsp", "maps/q2dm1.bsp"]);
      content.push({ id: definition.id, ...mounted });
      for (const mode of ["dedicated-network", "singleplayer-save"] satisfies readonly ("dedicated-network" | "singleplayer-save")[]) {
        const result = await runCase(definition, mounted.mount, join(directory, definition.id, mode), mode, display.display);
        cases.push(result);
        process.stdout.write(JSON.stringify({ case: result.id, observed: result.observed, checks: result.checks, failure: result.failure }) + "\n");
      }
    }
  } finally { displayObservation = await display.process.finish(join(directory, "xvfb")); }
  const tools: FileIdentity[] = [];
  for (const path of await filesBelow(dirname(fileURLToPath(import.meta.url)))) if (path.endsWith(".ts")) tools.push(await identifyFile(path));
  for (const name of ["environment.ts", "schema.ts"]) tools.push(await identifyFile(join(project, "tools/reference", name)));
  const result = { schemaVersion: 1, capturedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)],
    artifactDirectory: directory, runtime: await identifyFile(process.execPath), tools,
    provenance: await identifyFile(join(directory, "provenance.json")), sourceAttribution: identity.limitation,
    content, display: { binary: await identifyFile("/usr/bin/Xvfb"), ...displayObservation }, cases,
    unsupportedReferences: ["Retail Windows quake2.exe and quake2ex_steam.exe were not executed.",
      "Mission packs, multiplayer interoperability with the TypeScript engine, numerical gameplay equivalence, controlled frame timing, and renderer tolerances are not established."] };
  const destination = join(project, "verification/reference-cases/q2-native/latest.json");
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(join(directory, "capture.json"), JSON.stringify(result, null, 2) + "\n");
  await Bun.write(destination, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ manifest: destination, artifacts: directory, observedCases: cases.filter(item => item.observed).length }) + "\n");
  if (cases.some(item => !item.observed)) process.exitCode = 1;
}

if (import.meta.main) await capture();
