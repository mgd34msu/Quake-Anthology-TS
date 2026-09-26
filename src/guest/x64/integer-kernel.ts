// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from '../../contracts/execution.ts';
import type { GuestIntegerWidth, GuestProcessorState, GuestRegister, MappedGuestMemory } from '../core/contracts.ts';
import { SparseGuestMemory } from '../core/memory.ts';
import { IntegerRegisterFile, managedGuestProcessor, ProcessorFlags } from '../core/registers.ts';
import type { AluOperation } from '../x86/arithmetic.ts';
import { canonicalAddress, guestAddress, operandAddress } from './decoder.ts';
import type { X64MemoryOperand, X64Operand } from './decoder.ts';
import { executeX64Plan, x64Advance, x64Lock } from './plan.ts';
import type { X64Flow, X64PlanOperation, X64SemanticPlan } from './plan.ts';

const registerMembers = Object.getOwnPropertyNames(IntegerRegisterFile.prototype);
const flagMembers = Object.getOwnPropertyNames(ProcessorFlags.prototype);
const memoryMembers = Object.getOwnPropertyNames(SparseGuestMemory.prototype);
function originalInstance(value: object, prototype: object, members: readonly string[]): boolean {
  const actual: unknown = Object.getPrototypeOf(value);
  return actual === prototype && members.every(member => !Object.hasOwn(value, member));
}

const offsets: Readonly<Record<GuestRegister, number>> = {
  rax: 0, rcx: 8, rdx: 16, rbx: 24, rsp: 32, rbp: 40, rsi: 48, rdi: 56,
  r8: 64, r9: 72, r10: 80, r11: 88, r12: 96, r13: 104, r14: 112, r15: 120,
};
interface RegisterOperand { readonly kind: 'register'; readonly offset: number; readonly width: GuestIntegerWidth; readonly highByte: boolean; }
interface MemoryOperand { readonly kind: 'memory'; readonly source: X64MemoryOperand; readonly width: GuestIntegerWidth; }
type Operand = RegisterOperand | MemoryOperand;
interface Immediate { readonly kind: 'immediate'; readonly low: number; readonly high: number; }
type Source = Operand | Immediate;
interface ConstantTarget { readonly kind: 'constant'; readonly value: bigint; readonly canonical: boolean; }
type ControlTarget = Operand | ConstantTarget;
interface EffectiveAddress {
  readonly base: number | null;
  readonly index: number | null;
  readonly shift: 0 | 1 | 2 | 3;
  readonly low: number;
  readonly high: number;
  readonly addressBits: 32 | 64;
}
type Operation =
  | { readonly kind: 'nop' }
  | { readonly kind: 'move'; readonly destination: Operand; readonly source: Source }
  | { readonly kind: 'extend'; readonly destination: RegisterOperand; readonly source: Operand; readonly signed: boolean }
  | { readonly kind: 'increment'; readonly destination: Operand; readonly subtract: boolean }
  | { readonly kind: 'lea'; readonly destination: RegisterOperand; readonly source: EffectiveAddress }
  | { readonly kind: 'alu'; readonly operation: AluOperation; readonly destination: Operand; readonly source: Source }
  | { readonly kind: 'branch'; readonly condition: number | null; readonly target: ConstantTarget }
  | { readonly kind: 'jump' | 'call'; readonly target: ControlTarget }
  | { readonly kind: 'push'; readonly source: Source; readonly width: 16 | 64 }
  | { readonly kind: 'pop'; readonly destination: Operand; readonly width: 16 | 64 }
  | Extract<X64PlanOperation, { kind: 'raw-sse' }>
  | { readonly kind: 'return'; readonly discard: bigint };
export interface X64IntegerPlan { readonly operation: Operation; readonly original: X64SemanticPlan; }
export interface X64IntegerStep { readonly start: bigint; readonly integer: X64IntegerPlan; }
export type X64IntegerBlockResult =
  | { readonly kind: 'complete' | 'return'; readonly instructions: number }
  | { readonly kind: 'fault'; readonly instructions: number; readonly error: unknown };
