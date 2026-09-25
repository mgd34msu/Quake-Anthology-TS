import { float32ToBits } from "../../../src/core/numeric.ts";
import { QvmGame } from "../../../src/compat/qvm/game.ts";
import { QvmCombatBindings } from "../../../src/compat/qvm/game-combat-binding.ts";
import { readQvmPrimaryCombat } from "../../../src/compat/qvm/primary-player-profile.ts";
import { SaveReader } from "../../../src/persistence/value.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { SessionActorRegistry, ActorCallbackTable, SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/index.ts";
import { GameplayAuthority } from "../../../src/world/gameplay/authority.ts";
import type { DamageOutcome } from "../../../src/contracts/gameplay.ts";
import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { QvmInterpreter, QvmModule, QvmOpcode, parseQvm, parseQvmRestart, qvmArguments, rejectQvmSyscall, resolveQvmArtifact } from "../../../src/compat/qvm/index.ts";
import type { QvmCancellationScope, QvmFunctionCall, QvmFunctionHook } from "../../../src/compat/qvm/index.ts";
import type { QvmRegionControl } from "../../../src/compat/qvm/interpreter.ts";

type Operation = readonly [QvmOpcode, number?];
function bytecode(operations: readonly Operation[], bssLength = 4096): Uint8Array {
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) {
    code.u8(opcode);
    if (operand !== undefined) {
      if (opcode === QvmOpcode.OP_ARG) code.u8(operand);
      else code.i32(operand);
    }
  }
  const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, bssLength]) output.i32(word);
  output.bytes(instructions);
  return output.finish();
}
function unexpectedTrap(): never { throw new Error("Unexpected syscall"); }

const regionSource = bytecode([
  [QvmOpcode.OP_ENTER, 32], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_STORE4],
  [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 3], [QvmOpcode.OP_ADD], [QvmOpcode.OP_STORE4],
  [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LEAVE, 32],
]);
for (const semantics of ["interpreted", "compiled"] satisfies readonly import("../../../src/compat/qvm/interpreter.ts").QvmSemantics[]) {
  test(`${semantics} original regions retain frame locals and isolate nested execution and skip`, async () => {
    for (const asynchronous of [false, true]) {
      const vm = new QvmInterpreter(parseQvm(regionSource), unexpectedTrap, undefined, null, semantics);
      let depth = 0, completions = 0;
      const controls: QvmRegionControl[] = [];
      vm.bindInvocation(0, call => {
        const outer = depth++ === 0;
        call.regions([{ entry: 4, join: 10, run: control => {
          controls.push(control); expect(control.localWord(24)).toBe(7);
          if (outer) {
            expect(control.invoke(qvmArguments([]))).toBe(10);
            expect(control.localWord(24)).toBe(7);
            return "skip";
          }
          return "execute";
        }, completed: control => { completions++; expect(control.localWord(24)).toBe(10); } }]);
        const result = call.execution === "asynchronous" ? call.proceedAsync() : call.proceed();
        if (typeof result !== "number") return result.finally(() => { depth--; });
        depth--; return result;
      });
      expect(asynchronous ? await vm.invokeAsync(qvmArguments([])) : vm.invoke(qvmArguments([]))).toBe(7);
      expect(completions).toBe(1); expect(controls).toHaveLength(2);
      for (const control of controls) expect(() => control.localWord(24)).toThrow();
      expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);
    }
  });
}

test("original regions reject incompatible operands and keep caught scope failures sticky", () => {
  for (const [entry, join] of [[6, 10], [4, 9], [4, 13], [0, 10]]) {
    const vm = new QvmInterpreter(parseQvm(regionSource), unexpectedTrap);
    vm.bindInvocation(0, call => {
      if (entry === undefined || join === undefined) throw new Error("Missing region boundary");
      call.regions([{ entry, join, run: () => "skip" }]); return call.proceed();
    });
    expect(() => vm.invoke(qvmArguments([]))).toThrow("QVM region");
    expect(vm.stackPointer).toBe(vm.memory.length);
  }
  const vm = new QvmInterpreter(parseQvm(regionSource), unexpectedTrap);
  vm.bindInvocation(0, call => {
    call.regions([{ entry: 4, join: 10, run: control => {
      try { control.localWord(32); } catch { /* The invalid access remains a failed source scope. */ }
      return "execute";
    } }]); return call.proceed();
  });
  expect(() => vm.invoke(qvmArguments([]))).toThrow("local is outside");
  expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);
});

