import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import type { GuestAddress, GuestCallContext } from "../../../../src/contracts/execution.ts";
import { CvarRegistry } from "../../../../src/core/cvars/index.ts";
import { GuestCallRunner } from "../../../../src/guest/abi/index.ts";
import { createGuestProcessorState, GuestCallbackTable, SparseGuestMemory } from "../../../../src/guest/core/index.ts";
import { I386Cpu } from "../../../../src/guest/x86/index.ts";
import { X64Cpu } from "../../../../src/guest/x64/index.ts";
import { SystemVGuestRuntime } from "../../../../src/guest/runtime/system-v/index.ts";
import { QuakeLiveGameImports, QuakeLiveGameModule } from "../../../../src/compat/q3/native/index.ts";
import { quakeLiveFixture } from "../../../guest/runtime/system-v/fixtures.ts";

export async function nativeGameFixture(name: "qagamei386.so" | "qagamex64.so") {
  const fixture = await quakeLiveFixture(name), { module } = fixture, width = fixture.elf.abi.pointerBytes;
  const memory = new SparseGuestMemory({ module, pointerBytes: width, allocationBase: 0x50000000n });
  memory.map({ base: 0x10000n, byteLength: 0x200000, permissions: "read-write", label: "native fixture stack" });
  const sentinel = memory.map({ base: 0x300000n, byteLength: 4096, permissions: "read-execute", bytes: new Uint8Array([0xcc]) });
  const callbacks = new GuestCallbackTable(memory), events: string[] = [];
  const runtime = new SystemVGuestRuntime({ memory, callbacks, capabilities: { standardOutput: (_stream, bytes) => { events.push(new TextDecoder().decode(bytes)); return bytes.length; } } });
  const state = createGuestProcessorState({ architecture: width === 4 ? "i386" : "x86-64", instructionPointer: sentinel.byteOffset,
    stackPointer: 0x210000n, flags: 2n, x87ControlWord: 0x37f, mxcsr: 0x1f80, mxcsrMask: 0xffff });
  const isHostCall = (address: GuestAddress): boolean => callbacks.resolve(address) !== null;
  const cpu = width === 4 ? new I386Cpu({ state, memory, hostCall: isHostCall }) : new X64Cpu({ state, memory, isHostCall });
  const runner = new GuestCallRunner({ cpu, callbacks, returnAddress: sentinel }); runtime.attachRunner(runner);
  const context: GuestCallContext = { module, callback: { kind: "native-guest", module, address: sentinel, abi: fixture.elf.abi }, parent: null, self: null, other: null };
  const cvars = new CvarRegistry({ dialect: "q3", context: { session: createIdentityOwner("native-q3").session, origin: { kind: "server-console" } }, print: text => events.push(text) });
  const configstrings = new Map<number, string>();
  let arguments_: readonly string[] = [];
  const imports = new QuakeLiveGameImports(memory, callbacks, fixture.elf.abi, { cvars,
    commandArguments: () => arguments_, configstrings: { get: index => configstrings.get(index) ?? "", set: (index, value) => { configstrings.set(index, value); } },
    engine: { print: text => events.push(text), log: text => events.push(text), appendConsoleCommand: text => events.push(text),
      executeConsoleNow: text => events.push(text), sendServerCommand: (client, text) => events.push(`${client}:${text}`),
      dropClient: () => { throw new Error("No admitted client in native fixture"); }, getUserinfo: () => { throw new Error("No admitted client in native fixture"); },
      setUserinfo: () => { throw new Error("No admitted client in native fixture"); }, getUserCommand: () => { throw new Error("No admitted client in native fixture"); } } });
  const image = runtime.load({ bytes: fixture.bytes, module, loadBias: width === 4 ? 0x10000000n : 0x100000000n });
  runtime.initialize(image, { context, instructionBudget: 20000 });
  const game = new QuakeLiveGameModule({ image, runner, context, instructionBudget: 1000000 }, imports.address);
  return { memory, cpu, runner, callbacks, runtime, cvars, configstrings, imports, game, image, context, events,
    command: (values: readonly string[]): boolean => { arguments_ = values; try { return game.consoleCommand(); } finally { arguments_ = []; } } };
}

if (import.meta.main) {
  const value = await nativeGameFixture("qagamex64.so");
  value.game.registerCvars();
  console.log("registered", value.cvars.indexCount);
  try { value.game.initialize(1000, 7); }
  catch (error) {
    console.log(error);
    for (const register of ["rdi", "rsi", "rdx", "rcx", "r8", "r9", "rsp"] satisfies readonly ("rdi" | "rsi" | "rdx" | "rcx" | "r8" | "r9" | "rsp")[]) console.log(register, value.cpu.state.registers.read(register, 64).toString(16));
  }
  console.log(value.imports.coverage.filter(call => call.reached > 0));
}
