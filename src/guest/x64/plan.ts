// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";
import { alu, condition, shift, signedMultiply } from "../x86/arithmetic.ts";
import type { AluOperation, ShiftOperation } from "../x86/arithmetic.ts";
import { canonicalAddress, effectiveOperandOffset, guestAddress, operandAddress, readOperand, writeOperand, writableOperand, X64ProcessorFault, X64Unsupported } from "./decoder.ts";
import type { X64MemoryOperand, X64Operand, X64RegisterOperand } from "./decoder.ts";
import { executeRawSse } from "../floating-point/raw-sse.ts";
import type { RawSseOperation } from "../floating-point/raw-sse.ts";
import type { NumericOperand } from "../floating-point/contracts.ts";
import type { NumericInstruction } from "../floating-point/contracts.ts";
import { executeNumericInstruction } from "../floating-point/index.ts";

export type X64Flow = { readonly kind: "advance" } | { readonly kind: "branch"; readonly target: bigint }
  | { readonly kind: "halt" } | { readonly kind: "trap"; readonly vector: number };
export const x64Advance: X64Flow = { kind: "advance" };
export type X64PlanSource = X64Operand | bigint;
export type X64PlanOperation =
  | { readonly kind: "nop" }
  | { readonly kind: "move"; readonly destination: X64Operand; readonly source: X64PlanSource }
  | { readonly kind: "extend"; readonly destination: X64RegisterOperand; readonly source: X64Operand; readonly signed: boolean }
  | { readonly kind: "increment"; readonly destination: X64Operand; readonly subtract: boolean }
  | { readonly kind: "shift"; readonly destination: X64Operand; readonly operation: ShiftOperation; readonly count: number | "cl" }
  | { readonly kind: "multiply"; readonly destination: X64RegisterOperand; readonly left: X64Operand; readonly right: X64PlanSource }
  | { readonly kind: "conditional-move"; readonly destination: X64RegisterOperand; readonly source: X64Operand; readonly condition: number }
  | { readonly kind: "set-condition"; readonly destination: X64Operand; readonly condition: number }
  | { readonly kind: "lea"; readonly destination: X64RegisterOperand; readonly source: X64MemoryOperand }
  | { readonly kind: "alu"; readonly operation: AluOperation; readonly destination: X64Operand; readonly source: X64PlanSource }
  | { readonly kind: "branch"; readonly condition: number | null; readonly displacement: bigint }
  | { readonly kind: "jump" | "call"; readonly target: X64PlanSource }
  | { readonly kind: "push"; readonly source: X64PlanSource; readonly width: 16 | 64 }
  | { readonly kind: "pop"; readonly destination: X64Operand; readonly width: 16 | 64 }
  | { readonly kind: "return"; readonly discard: bigint }
  | { readonly kind: "numeric"; readonly instruction: NumericInstruction }
  | { readonly kind: "numeric-memory"; readonly instruction: Omit<NumericInstruction, "operand">; readonly operand: X64MemoryOperand }
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
  const endsBlock = operation.kind === "branch" || operation.kind === "return" || operation.kind === "numeric-memory"
    || operation.kind === "call" || operation.kind === "jump" || operation.kind === "push"
    || operation.kind === "pop" && operation.destination.kind === "memory"
    || operation.kind === "increment" && operation.destination.kind === "memory"
    || (operation.kind === "shift" || operation.kind === "set-condition") && operation.destination.kind === "memory"
    || operation.kind === "raw-sse" && operation.operation.kind === "move" && operation.operation.store && operation.operand.kind === "memory"
    || (operation.kind === "move" || operation.kind === "alu")
    && operation.destination.kind === "memory" && (operation.kind !== "alu" || operation.operation !== "cmp" && operation.operation !== "test");
  return Object.freeze({ operation: Object.freeze(operation), nextIP, lock, endsBlock });
}
export function executeX64Plan(plan: X64SemanticPlan, memory: MappedGuestMemory, state: GuestProcessorState): X64Flow {
  const operation = plan.operation;
  switch (operation.kind) {
    case "nop": x64Lock(plan.lock, null, false); return x64Advance;
    case "shift": {
      const count = operation.count === "cl" ? Number(state.registers.read("rcx", 8)) : operation.count;
      x64Lock(plan.lock, null, false);
      writableOperand(memory, state, operation.destination, plan.nextIP);
      const result = shift(operation.operation, operation.destination.width, readOperand(memory, state, operation.destination, plan.nextIP), count, state.flags);
      writeOperand(memory, state, operation.destination, plan.nextIP, result);
      return x64Advance;
    }
    case "multiply": {
      x64Lock(plan.lock, null, false);
      const left = readOperand(memory, state, operation.left, plan.nextIP);
      const right = typeof operation.right === "bigint" ? operation.right : readOperand(memory, state, operation.right, plan.nextIP);
      writeOperand(memory, state, operation.destination, plan.nextIP, signedMultiply(operation.destination.width, left, right, state.flags));
      return x64Advance;
    }
    case "conditional-move": {
      x64Lock(plan.lock, null, false);
      const value = readOperand(memory, state, operation.source, plan.nextIP);
      if (condition(operation.condition, state.flags)) writeOperand(memory, state, operation.destination, plan.nextIP, value);
      else if (operation.destination.width === 32) writeOperand(memory, state, operation.destination, plan.nextIP, readOperand(memory, state, operation.destination, plan.nextIP));
      return x64Advance;
    }
    case "set-condition":
      x64Lock(plan.lock, null, false);
      writeOperand(memory, state, operation.destination, plan.nextIP, condition(operation.condition, state.flags) ? 1n : 0n);
      return x64Advance;
    case "extend": {
      x64Lock(plan.lock, null, false);
      const value = readOperand(memory, state, operation.source, plan.nextIP);
      writeOperand(memory, state, operation.destination, plan.nextIP, operation.signed ? BigInt.asIntN(operation.source.width, value) : value);
      return x64Advance;
    }
    case "increment": {
      x64Lock(plan.lock, operation.destination, true);
      writableOperand(memory, state, operation.destination, plan.nextIP);
      const carry = state.flags.get("carry");
      const value = alu(operation.subtract ? "sub" : "add", operation.destination.width,
        readOperand(memory, state, operation.destination, plan.nextIP), 1n, state.flags);
      writeOperand(memory, state, operation.destination, plan.nextIP, value);
      state.flags.set("carry", carry);
      return x64Advance;
    }
    case "numeric": case "numeric-memory": {
      x64Lock(plan.lock, null, false);
      const instruction: NumericInstruction = operation.kind === "numeric" ? operation.instruction
        : { ...operation.instruction, operand: { kind: "memory", address: operandAddress(memory, state, operation.operand, plan.nextIP) } };
      const result = executeNumericInstruction({ state, memory, instruction });
      if (result.kind === "exception") throw new X64ProcessorFault(result.vector, result.detail);
      if (result.kind === "unsupported") throw new X64Unsupported(result.detail);
      return x64Advance;
    }
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
    case "jump": case "call": {
      x64Lock(plan.lock, null, false);
      const target = canonicalAddress(typeof operation.target === "bigint" ? operation.target
        : readOperand(memory, state, operation.target, plan.nextIP));
      if (operation.kind === "call") {
        const stack = BigInt.asUintN(64, state.registers.read("rsp", 64) - 8n);
        memory.writeUint64(guestAddress(memory, stack, "write"), plan.nextIP);
        state.registers.write("rsp", 64, stack);
      }
      return { kind: "branch", target };
    }
    case "push": {
      x64Lock(plan.lock, null, false);
      const value = typeof operation.source === "bigint" ? operation.source : readOperand(memory, state, operation.source, plan.nextIP);
      const stack = BigInt.asUintN(64, state.registers.read("rsp", 64) - (operation.width === 64 ? 8n : 2n));
      const address = guestAddress(memory, stack, "write");
      if (operation.width === 64) memory.writeUint64(address, value);
      else memory.writeUint16(address, Number(BigInt.asUintN(16, value)));
      state.registers.write("rsp", 64, stack);
      return x64Advance;
    }
    case "pop": {
      x64Lock(plan.lock, null, false);
      const stack = state.registers.read("rsp", 64), address = guestAddress(memory, stack);
      const value = operation.width === 64 ? memory.readUint64(address) : BigInt(memory.readUint16(address));
      state.registers.write("rsp", 64, stack + (operation.width === 64 ? 8n : 2n));
      writeOperand(memory, state, operation.destination, plan.nextIP, value);
      return x64Advance;
    }
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
