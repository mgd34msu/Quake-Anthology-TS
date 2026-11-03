// SPDX-License-Identifier: GPL-2.0-or-later
import { QvmGameExport, QvmGameImport } from "../../src/compat/qvm/abi.ts";
import { CodeBuilder, SYNTHETIC_ELF, syntheticElfModule } from "./elf-modules.ts";

/**
 * Q3 1.32 i386 game modules authored for tests: one behavior (a miniature qagame that locates its tables, admits and spawns clients,
 * thinks, runs frames and answers console commands through id's syscall interface) assembled for a Windows PE and for a Linux ELF.
 * Both load at 0x10000000, so the code addresses its data absolutely.
 */
export const Q3_MODULE_BASE = 0x10000000;
export const Q3_ENTITIES = 64, Q3_ENTITY_STRIDE = 560, Q3_CLIENTS = 8, Q3_CLIENT_STRIDE = 480;
/** Offsets from the start of the module's data area. */
export const Q3_DATA = { syscall: 0, frameTime: 4, levelTime: 8, cvar: 0x10, usercmd: 0x120, cvarName: 0x200, cvarDefault: 0x220, hello: 0x230, denied: 0x260, config: 0x2a0,
  bye: 0x2c0, argv: 0x300, entities: 0x400, clients: 0x400 + Q3_ENTITIES * Q3_ENTITY_STRIDE, end: 0x400 + Q3_ENTITIES * Q3_ENTITY_STRIDE + Q3_CLIENTS * Q3_CLIENT_STRIDE } as const;
export const Q3_STRINGS: Readonly<Record<number, string>> = { [Q3_DATA.cvarName]: "g_synthetic", [Q3_DATA.cvarDefault]: "42", [Q3_DATA.hello]: "hello from the Q3 test module\n",
  [Q3_DATA.denied]: "denied by the Q3 test module", [Q3_DATA.config]: "synthetic", [Q3_DATA.bye]: "bye\n" };
/** sharedEntity_t and playerState_t field offsets the module writes. */
export const Q3_FIELDS = { entityNumber: 0, entityType: 4, entityTime: 84, linked: 416, svFlags: 424, mins: 436, maxs: 448, contents: 460, currentOrigin: 488,
  commandTime: 0, psOrigin: 20, clientNumber: 140, viewHeight: 164, health: 184 } as const;

type Operand = number | { readonly arg: number } | "eax" | "ecx";
const float = (value: number): number => new DataView(Float32Array.of(value).buffer).getInt32(0, true);

