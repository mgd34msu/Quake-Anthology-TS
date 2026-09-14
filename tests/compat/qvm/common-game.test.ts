import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { QvmGameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { qvmCommonSyscall } from "../../../src/compat/qvm/common-syscalls.ts";
import type { QvmCommonServices } from "../../../src/compat/qvm/common-syscalls.ts";
function fixture() {
  const guest = new QvmMemory(new Uint8Array(4096));
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("common game ABI").session, origin: { kind: "local-console" } } });
  const call = (code: QvmGameImport, args: readonly number[] = [], commandArguments: readonly string[] | null = null): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4)); words.setInt32(0, code, true);
    args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
    return { kind: "engine", role: "qagame", code, guest, words, memory: guest.bytes, commandArguments,
      invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  };
  return { guest, cvars, call };
}

test("qagame common traps use command scope, console completion and supplied realtime", async () => {
  const f = fixture(), gate = Promise.withResolvers<void>(), commands: unknown[] = [];
  const common: QvmCommonServices = { role: "qagame", cvars: f.cvars, print: text => { commands.push(text); },
    milliseconds: () => 987, arguments: () => ["fallback"], commands: { executeNow: text => { commands.push(text); return gate.promise; },
      insert: text => { commands.push(["insert", text]); }, append: text => { commands.push(["append", text]); } },
    realTime: output => { output?.({ second: 1, minute: 2, hour: 3, day: 4, month: 5, year: 126, weekday: 6, yearDay: 42, isDst: 1 }); return 12345; } };
  f.guest.writeString(128, "g_speed", 32); f.guest.writeString(160, "320", 32);
  expect(qvmCommonSyscall(f.call(QvmGameImport.G_CVAR_REGISTER, [1024, 128, 160, 0]), common)).toBe(0);
  expect(qvmCommonSyscall(f.call(QvmGameImport.G_CVAR_VARIABLE_INTEGER_VALUE, [128]), common)).toBe(320);
  expect(qvmCommonSyscall(f.call(QvmGameImport.G_MILLISECONDS), common)).toBe(987);
  expect(qvmCommonSyscall(f.call(QvmGameImport.G_ARGC, [], ["say", "hello"]), common)).toBe(2);
  qvmCommonSyscall(f.call(QvmGameImport.G_ARGV, [1, 512, 32], ["say", "hello"]), common); expect(f.guest.readString(512)).toBe("hello");
  const pending = qvmCommonSyscall(f.call(QvmGameImport.G_SEND_CONSOLE_COMMAND, [0, 0]), common);
  expect(pending).toBeInstanceOf(Promise); gate.resolve(); expect(await pending).toBe(0); expect(commands).toEqual([null]);
  expect(qvmCommonSyscall(f.call(QvmGameImport.G_REAL_TIME, [0]), common)).toBe(12345);
  expect(qvmCommonSyscall(f.call(QvmGameImport.G_REAL_TIME, [512]), common)).toBe(12345);
  expect(Array.from({ length: 9 }, (_, index) => f.guest.view(512, 36).getInt32(index * 4, true))).toEqual([1, 2, 3, 4, 5, 126, 6, 42, 1]);
});
