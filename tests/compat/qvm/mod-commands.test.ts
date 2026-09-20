import { expect, test } from "bun:test";
import { prepareQvmMod } from "../../../src/app/bootstrap/simulation/qvm-mod.ts";
import { QvmGameImport } from "../../../src/compat/qvm/abi.ts";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { digestBytes } from "../../../src/content/mounts/index.ts";
import type { CommandContext } from "../../../src/contracts/common.ts";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import { modInstanceProvider, type ModDescription } from "../../../src/contracts/mods.ts";
import type { QvmModCallbackDeclaration, QvmModSourceCall } from "../../../src/contracts/qvm-mod-callbacks.ts";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { CommandBuffer } from "../../../src/core/commands/index.ts";
import { CvarRegistry } from "../../../src/core/cvars/index.ts";
import { ActorCallbackTable, SessionActorRegistry } from "../../../src/world/actors/index.ts";
import { SharedBodyTable, translatedBodyBounds } from "../../../src/world/actors/body.ts";
import { GameplayAuthority, SharedInventoryTable } from "../../../src/world/gameplay/index.ts";
import { ModCommands } from "../../../src/world/session/mod-commands.ts";
import { ResourceScope } from "../../../src/world/session/resources.ts";

const operations: readonly (readonly [QvmOpcode, number?])[] = [
  [QvmOpcode.OP_ENTER, 8], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 8],
  [QvmOpcode.OP_ENTER, 24], [QvmOpcode.OP_LOCAL, 32], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 8],
  [QvmOpcode.OP_LOCAL, 36], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 12],
  [QvmOpcode.OP_CONST, -QvmGameImport.G_SEND_CONSOLE_COMMAND - 1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP],
  [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 24],
];
const code = new BinaryWriter(128);
for (const [opcode, operand] of operations) { code.u8(opcode); if (operand !== undefined) {
  if (opcode === QvmOpcode.OP_ARG) code.u8(operand); else code.i32(operand);
} }
const instructions = code.finish(), output = new BinaryWriter(32 + instructions.length);
for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 135168]) output.i32(word);
output.bytes(instructions);
const program = output.finish(), selection = { product: "qvm-source", id: "commands" };
const description: ModDescription = { selection, source: { provider: "q3:source", content: "q3:classic:commands:test" }, title: "Commands", sourceTitle: "Source",
  purpose: "addition", requires: [], conflicts: [], availability: { kind: "available" } };
function send(when: number, text: string | null): QvmModSourceCall {
  return { entry: 3, arguments: [{ kind: "int32", value: { kind: "float", value: when } }, text === null ? { kind: "address", value: 0 }
    : { kind: "string", value: { kind: "string", value: text } }], globals: [], returns: "void" };
}
function fixture(initialize: readonly QvmModSourceCall[]) {
  const ids = createIdentityOwner("qvm-command-initialization"), actors = new SessionActorRegistry(ids), resources = new ResourceScope("source");
  const context: CommandContext = { session: ids.session, origin: { kind: "server-console" } };
  const primary = new CvarRegistry({ dialect: "q1-netquake", context });
  let current: CommandBuffer | null = null;
  const mods = new ModCommands({ context, commands: () => current }), seen: string[] = [];
  const commands = new CommandBuffer({ dialect: "q1-netquake", context, cvars: primary,
    cvarRouting: { owner: (_name, source) => mods.cvars(source) ?? primary, visible: source => [mods.cvars(source) ?? primary] },
    serverGame: command => mods.invoke(command) });
  commands.register("record", command => { expect(command.dialect).toBe("q3"); expect(command.source.producer?.module.id).toBe(modInstanceProvider(selection)); seen.push(command.argsText); });
  const callbacks = new ActorCallbackTable(actors), services = { commands: mods, actors, callbacks,
    bodies: new SharedBodyTable(actors, { absoluteBounds: translatedBodyBounds, onLink: () => undefined, onUnlink: () => undefined }),
    combat: new GameplayAuthority(actors, callbacks, { impulse: () => undefined, beforeReaction: () => undefined, confirmed: () => undefined }),
    inventory: new SharedInventoryTable(actors), seed: 1, time: () => ({ kind: "seconds", value: 1 } satisfies import("../../../src/contracts/time.ts").SourceTime) };
  const declaration: QvmModCallbackDeclaration = { version: 1, runtime: "qvm", program: { path: "vm/qagame.qvm", digest: digestBytes(program) },
    abiProfile: "q3-modern", actorRecords: [], entityRecord: null, initialize, callbacks: [] };
  const prepared = prepareQvmMod({ description, declaration, declarationDigest: digestBytes(new Uint8Array([1])), program });
  return { commands, seen, prepare: () => prepared.initialize({ services, instance: modInstanceProvider(selection), resources, nextFrame: async () => {}, assertCurrent: () => {} }),
    publish: () => { current = commands; mods.flush(); }, close: () => { resources.close(); actors.close(); } };
}

test("QVM source commands bind before initialization, retain ordering, and require a buffer for EXEC_NOW", async () => {
  const staged = fixture([send(2, "record appended\n"), send(1, "record inserted\n")]);
  try {
    const runtime = await staged.prepare(); expect(staged.seen).toEqual([]);
    staged.publish(); staged.commands.execute(); expect(staged.seen).toEqual(["inserted", "appended"]); runtime.close();
  } finally { staged.close(); }
  const immediate = fixture([send(2, "record appended\n"), send(1, "record inserted\n"), send(0, "record immediate"), send(0, null)]);
  try { immediate.publish(); await immediate.prepare(); expect(immediate.seen).toEqual(["immediate", "inserted", "appended"]); }
  finally { immediate.close(); }
  const unavailable = fixture([send(0, "record immediate")]);
  try { await expect(unavailable.prepare()).rejects.toThrow("candidate's prepared command buffer"); expect(unavailable.seen).toEqual([]); }
  finally { unavailable.close(); }
});
