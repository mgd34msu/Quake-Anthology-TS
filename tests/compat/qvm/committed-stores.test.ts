import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmCommittedWrite } from "../../../src/compat/qvm/memory.ts";
import { QvmInterpreter } from "../../../src/compat/qvm/interpreter.ts";
import type { QvmSemantics } from "../../../src/compat/qvm/interpreter.ts";
import { parseQvm, QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { qvmArguments, QvmModule } from "../../../src/compat/qvm/module.ts";
import { qvmMemorySyscall } from "../../../src/compat/qvm/memory-syscalls.ts";
import { qvmSnapVectorSyscall } from "../../../src/compat/qvm/snap-vector-syscalls.ts";
import { qvmVectorSyscall } from "../../../src/compat/qvm/vector-syscalls.ts";
import { resolveQvmArtifact } from "../../../src/compat/qvm/artifacts.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";

type Operation = readonly [QvmOpcode, number?];
function program(operations: readonly Operation[]): Uint8Array {
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) { if (opcode === QvmOpcode.OP_ARG) code.u8(operand); else code.i32(operand); } }
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) output.i32(word);
  output.bytes(instructions); return output.finish();
}
function trapWords(words: readonly number[]): DataView { const result = new DataView(new ArrayBuffer(words.length * 4)); words.forEach((word, i) => result.setInt32(i * 4, word, true)); return result; }
const noTrap = (): never => { throw new Error("Unexpected trap"); };

test("retained writable views publish detached committed intersections with native scalar semantics", () => {
  const memory = new QvmMemory(new Uint8Array(64)), view = memory.dataView(0, 32), events: QvmCommittedWrite[] = [];
  view.setUint32(0, 0x11223344, true);
  const remove = memory.observeWrites([{ byteOffset: 1, byteLength: 2 }, { byteOffset: 2, byteLength: 2 }], event => { events.push(event); return undefined; });
  view.setUint32(0, 0xaabbccdd, true);
  expect(events[0]?.ranges).toEqual([{ byteOffset: 1, before: [0x33, 0x22, 0x11], after: [0xcc, 0xbb, 0xaa] }]);
  view.setUint8(12, 5); expect(events).toHaveLength(1);
  view.setUint16(1.75, 0x1234); expect([...memory.bytes.slice(1, 3)]).toEqual([0x12, 0x34]);
  expect(() => view.setUint32(31, 4)).toThrow(); expect(events).toHaveLength(2);
  remove(); remove(); view.setUint32(0, 0, true); expect(events[0]?.ranges[0]?.after).toEqual([0xcc, 0xbb, 0xaa]);
  memory.observeWrites([{ byteOffset: 0, byteLength: 8 }], event => { events.push(event); return undefined; });
  view.setBigUint64(0, 0x123456789abcdef0n, true); expect(view.getBigUint64(0, true)).toBe(0x123456789abcdef0n);
  memory.close(); expect(() => view.setInt8(0, 1)).toThrow("retired"); expect(() => memory.writeBytes(0, new Uint8Array(1))).toThrow("retired");
});

test("publication drains live listeners, prevents reentrant stores, and invalidates watches on lifecycle reset", () => {
  const memory = new QvmMemory(new Uint8Array(64)), view = memory.dataView(0, 4), order: string[] = [];
  let late = false;
  memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => {
    order.push("first"); expect(() => view.setInt32(0, 99, true)).toThrow("bookkeeping");
    memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => { late = true; return undefined; });
    throw new Error("publication failure");
  });
  memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], event => { order.push(`second:${event.ranges[0]?.after[0]}`); return undefined; });
  expect(() => view.setInt32(0, 7, true)).toThrow("publication failure"); expect(order).toEqual(["first", "second:7"]); expect(late).toBe(false); expect(view.getInt32(0, true)).toBe(7);
  memory.clearWriteObservers(); view.setInt32(0, 8, true); expect(order).toHaveLength(2);
  const closeLater = memory.observeWrites([{ byteOffset: 0, byteLength: 4 }], () => { late = true; return undefined; }); closeLater(); view.setInt32(0, 9, true); expect(late).toBe(false);
});

test("raw-offset bulk writes include zero, retain overlapping copy semantics and validate before mutation", () => {
  const memory = new QvmMemory(Uint8Array.from({ length: 32 }, (_, i) => i)), events: QvmCommittedWrite[] = [];
  memory.observeWrites([{ byteOffset: 0, byteLength: 32 }], event => { events.push(event); return undefined; });
  memory.copyBytes(2, 0, 6); expect([...memory.bytes.slice(0, 8)]).toEqual([0, 1, 0, 1, 2, 3, 4, 5]);
  expect(events[0]?.ranges[0]).toEqual({ byteOffset: 2, before: [2, 3, 4, 5, 6, 7], after: [0, 1, 2, 3, 4, 5] });
  memory.writeBytes(0, memory.bytes.subarray(2, 6)); expect([...memory.bytes.slice(0, 4)]).toEqual([0, 1, 2, 3]);
  memory.fillBytes(0, 2, 257); expect([...memory.bytes.slice(0, 2)]).toEqual([1, 1]);
  expect(() => memory.copyBytes(30, 0, 3)).toThrow(); expect(events).toHaveLength(3);
  expect(() => memory.dataView(-1, 1)).toThrow(); expect(() => memory.view(0, 1)).toThrow();
});

