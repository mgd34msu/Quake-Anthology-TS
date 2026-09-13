import { expect, test } from "bun:test";
import { ApplicationConsoleRouting } from "../../src/app/bootstrap/console.ts";
import { SeatConsole } from "../../src/console/session.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer, tokenizeCommand } from "../../src/core/commands/index.ts";
import { CvarRegistry, CvarFlag, Q2CvarFlag } from "../../src/core/cvars/index.ts";

const owner = createIdentityOwner("commands-smoke");
function context(index = 0): CommandContext {
  return { session: owner.session, origin: { kind: "local-seat", seat: owner.seat(index), client: owner.client(index, 0) } };
}

test("source command tokenization keeps family punctuation, comments and byte bounds", () => {
  expect(tokenizeCommand('echo "a;b" {x:y} // ignored', "q1-netquake").argv).toEqual(["echo", "a;b", "{", "x", ":", "y", "}"]);
  expect(tokenizeCommand('echo a/*comment*/b "x"\0ignored', "q3").argv).toEqual(["echo", "a", "b", "x"]);
  expect(tokenizeCommand('echo {x:y}', "q2-classic").argv).toEqual(["echo", "{x:y}"]);
  expect(tokenizeCommand(`echo ${"x".repeat(128)}`, "q2-classic").argv).toEqual(["echo", ""]);
  expect(() => tokenizeCommand("echo \u0100", "q3")).toThrow("source bytes");
});

test("registration completion is newest first and Q3 touches dispatched entries", () => {
  const commands = new CommandBuffer({ dialect: "q3", context: context(), builtins: false });
  const calls: string[] = [];
  commands.register("Choice", () => { calls.push("old"); });
  commands.register("choice", () => { calls.push("new"); });
  commands.register("other", () => {});
  expect(commands.register("choice", () => {})).toBe(false);
  expect(commands.complete("ch")).toBe("choice");
  commands.executeNow("CHOICE");
  expect(calls).toEqual(["new"]);
  expect(commands.registeredNames()).toEqual(["choice", "other", "Choice"]);
});

test("alternating seat buffers retain script source through insertion, wait and nested execution", () => {
  const calls: string[] = [];
  function make(index: number): CommandBuffer {
    const buffer = new CommandBuffer({ dialect: "q1-quakeworld", context: context(index), readScript: () => "note script;wait;note resumed" });
    buffer.register("note", command => {
      const origin = command.source.origin, caller = origin.kind === "script" ? origin.caller : origin;
      calls.push(`${caller.kind === "local-seat" ? caller.seat.index : -1}:${command.args[0] ?? ""}:${origin.kind}`);
      if (command.args[0] === "nested") { command.executeNow("note child"); command.assertActive(); }
    });
    return buffer;
  }
  const first = make(0), second = make(1);
  first.append("exec script.cfg;note nested\n");
  second.append("note second\n");
  first.execute(); second.execute(); first.execute();
  expect(calls).toEqual(["0:script:script", "1:second:local-seat", "0:resumed:script", "0:nested:local-seat", "0:child:local-seat"]);
});

test("insertion, aliases, macros, deferred text and waits retain family behavior", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q3"] satisfies readonly CommandDialect[]) {
    const buffer = new CommandBuffer({ dialect, context: context(), builtins: false });
    buffer.append("tail"); buffer.insert("head");
    expect(buffer.pendingText).toBe(dialect === "q1-quakeworld" || dialect === "q3" ? "head\ntail" : "headtail");
  }
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: context() });
  cvars.register("word", "expanded");
  const calls: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars });
  buffer.register("note", command => { calls.push(command.args.join(" ")); });
  buffer.append('alias old "note old";alias newer "note $word";newer;wait 20;note "$word"\n');
  buffer.copyToDefer(); buffer.append("note tail\n"); buffer.insertFromDefer();
  buffer.execute(); expect(calls).toEqual(["expanded"]);
  expect(buffer.complete("n")).toBe("note"); expect(buffer.aliasNames()).toEqual(["newer", "old"]);
  buffer.execute(); expect(calls).toEqual(["expanded", "$word", "tail"]);
});

