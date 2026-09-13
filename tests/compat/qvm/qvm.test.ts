import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { QvmOpcode, parseQvm, parseQvmRestart, QvmInterpreter, QvmMemory, QvmGameData, QvmModule,
  qvmArguments, resolveQvmArtifact, createQvmSystemCall, rejectQvmSyscall, QvmUnboundSyscallError, QvmUi, QvmCgame,
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
        expect(await vm.invokeAsync(args)).toBe(role === "ui" ? pack.startsWith("baseq3/") ? 4 : 6 : -1);
        if (role === "ui") {
          const module = new QvmModule({ artifact, host });
          expect(module.profile.api).toEqual({ kind: "q3-ui", version: pack.startsWith("baseq3/") ? 4 : 6 });
          expect((await QvmModule.create({ artifact, host })).profile.api).toEqual(module.profile.api);
        }
      }
    } finally { archive.close(); }
  });
}

function deferredWord() {
  let resolve: (value: number) => void = () => { throw new Error("Deferred word not initialized"); };
  let reject: (error: unknown) => void = () => { throw new Error("Deferred word not initialized"); };
  const promise = new Promise<number>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

describe("QVM asynchronous traps", () => {
  test("one opcode continuation resumes after each trap and excludes unrelated entry", async () => {
    const first = deferredWord(), second = deferredWord();
    let calls = 0;
    const vm = new QvmInterpreter(parseQvm(bytes([
      [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL],
      [QvmOpcode.OP_CONST, -2], [QvmOpcode.OP_CALL], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 16],
    ])), () => ++calls === 1 ? first.promise : second.promise);
    const pending = vm.invokeAsync(qvmArguments([]));
    expect(vm.isActive).toBe(true);
    expect(() => vm.invoke(qvmArguments([]))).toThrow("already active");
    await expect(vm.invokeAsync(qvmArguments([]))).rejects.toThrow("already active");
    expect(() => vm.restoreData(vm.memory.slice())).toThrow("active QVM");
    first.resolve(12);
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(2);
    second.resolve(30);
    expect(await pending).toBe(42);
    expect(vm.isActive).toBe(false);
    expect(vm.stackPointer).toBe(vm.memory.length);
  });

  test("async syscall capability owns reentry and drains an unawaited child", async () => {
    let escaped: QvmSyscall | null = null;
    const children: Promise<number>[] = [];
    const vm = new QvmInterpreter(parseQvm(bytes(recursiveProgram)), call => {
      escaped = call;
      children.push(call.invokeAsync(qvmArguments([1])));
      expect(() => call.invoke(qvmArguments([1]))).toThrow("pending child");
      return 90;
    });
    expect(await vm.invokeAsync(qvmArguments([0]))).toBe(90);
    expect(await children[0]).toBe(77);
    const call = (): QvmSyscall => { if (escaped === null) throw new Error("Missing syscall"); return escaped; };
    await expect(call().invokeAsync(qvmArguments([1]))).rejects.toThrow("active syscall");
    expect(vm.isActive).toBe(false);
  });

  test("ignored child failure still unwinds the parent", async () => {
    const vm = new QvmInterpreter(parseQvm(bytes(recursiveProgram)), call => {
      void call.invokeAsync(qvmArguments([1]), 999);
      return 90;
    });
    await expect(vm.invokeAsync(qvmArguments([0]))).rejects.toThrow("invalid QVM instruction index");
    expect(vm.isActive).toBe(false);
    expect(vm.stackPointer).toBe(vm.memory.length);
    expect(vm.invoke(qvmArguments([1]))).toBe(77);
  });

  test("trap rejection and stale continuation both restore execution ownership", async () => {
    const trap = deferredWord();
    const vm = new QvmInterpreter(parseQvm(bytes(recursiveProgram)), () => trap.promise);
    const pending = vm.invokeAsync(qvmArguments([0]));
    trap.reject(new Error("Registration failed"));
    await expect(pending).rejects.toThrow("Registration failed");
    expect(vm.invoke(qvmArguments([1]))).toBe(77);
    let current = true;
    const stale = new QvmInterpreter(parseQvm(bytes(recursiveProgram)), () => Promise.resolve(42));
    const continuation = stale.invokeAsync(qvmArguments([0]), 0, () => { if (!current) throw new Error("Stale generation"); });
    current = false;
    await expect(continuation).rejects.toThrow("Stale generation");
    expect(stale.isActive).toBe(false);
    expect(stale.stackPointer).toBe(stale.memory.length);
  });

  test("sync callers reject async traps and invalidate escaped capabilities", async () => {
    let escaped: QvmSyscall | null = null;
    const trap = deferredWord();
    const vm = new QvmInterpreter(parseQvm(bytes(recursiveProgram)), call => { escaped = call; return trap.promise; });
    expect(() => vm.invoke(qvmArguments([0]))).toThrow("asynchronous syscall");
    expect(vm.isActive).toBe(false);
    const call = (): QvmSyscall => { if (escaped === null) throw new Error("Missing syscall"); return escaped; };
    await expect(call().invokeAsync(qvmArguments([1]))).rejects.toThrow("active syscall");
    trap.reject(new Error("Late async failure is consumed"));
    await Promise.resolve();
    expect(vm.invoke(qvmArguments([1]))).toBe(77);
  });

  test("module commands retain arguments across awaits and retirement stops resume", async () => {
    const source = bytes(recursiveProgram), artifact = resolveQvmArtifact({ module: identity(source, "cgame"), role: "cgame", bytes: source });
    if (artifact.kind !== "bytecode") throw new Error("Unexpected replacement");
    const trap = deferredWord();
    const arguments_: (readonly string[] | null)[] = [];
    const module = new QvmModule({ artifact, host: async call => { await trap.promise; arguments_.push(call.commandArguments); return 42; } });
    const pending = module.commandAsync([0], ["test", "argument"]);
    await expect(module.commandAsync([0], ["unrelated"])).rejects.toThrow("already active");
    module.retire();
    trap.resolve(1);
    await expect(pending).rejects.toThrow("retired");
    expect(arguments_).toEqual([["test", "argument"]]);
    expect(module.interpreter.isActive).toBe(false);
  });
});


