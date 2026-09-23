import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { QvmInterpreter, QvmModule, QvmOpcode, parseQvm, parseQvmRestart, qvmArguments, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import type { QvmCancellationScope, QvmFunctionCall, QvmFunctionHook } from "../../../src/compat/qvm/index.ts";

type Operation = readonly [QvmOpcode, number?];
function bytecode(operations: readonly Operation[]): Uint8Array {
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) {
    code.u8(opcode);
    if (operand !== undefined) {
      if (opcode === QvmOpcode.OP_ARG) code.u8(operand);
      else code.i32(operand);
    }
  }
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) output.i32(word);
  output.bytes(instructions);
  return output.finish();
}
function unexpectedTrap(): never { throw new Error("Unexpected syscall"); }

test("live callback resolver sees assignments immediately and preserves explicit hooks, observers and direct entries", () => {
  const bytes = bytecode([
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 19], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_ARG, 8], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CALL],
    [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 22], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_ARG, 8], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CALL],
    [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 0],
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 11], [QvmOpcode.OP_LEAVE, 0],
  ]);
  const vm = new QvmInterpreter(parseQvm(bytes), unexpectedTrap, undefined, null, "compiled"), memory = new DataView(vm.memory.buffer);
  let resolved = 0, observed = 0;
  const hook: QvmFunctionHook = call => call.proceed() + 1;
  const remove = vm.bindFunctionResolver((entry, pointer) => {
    resolved++; return pointer === 64 && memory.getInt32(pointer, true) === entry ? hook : undefined;
  });
  vm.observeFunction(19, () => { observed++; return undefined; });
  vm.observeFunction(22, () => { observed++; return undefined; });
  expect(vm.invoke(qvmArguments([]))).toBe(20);
  expect([resolved, observed]).toEqual([2, 2]);
  const explicit = vm.bindFunction(19, () => 100);
  expect(vm.invoke(qvmArguments([]))).toBe(112);
  expect([resolved, observed]).toEqual([3, 4]);
  expect(vm.invoke(qvmArguments([64]), 19)).toBe(7);
  expect([resolved, observed]).toEqual([3, 4]);
  explicit(); remove(); remove();
  expect(vm.invoke(qvmArguments([]))).toBe(18);
  expect([resolved, observed]).toEqual([3, 6]);
});

// The caller keeps an operand and passes a pointer to its local alongside a value.
const source = bytecode([
  [QvmOpcode.OP_ENTER, 32], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_STORE4],
  [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_ARG, 8], [QvmOpcode.OP_CONST, 9], [QvmOpcode.OP_ARG, 12],
  [QvmOpcode.OP_CONST, 16], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD],
  [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 32],
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LOAD4],
  [QvmOpcode.OP_LOCAL, 28], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ADD],
  [QvmOpcode.OP_CONST, 27], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, 3], [QvmOpcode.OP_LEAVE, 8],
]);
const trappingSource = bytecode([
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 4], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL],
  [QvmOpcode.OP_CONST, 2], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
]);
const cancellableSource = bytecode([
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_CONST, 9], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD],
  [QvmOpcode.OP_CONST, 21], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 100], [QvmOpcode.OP_CONST, 15], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 200], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 0],
]);

test("invocation bindings intercept direct module entry and source calls exactly once", () => {
  const moduleIdentity = { id: "q3:invocation-test", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(source).digest("hex")) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module: moduleIdentity, role: "qagame", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Expected bytecode artifact");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall });
  const reference = { kind: "qvm", module: moduleIdentity, instructionIndex: 16 } satisfies import("../../../src/contracts/execution.ts").GuestCallbackReference;
  let entered = 0;
  const remove = module.bindInvocation(reference, call => { entered++; return call.proceed() + 1; });
  expect(() => module.bindFunction(reference, call => call.proceed())).toThrow("already has a hook");
  expect(module.call([])).toBe(32);
  module.memory.view(64, 4).setInt32(0, 7, true);
  expect(module.call([64, 9], 16)).toBe(20);
  expect(entered).toBe(2);
  remove(); remove();
  expect(module.call([64, 9], 16)).toBe(19);
  expect(entered).toBe(2);
  module.retire();
});

