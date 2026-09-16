import { expect, test } from "bun:test";
import { PreparedStartup } from "../../src/app/bootstrap/prepared-startup.ts";
import { ConsoleScriptFiles } from "../../src/app/bootstrap/config-scripts.ts";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { MouseSettings } from "../../src/input/mouse-settings.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { QvmUiImport } from "../../src/compat/qvm/abi.ts";
import { qvmCommonSyscall, type QvmCommonServices } from "../../src/compat/qvm/common-syscalls.ts";
import { QvmMemory } from "../../src/compat/qvm/memory.ts";
import { qvmClientInputSyscall } from "../../src/app/bootstrap/q3-client/qvm-scalars.ts";
import type { QvmHostCall } from "../../src/compat/qvm/syscalls.ts";

function fixture(dialect: CommandDialect = "q1-netquake", movementDialect: CommandDialect = dialect) {
  const identity = createIdentityOwner("prepared-client-candidate");
  const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
  const live = new CvarRegistry({ dialect, context }); live.register("marker", "old");
  const shared = new CvarRegistry({ dialect, context }); shared.register("r_gamma", "1"); shared.register("volume", "0.5");
  const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
  const output: string[] = [];
  const movement = movementDialect === dialect ? live : new CvarRegistry({ dialect: movementDialect, context });
  const prepared = new PreparedStartup(live, movement, scripts, { dialect, movementDialect, shared, sharedNames: [],
    seats: [{ context, id: identity.seat(0), cvars: live, mouse: new MouseSettings(live), profile: null, archive: [], mouseArchive: [] }],
    print: text => output.push(text), forward: () => undefined });
  const input = prepared.seats[0]?.input;
  if (input === undefined) throw new Error("Missing prepared seat");
  return { prepared, context, input, live, shared, output };
}

function candidate(f: ReturnType<typeof fixture>, dialect: CommandDialect = "q3") {
  const cvars = new CvarRegistry({ dialect, context: f.context }); cvars.register("marker", "candidate");
  const shared = new CvarRegistry({ dialect, context: f.context }); shared.register("r_gamma", "1"); shared.register("volume", "0.5");
  const routing = new ApplicationConsoleRouting({ fallback: cvars, sourceDialect: () => dialect, server: () => null,
    seat: () => cvars, input: () => cvars, shared: () => shared });
  const program = f.prepared.prepareClientCommands({ dialect, context: f.context, cvars, cvarRouting: routing,
    print: text => f.output.push(text) });
  return { program, cvars, shared, routing };
}

test("guest key traps and NOW bindings share candidate state without releasing the live seat", () => {
  const f = fixture();
  f.input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+probe; echo released" } });
  f.input.input({ kind: "key", seat: f.input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 10 });
  f.prepared.commands.execute();
  f.prepared.commands.append("echo original-tail\n", f.context);
  const pending = f.prepared.commands.pendingText, bindings = f.input.bindings;
  const next = candidate(f), staged = next.program.input(f.input.seat);
  if (staged === null) throw new Error("Missing candidate seat");
  const guest = new QvmMemory(new Uint8Array(2048));
  const call = (code: QvmUiImport, args: readonly number[]) => {
    const words = new DataView(new ArrayBuffer(4 * (args.length + 1))); words.setInt32(0, code, true);
    args.forEach((value, index) => words.setInt32(4 * (index + 1), value, true));
    const request: QvmHostCall = { kind: "engine", role: "ui", code, guest, words, memory: guest.bytes, commandArguments: null,
      invoke: () => { throw new Error("Unexpected invocation"); }, invokeAsync: async () => { throw new Error("Unexpected invocation"); } };
    return qvmClientInputSyscall(request, staged);
  };
  expect(call(QvmUiImport.UI_KEY_ISDOWN, [119])).toBe(1);
  guest.writeString(128, "echo guest binding", 128);
  expect(call(QvmUiImport.UI_KEY_SETBINDING, [119, 128])).toBe(0);
  next.program.commands.executeNow("bind w", f.context);
  expect(f.output.join("")).toContain("echo guest binding");
  next.program.commands.executeNow('bind w "echo console binding"', f.context);
  expect(call(QvmUiImport.UI_KEY_GETBINDINGBUF, [119, 512, 128])).toBe(0);
  expect(guest.readString(512)).toBe("echo console binding");
  expect(call(QvmUiImport.UI_KEY_CLEARSTATES, [])).toBe(0);
  expect(call(QvmUiImport.UI_KEY_ISDOWN, [119])).toBe(0);
  expect(f.input.isDown({ kind: "key", code: 119 })).toBe(true);
  expect(f.input.bindings).toEqual(bindings);
  expect(f.prepared.commands.pendingText).toBe(pending);
  next.program.validatePublication();
  next.program.releaseInputs(20); next.program.releaseInputs(20);
  next.program.publish();
  expect(f.input.isDown({ kind: "key", code: 119 })).toBe(false);
  expect(f.input.binding({ kind: "key", code: 119 })).toEqual({ kind: "command", text: "echo console binding" });
  expect(f.prepared.commands.pendingText.match(/-probe/g)).toHaveLength(1);
  expect(f.prepared.commands.pendingText).toContain("echo original-tail");
});

