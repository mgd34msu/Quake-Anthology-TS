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
