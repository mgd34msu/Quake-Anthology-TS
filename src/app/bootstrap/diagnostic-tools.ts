import type { CommandBuffer } from "../../core/commands/index.ts";
import { OmniTimer } from "../../core/omnitimer.ts";
export interface DiagnosticToolServices {
  readonly commands: CommandBuffer;
  readonly timer: OmniTimer;
  print(text: string): void;
}
/** Registers reports over actual application timing; no fabricated subsystem counters. */
export function registerDiagnosticTools(services: DiagnosticToolServices): () => void {
  const handlers = new Map<string, Parameters<CommandBuffer["register"]>[1]>();
  const add = (name: string, run: (args: readonly string[]) => void): void => {
    if (services.commands.exists(name)) throw new Error(`Diagnostic command already registered: ${name}`);
    const handler: Parameters<CommandBuffer["register"]>[1] = invocation => { run(invocation.args); return undefined; };
    services.commands.register(name, handler, { summary: "Inspect application profiler timings.", usage: name === "timers" ? "timers [on|off|reset|report|stamps]" : "timerstamp <label>", examples: [] }); handlers.set(name, handler);
  };
  add("timers", args => {
    const action = args[0] ?? "report";
    if (action === "on" || action === "off") services.timer.setEnabled(action === "on");
    else if (action === "reset") services.timer.reset();
    else if (action === "report") services.print(services.timer.format());
    else if (action === "stamps") services.print("milliseconds\tname\n" + services.timer.stampList().map(stamp => `${stamp.milliseconds.toFixed(3)}\t${stamp.name}`).join("\n") + "\n");
    else throw new Error("Usage: timers [on|off|reset|report|stamps]");
  });
  add("timerstamp", args => { const label = args.join(" "); if (label === "") throw new Error("Usage: timerstamp <label>"); services.timer.stamp(label); });
  return () => { for (const [name, handler] of handlers) services.commands.unregister(name, handler); handlers.clear(); };
}

/** CL_Frame's cl_avidemo clock, shared by every renderer and screenshot format. */
export function sourceCaptureFrame(elapsed: number, options: { readonly fps: number; readonly timescale: number; readonly active: boolean; readonly force: boolean }): { readonly milliseconds: number; readonly capture: boolean } {
  if (![elapsed, options.fps, options.timescale].every(Number.isFinite) || elapsed < 0 || options.fps < 0 || options.timescale < 0) throw new RangeError("Invalid capture clock");
  const fps = Math.trunc(options.fps);
  if (fps === 0 || elapsed === 0) return { milliseconds: elapsed, capture: false };
  return { milliseconds: Math.max(1, Math.trunc(Math.fround(Math.trunc(1000 / fps) * Math.fround(options.timescale)))), capture: options.active || options.force };
}

export interface RuntimeDiagnosticServices {
  readonly commands: CommandBuffer;
  mounts(): import("../../content/mounts/index.ts").MountedContent;
  frame(): { readonly frame: number; readonly milliseconds: number; readonly map: string; readonly renderer: string; readonly clients: number };
  print(text: string): void;
  /** Application afterDispatch awaits this operation before consuming the command tail. */
  queue(operation: Promise<void>): void;
}
/** Host measurements replace allocator-specific C counters; resource queries use the active mount owner. */
export function registerRuntimeDiagnostics(services: RuntimeDiagnosticServices): () => void {
  const handlers = new Map<string, Parameters<CommandBuffer["register"]>[1]>();
  const add = (name: string, summary: string, usage: string, run: (args: readonly string[]) => void): void => {
    if (services.commands.exists(name)) throw new Error(`Diagnostic command already registered: ${name}`);
    const handler: Parameters<CommandBuffer["register"]>[1] = invocation => { run(invocation.args); return undefined; };
    services.commands.register(name, handler, { summary, usage, examples: [] }); handlers.set(name, handler);
  };
  add("meminfo", "Report the actual host process memory in bytes.", "meminfo", () => {
    const memory = process.memoryUsage();
    services.print(`Host process bytes: rss=${memory.rss} heapTotal=${memory.heapTotal} heapUsed=${memory.heapUsed} external=${memory.external} arrayBuffers=${memory.arrayBuffers}\n`);
  });
  add("path", "Show active filesystem search order and overrides.", "path", () => {
    const mounts = services.mounts(); mounts.assertOpen();
    const describe = (id: (typeof mounts.plan.defaultOrder)[number]): string => {
      const mount = mounts.plan.mounts.find(item => item.identity.id === id);
      if (mount === undefined) throw new Error(`Missing active mount ${id}`);
      return `${id} ${mount.kind === "archive" ? mount.archivePath : mount.rootPath}`;
    };
    services.print(mounts.plan.defaultOrder.map(describe).join("\n") + "\n");
    for (const order of mounts.plan.prefixOrders) services.print(`${order.prefix}:\n${order.mounts.map(describe).join("\n")}\n`);
  });
  add("dir", "List files through the active mounted resource owner.", "dir [path] [extension]", args => {
    const owner = services.mounts();
    services.queue(owner.listFiles(args[0] === "." ? "" : args[0] ?? "", args[1] ?? "").then(files => { services.print(files.join("\n") + `\n${files.length} files\n`); }));
  });
  add("touchFile", "Open a file through the active filesystem and record its actual reference.", "touchFile <file>", args => {
    const path = args[0]; if (args.length !== 1 || path === undefined) throw new Error("Usage: touchFile <file>");
    services.queue(services.mounts().open(path).then(() => undefined));
  });
  add("resourceinfo", "Report resources actually opened by the active filesystem.", "resourceinfo", () => {
    const owner = services.mounts(); owner.assertOpen();
    services.print(JSON.stringify(owner.openedResources, null, 2) + "\n");
  });
  add("frameinfo", "Report current application frame and source state.", "frameinfo", () => {
    services.print(JSON.stringify(services.frame(), null, 2) + "\n");
  });
  return () => { for (const [name, handler] of handlers) services.commands.unregister(name, handler); handlers.clear(); };
}
