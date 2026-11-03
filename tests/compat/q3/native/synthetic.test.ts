// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { inspectElf } from "../../../../src/guest/elf/index.ts";
import { NativeGameMemory, nativeQ3GameCall, NativeQ3Syscalls, Quake3VmModule } from "../../../../src/compat/q3/native/index.ts";
import { QvmGameImport } from "../../../../src/compat/qvm/abi.ts";
import { qvmIntrinsicSyscall } from "../../../../src/compat/qvm/syscalls.ts";
import { SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { CodeBuilder, SYNTHETIC_ELF, syntheticElfModule } from "../../../support/elf-modules.ts";
import { nativeGameFixtureFrom, nativeGuestProcess } from "./fixture.ts";

// The retail Linux Quake III and Quake Live modules are not on this machine (quakelive/baseq3/bin.pk3 is absent), so these
// modules are assembled here: real ELF images, loaded and run by the System V runtime and the x86 and x86-64 interpreters.

const D = SYNTHETIC_ELF.data;
const slots = { table: D, imports: D + 0x80, time: D + 0x90, client: D + 0xa0, text: D + 0xc0, syscall: D + 0x80 };
const message = "hello from the synthetic module";
const identity = (name: string): ModuleIdentity => ({
  id: `test:synthetic-${name}`,
  artifactPath: `authored-${name}`,
  revision: "1",
  digest: createContentDigest("ab".repeat(32)),
});
const tableSlots = ["Shutdown", "RunFrame", "RegisterCvars", "Init", "ConsoleCommand", "", "", "", "ClientConnect", "", ""];

/** Quake Live API 10, x86-64 System V: dllEntry(output, imports, version) publishes an eleven slot export table. */
function quakeLiveX64(version: number): Uint8Array {
  const c = new CodeBuilder(),
    table: Record<string, number> = {};
  const fn = (name: string): void => {
    table[name] = c.mark(name);
  };
  table["dllEntry"] = c.mark("dllEntry");
  c.raw(0xc7, 0x02).u32(version); // mov dword [rdx], version
  c.raw(0x48, 0x8d, 0x05).rip(slots.table); // lea rax, [rip+table]
  c.raw(0x48, 0x89, 0x07); // mov [rdi], rax
  c.raw(0x48, 0x89, 0x35).rip(slots.imports); // mov [rip+imports], rsi
  c.raw(0xc3);
  fn("Shutdown");
  c.raw(0xc3);
  fn("RunFrame");
  c.raw(0x89, 0x3d).rip(slots.time).raw(0xc3); // mov [rip+time], edi
  fn("RegisterCvars");
  c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8d, 0x3d).rip(slots.text); // sub rsp,8; lea rdi,[rip+text]
  c.raw(0x48, 0x8b, 0x05)
    .rip(slots.imports)
    .raw(0xff, 0x90)
    .u32(2 * 8); // mov rax,[rip+imports]; call [rax+Printf]
  c.raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  fn("Init");
  c.raw(0x89, 0x3d).rip(slots.time).raw(0xc3);
  fn("ConsoleCommand");
  c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8b, 0x05)
    .rip(slots.imports)
    .raw(0xff, 0x90)
    .u32(20 * 8); // call [rax+Argc]
  c.raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  fn("ClientConnect");
  c.raw(0x89, 0x3d).rip(slots.client); // mov [rip+client], edi
  c.raw(0x89, 0x35).rip(slots.client + 4); // mov [rip+client+4], esi
  c.raw(0x48, 0x8d, 0x05).rip(slots.client).raw(0xc3); // lea rax,[rip+client]
  return image(8, c, table);
}

