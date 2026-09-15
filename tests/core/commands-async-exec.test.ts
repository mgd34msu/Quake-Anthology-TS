import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";

const identity = createIdentityOwner("async-exec");
const context: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(1), client: identity.client(1, 0) } };

function pendingScript() {
  let resolve: (value: string | undefined) => void = () => { throw new Error("Promise not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Promise not initialized"); };
  const promise = new Promise<string | undefined>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test("async exec pauses draining, retains nested seat context, and preserves wait order", async () => {
  const outer = pendingScript(), inner = pendingScript();
  const calls: { readonly name: string; readonly source: CommandContext }[] = [], seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: (name, source) => { calls.push({ name, source }); return name === "outer.cfg" ? outer.promise : inner.promise; } });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("exec outer; record after\n");
  expect(commands.execute()).toBe(1);
  expect(commands.execute()).toBe(0);
  expect(seen).toEqual([]);
  outer.resolve("record outer; exec inner; record outer-tail\n"); await outer.promise;
  commands.execute();
  expect(seen).toEqual(["outer"]);
  expect(calls[1]?.source.origin).toEqual({ kind: "script", name: "outer.cfg", caller: context.origin });
  inner.resolve("record inner; wait; record inner-tail\n"); await inner.promise;
  commands.execute();
  expect(seen).toEqual(["outer", "inner"]);
  commands.execute();
  expect(seen).toEqual(["outer", "inner", "inner-tail", "outer-tail", "after"]);
});

test("pending exec transfers to replacement and rejected reads resume later commands", async () => {
  const read = pendingScript();
  const output: string[] = [], seen: string[] = [];
  const original = new CommandBuffer({ dialect: "q3", context, readScript: () => read.promise });
  original.append("exec missing; record after\n"); original.execute();
  const replacement = new CommandBuffer({ dialect: "q3", context, print: (text, source) => { output.push(text); expect(source).toEqual(context); } });
  replacement.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  replacement.copyPendingFrom(original);
  read.reject(new Error("read denied")); await read.promise.catch(() => undefined);
  replacement.execute();
  expect(seen).toEqual(["after"]);
  expect(output).toEqual(["couldn't exec missing.cfg: read denied\n"]);
});

test("async exec discarded from a synchronous batch never publishes after completion", async () => {
  const read = pendingScript(), seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: () => read.promise });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("record original\n");
  expect(() => commands.executeBatch("exec late\n", context)).toThrow("paused or deferred");
  read.resolve("record leaked\n"); await read.promise;
  commands.execute();
  expect(seen).toEqual(["original"]);
});

test("script drain awaits nested reads and retains native wait boundaries", async () => {
  for (const dialect of ["q1-netquake", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const outer = pendingScript(), inner = pendingScript(), seen: string[] = [];
    const sources: CommandContext[] = [];
    const commands = new CommandBuffer({ dialect, context, readScript: name => name === "outer.cfg" ? outer.promise : inner.promise });
    commands.register("record", invocation => { seen.push(invocation.args.join(" ")); sources.push(invocation.source); });
    commands.append("exec outer.cfg; record after\n");
    const draining = commands.executeScriptsAsync(async () => {});
    expect(() => commands.execute()).toThrow("already draining");
    outer.resolve("record outer; exec inner.cfg; record outer-tail\n");
    inner.resolve("record inner; wait; record inner-tail\n");
    await draining;
    expect(seen).toEqual(["outer", "inner"]);
    expect(sources[1]?.origin).toEqual({ kind: "script", name: "inner.cfg", caller: { kind: "script", name: "outer.cfg", caller: context.origin } });
    await commands.executeScriptsAsync(async () => {});
    expect(seen).toEqual(["outer", "inner", "inner-tail", "outer-tail", "after"]);
  }
});

test("script drain reports rejected reads and continues in order", async () => {
  const read = pendingScript(), seen: string[] = [], output: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: () => read.promise, print: text => { output.push(text); } });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("exec missing; record after\n");
  const draining = commands.executeScriptsAsync(async () => {});
  read.reject(new Error("denied"));
  await draining;
  expect(seen).toEqual(["after"]);
  expect(output).toEqual(["couldn't exec missing.cfg: denied\n"]);
});

test("script drain callback failure releases ownership and retains pending commands", async () => {
  const seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: async () => "record script\n" });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("exec startup; record after\n");
  await expect(commands.executeScriptsAsync(async () => { throw new Error("dispatch cancelled"); })).rejects.toThrow("dispatch cancelled");
  expect(seen).toEqual([]);
  await commands.executeScriptsAsync(async () => {});
  expect(seen).toEqual(["script", "after"]);
});

test("ordinary asynchronous frame drain still returns before a pending script read", async () => {
  const read = pendingScript(), seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: () => read.promise });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("exec startup; record after\n");
  expect(await commands.executeAsync(async () => {})).toBe(1);
  expect(seen).toEqual([]);
  read.resolve("record script\n");
  await commands.executeScriptsAsync(async () => {});
  expect(seen).toEqual(["script", "after"]);
});

test("Q2 script reads do not reset the alias limit within an awaited frame", async () => {
  let reads = 0;
  const output: string[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context, readScript: async () => { reads++; return "again\n"; }, print: text => { output.push(text); } });
  commands.append('alias again "exec loop.cfg"; again\n');
  await commands.executeScriptsAsync(async () => {});
  expect(reads).toBe(15);
  expect(output.some(text => text.includes("ALIAS_LOOP_COUNT"))).toBe(true);
});

