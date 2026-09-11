// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";

export type NumericOperand = { readonly kind: "memory"; readonly address: GuestAddress }
  | { readonly kind: "register"; readonly index: number };

export interface NumericInstruction {
  readonly opcode: number;
  readonly secondaryOpcode: number | null;
  readonly modrm: number | null;
  readonly operand: NumericOperand | null;
  readonly registerIndex: number;
  readonly prefix: "none" | "66" | "f2" | "f3";
  readonly operandBits: 16 | 32 | 64;
  readonly immediate: number | null;
}

export interface NumericExecutionContext {
  readonly state: GuestProcessorState;
  readonly memory: MappedGuestMemory;
  readonly instruction: NumericInstruction;
}

export type NumericExecutionResult = { readonly kind: "executed" }
  | { readonly kind: "unsupported"; readonly detail: string }
  | { readonly kind: "exception"; readonly vector: 13 | 16 | 19; readonly detail: string };

export class NumericFault extends Error {
  constructor(readonly vector: 13 | 16 | 19, message: string) {
    super(message);
    this.name = "NumericFault";
  }
}
