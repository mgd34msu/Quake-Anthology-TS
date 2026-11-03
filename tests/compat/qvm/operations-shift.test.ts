// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { QvmOpcode } from "../../../src/compat/qvm/image.ts";
import { evaluateQvmBinary } from "../../../src/compat/qvm/operations.ts";

test("variable shift counts are masked to five bits like the compiled x86 module", () => {
  expect(evaluateQvmBinary(QvmOpcode.OP_LSH, 1, 32)).toBe(1);
  expect(evaluateQvmBinary(QvmOpcode.OP_LSH, 1, 33)).toBe(2);
  expect(evaluateQvmBinary(QvmOpcode.OP_LSH, 1, -1)).toBe(-2147483648);
  expect(evaluateQvmBinary(QvmOpcode.OP_RSHI, -8, 33)).toBe(-4);
  expect(evaluateQvmBinary(QvmOpcode.OP_RSHU, -1, 63)).toBe(1);
});
