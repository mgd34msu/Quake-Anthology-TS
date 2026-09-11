import type { SeatId } from "../contracts/identity.ts";
import type { CommandBuffer, CommandInvocation } from "../core/commands/index.ts";
import type { SeatConsole } from "./session.ts";
import type { ConfigStore } from "../settings/config.ts";
import type { FrameCapture } from "../capture/index.ts";
import type { CvarRegistry } from "../core/cvars/index.ts";

export interface ConsoleCommandServices {
  readonly commands: CommandBuffer;
  readonly cvars: CvarRegistry;
  readonly config: ConfigStore;
  readonly console: (seat: SeatId) => SeatConsole | null;
  readonly capture: (seat: SeatId) => FrameCapture | null;
  readonly mapName: () => string;
  readonly print: (text: string) => void;
  /** Host drains work after renderer completion and before retiring resource owners. */
  readonly queue: (operation: () => Promise<void>) => void;
}
export function registerConsoleCommands(services: ConsoleCommandServices): () => void {
  const names: string[] = [];
  const seat = (invocation: CommandInvocation): SeatId | null => {
    let origin = invocation.source.origin;
    while (origin.kind === "script") origin = origin.caller;
    return origin.kind === "local-seat" ? origin.seat : null;
  };
  const add = (name: string, handler: (invocation: CommandInvocation) => undefined): void => {
    if (services.commands.register(name, handler)) names.push(name);
  };
  add("toggleconsole", invocation => { const id = seat(invocation); if (id !== null) services.console(id)?.toggle(); });
  add("clear", invocation => { const id = seat(invocation); if (id !== null) services.console(id)?.buffer.clear(); });
  add("messagemode", invocation => { const id = seat(invocation); if (id !== null) services.console(id)?.message(false); });
  add("messagemode2", invocation => { const id = seat(invocation); if (id !== null) services.console(id)?.message(true); });
  add("condump", invocation => {
    const id = seat(invocation), name = invocation.argv[1], console = id === null ? null : services.console(id);
    if (name === undefined || console === null) { services.print("condump <filename>\n"); return; }
    const contents = console.buffer.dump(); services.queue(() => services.config.dump(name, contents));
  });
  add("writeconfig", invocation => {
    const name = invocation.argv[1] ?? "config.cfg";
    services.queue(() => services.config.saveCvars(name, services.cvars));
  });
  for (const [name, format] of [["screenshot", "tga"], ["screenshotJPEG", "jpg"], ["screenshotPNG", "png"]] satisfies readonly (readonly [string, "tga" | "jpg" | "png"])[]) {
    add(name, invocation => {
      const id = seat(invocation), capture = id === null ? null : services.capture(id), argument = invocation.argv[1];
      if (capture === null) { services.print("Screenshot requires an active seat renderer\n"); return; }
      services.queue(async () => {
        const result = await capture.screenshot(argument === undefined || argument === "silent" ? { format } : { format, name: argument });
        if (argument !== "silent") services.print(`Wrote ${result.path}\n`);
      });
    });
  }
  add("levelshot", invocation => {
    const id = seat(invocation), capture = id === null ? null : services.capture(id), map = services.mapName();
    if (capture !== null) services.queue(async () => { const result = await capture.levelshot(map); services.print(`Wrote ${result.path}\n`); });
  });
  return () => { for (const name of names) services.commands.unregister(name); };
}
