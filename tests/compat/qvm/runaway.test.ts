// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { BinaryWriter } from "../../../src/core/binary/index.ts";
import { parseQvm, QvmOpcode } from "../../../src/compat/qvm/image.ts";

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