test("completion boundaries finish nested scripts before callers, across wait", async () => {
  const seen: string[] = [], sources: CommandContext[] = [];
  const commands = new CommandBuffer({ dialect: "q1-netquake", context,
    readScript: async name => name === "quake.rc" ? "exec default.cfg\nexec config.cfg\nrecord autoexec\n" : name === "default.cfg" ? "record default\nwait\n" : undefined,
    onScriptComplete: event => { seen.push(`${event.name}:${event.result.kind}`); sources.push(event.source); } });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("exec quake.rc\nrecord caller\n");
  await commands.executeScriptsAsync(async () => {});
  expect(seen).toEqual(["default"]);
  await commands.executeScriptsAsync(async () => {});
  expect(seen).toEqual(["default", "default.cfg:completed", "config.cfg:missing", "autoexec", "quake.rc:completed", "caller"]);
  expect(sources[0]?.origin).toEqual({ kind: "script", name: "default.cfg", caller: { kind: "script", name: "quake.rc", caller: context.origin } });
});

test("completion follows inserted alias work and preserves Q2 cross-file bytes", () => {
  const seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q2-classic", context,
    readScript: name => name === "alias.cfg" ? "alias nested record-alias\nnested\n" : "record joined",
    onScriptComplete: event => { seen.push(event.name); } });
  commands.register("record-alias", () => { seen.push("alias-body"); });
  commands.register("record", invocation => { seen.push(invocation.args.join(" ")); });
  commands.append("exec alias.cfg\nexec bytes.cfg\n-tail\n");
  commands.execute();
  expect(seen).toEqual(["alias-body", "alias.cfg", "joined-tail", "bytes.cfg"]);
});

test("empty and rejected scripts complete once and hook failure retains caller", async () => {
  const seen: string[] = [], failure = new Error("read denied");
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: async name => { if (name === "bad.cfg") throw failure; return ""; },
    onScriptComplete: event => {
      seen.push(`${event.name}:${event.result.kind}`);
      if (event.result.kind === "failed") { expect(event.result.error).toBe(failure); throw new Error("stop startup"); }
    } });
  commands.register("record", () => { seen.push("caller"); });
  commands.append("exec empty; exec bad; record\n");
  await expect(commands.executeScriptsAsync(async () => {})).rejects.toThrow("stop startup");
  expect(seen).toEqual(["empty.cfg:completed", "bad.cfg:failed"]);
  await commands.executeScriptsAsync(async () => {});
  expect(seen).toEqual(["empty.cfg:completed", "bad.cfg:failed", "caller"]);
});

test("completion nodes survive replacement and Q2 defer without firing early", () => {
  const seen: string[] = [];
  const original = new CommandBuffer({ dialect: "q2-classic", context, readScript: () => "wait\n", onScriptComplete: () => { seen.push("original"); } });
  original.append("exec saved.cfg\n"); original.execute();
  original.copyToDefer();
  const replacement = new CommandBuffer({ dialect: "q2-classic", context, onScriptComplete: event => { seen.push(event.name); } });
  replacement.copyPendingFrom(original);
  replacement.execute(); expect(seen).toEqual([]);
  replacement.insertFromDefer(); replacement.execute();
  expect(seen).toEqual(["saved.cfg"]);
  replacement.execute(); expect(seen).toEqual(["saved.cfg"]);
});

test("failed synchronous batches discard their completion nodes and preserve original ones", () => {
  const seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context, readScript: () => "wait\n", onScriptComplete: event => { seen.push(event.name); } });
  commands.append("exec original\n"); commands.execute();
  expect(() => commands.executeBatch("exec discarded\n", context)).toThrow("paused or deferred");
  expect(seen).toEqual([]);
  commands.execute();
  expect(seen).toEqual(["original.cfg"]);
});

test("rejected script insertion and synchronous reader throws never report completion", () => {
  const seen: string[] = [];
  const overflow = new CommandBuffer({ dialect: "q3", context, maxBufferLength: 32, readScript: () => "x".repeat(40), onScriptComplete: event => { seen.push(event.name); } });
  overflow.append("exec too-big\n"); overflow.execute();
  expect(seen).toEqual([]);
  const failure = new Error("sync read failure");
  const throwing = new CommandBuffer({ dialect: "q3", context, readScript: () => { throw failure; }, onScriptComplete: event => { seen.push(event.name); } });
  throwing.append("exec throws\n");
  expect(() => throwing.execute()).toThrow(failure);
  throwing.execute(); expect(seen).toEqual([]);
});

for (const dialect of ["q1-netquake", "q2-classic", "q3"] satisfies readonly CommandDialect[]) {
  test(`${dialect} stopped script drain resumes copied chunks and nested completion after wait`, async () => {
    const seen: string[] = [], completed: string[] = [];
    let running = true;
    const options = { dialect, context, readScript: async () => "record before; boundary; wait; record after\n",
      onScriptComplete: (event: import("../../src/core/commands/index.ts").ScriptCompletion) => { completed.push(event.name); } };
    const commands = new CommandBuffer(options);
    commands.register("record", command => { seen.push(command.args[0] ?? ""); });
    commands.register("boundary", () => { running = false; });
    commands.append("exec outer.cfg\n");
    await commands.executeScriptsAsync(async () => {}, () => running);
    expect(seen).toEqual(["before"]); expect(completed).toEqual([]);
    const replacement = new CommandBuffer(options);
    replacement.register("record", command => { seen.push(command.args[0] ?? ""); });
    replacement.copyPendingFrom(commands);
    await replacement.executeScriptsAsync(async () => {});
    expect(seen).toEqual(["before"]); expect(completed).toEqual([]);
    await replacement.executeScriptsAsync(async () => {});
    expect(seen).toEqual(["before", "after"]); expect(completed).toEqual(["outer.cfg"]);
  });
}