test("bytecode stores report masked aligned destinations and both source block-copy orders", () => {
  for (const semantics of ["compiled", "interpreted"] satisfies readonly QvmSemantics[]) {
    const source = program([[QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 65], [QvmOpcode.OP_CONST, 0xaa], [QvmOpcode.OP_STORE1],
      [QvmOpcode.OP_CONST, 67], [QvmOpcode.OP_CONST, 0xbbcc], [QvmOpcode.OP_STORE2], [QvmOpcode.OP_CONST, 71], [QvmOpcode.OP_CONST, 0x11223344], [QvmOpcode.OP_STORE4],
      [QvmOpcode.OP_CONST, 80], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_BLOCK_COPY, 8], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 0]]);
    const vm = new QvmInterpreter(parseQvm(source), noTrap, undefined, null, semantics), events: QvmCommittedWrite[] = [];
    vm.addressSpace.observeWrites([{ byteOffset: 64, byteLength: 24 }], event => { events.push(event); return undefined; });
    vm.invoke(qvmArguments([]));
    expect(events.flatMap(event => event.ranges.map(range => range.byteOffset))).toEqual(semantics === "compiled" ? [65, 66, 68, 80] : [65, 66, 68, 84, 80]);
    expect([...vm.memory.slice(80, 88)]).toEqual([0, 0xaa, 0xcc, 0xbb, 0x44, 0x33, 0x22, 0x11]);
    vm.restoreData(vm.memory.slice()); vm.addressSpace.dataView(64, 4).setInt32(0, 1, true); expect(events).toHaveLength(semantics === "compiled" ? 4 : 5);
  }
});

test("memory and numeric intrinsics publish exact writes with aliased scalar inputs", () => {
  const memory = new QvmMemory(new Uint8Array(256)), events: QvmCommittedWrite[] = [], view = memory.dataView(0, 256);
  memory.writeBytes(32, Uint8Array.of(4, 3, 2, 1));
  memory.observeWrites([{ byteOffset: 64, byteLength: 40 }], event => { events.push(event); return undefined; });
  qvmMemorySyscall("game", trapWords([101, 64, 32, 4]), memory); expect(events[0]?.ranges[0]?.after).toEqual([4, 3, 2, 1]);
  qvmMemorySyscall("game", trapWords([100, 64, 7, 4]), memory); expect(events[1]?.ranges[0]?.after).toEqual([7, 7, 7, 7]);
  expect(() => qvmMemorySyscall("game", trapWords([101, 65, 64, 4]), memory)).toThrow("Overlapping");
  view.setFloat32(64, 1.5, true); view.setFloat32(68, 2.5, true); view.setFloat32(72, -1.5, true); events.length = 0;
  qvmSnapVectorSyscall("game", trapWords([42, 64]), memory); expect(events.map(event => event.ranges[0]?.byteOffset)).toEqual([64, 68, 72]);
  expect([view.getFloat32(64, true), view.getFloat32(68, true), view.getFloat32(72, true)]).toEqual([2, 2, -2]);
  view.setFloat32(64, 0, true); view.setFloat32(68, 0, true); view.setFloat32(72, 0, true); events.length = 0;
  qvmVectorSyscall("game", trapWords([108, 64, 64, 76, 88]), memory); expect(events).toHaveLength(9); expect(view.getFloat32(64, true)).toBe(1); expect(view.getFloat32(84, true)).toBe(-0);
});

test("module, syscall and guest bridge share one observer owner and publication rejects VM entry", () => {
  const source = program([[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16]]);
  const artifact = resolveQvmArtifact({ role: "qagame", bytes: source, module: { id: "test:stores", artifactPath: "vm/qagame.qvm", revision: "test", digest: createContentDigest(new Bun.CryptoHasher("sha256").update(source).digest("hex")) } });
  if (artifact.kind !== "bytecode") throw new Error("Expected bytecode");
  const events: QvmCommittedWrite[] = [];
  const module = new QvmModule({ artifact, host: call => { expect(call.guest).toBe(module.memory); call.guest.view(64, 4).setInt32(0, 12, true); return 0; } });
  const reference = { kind: "qvm", module: artifact.module, instructionIndex: 0 } satisfies import("../../../src/contracts/execution.ts").GuestCallbackReference;
  module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], event => {
    events.push(event);
    module.observeFunction(reference, () => undefined)();
    expect(() => module.call([])).toThrow("bookkeeping");
    expect(() => module.interpreter.invoke(qvmArguments([]))).toThrow();
    expect(() => module.memory.view(64, 4).setInt32(0, 99, true)).toThrow("bookkeeping");
    return undefined;
  });
  module.call([]); const address = module.guestMemory.pointer(64n); if (address === null) throw new Error("Missing address");
  module.guestMemory.write(address, Uint8Array.of(14, 0, 0, 0)); expect(events).toHaveLength(2); expect(events[1]?.ranges[0]?.before).toEqual([12, 0, 0, 0]);
  const retained = module.guestMemory.borrow(address, 4); module.retire(); expect(() => retained.setInt32(0, 0, true)).toThrow("retired");
  expect(() => module.observeFunction(reference, () => undefined)).toThrow("retired");
  expect(() => module.interpreter.observeFunction(0, () => undefined)).toThrow("retired");
});

test("retired allocations reject raw interpreter restore and restart before changing bytes", () => {
  const image = parseQvm(program([[QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 0]]));
  const vm = new QvmInterpreter(image, noTrap), changed = vm.memory.slice();
  vm.addressSpace.dataView(0, 1).setUint8(0, 27); changed[0] = 123;
  vm.addressSpace.close();
  expect(() => vm.restoreData(changed)).toThrow("retired"); expect(vm.memory[0]).toBe(27);
  expect(() => vm.restart(image)).toThrow("retired"); expect(vm.memory[0]).toBe(27);
  expect(() => vm.invoke(qvmArguments([]))).toThrow("retired"); expect(vm.memory[0]).toBe(27);
});
