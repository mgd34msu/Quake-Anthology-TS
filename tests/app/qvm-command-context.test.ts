import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { CommandContext } from "../../src/contracts/common.ts";
import { CommandBuffer } from "../../src/core/commands/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { SeatInput } from "../../src/input/seat.ts";
import { prepareClientCommands } from "../../src/app/bootstrap/prepared-startup.ts";
import { qvmClientCommands } from "../../src/app/bootstrap/q3-client/qvm.ts";
import { qvmCommonSyscall, type QvmCommonServices } from "../../src/compat/qvm/common-syscalls.ts";
import { QvmUiImport } from "../../src/compat/qvm/abi.ts";
import { QvmMemory } from "../../src/compat/qvm/memory.ts";

test("remote QVM command modes use the actual seat despite a local-console cvar registry", () => {
  const identity = createIdentityOwner("remote-command-context"), seat = identity.seat(0), client = identity.client(7, 2);
  const consoleContext: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
  const seatContext: CommandContext = { session: identity.session, origin: { kind: "local-seat", seat, client } };
  const live = new CvarRegistry({ dialect: "q3", context: consoleContext });
  const commands = new CommandBuffer({ dialect: "q3", context: consoleContext, cvars: live });
  const input = new SeatInput({ seat, dialect: "q3", context: seatContext, commands, uiEvent: () => false });
  input.bind({ input: { kind: "key", code: 119 }, target: { kind: "command", text: "+forward" } });
  input.input({ kind: "key", seat, code: 119, down: true, repeat: false, timeMilliseconds: 1 });
  const pending = commands.pendingText, bindings = input.bindings;
  const candidate = live.prepareCandidate();
  const program = prepareClientCommands(commands, [{ id: seat, input, context: seatContext }], new Set([live]),
    { dialect: "q3", context: consoleContext, cvars: candidate.cvars });
  const ui = qvmClientCommands(program.commands, seatContext, "ui");
  const services: QvmCommonServices = { role: "ui", cvars: candidate.cvars, print: () => {}, milliseconds: () => 0, arguments: () => [], commands: ui };
  const guest = new QvmMemory(new Uint8Array(1024));
  const invoke = (mode: number, text: string): void => {
    guest.writeString(512, text, 256);
    const words = new DataView(new ArrayBuffer(12)); words.setInt32(0, QvmUiImport.UI_CMD_EXECUTETEXT, true); words.setInt32(4, mode, true); words.setInt32(8, 512, true);
    expect(qvmCommonSyscall({ kind: "engine", role: "ui", code: QvmUiImport.UI_CMD_EXECUTETEXT, words, memory: guest.bytes, guest,
      commandArguments: null, invoke: () => { throw new Error("Unexpected VM reentry"); }, invokeAsync: async () => { throw new Error("Unexpected VM reentry"); } }, services)).toBe(0);
  };
  invoke(0, 'bind w "echo staged-binding"');
  expect(program.input(seat)?.binding({ kind: "key", code: 119 })).toEqual({ kind: "command", text: "echo staged-binding" });
  expect(input.bindings).toEqual(bindings); expect(input.hasHeldInput).toBe(true); expect(commands.pendingText).toBe(pending);
  const seen: { argv: readonly string[]; source: CommandContext }[] = [];
  program.commands.register("probe", command => { seen.push({ argv: command.argv, source: command.source }); });
  invoke(0, "probe now"); invoke(1, "probe inserted\n"); invoke(2, "probe appended\n");
  qvmClientCommands(program.commands, seatContext, "cgame").append("probe cgame\n");
  program.commands.execute();
  expect(seen.map(entry => entry.argv)).toEqual([["probe", "now"], ["probe", "inserted"], ["probe", "appended"], ["probe", "cgame"]]);
  expect(seen.map(entry => entry.source.origin)).toEqual(["q3-ui", "q3-ui", "q3-ui", "q3-cgame"].map(name => ({ kind: "script", name, caller: seatContext.origin })));
  expect(live.context).toBe(consoleContext); expect(commands.pendingText).toBe(pending); expect(input.bindings).toEqual(bindings);
  const nested: CommandContext = { session: identity.session, origin: { kind: "script", name: "caller.cfg", caller: seatContext.origin } };
  qvmClientCommands(program.commands, nested, "ui").executeNow("probe nested");
  expect(seen.at(-1)?.source.origin).toEqual({ kind: "script", name: "q3-ui", caller: nested.origin });
});
