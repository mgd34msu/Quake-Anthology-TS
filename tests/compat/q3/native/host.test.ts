// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openMountPlan } from "../../../../src/content/mounts/index.ts";
import { createMountIdentity } from "../../../../src/contracts/content.ts";
import type { ResolvedExecutionModule } from "../../../../src/contracts/content.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { prepareQ3Native, Q3NativeGuestSource } from "../../../../src/app/bootstrap/simulation/q3/native-guest-source.ts";
import type { NativeQ3GameServices } from "../../../../src/compat/q3/native/index.ts";
import { QvmGameExport, QvmGameImport } from "../../../../src/compat/qvm/abi.ts";
import { CodeBuilder, SYNTHETIC_ELF, syntheticElfModule } from "../../../support/elf-modules.ts";
import { trackedTempDirectories } from "../../../support/temp-directories.ts";
import { runGuestModule } from "../../../../tools/check-guest-module.ts";

const tempDirectory = trackedTempDirectories();
type NativeExecution = Extract<ResolvedExecutionModule, { readonly kind: "native" }>;

// ---- A Q3 1.32 i386 PE authored here: dllEntry(syscall) saves the engine entry and vmMain(cmd, ...) issues the traps below. ----
const base = 0x10000000;
const data = { syscall: 0x3000, milliseconds: 0x3008, levelTime: 0x3010, frameTime: 0x3014, argc: 0x3018, cvar: 0x3100, cvarName: 0x3200, cvarDefault: 0x3220,
  hello: 0x3230, denied: 0x3260, command: 0x3280, config: 0x32a0, bye: 0x32c0, entities: 0x3300, clients: 0x3400, argv: 0x3500 } as const;
const strings: Readonly<Record<number, string>> = { [data.cvarName]: "g_synthetic", [data.cvarDefault]: "42", [data.hello]: "hello from the synthetic PE\n", [data.denied]: "denied by the synthetic PE",
  [data.command]: "print \"tick\"\n", [data.config]: "synthetic", [data.bye]: "bye\n" };