test("Q3 numeric wait and null callback use cvar then client/server/UI fallback order", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: context() });
  cvars.register("rate", "1");
  const calls: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q3", context: context(), cvars,
    clientGame: () => { calls.push("client"); return false; }, serverGame: () => { calls.push("server"); return false; },
    ui: () => { calls.push("ui"); return false; }, forwardToServer: () => { calls.push("forward"); } });
  buffer.registerFallbackName("rate");
  buffer.append("rate 2;wait 2;unknown\n");
  buffer.execute(); expect(cvars.variableString("rate")).toBe("2"); expect(calls).toEqual([]);
  buffer.execute(); expect(calls).toEqual([]);
  buffer.execute(); expect(calls).toEqual(["client", "server", "ui", "forward"]);
});

test("buffer limits retain source append rejection and insertion bounds", () => {
  const output: string[] = [];
  const buffer = new CommandBuffer({ dialect: "q3", context: context(), builtins: false, maxBufferLength: 8, print: text => { output.push(text); } });
  buffer.append("12345678"); expect(buffer.pendingText).toBe("");
  buffer.append("123456"); buffer.insert("x"); expect(buffer.pendingText).toBe("x\n123456");
  buffer.insert("y"); expect(buffer.pendingText).toBe("x\n123456"); expect(output).toHaveLength(2);
});

test("common cvar commands preserve numeric formatting and native toggle policies", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const cvars = new CvarRegistry({ dialect, context: context() }), output: string[] = [];
    const commands = new CommandBuffer({ dialect, context: context(), cvars, print: text => { output.push(text); } });
    cvars.register("amount", "0"); cvars.register("cycle", "Red"); cvars.register("truth", "0.0");
    commands.executeNow("inc amount 0.5"); expect(cvars.variableString("amount")).toBe("0.500000");
    commands.executeNow("inc amount 0.5"); expect(cvars.variableString("amount")).toBe("1");
    commands.executeNow("dec amount"); expect(cvars.variableString("amount")).toBe("0");
    commands.executeNow("toggle truth"); expect(cvars.variableString("truth")).toBe(dialect === "q3" ? "1" : "0.0");
    commands.executeNow("toggle cycle red BLUE"); expect(cvars.variableString("cycle")).toBe("BLUE");
    commands.executeNow("toggle cycle red BLUE"); expect(cvars.variableString("cycle")).toBe("red");
    cvars.set("amount", "1e3"); commands.executeNow("inc amount"); expect(cvars.variableString("amount")).toBe("1e3");
    commands.executeNow("reset amount"); expect(cvars.variableString("amount")).toBe("0");
    commands.executeNow("inc absent"); expect(cvars.find("absent")).toBeUndefined();
    cvars.set("amount", "."); commands.executeNow("inc amount"); expect(cvars.variableString("amount")).toBe("1");
    cvars.set("amount", "16777216"); commands.executeNow("inc amount"); expect(cvars.variableString("amount")).toBe("16777216");
    cvars.set("amount", "1"); commands.executeNow("inc amount inf"); expect(cvars.variableString("amount")).toBe("inf");
    expect(output.join("")).toContain("can't inc");
  }
});