/** These instructions finish every possible faulting read/check before touching architectural state. */
export function x64IntegerBlockSafe(plan: X64IntegerPlan): boolean {
  const operation = plan.operation;
  switch (operation.kind) {
    case 'nop': case 'extend': return true;
    case 'increment': return operation.destination.kind === 'register';
    case 'raw-sse': return operation.operation.kind !== 'move' || !operation.operation.store || operation.operand.kind !== 'memory';
    case 'move': return operation.destination.kind === 'register';
    case 'lea': case 'branch': case 'return': return true;
    case 'jump': return true;
    case 'call': case 'push': return false;
    case 'pop': return operation.destination.kind === 'register';
    case 'alu': return operation.destination.kind === 'register' || operation.operation === 'cmp' || operation.operation === 'test';
  }
}

function operand(value: X64Operand): Operand {
  return value.kind === 'register'
    ? { kind: 'register', offset: offsets[value.register], width: value.width, highByte: value.highByte }
    : { kind: 'memory', source: value, width: value.width };
}
function source(value: X64Operand | bigint): Source {
  if (typeof value !== 'bigint') return operand(value);
  const word = BigInt.asUintN(64, value);
  return { kind: 'immediate', low: Number(word & 0xffffffffn), high: Number(word >> 32n) };
}
function constantTarget(value: bigint): ConstantTarget {
  const raw = BigInt.asUintN(64, value);
  return { kind: 'constant', value: raw, canonical: raw <= 0x7fffffffffffn || raw >= 0xffff800000000000n };
}

/** Preparation only reduces static instruction fields; no guest data or source functions execute here. */
export function prepareX64IntegerPlan(plan: X64SemanticPlan): X64IntegerPlan | null {
  const op = plan.operation;
  switch (op.kind) {
    case 'nop': case 'raw-sse': return { original: plan, operation: op };
    case 'extend': {
      const destination = operand(op.destination);
      if (destination.kind !== 'register') return null;
      return { original: plan, operation: { kind: 'extend', destination, source: operand(op.source), signed: op.signed } };
    }
    case 'increment': return { original: plan, operation: { kind: 'increment', destination: operand(op.destination), subtract: op.subtract } };
    case 'move': return { original: plan, operation: { kind: 'move', destination: operand(op.destination), source: source(op.source) } };
    case 'alu': return { original: plan, operation: { kind: 'alu', operation: op.operation, destination: operand(op.destination), source: source(op.source) } };
    case 'branch': return { original: plan, operation: { kind: 'branch', condition: op.condition, target: constantTarget(plan.nextIP + op.displacement) } };
    case 'jump': case 'call': return { original: plan, operation: { kind: op.kind, target: typeof op.target === 'bigint' ? constantTarget(op.target) : operand(op.target) } };
    case 'push': return { original: plan, operation: { kind: 'push', source: source(op.source), width: op.width } };
    case 'pop': return { original: plan, operation: { kind: 'pop', destination: operand(op.destination), width: op.width } };
    case 'return': return { original: plan, operation: op };
    case 'lea': {
      const destination = operand(op.destination);
      if (destination.kind !== 'register') return null;
      const value = op.source, shift = value.scale === 1n ? 0 : value.scale === 2n ? 1 : value.scale === 4n ? 2 : value.scale === 8n ? 3 : null;
      if (shift === null) return null;
      const displacement = BigInt.asUintN(64, value.displacement + (value.ripRelative ? plan.nextIP : 0n));
      return { original: plan, operation: { kind: 'lea', destination, source: {
        base: value.ripRelative || value.base === null ? null : offsets[value.base],
        index: value.index === null ? null : offsets[value.index], shift,
        low: Number(displacement & 0xffffffffn), high: Number(displacement >> 32n), addressBits: value.addressBits,
      } } };
    }
    default: return null;
  }
}

/** One instance belongs to one run invocation; a committed store may re-enter the same CPU. */
export class X64IntegerKernel {
  #low = 0;
  #high = 0;
  #checkpoint: Uint8Array | undefined;
  readonly #memoryWords = { low: 0, high: 0 };
  private constructor(readonly flags: ProcessorFlags, private readonly registers: IntegerRegisterFile, private readonly words: DataView,
    private readonly state: GuestProcessorState, private readonly memory: SparseGuestMemory) {}