/** Quake Live API 10, i386 cdecl, position independent through a call/pop thunk. */
function quakeLiveI386(version: number): Uint8Array {
  const c = new CodeBuilder(),
    table: Record<string, number> = {};
  const thunk = (name: string): void => {
    table[name] = c.mark(name);
    c.raw(0xe8, 0, 0, 0, 0);
    c.mark(`${name}:pc`);
    c.raw(0x59);
  }; // call next; next: pop ecx
  const at = (name: string, target: number): CodeBuilder => c.fromMark(`${name}:pc`, target);
  table["dllEntry"] = c.mark("dllEntry");
  c.raw(0xe8, 0, 0, 0, 0);
  c.mark("dllEntry:pc");
  c.raw(0x59);
  c.raw(0x8b, 0x44, 0x24, 0x0c, 0xc7, 0x00).u32(version); // mov eax,[esp+12]; mov dword [eax],version
  c.raw(0x8b, 0x44, 0x24, 0x08, 0x89, 0x81);
  at("dllEntry", slots.imports); // mov eax,[esp+8]; mov [ecx+imports],eax
  c.raw(0x8d, 0x81);
  at("dllEntry", slots.table); // lea eax,[ecx+table]
  c.raw(0x8b, 0x54, 0x24, 0x04, 0x89, 0x02, 0xc3); // mov edx,[esp+4]; mov [edx],eax; ret
  thunk("Shutdown");
  c.raw(0xc3);
  thunk("RunFrame");
  c.raw(0x8b, 0x44, 0x24, 0x04, 0x89, 0x81);
  at("RunFrame", slots.time).raw(0xc3);
  thunk("RegisterCvars");
  c.raw(0x8d, 0x81);
  at("RegisterCvars", slots.text); // lea eax,[ecx+text]
  c.raw(0x50, 0x8b, 0x81);
  at("RegisterCvars", slots.imports)
    .raw(0xff, 0x90)
    .u32(2 * 4); // push eax; mov eax,[ecx+imports]; call [eax+Printf]
  c.raw(0x83, 0xc4, 0x04, 0xc3);
  thunk("Init");
  c.raw(0x8b, 0x44, 0x24, 0x04, 0x89, 0x81);
  at("Init", slots.time).raw(0xc3);
  thunk("ConsoleCommand");
  c.raw(0x8b, 0x81);
  at("ConsoleCommand", slots.imports)
    .raw(0xff, 0x90)
    .u32(20 * 4)
    .raw(0xc3);
  thunk("ClientConnect");
  c.raw(0x8b, 0x44, 0x24, 0x04, 0x89, 0x81);
  at("ClientConnect", slots.client);
  c.raw(0x8b, 0x44, 0x24, 0x08, 0x89, 0x81);
  at("ClientConnect", slots.client + 4);
  c.raw(0x8d, 0x81);
  at("ClientConnect", slots.client).raw(0xc3);
  return image(4, c, table);
}

function image(width: 4 | 8, c: CodeBuilder, table: Record<string, number>): Uint8Array {
  const code = c.finish(),
    relative = tableSlots.flatMap((name, index) => (name === "" ? [] : [{ at: slots.table + index * width, addend: SYNTHETIC_ELF.code + (table[name] ?? 0) }]));
  const bytes = syntheticElfModule({ width, code, exports: [{ name: "dllEntry", offset: table["dllEntry"] ?? 0 }], relative });
  bytes.set(new TextEncoder().encode(`${message}\0`), slots.text);
  return bytes;
}

function fixtureOf(name: string, bytes: Uint8Array) {
  return { bytes, module: identity(name), elf: inspectElf(bytes) };
}