test("original region cancellation preserves the caller and skips its source continuation", () => {
  const vm = new QvmInterpreter(parseQvm(regionSource), unexpectedTrap);
  let completed = false;
  vm.bindInvocation(0, call => {
    const cancellation = call.cancellationScope();
    call.regions([{ entry: 4, join: 10, run: control => control.cancelFunction(cancellation), completed: () => { completed = true; } }]);
    return call.proceed();
  });
  expect(vm.invoke(qvmArguments([]))).toBe(0); expect(completed).toBe(false);
  expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);
});

test("standalone original region consumes only explicit live-ins and preserves caller stack", () => {
  const vm = new QvmInterpreter(parseQvm(regionSource), unexpectedTrap);
  const remove = vm.bindInvocation(0, call => call.evaluateRegion({ entry: 4, join: 10, inputs: [24], result: 24 }, [19]));
  expect(vm.invoke(qvmArguments([]))).toBe(22); expect(vm.stackPointer).toBe(vm.memory.length);
  remove();
  vm.bindInvocation(0, call => call.evaluateRegion({ entry: 4, join: 10, inputs: [], result: 24 }, []));
  expect(() => vm.invoke(qvmArguments([]))).toThrow("undeclared source local 24");
  expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);
});

test("read-only original regions use live memory without replacing existing entry ownership", () => {
  const source = bytecode([
    [QvmOpcode.OP_ENTER, 32], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LEAVE, 32],
  ], 2049);
  const identity = { id: "test:read-only", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(source).digest("hex")) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module: identity, role: "qagame", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Missing original region bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall });
  const region = { entry: 1, join: 5, inputs: [], result: 24 };
  let entered = 0;
  module.bindInvocation({ kind: "qvm", module: identity, instructionIndex: 0 }, call => {
    entered++; expect(module.evaluateRegion([], 0, region, [])).toBe(77); return call.proceed();
  });
  module.memory.dataView(64, 4).setInt32(0, 31, true);
  expect(module.evaluateRegion([], 0, region, [])).toBe(31); expect(entered).toBe(0);
  module.memory.dataView(64, 4).setInt32(0, 77, true);
  expect(module.call([])).toBe(77); expect(entered).toBe(1);
  expect(module.memory.dataView(64, 4).getInt32(0, true)).toBe(77);
  expect(module.interpreter.stackPointer).toBe(module.memory.bytes.length);
  module.retire();
  const mutating = new QvmInterpreter(parseQvm(bytecode([
    [QvmOpcode.OP_ENTER, 32], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 12], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 32],
  ])), unexpectedTrap);
  expect(() => mutating.invoke(qvmArguments([]), 0, { region: { entry: 1, join: 4, inputs: [], result: null }, inputs: [] })).toThrow("cannot write outside");
  expect(new DataView(mutating.memory.buffer).getInt32(64, true)).toBe(0);
});

test("invocation effects restore current module reentry after await and expire with their call", async () => {
  const identity = { id: "test:effects", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(regionSource).digest("hex")) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module: identity, role: "qagame", bytes: regionSource });
  if (artifact.kind !== "bytecode") throw new Error("Missing bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall });
  const retained: QvmFunctionCall[] = [];
  let depth = 0;
  module.bindInvocation({ kind: "qvm", module: identity, instructionIndex: 0 }, call => {
    retained.push(call);
    if (depth !== 0) return call.proceed();
    return (async () => {
      const result = await call.proceedAsync();
      call.effect(() => {
        depth++;
        try { expect(module.call([])).toBe(10); }
        finally { depth--; }
        return undefined;
      });
      return result;
    })();
  });
  try {
    expect(await module.callAsync([])).toBe(10);
    expect(retained).toHaveLength(2);
    for (const call of retained) expect(() => call.effect(() => undefined)).toThrow("active syscall or function hook");
    expect(module.interpreter.isActive).toBe(false);
    expect(module.interpreter.stackPointer).toBe(module.memory.bytes.length);
  } finally { module.retire(); }
});

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


