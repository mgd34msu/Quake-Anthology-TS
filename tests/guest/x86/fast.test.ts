// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { corpusFile, corpusHasFile } from "../../support/corpus.ts";

import { createContentDigest } from "../../../src/contracts/content.ts";
import type { GuestAddress, GuestCallContext, ModuleIdentity } from "../../../src/contracts/execution.ts";
import { GuestCallRunner } from "../../../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../src/guest/core/index.ts";
import { mapPeImage } from "../../../src/guest/pe/index.ts";
import { WindowsGuestRuntime } from "../../../src/guest/runtime/windows/index.ts";
import { I386Cpu, guestAddress } from "../../../src/guest/x86/index.ts";

const module: ModuleIdentity = { id: "test:i386-fast", artifactPath: "authored-instructions", revision: "1", digest: createContentDigest("34".repeat(32)) };
const CODE = 0x1000n, DATA = 0x20000, STACK = 0x40000;

/** Deterministic generator so a failing trial can be reproduced from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Fixture { readonly memory: SparseGuestMemory; readonly cpu: I386Cpu; readonly state: ReturnType<typeof createGuestProcessorState> }
function fixture(fastPath: boolean): Fixture {
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  memory.map({ base: CODE, byteLength: 0x1000, permissions: "read-write-execute" });
  memory.map({ base: BigInt(DATA), byteLength: 0x2000, permissions: "read-write" });
  memory.map({ base: BigInt(DATA + 0x2000), byteLength: 0x1000, permissions: "read" });
  memory.map({ base: BigInt(STACK), byteLength: 0x2000, permissions: "read-write" });
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: CODE, stackPointer: BigInt(STACK + 0x1000), flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  return { memory, state, cpu: new I386Cpu({ state, memory, fastPath }) };
}
type FastFixture = ReturnType<typeof fixture>;
const registerNames: readonly Parameters<FastFixture["state"]["registers"]["write"]>[0][] = ["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi"];

/** Both CPUs receive the same registers, flags and memory every time `reset` runs. */
function reset(target: Fixture, seed: number, code: readonly number[]): void {
  const next = random(seed);
  const pick = (): number => {
    const kind = Math.floor(next() * 9);
    switch (kind) {
      case 0: return DATA + Math.floor(next() * 0x1ff0);
      case 1: return STACK + Math.floor(next() * 0x1ff0);
      case 2: return Math.floor(next() * 4);
      case 3: return 0xfffffffc + Math.floor(next() * 4);
      case 4: return DATA + 0x2000 + Math.floor(next() * 0xff0);
      case 5: return Math.floor(next() * 0x100000000);
      case 6: return 0x80000000 + Math.floor(next() * 3) - 1;
      default: return Math.floor(next() * 0x300);
    }
  };
  for (const name of registerNames) target.state.registers.write(name, 32, BigInt(pick() >>> 0));
  target.state.flags.value = 2n | BigInt(Math.floor(next() * 0x1000) & 0x8d5) | (next() < 0.2 ? 0x400n : 0n);
  target.state.instructionPointer = CODE;
  const data = new Uint8Array(0x2000 + 0x1000 + 0x2000);
  for (let index = 0; index < data.length; index++) data[index] = Math.floor(next() * 256);
  target.memory.write(guestAddress(target.memory, BigInt(DATA)), data.subarray(0, 0x2000));
  target.memory.write(guestAddress(target.memory, BigInt(STACK)), data.subarray(0x3000));
  target.memory.write(guestAddress(target.memory, CODE), new Uint8Array(code));
  target.state.x87.controlWord = 0x37f; target.state.x87.statusWord = 0; target.state.x87.tagWord = 0xffff;
}
function snapshot(target: Fixture): unknown {
  return {
    registers: [...target.state.registers.checkpoint()], flags: target.state.flags.value, ip: target.state.instructionPointer,
    x87: { registers: [...target.state.x87.registers], control: target.state.x87.controlWord, status: target.state.x87.statusWord, tag: target.state.x87.tagWord, ip: target.state.x87.instructionPointer },
    data: [...target.memory.copy(guestAddress(target.memory, BigInt(DATA)), 0x2000)],
    stack: [...target.memory.copy(guestAddress(target.memory, BigInt(STACK)), 0x2000)],
  };
}