for (const semantics of ["interpreted", "compiled"] satisfies readonly import("../../../src/compat/qvm/interpreter.ts").QvmSemantics[]) {
  test(`${semantics} direct invocation cancellation preserves caller and sibling execution`, async () => {
    for (const asynchronous of [false, true]) for (const direct of [false, true]) {
      let capability: QvmCancellationScope | null = null, entered = 0;
      const vm = new QvmInterpreter(parseQvm(cancellableSource), call => {
        if (capability === null) throw new Error("Missing invocation cancellation scope");
        return call.cancelFunction(capability);
      }, undefined, null, semantics);
      vm.bindInvocation(9, call => {
        entered++; capability = call.cancellationScope();
        return asynchronous ? call.proceedAsync() : call.proceed();
      });
      const entry = direct ? 9 : 0;
      expect(asynchronous ? await vm.invokeAsync(qvmArguments([]), entry) : vm.invoke(qvmArguments([]), entry)).toBe(direct ? 0 : 12);
      expect(entered).toBe(1);
      expect(vm.invoke(qvmArguments([]), 21)).toBe(7);
      expect(vm.stackPointer).toBe(vm.memory.length);
      expect(vm.isActive).toBe(false);
    }
  });
}

for (const semantics of ["interpreted", "compiled"] satisfies readonly import("../../../src/compat/qvm/interpreter.ts").QvmSemantics[]) {
  test(`${semantics} cancellation unwinds only its exact nested source call`, async () => {
    for (const asynchronous of [false, true]) for (const target of [9, 15]) for (const reentry of [false, true]) {
      const order: string[] = [];
      let capability: QvmCancellationScope | null = null;
      const required = (): QvmCancellationScope => { if (capability === null) throw new Error("Missing cancellation scope"); return capability; };
      const vm = new QvmInterpreter(parseQvm(cancellableSource), call => {
        if (asynchronous) return Promise.resolve().then(() => call.cancelFunction(required()));
        return call.cancelFunction(required());
      }, undefined, null, semantics);
      for (const entry of [9, 15]) vm.bindFunction(entry, call => {
        if (entry === target) capability = call.cancellationScope();
        order.push(`enter:${entry}`);
        if (asynchronous) return (reentry && entry === 15 ? call.invokeAsync(qvmArguments([]), entry) : call.proceedAsync())
          .catch(() => 999).finally(() => { order.push(`leave:${entry}`); });
        try { return reentry && entry === 15 ? call.invoke(qvmArguments([]), entry) : call.proceed(); }
        catch { return 999; } finally { order.push(`leave:${entry}`); }
      });
      vm.observeFunction(21, () => { order.push("sibling"); return undefined; });
      expect(asynchronous ? await vm.invokeAsync(qvmArguments([])) : vm.invoke(qvmArguments([]))).toBe(target === 9 ? 12 : 112);
      expect(order).toEqual(["enter:9", "enter:15", "leave:15", "leave:9", "sibling"]);
      expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);
    }
  });
}

test("cancellation drains an unawaited asynchronous body before sibling continuation", async () => {
  const gate = Promise.withResolvers<void>(), order: string[] = [];
  let capability: QvmCancellationScope | null = null;
  const vm = new QvmInterpreter(parseQvm(cancellableSource), async call => {
    await gate.promise;
    if (capability === null) throw new Error("Missing cancellation scope");
    return call.cancelFunction(capability);
  }, undefined, null, "compiled");
  vm.bindFunction(9, call => {
    capability = call.cancellationScope();
    void call.proceedAsync().catch(() => { order.push("body drained"); });
    return 999;
  });
  vm.observeFunction(21, () => { order.push("sibling"); return undefined; });
  const result = vm.invokeAsync(qvmArguments([]));
  expect(vm.isActive).toBe(true); expect(order).toEqual([]);
  gate.resolve();
  expect(await result).toBe(12); expect(order).toEqual(["body drained", "sibling"]);
  expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);
});

test("nested cleanup cannot redirect an already requested outer cancellation", async () => {
  let outer: QvmCancellationScope | null = null, completed = false;
  const vm = new QvmInterpreter(parseQvm(cancellableSource), call => {
    if (outer === null) throw new Error("Missing outer cancellation scope");
    return call.cancelFunction(outer);
  }, undefined, null, "compiled");
  vm.bindFunction(9, call => {
    outer = call.cancellationScope();
    return call.proceedAsync().then(value => { completed = true; return value; });
  });
  vm.bindFunction(15, call => {
    const inner = call.cancellationScope();
    return call.proceedAsync().finally(() => call.cancelFunction(inner));
  });
  expect(await vm.invokeAsync(qvmArguments([]))).toBe(12);
  expect(completed).toBe(false); expect(vm.isActive).toBe(false);
  expect(vm.stackPointer).toBe(vm.memory.length);
});