/** A tiny i386 assembler: absolute operands (the image loads at its preferred base) and rel32 branches resolved at the end. */
class Asm {
  readonly bytes: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly jumps: { readonly at: number; readonly label: string }[] = [];
  mark(name: string): this { this.labels.set(name, this.bytes.length); return this; }
  raw(...values: number[]): this { this.bytes.push(...values); return this; }
  u32(value: number): this { return this.raw(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
  push(value: number): this { return this.raw(0x68).u32(value); }
  jump(opcode: 0x84 | 0x85, label: string): this { this.raw(0x0f, opcode, 0, 0, 0, 0); this.jumps.push({ at: this.bytes.length - 4, label }); return this; }
  /** syscall(code, ...arguments): pushes right to left, calls through the saved entry and pops the frame. */
  trap(code: number, ...values: number[]): this {
    for (const value of [...values].reverse()) this.push(value);
    return this.push(code).raw(0xff, 0x15).u32(base + data.syscall).raw(0x83, 0xc4, (values.length + 1) * 4);
  }
  finish(): number[] {
    for (const jump of this.jumps) {
      const target = this.labels.get(jump.label);
      if (target === undefined) throw new Error(`Unknown label ${jump.label}`);
      const displacement = target - (jump.at + 4);
      for (let byte = 0; byte < 4; byte++) this.bytes[jump.at + byte] = (displacement >> (byte * 8)) & 255;
    }
    return this.bytes;
  }
}

function q3Code(): { readonly code: number[]; readonly dllEntry: number; readonly vmMain: number } {
  const a = new Asm(), at = (name: string): number => data[name as keyof typeof data] + base;
  a.mark("dllEntry").raw(0x8b, 0x44, 0x24, 0x04).raw(0xa3).u32(at("syscall")).raw(0xc3);
  while (a.bytes.length < 0x10) a.raw(0xcc);
  a.mark("vmMain").raw(0x55, 0x89, 0xe5, 0x8b, 0x45, 0x08);
  const dispatch: readonly [QvmGameExport, string][] = [[QvmGameExport.GAME_INIT, "init"], [QvmGameExport.GAME_SHUTDOWN, "shutdown"], [QvmGameExport.GAME_CLIENT_CONNECT, "connect"],
    [QvmGameExport.GAME_CLIENT_BEGIN, "begin"], [QvmGameExport.GAME_RUN_FRAME, "frame"], [QvmGameExport.GAME_CONSOLE_COMMAND, "console"]];
  for (const [command, label] of dispatch) a.raw(0x83, 0xf8, command).jump(0x84, label);
  a.raw(0x31, 0xc0, 0x5d, 0xc3);
  // GAME_INIT(levelTime, seed, restart): print, read the clock, register a cvar, locate four 16-byte entities and clients, publish a configstring.
  a.mark("init").trap(QvmGameImport.G_PRINT, at("hello"))
    .trap(QvmGameImport.G_MILLISECONDS).raw(0xa3).u32(at("milliseconds"))
    .trap(QvmGameImport.G_CVAR_REGISTER, at("cvar"), at("cvarName"), at("cvarDefault"), 0)
    .trap(QvmGameImport.G_LOCATE_GAME_DATA, at("entities"), 4, 16, at("clients"), 16)
    .trap(QvmGameImport.G_SET_CONFIGSTRING, 3, at("config"))
    .raw(0x8b, 0x45, 0x0c, 0xa3).u32(at("levelTime")).raw(0x31, 0xc0, 0x5d, 0xc3);
  a.mark("shutdown").trap(QvmGameImport.G_PRINT, at("bye")).raw(0x31, 0xc0, 0x5d, 0xc3);
  // GAME_CLIENT_CONNECT(client, firstTime, isBot): refuse client 3 with a message pointer.
  a.mark("connect").raw(0x83, 0x7d, 0x0c, 0x03).jump(0x85, "allow").raw(0xb8).u32(at("denied")).raw(0x5d, 0xc3);
  a.mark("allow").raw(0x31, 0xc0, 0x5d, 0xc3);
  // GAME_CLIENT_BEGIN reaches a trap that no engine service backs.
  a.mark("begin").trap(QvmGameImport.G_TRACE, 0).raw(0x5d, 0xc3);
  // GAME_RUN_FRAME(time): record it, send a server command and refresh the cvar record.
  a.mark("frame").raw(0x8b, 0x45, 0x0c, 0xa3).u32(at("frameTime"))
    .trap(QvmGameImport.G_SEND_SERVER_COMMAND, 0xffffffff, at("command")).trap(QvmGameImport.G_CVAR_UPDATE, at("cvar")).raw(0x31, 0xc0, 0x5d, 0xc3);
  // GAME_CONSOLE_COMMAND: print argv[1] and return argc == 2.
  a.mark("console").trap(QvmGameImport.G_ARGC).raw(0xa3).u32(at("argc"))
    .trap(QvmGameImport.G_ARGV, 1, at("argv"), 64).trap(QvmGameImport.G_PRINT, at("argv"))
    .raw(0xa1).u32(at("argc")).raw(0x83, 0xf8, 0x02, 0x0f, 0x94, 0xc0, 0x0f, 0xb6, 0xc0, 0x5d, 0xc3);
  const code = a.finish();
  return { code, dllEntry: 0x1000, vmMain: 0x1010 };
}

/** PE32 with .text (code), .rdata (export directory for dllEntry and vmMain) and .data (strings and record arrays), loaded at its preferred base. */
function q3Pe(): Uint8Array {
  const bytes = new Uint8Array(0x1000), view = new DataView(bytes.buffer), { code } = q3Code();
  const u16 = (offset: number, value: number): void => { view.setUint16(offset, value, true); };
  const u32 = (offset: number, value: number): void => { view.setUint32(offset, value, true); };
  const optional = 0x98, directories = optional + 96, sections = optional + 224;
  u16(0, 0x5a4d); u32(0x3c, 0x80); u32(0x80, 0x4550);
  u16(0x84, 0x14c); u16(0x86, 3); u16(0x94, 224); u16(0x96, 0x2102);
  u16(optional, 0x10b); u32(optional + 28, base); u32(optional + 32, 0x1000); u32(optional + 36, 0x200); u32(optional + 56, 0x4000); u32(optional + 60, 0x400); u32(optional + 92, 16);
  u32(directories, 0x2000); u32(directories + 4, 0x100);
  const table: readonly (readonly [string, number, number, number, number, number])[] = [
    [".text", 0x200, 0x1000, 0x200, 0x400, 0x60000020], [".rdata", 0x200, 0x2000, 0x200, 0x600, 0x40000040], [".data", 0x1000, 0x3000, 0x800, 0x800, 0xc0000040]];
  for (const [index, [name, size, rva, rawSize, raw, flags]] of table.entries()) {
    const at = sections + index * 40;
    bytes.set(new TextEncoder().encode(name), at); u32(at + 8, size); u32(at + 12, rva); u32(at + 16, rawSize); u32(at + 20, raw); u32(at + 36, flags);
  }
  bytes.set(code, 0x400);
  const text = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(`${value}\0`), offset); };
  // Export directory at RVA 0x2000 (file 0x600): functions 0x2040, names 0x2050, ordinals 0x2060, strings after.
  u32(0x600 + 12, 0x2090); u32(0x600 + 16, 1); u32(0x600 + 20, 2); u32(0x600 + 24, 2); u32(0x600 + 28, 0x2040); u32(0x600 + 32, 0x2050); u32(0x600 + 36, 0x2060);
  u32(0x640, 0x1000); u32(0x644, 0x1010); u32(0x650, 0x2070); u32(0x654, 0x2080); u16(0x660, 0); u16(0x662, 1);
  text(0x670, "dllEntry"); text(0x680, "vmMain"); text(0x690, "q3synthetic.dll");
  for (const [rva, value] of Object.entries(strings)) text(0x800 + Number(rva) - 0x3000, value);
  for (let slot = 0; slot < 4; slot++) { view.setInt32(0x800 + data.entities - 0x3000 + slot * 16, slot, true); view.setInt32(0x800 + data.clients - 0x3000 + slot * 16, 100 + slot, true); }
  return bytes;
}