  static create(state: GuestProcessorState, memory: MappedGuestMemory): X64IntegerKernel | null {
    const managed = managedGuestProcessor(state);
    if (managed !== null && state.architecture === 'x86-64' && SparseGuestMemory.managed(memory)) {
      return new X64IntegerKernel(managed.flags, managed.registers, managed.registers.integerView, state, memory);
    }
    if (state.architecture !== 'x86-64' || !(state.registers instanceof IntegerRegisterFile) || state.registers.architecture !== 'x86-64'
      || !originalInstance(state.registers, IntegerRegisterFile.prototype, registerMembers)
      || !(state.flags instanceof ProcessorFlags) || !originalInstance(state.flags, ProcessorFlags.prototype, flagMembers)
      || !(memory instanceof SparseGuestMemory) || !originalInstance(memory, SparseGuestMemory.prototype, memoryMembers)) return null;
    return new X64IntegerKernel(state.flags, state.registers, state.registers.integerView, state, memory);
  }

  /** Admit code once; a store ends the block and retains its own rollback boundary. */
  executeBlock(steps: readonly X64IntegerStep[], budget: number, returned: bigint | null): X64IntegerBlockResult {
    let instructions = 0, current = this.state.instructionPointer, next = current;
    try {
      for (const step of steps) {
        if (instructions === budget) break;
        current = step.start;
        if (current === returned) {
          this.state.instructionPointer = current;
          return { kind: 'return', instructions };
        }
        const op = step.integer.operation, original = step.integer.original;
        next = original.nextIP;
        if (!x64IntegerBlockSafe(step.integer)) {
          this.state.instructionPointer = current;
          const registers = this.registers.checkpoint(this.#checkpoint);
          this.#checkpoint = registers;
          const lowFlags = this.flags.lowWord, highFlags = this.flags.highWord;
          try {
            const flow = this.execute(step.integer);
            if (flow.kind === 'branch') next = flow.target;
          } catch (error) {
            this.registers.restore(registers);
            this.flags.restoreWords(lowFlags, highFlags);
            throw error;
          }
          instructions++;
          break;
        }
        switch (op.kind) {
          case 'raw-sse': executeX64Plan(original, this.memory, this.state); break;
          case 'nop': x64Lock(original.lock, null, false); break;
          case 'extend':
            x64Lock(original.lock, null, false);
            this.#extend(op, original.nextIP);
            break;
          case 'increment': {
            x64Lock(original.lock, null, true);
            const carry = this.flags.lowWord & 1;
            this.#read(op.destination, original.nextIP);
            this.#alu(op.subtract ? 'sub' : 'add', op.destination.width, 1, 0);
            this.#write(op.destination, original.nextIP);
            this.flags.writeLowWord((this.flags.lowWord & ~1) | carry);
            break;
          }
          case 'move':
            x64Lock(original.lock, null, false);
            this.#read(op.source, original.nextIP);
            this.#write(op.destination, original.nextIP);
            break;
          case 'lea':
            x64Lock(original.lock, null, false);
            this.#address(op.source);
            this.#write(op.destination, original.nextIP);
            break;
          case 'alu': {
            this.#read(op.source, original.nextIP);
            const rightLow = this.#low, rightHigh = this.#high;
            const writes = op.operation !== 'cmp' && op.operation !== 'test';
            x64Lock(original.lock, op.destination.kind === 'memory' ? op.destination.source : null, writes);
            this.#read(op.destination, original.nextIP);
            this.#alu(op.operation, op.destination.width, rightLow, rightHigh);
            if (writes) this.#write(op.destination, original.nextIP);
            break;
          }
          case 'branch':
            x64Lock(original.lock, null, false);
            if (op.condition === null || this.#condition(op.condition)) next = this.#target(op.target, original.nextIP);
            break;
          case 'return':
            x64Lock(original.lock, null, false);
            next = this.#return(op.discard);
            break;
          case 'jump':
            x64Lock(original.lock, null, false);
            next = this.#target(op.target, original.nextIP);
            break;
          case 'pop':
            x64Lock(original.lock, null, false);
            this.#pop(op.width);
            this.#write(op.destination, original.nextIP);
            break;
          case 'push': case 'call':
            throw new Error('A memory-writing instruction cannot run in a read-only integer block');
        }
        instructions++;
      }
    } catch (error) {
      this.state.instructionPointer = current;
      return { kind: 'fault', instructions, error };
    }
    this.state.instructionPointer = next;
    return { kind: 'complete', instructions };
  }

  execute(plan: X64IntegerPlan): X64Flow {
    const op = plan.operation, original = plan.original;
    switch (op.kind) {
      case 'raw-sse': return executeX64Plan(original, this.memory, this.state);
      case 'nop': x64Lock(original.lock, null, false); return x64Advance;
      case 'extend':
        x64Lock(original.lock, null, false);
        this.#extend(op, original.nextIP);
        return x64Advance;
      case 'increment': {
        x64Lock(original.lock, op.destination.kind === 'memory' ? op.destination.source : null, true);
        const address = op.destination.kind === 'memory'
          ? operandAddress(this.memory, this.state, op.destination.source, original.nextIP, 'write') : null;
        if (address !== null) this.memory.check(address, op.destination.width / 8, 'write');
        const carry = this.flags.lowWord & 1;
        if (address !== null) this.#readMemory(address, op.destination.width);
        else this.#read(op.destination, original.nextIP);
        this.#alu(op.subtract ? 'sub' : 'add', op.destination.width, 1, 0);
        if (address !== null) this.#writeMemory(address, op.destination.width);
        else this.#write(op.destination, original.nextIP);
        this.flags.writeLowWord((this.flags.lowWord & ~1) | carry);
        return x64Advance;
      }
      case 'move':
        x64Lock(original.lock, null, false);
        this.#read(op.source, original.nextIP);
        this.#write(op.destination, original.nextIP);
        return x64Advance;
      case 'lea':
        x64Lock(original.lock, null, false);
        this.#address(op.source);
        this.#write(op.destination, original.nextIP);
        return x64Advance;
      case 'alu': {
        // Source reads precede LOCK/write admission in the original semantic handler.
        this.#read(op.source, original.nextIP);
        const rightLow = this.#low, rightHigh = this.#high;
        const writes = op.operation !== 'cmp' && op.operation !== 'test';
        x64Lock(original.lock, op.destination.kind === 'memory' ? op.destination.source : null, writes);
        const address = op.destination.kind === 'memory'
          ? operandAddress(this.memory, this.state, op.destination.source, original.nextIP, writes ? 'write' : 'read') : null;
        if (address !== null) {
          if (writes) this.memory.check(address, op.destination.width / 8, 'write');
          this.#readMemory(address, op.destination.width);
        } else this.#read(op.destination, original.nextIP);
        this.#alu(op.operation, op.destination.width, rightLow, rightHigh);
        if (writes) {
          if (address !== null) this.#writeMemory(address, op.destination.width);
          else this.#write(op.destination, original.nextIP);
        }
        return x64Advance;
      }
      case 'branch':
        x64Lock(original.lock, null, false);
        return op.condition === null || this.#condition(op.condition)
          ? { kind: 'branch', target: this.#target(op.target, original.nextIP) } : x64Advance;
      case 'return':
        x64Lock(original.lock, null, false);
        return { kind: 'branch', target: this.#return(op.discard) };
      case 'jump': case 'call': {
        x64Lock(original.lock, null, false);
        const target = this.#target(op.target, original.nextIP);
        if (op.kind === 'call') {
          const stack = BigInt.asUintN(64, this.words.getBigUint64(offsets.rsp, true) - 8n);
          this.memory.writeUint64(guestAddress(this.memory, stack, 'write'), original.nextIP);
          this.words.setBigUint64(offsets.rsp, stack, true);
        }
        return { kind: 'branch', target };
      }
      case 'push': {
        x64Lock(original.lock, null, false);
        this.#read(op.source, original.nextIP);
        const stack = BigInt.asUintN(64, this.words.getBigUint64(offsets.rsp, true) - (op.width === 64 ? 8n : 2n));
        this.#writeMemory(guestAddress(this.memory, stack, 'write'), op.width);
        this.words.setBigUint64(offsets.rsp, stack, true);
        return x64Advance;
      }
      case 'pop':
        x64Lock(original.lock, null, false);
        this.#pop(op.width);
        this.#write(op.destination, original.nextIP);
        return x64Advance;
    }
  }

  #return(discard: bigint): bigint {
    const stack = this.words.getBigUint64(offsets.rsp, true);
    const target = canonicalAddress(this.memory.readUint64(guestAddress(this.memory, stack)));
    this.words.setBigUint64(offsets.rsp, stack + 8n + discard, true);
    return target;
  }

  #target(target: ControlTarget, nextIP: bigint): bigint {
    if (target.kind === 'constant') return target.canonical ? target.value : canonicalAddress(target.value);
    if (target.width === 64) return canonicalAddress(target.kind === 'register' ? this.words.getBigUint64(target.offset, true)
      : this.memory.readUint64(operandAddress(this.memory, this.state, target.source, nextIP)));
    this.#read(target, nextIP);
    return BigInt(this.#low);
  }

  #extend(operation: Extract<Operation, { kind: 'extend' }>, nextIP: bigint): void {
    this.#read(operation.source, nextIP);
    if (operation.signed) {
      const width = operation.source.width;
      if (width === 8) this.#low = ((this.#low << 24) >> 24) >>> 0;
      else if (width === 16) this.#low = ((this.#low << 16) >> 16) >>> 0;
      if (width !== 64) this.#high = this.#low >= 0x80000000 ? 0xffffffff : 0;
    }
    this.#write(operation.destination, nextIP);
  }

  #pop(width: 16 | 64): void {
    const stack = this.words.getBigUint64(offsets.rsp, true);
    this.#readMemory(guestAddress(this.memory, stack), width);
    this.words.setBigUint64(offsets.rsp, stack + (width === 64 ? 8n : 2n), true);
  }

  #read(value: Source, nextIP: bigint): void {
    if (value.kind === 'immediate') { this.#low = value.low; this.#high = value.high; return; }
    if (value.kind === 'memory') {
      const address = operandAddress(this.memory, this.state, value.source, nextIP);
      this.#readMemory(address, value.width);
      return;
    }
    const low = this.words.getUint32(value.offset, true);
    this.#low = value.width === 8 ? (low >>> (value.highByte ? 8 : 0)) & 255 : value.width === 16 ? low & 65535 : low;
    this.#high = value.width === 64 ? this.words.getUint32(value.offset + 4, true) : 0;
  }

  #write(destination: Operand, nextIP: bigint): void {
    if (destination.kind === 'memory') {
      const address = operandAddress(this.memory, this.state, destination.source, nextIP, 'write');
      this.#writeMemory(address, destination.width);
      return;
    }
    const offset = destination.offset;
    if (destination.width === 8) this.words.setUint8(offset + (destination.highByte ? 1 : 0), this.#low);
    else if (destination.width === 16) this.words.setUint16(offset, this.#low, true);
    else { this.words.setUint32(offset, this.#low, true); this.words.setUint32(offset + 4, destination.width === 64 ? this.#high : 0, true); }
  }

  #readMemory(address: GuestAddress, width: GuestIntegerWidth): void {
    if (width === 64) {
      this.memory.readUint64Words(address, this.#memoryWords);
      this.#low = this.#memoryWords.low; this.#high = this.#memoryWords.high;
    } else {
      this.#low = width === 8 ? this.memory.readUint8(address)
        : width === 16 ? this.memory.readUint16(address) : this.memory.readUint32(address);
      this.#high = 0;
    }
  }

  #writeMemory(address: GuestAddress, width: GuestIntegerWidth): void {
    if (width === 64) this.memory.writeUint64Words(address, this.#low, this.#high);
    else if (width === 32) this.memory.writeUint32(address, this.#low);
    else if (width === 16) this.memory.writeUint16(address, this.#low);
    else this.memory.writeUint8(address, this.#low);
  }

  #address(value: EffectiveAddress): void {
    const a = value.base === null ? 0 : this.words.getUint32(value.base, true);
    const ah = value.base === null || value.addressBits === 32 ? 0 : this.words.getUint32(value.base + 4, true);
    const b = value.index === null ? 0 : this.words.getUint32(value.index, true);
    const bh = value.index === null || value.addressBits === 32 ? 0 : this.words.getUint32(value.index + 4, true);
    const lowIndex = value.shift === 0 ? b : (b << value.shift) >>> 0;
    const highIndex = value.shift === 0 ? bh : ((bh << value.shift) | (b >>> (32 - value.shift))) >>> 0;
    const low = a + lowIndex + value.low;
    this.#low = low >>> 0;
    this.#high = value.addressBits === 32 ? 0 : (ah + highIndex + value.high + Math.floor(low / 0x100000000)) >>> 0;
  }

  #alu(operation: AluOperation, width: GuestIntegerWidth, rightLow: number, rightHigh: number): void {
    const limit = width === 8 ? 256 : width === 16 ? 65536 : 0x100000000;
    const a = this.#low, b = width === 8 ? rightLow & 255 : width === 16 ? rightLow & 65535 : rightLow;
    const ah = this.#high, bh = rightHigh;
    const sign = width === 8 ? 0x80 : width === 16 ? 0x8000 : 0x80000000;
    let low: number, high = 0, bits = 0, mask = 0x8d5;
    switch (operation) {
      case 'add': case 'adc': {
        const incoming = operation === 'adc' ? this.flags.lowWord & 1 : 0;
        const sum = a + b + incoming;
        low = width === 64 || width === 32 ? sum >>> 0 : sum & (limit - 1);
        if (width === 64) {
          const upper = ah + bh + (sum >= limit ? 1 : 0); high = upper >>> 0;
          if (upper >= limit) bits |= 1;
          if ((~(ah ^ bh) & (ah ^ high) & sign) !== 0) bits |= 0x800;
        } else {
          if (sum >= limit) bits |= 1;
          if ((~(a ^ b) & (a ^ low) & sign) !== 0) bits |= 0x800;
        }
        if ((a & 15) + (b & 15) + incoming > 15) bits |= 0x10;
        break;
      }
      case 'sub': case 'cmp': case 'sbb': {
        const incoming = operation === 'sbb' ? this.flags.lowWord & 1 : 0;
        const difference = a - b - incoming;
        low = width === 64 || width === 32 ? difference >>> 0 : difference & (limit - 1);
        if (width === 64) {
          const upper = ah - bh - (difference < 0 ? 1 : 0); high = upper >>> 0;
          if (upper < 0) bits |= 1;
          if (((ah ^ bh) & (ah ^ high) & sign) !== 0) bits |= 0x800;
        } else {
          if (difference < 0) bits |= 1;
          if (((a ^ b) & (a ^ low) & sign) !== 0) bits |= 0x800;
        }
        if ((a & 15) < (b & 15) + incoming) bits |= 0x10;
        break;
      }
      case 'and': case 'test': low = (a & b) >>> 0; high = (ah & bh) >>> 0; mask = 0x8c5; break;
      case 'or': low = (a | b) >>> 0; high = (ah | bh) >>> 0; mask = 0x8c5; break;
      case 'xor': low = (a ^ b) >>> 0; high = (ah ^ bh) >>> 0; mask = 0x8c5; break;
    }
    if (width !== 64) high = 0;
    let byte = low & 255; byte ^= byte >>> 4;
    bits |= (low === 0 && high === 0 ? 0x40 : 0) | (((width === 64 ? high : low) & sign) !== 0 ? 0x80 : 0) | (((0x9669 >>> (byte & 15)) & 1) << 2);
    this.flags.writeLowWord((this.flags.lowWord & ~mask) | bits);
    this.#low = low; this.#high = high;
  }

  #condition(code: number): boolean {
    const bits = this.flags.lowWord, carry = (bits & 1) !== 0, zero = (bits & 0x40) !== 0;
    const sign = (bits & 0x80) !== 0, overflow = (bits & 0x800) !== 0;
    switch (code) {
      case 0: return overflow; case 1: return !overflow;
      case 2: return carry; case 3: return !carry;
      case 4: return zero; case 5: return !zero;
      case 6: return carry || zero; case 7: return !carry && !zero;
      case 8: return sign; case 9: return !sign;
      case 10: return (bits & 4) !== 0; case 11: return (bits & 4) === 0;
      case 12: return sign !== overflow; case 13: return sign === overflow;
      case 14: return zero || sign !== overflow; case 15: return !zero && sign === overflow;
      default: throw new RangeError(`Invalid condition code ${code}`);
    }
  }
}
