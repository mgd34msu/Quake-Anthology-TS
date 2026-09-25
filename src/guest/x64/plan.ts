// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";
import { alu, condition } from "../x86/arithmetic.ts";
import type { AluOperation } from "../x86/arithmetic.ts";
import { canonicalAddress, effectiveOperandOffset, readOperand, writeOperand, writableOperand, X64ProcessorFault } from "./decoder.ts";
import type { X64MemoryOperand, X64Operand, X64RegisterOperand } from "./decoder.ts";

export type X64Flow = { readonly kind: "advance" } | { readonly kind: "branch"; readonly target: bigint }
  | { readonly kind: "halt" } | { readonly kind: "trap"; readonly vector: number };
export const x64Advance: X64Flow = { kind: "advance" };
export type X64PlanSource = X64Operand | bigint;
export type X64PlanOperation =
  | { readonly kind: "move"; readonly destination: X64Operand; readonly source: X64PlanSource }
  | { readonly kind: "lea"; readonly destination: X64RegisterOperand; readonly source: X64MemoryOperand }
  | { readonly kind: "alu"; readonly operation: AluOperation; readonly destination: X64Operand; readonly source: X64PlanSource }
  | { readonly kind: "branch"; readonly condition: number | null; readonly displacement: bigint };
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
  const endsBlock = operation.kind === "branch" || (operation.kind === "move" || operation.kind === "alu")
    && operation.destination.kind === "memory" && (operation.kind !== "alu" || operation.operation !== "cmp" && operation.operation !== "test");
  return Object.freeze({ operation: Object.freeze(operation), nextIP, lock, endsBlock });
}
export function executeX64Plan(plan: X64SemanticPlan, memory: MappedGuestMemory, state: GuestProcessorState): X64Flow {
  const operation = plan.operation;
  switch (operation.kind) {
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
  }
}