interface Harness { readonly source: Q3NativeGuestSource; readonly events: string[]; readonly cvars: CvarRegistry; readonly configstrings: Map<number, string>; arguments: readonly string[]; close(): Promise<void> }

/** Mounts the module bytes, admits them as the selected native server game, and boots the host with recording engine services. */
async function host(bytes: Uint8Array, name: string, profile: NativeExecution["profile"]): Promise<Harness> {
  const directory = await tempDirectory("native-q3-host-");
  await writeFile(join(directory, name), bytes);
  const identity = createMountIdentity("mount:test:native-q3", "q3:native:synthetic:installed", 1);
  const mounts = await openMountPlan({ id: "mount-plan:test:native-q3", mounts: [{ kind: "loose", identity, rootPath: directory }], defaultOrder: [identity.id], prefixOrders: [] });
  try {
    const artifact = await mounts.open(name);
    if (artifact === null) throw new Error("Synthetic Q3 module was not mounted");
    const execution: NativeExecution = { kind: "native", owner: { provider: "q3:native-test", content: identity.content }, role: "server-game", api: { kind: "q3-qagame", version: 7 }, profile, artifact: artifact.reference };
    const prepared = await prepareQ3Native(execution, mounts);
    const events: string[] = [], configstrings = new Map<number, string>(), arguments_ = { current: [] as readonly string[] };
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("native-q3-host").session, origin: { kind: "server-console" } }, print: text => events.push(text) });
    const services: NativeQ3GameServices = { cvars, commandArguments: () => arguments_.current, milliseconds: () => 12345,
      configstrings: { get: index => configstrings.get(index) ?? "", set: (index, value) => { configstrings.set(index, value); } },
      engine: { print: text => events.push(text), log: text => events.push(`log:${text}`), appendConsoleCommand: text => events.push(`append:${text}`), executeConsoleNow: text => events.push(`now:${text}`),
        sendServerCommand: (client, text) => events.push(`${client}:${text}`), dropClient: () => { throw new Error("No admitted client"); }, getUserinfo: () => { throw new Error("No admitted client"); },
        setUserinfo: () => { throw new Error("No admitted client"); }, getUserCommand: () => { throw new Error("No admitted client"); } } };
    const source = Q3NativeGuestSource.create({ prepared, services, instructionBudget: 2_000_000 });
    return { source, events, cvars, configstrings, get arguments() { return arguments_.current; }, set arguments(value) { arguments_.current = value; }, close: async () => { try { source.close(); } finally { await mounts.close(); } } };
  } catch (error) { await mounts.close(); throw error; }
}