test("cancellation cannot hide source faults or cleanup failures", async () => {
  for (const asynchronous of [false, true]) for (const cleanup of [false, true]) {
    const fault = new Error(cleanup ? "cleanup failed" : "source failed");
    let capability: QvmCancellationScope | null = null;
    const vm = new QvmInterpreter(parseQvm(cancellableSource), call => {
      if (!cleanup) throw fault;
      if (capability === null) throw new Error("Missing cancellation scope");
      return call.cancelFunction(capability);
    }, undefined, null, "compiled");
    vm.bindFunction(9, call => {
      capability = call.cancellationScope();
      if (asynchronous) return call.proceedAsync().catch(() => 999);
      try { return call.proceed(); } catch { return 999; }
    });
    vm.bindFunction(15, call => {
      if (asynchronous) return call.proceedAsync().finally(() => { if (cleanup) throw fault; });
      try { return call.proceed(); } finally { if (cleanup) throw fault; }
    });
    if (asynchronous) await expect(vm.invokeAsync(qvmArguments([]))).rejects.toBe(fault);
    else expect(() => vm.invoke(qvmArguments([]))).toThrow(fault);
    expect(vm.isActive).toBe(false); expect(vm.stackPointer).toBe(vm.memory.length);
  }
});

test("a cancellation capability opens before proceeding and expires with its exact call", () => {
  let saved: QvmCancellationScope | null = null;
  const vm = new QvmInterpreter(parseQvm(cancellableSource), () => 0, undefined, null, "compiled");
  const remove = vm.bindFunction(9, call => {
    saved = call.cancellationScope();
    try { return call.cancelFunction(saved); } catch { return 999; }
  });
  expect(vm.invoke(qvmArguments([]))).toBe(12);
  const expired = saved;
  if (expired === null) throw new Error("Missing expired scope");
  remove();
  const stale = vm.bindFunction(9, call => { try { return call.cancelFunction(expired); } catch { return 999; } });
  expect(() => vm.invoke(qvmArguments([]))).toThrow("has expired"); stale();
  const late = vm.bindFunction(9, call => {
    const result = call.proceed();
    try { call.cancellationScope(); } catch { return result; }
    return result;
  });
  expect(() => vm.invoke(qvmArguments([]))).toThrow("before proceeding"); late();
  vm.bindFunction(9, call => {
    const scope = call.cancellationScope();
    try { call.cancelFunction(scope); } catch { /* A caught request cannot be reused. */ }
    try { return call.cancelFunction(scope); } catch { return 999; }
  });
  expect(() => vm.invoke(qvmArguments([]))).toThrow("already been used");
  expect(vm.isActive).toBe(false); expect(vm.stackPointer).toBe(vm.memory.length);
});

test("foreign and copied capabilities fail ordinarily even when their hook catches", () => {
  const first = new QvmInterpreter(parseQvm(cancellableSource), () => 0, undefined, null, "compiled");
  const second = new QvmInterpreter(parseQvm(cancellableSource), () => 0, undefined, null, "compiled");
  first.bindFunction(9, call => {
    const scope = call.cancellationScope();
    const foreign = second.bindFunction(9, other => { try { return other.cancelFunction(scope); } catch { return 999; } });
    expect(() => second.invoke(qvmArguments([]))).toThrow("another interpreter"); foreign();
    expect(second.isActive).toBe(false); expect(second.stackPointer).toBe(second.memory.length);
    try { return call.cancelFunction({ ...scope }); } catch { return 999; }
  });
  expect(() => first.invoke(qvmArguments([]))).toThrow("another interpreter");
  expect(first.isActive).toBe(false); expect(first.stackPointer).toBe(first.memory.length);
});

test("an ancestor callback cannot cancel its descendant through an inactive call object", () => {
  const vm = new QvmInterpreter(parseQvm(cancellableSource), () => 0, undefined, null, "compiled");
  let ancestor: QvmFunctionCall | null = null;
  vm.bindFunction(9, call => { ancestor = call; call.cancellationScope(); try { return call.proceed(); } catch { return 999; } });
  vm.bindFunction(15, call => {
    const scope = call.cancellationScope();
    if (ancestor === null) throw new Error("Missing ancestor call");
    try { return ancestor.cancelFunction(scope); } catch { return 999; }
  });
  expect(() => vm.invoke(qvmArguments([]))).toThrow("active syscall or function hook");
  expect(vm.isActive).toBe(false); expect(vm.stackPointer).toBe(vm.memory.length);
});

