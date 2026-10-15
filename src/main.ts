import { appendFileSync, constants, copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { version } from "../package.json";
import { LlmSettingsService } from "./llm/settings.ts";
import { applicationHelp, parseApplicationCommand } from "./app/bootstrap/options.ts";
import { defaultUserContentRoot } from "./content/user-data.ts";
import { BoundedQueue } from "./foundation/bounded-queue.ts";
import { openSplash, type SplashScreen } from "./app/bootstrap/splash.ts";

/** Recent console output retained so a fatal error leaves a diagnosable log on disk. */
const recentOutput = new BoundedQueue<string>(256);
export function writeCrashLog(error: unknown, argv: readonly string[], directory: string = dirname(defaultUserContentRoot())): void {
  try {
    mkdirSync(directory, { recursive: true });
    let tail = "";
    recentOutput.forEach(chunk => { tail += chunk; });
    if (tail.length > 32768) tail = tail.slice(-32768);
    appendFileSync(resolve(directory, "crash.log"),
      `\n=== Quake Anthology ${version} crash ${new Date().toISOString()} argv=${JSON.stringify(argv)}\n`
      + `${error instanceof Error ? error.stack ?? error.message : String(error)}\n--- recent output ---\n${tail}\n`);
  } catch { /* The stderr report below is the fallback. */ }
}

/** LLM credentials live with the other shared user settings, never beside the executable. */
export function llmSettingsDirectory(): string { return resolve(dirname(defaultUserContentRoot()), "settings"); }

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  let splash: SplashScreen | null = null;
  process.on("unhandledRejection", error => { writeCrashLog(error, argv); process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(1); });
  process.on("uncaughtException", error => { writeCrashLog(error, argv); process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(1); });
  try {
    const command = parseApplicationCommand(argv);
    if (command.kind === "version") { process.stdout.write(`Quake Anthology ${version}\n`); return 0; }
    if (command.kind === "help") { process.stdout.write(applicationHelp); return 0; }
    if (command.kind === "weapon-behavior") {
      await (await import("./app/bootstrap/weapon-behavior-tool.ts")).runWeaponBehaviorTool(command.command, text => { process.stdout.write(text); });
      return 0;
    }
    if (command.kind === "list-content") {
      const { discoverInstalledContent } = await import("./content/catalog/index.ts");
      const catalog = await discoverInstalledContent({ corpusRoot: command.corpusRoot });
      for (const product of catalog.products) process.stdout.write(`${product.expectation.id}\t${product.availability.kind}\t${product.expectation.title}\n`);
      return 0;
    }
    splash = command.options.dedicated || command.options.hidden ? null : await openSplash(command.options.width, command.options.height);
    // LLM credentials are user settings, not game data: the executable folder
    // (game files) may be read-only, so they live with the other shared settings.
    const llmDirectory = llmSettingsDirectory();
    const legacyLlmDirectory = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/") ? dirname(process.execPath) : process.cwd();
    if (legacyLlmDirectory !== llmDirectory) {
      try {
        mkdirSync(llmDirectory, { recursive: true });
        for (const name of ["llm.json", "chatgpt.key", "other.key", "other.service"]) {
          try { copyFileSync(resolve(legacyLlmDirectory, name), resolve(llmDirectory, name), constants.COPYFILE_EXCL); } catch { /* Missing legacy file or already migrated. */ }
        }
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
    try {
      const host = { ...(llm === undefined ? {} : { llm }), print: (text: string): undefined => { recentOutput.push(text); process.stdout.write(text); return undefined; } };
      const application = command.options.dedicated
        ? await (await import("./app/bootstrap/application.ts")).openApplication(command.options, host)
        : await (await import("./app/bootstrap/startup.ts")).StartupApplication.open(command.options, host, undefined, command.kind);
      splash?.close(); splash = null;
      const stop = (): void => { application.requestQuit(); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      try { await application.run(); }
      finally {
        process.off("SIGINT", stop); process.off("SIGTERM", stop);
        await application.close();
      }
      return 0;
    } finally { await llm?.close(); }
  } catch (error) {
    splash?.close();
    writeCrashLog(error, argv);
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