const interesting = [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0a, 0x0b, 0x10, 0x11, 0x12, 0x13, 0x18, 0x19, 0x1a, 0x1b, 0x20, 0x21, 0x22, 0x23, 0x28, 0x29, 0x2a, 0x2b,
  0x30, 0x31, 0x32, 0x33, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x40, 0x41, 0x45, 0x48, 0x4c, 0x4f, 0x50, 0x51, 0x54, 0x55, 0x58, 0x59, 0x5c, 0x5d, 0x68, 0x69, 0x6a, 0x6b,
  0x70, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78, 0x7a, 0x7c, 0x7e, 0x7f, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x88, 0x89, 0x8a, 0x8b, 0x8d, 0x90, 0x98, 0x99, 0xa0, 0xa1, 0xa2, 0xa3,
  0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb0, 0xb3, 0xb4, 0xb7, 0xb8, 0xbb, 0xbf, 0xc0, 0xc1, 0xc2, 0xc3, 0xc6, 0xc7, 0xc9, 0xd0, 0xd1, 0xd2, 0xd3,
  0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe8, 0xe9, 0xeb, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfc, 0xfd, 0xfe, 0xff, 0x66, 0xf2, 0xf3, 0x64, 0x0f];
const secondary = [0x40, 0x44, 0x4f, 0x80, 0x84, 0x8c, 0x8f, 0x90, 0x94, 0x9f, 0xaf, 0xb6, 0xb7, 0xbe, 0xbf, 0xa2, 0xb1, 0xbc];

function instruction(next: () => number): number[] {
  const bytes: number[] = [];
  if (next() < 0.1) bytes.push([0xf3, 0x66, 0xf2, 0x2e, 0x64][Math.floor(next() * 5)] ?? 0xf3);
  const op = next() < 0.85 ? interesting[Math.floor(next() * interesting.length)] ?? 0x90 : Math.floor(next() * 256);
  bytes.push(op);
  if (op === 0x0f) bytes.push(next() < 0.9 ? secondary[Math.floor(next() * secondary.length)] ?? 0x84 : Math.floor(next() * 256));
  // Small displacements keep many addresses inside the mapped data and stack.
  for (let index = 0; index < 12; index++) {
    const kind = next();
    bytes.push(kind < 0.5 ? Math.floor(next() * 256) : kind < 0.8 ? Math.floor(next() * 16) : kind < 0.9 ? 0xff : 0);
  }
  return bytes;
}

const shared = { slow: fixture(false), fast: fixture(true) };
function same(seed: number, code: readonly number[], budget: number): void {
  const { slow, fast } = shared;
  // The first pass retains the bytes; the second pass is the one that takes the predecoded path.
  for (const target of [slow, fast]) { reset(target, seed, code); target.cpu.run({ instructionBudget: budget, returnAddress: null }); }
  const results = [slow, fast].map(target => {
    reset(target, seed, code);
    const stop = target.cpu.run({ instructionBudget: budget, returnAddress: null });
    return { stop, state: snapshot(target) };
  });
  const [expected, actual] = results;
  if (JSON.stringify(expected, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value)
    !== JSON.stringify(actual, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value)) {
    throw new Error(`fast path diverged: seed ${seed}, code ${code.map(byte => byte.toString(16).padStart(2, "0")).join(" ")}\n${JSON.stringify(expected?.stop, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value)}\n${JSON.stringify(actual?.stop, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value)}`);
  }
}

test("predecoded i386 steps match the generic interpreter on 20,000 random single instructions", () => {
  for (let seed = 1; seed <= 20_000; seed++) {
    const next = random(seed * 7919);
    same(seed, instruction(next), 1);
  }
});

test("predecoded i386 steps match the generic interpreter across random instruction sequences", () => {
  for (let seed = 1; seed <= 2_000; seed++) {
    const next = random(seed * 104729);
    const code: number[] = [];
    for (let count = 0; count < 6; count++) code.push(...instruction(next));
    same(seed, code, 6);
  }
});

test("REP string instructions iterate one budget unit at a time and honor the direction flag and ECX", () => {
  const repCases: readonly (readonly [number[], boolean])[] = [[[0xf3, 0xa5], false], [[0xf3, 0xa4], true], [[0xf3, 0xab], false], [[0xf3, 0xaa], true], [[0xac], false], [[0xad], true]];
  for (const [bytes, direction] of repCases) {
    for (const count of [0, 1, 2, 7]) {
      const results = [false, true].map(fastPath => {
        const target = fixture(fastPath);
        reset(target, 99, bytes);
        target.state.registers.write("rcx", 32, BigInt(count));
        target.state.registers.write("rsi", 32, BigInt(DATA + 0x100)); target.state.registers.write("rdi", 32, BigInt(DATA + 0x800));
        target.state.flags.set("direction", direction);
        const stops: ReturnType<FastFixture["cpu"]["run"]>[] = [];
        for (let pass = 0; pass < 3; pass++) {
          target.state.instructionPointer = CODE;
          stops.push(target.cpu.run({ instructionBudget: 3, returnAddress: null }));
        }
        return JSON.stringify({ stops, state: snapshot(target) }, (_, value: unknown) => typeof value === "bigint" ? `${value}n` : value);
      });
      expect(results[1]).toBe(results[0]);
    }
  }
});

