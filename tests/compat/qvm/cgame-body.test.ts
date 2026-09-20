import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { QvmModule } from "../../../src/compat/qvm/module.ts";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { resolveQvmArtifact } from "../../../src/compat/qvm/artifacts.ts";
import { QvmBodySubmissions } from "../../../src/compat/qvm/cgame-body.ts";
import { QvmCgameImport } from "../../../src/compat/qvm/abi.ts";

function source(): Uint8Array {
  const operations: readonly (readonly [QvmOpcode, number?])[] = [
    [QvmOpcode.OP_ENTER, 16], [QvmOpcode.OP_CONST, 128], [QvmOpcode.OP_ARG, 8],
    [QvmOpcode.OP_CONST, 8], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 16],
    [QvmOpcode.OP_ENTER, 160], [QvmOpcode.OP_LOCAL, 16], [QvmOpcode.OP_ARG, 8],
    [QvmOpcode.OP_CONST, -1 - QvmCgameImport.CG_R_ADDREFENTITYTOSCENE], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP],
    [QvmOpcode.OP_CONST, 19], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 160],
    [QvmOpcode.OP_ENTER, 160], [QvmOpcode.OP_LOCAL, 16], [QvmOpcode.OP_ARG, 8],
    [QvmOpcode.OP_CONST, -1 - QvmCgameImport.CG_R_ADDREFENTITYTOSCENE], [QvmOpcode.OP_CALL], [QvmOpcode.OP_POP],
    [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_LEAVE, 160],
  ];
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) {
    code.u8(opcode);
    if (operand !== undefined) { if (opcode === QvmOpcode.OP_ARG) code.u8(operand); else code.i32(operand); }
  }
  const instructions = code.finish(), file = new BinaryWriter(32 + instructions.length);
  for (const value of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) file.i32(value);
  file.bytes(instructions); return file.finish();
}

test("body scopes retain nested effect submissions and unwind after an asynchronous source failure", async () => {
  const bytes = source();
  const artifact = resolveQvmArtifact({ bytes, role: "cgame", module: { id: "q3:cgame", artifactPath: "vm/cgame.qvm",
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")), revision: "body-scope" } });
  if (artifact.kind !== "bytecode") throw new Error("Fixture requires bytecode");
  let bodies: QvmBodySubmissions | null = null, fail = false;
  const submitted: number[] = [];
  const vm = new QvmModule({ artifact, host: async call => {
    if (bodies?.suppress(call)) return 0;
    if (call.code !== QvmCgameImport.CG_R_ADDREFENTITYTOSCENE) throw new Error("Unexpected source trap");
    await Promise.resolve();
    if (fail) throw new Error("Renderer unavailable");
    submitted.push(call.words.getInt32(4, true)); return 0;
  } });
  bodies = new QvmBodySubmissions(vm, artifact, [{ entry: 8, actorArgument: 0, entityNumberOffset: 0, reference: { kind: "locals" } }], number => number === 100);
  vm.memory.view(128, 4).setInt32(0, 100, true);
  try {
    await vm.callAsync([]); expect(submitted).toHaveLength(2);
    const effect = submitted[1];
    submitted.length = 0; bodies.enable(true); await vm.callAsync([]);
    expect(submitted).toEqual([effect]);
    fail = true; await expect(vm.callAsync([])).rejects.toThrow("Renderer unavailable");
    bodies.enable(false); fail = false; submitted.length = 0; await vm.callAsync([]);
    expect(submitted).toHaveLength(2);
    bodies.enable(true); vm.memory.view(128, 4).setInt32(0, 101, true); submitted.length = 0; await vm.callAsync([]);
    expect(submitted).toHaveLength(2); expect(vm.memory.view(128, 4).getInt32(0, true)).toBe(101);
  } finally { bodies.close(); vm.retire(); }
});
