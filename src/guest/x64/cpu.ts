// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestCpu, GuestExecutionStop, GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";
import { GuestMemoryFault, SparseGuestMemory } from "../core/memory.ts";
import { prepareRawSse } from "../floating-point/raw-sse.ts";
import type { NumericInstruction } from "../floating-point/contracts.ts";
import { alu, condition, resultFlags, shift, signedMultiply } from "../x86/arithmetic.ts";
import type { AluOperation, ShiftOperation } from "../x86/arithmetic.ts";
import { canonicalAddress, guestAddress, readMemory, registerName, writeMemory, X64DecodeCursor, X64ProcessorFault, X64Unsupported } from "./decoder.ts";
import type { X64DecodedInstruction, X64Operand } from "./decoder.ts";
import { executeX64Plan, makeX64Plan, x64Advance as advance, x64Lock } from "./plan.ts";
import type { X64Flow as Flow, X64PlanOperation, X64SemanticPlan } from "./plan.ts";
import { prepareX64IntegerPlan, X64IntegerKernel } from './integer-kernel.ts';
import type { X64IntegerPlan, X64IntegerStep } from './integer-kernel.ts';
import { GuestCallbackTable } from "../core/callbacks.ts";
import { managedGuestProcessor } from "../core/registers.ts";
import type { IntegerRegisterFile } from "../core/registers.ts";

export interface X64CpuOptions {
  readonly state: GuestProcessorState;
  readonly memory: MappedGuestMemory;
  readonly isHostCall?: (address: GuestAddress) => boolean;
  readonly callbacks?: GuestCallbackTable;
}
interface RunOptions { readonly instructionBudget: number; readonly returnAddress: GuestAddress | null; }
interface CachedInstruction {
  readonly start: bigint;
  readonly decoded: X64DecodedInstruction;
  readonly plan: X64SemanticPlan | null;
  readonly integer: X64IntegerPlan | null;
  block: SemanticBlock | null;
  managedBlock: ManagedBlock | null;
  unhookedRevision: symbol | null | undefined;
}
interface SemanticBlock {
  readonly revision: symbol | null;
  readonly instructions: readonly CachedInstruction[];
}
interface ManagedBlock {
  readonly revision: symbol | null;
  readonly steps: readonly X64IntegerStep[];
  readonly unchanged: () => boolean;
}
const arithmetic: readonly AluOperation[] = ["add", "or", "adc", "sbb", "and", "sub", "xor", "cmp"];
const shifts: readonly ShiftOperation[] = ["rol", "ror", "rcl", "rcr", "shl", "shr", "shl", "sar"];

/** Uses one W30 state and memory. Host addresses stop before instruction fetch. */
export class X64Cpu implements GuestCpu {
  readonly state: GuestProcessorState;
  readonly memory: MappedGuestMemory;
  readonly #isHostCall: (address: GuestAddress) => boolean;
  readonly #instructions = new Map<bigint, CachedInstruction>();
  readonly #callbacks: GuestCallbackTable | null;
  readonly #blocksAllowed: boolean;
  readonly #managedMemory: SparseGuestMemory | null;
  constructor(options: X64CpuOptions) {
    if (options.state.architecture !== "x86-64" || options.memory.pointerBytes !== 8) throw new RangeError("X64Cpu requires x86-64 processor state and 64-bit guest memory");
    this.state = options.state;
    this.memory = options.memory;
    if (options.callbacks !== undefined && (options.callbacks.memory !== options.memory || options.isHostCall !== undefined))
      throw new RangeError("X64Cpu callback table must exclusively own this memory's instruction entries");
    this.#callbacks = options.callbacks ?? null;
    this.#managedMemory = managedGuestProcessor(options.state) !== null && SparseGuestMemory.managed(options.memory)
      && options.isHostCall === undefined && (options.callbacks === undefined || GuestCallbackTable.managed(options.callbacks)) ? options.memory : null;
    if (this.#managedMemory !== null) {
      Object.defineProperty(this, "state", { writable: false, configurable: false });
      Object.defineProperty(this, "memory", { writable: false, configurable: false });
    }
    this.#blocksAllowed = options.isHostCall === undefined;
    this.#isHostCall = options.isHostCall ?? (options.callbacks === undefined ? () => false : address => options.callbacks?.enter(address) === true);
  }

  run(options: RunOptions): GuestExecutionStop {
    if (!Number.isSafeInteger(options.instructionBudget) || options.instructionBudget < 0) throw new RangeError("Instruction budget must be a nonnegative safe integer");
    if (options.returnAddress !== null && options.returnAddress.addressSpace !== this.memory.addressSpace) throw new RangeError("Return address belongs to another guest address space");
    const kernel = X64IntegerKernel.create(this.state, this.memory);
    const managed = this.#managedMemory === null ? null : managedGuestProcessor(this.state);
    return managed !== null && kernel !== null && this.#managedMemory !== null
      ? this.#runManaged(options, kernel, this.#managedMemory, managed.registers) : this.#runGeneric(options, kernel);
  }

