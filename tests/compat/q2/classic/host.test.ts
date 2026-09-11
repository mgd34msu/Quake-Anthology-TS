// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createContentDigest } from "../../../../src/contracts/content.ts";
import type { GuestCallContext, ModuleIdentity } from "../../../../src/contracts/execution.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { createNumericOperations } from "../../../../src/core/numeric.ts";
import { GuestCallbackTable, SparseGuestMemory, createGuestProcessorState } from "../../../../src/guest/core/index.ts";
import { GuestCallRunner, GuestCallStopped } from "../../../../src/guest/abi/index.ts";
import { I386Cpu } from "../../../../src/guest/x86/index.ts";
import { mapPeImage } from "../../../../src/guest/pe/index.ts";
import { WindowsGuestRuntime, type WindowsCapabilities } from "../../../../src/guest/runtime/windows/index.ts";
import { ActorCallbackTable, SessionActorRegistry, SharedBodyTable, translatedBodyBounds } from "../../../../src/world/actors/index.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../../src/world/gameplay/index.ts";
import { ClassicQ2GuestHost, CLASSIC_Q2_TRACE_LAYOUT, classicSignature, classicRequiredPointer, classicPrintf, classicPrintfLayouts, q2Int, q2Pointer, q2Trace, runClassicGuestPmove, type ClassicQ2EngineServices } from "../../../../src/compat/q2/classic/index.ts";

