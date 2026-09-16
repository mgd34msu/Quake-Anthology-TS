import { expect, test } from "bun:test";
import { ClientDemoCommands, type ClientDemoIntent, type DemoClientState } from "../../src/app/bootstrap/demo-commands.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";

function fixture(initial: DemoClientState = { kind: "idle", family: "q1", explicitStartup: false }, dedicated = false) {
  const identity = createIdentityOwner("demo command test");
  const context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
  let state = initial, completion = "";
  const staged: ClientDemoIntent[] = [], printed: string[] = [], appended: { readonly text: string; readonly source: CommandContext }[] = [];
  const service = new ClientDemoCommands({ dedicated, current: () => state, stage: intent => { staged.push(intent); }, print: text => { printed.push(text); },
    append: (text, source) => { appended.push({ text, source }); }, takeCompletionCommand: () => { const result = completion; completion = ""; return result; } });
  const cvars = new CvarRegistry({ dialect: "q3", context });
  cvars.register("timedemo", "0");
  const commands = new CommandBuffer({ dialect: "q3", context, cvars, print: text => { printed.push(text); } });
  const release = service.attach(commands);
  const publishLast = (): Extract<ClientDemoIntent, { readonly kind: "start" }> => {
    const intent = staged.at(-1);
    if (intent?.kind !== "start") throw new Error("Expected demo start");
    state = { kind: "demo", family: intent.request.family, request: intent.request }; service.refresh(); return intent;
  };
  return { service, commands, staged, printed, appended, context, identity, cvars, release, publishLast,
    state: (next: DemoClientState) => { state = next; service.refresh(); }, nextCommand: (text: string) => { completion = text; }, remainingCommand: () => completion };
}

test("attract playlist wraps once per completed published recording", () => {
  const f = fixture();
  f.commands.executeNow("startdemos demo1 demo2");
  const first = f.publishLast(); expect(first.request.name).toBe("demo1");
  f.service.complete(first.request, "disconnected");
  f.service.complete(first.request, "disconnected");
  expect(f.staged).toHaveLength(2);
  const second = f.publishLast(); expect(second.request.name).toBe("demo2");
  f.service.complete(second.request, "eof"); expect(f.publishLast().request.name).toBe("demo1");
});

test("manual startup wins quake.rc attract list, which remains available through demos", () => {
  const f = fixture({ kind: "idle", family: "q1", explicitStartup: true });
  const script: CommandContext = { ...f.context, origin: { kind: "script", name: "quake.rc", caller: f.context.origin } };
  f.commands.executeNow("startdemos demo1 demo2 demo3", script);
  expect(f.staged).toHaveLength(0);
  f.state({ kind: "local", family: "q1" });
  f.commands.executeNow("demos"); expect(f.publishLast().request.name).toBe("demo2");
  f.commands.executeNow("stopdemo"); expect(f.staged.at(-1)?.kind).toBe("stop");
});

test("new manual intent wins stale completion and failure, with no failed-playlist retry loop", () => {
  const f = fixture();
  f.commands.executeNow("startdemos demo1 demo2"); const old = f.publishLast();
  f.commands.executeNow("playdemo explicit.dem");
  f.service.complete(old.request, "eof"); f.service.failed(old.request);
  expect(f.staged).toHaveLength(2); expect(f.publishLast().request.name).toBe("explicit.dem");
  f.state({ kind: "idle", family: "q1", explicitStartup: false });
  f.commands.executeNow("demos"); const failed = f.publishLast();
  f.service.failed(failed.request); f.service.complete(failed.request, "eof"); expect(f.staged).toHaveLength(3);
});

test("dedicated attract fallback preserves an explicit pending server launch", () => {
  const explicit = fixture({ kind: "idle", family: "q1", explicitStartup: true }, true);
  explicit.commands.executeNow("startdemos demo1"); expect(explicit.appended).toHaveLength(0);
  const automatic = fixture({ kind: "idle", family: "q1", explicitStartup: false }, true);
  automatic.commands.executeNow("startdemos demo1"); expect(automatic.appended.map(command => command.text)).toEqual(["map start\n"]);
  automatic.state({ kind: "local", family: "q1" }); automatic.commands.executeNow("startdemos demo1");
  expect(automatic.appended).toHaveLength(1); expect(automatic.staged).toHaveLength(0);
});

test("timedemo routes to Q1 command or Q2/Q3 cvar from current world family", () => {
  const f = fixture();
  f.commands.executeNow("timedemo benchmark.qwd");
  expect(f.publishLast().request).toEqual({ family: "qw", name: "benchmark.qwd", timedemo: true });
  for (const family of ["q2", "q3"] satisfies readonly ("q2" | "q3")[]) {
    f.state({ kind: "local", family });
    expect(f.commands.exists("timedemo")).toBe(false);
    f.commands.executeNow("timedemo 1"); expect(f.cvars.variableString("timedemo")).toBe("1");
  }
  f.state({ kind: "local", family: "q1" }); expect(f.commands.exists("timedemo")).toBe(true);
});

test("nextdemo clears before execution and recorded Q2 disconnect does not run nextserver", () => {
  const f = fixture({ kind: "local", family: "q3" });
  f.commands.executeNow("demo demo1"); const q3 = f.publishLast();
  f.nextCommand("demo demo2"); f.service.complete(q3.request, "terminator"); f.service.complete(q3.request, "eof");
  expect(f.remainingCommand()).toBe(""); expect(f.appended).toEqual([{ text: "demo demo2\n", source: q3.source }]);
  f.commands.executeNow("demomap demo1"); const q2 = f.publishLast();
  f.nextCommand("demomap demo2"); f.service.complete(q2.request, "disconnected");
  expect(f.remainingCommand()).toBe("demomap demo2"); expect(f.appended).toHaveLength(1);
  f.commands.executeNow("demomap demo1"); const normal = f.publishLast();
  f.service.complete(normal.request, "eof"); expect(f.remainingCommand()).toBe(""); expect(f.appended).toHaveLength(2);
});

test("remote provenance cannot change playback, and release preserves replacement handlers", () => {
  const f = fixture();
  const remote: CommandContext = { ...f.context, origin: { kind: "script", name: "remote.cfg", caller: { kind: "remote-client", client: f.identity.client(1, 0) } } };
  f.commands.executeNow("playdemo demo1", remote); expect(f.staged).toHaveLength(0);
  expect(f.printed.at(-1)).toContain("local client command");
  f.commands.unregister("playdemo"); let replacement = 0;
  f.commands.register("playdemo", () => { replacement++; }); f.release(); f.commands.executeNow("playdemo demo1");
  expect(replacement).toBe(1); expect(f.commands.exists("startdemos")).toBe(false);
});