  #runGeneric(options: RunOptions, kernel: X64IntegerKernel | null): GuestExecutionStop {
    let checkpoint: Uint8Array | undefined;
    let retainedCursor: X64DecodeCursor | null = null;
    let block: SemanticBlock | null = null, blockIndex = 0;
    for (let instructions = 0; instructions < options.instructionBudget; instructions += 1) {
      const start = this.state.instructionPointer;
      const address = this.#evidenceAddress(start);
      if (options.returnAddress?.byteOffset === start) return { kind: "return", instructions, address };
      const registers = this.state.registers.checkpoint(checkpoint);
      checkpoint = registers;
      const flags = kernel === null ? this.state.flags.value : null;
      const lowFlags = kernel?.flags.lowWord ?? 0, highFlags = kernel?.flags.highWord ?? 0;
      let cursor: X64DecodeCursor | null = null, preparedInstruction: CachedInstruction | null = null;
      try {
        canonicalAddress(start);
        const revision = this.#callbacks?.entryRevision ?? null;
        if (block?.revision !== revision || block.instructions[blockIndex]?.start !== start) block = null;
        let retained = block?.instructions[blockIndex] ?? this.#instructions.get(start);
        if (block === null && retained?.plan !== null && retained !== undefined && this.#blocksAllowed) {
          block = this.#block(retained, revision); blockIndex = 0;
        }
        if (block === null && (retained === undefined || !this.#entryUnhooked(retained, revision))) {
          if (this.#isHostCall(address)) return { kind: "host-call", instructions, address };
          // Entry observers can run nested guest calls and replace cached code.
          retained = this.#instructions.get(start);
        }
        const decoded = this.state.instructionPointer === start && retained !== undefined && retained.decoded.unchanged() ? retained.decoded : null;
        if (decoded === null && block !== null) {
          const owner = block.instructions[0];
          if (owner?.block === block) owner.block = null;
          block = null;
        }
        let flow: Flow, nextIP: bigint;
        if (decoded !== null && retained?.plan !== null && retained !== undefined && this.state.instructionPointer === start) {
          preparedInstruction = retained;
          flow = kernel !== null && retained.integer !== null ? kernel.execute(retained.integer) : executeX64Plan(retained.plan, this.memory, this.state);
          nextIP = retained.plan.nextIP;
        } else {
          block = null;
          if (retainedCursor === null) retainedCursor = new X64DecodeCursor(this.memory, this.state, decoded);
          else retainedCursor.reset(decoded);
          cursor = retainedCursor;
          flow = this.#execute(cursor);
          nextIP = cursor.nextIP;
          if (decoded === null) {
            const prepared = cursor.cache();
            if (this.#instructions.size >= 32768) this.#instructions.clear();
            if (prepared === null || cursor.start !== start) this.#instructions.delete(start);
            else {
              const integer = cursor.plan === null ? null : prepareX64IntegerPlan(cursor.plan);
              this.#instructions.set(start, { start, decoded: prepared, plan: cursor.plan, integer,
                block: null, managedBlock: null, unhookedRevision: undefined });
            }
          }
        }
        this.state.instructionPointer = flow.kind === "branch" ? flow.target : nextIP;
        if (block !== null) {
          blockIndex++;
          if (preparedInstruction?.plan?.endsBlock === true || blockIndex >= block.instructions.length) block = null;
        }
        if (flow.kind === "halt") return { kind: "halt", instructions: instructions + 1, address };
        if (flow.kind === "trap") return { kind: "exception", instructions: instructions + 1, exception: { kind: "processor", vector: flow.vector, errorCode: null, instruction: address, detail: "Software breakpoint" } };
      } catch (error) {
        this.state.registers.restore(registers);
        if (kernel !== null) kernel.flags.restoreWords(lowFlags, highFlags);
        else if (flags !== null) this.state.flags.value = flags;
        this.state.instructionPointer = start;
        if (error instanceof GuestMemoryFault) {
          const access = error.access === "execute" || error.access === "write" ? error.access : "read";
          return { kind: "exception", instructions, exception: { kind: "memory", access, address: this.#evidenceAddress(error.address), byteLength: error.byteLength, detail: error.message } };
        }
        if (error instanceof X64ProcessorFault) return { kind: "exception", instructions, exception: { kind: "processor", vector: error.vector, errorCode: error.vector === 13 ? 0n : null, instruction: address, detail: error.message } };
        if (error instanceof X64Unsupported) return { kind: "unsupported", instructions, instruction: { address, bytes: new Uint8Array(cursor?.bytes ?? preparedInstruction?.decoded.bytes ?? []), mnemonic: `opcode ${(cursor?.opcode ?? preparedInstruction?.decoded.opcode)?.toString(16) ?? "unknown"}` }, detail: error.message };
        throw error;
      }
    }
    const address = this.#evidenceAddress(this.state.instructionPointer);
    if (options.returnAddress?.byteOffset === address.byteOffset) return { kind: "return", instructions: options.instructionBudget, address };
    return { kind: "budget", instructions: options.instructionBudget };
  }

  #runManaged(options: RunOptions, kernel: X64IntegerKernel, memory: SparseGuestMemory, bank: IntegerRegisterFile): GuestExecutionStop {
    const state = this.state, flags = kernel.flags;
    let checkpoint: Uint8Array | undefined;
    let retainedCursor: X64DecodeCursor | null = null;
    let block: SemanticBlock | null = null, blockIndex = 0;
    for (let instructions = 0; instructions < options.instructionBudget; instructions += 1) {
      const start = state.instructionPointer;
      if (options.returnAddress?.byteOffset === start) return { kind: "return", instructions, address: this.#evidenceAddress(start) };
      const revision: symbol | null = this.#callbacks?.entryRevision ?? null;
      if (block?.revision !== revision || block.instructions[blockIndex]?.start !== start) block = null;
      let retained: CachedInstruction | undefined = block?.instructions[blockIndex] ?? this.#instructions.get(start);
      const first = retained;
      const prepared: ManagedBlock | null = first?.integer == null ? null : first.managedBlock?.revision === revision
        ? first.managedBlock : this.#managedBlock(first, revision, memory);
      if (prepared !== null && !prepared.unchanged()) {
        if (first !== undefined) first.managedBlock = null;
      } else if (prepared !== null && bank.attached()) {
        const result = kernel.executeBlock(prepared.steps, options.instructionBudget - instructions, options.returnAddress?.byteOffset ?? null);
        instructions += result.instructions;
        block = null;
        if (result.kind === "return") return { kind: "return", instructions, address: this.#evidenceAddress(state.instructionPointer) };
        if (result.kind === "fault") {
          const error = result.error;
          if (error instanceof GuestMemoryFault) {
            const access = error.access === "execute" || error.access === "write" ? error.access : "read";
            return { kind: "exception", instructions, exception: { kind: "memory", access, address: this.#evidenceAddress(error.address), byteLength: error.byteLength, detail: error.message } };
          }
          if (error instanceof X64ProcessorFault) return { kind: "exception", instructions, exception: { kind: "processor", vector: error.vector, errorCode: error.vector === 13 ? 0n : null, instruction: this.#evidenceAddress(state.instructionPointer), detail: error.message } };
          throw error;
        }
        instructions--;
        continue;
      }
      const registers = bank.checkpoint(checkpoint);
      checkpoint = registers;
      const lowFlags = flags.lowWord, highFlags = flags.highWord;
      let cursor: X64DecodeCursor | null = null, preparedInstruction: CachedInstruction | null = null;
      try {
        canonicalAddress(start);
        if (block === null && retained?.plan !== null && retained !== undefined) {
          block = this.#block(retained, revision); blockIndex = 0;
        }
        if (block === null && (retained === undefined || !this.#entryUnhooked(retained, revision))) {
          const address = this.#evidenceAddress(start);
          if (this.#isHostCall(address)) return { kind: "host-call", instructions, address };
          // Entry observers can run nested guest calls and replace cached code.
          retained = this.#instructions.get(start);
        }
        const decoded = state.instructionPointer === start && retained !== undefined && retained.decoded.unchanged() ? retained.decoded : null;
        if (decoded === null && block !== null) {
          const owner = block.instructions[0];
          if (owner?.block === block) owner.block = null;
          block = null;
        }
        let flow: Flow, nextIP: bigint;
        if (decoded !== null && retained?.plan !== null && retained !== undefined && state.instructionPointer === start) {
          preparedInstruction = retained;
          flow = retained.integer !== null ? kernel.execute(retained.integer) : executeX64Plan(retained.plan, memory, state);
          nextIP = retained.plan.nextIP;
        } else {
          block = null;
          if (retainedCursor === null) retainedCursor = new X64DecodeCursor(memory, state, decoded);
          else retainedCursor.reset(decoded);
          cursor = retainedCursor;
          flow = this.#execute(cursor);
          nextIP = cursor.nextIP;
          if (decoded === null) {
            const prepared = cursor.cache();
            if (this.#instructions.size >= 32768) this.#instructions.clear();
            if (prepared === null || cursor.start !== start) this.#instructions.delete(start);
            else {
              const integer = cursor.plan === null ? null : prepareX64IntegerPlan(cursor.plan);
              this.#instructions.set(start, { start, decoded: prepared, plan: cursor.plan, integer,
                block: null, managedBlock: null, unhookedRevision: undefined });
            }
          }
        }
        state.instructionPointer = flow.kind === "branch" ? flow.target : nextIP;
        if (block !== null) {
          blockIndex++;
          if (preparedInstruction?.plan?.endsBlock === true || blockIndex >= block.instructions.length) block = null;
        }
        if (flow.kind === "halt") return { kind: "halt", instructions: instructions + 1, address: this.#evidenceAddress(start) };
        if (flow.kind === "trap") return { kind: "exception", instructions: instructions + 1, exception: { kind: "processor", vector: flow.vector, errorCode: null, instruction: this.#evidenceAddress(start), detail: "Software breakpoint" } };
      } catch (error) {
        bank.restore(registers);
        flags.restoreWords(lowFlags, highFlags);
        state.instructionPointer = start;
        if (error instanceof GuestMemoryFault) {
          const access = error.access === "execute" || error.access === "write" ? error.access : "read";
          return { kind: "exception", instructions, exception: { kind: "memory", access, address: this.#evidenceAddress(error.address), byteLength: error.byteLength, detail: error.message } };
        }
        if (error instanceof X64ProcessorFault) return { kind: "exception", instructions, exception: { kind: "processor", vector: error.vector, errorCode: error.vector === 13 ? 0n : null, instruction: this.#evidenceAddress(start), detail: error.message } };
        if (error instanceof X64Unsupported) return { kind: "unsupported", instructions, instruction: { address: this.#evidenceAddress(start), bytes: new Uint8Array(cursor?.bytes ?? preparedInstruction?.decoded.bytes ?? []), mnemonic: `opcode ${(cursor?.opcode ?? preparedInstruction?.decoded.opcode)?.toString(16) ?? "unknown"}` }, detail: error.message };
        throw error;
      }
    }
    const address = this.#evidenceAddress(state.instructionPointer);
    if (options.returnAddress?.byteOffset === address.byteOffset) return { kind: "return", instructions: options.instructionBudget, address };
    return { kind: "budget", instructions: options.instructionBudget };
  }

  #managedBlock(first: CachedInstruction, revision: symbol | null, memory: SparseGuestMemory): ManagedBlock | null {
    if (first.managedBlock?.revision === revision) return first.managedBlock;
    if (first.integer === null) return null;
    const steps: X64IntegerStep[] = [], bytes: number[] = [];
    let current: CachedInstruction | undefined = first, complete = true;
    while (current?.integer !== null && current !== undefined) {
      if (!this.#entryUnhooked(current, revision)) break;
      steps.push({ start: current.start, integer: current.integer });
      bytes.push(...current.decoded.bytes);
      if (current.integer.original.endsBlock || steps.length === 16) break;
      current = this.#instructions.get(current.integer.original.nextIP);
      if (current === undefined) complete = false;
    }
    if (steps.length === 0) return null;
    const unchanged = memory.retainExecutableRange(first.start, bytes);
    if (unchanged === null) return null;
    const prepared: ManagedBlock = { revision, steps, unchanged };
    if (complete) first.managedBlock = prepared;
    return prepared;
  }

  #entryUnhooked(instruction: CachedInstruction, revision: symbol | null): boolean {
    if (!this.#blocksAllowed) return false;
    if (instruction.unhookedRevision === revision) return true;
    if (this.#callbacks?.instructionUnhooked(instruction.start) === false) return false;
    instruction.unhookedRevision = revision;
    return true;
  }
  #block(first: CachedInstruction, revision: symbol | null): SemanticBlock | null {
    if (first.block?.revision === revision) return first.block;
    const instructions: CachedInstruction[] = [];
    let current: CachedInstruction | undefined = first, complete = true;
    while (current !== undefined && current.plan !== null) {
      if (!this.#entryUnhooked(current, revision)) break;
      instructions.push(current);
      if (current.plan.endsBlock || instructions.length === 16) break;
      current = this.#instructions.get(current.plan.nextIP);
      if (current === undefined) complete = false;
    }
    if (instructions.length === 0) return null;
    const block: SemanticBlock = { revision, instructions };
    if (complete) first.block = block;
    return block;
  }

  #evidenceAddress(byteOffset: bigint): GuestAddress { return { kind: "guest-address", addressSpace: this.memory.addressSpace, byteOffset }; }
  #push(value: bigint, width: 16 | 64): undefined {
    const next = BigInt.asUintN(64, this.state.registers.read("rsp", 64) - BigInt(width / 8));
    writeMemory(this.memory, guestAddress(this.memory, next, "write"), width, value);
    return this.state.registers.write("rsp", 64, next);
  }
  #pop(width: 16 | 64): bigint {
    const stack = this.state.registers.read("rsp", 64);
    const value = readMemory(this.memory, guestAddress(this.memory, stack), width);
    this.state.registers.write("rsp", 64, stack + BigInt(width / 8));
    return value;
  }
  #branch(target: bigint): Flow { return { kind: "branch", target: canonicalAddress(target) }; }
  #lock(cursor: X64DecodeCursor, destination: X64Operand | null, permitted: boolean): undefined {
    x64Lock(cursor.lock, destination, permitted);
    return undefined;
  }
  #planned(cursor: X64DecodeCursor, operation: X64PlanOperation): Flow {
    cursor.plan = makeX64Plan(operation, cursor.nextIP, cursor.lock);
    return executeX64Plan(cursor.plan, this.memory, this.state);
  }
  #execute(cursor: X64DecodeCursor): Flow {
    const op = cursor.opcode;
    const width = cursor.width;
    if (op < 0x40 && (op & 7) <= 5) {
      const operation = arithmetic[op >> 3];
      if (operation === undefined) throw new X64ProcessorFault(6, "Invalid arithmetic operation");
      const form = op & 7;
      const bits = (form & 1) === 0 ? 8 : width;
      if (form < 4) {
        const decoded = cursor.decodeModRM(bits);
        const destination = form < 2 ? decoded.rm : decoded.reg;
        const source = form < 2 ? decoded.reg : decoded.rm;
        return this.#planned(cursor, { kind: "alu", operation, destination, source });
      }
      return this.#planned(cursor, { kind: "alu", operation, destination: cursor.register(0, bits), source: cursor.immediate(bits) });
    }
    if (op >= 0x50 && op <= 0x57) return this.#planned(cursor, { kind: "push", source: cursor.register(op - 0x50 + cursor.rexB, cursor.stackWidth), width: cursor.stackWidth });
    if (op >= 0x58 && op <= 0x5f) return this.#planned(cursor, { kind: "pop", destination: cursor.register(op - 0x58 + cursor.rexB, cursor.stackWidth), width: cursor.stackWidth });
    if (op >= 0x70 && op <= 0x7f) {
      this.#lock(cursor, null, false);
      const displacement = cursor.readSigned(1);
      return this.#planned(cursor, { kind: "branch", condition: op & 15, displacement });
    }
    if (op >= 0x90 && op <= 0x97) {
      this.#lock(cursor, null, false);
      const index = op - 0x90 + cursor.rexB;
      if (index !== 0) {
        const other = cursor.register(index, width);
        const value = cursor.read(other);
        cursor.write(other, this.state.registers.read("rax", width));
        this.state.registers.write("rax", width, value);
      }
      return advance;
    }
    if (op >= 0xb0 && op <= 0xbf) {
      this.#lock(cursor, null, false);
      const bits = op < 0xb8 ? 8 : width;
      const value = cursor.readUnsigned(bits / 8);
      return this.#planned(cursor, { kind: "move", destination: cursor.register((op & 7) + cursor.rexB, bits), source: value });
    }
    if (op >= 0xd8 && op <= 0xdf) { this.#numeric(cursor, null); return advance; }
    switch (op) {
      case 0x0f: return this.#extended(cursor);
      case 0x63: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM(width === 16 ? 16 : 32);
        const value = BigInt.asIntN(decoded.rm.width, cursor.read(decoded.rm));
        cursor.write(cursor.register(decoded.registerIndex, width), value);
        return advance;
      }
      case 0x68: case 0x6a: {
        this.#lock(cursor, null, false);
        const value = cursor.readSigned(op === 0x6a ? 1 : cursor.stackWidth === 16 ? 2 : 4);
        return this.#planned(cursor, { kind: "push", source: value, width: cursor.stackWidth });
      }
      case 0x69: case 0x6b: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM(width);
        const immediate = op === 0x6b ? cursor.readSigned(1) : cursor.immediate(width);
        cursor.write(decoded.reg, signedMultiply(width, cursor.read(decoded.rm), immediate, this.state.flags));
        return advance;
      }
      case 0x80: case 0x81: case 0x83: {
        const decoded = cursor.decodeModRM(op === 0x80 ? 8 : width);
        const operation = arithmetic[decoded.extension];
        if (operation === undefined) throw new X64ProcessorFault(6, "Invalid immediate operation");
        const immediate = op === 0x83 ? cursor.readSigned(1) : cursor.immediate(decoded.rm.width);
        return this.#planned(cursor, { kind: "alu", operation, destination: decoded.rm, source: immediate });
      }
      case 0x84: case 0x85: {
        const decoded = cursor.decodeModRM(op === 0x84 ? 8 : width);
        return this.#planned(cursor, { kind: "alu", operation: "test", destination: decoded.rm, source: decoded.reg });
      }
      case 0x86: case 0x87: {
        const decoded = cursor.decodeModRM(op === 0x86 ? 8 : width);
        this.#lock(cursor, decoded.rm, true);
        cursor.writable(decoded.rm);
        const value = cursor.read(decoded.rm);
        cursor.write(decoded.rm, cursor.read(decoded.reg));
        cursor.write(decoded.reg, value);
        return advance;
      }
      case 0x88: case 0x89: case 0x8a: case 0x8b: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM((op & 1) === 0 ? 8 : width);
        return this.#planned(cursor, { kind: "move", destination: op < 0x8a ? decoded.rm : decoded.reg, source: op < 0x8a ? decoded.reg : decoded.rm });
      }
      case 0x8d: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM(width);
        if (decoded.rm.kind !== "memory") throw new X64ProcessorFault(6, "LEA requires a memory addressing form");
        return this.#planned(cursor, { kind: "lea", destination: decoded.reg, source: decoded.rm });
      }
      case 0x8f: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM(cursor.stackWidth);
        if (decoded.extension !== 0) throw new X64Unsupported(`POP/XOP group /${decoded.extension}`);
        return this.#planned(cursor, { kind: "pop", destination: decoded.rm, width: cursor.stackWidth });
      }
      case 0x98: {
        this.#lock(cursor, null, false);
        const sourceWidth = width === 64 ? 32 : width === 32 ? 16 : 8;
        this.state.registers.write("rax", width, BigInt.asIntN(sourceWidth, this.state.registers.read("rax", sourceWidth)));
        return advance;
      }
      case 0x99: {
        this.#lock(cursor, null, false);
        const value = BigInt.asIntN(width, this.state.registers.read("rax", width)) < 0n ? -1n : 0n;
        this.state.registers.write("rdx", width, value);
        return advance;
      }
      case 0x9b: this.#numeric(cursor, null); return advance;
      case 0x9c: this.#lock(cursor, null, false); this.#push(this.state.flags.value & ~0x30000n, cursor.stackWidth); return advance;
      case 0x9d: {
        this.#lock(cursor, null, false);
        const value = this.#pop(cursor.stackWidth);
        const mask = cursor.stackWidth === 16 ? 0x4dd5n : 0x244dd5n;
        this.state.flags.value = (this.state.flags.value & ~mask & ~0x10000n) | (value & mask) | 2n;
        return advance;
      }
      case 0x9e: this.#lock(cursor, null, false); this.state.flags.value = (this.state.flags.value & ~0xd5n) | (this.state.registers.read("rax", 8, true) & 0xd5n) | 2n; return advance;
      case 0x9f: this.#lock(cursor, null, false); this.state.registers.write("rax", 8, (this.state.flags.value & 0xd5n) | 2n, true); return advance;
      case 0xa0: case 0xa1: case 0xa2: case 0xa3: {
        this.#lock(cursor, null, false);
        const bits = (op & 1) === 0 ? 8 : width;
        const raw = cursor.readUnsigned(cursor.addressBits / 8);
        const segmentBase = cursor.segment === null ? 0n : this.state.segments[cursor.segment].base;
        const address = guestAddress(this.memory, raw + segmentBase, op < 0xa2 ? "read" : "write");
        if (op < 0xa2) this.state.registers.write("rax", bits, readMemory(this.memory, address, bits));
        else writeMemory(this.memory, address, bits, this.state.registers.read("rax", bits));
        return advance;
      }
      case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf: return this.#string(cursor);
      case 0xa8: case 0xa9: {
        const bits = op === 0xa8 ? 8 : width;
        return this.#planned(cursor, { kind: "alu", operation: "test", destination: cursor.register(0, bits), source: cursor.immediate(bits) });
      }
      case 0xc0: case 0xc1: case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
        const bits = (op & 1) === 0 ? 8 : width;
        const decoded = cursor.decodeModRM(bits);
        const count = op < 0xd0 ? cursor.readByte() : op < 0xd2 ? 1 : Number(this.state.registers.read("rcx", 8));
        this.#lock(cursor, null, false);
        const operation = shifts[decoded.extension];
        if (operation === undefined) throw new X64ProcessorFault(6, "Invalid shift group");
        cursor.writable(decoded.rm);
        cursor.write(decoded.rm, shift(operation, bits, cursor.read(decoded.rm), count, this.state.flags));
        return advance;
      }
      case 0xc2: case 0xc3: {
        this.#lock(cursor, null, false);
        const discard = op === 0xc2 ? cursor.readUnsigned(2) : 0n;
        return this.#planned(cursor, { kind: "return", discard });
      }
      case 0xc6: case 0xc7: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM(op === 0xc6 ? 8 : width);
        if (decoded.extension !== 0) throw new X64Unsupported(`MOV/transactional group /${decoded.extension}`);
        const value = cursor.immediate(decoded.rm.width);
        return this.#planned(cursor, { kind: "move", destination: decoded.rm, source: value });
      }
      case 0xc9: {
        this.#lock(cursor, null, false);
        this.state.registers.write("rsp", 64, this.state.registers.read("rbp", 64));
        this.state.registers.write("rbp", cursor.stackWidth, this.#pop(cursor.stackWidth));
        return advance;
      }
      case 0xcc: this.#lock(cursor, null, false); return { kind: "trap", vector: 3 };
      case 0xcd: {
        this.#lock(cursor, null, false);
        const vector = cursor.readByte();
        throw new X64Unsupported(`Software interrupt 0x${vector.toString(16)}`);
      }
      case 0xe0: case 0xe1: case 0xe2: case 0xe3: {
        this.#lock(cursor, null, false);
        const displacement = cursor.readSigned(1);
        let count = this.state.registers.read("rcx", cursor.addressBits);
        if (op !== 0xe3) { count = BigInt.asUintN(cursor.addressBits, count - 1n); this.state.registers.write("rcx", cursor.addressBits, count); }
        const taken = op === 0xe3 ? count === 0n : count !== 0n && (op === 0xe2 || this.state.flags.get("zero") === (op === 0xe1));
        return taken ? this.#branch(cursor.nextIP + displacement) : advance;
      }
      case 0xe8: case 0xe9: case 0xeb: {
        this.#lock(cursor, null, false);
        const displacement = cursor.readSigned(op === 0xeb ? 1 : 4);
        if (op !== 0xe8) return this.#planned(cursor, { kind: "branch", condition: null, displacement });
        return this.#planned(cursor, { kind: "call", target: cursor.nextIP + displacement });
      }
      case 0xf4: this.#lock(cursor, null, false); throw new X64ProcessorFault(13, "HLT is privileged in the user-mode guest");
      case 0xf5: this.#lock(cursor, null, false); this.state.flags.set("carry", !this.state.flags.get("carry")); return advance;
      case 0xf6: case 0xf7: return this.#unary(cursor);
      case 0xf8: this.#lock(cursor, null, false); this.state.flags.set("carry", false); return advance;
      case 0xf9: this.#lock(cursor, null, false); this.state.flags.set("carry", true); return advance;
      case 0xfc: this.#lock(cursor, null, false); this.state.flags.set("direction", false); return advance;
      case 0xfd: this.#lock(cursor, null, false); this.state.flags.set("direction", true); return advance;
      case 0xfe: case 0xff: return this.#group5(cursor);
      default: throw new X64Unsupported(`Unsupported x86-64 opcode 0x${op.toString(16)}`);
    }
  }

  #group5(cursor: X64DecodeCursor): Flow {
    const decoded = cursor.decodeModRM(cursor.opcode === 0xfe ? 8 : cursor.width);
    if (decoded.extension < 2) {
      this.#lock(cursor, decoded.rm, true);
      cursor.writable(decoded.rm);
      const carry = this.state.flags.get("carry");
      cursor.write(decoded.rm, alu(decoded.extension === 0 ? "add" : "sub", decoded.rm.width, cursor.read(decoded.rm), 1n, this.state.flags));
      this.state.flags.set("carry", carry);
      return advance;
    }
    this.#lock(cursor, null, false);
    if (cursor.opcode === 0xfe) throw new X64ProcessorFault(6, "Invalid byte INC/DEC group");
    if (decoded.extension === 2 || decoded.extension === 4) {
      const operand: X64Operand = { ...decoded.rm, width: 64 };
      return this.#planned(cursor, { kind: decoded.extension === 2 ? "call" : "jump", target: operand });
    }
    if (decoded.extension === 6) return this.#planned(cursor, { kind: "push", source: { ...decoded.rm, width: cursor.stackWidth }, width: cursor.stackWidth });
    throw new X64Unsupported(`Far or unsupported FF group /${decoded.extension}`);
  }

  #unary(cursor: X64DecodeCursor): Flow {
    const width = cursor.opcode === 0xf6 ? 8 : cursor.width;
    const decoded = cursor.decodeModRM(width);
    if (decoded.extension === 0) return this.#planned(cursor, { kind: "alu", operation: "test", destination: decoded.rm, source: cursor.immediate(width) });
    if (decoded.extension === 2 || decoded.extension === 3) {
      this.#lock(cursor, decoded.rm, true);
      cursor.writable(decoded.rm);
      const value = cursor.read(decoded.rm);
      cursor.write(decoded.rm, decoded.extension === 2 ? ~value : alu("sub", width, 0n, value, this.state.flags));
      return advance;
    }
    this.#lock(cursor, null, false);
    if (decoded.extension === 1) throw new X64ProcessorFault(6, "Undefined F6/F7 group /1");
    const value = cursor.read(decoded.rm);
    if (decoded.extension === 4 || decoded.extension === 5) {
      const signed = decoded.extension === 5;
      const accumulator = this.state.registers.read("rax", width);
      const full = signed ? BigInt.asIntN(width, accumulator) * BigInt.asIntN(width, value) : accumulator * value;
      const low = BigInt.asUintN(width, full);
      const high = BigInt.asUintN(width, full >> BigInt(width));
      if (width === 8) this.state.registers.write("rax", 16, full);
      else { this.state.registers.write("rax", width, low); this.state.registers.write("rdx", width, high); }
      const overflow = signed ? BigInt.asIntN(width, low) !== full : high !== 0n;
      this.state.flags.set("carry", overflow);
      this.state.flags.set("overflow", overflow);
      return advance;
    }
    const signed = decoded.extension === 7;
    const rawDividend = width === 8 ? this.state.registers.read("rax", 16) : (this.state.registers.read("rdx", width) << BigInt(width)) | this.state.registers.read("rax", width);
    const dividend = signed ? BigInt.asIntN(width * 2, rawDividend) : rawDividend;
    const divisor = signed ? BigInt.asIntN(width, value) : value;
    if (divisor === 0n) throw new X64ProcessorFault(0, "Integer divide by zero");
    const quotient = dividend / divisor;
    const remainder = dividend % divisor;
    if ((signed ? BigInt.asIntN(width, quotient) : BigInt.asUintN(width, quotient)) !== quotient) throw new X64ProcessorFault(0, "Integer quotient overflow");
    if (width === 8) {
      this.state.registers.write("rax", 8, quotient);
      this.state.registers.write("rax", 8, remainder, true);
    } else { this.state.registers.write("rax", width, quotient); this.state.registers.write("rdx", width, remainder); }
    return advance;
  }

  #string(cursor: X64DecodeCursor): Flow {
    this.#lock(cursor, null, false);
    const op = cursor.opcode;
    const width = (op & 1) === 0 ? 8 : cursor.width;
    const repeated = cursor.repeat !== "none";
    let count = this.state.registers.read("rcx", cursor.addressBits);
    if (repeated && count === 0n) return advance;
    const sourceOffset = this.state.registers.read("rsi", cursor.addressBits);
    const destinationOffset = this.state.registers.read("rdi", cursor.addressBits);
    const delta = BigInt(width / 8) * (this.state.flags.get("direction") ? -1n : 1n);
    const readsSource = op === 0xa4 || op === 0xa5 || op === 0xa6 || op === 0xa7 || op === 0xac || op === 0xad;
    const usesDestination = op !== 0xac && op !== 0xad;
    let source = 0n;
    if (readsSource) {
      const base = cursor.segment === null ? 0n : this.state.segments[cursor.segment].base;
      source = readMemory(this.memory, guestAddress(this.memory, sourceOffset + base), width);
    }
    if (op === 0xa4 || op === 0xa5) writeMemory(this.memory, guestAddress(this.memory, destinationOffset, "write"), width, source);
    else if (op === 0xa6 || op === 0xa7) alu("cmp", width, source, readMemory(this.memory, guestAddress(this.memory, destinationOffset), width), this.state.flags);
    else if (op === 0xaa || op === 0xab) writeMemory(this.memory, guestAddress(this.memory, destinationOffset, "write"), width, this.state.registers.read("rax", width));
    else if (op === 0xac || op === 0xad) this.state.registers.write("rax", width, source);
    else alu("cmp", width, this.state.registers.read("rax", width), readMemory(this.memory, guestAddress(this.memory, destinationOffset), width), this.state.flags);
    if (readsSource) this.state.registers.write("rsi", cursor.addressBits, sourceOffset + delta);
    if (usesDestination) this.state.registers.write("rdi", cursor.addressBits, destinationOffset + delta);
    if (!repeated) return advance;
    count = BigInt.asUintN(cursor.addressBits, count - 1n);
    this.state.registers.write("rcx", cursor.addressBits, count);
    const compares = op === 0xa6 || op === 0xa7 || op === 0xae || op === 0xaf;
    const keepRepeating = count !== 0n && (!compares || this.state.flags.get("zero") === (cursor.repeat === "f3"));
    // Each repeated element consumes one budget unit and is restartable at its original RIP.
    return keepRepeating ? { kind: "branch", target: cursor.start } : advance;
  }

  #extended(cursor: X64DecodeCursor): Flow {
    const op = cursor.readByte();
    if (op >= 0x80 && op <= 0x8f) {
      this.#lock(cursor, null, false);
      const displacement = cursor.readSigned(4);
      return this.#planned(cursor, { kind: "branch", condition: op & 15, displacement });
    }
    if (op >= 0x40 && op <= 0x4f) {
      this.#lock(cursor, null, false);
      const decoded = cursor.decodeModRM(cursor.width);
      const source = cursor.read(decoded.rm);
      if (condition(op & 15, this.state.flags)) cursor.write(decoded.reg, source);
      else if (cursor.width === 32) cursor.write(decoded.reg, cursor.read(decoded.reg));
      return advance;
    }
    if (op >= 0x90 && op <= 0x9f) {
      this.#lock(cursor, null, false);
      const decoded = cursor.decodeModRM(8);
      cursor.write(decoded.rm, condition(op & 15, this.state.flags) ? 1n : 0n);
      return advance;
    }
    if (op >= 0xc8 && op <= 0xcf) {
      this.#lock(cursor, null, false);
      const width = cursor.width === 64 ? 64 : 32;
      const register = cursor.register(op - 0xc8 + cursor.rexB, width);
      let value = cursor.read(register), result = 0n;
      for (let byte = 0; byte < width / 8; byte += 1) { result = (result << 8n) | (value & 255n); value >>= 8n; }
      cursor.write(register, result);
      return advance;
    }
    switch (op) {
      case 0x0b: throw new X64ProcessorFault(6, "UD2 invalid opcode");
      case 0xa2: {
        this.#lock(cursor, null, false);
        // Virtual CPU feature enumeration, independent of the machine running Bun.
        // CPUID register/feature encoding: Intel SDM Vol. 2A; Microsoft __cpuid docs.
        const leaf = this.state.registers.read("rax", 32);
        let eax = 0n, ebx = 0n, ecx = 0n, edx = 0n;
        if (leaf === 0n) {
          eax = 7n;
          // EBX, EDX, ECX spell "QuakeTSguest".
          ebx = 0x6b617551n; edx = 0x67535465n; ecx = 0x74736575n;
        } else if (leaf === 1n) {
          eax = 0x600n; ebx = 0x10000n;
          // x87, CMPXCHG8B, CMOV, SSE, SSE2. No AVX, XSAVE, RDRAND or TSC.
          edx = 0x06008101n;
        } else if (leaf === 0x80000000n) eax = 0x80000001n;
        else if (leaf === 0x80000001n) { ecx = 1n; edx = 0x20000000n; }
        this.state.registers.write("rax", 32, eax); this.state.registers.write("rbx", 32, ebx);
        this.state.registers.write("rcx", 32, ecx); this.state.registers.write("rdx", 32, edx);
        return advance;
      }
      case 0x1e: {
        this.#lock(cursor, null, false);
        const byte = cursor.readByte();
        if (cursor.repeat !== "f3" || byte !== 0xfa) throw new X64Unsupported("Unsupported 0F 1E encoding");
        return advance;
      }
      case 0x1f: this.#lock(cursor, null, false); cursor.decodeModRM(cursor.width); return advance;
      case 0xaf: {
        this.#lock(cursor, null, false);
        const decoded = cursor.decodeModRM(cursor.width);
        cursor.write(decoded.reg, signedMultiply(cursor.width, cursor.read(decoded.reg), cursor.read(decoded.rm), this.state.flags));
        return advance;
      }
      case 0xb6: case 0xb7: case 0xbe: case 0xbf: {
        this.#lock(cursor, null, false);
        const sourceWidth = (op & 1) === 0 ? 8 : 16;
        const decoded = cursor.decodeModRM(sourceWidth);
        const source = cursor.read(decoded.rm);
        cursor.write(cursor.register(decoded.registerIndex, cursor.width), op >= 0xbe ? BigInt.asIntN(sourceWidth, source) : source);
        return advance;
      }
      case 0xb0: case 0xb1: {
        const decoded = cursor.decodeModRM(op === 0xb0 ? 8 : cursor.width);
        this.#lock(cursor, decoded.rm, true);
        cursor.writable(decoded.rm);
        const destination = cursor.read(decoded.rm);
        const accumulator = this.state.registers.read("rax", decoded.rm.width);
        alu("cmp", decoded.rm.width, accumulator, destination, this.state.flags);
        if (accumulator === destination) cursor.write(decoded.rm, cursor.read(decoded.reg));
        else { cursor.write(decoded.rm, destination); this.state.registers.write("rax", decoded.rm.width, destination); }
        return advance;
      }
      case 0xc0: case 0xc1: {
        const decoded = cursor.decodeModRM(op === 0xc0 ? 8 : cursor.width);
        this.#lock(cursor, decoded.rm, true);
        cursor.writable(decoded.rm);
        const destination = cursor.read(decoded.rm);
        const sum = alu("add", decoded.rm.width, destination, cursor.read(decoded.reg), this.state.flags);
        const address = decoded.rm.kind === "memory" ? cursor.address(decoded.rm, "write") : null;
        cursor.write(decoded.reg, destination);
        if (address === null) cursor.write(decoded.rm, sum);
        else writeMemory(this.memory, address, decoded.rm.width, sum);
        return advance;
      }
      case 0xbc: case 0xbd: {
        this.#lock(cursor, null, false);
        if (cursor.repeat === "f3") throw new X64Unsupported("TZCNT/LZCNT require an explicit CPU feature profile");
        const decoded = cursor.decodeModRM(cursor.width);
        let value = cursor.read(decoded.rm);
        this.state.flags.set("zero", value === 0n);
        if (value !== 0n) {
          let index = 0;
          if (op === 0xbc) { while ((value & 1n) === 0n) { value >>= 1n; index += 1; } }
          else { while (value > 1n) { value >>= 1n; index += 1; } }
          cursor.write(decoded.reg, BigInt(index));
        }
        return advance;
      }
      case 0xa3: case 0xab: case 0xb3: case 0xbb: case 0xba: return this.#bit(cursor, op);
      case 0xa4: case 0xa5: case 0xac: case 0xad: return this.#doubleShift(cursor, op);
      default:
        if ((op >= 0x10 && op <= 0x17) || (op >= 0x28 && op <= 0x2f) || (op >= 0x50 && op <= 0x7f) || op === 0xae || op === 0xc2 || (op >= 0xc4 && op <= 0xc6) || op >= 0xd0) {
          this.#numeric(cursor, op);
          return advance;
        }
        throw new X64Unsupported(`Unsupported x86-64 0F opcode 0x${op.toString(16)}`);
    }
  }

  #bit(cursor: X64DecodeCursor, opcode: number): Flow {
    const decoded = cursor.decodeModRM(cursor.width);
    const operation = opcode === 0xba ? decoded.extension : opcode === 0xa3 ? 4 : opcode === 0xab ? 5 : opcode === 0xb3 ? 6 : 7;
    if (operation < 4 || operation > 7) throw new X64ProcessorFault(6, "Invalid bit-test group");
    const rawIndex = opcode === 0xba ? BigInt(cursor.readByte()) : BigInt.asIntN(cursor.width, cursor.read(decoded.reg));
    let operand = decoded.rm;
    const bit = Number(BigInt.asUintN(cursor.width === 64 ? 6 : cursor.width === 32 ? 5 : 4, rawIndex));
    if (operand.kind === "memory" && opcode !== 0xba) {
      const index = rawIndex >> BigInt(cursor.width === 64 ? 6 : cursor.width === 32 ? 5 : 4);
      operand = { ...operand, displacement: operand.displacement + index * BigInt(cursor.width / 8) };
    }
    this.#lock(cursor, operand, operation !== 4);
    if (operation !== 4) cursor.writable(operand);
    const value = cursor.read(operand), mask = 1n << BigInt(bit);
    this.state.flags.set("carry", (value & mask) !== 0n);
    if (operation !== 4) cursor.write(operand, operation === 5 ? value | mask : operation === 6 ? value & ~mask : value ^ mask);
    return advance;
  }

  #doubleShift(cursor: X64DecodeCursor, opcode: number): Flow {
    this.#lock(cursor, null, false);
    const decoded = cursor.decodeModRM(cursor.width);
    const count = ((opcode & 1) === 0 ? cursor.readByte() : Number(this.state.registers.read("rcx", 8))) & (cursor.width === 64 ? 63 : 31);
    if (count === 0) { cursor.read(decoded.rm); return advance; }
    if (count > cursor.width) throw new X64Unsupported("Undefined SHLD/SHRD count exceeds operand width");
    cursor.writable(decoded.rm);
    const destination = cursor.read(decoded.rm), source = cursor.read(decoded.reg);
    const right = opcode >= 0xac;
    const result = right ? (destination >> BigInt(count)) | (source << BigInt(cursor.width - count)) : (destination << BigInt(count)) | (source >> BigInt(cursor.width - count));
    const carry = right ? ((destination >> BigInt(count - 1)) & 1n) !== 0n : ((destination >> BigInt(cursor.width - count)) & 1n) !== 0n;
    resultFlags(cursor.width, result, this.state.flags);
    this.state.flags.set("carry", carry);
    if (count === 1) this.state.flags.set("overflow", ((destination ^ result) & (1n << BigInt(cursor.width - 1))) !== 0n);
    cursor.write(decoded.rm, result);
    return advance;
  }

  #numeric(cursor: X64DecodeCursor, secondaryOpcode: number | null): undefined {
    this.#lock(cursor, null, false);
    const decoded = cursor.opcode === 0x9b ? null : cursor.decodeModRM(cursor.width);
    if (secondaryOpcode !== null && decoded !== null) {
      const operation = prepareRawSse(secondaryOpcode, cursor.numericPrefix, decoded.registerIndex);
      if (operation !== null) {
        this.#planned(cursor, { kind: "raw-sse", operation, operand: decoded.rm.kind === "memory" ? decoded.rm : { kind: "register", index: decoded.rmIndex } });
        return undefined;
      }
    }
    const immediate = secondaryOpcode === 0x70 || secondaryOpcode === 0x71 || secondaryOpcode === 0x72 || secondaryOpcode === 0x73 || secondaryOpcode === 0xc2 || secondaryOpcode === 0xc4 || secondaryOpcode === 0xc5 || secondaryOpcode === 0xc6 ? cursor.readByte() : null;
    const instruction: Omit<NumericInstruction, "operand"> = {
      opcode: cursor.opcode, secondaryOpcode, modrm: decoded?.byte ?? null,
      registerIndex: decoded?.registerIndex ?? 0, prefix: cursor.numericPrefix, operandBits: cursor.width, immediate,
    };
    this.#planned(cursor, decoded?.rm.kind === "memory" ? { kind: "numeric-memory", instruction, operand: decoded.rm }
      : { kind: "numeric", instruction: { ...instruction, operand: decoded === null ? null : { kind: "register", index: decoded.rmIndex } } });
    return undefined;
  }
}