test("discarded client preparation preserves live held input, binding, cvars and pending program", () => {
  const f = fixture();
  f.input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+probe; echo original" } });
  f.input.input({ kind: "key", seat: f.input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 10 });
  f.input.commandButton("attack", "probe", true, 10);
  const before = f.prepared.commands.pendingText, bindings = f.input.bindings;
  const next = candidate(f);
  next.program.commands.executeNow("set marker changed", f.context);
  next.program.commands.executeNow("set r_gamma 2", f.context);
  next.program.commands.executeNow("set volume 0.1", f.context);
  next.program.commands.executeNow('bind w "echo replacement"', f.context);
  next.program.commands.insert("echo candidate\n", f.context);
  expect(next.cvars.variableString("marker")).toBe("changed");
  expect(next.shared.variableString("r_gamma")).toBe("2");
  expect(next.shared.variableString("volume")).toBe("0.1");
  expect(f.live.variableString("marker")).toBe("old");
  expect(f.shared.variableString("r_gamma")).toBe("1");
  expect(f.shared.variableString("volume")).toBe("0.5");
  expect(f.prepared.commands.pendingText).toBe(before);
  expect(f.input.bindings).toEqual(bindings);
  expect(f.input.hasHeldInput).toBe(true);
  expect(f.input.button("attack").active).toBe(true);
  expect(() => f.prepared.prepareClientCommands({ dialect: "q3", context: f.context, cvars: f.live })).toThrow("isolated cvar owners");
});

test("client publication keeps original release parsing and tail order on the same command/input owners", () => {
  const f = fixture(), commands = f.prepared.commands, input = f.input;
  const seen: { readonly argv: readonly string[]; readonly dialect: CommandDialect; readonly source: CommandContext }[] = [];
  commands.register("+probe", () => undefined);
  commands.register("-probe", command => { seen.push({ argv: command.argv, dialect: command.dialect, source: command.source }); });
  commands.register("probe", command => { seen.push({ argv: command.argv, dialect: command.dialect, source: command.source }); });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: '+probe; probe "quoted word" one/* comment */two // ignored' } });
  input.input({ kind: "key", seat: input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 10 });
  commands.execute(); seen.length = 0;
  commands.append("probe tail\n", f.context);
  const next = candidate(f);
  next.program.commands.insert("probe inserted\n", f.context);
  next.program.commands.append("probe appended\n", f.context);
  next.program.commands.executeNow('bind w "echo replacement"', f.context);
  next.program.validatePublication();
  input.release(20, next.program.releaseCommands);
  expect(input.hasHeldInput).toBe(false);
  expect(commands.pendingText).toBe("probe tail\n");
  next.program.validatePublication();
  f.prepared.adopt(next.routing, () => undefined, { source: next.cvars, movement: next.cvars, fallback: next.cvars,
    scripts: f.prepared.scripts, read: async () => undefined });
  next.program.publish();
  commands.execute();
  expect(seen.map(entry => entry.argv)).toEqual([
    ["probe", "inserted"], ["probe", "tail"], ["probe", "appended"], ["-probe", "119", "20"],
    ["probe", "quoted word", "one/*", "comment", "*/two"],
  ]);
  expect(seen.map(entry => entry.dialect)).toEqual(["q3", "q1-netquake", "q3", "q1-netquake", "q1-netquake"]);
  expect(seen[4]?.source.origin).toEqual({ kind: "script", name: "key-binding", caller: f.context.origin });
  expect(input.binding({ kind: "key", code: 119 })).toEqual({ kind: "command", text: "echo replacement" });
  expect(f.prepared.commands).toBe(commands); expect(f.prepared.seats[0]?.input).toBe(input);
  expect(() => next.program.publish()).toThrow("already published");
});

