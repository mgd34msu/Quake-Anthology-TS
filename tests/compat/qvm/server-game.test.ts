import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { CvarRegistry, CvarFlag } from "../../../src/core/cvars/index.ts";
import { QvmGameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../../src/compat/qvm/memory.ts";
import { QvmGameData } from "../../../src/compat/qvm/game-data.ts";
import { QvmUnboundSyscallError, rejectQvmSyscall } from "../../../src/compat/qvm/syscalls.ts";
import type { QvmHostCall } from "../../../src/compat/qvm/syscalls.ts";
import { qvmServerGameSyscall } from "../../../src/compat/qvm/server-game-syscalls.ts";
import type { QvmServerGameServices, QvmServerTraceQuery } from "../../../src/compat/qvm/server-game-syscalls.ts";

function fixture() {
  const guest = new QvmMemory(new Uint8Array(16384)), data = new QvmGameData(guest);
  data.locate(4096, 2, 1024, 8192, 512);
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("server ABI").session, origin: { kind: "local-console" } } });
  const calls: unknown[] = [], tokens = [{ token: "last", ended: true }, { token: "", ended: true }];
  const services: QvmServerGameServices = { data, cvars, maxClients: 2,
    configstrings: { get: index => `config ${index}`, set: (index, value) => { calls.push(["config", index, value]); } },
    getUserinfo: slot => `name=${slot}`, setUserinfo: (slot, value) => { calls.push(["userinfo", slot, value]); },
    getUserCommand: () => ({ serverTime: 123, angles: [1, 32768, -2], buttons: 0x81000000, weapon: 255, forwardmove: -127, rightmove: 12, upmove: -2 }),
    dropClient: async (slot, reason) => { calls.push(["drop", slot, reason]); },
    sendServerCommand: (slot, text) => { calls.push(["send", slot, text]); },
    entityToken: () => tokens.shift() ?? { token: "", ended: true },
    spatial: {
      trace: (query: QvmServerTraceQuery) => { calls.push(query); return { allSolid: false, startSolid: true, fraction: 0.5,
        end: { x: 9, y: 8, z: 7 }, plane: { normal: { x: 0, y: 1, z: 0 }, distance: 4, type: 1, signbits: 2 }, surfaceFlags: 13, contents: 14, entityNum: 1 }; },
      pointContents: (point, slot) => { calls.push([point, slot]); return 17; },
      areaEntities: (bounds, maximum) => { calls.push([bounds, maximum]); return maximum === 0 ? [] : [1]; },
      entityContact: (bounds, slot, capsule) => { calls.push([bounds, slot, capsule]); return true; },
      setBrushModel: (slot, name) => { calls.push([slot, name]); }, adjustAreaPortalState: (slot, open) => { calls.push([slot, open]); },
      inPvs: (first, second, ignore) => { calls.push([first, second, ignore]); return true; },
      areasConnected: (first, second) => first === second,
      link: slot => { calls.push(["link", slot]); }, unlink: slot => { calls.push(["unlink", slot]); },
    },
  };
  const call = (code: QvmGameImport, args: readonly number[] = [], commandArguments: readonly string[] | null = null): QvmHostCall => {
    const words = new DataView(new ArrayBuffer((args.length + 1) * 4)); words.setInt32(0, code, true);
    args.forEach((value, index) => words.setInt32((index + 1) * 4, value, true));
    return { kind: "engine", role: "qagame", code, guest, words, memory: guest.bytes, commandArguments,
      invoke: () => { throw new Error("Unexpected reentry"); }, invokeAsync: async () => { throw new Error("Unexpected reentry"); } };
  };
  return { guest, data, services, calls, call, run: (code: QvmGameImport, args: readonly number[] = []) => qvmServerGameSyscall(call(code, args), services) };
}

test("server ABI validates clients and capacities before guest strings and copies exact usercmd bytes", async () => {
  const f = fixture();
  expect(f.run(QvmGameImport.G_DROP_CLIENT, [-1, 0])).toBe(0);
  expect(f.run(QvmGameImport.G_SEND_SERVER_COMMAND, [2, 0])).toBe(0);
  expect(() => f.run(QvmGameImport.G_GET_USERINFO, [-1, 512, 0])).toThrow("bufferSize");
  expect(() => f.run(QvmGameImport.G_GET_USERINFO, [-1, 512, 32])).toThrow("bad index");
  expect(() => f.run(QvmGameImport.G_GET_CONFIGSTRING, [1024, 512, 32])).toThrow("bad index");
  f.run(QvmGameImport.G_SET_CONFIGSTRING, [2, 0]); f.run(QvmGameImport.G_SET_USERINFO, [1, 0]);
  expect(f.calls).toEqual([["config", 2, ""], ["userinfo", 1, ""]]);
  f.guest.bytes.fill(0xcc, 512, 544);
  expect(f.run(QvmGameImport.G_GET_USERCMD, [1, 512])).toBe(0);
  const cmd = f.guest.view(512, 24);
  expect(cmd.getInt32(0, true)).toBe(123); expect(cmd.getInt32(8, true)).toBe(32768);
  expect(cmd.getUint32(16, true)).toBe(0x81000000); expect(cmd.getUint8(20)).toBe(255);
  expect(cmd.getInt8(21)).toBe(-127); expect(cmd.getInt8(23)).toBe(-2); expect(f.guest.bytes[536]).toBe(0xcc);
  expect(() => f.run(QvmGameImport.G_GET_USERCMD, [2, 512])).toThrow("bad clientNum");
  f.services.cvars.register("hostname", "guest", CvarFlag.ServerInfo);
  f.run(QvmGameImport.G_GET_SERVERINFO, [512, 128]); expect(f.guest.readString(512)).toContain("\\hostname\\guest");
});

