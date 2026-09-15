import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
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