const builders: readonly (readonly [string, (version: number) => Uint8Array])[] = [
  ["x86-64", quakeLiveX64],
  ["i386", quakeLiveI386],
];
for (const [label, build] of builders) {
  test(`a synthetic ${label} Quake Live module runs its exports through the System V runtime`, () => {
    const game = nativeGameFixtureFrom(fixtureOf(`ql-${label}`, build(10)));
    const { memory, image: loaded } = game,
      word = (offset: number) => memory.offset(loaded.base, BigInt(offset));
    expect(game.game.apiVersion).toBe(10);
    expect(loaded.exports.some(entry => entry.symbol.kind === "name" && entry.symbol.name === "dllEntry")).toBe(true);
    // RegisterCvars reaches the Printf import with a guest string pointer.
    game.game.registerCvars();
    expect(game.events).toContain(message);
    game.game.initialize(1000, 7);
    expect(memory.readInt32(word(slots.time))).toBe(1000);
    game.game.runFrame(1250);
    expect(memory.readInt32(word(slots.time))).toBe(1250);
    // ConsoleCommand returns the Argc import's value as the handled flag.
    expect(game.command(["say", "hello"])).toBe(true);
    expect(game.command([])).toBe(false);
    const client = game.game.clientConnect(3, true, false);
    if (client === null) throw new Error("ClientConnect returned no client record");
    expect(client.byteOffset).toBe(word(slots.client).byteOffset);
    expect(memory.readInt32(client)).toBe(3);
    expect(memory.readInt32(memory.offset(client, 4n))).toBe(1);
    game.game.shutdown();
  });

  test(`a synthetic ${label} module that reports another game API version is refused`, () => {
    expect(() => nativeGameFixtureFrom(fixtureOf(`ql-${label}-v9`, build(9)))).toThrow("API 9 is unsupported");
  });
}

/** Official Q3 1.32 i386: dllEntry(syscall) stores the engine entry; vmMain(cmd, a0, a1, ...) forwards `cmd, a0, a1` to it. */
function quake3I386(): Uint8Array {
  const c = new CodeBuilder(),
    table: Record<string, number> = {};
  const thunk = (name: string): void => {
    table[name] = c.mark(name);
    c.raw(0xe8, 0, 0, 0, 0);
    c.mark(`${name}:pc`);
    c.raw(0x59);
  };
  const at = (name: string, target: number): CodeBuilder => c.fromMark(`${name}:pc`, target);
  thunk("dllEntry");
  c.raw(0x8b, 0x44, 0x24, 0x04, 0x89, 0x81);
  at("dllEntry", slots.syscall).raw(0xc3); // syscall = [esp+4]
  thunk("vmMain");
  c.raw(0xff, 0x74, 0x24, 0x0c, 0xff, 0x74, 0x24, 0x0c, 0xff, 0x74, 0x24, 0x0c); // push a1; push a0; push cmd
  c.raw(0xff, 0x91);
  at("vmMain", slots.syscall); // call [ecx+syscall]
  c.raw(0x83, 0xc4, 0x0c, 0xc3);
  return syntheticElfModule({
    width: 4,
    code: c.finish(),
    exports: [
      { name: "dllEntry", offset: table["dllEntry"] ?? 0 },
      { name: "vmMain", offset: table["vmMain"] ?? 0 },
    ],
  });
}

test("a synthetic Q3 1.32 i386 module enters the engine through the variadic syscall with the sixteen words id's engine reads", () => {
  const bytes = quake3I386(),
    fixture = fixtureOf("q3-i386", bytes);
  let syscalls: NativeQ3Syscalls | null = null;
  const process = nativeGuestProcess(fixture, (callback, fixed) => syscalls?.variadicLayouts(callback, fixed) ?? []);
  const seen: number[][] = [];
  syscalls = new NativeQ3Syscalls(process.callbacks, process.abi, words => {
    if (words.getInt32(0, true) !== 21) throw new Error(`Unbound Q3 native syscall ${words.getInt32(0, true)}`);
    const values = [words.getInt32(4, true), words.getInt32(8, true)];
    seen.push(values);
    return (values[0] ?? 0) + (values[1] ?? 0);
  });
  const module = new Quake3VmModule({ image: process.image, runner: process.runner, context: process.context, instructionBudget: 100000 }, syscalls.address);
  expect(module.call(21, [40, 2])).toBe(42);
  expect(module.call(21, [-5, 3])).toBe(-2);
  expect(seen).toEqual([
    [40, 2],
    [-5, 3],
  ]);
  // A code the table does not handle traps instead of returning success.
  expect(() => module.call(22, [1, 2])).toThrow("Unbound Q3 native syscall 22");
});

