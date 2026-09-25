import type { SeatId } from "../contracts/identity.ts";
import type { CommandBuffer, CommandInvocation } from "../core/commands/index.ts";
import type { SeatConsole } from "./session.ts";
import type { ConfigStore } from "../settings/config.ts";
import type { FrameCapture } from "../capture/index.ts";
import { isQ2 } from "../core/commands/text.ts";
import type { CommandContext } from "../contracts/common.ts";

export type ConfigurationWriteResult = { readonly kind: "written" } | { readonly kind: "failed"; readonly error: unknown };
export type ConfigurationWriteStarted = (source: CommandContext, path: string) => ((result: ConfigurationWriteResult) => void) | undefined;

export interface ConsoleCommandServices {
  readonly commands: CommandBuffer;
  readonly config: (seat: SeatId) => ConfigStore;
  readonly configuration: (invocation: CommandInvocation) => string;
  readonly configurationWriteStarted?: ConfigurationWriteStarted;
  readonly console: (seat: SeatId) => SeatConsole | null;
  readonly canChat: () => boolean;
  readonly capture: (seat: SeatId) => FrameCapture | null;
  readonly mapName: () => string;
  readonly print: (text: string) => void;
  /** Host drains work after renderer completion and before retiring resource owners. */
  readonly queue: (operation: () => Promise<void>, frameReadback?: boolean) => void;
}
export function registerConsoleCommands(services: ConsoleCommandServices): () => void {
  const names: string[] = [];
  const seat = (invocation: CommandInvocation): SeatId | null => {
    let origin = invocation.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    return origin.kind === "local-seat" ? origin.seat : null;
  };
  const add = (name: string, handler: (invocation: CommandInvocation) => undefined, documentation?: Parameters<CommandBuffer["register"]>[2]): void => {
    if (!services.commands.exists(name) && services.commands.registerEngine(name, handler, documentation)) names.push(name);
  };
  add("toggleconsole", invocation => { const id = seat(invocation); if (id !== null) services.console(id)?.toggle(); });
  add("clear", invocation => { const id = seat(invocation); if (id !== null) services.console(id)?.buffer.clear(); }, { summary: "Clear the invoking seat's console output.", usage: "clear", examples: ["clear"] });
  for (const name of ["messagemode", "messagemode2"]) add(name, invocation => {
    const id = seat(invocation);
    if (!services.canChat()) { services.print("Chat requires an active connection.\n"); return; }
    if (id !== null) services.console(id)?.message(name === "messagemode2");
  });
  add("condump", invocation => {
    const id = seat(invocation), name = invocation.argv[1], console = id === null ? null : services.console(id);
    if (name === undefined || console === null || id === null || invocation.argv.length !== 2) { services.print("condump <filename>\n"); return; }
    const path = isQ2(invocation.dialect) && !name.endsWith(".txt") ? `${name}.txt` : name;
    const contents = console.buffer.dump(), store = services.config(id);
    services.queue(async () => { await store.dump(path, contents); services.print(`Dumped console text to ${path}\n`); });
  }, { summary: "Write the invoking seat's console output to a file.", usage: "condump <filename>", examples: ["condump console.txt"] });
  add("writeconfig", invocation => {
    const id = seat(invocation);
    if (id === null || services.console(id) === null) { services.print("writeconfig requires an active local seat\n"); return; }
    const name = invocation.argv[1] ?? "config.cfg", path = name.endsWith(".cfg") ? name : `${name}.cfg`;
    const notify = services.configurationWriteStarted?.(invocation.source, path);
    let completed = false;
    const complete = (result: ConfigurationWriteResult): void => { if (completed) return; completed = true; notify?.(result); };
    try {
      const contents = services.configuration(invocation), store = services.config(id);
      services.queue(async () => {
        try { await store.dump(path, contents); }
        catch (error) { complete({ kind: "failed", error }); throw error; }
        services.print(`Wrote ${path}\n`); complete({ kind: "written" });
      });
    } catch (error) { complete({ kind: "failed", error }); throw error; }
  }, { summary: "Save the invoking seat's configuration.", usage: "writeconfig [filename]", examples: ["writeconfig config.cfg"] });
  for (const [name, format] of [["screenshot", "tga"], ["screenshotJPEG", "jpg"], ["screenshotPNG", "png"]] satisfies readonly (readonly [string, "tga" | "jpg" | "png"])[]) {
    add(name, invocation => {
      const id = seat(invocation), capture = id === null ? null : services.capture(id), argument = invocation.argv[1];
      if (capture === null) { services.print("Screenshot requires an active seat renderer\n"); return; }
      const map = services.mapName();
      services.queue(async () => {
        const result = argument === "levelshot" ? await capture.levelshot(map)
          : await capture.screenshot(argument === undefined || argument === "silent" ? { format } : { format, name: argument });
        if (argument !== "silent") services.print(`Wrote ${result.path}\n`);
      }, true);
    });
  }
  add("levelshot", invocation => {
    if (invocation.dialect === "q3") return services.commands.forwardToServer(invocation);
    const id = seat(invocation), capture = id === null ? null : services.capture(id), map = services.mapName();
    if (capture !== null) services.queue(async () => { const result = await capture.levelshot(map); services.print(`Wrote ${result.path}\n`); }, true);
  });
  return () => { for (const name of names) services.commands.unregister(name); };
}