test("compiled return control survives suspended hook continuations and nested source frames", async () => {
  const gate = Promise.withResolvers<number>();
  const vm = new QvmInterpreter(parseQvm(trappingSource), call => {
    const returnSlot = call.words.byteOffset - call.memory.byteOffset - 4;
    call.memory.fill(0, returnSlot, returnSlot + 4);
    return gate.promise;
  }, undefined, null, "compiled");
  const remove = vm.bindFunction(4, async call => (await call.proceedAsync()) + 3);
  const pending = vm.invokeAsync(qvmArguments([]));
  gate.resolve(7);
  expect(await pending).toBe(12);
  expect(vm.stackPointer).toBe(vm.memory.length);
  expect(vm.isActive).toBe(false);
  remove();
});

test("hooks preserve caller operands, local pointers, argument writes and nested guest calls", () => {
  const vm = new QvmInterpreter(parseQvm(source), unexpectedTrap), order: string[] = [];
  expect(vm.invoke(qvmArguments([]))).toBe(31);
  let escaped: QvmFunctionCall | null = null;
  const inner = vm.bindFunction(27, call => { order.push("inner"); return call.proceed() + 1; });
  const outer = vm.bindFunction(16, call => {
    escaped = call; order.push("before");
    expect(call.instructionIndex).toBe(16);
    const address = call.words.getInt32(0, true), memory = new DataView(call.memory.buffer, call.memory.byteOffset, call.memory.byteLength);
    expect(memory.getInt32(address, true)).toBe(7);
    memory.setInt32(address, 11, true);
    call.words.setInt32(4, 13, true);
    expect(call.invoke(qvmArguments([]), 27)).toBe(3);
    const value = call.proceed(); order.push("after");
    return value * 2;
  });
  expect(vm.invoke(qvmArguments([]))).toBe(72);
  expect(order).toEqual(["before", "inner", "after"]);
  expect(vm.stackPointer).toBe(vm.memory.length);
  const expired = (): QvmFunctionCall => { if (escaped === null) throw new Error("Missing hook"); return escaped; };
  expect(() => expired().proceed()).toThrow("active syscall or function hook");
  expect(() => expired().invoke(qvmArguments([]), 27)).toThrow("active syscall or function hook");
  outer(); inner();
  expect(vm.invoke(qvmArguments([]))).toBe(31);
});

test("independent entry observers coexist with replacement and original execution", async () => {
  const vm = new QvmInterpreter(parseQvm(source), unexpectedTrap, undefined, null, "compiled"), seen: number[] = [];
  let escaped: (() => number) | null = null;
  const first = vm.observeFunction(16, call => { seen.push(call.argument(1)); escaped = () => call.argument(1); return undefined; });
  const second = vm.observeFunction(16, call => { seen.push(call.invoke(qvmArguments([]), 27)); return undefined; });
  const hook = vm.bindFunction(16, call => call.proceed() + 2);
  expect(vm.invoke(qvmArguments([]))).toBe(33); expect(seen).toEqual([9, 3]);
  const readEscaped = () => { if (escaped === null) throw new Error("Missing observation"); return escaped(); };
  expect(readEscaped).toThrow("observation has ended");
  hook(); first(); first(); seen.length = 0;
  expect(await vm.invokeAsync(qvmArguments([]))).toBe(31); expect(seen).toEqual([3]);
  second(); expect(vm.invoke(qvmArguments([]))).toBe(31); expect(vm.stackPointer).toBe(vm.memory.length);
});

test("replacement returns a signed source word and removal cannot remove a newer binding", () => {
  const vm = new QvmInterpreter(parseQvm(source), unexpectedTrap);
  const hook: QvmFunctionHook = () => -10;
  const remove = vm.bindFunction(16, hook);
  expect(vm.invoke(qvmArguments([]))).toBe(2);
  expect(() => vm.bindFunction(16, hook)).toThrow("already has a hook");
  remove();
  const replacement = vm.bindFunction(16, hook); remove();
  expect(vm.invoke(qvmArguments([]))).toBe(2);
  replacement();
  const invalid = vm.bindFunction(16, () => 0x80000000);
  expect(() => vm.invoke(qvmArguments([]))).toThrow("signed 32-bit integer");
  expect(vm.isActive).toBe(false);
  invalid();
  expect(vm.invoke(qvmArguments([]))).toBe(31);
  expect(() => vm.bindFunction(17, hook)).toThrow("function entry");
  expect(() => vm.bindFunction(1000, hook)).toThrow("invalid QVM instruction index");
});