test("a Q3 1.32 module's trap may complete asynchronously and may enter the module again", async () => {
  const bytes = quake3I386(),
    fixture = fixtureOf("q3-i386-async", bytes);
  let syscalls: NativeQ3Syscalls | null = null;
  const process = nativeGuestProcess(fixture, (callback, fixed) => syscalls?.variadicLayouts(callback, fixed) ?? []);
  let module: Quake3VmModule | null = null;
  syscalls = new NativeQ3Syscalls(process.callbacks, process.abi, words => {
    const code = words.getInt32(0, true),
      argument = words.getInt32(4, true);
    if (code === 30) return Promise.resolve(argument + 1);
    // A trap that re-enters the module while the outer call waits, as SV_DropClient re-enters GAME_CLIENT_DISCONNECT.
    if (code === 31)
      return (async () => {
        await Promise.resolve();
        return (await module?.callAsync(30, [argument])) ?? -1;
      })();
    throw new Error(`Unbound Q3 native syscall ${code}`);
  });
  module = new Quake3VmModule({ image: process.image, runner: process.runner, context: process.context, instructionBudget: 100000 }, syscalls.address);
  expect(await module.callAsync(30, [41])).toBe(42);
  expect(await module.callAsync(31, [9])).toBe(10);
  expect(() => module.call(30, [1])).toThrow("asynchronous host operation");
  expect(process.runner.depth).toBe(0);
});

test("a synthetic Q3 module without vmMain is refused by the Q3 1.32 wrapper", () => {
  const c = new CodeBuilder();
  c.raw(0xc3);
  const bytes = syntheticElfModule({ width: 4, code: c.finish(), exports: [{ name: "dllEntry", offset: 0 }] });
  const process = nativeGuestProcess(fixtureOf("q3-no-vmmain", bytes));
  const syscalls = new NativeQ3Syscalls(process.callbacks, process.abi, () => 0);
  expect(
    () => new Quake3VmModule({ image: process.image, runner: process.runner, context: process.context, instructionBudget: 1000 }, syscalls.address),
  ).toThrow("requires dllEntry and vmMain");
});

test("every game import a QVM qagame can issue decodes to the same engine call for a native module, with its pointers in the native address space", () => {
  const memory = new SparseGuestMemory({ module: identity("trap-table"), pointerBytes: 4 });
  const base = memory.map({ base: 0x20000n, byteLength: 4096, permissions: "read-write" }),
    guest = new NativeGameMemory(memory);
  const codes = Object.values(QvmGameImport).filter((value): value is QvmGameImport => typeof value === "number");
  expect(codes.length).toBeGreaterThan(90);
  for (const code of codes) {
    const words = new DataView(new ArrayBuffer(64));
    words.setInt32(0, code, true);
    const call = nativeQ3GameCall(words, guest, ["say"]);
    expect(call).toMatchObject({ kind: "engine", role: "qagame", code, commandArguments: ["say"], abiProfile: "q3-modern" });
  }
  // Unknown trap numbers stay extensions, which the shared table rejects as unbound.
  const unknown = new DataView(new ArrayBuffer(64));
  unknown.setInt32(0, 9999, true);
  expect(nativeQ3GameCall(unknown, guest, null)).toMatchObject({ kind: "extension", code: 9999 });
  // libc and math traps execute in the engine against absolute guest addresses: memset, then strncpy from a guest string.
  const at = Number(base.byteOffset);
  const words = (...values: number[]): DataView => {
    const view = new DataView(new ArrayBuffer(64));
    values.forEach((value, index) => view.setInt32(index * 4, value, true));
    return view;
  };
  memory.write(memory.offset(base, 256n), new TextEncoder().encode("hello\0"));
  expect(qvmIntrinsicSyscall("qagame", "q3-modern", words(100, at, 0x5a, 8), guest)).toBe(0);
  expect(guest.span(at, 8)).toEqual(new Uint8Array(8).fill(0x5a));
  expect(qvmIntrinsicSyscall("qagame", "q3-modern", words(102, at, at + 256, 8), guest)).toBe(at);
  expect(guest.readString(at)).toBe("hello");
  expect(() => guest.span(0x90000, 4)).toThrow();
  expect(() => guest.view(0, 4)).toThrow("nonnull");
});
