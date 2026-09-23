import { expect, test } from "bun:test";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import { QvmModule, QvmOpcode, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import type { QvmCancellationScope, QvmHost } from "../../../src/compat/qvm/index.ts";

function sourceModule(operations: readonly (readonly [QvmOpcode, number?])[] = [
    [QvmOpcode.OP_ENTER, 64], [QvmOpcode.OP_LOCAL, 56], [QvmOpcode.OP_CONST, 123], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_LOCAL, 56], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 64],
    [QvmOpcode.OP_ENTER, 64], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 64],
  ], host: QvmHost = rejectQvmSyscall): QvmModule {
  const code = new BinaryWriter(128);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) code.i32(operand); }
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) output.i32(word);
  output.bytes(instructions); const bytes = output.finish();
  const artifact = resolveQvmArtifact({ role: "qagame", bytes, module: { id: "test:store-effects", artifactPath: "vm/qagame.qvm", revision: "test", digest: digestBytes(bytes) } });
  if (artifact.kind !== "bytecode") throw new Error("Expected QVM artifact");
  return new QvmModule({ artifact, host });
}

test("committed QVM effects follow all immutable observers and nested stores retain their own event", () => {
  const memory = new QvmMemory(new Uint8Array(64)), view = memory.dataView(0, 4), order: string[] = [];
  let nested = false;
  memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], event => {
    order.push(`read-a:${event.ranges[0]?.after[0]}`);
    expect(() => view.setInt32(0, 9, true)).toThrow("bookkeeping"); return undefined;
  }, event => {
    order.push(`effect-a:${event.ranges[0]?.after[0]}`);
    if (!nested) { nested = true; view.setInt32(0, 2, true); }
    expect(event.ranges[0]?.after[0]).toBe(event.sequence === 1 ? 1 : 2); return undefined;
  });
  memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], event => { order.push(`read-b:${event.ranges[0]?.after[0]}`); return undefined; }, event => {
    order.push(`effect-b:${event.ranges[0]?.after[0]}`); return undefined;
  });
  view.setInt32(0, 1, true);
  expect(order).toEqual(["read-a:1", "read-b:1", "effect-a:1", "read-a:2", "read-b:2", "effect-a:2", "effect-b:2", "effect-b:1"]);
  expect(view.getInt32(0, true)).toBe(2);
});

test("failed publication preserves bytes without effects, while disposal and retirement cancel pending effects", () => {
  const memory = new QvmMemory(new Uint8Array(64)), view = memory.dataView(0, 4);
  let effects = 0;
  const failed = memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => { throw null; }, () => { effects++; return undefined; });
  let caught = false;
  try { view.setInt32(0, 7, true); } catch (error) { caught = true; expect(error).toBeNull(); }
  expect(caught).toBe(true); expect(view.getInt32(0, true)).toBe(7); expect(effects).toBe(0); failed();
  let remove = () => undefined;
  memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => { remove(); return undefined; }, () => { memory.close(); return undefined; });
  remove = memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => undefined, () => { effects++; return undefined; });
  memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => undefined, () => { effects++; return undefined; });
  view.setInt32(0, 8, true); expect(effects).toBe(0); expect(view.getInt32(0, true)).toBe(8);
});

test("post-store nested calls preserve original locals and cancellation uses the current source ancestry", async () => {
  for (const asynchronous of [false, true]) {
    const module = sourceModule(); let capability: QvmCancellationScope | null = null;
    module.bindInvocation({ kind: "qvm", module: module.profile.module, instructionIndex: 0 }, call => {
      capability = call.cancellationScope(); return asynchronous ? call.proceedAsync() : call.proceed();
    });
    const remove = module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], () => {
      expect(() => module.call([], 12)).toThrow("bookkeeping"); return undefined;
    }, () => { expect(module.call([], 12)).toBe(7); return undefined; });
    const invoke = () => asynchronous ? module.callAsync([]) : module.call([]);
    try {
      expect(await invoke()).toBe(128); remove();
      module.bindInvocation({ kind: "qvm", module: module.profile.module, instructionIndex: 12 }, call => {
        if (capability === null) throw new Error("Missing source scope");
        return call.cancelFunction(capability);
      });
      module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], () => undefined, () => {
        try { module.call([], 12); } catch { /* Cancellation still owns the original source call. */ }
        return undefined;
      });
      expect(await invoke()).toBe(0);
      expect(module.interpreter.stackPointer).toBe(module.memory.bytes.length);
      expect(module.interpreter.isActive).toBe(false);
    } finally { module.retire(); }
  }
});

test("post-store async entry is rejected before a child starts even when its caller is asynchronous", async () => {
  const module = sourceModule(); let child: Promise<number> | null = null;
  module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], () => undefined, () => {
    child = module.callAsync([], 12); void child.catch(() => {}); return undefined;
  });
  try {
    await expect(module.callAsync([])).rejects.toThrow("store effects cannot start asynchronous calls");
    if (child === null) throw new Error("Missing attempted child");
    await expect(child).rejects.toThrow("store effects cannot start asynchronous calls");
    expect(module.interpreter.isActive).toBe(false);
  } finally { module.retire(); }
});

test("host stores cannot borrow the invocation of a suspended asynchronous child", async () => {
  const gate = Promise.withResolvers<number>();
  const module = sourceModule([
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -2], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 0],
  ], call => {
    if (call.code === 1) return gate.promise;
    const child = module.callAsync([], 4);
    module.memory.dataView(64, 4).setInt32(0, 1, true);
    return child;
  });
  let effects = 0;
  const remove = module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], () => undefined, () => {
    effects++; expect(() => module.call([], 8)).toThrow(); return undefined;
  });
  try {
    const pending = module.callAsync([]);
    expect(effects).toBe(1);
    module.memory.dataView(64, 4).setInt32(0, 2, true); expect(effects).toBe(2);
    gate.resolve(3); expect(await pending).toBe(3);
    remove(); expect(module.call([], 8)).toBe(7);
  } finally { remove(); module.retire(); }
});