test("a native Q3 1.32 PE module runs GAME_INIT, frames, console commands and connects through the host", async () => {
  const bytes = q3Pe();
  const harness = await host(bytes, "qagamex86.dll", { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" });
  const { source, events, cvars, configstrings } = harness;
  try {
    expect(source.profile).toBe("q3-pe");
    const word = (rva: number) => { const address = source.memory.pointer(BigInt(base + rva)); if (address === null) throw new Error("image is not mapped"); return address; };
    expect(() => source.runFrame(1)).toThrow("has not run GAME_INIT");
    source.initialize(1000, 7);
    // Traps reach the engine services with decoded guest strings and records.
    expect(events).toContain("hello from the synthetic PE\n");
    expect(source.memory.readInt32(word(data.milliseconds))).toBe(12345);
    expect(source.memory.readInt32(word(data.levelTime))).toBe(1000);
    expect(cvars.variableString("g_synthetic")).toBe("42");
    expect(source.memory.readInt32(word(data.cvar + 12))).toBe(42);
    expect(configstrings.get(3)).toBe("synthetic");
    expect(source.data.entityCount).toBe(4); expect(source.data.entityBytes).toBe(16);
    expect(source.data.entity(2).getInt32(0, true)).toBe(2); expect(source.data.client(3).getInt32(0, true)).toBe(103);
    expect(source.data.numberFromPointer(word(data.entities + 48))).toBe(3);
    expect(() => source.data.numberFromPointer(word(data.entities + 8))).toThrow("not a located entity");
    expect(() => source.initialize(1000, 7)).toThrow("fresh game");

    // A cvar changed by the engine reaches the module's record at the next trap_Cvar_Update.
    cvars.set("g_synthetic", "77", true); source.runFrame(1100);
    expect(source.memory.readInt32(word(data.frameTime))).toBe(1100);
    expect(source.memory.readInt32(word(data.cvar + 12))).toBe(77);
    expect(events).toContain("-1:print \"tick\"\n");

    // trap_Argc and trap_Argv read the call's own arguments.
    expect(source.consoleCommand(["give", "all"])).toBe(true);
    expect(events).toContain("all");
    expect(source.consoleCommand(["quit"])).toBe(false);

    // ClientConnect returns a pointer to a guest string, or null.
    expect(source.clientConnect(3, true, false)).toBe("denied by the synthetic PE");
    expect(source.clientConnect(1, true, false)).toBeNull();

    // A trap with no engine binding fails explicitly instead of returning success.
    expect(() => source.clientBegin(1)).toThrow("Unbound Q3 native syscall 24");
  } finally { await harness.close(); }
  expect(events.at(-1)).toBe("bye\n");
  expect(source.memory.mappings()).toHaveLength(0);
  expect(() => source.runFrame(1)).toThrow("closed");
});

test("native Q3 admission refuses artifacts that are not an i386 PE or an ELF image", async () => {
  const bytes = new Uint8Array(64);
  await expect(host(bytes, "bad.dll", { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "cdecl" })).rejects.toThrow("Windows PE or a Linux ELF");
});

// ---- A Quake Live API 10 x86-64 ELF: the same host, the other profile. ----
const ql = { table: SYNTHETIC_ELF.data, imports: SYNTHETIC_ELF.data + 0x80, time: SYNTHETIC_ELF.data + 0x90, text: SYNTHETIC_ELF.data + 0xc0 } as const;
function quakeLiveElf(): Uint8Array {
  const c = new CodeBuilder(), table: Record<string, number> = {};
  const fn = (name: string): void => { table[name] = c.mark(name); };
  fn("dllEntry");
  c.raw(0xc7, 0x02).u32(10).raw(0x48, 0x8d, 0x05).rip(ql.table).raw(0x48, 0x89, 0x07).raw(0x48, 0x89, 0x35).rip(ql.imports).raw(0xc3);
  fn("Shutdown"); c.raw(0xc3);
  fn("RunFrame"); c.raw(0x89, 0x3d).rip(ql.time).raw(0xc3);
  fn("RegisterCvars"); c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8d, 0x3d).rip(ql.text).raw(0x48, 0x8b, 0x05).rip(ql.imports).raw(0xff, 0x90).u32(2 * 8).raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  fn("Init"); c.raw(0x89, 0x3d).rip(ql.time).raw(0xc3);
  fn("ConsoleCommand"); c.raw(0x48, 0x83, 0xec, 0x08, 0x48, 0x8b, 0x05).rip(ql.imports).raw(0xff, 0x90).u32(20 * 8).raw(0x48, 0x83, 0xc4, 0x08, 0xc3);
  const slots = ["Shutdown", "RunFrame", "RegisterCvars", "Init", "ConsoleCommand"];
  const bytes = syntheticElfModule({ width: 8, code: c.finish(), exports: [{ name: "dllEntry", offset: table["dllEntry"] ?? 0 }],
    relative: slots.map((name, index) => ({ at: ql.table + index * 8, addend: SYNTHETIC_ELF.code + (table[name] ?? 0) })) });
  bytes.set(new TextEncoder().encode("hello from the synthetic Quake Live module\0"), ql.text);
  return bytes;
}

test("a native Quake Live ELF module runs through the same host and engine services", async () => {
  const bytes = quakeLiveElf();
  const harness = await host(bytes, "qagamex64.so", { kind: "linux-x86-64", image: "elf64", pointerBytes: 8, call: "system-v-x86-64" });
  const { source, events } = harness;
  try {
    expect(source.profile).toBe("quake-live-elf");
    source.initialize(500, 3);
    expect(events).toContain("hello from the synthetic Quake Live module");
    source.runFrame(750);
    harness.arguments = ["say", "hi"];
    expect(source.consoleCommand(["say", "hi"])).toBe(true);
    expect(source.consoleCommand([])).toBe(false);
    expect(() => source.clientBegin(0)).toThrow("outside the verified API 10 table");
    expect(source.coverage.map(call => call.name)).toEqual(expect.arrayContaining(["Printf", "Argc"]));
  } finally { await harness.close(); }
});

test("the module check tool boots a native module through the game host and reports its output or its first failing service", () => {
  const pe = runGuestModule(q3Pe(), "qagamex86.dll");
  expect(pe).toEqual({ profile: "q3-pe", outcome: "ok", output: ["hello from the synthetic PE\n", "bye\n"], detail: null });
  const elf = runGuestModule(quakeLiveElf(), "qagamex64.so");
  expect(elf.profile).toBe("quake-live-elf"); expect(elf.outcome).toBe("ok"); expect(elf.output).toEqual(["hello from the synthetic Quake Live module"]);
  const refused = runGuestModule(new Uint8Array(64), "junk.bin");
  expect(refused.outcome).toBe("failed"); expect(refused.profile).toBeNull(); expect(refused.detail).toContain("Windows PE or a Linux ELF");
});
