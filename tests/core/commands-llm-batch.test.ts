import { expect, test } from "bun:test";
import type { CommandContext } from "../../src/contracts/common.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";

function context(): CommandContext {
  const identity = createIdentityOwner("bounded-batch");
  return { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } };
}

test("explicit-source batch validates every engine line before dispatch and restores buffered work", () => {
  const source = context(), calls: string[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context: source, maxCommandLength: 16, maxBufferLength: 128 });
  commands.register("note", invocation => { calls.push(invocation.args[0] ?? ""); return undefined; });
  commands.append("note pending\n");
  expect(() => commands.executeBatch("note first;note " + "x".repeat(20), source)).toThrow("line limit");
  expect(calls).toEqual([]); expect(commands.pendingText).toBe("note pending\n");
  expect(() => commands.executeBatch("note x\n".repeat(30), source)).toThrow("buffer limit");
  expect(calls).toEqual([]);
  commands.executeBatch('note "a;b"\n', source);
  expect(calls).toEqual(["a;b"]); expect(commands.pendingText).toBe("note pending\n");
});

test("batches execute derived immediate work with original source and print source, but never direct provenance", () => {
  const source = context(), calls: boolean[] = [], output: { text: string; source: CommandContext | undefined }[] = [];
  const commands = new CommandBuffer({ dialect: "q3", context: source, print: (text, owner) => output.push({ text, source: owner }) });
  commands.register("note", invocation => {
    expect(invocation.source).toEqual(source); expect(commands.executionContext).toEqual(source); calls.push(invocation.direct); return undefined;
  });
  commands.register("derive", invocation => {
    invocation.executeNow("note"); invocation.insert("note\n"); invocation.append("note\n"); return undefined;
  });
  commands.executeBatch('derive; echo "a;b"\n', source);
  expect(calls).toEqual([false, false, false]); expect(output).toEqual([{ text: "a;b \n", source }]);
  expect(commands.executionContext).toBeUndefined(); expect(commands.pendingText).toBe("");
});

test("batches preserve preexisting Q3 waits and Q2 deferred buffers", () => {
  const source = context(); let calls = 0;
  const q3 = new CommandBuffer({ dialect: "q3", context: source });
  q3.register("note", () => { calls++; return undefined; });
  q3.append("wait 2;note\n"); q3.execute(); q3.executeBatch("echo batch\n", source);
  q3.execute(); expect(calls).toBe(0); q3.execute(); expect(calls).toBe(1);
  const q2 = new CommandBuffer({ dialect: "q2-classic", context: source });
  q2.append("echo deferred\n"); q2.copyToDefer(); q2.append("echo pending\n"); q2.executeBatch("echo batch\n", source);
  expect(q2.pendingText).toBe("echo pending\n"); expect(q2.deferredText).toBe("echo deferred\n");
});

test("runaway or paused derived batch work fails explicitly and leaves unrelated input intact", () => {
  const source = context();
  const commands = new CommandBuffer({ dialect: "q1-netquake", context: source });
  commands.register("loop", invocation => { invocation.insert("loop\n"); return undefined; });
  commands.append("echo pending\n");
  expect(() => commands.executeBatch("loop\n", source)).toThrow("128 dispatched commands");
  expect(commands.pendingText).toBe("echo pending\n");
  expect(() => commands.executeBatch("wait;echo later\n", source)).toThrow("remaining batch discarded");
  expect(commands.pendingText).toBe("echo pending\n");
});