test("a store into already predecoded code invalidates it", () => {
  const target = fixture(true);
  // mov eax, 1 ; jmp back to the start
  const code = [0xb8, 1, 0, 0, 0, 0xeb, 0xf9];
  reset(target, 5, code);
  target.cpu.run({ instructionBudget: 4, returnAddress: null });
  expect(target.state.registers.read("rax", 32)).toBe(1n);
  target.memory.writeUint8(guestAddress(target.memory, CODE + 1n), 9);
  target.state.instructionPointer = CODE;
  target.cpu.run({ instructionBudget: 1, returnAddress: null });
  expect(target.state.registers.read("rax", 32)).toBe(9n);
});

test("a fault leaves registers, flags and the instruction pointer unchanged", () => {
  // add [ecx], eax with ECX unmapped
  const target = fixture(true);
  reset(target, 6, [0x01, 0x01]);
  target.state.registers.write("rcx", 32, 0x70000000n);
  target.state.registers.write("rax", 32, 5n);
  target.cpu.run({ instructionBudget: 1, returnAddress: null });
  const before = snapshot(target);
  target.state.instructionPointer = CODE;
  const stop = target.cpu.run({ instructionBudget: 1, returnAddress: null });
  expect(stop.kind).toBe("exception");
  expect(snapshot(target)).toEqual(before);
});

const dlls = ["q2/ctf/gamex86.dll", "q2/xatrix/gamex86.dll"];
for (const relative of dlls) {
  test.skipIf(!corpusHasFile(relative))(`retail ${relative} attach and detach are bit-identical on the predecoded and generic paths`, async () => {
    const path = corpusFile(relative), bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const run = (fastPath: boolean) => {
      const digest = createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
      const id: ModuleIdentity = { id: "test:fast-retail", artifactPath: path, revision: "installed", digest };
      const memory = new SparseGuestMemory({ module: id, pointerBytes: 4, allocationBase: 0x10000000n });
      const image = mapPeImage({ bytes, memory });
      const callbacks = new GuestCallbackTable(memory);
      const runtime = new WindowsGuestRuntime({ memory, callbacks, capabilities: { nowMilliseconds: () => 1789084800000, performanceCounter: () => 123456789n } });
      const stack = memory.allocate({ byteLength: 0x100000, alignment: 4096n, label: "stack" });
      const returnAddress = memory.allocate({ byteLength: 16, permissions: "read-execute" });
      const state = createGuestProcessorState({ architecture: "i386", instructionPointer: returnAddress.byteOffset, stackPointer: stack.byteOffset + 0x100000n,
        flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
      runtime.prepareImage(image);
      const cpu = new I386Cpu({ memory, state, callbacks, fastPath });
      let instructions = 0;
      const counted = { state: cpu.state, memory: cpu.memory, run: (options: Parameters<I386Cpu["run"]>[0]) => { const stop = cpu.run(options); instructions += stop.instructions; return stop; } };
      const runner = new GuestCallRunner({ cpu: counted, callbacks, returnAddress }); runtime.attachRunner(runner);
      const context: GuestCallContext = { module: id, callback: { kind: "native-guest", module: id, address: image.base, abi: image.abi }, parent: null, self: null, other: null };
      runtime.initialize(image, { context, instructionBudget: 1_000_000 });
      runtime.detach(image, { context, instructionBudget: 1_000_000 });
      const hash = new Bun.CryptoHasher("sha256");
      for (const mapping of memory.mappings()) hash.update(memory.copy({ kind: "guest-address", addressSpace: memory.addressSpace, byteOffset: mapping.base } satisfies GuestAddress, mapping.byteLength));
      return { instructions, registers: [...state.registers.checkpoint()], flags: state.flags.value, memory: hash.digest("hex") };
    };
    const generic = run(false), fast = run(true);
    expect(generic.instructions).toBeGreaterThan(10_000);
    expect(fast).toEqual(generic);
  }, 120_000);
}