test("Q2 extended commands retain source flags, protection, latches and info retransmission", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: context() });
  const commands = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars });
  for (const [name, flag] of [["rom", Q2CvarFlag.ReadOnly], ["noset", Q2CvarFlag.NoSet], ["cheat", Q2CvarFlag.Cheat],
    ["private", Q2CvarFlag.Private], ["noarchive", Q2CvarFlag.NoArchive]] satisfies readonly (readonly [string, number])[]) {
    cvars.register(name, "1", flag); commands.executeNow(`seta ${name} 2`);
    expect((cvars.find(name)?.flags ?? 0) & Q2CvarFlag.Archive).toBe(0);
  }
  cvars.setCheatsEnabled(false); commands.executeNow("inc cheat");
  expect(cvars.variableString("cheat")).toBe("2");
  expect(cvars.variableString("rom")).toBe("1"); expect(cvars.variableString("noset")).toBe("1");
  cvars.set("rom", "3", true); expect(cvars.variableString("rom")).toBe("3");
  cvars.register("game", "baseq2", Q2CvarFlag.Latch); cvars.set("game", "ctf", true);
  cvars.register("latched", "1", Q2CvarFlag.Latch); cvars.setServerActive(true);
  commands.executeNow("inc latched"); expect(cvars.find("latched")?.latchedValue).toBe("2");
  commands.executeNow("inc latched 0"); expect(cvars.find("latched")?.latchedValue).toBeUndefined();
  commands.executeNow("seta latched 4"); expect(cvars.find("latched")?.latchedValue).toBe("4");
  expect(cvars.find("latched")?.flags).toBe(Q2CvarFlag.Latch | Q2CvarFlag.Archive);
  commands.executeNow("resetall"); expect(cvars.variableString("game")).toBe("ctf");
  expect(cvars.variableString("rom")).toBe("3"); expect(cvars.variableString("cheat")).toBe("2");
  expect(cvars.find("latched")?.latchedValue).toBeUndefined();
  commands.executeNow("seta nick old"); commands.executeNow("setu nick new name");
  expect(cvars.variableString("nick")).toBe("new name"); expect(cvars.userinfoModified).toBe(true);
  expect(cvars.find("nick")?.flags).toBe(Q2CvarFlag.Custom | Q2CvarFlag.Archive | Q2CvarFlag.UserInfo);
  cvars.clearUserinfoModified(); commands.executeNow("setu nick new name"); expect(cvars.userinfoModified).toBe(true);
  cvars.clearUserinfoModified(); commands.executeNow("sets nick server"); expect(cvars.userinfoModified).toBe(true);
  expect(cvars.find("nick")?.flags).toBe(Q2CvarFlag.Custom | Q2CvarFlag.Archive | Q2CvarFlag.ServerInfo);
  commands.executeNow('setu nick "bad;value"'); expect(cvars.variableString("nick")).toBe("server");
  expect(cvars.find("nick")?.flags).toBe(Q2CvarFlag.Custom | Q2CvarFlag.Archive | Q2CvarFlag.ServerInfo);
  commands.executeNow('setu "bad;name" value'); expect(cvars.find("bad;name")).toBeUndefined();
  commands.executeNow("seta engine 9"); cvars.register("engine", "2", Q2CvarFlag.ReadOnly);
  expect(cvars.variableString("engine")).toBe("2"); expect(cvars.find("engine")?.resetValue).toBe("2");
  expect((cvars.find("engine")?.flags ?? 0) & (Q2CvarFlag.Custom | Q2CvarFlag.Archive)).toBe(0);
});

test("Q1 custom archived variables restore through their own emitted commands", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld"] satisfies readonly CommandDialect[]) {
    const cvars = new CvarRegistry({ dialect, context: context() });
    const commands = new CommandBuffer({ dialect, context: context(), cvars });
    commands.executeNow("seta custom original"); commands.executeNow("seta custom changed");
    const lines = cvars.archiveCommands(); expect(lines).toEqual(['seta custom "changed"']);
    const restored = new CvarRegistry({ dialect, context: context() });
    const next = new CommandBuffer({ dialect, context: context(), cvars: restored });
    next.append(`${lines.join("\n")}\n`); next.execute(); expect(restored.variableString("custom")).toBe("changed");
    commands.executeNow("reset custom"); expect(cvars.variableString("custom")).toBe("original");
    restored.register("custom", "authored", CvarFlag.ServerInfo);
    expect(restored.variableString("custom")).toBe("changed");
    expect(restored.find("custom")?.resetValue).toBe("authored");
    expect(restored.find("custom")?.flags).toBe(CvarFlag.Archive | CvarFlag.ServerInfo);
    if (dialect === "q1-quakeworld") expect(restored.propagatedInfo("server-info")).toBe("\\custom\\changed");
    restored.register("custom", "duplicate", CvarFlag.UserInfo);
    expect(restored.find("custom")?.resetValue).toBe("authored");
    expect(restored.find("custom")?.flags).toBe(CvarFlag.Archive | CvarFlag.ServerInfo);
    next.executeNow("reset custom"); expect(restored.variableString("custom")).toBe("authored");
  }
});