test("late binding or command changes invalidate preparation without changing the live owner", () => {
  const f = fixture(), next = candidate(f);
  f.input.bind({ input: { kind: "key", code: 120 }, target: { kind: "command", text: "echo late" } });
  expect(() => next.program.publish()).toThrow("bindings changed");
  const afterBinding = candidate(f);
  f.prepared.commands.append("echo late\n");
  expect(() => afterBinding.program.publish()).toThrow("changed during preparation");
  expect(f.input.binding({ kind: "key", code: 120 })).toEqual({ kind: "command", text: "echo late" });
  expect(f.prepared.commands.pendingText).toBe("echo late\n");
});

test("release sink retains source quote escaping when the destination parser differs", () => {
  const f = fixture(), calls: string[][] = [];
  f.prepared.commands.register("+probe", () => undefined);
  f.prepared.commands.register("-probe", () => undefined);
  f.prepared.commands.register("probe", command => { calls.push([...command.argv]); });
  f.input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: String.raw`+probe; probe "a\"b" tail` } });
  f.input.input({ kind: "key", seat: f.input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 1 });
  f.prepared.commands.execute();
  expect(calls).toEqual([["probe", "a\\", 'b"', "tail"]]);
  calls.length = 0;
  const next = candidate(f);
  f.input.release(2, next.program.releaseCommands);
  f.prepared.commands.setProfile("q3", next.cvars);
  next.program.publish(); f.prepared.commands.execute();
  expect(calls).toEqual([["probe", "a\\", 'b"', "tail"]]);
  calls.length = 0;
  f.prepared.commands.append(String.raw`probe "a\"b" tail` + "\n", f.context);
  f.prepared.commands.execute();
  expect(calls).toEqual([["probe", "a\\", "b", " tail"]]);
});

test("candidate UI syscall NOW changes only candidate cvars before returning and switches to published owner", () => {
  const f = fixture("q3"), next = candidate(f), guest = new QvmMemory(new Uint8Array(1024));
  let commandOwner = next.program.commands;
  const services: QvmCommonServices = { role: "ui", cvars: next.cvars, print: () => {}, milliseconds: () => 0, arguments: () => [],
    commands: { executeNow: text => { commandOwner.executeNow(text, f.context); },
      insert: text => commandOwner.insert(text, f.context), append: text => commandOwner.append(text, f.context) } };
  const invoke = (text: string): void => {
    guest.writeString(512, text, 256);
    const words = new DataView(new ArrayBuffer(12));
    words.setInt32(0, QvmUiImport.UI_CMD_EXECUTETEXT, true); words.setInt32(4, 0, true); words.setInt32(8, 512, true);
    expect(qvmCommonSyscall({ kind: "engine", role: "ui", code: QvmUiImport.UI_CMD_EXECUTETEXT, words,
      memory: guest.bytes, guest, commandArguments: null, invoke: () => { throw new Error("Unexpected VM reentry"); },
      invokeAsync: async () => { throw new Error("Unexpected VM reentry"); } }, services)).toBe(0);
  };
  invoke("set marker immediate");
  expect(next.cvars.variableString("marker")).toBe("immediate");
  expect(f.live.variableString("marker")).toBe("old");
  f.prepared.adopt(next.routing, () => undefined, { source: next.cvars, movement: next.cvars, fallback: next.cvars,
    scripts: f.prepared.scripts, read: async () => undefined });
  next.program.publish(); commandOwner = f.prepared.commands;
  invoke("set marker published");
  expect(next.cvars.variableString("marker")).toBe("published");
  expect(f.live.variableString("marker")).toBe("old");
});

