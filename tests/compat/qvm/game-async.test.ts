import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { resolveQvmArtifact } from "../../../src/compat/qvm/artifacts.ts";
import { QvmGame } from "../../../src/compat/qvm/game.ts";
import { QvmGameExport, QvmGameImport } from "../../../src/compat/qvm/abi.ts";
import type { QvmHost } from "../../../src/compat/qvm/syscalls.ts";

type Operation = readonly [QvmOpcode, number?];
function game(host: QvmHost, program?: readonly Operation[]): QvmGame {
  // Every export forwards its export code and client/time word to G_PRINT and returns its result.
  const operations: readonly Operation[] = program ?? [[QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_LOCAL, 24], [QvmOpcode.OP_LOAD4],
    [QvmOpcode.OP_ARG, 8], [QvmOpcode.OP_LOCAL, 28], [QvmOpcode.OP_LOAD4], [QvmOpcode.OP_ARG, 12],
    [QvmOpcode.OP_CONST, -QvmGameImport.G_PRINT - 1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 16]];
  const code = new BinaryWriter(128);
  for (const [opcode, operand] of operations) {
    code.u8(opcode);
    if (operand !== undefined) { if (opcode === QvmOpcode.OP_ARG) code.u8(operand); else code.i32(operand); }
  }
  const instructions = code.finish(), out = new BinaryWriter(256);
  for (const value of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) out.i32(value);
  out.bytes(instructions);
  const bytes = out.finish();
  const artifact = resolveQvmArtifact({ role: "qagame", bytes, module: { id: "test:async-game", artifactPath: "vm/qagame.qvm", revision: "test",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")) } });
  if (artifact.kind !== "bytecode") throw new Error("Expected bytecode fixture");
  return new QvmGame({ artifact, host });
}

test("all awaited game exports complete their suspended trap and decode denial/console results", async () => {
  const exports: number[] = [];
  const vm = game(async call => {
    await Promise.resolve();
    const code = call.words.getInt32(4, true); exports.push(code);
    if (code === QvmGameExport.GAME_CLIENT_CONNECT) { call.guest.writeString(512, "guest denied", 32); return 512; }
    return code === QvmGameExport.GAME_CONSOLE_COMMAND ? 1 : 0;
  });
  await vm.initializeAsync(100, 42);
  expect(await vm.clientConnectAsync(2, true, false)).toBe("guest denied");
  await vm.clientBeginAsync(2); await vm.clientUserinfoChangedAsync(2); await vm.clientThinkAsync(2);
  await vm.clientCommandAsync(2, ["say", "hello"]); await vm.runFrameAsync(150);
  expect(await vm.consoleCommandAsync(["status"])).toBe(true);
  await vm.clientDisconnectAsync(2); await vm.shutdownAsync(false);
  expect(exports).toEqual([QvmGameExport.GAME_INIT, QvmGameExport.GAME_CLIENT_CONNECT, QvmGameExport.GAME_CLIENT_BEGIN,
    QvmGameExport.GAME_CLIENT_USERINFO_CHANGED, QvmGameExport.GAME_CLIENT_THINK, QvmGameExport.GAME_CLIENT_COMMAND,
    QvmGameExport.GAME_RUN_FRAME, QvmGameExport.GAME_CONSOLE_COMMAND, QvmGameExport.GAME_CLIENT_DISCONNECT, QvmGameExport.GAME_SHUTDOWN]);
});

test("nested disconnect starts inside current trap scope while unrelated entry is excluded", async () => {
  const gate = Promise.withResolvers<number>(), order: string[] = [];
  const vm = game(call => {
    if (call.words.getInt32(4, true) === QvmGameExport.GAME_CLIENT_DISCONNECT) {
      order.push("disconnect"); return gate.promise;
    }
    order.push("command");
    expect(call.commandArguments).toEqual(["kick", "2"]);
    const nested = vm.clientDisconnectAsync(2);
    return nested.then(() => { order.push("command resumed"); expect(call.commandArguments).toEqual(["kick", "2"]); return 0; });
  });
  const pending = vm.clientCommandAsync(2, ["kick", "2"]);
  expect(order).toEqual(["command", "disconnect"]);
  await expect(vm.runFrameAsync(100)).rejects.toThrow("already active");
  await expect(vm.consoleCommandAsync(["unrelated"])).rejects.toThrow("already active");
  gate.resolve(0); await pending;
  expect(order).toEqual(["command", "disconnect", "command resumed"]);
});

test("connect accepts zero and retirement prevents post-await denial pointer reads", async () => {
  const accepted = game(() => Promise.resolve(0));
  expect(await accepted.clientConnectAsync(0, true, false)).toBeNull();
  const gate = Promise.withResolvers<number>(), vm = game(() => gate.promise);
  const result = vm.clientConnectAsync(0, true, false);
  vm.retire(); gate.resolve(512);
  await expect(result).rejects.toThrow("retired");
});

test("QvmGame owns located table publication before forwarding subsequent traps", async () => {
  const program: readonly Operation[] = [[QvmOpcode.OP_ENTER, 32],
    [QvmOpcode.OP_CONST, 512], [QvmOpcode.OP_ARG, 8], [QvmOpcode.OP_CONST, 2], [QvmOpcode.OP_ARG, 12],
    [QvmOpcode.OP_CONST, 1024], [QvmOpcode.OP_ARG, 16], [QvmOpcode.OP_CONST, 3072], [QvmOpcode.OP_ARG, 20],
    [QvmOpcode.OP_CONST, 512], [QvmOpcode.OP_ARG, 24],
    [QvmOpcode.OP_CONST, -QvmGameImport.G_LOCATE_GAME_DATA - 1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP],
    [QvmOpcode.OP_CONST, -QvmGameImport.G_PRINT - 1], [QvmOpcode.OP_CALL], [QvmOpcode.OP_LEAVE, 32]];
  let forwarded = 0;
  const vm = game(call => {
    expect(call.code).toBe(QvmGameImport.G_PRINT); forwarded++;
    expect(vm.data.numEntities).toBe(2); expect(vm.data.numberFromPointer(1536)).toBe(1);
    return Promise.resolve(0);
  }, program);
  await vm.initializeAsync(0, 0); expect(forwarded).toBe(1);
});