test("UI async factory validates a suspended API query before publishing the module", async () => {
  const source = bytes([[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, -1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16]]);
  const artifact = resolveQvmArtifact({ module: identity(source, "ui"), role: "ui", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Unexpected replacement");
  const options = { artifact, host: () => Promise.resolve(6) };
  const module = await QvmModule.create(options);
  expect(module.profile.api).toEqual({ kind: "q3-ui", version: 6 });
  expect(() => new QvmModule(options)).toThrow("asynchronous syscall");
  const seat = createIdentityOwner("qvm-ui").seat(0);
  const ui = await QvmUi.create(seat, options, () => undefined);
  expect(await ui.isFullscreen()).toBe(true);
  await expect(QvmModule.create({ artifact, host: () => Promise.resolve(5) })).rejects.toThrow("expected 6");
});

test("cgame validates generation before resuming initialization and never primes stale state", async () => {
  const source = bytes(recursiveProgram), artifact = resolveQvmArtifact({ module: identity(source, "cgame"), role: "cgame", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Unexpected replacement");
  const trap = deferredWord();
  let generation = 1, primes = 0;
  const cgame = new QvmCgame(createIdentityOwner("qvm-cgame").seat(0), { artifact, host: () => trap.promise }, {
    assertCurrentOperation: () => undefined,
    current: () => ({ generation, serverMessageNumber: 7, dropped: null }),
    beginLoading: () => undefined,
    prime: () => { primes++; return undefined; },
  });
  const pending = cgame.init(7, 0, 0);
  generation++;
  trap.resolve(0);
  await expect(pending).rejects.toThrow("stale engine gamestate");
  expect(primes).toBe(0);
  expect(cgame.module.interpreter.isActive).toBe(false);
  await expect(cgame.drawActiveFrame(0, "center", false)).rejects.toThrow("retired");
});

test("awaited host keeps only its syscall capability open and drains a suspended child", async () => {
  const enter = deferredWord(), childTrap = deferredWord();
  const source = bytes([
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_EQ, 8],
    [QvmOpcode.OP_CONST, -7], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_CONST, -6], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
  ]);
  const children: Promise<number>[] = [];
  const vm = new QvmInterpreter(parseQvm(source), async call => {
    if (call.words.getInt32(0, true) === 6) return await childTrap.promise;
    await enter.promise;
    children.push(call.invokeAsync(qvmArguments([1])));
    return 90;
  });
  let completed = false;
  const pending = vm.invokeAsync(qvmArguments([0])).then(value => { completed = true; return value; });
  enter.resolve(0);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(vm.isActive).toBe(true);
  expect(completed).toBe(false);
  childTrap.resolve(77);
  expect(await pending).toBe(90);
  expect(await children[0]).toBe(77);
  expect(vm.stackPointer).toBe(vm.memory.length);
});

for (const staleOwner of ["parent", "child"]) {
  test(`nested calls preserve ${staleOwner} validation before resuming guest writes`, async () => {
    const gate = deferredWord();
    let parentCurrent = true, childCurrent = true;
    const source = bytes([
      [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_EQ, 13],
      [QvmOpcode.OP_CONST, -7], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP],
      [QvmOpcode.OP_CONST, 256], [QvmOpcode.OP_CONST, 99], [QvmOpcode.OP_STORE4],
      [QvmOpcode.OP_CONST, 77], [QvmOpcode.OP_LEAVE, 16],
      [QvmOpcode.OP_CONST, -6], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
    ]);
    const artifact = resolveQvmArtifact({ module: identity(source, "cgame"), role: "cgame", bytes: source });
    if (artifact.kind !== "bytecode") throw new Error("Unexpected replacement");
    let module: QvmModule;
    module = new QvmModule({ artifact, host: call => call.code === 6 ? gate.promise
      : module.callAsync([1], 0, () => { if (!childCurrent) throw new Error("child stale"); }) });
    const pending = module.callAsync([0], 0, () => { if (!parentCurrent) throw new Error("parent stale"); });
    if (staleOwner === "parent") parentCurrent = false;
    else childCurrent = false;
    gate.resolve(0);
    await expect(pending).rejects.toThrow(`${staleOwner} stale`);
    expect(module.memory.view(256, 4).getInt32(0, true)).toBe(0);
    expect(module.interpreter.isActive).toBe(false);
    expect(module.interpreter.stackPointer).toBe(module.memory.bytes.length);
  });
}

test("throwing host drains its child before restart and restore", async () => {
  const gate = deferredWord(), source = bytes(recursiveProgram);
  let calls = 0;
  const vm = new QvmInterpreter(parseQvm(source), call => {
    if (++calls === 1) {
      void call.invokeAsync(qvmArguments([0]));
      throw new Error("parent failed");
    }
    return gate.promise;
  });
  const pending = vm.invokeAsync(qvmArguments([0]));
  expect(vm.isActive).toBe(true);
  gate.resolve(33);
  await expect(pending).rejects.toThrow("parent failed");
  expect(vm.isActive).toBe(false);
  expect(vm.stackPointer).toBe(vm.memory.length);
  vm.restart(parseQvmRestart(source));
  vm.restoreData(vm.memory.slice());
  expect(vm.invoke(qvmArguments([1]))).toBe(77);
});