test("resetall respects Q3 protected and no-restart values without force or deletion", () => {
  const cvars = new CvarRegistry({ dialect: "q3", context: context() });
  const commands = new CommandBuffer({ dialect: "q3", context: context(), cvars });
  cvars.register("protected", "1", CvarFlag.ReadOnly); cvars.set("protected", "2", true);
  cvars.register("persistent", "1", CvarFlag.NoRestart); cvars.set("persistent", "2");
  cvars.register("cheat", "1", CvarFlag.Cheat); cvars.set("cheat", "2", true);
  cvars.register("sv_cheats", "0"); cvars.set("custom", "3");
  cvars.register("ordinary", "1"); cvars.set("ordinary", "2");
  commands.executeNow("resetall");
  expect(cvars.variableString("protected")).toBe("2"); expect(cvars.variableString("persistent")).toBe("2");
  expect(cvars.variableString("cheat")).toBe("2"); expect(cvars.variableString("custom")).toBe("3");
  expect(cvars.variableString("ordinary")).toBe("1");
});

test("application console submits common cvar operations to the invoking seat and live server", () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const first = new CvarRegistry({ dialect, context: context(0) }), second = new CvarRegistry({ dialect, context: context(1) });
    const serverContext: CommandContext = { session: owner.session, origin: { kind: "server-console" } };
    const server = new CvarRegistry({ dialect, context: serverContext }), fallback = new CvarRegistry({ dialect, context: serverContext });
    first.register("local", "1"); second.register("local", "1"); server.register("shared", "1");
    first.register("shared", "100"); second.register("shared", "100");
    const routing = new ApplicationConsoleRouting({ fallback, sourceDialect: () => dialect,
      server: () => ({ cvars: server, sharedNames: ["shared"] }),
      seat: seat => seat.equals(owner.seat(0)) ? first : seat.equals(owner.seat(1)) ? second : null });
    const commands = new CommandBuffer({ dialect, context: context(), cvarRouting: routing });
    const console = new SeatConsole({ seat: owner.seat(0), dialect, context: context(), commands, cvars: fallback,
      now: () => 0, connected: () => true, clipboard: () => null, focus: () => {}, chat: () => { throw new Error("command became chat"); } });
    console.field.setText("/inc shared; inc local; seta saved first; wait; dec local 0.5"); console.submit();
    commands.append("inc local 4; seta saved second\n", context(1));
    commands.execute(); commands.execute();
    expect(first.variableString("local")).toBe("1.500000"); expect(second.variableString("local")).toBe("5");
    expect(first.variableString("saved")).toBe("first"); expect(second.variableString("saved")).toBe("second");
    expect(server.variableString("shared")).toBe("2"); expect(first.variableString("shared")).toBe("100");
    console.field.setText("/resetall"); console.submit(); commands.execute();
    expect(first.variableString("local")).toBe("1"); expect(second.variableString("local")).toBe("5");
    expect(server.variableString("shared")).toBe("1"); expect(first.variableString("shared")).toBe("100");
    expect(fallback.snapshots()).toHaveLength(0);
    expect(() => commands.append("inc local\n", { session: createIdentityOwner("foreign").session, origin: { kind: "server-console" } })).toThrow("another session");
    routing.close();
  }
});

test("Q2 private data stays out of macros, info and archives, and custom archives keep their flag", () => {
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: context() }), output: string[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars, print: text => { output.push(text); } });
  cvars.register("secret", "hidden", Q2CvarFlag.Private | Q2CvarFlag.UserInfo | Q2CvarFlag.Archive);
  commands.executeNow("echo $secret"); expect(output.join("")).not.toContain("hidden");
  expect(cvars.infoString(Q2CvarFlag.UserInfo)).toBe(""); expect(cvars.archiveCommands()).toEqual([]);
  commands.executeNow("seta custom value");
  const archived = cvars.archiveCommands(); expect(archived).toEqual(['seta custom "value"']);
  const restored = new CvarRegistry({ dialect: "q2-classic", context: context() });
  const next = new CommandBuffer({ dialect: "q2-classic", context: context(), cvars: restored });
  next.append(`${archived.join("\n")}\n`); next.execute(); expect(restored.archiveCommands()).toEqual(archived);
  cvars.register("repair", "bad;old"); commands.executeNow("setu repair valid");
  expect(cvars.infoString(Q2CvarFlag.UserInfo)).toContain("\\repair\\valid");
  cvars.register("pending", "bad;old", Q2CvarFlag.Latch); cvars.setServerActive(true);
  commands.executeNow("setu pending valid"); expect((cvars.find("pending")?.flags ?? 0) & Q2CvarFlag.UserInfo).toBe(0);
});