function unavailable(): never { throw new Error("This startup check does not provide a loaded collision world, clients, or network transport"); }
function savedFiles() {
  const files = new Map<string, Uint8Array>();
  const capabilities: WindowsCapabilities = { openFile: (path, options) => {
    if (options.creation === 2) files.set(path, new Uint8Array());
    if (!files.has(path)) return null;
    let closed = false;
    function bytes(): Uint8Array { if (closed) throw new Error("Closed save file"); const value = files.get(path); if (value === undefined) throw new Error("Missing save file"); return value; }
    return { read: (offset, length) => bytes().slice(offset, offset + length),
      write: (offset, data) => { if (!options.write) throw new Error("Read-only save handle"); const previous = bytes(), next = new Uint8Array(Math.max(previous.length, offset + data.length)); next.set(previous); next.set(data, offset); files.set(path, next); return data.length; },
      size: () => bytes().length, truncate: length => { const next = new Uint8Array(length); next.set(bytes().subarray(0, length)); files.set(path, next); }, flush: () => { bytes(); }, close: () => { closed = true; } };
  } };
  return { files, capabilities };
}
function services() {
  const actors = new SessionActorRegistry(createIdentityOwner("classic-native-check")), callbacks = new ActorCallbackTable(actors);
  const bodies = new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: unavailable, onUnlink: unavailable });
  const combat = new GameplayAuthority(actors, callbacks, { impulse: unavailable, beforeReaction: unavailable, confirmed: unavailable });
  const inventory = new SharedInventoryTable(actors);
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: actors.session, origin: { kind: "server-console" } } });
  const prints: string[] = [], configuration = new Map<number, string>(), resources = new Map<string, string[]>();
  const hostServices: ClassicQ2EngineServices = {
    engine: { actors, callbacks, bodies, combat, inventory, trace: unavailable, pointContents: unavailable, inPvs: unavailable,
      inPhs: unavailable, setAreaPortal: unavailable, setSolid: unavailable, inlineModelBounds: unavailable },
    cvars, bindEntity: () => undefined,
    print: (_destination, _entity, _level, text) => { prints.push(text); return undefined; },
    configstring: (index, value) => { configuration.set(index, value); return undefined; },
    resourceIndex: (kind, name) => { if (name.length === 0) return 0; let names = resources.get(kind); if (names === undefined) { names = []; resources.set(kind, names); }
      const index = names.indexOf(name); if (index >= 0) return index + 1; names.push(name); return names.length; },
    sound: unavailable, areasConnected: unavailable, worldLink: unavailable, boxEdicts: unavailable, message: unavailable,
    command: () => ({ arguments: [], args: "" }), addCommand: unavailable, debugGraph: unavailable, pmove: unavailable,
  };
  return { hostServices, prints, configuration, resources };
}
const retailPath = "/home/buzzkill/Projects/qfiles/q2/ctf/gamex86.dll";
test.skipIf(!existsSync(retailPath))("actual CTF DLL runs attach, Init, SpawnEntities, RunFrame, source save IO and Shutdown", async () => {
  const bytes = await readFile(retailPath), hash = createHash("sha256").update(bytes).digest("hex");
  const module: ModuleIdentity = { id: "fixture:classic-ctf", artifactPath: retailPath, revision: hash, digest: createContentDigest(hash) };
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 }), image = mapPeImage({ bytes, memory });
  const saves = savedFiles();
  const table = new GuestCallbackTable(memory), windows = new WindowsGuestRuntime({ memory, callbacks: table, capabilities: saves.capabilities });
  const stack = memory.allocate({ byteLength: 0x100000, label: "native API stack" });
  const sentinel = memory.allocate({ byteLength: 16, label: "native API return" }); memory.write(sentinel, new Uint8Array([0xcc])); memory.protect(sentinel, 16, "read-execute");
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: stack.byteOffset + 0xffff0n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const cpu = new I386Cpu({ state, memory, hostCall: address => table.checkpoint().some(entry => entry.byteOffset === address.byteOffset) });
  let host: ClassicQ2GuestHost | null = null;
  const runner = new GuestCallRunner({ cpu, callbacks: table, returnAddress: sentinel,
    variadicLayouts: (callback, fixed) => { if (host === null) throw new Error("API host not assigned"); return host.variadicLayouts(callback, fixed); } });
  windows.attachRunner(runner);
  if (image.entryPoint === null) throw new Error("CTF DLL lacks entry point");
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: image.entryPoint, abi: { kind: "windows-i386", image: "pe32", pointerBytes: 4, call: "stdcall" } }, parent: null, self: null, other: null };
  windows.initialize(image, { context, instructionBudget: 1000000 });
  const fixture = services(); host = new ClassicQ2GuestHost({ runner, provider: "q2:ctf-native", services: fixture.hostServices, instructionBudget: 2000000 });
  const exported = image.exports.find(entry => entry.symbol.kind === "name" && entry.symbol.name === "GetGameAPI");
  if (exported === undefined || exported.target.kind !== "address") throw new Error("Missing actual GetGameAPI");
  try {
    host.getGameApi(exported.target.address);
    host.init();
    expect(host.edicts.descriptor().count).toBe(5);
    expect(host.edicts.descriptor().capacity).toBe(1024);
    expect(fixture.hostServices.cvars.find("deathmatch")?.numericValue).toBe(1);
    host.spawnEntities("native_check", '{ "classname" "worldspawn" "message" "Native API check" }', "");
    expect(host.edicts.at(0).bytes.getInt32(88, true)).toBe(1);
    expect(host.edicts.at(0).currentActor()).not.toBeNull();
    expect(fixture.configuration.get(0)).toBe("Native API check");
    expect(fixture.prints.join("")).toContain("0 entities inhibited");
    const admission = host.clientConnect(1, "\\name\\Native Guest\\skin\\male/grunt\\ip\\127.0.0.1");
    expect(admission.allowed).toBe(true);
    host.edicts.setClientPing(1, 42);
    expect(host.edicts.clientPrefix(1)?.getInt32(184, true)).toBe(42);
    host.runFrame();
    host.save("WriteGame", "save/game.sav");
    expect(saves.files.get("save/game.sav")?.length).toBeGreaterThan(1000);
    host.save("WriteLevel", "save/level.sav");
    expect(saves.files.get("save/level.sav")?.length).toBeGreaterThan(1000);
    host.save("ReadGame", "save/game.sav");
    expect(host.edicts.descriptor().capacity).toBe(1024);
    host.shutdown();
    expect(fixture.hostServices.engine.actors.ownedBy("q2:ctf-native")).toHaveLength(0);
  } catch (error) {
    if (error instanceof GuestCallStopped) console.error(JSON.stringify({ stop: error.stop, ip: state.instructionPointer, bytes: [...memory.copy({ kind: "guest-address", addressSpace: memory.addressSpace, byteOffset: state.instructionPointer }, 12)], mappings: memory.mappings().filter(mapping => mapping.base > 0x11ac00n && mapping.base < 0x11ae00n) }, (_key, value: unknown) => typeof value === "bigint" ? `0x${value.toString(16)}` : value));
    throw error;
  }
});