test("observer children finish before later observers and the original body", async () => {
  const vm = new QvmInterpreter(parseQvm(source), unexpectedTrap, undefined, null, "compiled"), order: string[] = [];
  vm.observeFunction(16, call => { void call.invokeAsync(qvmArguments([]), 27).then(value => order.push(`child:${value}`)); return undefined; });
  vm.observeFunction(16, () => { order.push("second"); return undefined; });
  vm.bindFunction(16, call => { order.push("body"); return call.proceedAsync(); });
  expect(await vm.invokeAsync(qvmArguments([]))).toBe(31);
  expect(order).toEqual(["child:3", "second", "body"]);
  expect(vm.stackPointer).toBe(vm.memory.length);
});

test("original bodies can call host services which synchronously reenter the guest", () => {
  const bytes = bytecode([
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 4], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 0],
  ]);
  const nested = new QvmInterpreter(parseQvm(bytes), call => call.invoke(qvmArguments([]), 8));
  nested.bindFunction(4, call => call.proceed() * 3);
  expect(nested.invoke(qvmArguments([]))).toBe(21);
  expect(nested.stackPointer).toBe(nested.memory.length);
});

test("async original execution owns its continuation and drains an unawaited body", async () => {
  const gate = Promise.withResolvers<number>();
  const vm = new QvmInterpreter(parseQvm(trappingSource), () => gate.promise);
  let original: Promise<number> | null = null;
  vm.bindFunction(4, call => {
    original = call.proceedAsync();
    expect(() => call.proceed()).toThrow("pending child");
    return 99;
  });
  const result = vm.invokeAsync(qvmArguments([]));
  expect(vm.isActive).toBe(true);
  expect(() => vm.invoke(qvmArguments([]))).toThrow("already active");
  gate.resolve(7);
  expect(await result).toBe(99);
  const completed = (): Promise<number> => { if (original === null) throw new Error("Missing original continuation"); return original; };
  expect(await completed()).toBe(9);
  expect(vm.isActive).toBe(false);
  expect(vm.stackPointer).toBe(vm.memory.length);
});

test("async hook results and source failures restore the parent execution scope", async () => {
  let fail = false;
  const vm = new QvmInterpreter(parseQvm(trappingSource), () => fail ? Promise.reject(new Error("source failure")) : Promise.resolve(7));
  const remove = vm.bindFunction(4, async call => await call.proceedAsync() + 5);
  expect(await vm.invokeAsync(qvmArguments([]))).toBe(14);
  fail = true;
  await expect(vm.invokeAsync(qvmArguments([]))).rejects.toThrow("source failure");
  expect(vm.isActive).toBe(false);
  expect(vm.stackPointer).toBe(vm.memory.length);
  remove(); fail = false;
  expect(await vm.invokeAsync(qvmArguments([]))).toBe(9);
});

test("sync callers reject async hooks and a failed original cannot be swallowed", () => {
  const vm = new QvmInterpreter(parseQvm(source), unexpectedTrap);
  const remove = vm.bindFunction(16, () => Promise.resolve(4));
  expect(() => vm.invoke(qvmArguments([]))).toThrow("asynchronous syscall");
  remove();
  vm.bindFunction(16, call => { call.proceed(); return call.proceed(); });
  expect(() => vm.invoke(qvmArguments([]))).toThrow("only run once");
  const failing = new QvmInterpreter(parseQvm(trappingSource), () => { throw new Error("original failed"); });
  failing.bindFunction(4, call => { try { return call.proceed(); } catch { return 9; } });
  expect(() => failing.invoke(qvmArguments([]))).toThrow("original failed");
  expect(failing.isActive).toBe(false);
});

test("module binding checks artifact identity, retains host hooks through restart and uses current reentry", () => {
  const originalBytes = source.slice();
  const moduleIdentity = { id: "test:function-hooks", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(source).digest("hex")) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module: moduleIdentity, role: "qagame", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Expected bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall });
  const reference = { kind: "qvm", module: moduleIdentity, instructionIndex: 16 } satisfies import("../../../src/contracts/execution.ts").GuestCallbackReference;
  expect(() => module.bindFunction({ ...reference, module: { ...moduleIdentity, revision: "other" } }, () => 1)).toThrow("different module artifact");
  const remove = module.bindFunction(reference, call => module.call([], 27) + call.proceed());
  expect(module.call([])).toBe(34);
  module.interpreter.restoreData(module.memory.bytes.slice());
  expect(module.call([])).toBe(34);
  module.interpreter.restart(parseQvmRestart(source));
  expect(module.call([])).toBe(34);
  remove(); expect(module.call([])).toBe(31);
  expect(source).toEqual(originalBytes);
  module.retire();
  expect(() => module.bindFunction(reference, () => 1)).toThrow("retired");
});