class Asm {
  private readonly bytes: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly jumps: { readonly at: number; readonly label: string }[] = [];
  constructor(readonly codeAt: number, readonly dataAt: number) {}
  get length(): number { return this.bytes.length; }
  at(offset: number): number { return this.dataAt + offset; }
  mark(name: string): this { this.labels.set(name, this.bytes.length); return this; }
  raw(...values: number[]): this { this.bytes.push(...values); return this; }
  u32(value: number): this { return this.raw(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
  jump(opcode: 0x84 | 0x85, label: string): this { this.raw(0x0f, opcode, 0, 0, 0, 0); this.jumps.push({ at: this.bytes.length - 4, label }); return this; }
  /** syscall(code, ...operands): pushes right to left, calls through the saved entry and pops the frame; the result is left in eax. */
  trap(code: number, ...operands: Operand[]): this {
    for (const operand of [...operands].reverse()) {
      if (typeof operand === "number") this.raw(0x68).u32(operand);
      else if (operand === "eax") this.raw(0x50);
      else if (operand === "ecx") this.raw(0x51);
      else this.raw(0xff, 0x75, 8 + 4 * operand.arg);
    }
    return this.raw(0x68).u32(code).raw(0xff, 0x15).u32(this.at(Q3_DATA.syscall)).raw(0x83, 0xc4, (operands.length + 1) * 4);
  }
  loadArg(register: "eax" | "ecx", index: number): this { return this.raw(0x8b, register === "eax" ? 0x45 : 0x4d, 8 + 4 * index); }
  /** eax = base + eax * stride. */
  record(base: number, stride: number): this { return this.raw(0x69, 0xc0).u32(stride).raw(0x05).u32(base); }
  storeImm(address: number, value: number): this { return this.raw(0xc7, 0x05).u32(address).u32(value); }
  storeEax(address: number): this { return this.raw(0xa3).u32(address); }
  setField(offset: number, value: number): this { return this.raw(0xc7, 0x80).u32(offset).u32(value); }
  setFieldFromEcx(offset: number): this { return this.raw(0x89, 0x88).u32(offset); }
  ecxFromMemory(address: number): this { return this.raw(0x8b, 0x0d).u32(address); }
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

/** dllEntry stores the engine's syscall; vmMain dispatches GAME_* commands. */
function q3Code(codeAt: number, dataAt: number): { readonly code: number[]; readonly dllEntry: number; readonly vmMain: number } {
  const a = new Asm(codeAt, dataAt), at = (offset: number): number => a.at(offset);
  a.mark("dllEntry").raw(0x8b, 0x44, 0x24, 0x04).storeEax(at(Q3_DATA.syscall)).raw(0xc3);
  while (a.length < 0x10) a.raw(0xcc);
  a.mark("vmMain").raw(0x55, 0x89, 0xe5, 0x8b, 0x45, 0x08);
  const dispatch: readonly [QvmGameExport, string][] = [[QvmGameExport.GAME_INIT, "init"], [QvmGameExport.GAME_SHUTDOWN, "shutdown"], [QvmGameExport.GAME_CLIENT_CONNECT, "connect"],
    [QvmGameExport.GAME_CLIENT_BEGIN, "begin"], [QvmGameExport.GAME_CLIENT_THINK, "think"], [QvmGameExport.GAME_CLIENT_DISCONNECT, "disconnect"],
    [QvmGameExport.GAME_RUN_FRAME, "frame"], [QvmGameExport.GAME_CONSOLE_COMMAND, "console"]];
  for (const [command, label] of dispatch) a.raw(0x83, 0xf8, command).jump(0x84, label);
  a.raw(0x31, 0xc0, 0x5d, 0xc3);
  const done = (): void => { a.raw(0x31, 0xc0, 0x5d, 0xc3); };
  // GAME_INIT(levelTime, seed, restart): print, read the clock, register a cvar, locate the entity and client tables, publish a configstring.
  a.mark("init").trap(QvmGameImport.G_PRINT, at(Q3_DATA.hello))
    .trap(QvmGameImport.G_MILLISECONDS).trap(QvmGameImport.G_CVAR_REGISTER, at(Q3_DATA.cvar), at(Q3_DATA.cvarName), at(Q3_DATA.cvarDefault), 0)
    .trap(QvmGameImport.G_LOCATE_GAME_DATA, at(Q3_DATA.entities), Q3_ENTITIES, Q3_ENTITY_STRIDE, at(Q3_DATA.clients), Q3_CLIENT_STRIDE)
    .trap(QvmGameImport.G_SET_CONFIGSTRING, 3, at(Q3_DATA.config))
    .loadArg("eax", 1).storeEax(at(Q3_DATA.levelTime)); done();
  a.mark("shutdown").trap(QvmGameImport.G_PRINT, at(Q3_DATA.bye)); done();
  // GAME_CLIENT_CONNECT(client, firstTime, isBot): refuse client 3 with a message pointer, record the client number in its playerState otherwise.
  a.mark("connect").raw(0x83, 0x7d, 0x0c, 0x03).jump(0x85, "allow").raw(0xb8).u32(at(Q3_DATA.denied)).raw(0x5d, 0xc3);
  a.mark("allow").loadArg("eax", 1).loadArg("ecx", 1).record(at(Q3_DATA.clients), Q3_CLIENT_STRIDE).setFieldFromEcx(Q3_FIELDS.clientNumber); done();
  // GAME_CLIENT_BEGIN(client): spawn a solid player at a fixed point, give it health, and link it.
  a.mark("begin").loadArg("eax", 1).loadArg("ecx", 1).record(at(Q3_DATA.clients), Q3_CLIENT_STRIDE)
    .setField(Q3_FIELDS.psOrigin, float(100)).setField(Q3_FIELDS.psOrigin + 4, float(200)).setField(Q3_FIELDS.psOrigin + 8, float(60))
    .setField(Q3_FIELDS.viewHeight, 26).setField(Q3_FIELDS.health, 100).setFieldFromEcx(Q3_FIELDS.clientNumber)
    .loadArg("eax", 1).record(at(Q3_DATA.entities), Q3_ENTITY_STRIDE).setFieldFromEcx(Q3_FIELDS.entityNumber)
    .setField(Q3_FIELDS.entityType, 1).setField(Q3_FIELDS.svFlags, 0).setField(Q3_FIELDS.contents, 0x2000000)
    .setField(Q3_FIELDS.mins, float(-15)).setField(Q3_FIELDS.mins + 4, float(-15)).setField(Q3_FIELDS.mins + 8, float(-24))
    .setField(Q3_FIELDS.maxs, float(15)).setField(Q3_FIELDS.maxs + 4, float(15)).setField(Q3_FIELDS.maxs + 8, float(32))
    .setField(Q3_FIELDS.currentOrigin, float(100)).setField(Q3_FIELDS.currentOrigin + 4, float(200)).setField(Q3_FIELDS.currentOrigin + 8, float(60))
    .trap(QvmGameImport.G_LINKENTITY, "eax"); done();
  // GAME_CLIENT_THINK(client): read the client's usercmd and publish its server time as the player's command time.
  a.mark("think").trap(QvmGameImport.G_GET_USERCMD, { arg: 1 }, at(Q3_DATA.usercmd)).loadArg("eax", 1).record(at(Q3_DATA.clients), Q3_CLIENT_STRIDE)
    .ecxFromMemory(at(Q3_DATA.usercmd)).setFieldFromEcx(Q3_FIELDS.commandTime); done();
  a.mark("disconnect").loadArg("eax", 1).record(at(Q3_DATA.entities), Q3_ENTITY_STRIDE).trap(QvmGameImport.G_UNLINKENTITY, "eax"); done();
  // GAME_RUN_FRAME(time): record it and stamp it on entity 0.
  a.mark("frame").loadArg("eax", 1).storeEax(at(Q3_DATA.frameTime)).loadArg("ecx", 1).raw(0xb8).u32(at(Q3_DATA.entities)).setFieldFromEcx(Q3_FIELDS.entityTime); done();
  // GAME_CONSOLE_COMMAND: print argv[1] and return argc == 2.
  a.mark("console").trap(QvmGameImport.G_ARGC).raw(0x50).trap(QvmGameImport.G_ARGV, 1, at(Q3_DATA.argv), 64).trap(QvmGameImport.G_PRINT, at(Q3_DATA.argv))
    .raw(0x58, 0x83, 0xf8, 0x02, 0x0f, 0x94, 0xc0, 0x0f, 0xb6, 0xc0, 0x5d, 0xc3);
  const code = a.finish();
  return { code, dllEntry: 0, vmMain: 0x10 };
}

/** PE32 with .text (code), .rdata (export directory for dllEntry and vmMain) and .data (strings, tables), loaded at its preferred base. */
export function authoredQ3Pe(): Uint8Array {
  const bytes = new Uint8Array(0xc00), view = new DataView(bytes.buffer);
  const { code, dllEntry, vmMain } = q3Code(Q3_MODULE_BASE + 0x1000, Q3_MODULE_BASE + 0x3000);
  const u16 = (offset: number, value: number): void => { view.setUint16(offset, value, true); };
  const u32 = (offset: number, value: number): void => { view.setUint32(offset, value, true); };
  const optional = 0x98, directories = optional + 96, sections = optional + 224;
  u16(0, 0x5a4d); u32(0x3c, 0x80); u32(0x80, 0x4550);
  u16(0x84, 0x14c); u16(0x86, 3); u16(0x94, 224); u16(0x96, 0x2102);
  u16(optional, 0x10b); u32(optional + 28, Q3_MODULE_BASE); u32(optional + 32, 0x1000); u32(optional + 36, 0x200); u32(optional + 56, 0x3000 + 0xa000); u32(optional + 60, 0x400); u32(optional + 92, 16);
  u32(directories, 0x2000); u32(directories + 4, 0x100);
  const table: readonly (readonly [string, number, number, number, number, number])[] = [
    [".text", 0x200, 0x1000, 0x200, 0x400, 0x60000020], [".rdata", 0x200, 0x2000, 0x200, 0x600, 0x40000040], [".data", 0xa000, 0x3000, 0x400, 0x800, 0xc0000040]];
  for (const [index, [name, size, rva, rawSize, raw, flags]] of table.entries()) {
    const at = sections + index * 40;
    bytes.set(new TextEncoder().encode(name), at); u32(at + 8, size); u32(at + 12, rva); u32(at + 16, rawSize); u32(at + 20, raw); u32(at + 36, flags);
  }
  bytes.set(code, 0x400);
  const text = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(`${value}\0`), offset); };
  // Export directory at RVA 0x2000 (file 0x600): functions 0x2040, names 0x2050, ordinals 0x2060, strings after.
  u32(0x600 + 12, 0x2090); u32(0x600 + 16, 1); u32(0x600 + 20, 2); u32(0x600 + 24, 2); u32(0x600 + 28, 0x2040); u32(0x600 + 32, 0x2050); u32(0x600 + 36, 0x2060);
  u32(0x640, 0x1000 + dllEntry); u32(0x644, 0x1000 + vmMain); u32(0x650, 0x2070); u32(0x654, 0x2080); u16(0x660, 0); u16(0x662, 1);
  text(0x670, "dllEntry"); text(0x680, "vmMain"); text(0x690, "q3synthetic.dll");
  for (const [offset, value] of Object.entries(Q3_STRINGS)) text(0x800 + Number(offset), value);
  return bytes;
}

/** The same module as a Linux i386 ELF shared object: dllEntry and vmMain exports, loaded at 0x10000000 by the System V runtime. */
export function syntheticQ3Elf(): Uint8Array {
  const dataAt = SYNTHETIC_ELF.data, codeAt = Q3_MODULE_BASE + SYNTHETIC_ELF.code;
  const { code, dllEntry, vmMain } = q3Code(codeAt, Q3_MODULE_BASE + dataAt);
  const builder = new CodeBuilder(); builder.raw(...code);
  const bytes = syntheticElfModule({ width: 4, code: builder.finish(), bss: Q3_DATA.end, exports: [{ name: "dllEntry", offset: dllEntry }, { name: "vmMain", offset: vmMain }] });
  for (const [offset, value] of Object.entries(Q3_STRINGS)) bytes.set(new TextEncoder().encode(`${value}\0`), dataAt + Number(offset));
  return bytes;
}