test("candidate after-dispatch preserves asynchronous empty NOW rejection", async () => {
  const f = fixture("q3");
  let preparing = false;
  f.prepared.commands.unregister("load");
  f.prepared.commands.register("load", () => { preparing = true; });
  f.prepared.commands.append("load; echo tail\n", f.context);
  await f.prepared.commands.executeAsync(async () => {
    if (!preparing) return;
    preparing = false;
    const next = candidate(f);
    expect(() => next.program.commands.executeNow("", f.context)).toThrow();
    next.program.commands.executeNow("set marker immediate", f.context);
    expect(next.cvars.variableString("marker")).toBe("immediate");
    next.program.publish();
  });
  expect(f.output.join("")).toBe("tail \n");
});

test("candidate isolation follows adopted shared routing rather than the constructor registry", () => {
  const f = fixture("q3"), adopted = candidate(f);
  f.prepared.adopt(adopted.routing, () => undefined, { source: adopted.cvars, movement: adopted.cvars, fallback: adopted.cvars,
    scripts: f.prepared.scripts, read: async () => undefined });
  const independent = candidate(f);
  const unsafeRouting = new ApplicationConsoleRouting({ fallback: independent.cvars, sourceDialect: () => "q3",
    server: () => null, seat: () => independent.cvars, input: () => independent.cvars, shared: () => adopted.shared });
  expect(() => f.prepared.prepareClientCommands({ dialect: "q3", context: f.context, cvars: independent.cvars,
    cvarRouting: unsafeRouting })).toThrow("isolated cvar owners");
  expect(adopted.shared.variableString("r_gamma")).toBe("1");
  expect(adopted.shared.variableString("volume")).toBe("0.5");
  independent.program.commands.executeNow("set r_gamma 2", f.context);
  independent.program.commands.executeNow("set volume 0.2", f.context);
  expect(independent.shared.variableString("r_gamma")).toBe("2");
  expect(independent.shared.variableString("volume")).toBe("0.2");
  expect(adopted.shared.variableString("r_gamma")).toBe("1");
  expect(adopted.shared.variableString("volume")).toBe("0.5");
  expect(f.shared.variableString("r_gamma")).toBe("1");
});

test("mixed Q3 source and Q1 movement release preserves the original command buffer dialect", () => {
  const f = fixture("q3", "q1-netquake");
  const calls: { readonly argv: readonly string[]; readonly dialect: CommandDialect }[] = [];
  f.prepared.commands.register("+probe", () => undefined);
  f.prepared.commands.register("-probe", command => { calls.push({ argv: command.argv, dialect: command.dialect }); });
  f.prepared.commands.register("probe", command => { calls.push({ argv: command.argv, dialect: command.dialect }); });
  f.input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+probe; probe one/* comment */two" } });
  f.input.input({ kind: "key", seat: f.input.seat, code: 119, down: true, repeat: false, timeMilliseconds: 1 });
  f.prepared.commands.execute();
  expect(calls).toEqual([{ argv: ["probe", "one", "two"], dialect: "q3" }]);
  calls.length = 0;
  const next = candidate(f, "q1-netquake");
  f.input.release(2, next.program.releaseCommands);
  f.prepared.commands.setProfile("q1-netquake", next.cvars);
  next.program.publish(); f.prepared.commands.execute();
  expect(calls).toEqual([{ argv: ["-probe", "119", "2"], dialect: "q3" },
    { argv: ["probe", "one", "two"], dialect: "q3" }]);
  expect(f.input.dialect).toBe("q1-netquake");
});
