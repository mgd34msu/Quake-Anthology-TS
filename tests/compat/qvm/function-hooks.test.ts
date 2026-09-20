import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { QvmInterpreter, QvmModule, QvmOpcode, parseQvm, parseQvmRestart, qvmArguments, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import type { QvmFunctionCall, QvmFunctionHook } from "../../../src/compat/qvm/index.ts";

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
