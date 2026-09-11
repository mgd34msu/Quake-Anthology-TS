import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyFile } from "../environment.ts";
import type { FileIdentity } from "../schema.ts";
import { stageContent } from "./content.ts";
import { privateDisplay } from "./capture.ts";
import { startObserved } from "./process.ts";
import type { ObservedProcess } from "./process.ts";
import { query, unusedPort } from "./udp.ts";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const steam = "/home/buzzkill/.local/share/Steam/steamapps/common";
const retail = join(steam, "Quake 2");
const runtime = join(steam, "Proton - Experimental/files/bin");

export async function captureSteamClassic(): Promise<void> {
  const directory = join(project, ".artifacts/q2-retail", new Date().toISOString().replace(/[:.]/g, "-"));
  const stage = join(directory, "game");
  const prefix = join(directory, "prefix");
  await mkdir(prefix, { recursive: true });
  const content = await stageContent([join(retail, "baseq2/pak0.pak"), join(retail, "baseq2/pak1.pak"),
    join(retail, "baseq2/pak2.pak")], stage, ["maps/q2dm1.bsp", "maps/base1.bsp"]);
  const binaries: { original: FileIdentity; staged: FileIdentity }[] = [];
  for (const name of ["quake2.exe", "baseq2/gamex86.dll"]) {
    const original = await identifyFile(join(retail, name));
    await copyFile(join(retail, name), join(stage, name));
    const staged = await identifyFile(join(stage, name));
    if (staged.sha256 !== original.sha256) throw new Error(`Retail staging changed bytes: ${name}`);
    binaries.push({ original, staged });
  }
  for (const name of ["autoexec.cfg", "config.cfg"]) await Bun.write(join(stage, "baseq2", name), "// isolated retail reference\n");
  const environment: Record<string, string> = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC", WINEPREFIX: prefix,
    WINEDEBUG: "-all,err+all,warn+all", WINEDLLOVERRIDES: "winemenubuilder.exe=d;winegstreamer=d;mscoree=d;mshtml=d",
    LIBGL_ALWAYS_SOFTWARE: "1", MESA_LOADER_DRIVER_OVERRIDE: "llvmpipe", SDL_AUDIODRIVER: "dummy" };
  const display = await privateDisplay(directory, environment);
  environment["DISPLAY"] = display.display;
  const initialization = startObserved([join(runtime, "wine"), "wineboot", "--init"], directory, environment);
  await initialization.waitForExit();
  const initializationObservation = await initialization.finish(join(directory, "wineboot"));
  const port = await unusedPort();
  const command = [join(runtime, "wine"), join(stage, "quake2.exe"), "+set", "basedir", ".", "+set", "dedicated", "1",
    "+set", "public", "0", "+set", "ip", "127.0.0.1", "+set", "port", String(port), "+set", "noipx", "1",
    "+set", "logfile", "2", "+set", "rcon_password", "native-reference", "+set", "deathmatch", "1",
    "+set", "maxclients", "4", "+set", "hostname", "steam-q2-native-reference", "+map", "q2dm1", "+status", "+echo", "RETAIL_READY"];
  const child = startObserved(command, stage, environment);
  const queries: Awaited<ReturnType<typeof query>>[] = [];
  let consoleText = "";
  let failure: string | null = null;
  let processObservation: Awaited<ReturnType<ObservedProcess["finish"]>> | null = null;
  let serverCleanup: Awaited<ReturnType<ObservedProcess["finish"]>> | null = null;
  let displayObservation: Awaited<ReturnType<ObservedProcess["finish"]>> | null = null;
  try {
    const deadline = performance.now() + 40_000;
    while (!consoleText.includes("RETAIL_READY")) {
      consoleText = await readFile(join(stage, "baseq2/qconsole.log"), "utf8").catch(() => "");
      if (performance.now() > deadline) throw new Error(`Retail map checkpoint timed out: ${consoleText.slice(-2500)} ${child.output().slice(-2500)}`);
      await Bun.sleep(50);
    }
    for (const request of ["status", "info 34", "getchallenge", "rcon native-reference status", "rcon native-reference serverinfo"])
      queries.push(await query(port, request));
    queries.push(await query(port, "rcon native-reference map base1"));
    await Bun.sleep(500);
    queries.push(await query(port, "rcon native-reference status"));
    queries.push(await query(port, "rcon native-reference quit"));
    await Bun.sleep(300);
    consoleText = await readFile(join(stage, "baseq2/qconsole.log"), "utf8");
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  finally {
    processObservation = await child.finish(join(directory, "wine"));
    const cleanup = startObserved([join(runtime, "wineserver"), "-k"], directory, environment);
    await Bun.sleep(100);
    serverCleanup = await cleanup.finish(join(directory, "wineserver-cleanup"));
    displayObservation = await display.process.finish(join(directory, "xvfb"));
  }
  const checks = {
    loadedQ2dm1: consoleText.includes("SpawnServer: q2dm1"),
    loadedBase1: consoleText.includes("SpawnServer: base1"),
    protocol34: queries.some(item => item.request === "status" && item.response.some(packet => packet.text.includes("\\protocol\\34"))),
    classicChallenge: queries.some(item => item.request === "getchallenge" && item.response.some(packet => packet.text.includes("challenge "))),
    loopbackReplies: queries.length >= 7 && queries.filter(item => !item.request.endsWith("quit")).every(item => item.response.length > 0
      && item.response.every(packet => packet.from === "127.0.0.1" && packet.port === port)),
  };
  const inputsAfter: FileIdentity[] = [];
  for (const item of binaries) inputsAfter.push(await identifyFile(item.original.path));
  const result = { schemaVersion: 1, capturedAt: new Date().toISOString(), classification: "retail-executable-observation-under-wine",
    command: [process.execPath, ...process.argv.slice(1)], captureProgram: await identifyFile(fileURLToPath(import.meta.url)),
    runtime: await identifyFile(process.execPath), wine: await identifyFile(join(runtime, "wine")),
    wineserver: await identifyFile(join(runtime, "wineserver")), binaries, inputsAfter,
    content, port, failure, checks, observed: failure === null && Object.values(checks).every(Boolean),
    processes: { initialization: initializationObservation, game: processObservation, cleanup: serverCleanup, display: displayObservation },
    queries, consoleText, artifactDirectory: directory,
    limits: ["The supplied Steam classic executable ran through the existing Proton Wine runtime in a fresh prefix; this is not a native Windows platform observation.",
      "Only dedicated q2dm1/base1 loading and connectionless protocol 34 requests are covered. Retail rendering, movement, saves, and complete client signon are not covered.",
      "The rerelease Steam executable is not executed by this case. Existing q2repro rerelease-module captures remain a separate observation.",
      "Wine may initialize Windows components inside this fresh prefix. Steam app files, the Proton installation, and real Steam compatibility profiles are never write targets."] };
  await Bun.write(join(directory, "capture.json"), JSON.stringify(result, null, 2) + "\n");
  const destination = join(project, "verification/reference-cases/q2-native/steam-classic.json");
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ manifest: destination, observed: result.observed, checks, failure }) + "\n");
  if (!result.observed) process.exitCode = 1;
}

if (import.meta.main) await captureSteamClassic();