test("source counter queries isolate their word, preserve hooks and reject unrelated or partial stores", () => {
  const source = bytecode([
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_LOAD4],
    [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_ADD], [QvmOpcode.OP_STORE4], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 16],
  ], 2049);
  const identity = { id: "test:counter", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(source).digest("hex")) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module: identity, role: "qagame", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Missing source counter bytecode");
  const module = new QvmModule({ artifact, host: rejectQvmSyscall });
  let hooks = 0, stores = 0;
  module.memory.dataView(64, 4).setInt32(0, 13, true);
  module.memory.observeWrites([{ byteOffset: 64, byteLength: 4 }], () => { stores++; return undefined; });
  module.bindInvocation({ kind: "qvm", module: identity, instructionIndex: 0 }, call => {
    hooks++; expect(module.evaluateCounter([], 0, 64, [0])).toBe(5); return call.proceed();
  });
  expect(module.evaluateCounter([], 0, 64, [0])).toBe(5); expect(hooks).toBe(0); expect(stores).toBe(0);
  expect(module.memory.dataView(64, 4).getInt32(0, true)).toBe(13);
  module.call([]); expect(hooks).toBe(1); expect(stores).toBe(1);
  expect(module.memory.dataView(64, 4).getInt32(0, true)).toBe(18);
  expect(module.interpreter.stackPointer).toBe(module.memory.bytes.length); module.retire();
  for (const [address, opcode] of [[88, QvmOpcode.OP_STORE4], [65, QvmOpcode.OP_STORE1]] satisfies readonly (readonly [number, QvmOpcode])[]) {
    const vm = new QvmInterpreter(parseQvm(bytecode([[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, address], [QvmOpcode.OP_CONST, 7], [opcode],
      [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 16]], 2049)), unexpectedTrap);
    expect(() => vm.evaluateCounter(64, 0, [0], () => vm.invoke(qvmArguments([])))).toThrow("unrelated source write");
    expect(vm.memory[address]).toBe(0); expect(vm.stackPointer).toBe(vm.memory.length);
    vm.invoke(qvmArguments([])); expect(vm.memory[address]).toBe(7);
  }
});


test("source evaluations reject frames entering data and accept an explicitly declared original stack", () => {
  const source = bytecode([[QvmOpcode.OP_ENTER, 2048], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_CONST, 7], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 2048]], 2049);
  for (const query of ["counter", "region"]) {
    const vm = new QvmInterpreter(parseQvm(source), unexpectedTrap), before = vm.memory.slice(0, 2052);
    const run = () => query === "counter" ? vm.evaluateCounter(64, 0, [0], () => vm.invoke(qvmArguments([])))
      : vm.invoke(qvmArguments([]), 0, { region: { entry: 1, join: 4, inputs: [], result: 24 }, inputs: [] });
    expect(run).toThrow("overlap source data"); expect(vm.memory.slice(0, 2052)).toEqual(before); expect(vm.isActive).toBe(false);
    expect(vm.stackPointer).toBe(vm.memory.length);
  }
  const vm = new QvmInterpreter(parseQvm(bytecode([[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 64], [QvmOpcode.OP_CONST, 9], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 16]])), unexpectedTrap);
  const before = vm.memory.slice();
  expect(() => vm.evaluateCounter(64, 0, [0], () => vm.invoke(qvmArguments([])))).toThrow("overlap source data");
  expect(vm.memory).toEqual(before);
  expect(vm.evaluateCounter(64, 0, [0], () => vm.invoke(qvmArguments([])), { start: 2048, end: 4096 })).toBe(9);
  expect(vm.memory[64]).toBe(0);
});


