import { dirname } from "node:path";
import { LlmSettingsService } from "./llm/settings.ts";
import { applicationHelp, parseApplicationCommand } from "./app/bootstrap/options.ts";

export async function main(argv: readonly string[] = Bun.argv.slice(2)): Promise<number> {
  try {
    const command = parseApplicationCommand(argv);
    if (command.kind === "help") { process.stdout.write(applicationHelp); return 0; }
    if (command.kind === "list-content") {
      const { discoverInstalledContent } = await import("./content/catalog/index.ts");
      const catalog = await discoverInstalledContent({ corpusRoot: command.corpusRoot });
      for (const product of catalog.products) process.stdout.write(`${product.expectation.id}\t${product.availability.kind}\t${product.expectation.title}\n`);
      return 0;
    }
    const llm = command.kind !== "menu" && command.options.dedicated ? undefined : await LlmSettingsService.open({
      auth: { openBrowser: async (url, signal) => {
        if (signal.aborted) return;
        const { openSdlUrl } = await import("./platform/sdl.ts");
        if (!signal.aborted) openSdlUrl(url);
      } },
      baseDirectory: Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/") ? dirname(process.execPath) : process.cwd(),
    });
    try {
      const host = { ...(llm === undefined ? {} : { llm }), print: (text: string): undefined => { process.stdout.write(text); return undefined; } };
      const application = command.kind === "menu"
        ? await (await import("./app/bootstrap/startup.ts")).StartupApplication.open(command.options, host)
        : (command.options.network.kind === "qw-client" || command.options.network.kind === "q1-client" || command.options.network.kind === "q2-client" || command.options.network.kind === "q3-client")
        ? await (await import("./app/bootstrap/remote-application.ts")).RemoteApplication.open(command.options, host)
        : await (await import("./app/bootstrap/application.ts")).openApplication(command.options, host);
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
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main();
