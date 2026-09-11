// SPDX-License-Identifier: GPL-2.0-or-later
import type { NumericExecutionContext, NumericExecutionResult } from "./contracts.ts";
import { NumericFault } from "./contracts.ts";
import { executeX87 } from "./x87.ts";
import { executeSse } from "./sse.ts";
export * from "./contracts.ts";
export { readX87Register, writeX87Register, pushX87, popX87, readX87Return, writeX87Return, initializeX87 } from "./x87.ts";

export function executeNumericInstruction(context: NumericExecutionContext): NumericExecutionResult {
  try {
    if (context.instruction.opcode === 0x9b || (context.instruction.opcode >= 0xd8 && context.instruction.opcode <= 0xdf)) return executeX87(context);
    if (context.instruction.opcode === 0x0f) return executeSse(context);
    return { kind: "unsupported", detail: "Unsupported numeric instruction family" };
  } catch (error: unknown) {
    if (error instanceof NumericFault) return { kind: "exception", vector: error.vector, detail: error.message };
    throw error;
  }
}