test("declared primary combat maps private traits and reordered extended calls without losing source arguments", () => {
  const operations: Operation[] = [[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 16]];
  const pain = operations.length;
  operations.push([QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 1084], [QvmOpcode.OP_LOCAL, 28], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 16]);
  const checkArmor = operations.length;
  operations.push([QvmOpcode.OP_ENTER, 16]);
  for (const [argument, address] of [[1, 1040], [3, 1044], [4, 1048], [0, 1072], [2, 1076], [5, 1080]]) {
    if (argument === undefined || address === undefined) throw new Error("Missing authored argument probe");
    operations.push([QvmOpcode.OP_CONST, address], [QvmOpcode.OP_LOCAL, 24 + argument * 4], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_STORE4]);
  }
  operations.push([QvmOpcode.OP_CONST, 2], [QvmOpcode.OP_LEAVE, 16]);
  const damage = operations.length;
  operations.push([QvmOpcode.OP_ENTER, 48]);
  for (const [argument, address] of [[3, 1024], [5, 1052], [8, 1056], [1, 1064], [4, 1068], [2, 1088], [6, 1092]]) {
    if (argument === undefined || address === undefined) throw new Error("Missing authored argument probe");
    operations.push([QvmOpcode.OP_CONST, address], [QvmOpcode.OP_LOCAL, 56 + argument * 4], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_STORE4]);
  }
  operations.push([QvmOpcode.OP_LOCAL, 32],
    [QvmOpcode.OP_CONST, 55], [QvmOpcode.OP_ARG, 8],
    [QvmOpcode.OP_LOCAL, 100], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 12],
    [QvmOpcode.OP_CONST, float32ToBits(3.5) | 0], [QvmOpcode.OP_ARG, 16],
    [QvmOpcode.OP_LOCAL, 84], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 20],
    [QvmOpcode.OP_LOCAL, 68], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 24],
    [QvmOpcode.OP_CONST, 1344], [QvmOpcode.OP_ARG, 28],
    [QvmOpcode.OP_CONST, checkArmor], [QvmOpcode.OP_CALL], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 1060], [QvmOpcode.OP_LOCAL, 12], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_LOCAL, 84], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 604], [QvmOpcode.OP_ADD],
    [QvmOpcode.OP_LOCAL, 84], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_CONST, 604], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LOAD4],
    [QvmOpcode.OP_LOCAL, 100], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LOCAL, 32], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_SUB],
    [QvmOpcode.OP_SUB], [QvmOpcode.OP_STORE4],
    [QvmOpcode.OP_CONST, 55], [QvmOpcode.OP_ARG, 8],
    [QvmOpcode.OP_LOCAL, 100], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LOCAL, 32], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_SUB], [QvmOpcode.OP_ARG, 12],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_ARG, 16], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_ARG, 20],
    [QvmOpcode.OP_LOCAL, 84], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 24],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_ARG, 28], [QvmOpcode.OP_CONST, pain], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 48]);
  const source = bytecode(operations, 131073);
  const identity = { id: "test:combat", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(source).digest("hex")) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const artifact = resolveQvmArtifact({ module: identity, role: "qagame", bytes: source });
  if (artifact.kind !== "bytecode") throw new Error("Missing authored original combat bytecode");
  const declared = { entityStride: 1024, clientStride: 1024, fields: { inuse: 600, health: 604, takedamage: 608, parent: 612, client: 616 },
    callbacks: { allocate: 0, free: 0, damage }, reactions: { flags: 620, pain: 624, die: 628, painCall: { arguments: 6, roles: { target: 4, amount: 1 } }, dieCall: { arguments: 5, roles: { target: 0, amount: 3 } } }, grappleDamageMethod: 23,
    damageCall: { roles: { target: 7, inflictor: 2, attacker: 6, direction: 1, point: 4, amount: 11, flags: 3, method: 0 },
      extras: [{ index: 5, kind: "float32", value: 1.25 }, { index: 8, kind: "address", value: 1280 }, { index: 9, kind: "int32", value: 11 }, { index: 10, kind: "int32", value: 12 }] }, state: { healthStat: 9, team: { persistentStat: 7, values: [{ value: 8, team: "shared:blue" }] },
      flags: { notarget: 256, invulnerable: 512, noKnockback: 1024 }, mass: { kind: "entity", offset: 632, storage: "float32" } },
    damageFlags: { radius: 32, noArmor: 64, noKnockback: 128, noProtection: 256, noTeamProtection: 512 },
    armor: { checkArmor, call: { roles: { target: 3, amount: 1, flags: 4 }, extras: [{ index: 0, kind: "int32", value: 17 }, { index: 2, kind: "float32", value: 2.25 }, { index: 5, kind: "address", value: 1280 }] }, pointsStat: 8, protection: Math.fround(0.66), tiers: null } };
  const definition = readQvmPrimaryCombat(new SaveReader(declared), artifact);
  expect(definition.fields.client).toBe(616);
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, fields: { ...declared.fields, client: 512 } }), artifact)).toThrow("overlaps");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, damageCall: { ...declared.damageCall, roles: { ...declared.damageCall.roles, target: 11 } } }), artifact)).toThrow("exactly once");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, damageCall: { ...declared.damageCall, extras: [] } }), artifact)).toThrow("exactly once");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, damageCall: { ...declared.damageCall, extras: [...declared.damageCall.extras, ...Array.from({ length: 55 }, () => ({ index: 0, kind: "int32", value: 0 }))] } }), artifact)).toThrow("OP_ARG");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, armor: { ...declared.armor, call: { ...declared.armor.call, extras: declared.armor.call.extras.map(extra => extra.index === 0 ? { ...extra, value: 0.5 } : extra) } } }), artifact)).toThrow();
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, damageCall: { ...declared.damageCall, extras: declared.damageCall.extras.map(extra => extra.index === 5 ? { ...extra, value: 1e100 } : extra) } }), artifact)).toThrow("binary32");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, damageCall: { ...declared.damageCall, extras: declared.damageCall.extras.map(extra => extra.index === 8 ? { ...extra, value: 262144 } : extra) } }), artifact)).toThrow("artifact data");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, damageFlags: { ...declared.damageFlags, radius: 64 } }), artifact)).toThrow("overlap");
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, state: { ...declared.state, team: { ...declared.state.team, values: [{ value: 8, team: "blue" }] } } }), artifact)).toThrow();
  expect(() => readQvmPrimaryCombat(new SaveReader({ ...declared, reactions: { ...declared.reactions, painCall: { arguments: 3, roles: { target: 4, amount: 1 } } } }), artifact)).toThrow("original call");
  const game = new QvmGame({ artifact, host: rejectQvmSyscall }); game.data.setClientCount(1); game.data.locate(4096, 3, 1024, 8192, 1024);
  const actors = new SessionActorRegistry(createIdentityOwner("declared-combat")), actor = actors.allocate(identity.id, "test:player");
  const other = actors.allocate(identity.id, "test:target");
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined });
  const outcomes: DamageOutcome[] = [];
  const combat = new GameplayAuthority(actors, new ActorCallbackTable(actors), { impulse: () => undefined, beforeReaction: () => undefined,
    confirmed: result => { outcomes.push(result); return undefined; } });
  const view = game.data.entityBytes(0); view.setInt32(600, 1, true); view.setInt32(604, 100, true); view.setInt32(608, 1, true); view.setFloat32(632, 275.5, true);
  view.setInt32(620, 256 | 512 | 1024, true); view.setInt32(624, pain, true);
  const player = game.data.copyPlayerState(0), persistent = [...player.persistent], stats = [...player.stats]; persistent[7] = 8; persistent[3] = 2; stats[0] = 123;
  game.data.writePlayerState(0, { ...player, persistent, stats });
  const binding = new QvmCombatBindings({ game, artifact, definition, bodies, combat, slot: id => id.equals(actor.id) ? 0 : id.equals(other.id) ? 1 : null,
    source: { actors, actor: slot => slot === 0 ? actor : slot === 1 ? other : null, provenance: () => ({ sequence: 1, time: { kind: "milliseconds", value: 0 }, weapon: null,
      weaponProvider: identity.id, combatProvider: identity.id, inventoryProvider: identity.id, movementProvider: identity.id }) } });
  try {
    binding.admit(actor); expect(binding.notarget(actor.id)).toBe(true);
    expect(combat.read(actor.id)).toMatchObject({ mass: 275.5, team: "shared:blue", invulnerable: true, noKnockback: true });
    view.setInt32(620, 32 | 16 | 2048, true); expect(binding.notarget(actor.id)).toBe(false);
    expect(combat.read(actor.id)).toMatchObject({ invulnerable: false, noKnockback: false });
    combat.setHealth(actor, 75); expect(game.data.copyPlayerState(0).stats[9]).toBe(75); expect(game.data.copyPlayerState(0).stats[0]).toBe(123);
    combat.damageOperation.register({ provider: "test:mod", id: "test:half", kind: "transform", order: 0, transform: request => ({ ...request, amount: request.amount / 2 }) });
    const powerInputs: number[] = [];
    const removePower = combat.bindProtection(actor, { channel: "powered", owner: "test:power", rule: "test:absorb", admission: { kind: "claim" }, inventoryItems: [],
      read: () => ({ kind: "shield", cells: 10 }), validateWrite: () => undefined, write: () => undefined,
      absorb: input => { powerInputs.push(input.amount); return { saved: 3 }; } });
    game.data.entityBytes(2).setInt32(600, 1, true);
    const sourceWords = [23, 1296, 6144, 32 | 8192, 0, float32ToBits(9.5) | 0, 6144, 4096, 1328, 101, 102, 20];
    game.module.call(sourceWords, damage);
    expect(view.getInt32(604, true)).toBe(70); expect(game.module.memory.view(1024, 4).getInt32(0, true)).toBe(32 | 8192);
    const word = (address: number) => game.module.memory.view(address, 4).getInt32(0, true);
    expect([word(1052), word(1056), word(1064), word(1068)]).toEqual([float32ToBits(9.5) | 0, 1328, 1296, 0]);
    expect([word(1088), word(1092)]).toEqual([6144, 6144]);
    expect([word(1040), word(1044), word(1048), word(1060)]).toEqual([7, 4096, 32 | 8192, 10]);
    expect([word(1072), word(1076), word(1080)]).toEqual([55, float32ToBits(3.5) | 0, 1344]);
    expect(powerInputs).toEqual([10]);
    const result = outcomes.at(-1); if (result?.kind !== "committed") throw new Error("Original source damage did not commit");
    expect(result.decision.request.attack.cause).toEqual({ kind: "q3", meansOfDeath: 23, damageFlags: 1 });
    expect(result.decision.appliedDamage).toBe(5); expect(result.decision.reaction).toBe("pain"); expect(word(1084)).toBe(5);
    const independent = combat.apply({ ...result.decision.request, amount: 20 });
    expect(independent.kind).toBe("committed"); expect(view.getInt32(604, true)).toBe(65);
    expect([word(1052), word(1056)]).toEqual([float32ToBits(1.25) | 0, 1280]);
    expect(word(1024)).toBe(32); expect(powerInputs).toEqual([10, 10]);
    removePower();
    const second = game.data.entityBytes(1); second.setInt32(600, 1, true); second.setInt32(604, 100, true); second.setInt32(608, 1, true); second.setInt32(624, pain, true);
    binding.admit(other);
    combat.damageOperation.register({ provider: "test:mod", id: "test:retarget", kind: "transform", order: 1, transform: request => ({ ...request, target: other.id }) });
    game.module.call(sourceWords, damage);
    expect(view.getInt32(604, true)).toBe(65); expect(second.getInt32(604, true)).toBe(92);
    expect([word(1052), word(1056), word(1024)]).toEqual([float32ToBits(1.25) | 0, 1280, 32]);
  } finally { binding.close(); game.retire(); }
});

