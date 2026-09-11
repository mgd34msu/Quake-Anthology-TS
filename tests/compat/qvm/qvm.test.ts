import { describe, expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { QvmOpcode, parseQvm, parseQvmRestart, QvmInterpreter, QvmMemory, QvmGameData, QvmModule,
  qvmArguments, resolveQvmArtifact, createQvmSystemCall, rejectQvmSyscall, QvmUnboundSyscallError,
} from "../../../src/compat/qvm/index.ts";
import type { QvmArguments, QvmRole, QvmHost, QvmSyscall } from "../../../src/compat/qvm/index.ts";
import type { ModuleIdentity } from "../../../src/contracts/execution.ts";

type Operation = readonly [QvmOpcode, number?];
function bytes(operations: readonly Operation[], words: readonly number[] = []): Uint8Array {
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) {
    code.u8(opcode);
    if (operand !== undefined) {
      if (opcode === QvmOpcode.OP_ARG) code.u8(operand);
      else code.i32(operand);
    }
  }
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length + words.length * 4);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, words.length * 4, 0, 4096 - words.length * 4]) output.i32(word);
  output.bytes(instructions);
  for (const word of words) output.i32(word);
  return output.finish();
}
function identity(data: Uint8Array, role: QvmRole): ModuleIdentity {
  return { id: `test:${role}`, artifactPath: `vm/${role}.qvm`, revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(data).digest("hex")) };
}
function noTrap(): never { throw new Error("Unexpected syscall"); }

const recursiveProgram: readonly Operation[] = [
  [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_EQ, 7],
  [QvmOpcode.OP_CONST, 77], [QvmOpcode.OP_LEAVE, 16],
  [QvmOpcode.OP_LOCAL, 28], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 8], [QvmOpcode.OP_CONST, -6], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
];

describe("QVM execution", () => {
  test("nested host entry finishes synchronously and expired syscall scopes reject", () => {
    const order: string[] = [];
    let escaped: QvmSyscall | null = null;
    const vm = new QvmInterpreter(parseQvm(bytes(recursiveProgram)), call => {
      escaped = call;
      order.push("before");
      expect(call.words.getInt32(0, true)).toBe(5);
      expect(call.words.getInt32(4, true)).toBe(123);
      const value = call.invoke(qvmArguments([1]));
      order.push("after");
      expect(value).toBe(77);
      return value + 1;
    });
    expect(vm.invoke(qvmArguments([0, 123]))).toBe(78);
    expect(order).toEqual(["before", "after"]);
    const getEscaped = (): QvmSyscall => { if (escaped === null) throw new Error("No syscall"); return escaped; };
    expect(() => getEscaped().invoke(qvmArguments([1]))).toThrow("active syscall");
    expect(vm.isActive).toBe(false);
  });

  test("source restart restores data and BSS while retaining prepared code and aliases", () => {
    const source = bytes([[QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 4], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LEAVE, 0]], [0, 12]);
    const vm = new QvmInterpreter(parseQvm(source), noTrap);
    const alias = new QvmMemory(vm.memory).view(4, 4);
    alias.setInt32(0, 99, true);
    vm.memory[300] = 8;
    expect(vm.invoke(qvmArguments([]))).toBe(99);
    vm.restart(parseQvmRestart(source));
    expect(vm.invoke(qvmArguments([]))).toBe(12);
    expect(alias.getInt32(0, true)).toBe(12);
    expect(vm.memory[300]).toBe(0);
  });

  test("raw game data respects custom strides, live aliases and the player-state tail", () => {
    const memory = new QvmMemory(new Uint8Array(8192)), table = new QvmGameData(memory);
    table.locate(64, 2, 700, 4096, 600);
    const entity = table.entity(1);
    entity.r.currentOrigin = { x: 1, y: 2, z: 3 };
    expect(memory.view(64 + 700 + 488, 12).getFloat32(8, true)).toBe(3);
    table.entityBytes(1).setUint32(650, 0xdeadbeef, true);
    entity.s.number = 1;
    expect(table.entityBytes(1).getUint32(650, true)).toBe(0xdeadbeef);
    table.setPlayerPing(1, 45);
    expect(table.copyPlayerState(1).pingMilliseconds).toBe(45);
    expect(table.numberFromPointer(64 + 700)).toBe(1);
    table.locate(2048, 2, 700, 4096, 600);
    entity.s.number = 91;
    expect(memory.view(64 + 700, 4).getInt32(0, true)).toBe(91);
    expect(table.entity(1).s.number).toBe(0);
  });

  test("module checkpoints retain private data and require matching artifact identity", () => {
    const source = bytes([[QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_LEAVE, 0]]);
    const moduleIdentity = identity(source, "qagame");
    const artifact = resolveQvmArtifact({ module: moduleIdentity, role: "qagame", bytes: source });
    if (artifact.kind !== "bytecode") throw new Error("Unexpected replacement");
    let external = 4;
    const vm = new QvmModule({ artifact, host: rejectQvmSyscall, hostState: {
      checkpoint: () => ({ state: { module: moduleIdentity, format: "test:counter", bytes: Uint8Array.of(external) }, random: [], callbacks: [] }),
      restore: state => { external = state.state.bytes[0] ?? 0; },
    } });
    vm.memory.bytes[256] = 77;
    const snapshot = vm.checkpoint();
    vm.memory.bytes[256] = 10; external = 20;
    vm.restore(snapshot);
    expect(vm.memory.bytes[256]).toBe(77);
    expect(external).toBe(4);
    expect(vm.call([])).toBe(7);
    expect(() => vm.restore({ ...snapshot, module: { ...moduleIdentity, revision: "other" } })).toThrow("mismatch");
  });

  test("unknown engine traps fail instead of reporting successful zero", () => {
    const vm = new QvmInterpreter(parseQvm(bytes([[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -9001], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16]])), createQvmSystemCall("cgame"));
    expect(() => vm.invoke(qvmArguments([]))).toThrow(QvmUnboundSyscallError);
  });
});

const retailPacks = ["baseq3/pak8.pk3", "missionpack/pak0.pk3"];
for (const pack of retailPacks) {
  test(`real QVM bytecode from ${pack}`, async () => {
    const archive = await openArchive(`/home/buzzkill/Projects/qfiles/q3a/${pack}`);
    try {
      const roles: readonly QvmRole[] = ["qagame", "cgame", "ui"];
      for (const role of roles) {
        const entry = archive.findEntries(`vm/${role}.qvm`)[0];
        if (entry === undefined) throw new Error(`Missing real ${role} QVM`);
        const source = await archive.readEntry(entry);
        const artifact = resolveQvmArtifact({ module: identity(source, role), role, bytes: source });
        expect(artifact.known?.role).toBe(role);
        if (artifact.kind !== "bytecode") throw new Error("No replacement was registered");
        const host: QvmHost = call => { throw new Error(`Unexpected ${call.role} syscall ${call.code}`); };
        const vm = new QvmInterpreter(artifact.image, createQvmSystemCall(role, host));
        const args: QvmArguments = qvmArguments([role === "ui" ? 0 : role === "cgame" ? 5 : 999]);
        expect(vm.invoke(args)).toBe(role === "ui" ? pack.startsWith("baseq3/") ? 4 : 6 : -1);
        if (role === "ui") {
          const module = new QvmModule({ artifact, host });
          expect(module.profile.api).toEqual({ kind: "q3-ui", version: pack.startsWith("baseq3/") ? 4 : 6 });
        }
      }
    } finally { archive.close(); }
  });
}
