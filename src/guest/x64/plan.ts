// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";
import { alu, condition } from "../x86/arithmetic.ts";
import type { AluOperation } from "../x86/arithmetic.ts";
import { canonicalAddress, effectiveOperandOffset, guestAddress, operandAddress, readOperand, writeOperand, writableOperand, X64ProcessorFault, X64Unsupported } from "./decoder.ts";
import type { X64MemoryOperand, X64Operand, X64RegisterOperand } from "./decoder.ts";
import { executeRawSse } from "../floating-point/raw-sse.ts";
import type { RawSseOperation } from "../floating-point/raw-sse.ts";
import type { NumericOperand } from "../floating-point/contracts.ts";

export type X64Flow = { readonly kind: "advance" } | { readonly kind: "branch"; readonly target: bigint }
  | { readonly kind: "halt" } | { readonly kind: "trap"; readonly vector: number };
export const x64Advance: X64Flow = { kind: "advance" };
export type X64PlanSource = X64Operand | bigint;
export type X64PlanOperation =
  | { readonly kind: "move"; readonly destination: X64Operand; readonly source: X64PlanSource }
  | { readonly kind: "lea"; readonly destination: X64RegisterOperand; readonly source: X64MemoryOperand }
  | { readonly kind: "alu"; readonly operation: AluOperation; readonly destination: X64Operand; readonly source: X64PlanSource }
  | { readonly kind: "branch"; readonly condition: number | null; readonly displacement: bigint }
  | { readonly kind: "return"; readonly discard: bigint }
  | { readonly kind: "raw-sse"; readonly operation: RawSseOperation; readonly operand: X64MemoryOperand | Extract<NumericOperand, { kind: "register" }> };
export interface X64SemanticPlan {
  readonly operation: X64PlanOperation;
  readonly nextIP: bigint;
  readonly lock: boolean;
  readonly endsBlock: boolean;
}
export function x64Lock(lock: boolean, destination: X64Operand | null, permitted: boolean): void {
  if (lock && (!permitted || destination?.kind !== "memory")) throw new X64ProcessorFault(6, "LOCK requires a supported memory read-modify-write operand");
}
export function makeX64Plan(operation: X64PlanOperation, nextIP: bigint, lock: boolean): X64SemanticPlan {
  const endsBlock = operation.kind === "branch" || operation.kind === "return"
    || operation.kind === "raw-sse" && operation.operation.kind === "move" && operation.operation.store && operation.operand.kind === "memory"
    || (operation.kind === "move" || operation.kind === "alu")
    && operation.destination.kind === "memory" && (operation.kind !== "alu" || operation.operation !== "cmp" && operation.operation !== "test");
  return Object.freeze({ operation: Object.freeze(operation), nextIP, lock, endsBlock });
}
export function executeX64Plan(plan: X64SemanticPlan, memory: MappedGuestMemory, state: GuestProcessorState): X64Flow {
  const operation = plan.operation;
  switch (operation.kind) {
    case "raw-sse": {
      x64Lock(plan.lock, null, false);
      const operand = operation.operand.kind === "register" ? operation.operand
        : { kind: "memory", address: operandAddress(memory, state, operation.operand, plan.nextIP) } satisfies NumericOperand;
      const result = executeRawSse(operation.operation, operand, state, memory);
      if (result.kind === "unsupported") throw new X64Unsupported(result.detail);
      if (result.kind === "exception") throw new X64ProcessorFault(result.vector, result.detail);
      return x64Advance;
    }
    case "move": {
      x64Lock(plan.lock, null, false);
      const value = typeof operation.source === "bigint" ? operation.source : readOperand(memory, state, operation.source, plan.nextIP);
      writeOperand(memory, state, operation.destination, plan.nextIP, value);
      return x64Advance;
    }
    case "lea":
      x64Lock(plan.lock, null, false);
      writeOperand(memory, state, operation.destination, plan.nextIP, effectiveOperandOffset(state, operation.source, plan.nextIP));
      return x64Advance;
    case "alu": {
      const right = typeof operation.source === "bigint" ? operation.source : readOperand(memory, state, operation.source, plan.nextIP);
      const writes = operation.operation !== "cmp" && operation.operation !== "test";
      x64Lock(plan.lock, operation.destination, writes);
      if (writes) writableOperand(memory, state, operation.destination, plan.nextIP);
      const result = alu(operation.operation, operation.destination.width, readOperand(memory, state, operation.destination, plan.nextIP), right, state.flags);
      if (writes) writeOperand(memory, state, operation.destination, plan.nextIP, result);
      return x64Advance;
    }
    case "branch":
      x64Lock(plan.lock, null, false);
      return operation.condition === null || condition(operation.condition, state.flags)
        ? { kind: "branch", target: canonicalAddress(plan.nextIP + operation.displacement) } : x64Advance;
    case "return": {
      x64Lock(plan.lock, null, false);
      const stack = state.registers.read("rsp", 64), target = memory.readUint64(guestAddress(memory, stack));
      state.registers.write("rsp", 64, stack + 8n);
      const branch = canonicalAddress(target);
      state.registers.write("rsp", 64, state.registers.read("rsp", 64) + operation.discard);
      return { kind: "branch", target: branch };
    }
  }
}