const conditionalSource = bytecode([
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 6], [QvmOpcode.OP_CALL], [QvmOpcode.OP_CONST, 20], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 15], [QvmOpcode.OP_CALL], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_EQ, 13],
  [QvmOpcode.OP_CONST, 3], [QvmOpcode.OP_LEAVE, 16], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_ADD], [QvmOpcode.OP_STORE4],
  [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_LEAVE, 16],
]);
for (const semantics of ["interpreted", "compiled"] satisfies readonly import("../../../src/compat/qvm/interpreter.ts").QvmSemantics[]) {
  test(`${semantics} invocation branches retain original operands and isolate recursive decisions until async unwind`, async () => {
    for (const asynchronous of [false, true]) {
      let recurse = true, depth = 0, nested = 0, escaped: QvmFunctionCall | null = null;
      const observed: (readonly [number, boolean])[] = [];
      const vm = new QvmInterpreter(parseQvm(conditionalSource), call => {
        if (!recurse) return 0;
        recurse = false;
        if (asynchronous) return Promise.resolve().then(async () => { nested = await call.invokeAsync(qvmArguments([]), 6); return 0; });
        nested = call.invoke(qvmArguments([]), 6); return 0;
      }, undefined, null, semantics);
      const remove = vm.bindInvocation(6, call => {
        const ownDepth = ++depth; escaped = call;
        call.branches([{ instructionIndex: 10, decide: taken => { observed.push([ownDepth, taken]); return ownDepth > 1; } }]);
        if (asynchronous) return call.proceedAsync().finally(() => { depth--; });
        try { return call.proceed(); } finally { depth--; }
      });
      expect(asynchronous ? await vm.invokeAsync(qvmArguments([])) : vm.invoke(qvmArguments([]))).toBe(23);
      expect(nested).toBe(7); expect(observed).toEqual([[2, true], [1, true]]);
      expect(vm.addressSpace.dataView(64, 4).getInt32(0, true)).toBe(2);
      const oldCall = (): QvmFunctionCall => { if (escaped === null) throw new Error("Missing original invocation"); return escaped; };
      expect(() => oldCall().branches([])).toThrow("active");
      remove(); expect(vm.invoke(qvmArguments([]))).toBe(27);
      expect(observed).toEqual([[2, true], [1, true]]); expect(vm.stackPointer).toBe(vm.memory.length);
    }
  });
  test(`${semantics} branch decisions cancel only their current invocation and preserve unowned errors`, () => {
    for (const cancel of [false, true]) {
      const vm = new QvmInterpreter(parseQvm(conditionalSource), () => 0, undefined, null, semantics);
      vm.bindInvocation(6, call => {
        const scope = call.cancellationScope();
        call.branches([{ instructionIndex: 10, decide: (_taken, control) => {
          if (!cancel) throw null;
          try { return control.cancelFunction(scope); } catch { return false; }
        } }]);
        return call.proceed();
      });
      if (cancel) expect(vm.invoke(qvmArguments([]))).toBe(20);
      else {
        let caught = false;
        try { vm.invoke(qvmArguments([])); } catch (error) { caught = true; expect(error).toBe(null); }
        expect(caught).toBe(true);
      }
      expect(vm.addressSpace.dataView(64, 4).getInt32(0, true)).toBe(1); expect(vm.isActive).toBe(false);
    }
  });
}
test("branch registration rejects other functions, nonconditionals, duplicates, repeated binding and late binding", () => {
  for (const request of ["outside", "opcode", "duplicate", "twice", "late"]) {
    const vm = new QvmInterpreter(parseQvm(conditionalSource), () => 0);
    vm.bindInvocation(6, call => {
      if (request === "late") call.proceed();
      if (request === "twice") call.branches([]);
      const index = request === "outside" ? 15 : request === "opcode" ? 9 : 10;
      const binding = { instructionIndex: index, decide: (taken: boolean) => taken };
      call.branches(request === "duplicate" ? [binding, binding] : [binding]);
      return 0;
    });
    expect(() => vm.invoke(qvmArguments([]))).toThrow("QVM branch");
    expect(vm.isActive).toBe(false); expect(vm.stackPointer).toBe(vm.memory.length);
  }
});