for (const semantics of ["interpreted", "compiled"] satisfies readonly import("../../../src/compat/qvm/interpreter.ts").QvmSemantics[]) {
  test(`${semantics} private calls use the original OP_ARG extent while vmMain retains its public frame`, async () => {
    const operations: Operation[] = [[QvmOpcode.OP_ENTER, 256]];
    for (let index = 0; index < 62; index++) operations.push([QvmOpcode.OP_CONST, index + 1], [QvmOpcode.OP_ARG, 8 + index * 4]);
    const target = operations.length + 3;
    operations.push([QvmOpcode.OP_CONST, target], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 256],
      [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_LOCAL, 16], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_LOCAL, 260], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ADD], [QvmOpcode.OP_LEAVE, 8]);
    const vm = new QvmInterpreter(parseQvm(bytecode(operations)), unexpectedTrap, undefined, null, semantics);
    let observed = 0;
    vm.observeFunction(target, call => { observed++; expect(call.argument(61)).toBe(62); expect(() => call.argument(62)).toThrow("outside source call"); return undefined; });
    vm.bindFunction(target, call => {
      expect(call.words.byteLength).toBe(248); expect(() => call.words.getInt32(248, true)).toThrow();
      expect(call.invoke(Array.from({ length: 62 }, () => 2), target)).toBe(4);
      expect(call.words.getInt32(61 * 4, true)).toBe(62);
      return call.proceed();
    });
    expect(vm.invoke(qvmArguments([]))).toBe(63); expect(observed).toBe(1);
    expect(await vm.invokeAsync(Array.from({ length: 62 }, (_, index) => index + 1), target)).toBe(63);
    expect(() => vm.invoke(Array.from({ length: 63 }, () => 0), target)).toThrow("OP_ARG");
    expect(() => vm.invoke(Array.from({ length: 11 }, () => 0))).toThrow("vmMain");
    expect(() => qvmArguments(Array.from({ length: 11 }, () => 0))).toThrow("ten argument");
    expect(vm.stackPointer).toBe(vm.memory.length); expect(vm.isActive).toBe(false);

    const small = new QvmInterpreter(parseQvm(bytecode([[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 5], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16],
      [QvmOpcode.OP_IGNORE], [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_LEAVE, 8]])), unexpectedTrap, undefined, null, semantics);
    small.observeFunction(5, call => { expect(() => call.argument(2)).toThrow("outside source call"); return undefined; });
    small.bindFunction(5, call => { expect(call.words.byteLength).toBe(8); return call.proceed(); });
    expect(small.invoke(qvmArguments([]))).toBe(1);
  });
}
