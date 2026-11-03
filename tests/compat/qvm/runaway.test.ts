// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { CommonError } from "../../../src/core/common-error.ts";
import { QvmInterpreter } from "../../../src/compat/qvm/interpreter.ts";
import { parseQvm, QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { qvmArguments } from "../../../src/compat/qvm/module.ts";

type Operation = readonly [QvmOpcode, number?];
function program(operations: readonly Operation[]): Uint8Array {
  const code = new BinaryWriter(operations.length * 5);
  for (const [opcode, operand] of operations) {
    code.u8(opcode);
    if (operand !== undefined) code.i32(operand);
  }
  const instructions = code.finish(),
    output = new BinaryWriter(32 + instructions.length);
  for (const word of [0x12721444, operations.length, 32, instructions.length, 32 + instructions.length, 0, 0, 4096]) output.i32(word);
  output.bytes(instructions);
  return output.finish();
}
const noTrap = (): never => {
  throw new Error("Unexpected trap");
};
function fault(source: Uint8Array): unknown {
  const vm = new QvmInterpreter(parseQvm(source), noTrap, undefined, null, "compiled");
  try {
    vm.invoke(qvmArguments([]));
  } catch (error) {
    return error;
  }
  return undefined;
}

function failure(error: unknown): CommonError {
  if (!(error instanceof CommonError)) throw new Error("Expected a CommonError");
  return error;
}

test("bytecode that never returns is stopped with a drop error rather than hanging", () => {
  const error = fault(program([[QvmOpcode.OP_ENTER, 64], [QvmOpcode.OP_CONST, 1], [QvmOpcode.OP_JUMP]]));
  expect(error).toBeInstanceOf(CommonError);
  expect(failure(error).code).toBe("drop");
  expect(failure(error).message).toContain("instruction budget");
}, 60_000);

test("unbounded recursion that never descends the stack is capped by call depth", () => {
  const error = fault(program([[QvmOpcode.OP_ENTER, 0], [QvmOpcode.OP_CONST, 0], [QvmOpcode.OP_CALL]]));
  expect(error).toBeInstanceOf(CommonError);
  expect(failure(error).code).toBe("drop");
});

test("a header that declares a huge data segment is refused before any allocation", () => {
  const writer = new BinaryWriter(64);
  for (const word of [0x12721444, 1, 32, 5, 37, 0, 0, 0x7fffffff]) writer.i32(word);
  writer.u8(QvmOpcode.OP_ENTER);
  writer.i32(0);
  expect(() => parseQvm(writer.finish())).toThrow("allocation range");
});

test("vm_game, vm_cgame and vm_ui select the instruction semantics, with id's compiled default", async () => {
  const { qvmSemanticsFromCvar } = await import("../../../src/compat/qvm/module.ts");
  const values = new Map<string, number>();
  const cvars = {
    register: (name: string, fallback: string) => {
      if (!values.has(name)) values.set(name, Number(fallback));
      return { integerValue: values.get(name) ?? 0 };
    },
  };
  expect(qvmSemanticsFromCvar(cvars, "qagame")).toBe("compiled");
  values.set("vm_game", 1);
  values.set("vm_ui", 0);
  expect(qvmSemanticsFromCvar(cvars, "qagame")).toBe("interpreted");
  expect(qvmSemanticsFromCvar(cvars, "ui")).toBe("compiled");
  expect(qvmSemanticsFromCvar(cvars, "cgame")).toBe("compiled");
});
