import type { CommandContext } from "../../contracts/common.ts";
import type { CommandBuffer, CommandHandler, CommandInvocation } from "../../core/commands/index.ts";
import { demoFamily, type DemoFamily, type DemoRequest } from "./demo-playback.ts";

export type DemoClientState =
  | { readonly kind: "idle"; readonly family: DemoFamily; readonly explicitStartup: boolean }
  | { readonly kind: "local" | "network"; readonly family: DemoFamily }
  | { readonly kind: "demo"; readonly family: DemoFamily; readonly request: DemoRequest };
export type ClientDemoIntent =
  | { readonly kind: "start"; readonly request: DemoRequest; readonly source: CommandContext }
  | { readonly kind: "stop"; readonly source: CommandContext };
export type DemoCompletion = "eof" | "terminator" | "disconnected" | "truncated" | "closed";
export interface ClientDemoCommandHost {
  readonly dedicated: boolean;
  current(): DemoClientState;
  stage(intent: ClientDemoIntent): void;
  print(text: string): void;
  append(text: string, source: CommandContext): void;
  /** Read and clear nextdemo/nextserver before returning its text. */
  takeCompletionCommand(family: "q2" | "q3"): string;
}

function local(command: CommandInvocation): boolean {
  let origin = command.source.origin;
  while (origin.kind === "script") origin = origin.caller;
  return origin.kind !== "remote-client";
}

/** A client retains its attract list across world/source replacement. */
export class ClientDemoCommands {
  private names: readonly string[] = [];
  private next = 0;
  private cycleSource: CommandContext | null = null;
  private latestRequest: DemoRequest | null = null;
  private readonly completed = new WeakSet<DemoRequest>();
  private readonly sources = new WeakMap<DemoRequest, CommandContext>();
  private readonly bindings = new Set<{ readonly refresh: () => void; readonly release: () => void }>();
  constructor(private readonly host: ClientDemoCommandHost) {}

  attach(commands: CommandBuffer): () => void {
    const owned = new Map<string, CommandHandler>();
    const add = (name: string, handler: CommandHandler, summary: string, usage: string): void => {
      const guarded: CommandHandler = command => {
        if (!local(command)) { this.host.print(`${name} is a local client command.\n`); return; }
        handler(command);
      };
      const examples = [usage.replace("<name>", "demo1").replace("[name ...]", "demo1 demo2 demo3")];
      if (commands.register(name, guarded, { summary, usage, examples })) owned.set(name, guarded);
      else this.host.print(`Demo command ${name} is already owned by another command.\n`);
    };
    add("playdemo", command => { this.play(command); }, "Play a recording; its file extension selects the game.", "playdemo <name>");
    add("demo", command => { this.play(command, "q3"); }, "Play a Quake III recording.", "demo <name>");
    add("demomap", command => { this.play(command, "q2"); }, "Play a Quake II recording.", "demomap <name>");
    add("startdemos", command => { this.startDemos(command); }, "Set the Quake attract-mode recording list.", "startdemos [name ...]");
    add("demos", command => {
      if (this.host.dedicated) return;
      if (this.next < 0) this.next = 1;
      this.cycleSource = command.source;
      this.nextDemo();
    }, "Resume the saved Quake attract list.", "demos");
    add("stopdemo", command => {
      if (this.host.dedicated || this.host.current().kind !== "demo") return;
      this.next = -1;
      this.latestRequest = null;
      this.host.stage({ kind: "stop", source: command.source });
    }, "Stop the active recording and return to the menu.", "stopdemo");
    const binding = {
      refresh: (): void => {
        const family = this.host.current().family;
        if (family === "q1" || family === "qw") {
          if (!owned.has("timedemo")) add("timedemo", command => { this.play(command, undefined, true); }, "Benchmark a Quake recording.", "timedemo <name>");
        } else {
          const handler = owned.get("timedemo");
          if (handler !== undefined) { commands.unregister("timedemo", handler); owned.delete("timedemo"); }
        }
      },
      release: (): void => { for (const [name, handler] of owned) commands.unregister(name, handler); owned.clear(); this.bindings.delete(binding); },
    };
    this.bindings.add(binding);
    binding.refresh();
    return binding.release;
  }

  /** Call at the published world/profile boundary, after cvar routing is adopted. */
  refresh(): void { for (const binding of this.bindings) binding.refresh(); }

  private play(command: CommandInvocation, selected?: DemoFamily, timedemo = false): void {
    if (this.host.dedicated && selected !== "q2") return;
    const name = command.args[0];
    if (command.args.length !== 1 || name === undefined) { this.host.print(`Usage: ${command.argv[0]} <name>\n`); return; }
    this.next = -1;
    const family = selected ?? demoFamily(name, this.host.current().family);
    this.start({ family, name, timedemo }, command.source);
  }

  private start(request: DemoRequest, source: CommandContext): void {
    this.latestRequest = request;
    this.sources.set(request, source);
    this.host.stage({ kind: "start", request, source });
  }

  private startDemos(command: CommandInvocation): void {
    const current = this.host.current();
    if (this.host.dedicated) {
      if (current.kind === "idle" && !current.explicitStartup) this.host.append("map start\n", command.source);
      return;
    }
    if (command.args.length > 8) this.host.print("Max 8 demos in demoloop\n");
    this.names = command.args.slice(0, 8).map(name => name.slice(0, 15));
    this.host.print(`${this.names.length} demo(s) in loop\n`);
    this.cycleSource = command.source;
    if (current.kind === "idle" && !current.explicitStartup && this.next !== -1) {
      this.next = 0;
      this.nextDemo();
    } else this.next = -1;
  }

  private nextDemo(): void {
    const source = this.cycleSource;
    if (this.next < 0 || source === null) return;
    if (this.next >= this.names.length || this.names[this.next] === "") this.next = 0;
    const name = this.names[this.next];
    if (name === undefined || name === "") {
      this.next = -1; this.host.print("No demos listed with startdemos\n"); return;
    }
    this.next++;
    this.start({ family: demoFamily(name, "q1"), name, timedemo: false }, source);
  }

  /** Completion applies only to the published source, once, including callback reentry. */
  complete(request: DemoRequest, reason: DemoCompletion): void {
    const current = this.host.current();
    if (current.kind !== "demo" || current.request !== request || this.latestRequest !== request || this.completed.has(request)) return;
    this.completed.add(request);
    if (reason === "closed" || reason === "truncated") { this.next = -1; return; }
    if (request.family === "q1" || request.family === "qw") {
      this.nextDemo();
      return;
    }
    if (reason === "disconnected") return;
    const text = this.host.takeCompletionCommand(request.family);
    const source = this.sources.get(request);
    if (text.length > 0 && source !== undefined) this.host.append(`${text}\n`, source);
  }

  failed(request: DemoRequest): void {
    this.completed.add(request);
    if (this.latestRequest === request) this.next = -1;
  }

  manualGame(): void { this.next = -1; this.latestRequest = null; }
}
