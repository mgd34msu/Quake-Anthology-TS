import { appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { version } from "./version.ts";
import { LlmSettingsService } from "./llm/settings.ts";
import { applicationHelp, parseApplicationCommand } from "./app/bootstrap/options.ts";
import { defaultUserContentRoot } from "./content/user-data.ts";
import { BoundedQueue } from "./foundation/bounded-queue.ts";
import { openSplash, runSplashChild, type SplashScreen } from "./app/bootstrap/splash.ts";
import { startupStamp } from "./app/bootstrap/startup-timing.ts";

/** Recent console output retained so a fatal error leaves a diagnosable log on disk. */
const recentOutput = new BoundedQueue<string>(256);
/** Secrets passed on the command line stay out of the log. */
export function redactArguments(argv: readonly string[]): string[] {
  return argv.map((value, index) => /password|secret|token|apikey|api_key/i.test(argv[index - 1] ?? "") ? "<redacted>" : value);
}
/** Console output can echo password cvars or rcon lines; the value after a password-like name is masked. */
export function redactOutput(text: string): string {
  return text.replace(/\b((?:rcon_|mvd_|spectator_|sv_|cl_)?(?:password|secret|token|apikey|api_key)\b"?\s*(?:is\s*:?|=)?\s*)("[^"\n]*"|\S+)/gi, "$1<redacted>");
}
/** The stack plus everything the error wraps; AggregateError and `cause` otherwise vanish from the log. */
export function describeFailure(error: unknown, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  let text = error.stack ?? error.message;
  if (depth >= 8) return text;
  if (error instanceof AggregateError) for (const inner of error.errors) text += `\n[aggregated] ${describeFailure(inner, depth + 1)}`;
  if (error.cause !== undefined) text += `\n[cause] ${describeFailure(error.cause, depth + 1)}`;
  return text;
}
const CRASH_LOG_LIMIT_BYTES = 1024 * 1024;
export function writeCrashLog(error: unknown, argv: readonly string[], directory: string = dirname(defaultUserContentRoot())): void {
  try {
    mkdirSync(directory, { recursive: true });
    let tail = "";
    recentOutput.forEach(chunk => { tail += chunk; });
    if (tail.length > 32768) tail = tail.slice(-32768);
    tail = redactOutput(tail);
    const path = resolve(directory, "crash.log");
    // One previous generation is kept so a crash loop cannot fill the disk.
    try { if (statSync(path).size > CRASH_LOG_LIMIT_BYTES) renameSync(path, `${path}.1`); } catch { /* No log yet. */ }
    appendFileSync(path,
      `\n=== Quake Anthology ${version} crash ${new Date().toISOString()} entry=${Bun.main} argv=${JSON.stringify(redactArguments(argv))}\n`
      + `${describeFailure(error)}\n--- recent output ---\n${tail}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch { /* The stderr report below is the fallback. */ }
}

/** LLM credentials live with the other shared user settings, never beside the executable. */
export function llmSettingsDirectory(): string { return resolve(dirname(defaultUserContentRoot()), "settings"); }

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  if (argv[0] === "--splash-child") {
    const width = Number(argv[1]), height = Number(argv[2]);
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? runSplashChild(width, height) : 1;
  }
  let splash: SplashScreen | null = null;
  // A closed pipe (`| head`, a stopped log reader) is not a crash, so further output is dropped.
  for (const stream of [process.stdout, process.stderr]) stream.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") throw error; });
  process.on("unhandledRejection", error => { writeCrashLog(error, argv); process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(1); });
  process.on("uncaughtException", error => { writeCrashLog(error, argv); process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(1); });
  // A command-line typo is a usage error, not a crash, so it leaves no crash log entry.
  let command: ReturnType<typeof parseApplicationCommand>;
  try { command = parseApplicationCommand(argv); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); return 1; }
  try {
    if (command.kind === "version") { process.stdout.write(`Quake Anthology ${version}\n`); return 0; }
    if (command.kind === "help") {
      // The compiled executable has no `bun run`; name the program the user actually started.
      const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/");
      process.stdout.write(compiled ? applicationHelp.replace("bun run src/main.ts", basename(process.execPath)) : applicationHelp);
      return 0;
    }
    if (command.kind === "weapon-behavior") {
      await (await import("./app/bootstrap/weapon-behavior-tool.ts")).runWeaponBehaviorTool(command.command, text => { process.stdout.write(text); });
      return 0;
    }
    if (command.kind === "list-content") {
      const { discoverInstalledContent } = await import("./content/catalog/index.ts");
      const { defaultAddonContentRoots, defaultUserContentRoot } = await import("./content/user-data.ts");
      const catalog = await discoverInstalledContent({ corpusRoot: command.corpusRoot, userContentRoot: defaultUserContentRoot(), addonContentRoots: defaultAddonContentRoots() });
      for (const product of catalog.products) process.stdout.write(`${product.expectation.id}\t${product.availability.kind}\t${product.expectation.title}\n`);
      return 0;
    }
    splash = command.options.dedicated || command.options.hidden ? null : await openSplash(command.options.width, command.options.height); startupStamp("splash");
    // LLM credentials are user settings, not game data: the executable folder
    // (game files) may be read-only, so they live with the other shared settings.
    const llmDirectory = llmSettingsDirectory();
    // Settings once lived beside the executable. They are imported a single time, and never from the working directory.
    const legacyLlmDirectory = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/") ? dirname(process.execPath) : null;
    const migrationMarker = resolve(llmDirectory, ".legacy-migrated");
    if (legacyLlmDirectory !== null && legacyLlmDirectory !== llmDirectory && !existsSync(migrationMarker)) {
      try {
        mkdirSync(llmDirectory, { recursive: true });
        for (const name of ["llm.json", "chatgpt.key", "other.key", "other.service"]) {
          const source = resolve(legacyLlmDirectory, name), destination = resolve(llmDirectory, name);
          try { copyFileSync(source, destination, constants.COPYFILE_EXCL); chmodSync(destination, 0o600); unlinkSync(source); } catch { /* Missing legacy file, already migrated, or a read-only folder. */ }
        }
        writeFileSync(migrationMarker, "", { mode: 0o600 });
      } catch { /* The settings service reports save failures with context. */ }
    }
    const llm = command.kind !== "menu" && command.options.dedicated ? undefined : await LlmSettingsService.open({
      auth: { openBrowser: async (url, signal) => {
        if (signal.aborted) return;
        const { openSdlUrl } = await import("./platform/sdl.ts");
        if (!signal.aborted) openSdlUrl(url);
      } },
      baseDirectory: llmDirectory,
    });
    startupStamp("llm-settings");
    try {
      const host = { ...(llm === undefined ? {} : { llm }), print: (text: string): undefined => { recentOutput.push(text); process.stdout.write(text); return undefined; } };
      const application = command.options.dedicated
        ? await (await import("./app/bootstrap/application.ts")).openApplication(command.options, host)
        : await (await import("./app/bootstrap/startup.ts")).StartupApplication.open(command.options, host, undefined, command.kind);
      splash?.close(); splash = null;
      const stop = (): void => { application.requestQuit(); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      let failed = false;
      try { await application.run(); }
      catch (error) { failed = true; throw error; }
      finally {
        process.off("SIGINT", stop); process.off("SIGTERM", stop);
        // A close failure after a fatal error is reported without replacing that error (APP-006).
        try { await application.close(); }
        catch (closeError) { if (!failed) throw closeError; process.stderr.write(`Shutdown after failure also failed: ${describeFailure(closeError)}\n`); }
      }
      return 0;
    } finally { await llm?.close(); }
  } catch (error) {
    splash?.close();
    writeCrashLog(error, argv);
    process.stderr.write(`${describeFailure(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