test("server ABI awaits reliable lifecycle owners and preserves token EOF", async () => {
  const f = fixture(), gate = Promise.withResolvers<void>();
  f.guest.writeString(512, "text", 16);
  const pendingServices: QvmServerGameServices = { ...f.services, dropClient: () => gate.promise,
    sendServerCommand: () => gate.promise, configstrings: { ...f.services.configstrings, set: () => gate.promise } };
  const pending = [qvmServerGameSyscall(f.call(QvmGameImport.G_DROP_CLIENT, [0, 512]), pendingServices),
    qvmServerGameSyscall(f.call(QvmGameImport.G_SEND_SERVER_COMMAND, [-1, 512]), pendingServices),
    qvmServerGameSyscall(f.call(QvmGameImport.G_SET_CONFIGSTRING, [0, 512]), pendingServices)];
  let done = false; const result = Promise.all(pending).then(values => { done = true; return values; });
  await Promise.resolve(); expect(done).toBe(false); gate.resolve(); expect(await result).toEqual([0, 0, 0]);
  expect(f.run(QvmGameImport.G_GET_ENTITY_TOKEN, [512, 16])).toBe(1); expect(f.guest.readString(512)).toBe("last");
  expect(f.run(QvmGameImport.G_GET_ENTITY_TOKEN, [512, 16])).toBe(0); expect(f.guest.readString(512)).toBe("");
});

test("trace pointers, capsule contacts, table slots and area output retain source ABI", () => {
  const f = fixture();
  [1, 2, 3, 4, 5, 6].forEach((value, index) => f.guest.view(128 + index * 4, 4).setFloat32(0, value, true));
  f.guest.bytes.fill(0xcc, 256, 316);
  expect(f.run(QvmGameImport.G_TRACECAPSULE, [256, 128, 0, 0, 140, 7, 99])).toBe(0);
  expect(f.calls[0]).toEqual({ start: { x: 1, y: 2, z: 3 }, end: { x: 4, y: 5, z: 6 },
    shape: { kind: "capsule", bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } }, passEntityNum: 7, mask: 99 });
  const trace = f.guest.view(256, 56);
  expect(trace.getFloat32(8, true)).toBe(0.5); expect(trace.getFloat32(36, true)).toBe(4);
  expect(trace.getUint8(40)).toBe(1); expect(trace.getUint8(41)).toBe(2); expect(trace.getUint16(42, true)).toBe(0);
  expect(trace.getInt32(52, true)).toBe(1); expect(f.guest.bytes[312]).toBe(0xcc);
  f.run(QvmGameImport.G_LINKENTITY, [5120]); expect(f.calls.at(-1)).toEqual(["link", 1]);
  expect(() => f.run(QvmGameImport.G_LINKENTITY, [5121])).toThrow();
  expect(f.run(QvmGameImport.G_ENTITY_CONTACTCAPSULE, [128, 140, 5120])).toBe(1);
  expect(f.calls.at(-1)).toEqual([{ min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 } }, 1, true]);
  expect(f.run(QvmGameImport.G_ENTITIES_IN_BOX, [128, 140, 512, 1])).toBe(1); expect(f.guest.view(512, 4).getInt32(0, true)).toBe(1);
  expect(f.run(QvmGameImport.G_ENTITIES_IN_BOX, [128, 140, 0, 0])).toBe(0);
  for (const maximum of [2048, -1, -2147483648]) {
    expect(f.run(QvmGameImport.G_ENTITIES_IN_BOX, [128, 140, 512, maximum])).toBe(1);
    expect(f.calls.at(-1)).toEqual([{ min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 } }, maximum]);
    expect(f.guest.view(512, 4).getInt32(0, true)).toBe(1);
  }
  expect(() => f.run(QvmGameImport.G_ENTITIES_IN_BOX, [128, 140, 16382, -1])).toThrow("allocation");
  expect(f.run(QvmGameImport.G_AREAS_CONNECTED, [3, 3])).toBe(1);
  expect(f.run(QvmGameImport.BOTLIB_SETUP)).toBeNull();
  expect(() => rejectQvmSyscall(f.call(QvmGameImport.BOTLIB_SETUP))).toThrow(QvmUnboundSyscallError);
});