test("API 3 printf uses promoted typed variadic arguments and rejects unsupported formats", () => {
  const module: ModuleIdentity = { id: "fixture:printf", artifactPath: "authored", revision: "1", digest: createContentDigest("33".repeat(32)) };
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 });
  expect(classicPrintfLayouts("%s %*.*f %i %%").length).toBe(5);
  expect(classicPrintf(memory, "%04i %+.2f %%", [{ kind: "int32", value: -3 }, { kind: "float64", value: 1.5 }])).toBe("-003 +1.50 %");
  expect(classicPrintf(memory, "%#08x %.0i %f", [{ kind: "int32", value: 42 }, { kind: "int32", value: 0 }, { kind: "float64", value: -0 }])).toBe("0x00002a  -0.000000");
  expect(() => classicPrintfLayouts("%I64d")).toThrow("Unsupported API 3 printf");
});

test("Pmove reenters source trace and contents callbacks synchronously on the same processor", () => {
  const module: ModuleIdentity = { id: "fixture:pmove", artifactPath: "authored", revision: "1", digest: createContentDigest("55".repeat(32)) };
  const memory = new SparseGuestMemory({ module, pointerBytes: 4 }), table = new GuestCallbackTable(memory);
  const stack = memory.allocate({ byteLength: 65536 }), sentinel = memory.allocate({ byteLength: 16 });
  memory.write(sentinel, new Uint8Array([0xcc])); memory.protect(sentinel, 16, "read-execute");
  const state = createGuestProcessorState({ architecture: "i386", instructionPointer: 0n, stackPointer: stack.byteOffset + 65520n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const cpu = new I386Cpu({ state, memory, hostCall: address => table.checkpoint().some(entry => entry.byteOffset === address.byteOffset) });
  const runner = new GuestCallRunner({ cpu, callbacks: table, returnAddress: sentinel }), fixture = services();
  const numeric = createNumericOperations({ id: "q2:pmove-check", arithmetic: { kind: "binary32", round: "each-operation" }, scalarStorage: "binary32", floatToInt: "checked-c-truncation", integerOverflow: "wrap32" });
  const host = new ClassicQ2GuestHost({ runner, provider: "test:pmove", instructionBudget: 10000, services: { ...fixture.hostServices, pmove: (address, owner) => runClassicGuestPmove(address, owner, { numeric }) } });
  const pm = memory.allocate({ byteLength: 240 }), view = memory.borrow(pm, 240);
  let traces = 0, contents = 0, deepest = 0, sawSourceViewheight = false;
  const trace = table.bind({ id: "test:source-trace", signature: classicSignature([q2Pointer, q2Pointer, q2Pointer, q2Pointer], q2Trace), invoke: (_context, args) => {
    traces++; deepest = Math.max(deepest, runner.depth);
    if (view.getFloat32(192, true) === 22) sawSourceViewheight = true;
    const bytes = new Uint8Array(56), traceView = new DataView(bytes.buffer), end = classicRequiredPointer(args, 3);
    traceView.setFloat32(8, 1, true); bytes.set(memory.copy(end, 12), 12);
    return { kind: "aggregate", layout: CLASSIC_Q2_TRACE_LAYOUT, bytes };
  } });
  const point = table.bind({ id: "test:source-contents", signature: classicSignature([q2Pointer], q2Int), invoke: () => { contents++; deepest = Math.max(deepest, runner.depth); return { kind: "int32", value: 0 }; } });
  view.setInt16(8, 640, true); view.setInt16(18, 800, true); view.setUint8(28, 100); view.setInt16(36, 200, true);
  memory.writePointer(memory.offset(pm, 232n), trace); memory.writePointer(memory.offset(pm, 236n), point);
  const code = new Uint8Array([0x68, 0, 0, 0, 0, 0xff, 0x15, 0, 0, 0, 0, 0x83, 0xc4, 4, 0xc3]), codeView = new DataView(code.buffer);
  codeView.setUint32(1, Number(pm.byteOffset), true); codeView.setUint32(7, Number(host.imports.byteOffset + 84n), true);
  const caller = memory.allocate({ byteLength: code.length }); memory.write(caller, code); memory.protect(caller, code.length, "read-execute");
  const stackBefore = state.registers.read("rsp", 32);
  expect(host.invoke(caller, classicSignature([]), []).kind).toBe("void");
  expect(traces).toBeGreaterThan(0); expect(contents).toBeGreaterThan(0); expect(deepest).toBe(2);
  expect(sawSourceViewheight).toBe(true);
  expect(state.registers.read("rsp", 32)).toBe(stackBefore);
  expect(view.getInt16(8, true)).toBeLessThan(640); expect(view.getInt16(4, true)).toBeGreaterThan(0);
  expect(memory.readPointer(memory.offset(pm, 232n))).toEqual(trace);
});
