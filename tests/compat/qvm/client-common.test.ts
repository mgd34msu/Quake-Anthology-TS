import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { CommandContext } from "../../../src/contracts/common.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { float32ToBits } from "../../../src/core/numeric.ts";
import { QvmCgameImport, QvmUiImport } from "../../../src/compat/qvm/abi.ts";
import { qvmCommonSyscall } from "../../../src/compat/qvm/common-syscalls.ts";
import type { QvmCommonServices } from "../../../src/compat/qvm/common-syscalls.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";

function fixture() {
  const context: CommandContext = { session: createIdentityOwner("QVM common traps").session, origin: { kind: "local-console" } };
  const cvars = new CvarRegistry({ dialect: "q3", context });
  const commands = new CommandBuffer({ dialect: "q3", context, cvars });
  const guest = new QvmMemory(new Uint8Array(4096)), printed: string[] = [], reliable: string[] = [];
  const common = { cvars, print: (text: string) => { printed.push(text); }, milliseconds: () => 1234, arguments: () => commands.tokenizedArguments };
  const cgame: QvmCommonServices = { ...common, role: "cgame", commands: {
    append: text => { commands.append(text); }, register: name => { commands.register(name, null); }, remove: name => { commands.unregister(name); },
    reliable: text => { reliable.push(text); },
  } };
  const ui: QvmCommonServices = { ...common, role: "ui", commands: {
    executeNow: text => { commands.executeNow(text); }, insert: text => { commands.insert(text); }, append: text => { commands.append(text); },
  } };
  const call = (identity: { readonly role: "cgame"; readonly code: QvmCgameImport } | { readonly role: "ui"; readonly code: QvmUiImport },
    args: readonly number[] = [], commandArguments: readonly string[] | null = null): QvmHostCall => {
    const words = new DataView(new ArrayBuffer(4 * (args.length + 1)));
    words.setInt32(0, identity.code, true); args.forEach((word, index) => words.setInt32((index + 1) * 4, word, true));
    const entry = { words, memory: guest.bytes, invoke: (): never => { throw new Error("Unexpected reentry"); },
      invokeAsync: async (): Promise<number> => { throw new Error("Unexpected async reentry"); } };
    return { ...entry, ...identity, kind: "engine", guest, commandArguments };
  };
  return { guest, cvars, commands, cgame, ui, call, printed, reliable };
}

test("QVM cvar records reference the shared registry and retain source update rules", () => {
  const f = fixture();
  f.guest.writeString(512, "g_speed", 32); f.guest.writeString(544, "320", 32);
  expect(qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_CVAR_REGISTER }, [1024, 512, 544, 1]), f.cgame)).toBe(0);
  const record = f.guest.view(1024, 272);
  expect(record.getInt32(12, true)).toBe(320);
  expect(f.guest.readString(1040)).toBe("320");
  f.commands.executeNow("set g_speed 400");
  expect(qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_CVAR_UPDATE }, [1024]), f.ui)).toBe(0);
  expect(record.getInt32(12, true)).toBe(400);
  expect(f.guest.readString(1040)).toBe("400");
  expect(qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_CVAR_VARIABLEVALUE }, [512]), f.ui)).toBe(float32ToBits(400) | 0);
  expect(qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_CVAR_SET }, [512, 0]), f.cgame)).toBe(0);
  expect(f.cvars.variableString("g_speed")).toBe("320");
  f.guest.writeString(576, "absent", 32); f.guest.bytes[608] = 99;
  expect(qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_CVAR_VARIABLESTRINGBUFFER }, [576, 608, 0]), f.ui)).toBe(0);
  expect(f.guest.bytes[608]).toBe(0);
  f.cvars.set("g_speed", "x".repeat(256), true);
  expect(() => qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_CVAR_UPDATE }, [1024]), f.cgame)).toThrow("MAX_CVAR_VALUE_STRING");
});

test("QVM common calls preserve role, current arguments and command ownership", () => {
  const f = fixture();
  const argc = f.call({ role: "cgame", code: QvmCgameImport.CG_ARGC }, [], ["say", "hello", "world"]);
  expect(qvmCommonSyscall(argc, f.cgame)).toBe(3);
  expect(qvmCommonSyscall(argc, f.ui)).toBeNull();
  expect(qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_ARGS }, [512, 64], argc.commandArguments), f.cgame)).toBe(0);
  expect(f.guest.readString(512)).toBe("hello world");
  expect(qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_ARGV }, [9, 512, 64], ["one"]), f.ui)).toBe(0);
  expect(f.guest.readString(512)).toBe("");
  f.guest.writeString(512, "weaponselect", 64);
  qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_ADDCOMMAND }, [512]), f.cgame);
  expect(f.commands.exists("weaponselect")).toBe(true);
  qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_REMOVECOMMAND }, [512]), f.cgame);
  expect(f.commands.exists("weaponselect")).toBe(false);
  qvmCommonSyscall(f.call({ role: "cgame", code: QvmCgameImport.CG_SENDCLIENTCOMMAND }, [512]), f.cgame);
  expect(f.reliable).toEqual(["weaponselect"]);
  expect(qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_MILLISECONDS }), f.ui)).toBe(1234);
  expect(qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_R_CLEARSCENE }), f.ui)).toBeNull();
});

test("UI immediate command trap waits for the actual owner while insert and append retain order", async () => {
  const f = fixture();
  f.guest.writeString(512, "set trap_value first\n", 64);
  qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_CMD_EXECUTETEXT }, [2, 512]), f.ui);
  f.guest.writeString(512, "set trap_value inserted\n", 64);
  qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_CMD_EXECUTETEXT }, [1, 512]), f.ui);
  let released = false;
  const gate = Promise.withResolvers<void>();
  if (f.ui.role !== "ui") throw new Error("Missing UI services");
  const services: QvmCommonServices = { ...f.ui, commands: { ...f.ui.commands, executeNow: async text => {
    await gate.promise; f.commands.executeNow(text); released = true;
  } } };
  const result = qvmCommonSyscall(f.call({ role: "ui", code: QvmUiImport.UI_CMD_EXECUTETEXT }, [0, 0]), services);
  expect(result).toBeInstanceOf(Promise);
  expect(released).toBe(false);
  expect(f.cvars.get("trap_value")).toBeUndefined();
  gate.resolve();
  expect(await result).toBe(0);
  expect(released).toBe(true);
  expect(f.cvars.variableString("trap_value")).toBe("first");
});
