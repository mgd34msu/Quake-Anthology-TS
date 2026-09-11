import { expect, test } from "bun:test";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer, tokenizeCommand } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";

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
