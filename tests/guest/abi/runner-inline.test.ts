import { expect, test } from "bun:test";
import type { GuestCallContext, NativeCallAbi } from "../../../src/contracts/execution.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { GuestCallRunner, GuestCallStopped, type GuestInlineContinuation } from "../../../src/guest/abi/runner.ts";
import { guestPointer } from "../../../src/guest/abi/adapter.ts";
import { I386Cpu } from "../../../src/guest/x86/index.ts";
import { X64Cpu } from "../../../src/guest/x64/index.ts";

function fixture(wide: boolean) {
  const abi: NativeCallAbi = wide ? { kind: "windows-x86-64", image: "pe32+", pointerBytes: 8, call: "microsoft-x64" }
    : { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" };
  const module = { id: "test:inline", artifactPath: "authored-inline", revision: "1", digest: createContentDigest("dc".repeat(32)) } satisfies import("../../../src/contracts/execution.ts").ModuleIdentity;
  const memory = new SparseGuestMemory({ module, pointerBytes: abi.pointerBytes });
  memory.map({ base: 0x1000n, byteLength: 4096, permissions: "read-write" });
  memory.map({ base: 0x10000n, byteLength: 65536, permissions: "read-write" });
  const at = (offset: bigint) => guestPointer(memory, offset);
  memory.write(at(0x1000n), new Uint8Array([0xb8, 1, 0, 0, 0, 0x83, 0xc0, 2, 0x83, 0xc0, 4, 0xc3]));
  memory.protect(at(0x1000n), 4096, "read-execute");
  const state = createGuestProcessorState({ architecture: wide ? "x86-64" : "i386", instructionPointer: 0x1800n, stackPointer: 0x20000n,
    flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const callbacks = new GuestCallbackTable(memory), hostCall = (address: import("../../../src/contracts/execution.ts").GuestAddress) => callbacks.enter(address);
  const cpu = wide ? new X64Cpu({ memory, state, isHostCall: hostCall }) : new I386Cpu({ memory, state, hostCall });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: at(0x1800n) });
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: at(0x1000n), abi }, parent: null, self: null, other: null };
  const request = { target: at(0x1000n), signature: { abi, parameters: [], result: { kind: "scalar", storage: "int32" }, variadic: false }, arguments: [], context, instructionBudget: 30 } satisfies import("../../../src/guest/abi/runner.ts").GuestCallRequest;
  return { runner, cpu, at, abi, request };
}
for (const wide of [false, true]) {
  test(`${wide ? "x64" : "i386"} inline execute/skip preserves nested frames and closes continuation`, () => {
    const f = fixture(wide), retained: GuestInlineContinuation[] = [];
    let entries = 0;
    const remove = f.runner.bindInlineRegion(f.at(0x1005n), f.at(0x1008n), f.abi, continuation => {
      entries++; retained.push(continuation);
      if (f.runner.depth === 1) {
        expect(f.runner.invoke(f.request)).toEqual({ kind: "int32", value: 5 });
        continuation.execute();
      } else continuation.skip();
      return undefined;
    });
    expect(f.runner.invoke(f.request)).toEqual({ kind: "int32", value: 7 });
    expect(entries).toBe(2); expect(f.runner.depth).toBe(0);
    expect(f.cpu.state.registers.read("rsp", wide ? 64 : 32)).toBe(0x20000n);
    for (const continuation of retained) expect(() => continuation.skip()).toThrow("active source frame");
    remove(); remove(); expect(f.runner.invoke(f.request)).toEqual({ kind: "int32", value: 7 }); expect(entries).toBe(2);
  });
  test(`${wide ? "x64" : "i386"} inline failure is sticky and consumes the original instruction budget`, () => {
    const f = fixture(wide);
    const remove = f.runner.bindInlineRegion(f.at(0x1005n), f.at(0x1008n), f.abi, continuation => {
      continuation.execute();
      try { continuation.skip(); } catch { /* The runner must still reject the intercepted call. */ }
      return undefined;
    });
    expect(() => f.runner.invoke(f.request)).toThrow("active source frame"); expect(f.runner.depth).toBe(0); remove();
    const bounded = fixture(wide);
    bounded.runner.bindInlineRegion(bounded.at(0x1005n), bounded.at(0x1008n), bounded.abi, continuation => continuation.execute());
    expect(() => bounded.runner.invoke({ ...bounded.request, instructionBudget: 3 })).toThrow(GuestCallStopped);
    expect(bounded.cpu.state.instructionPointer).toBe(0x1008n); expect(bounded.runner.depth).toBe(0);
  });
  test(`${wide ? "x64" : "i386"} inline continuation cannot join from another frame`, () => {
    const f = fixture(wide);
    let outer: GuestInlineContinuation | undefined;
    f.runner.bindInlineRegion(f.at(0x1005n), f.at(0x1008n), f.abi, continuation => {
      if (outer === undefined) { outer = continuation; f.runner.invoke(f.request); }
      else { try { outer.skip(); } catch { /* The outer frame retains the failure. */ } }
      return continuation.execute();
    });
    expect(() => f.runner.invoke(f.request)).toThrow("active source frame");
    expect(f.runner.depth).toBe(0);
  });
}
