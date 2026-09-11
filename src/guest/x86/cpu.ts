// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress } from "../../contracts/execution.ts";
import type { GuestCpu, GuestExecutionStop, GuestProcessorState, MappedGuestMemory } from "../core/contracts.ts";
import { GuestMemoryFault } from "../core/memory.ts";
import type { NumericExecutionContext, NumericExecutionResult, NumericOperand } from "../floating-point/contracts.ts";
import { executeNumericInstruction } from "../floating-point/index.ts";
import { alu, condition, resultFlags, shift, signedMultiply } from "./arithmetic.ts";
import type { AluOperation, ShiftOperation } from "./arithmetic.ts";
import { guestAddress, registerOperand, UnsupportedX86Instruction, X86Decoder, X86ProcessorFault } from "./decoder.ts";
import type { SegmentName, X86Operand, X86Width } from "./decoder.ts";

export interface I386CpuOptions {
  readonly state: GuestProcessorState;
  readonly memory: MappedGuestMemory;
  readonly hostCall?: (address: GuestAddress) => boolean;
  readonly numeric?: (context: NumericExecutionContext) => NumericExecutionResult;
}

function arithmeticOperation(index: number): AluOperation {
  switch (index) {
    case 0: return "add"; case 1: return "or"; case 2: return "adc"; case 3: return "sbb";
    case 4: return "and"; case 5: return "sub"; case 6: return "xor"; case 7: return "cmp";
    default: throw new RangeError(`Invalid ALU encoding ${index}`);
  }
}
function shiftOperation(index: number): ShiftOperation {
  switch (index) {
    case 0: return "rol"; case 1: return "ror"; case 2: return "rcl"; case 3: return "rcr";
    case 4: case 6: return "shl"; case 5: return "shr"; case 7: return "sar";
    default: throw new RangeError(`Invalid shift encoding ${index}`);
  }
}

/** User-mode i386 interpreter. All architectural values live in the supplied core state. */
export class I386Cpu implements GuestCpu {
  readonly state: GuestProcessorState;
  readonly memory: MappedGuestMemory;
  readonly #hostCall: (address: GuestAddress) => boolean;
  readonly #numeric: (context: NumericExecutionContext) => NumericExecutionResult;
  constructor(options: I386CpuOptions) {
    if (options.state.architecture !== "i386" || options.memory.pointerBytes !== 4) throw new RangeError("I386Cpu requires i386 state and a 32-bit guest address space");
    this.state = options.state;
    this.memory = options.memory;
    this.#hostCall = options.hostCall ?? (() => false);
    this.#numeric = options.numeric ?? executeNumericInstruction;
  }

  /** Each REP iteration consumes one budget unit and leaves restartable IP/count/index state. */
  run(options: { readonly instructionBudget: number; readonly returnAddress: GuestAddress | null }): GuestExecutionStop {
    if (!Number.isSafeInteger(options.instructionBudget) || options.instructionBudget < 0) throw new RangeError("Instruction budget must be a nonnegative safe integer");
    if (options.returnAddress !== null && options.returnAddress.addressSpace !== this.memory.addressSpace) throw new RangeError("Return address belongs to another guest address space");
    let instructions = 0;
    while (instructions < options.instructionBudget) {
      let decoder: X86Decoder | undefined;
      const originalIP = this.state.instructionPointer, registers = this.state.registers.checkpoint(), flags = this.state.flags.value;
      try {
        const address = guestAddress(this.memory, BigInt.asUintN(32, this.state.segments.cs.base + originalIP), "execute");
        if (options.returnAddress !== null && address.byteOffset === options.returnAddress.byteOffset) return { kind: "return", instructions, address };
        if (this.#hostCall(address)) return { kind: "host-call", instructions, address };
        decoder = new X86Decoder(this.state, this.memory);
        const halt = this.#execute(decoder);
        this.state.instructionPointer = decoder.cursor;
        instructions++;
        if (halt) return { kind: "halt", instructions, address };
      } catch (error) {
        this.state.registers.restore(registers);
        this.state.flags.value = flags;
        this.state.instructionPointer = originalIP;
        const instructionAddress: GuestAddress = { kind: "guest-address", addressSpace: this.memory.addressSpace,
          byteOffset: BigInt.asUintN(32, this.state.segments.cs.base + originalIP) };
        if (error instanceof GuestMemoryFault) return { kind: "exception", instructions, exception: { kind: "memory",
          access: error.access === "execute" || error.access === "write" ? error.access : "read",
          address: { kind: "guest-address", addressSpace: this.memory.addressSpace, byteOffset: error.address }, byteLength: error.byteLength, detail: error.message } };
        if (error instanceof X86ProcessorFault) {
          if ((error.vector === 3 || error.vector === 4) && decoder !== undefined) { this.state.instructionPointer = decoder.cursor; instructions++; }
          return { kind: "exception", instructions, exception: { kind: "processor",
            vector: error.vector, errorCode: error.errorCode, instruction: instructionAddress, detail: error.message } };
        }
        if (error instanceof UnsupportedX86Instruction) return { kind: "unsupported", instructions,
          instruction: { address: instructionAddress, bytes: new Uint8Array(decoder?.bytes ?? []), mnemonic: "unsupported" }, detail: error.message };
        throw error;
      }
    }
    return { kind: "budget", instructions };
  }

  #stackOperand(offset: bigint): X86Operand { return { kind: "memory", offset: BigInt.asUintN(32, offset), segment: "ss", stackPointerBase: true }; }
  #push(d: X86Decoder, width: 16 | 32, value: bigint): undefined {
    const pointer = BigInt.asUintN(32, this.state.registers.read("rsp", 32) - BigInt(width / 8));
    d.write(this.#stackOperand(pointer), width, value);
    return this.state.registers.write("rsp", 32, pointer);
  }
  #pop(d: X86Decoder, width: 16 | 32): bigint {
    const pointer = this.state.registers.read("rsp", 32), value = d.read(this.#stackOperand(pointer), width);
    this.state.registers.write("rsp", 32, pointer + BigInt(width / 8));
    return value;
  }
  #lock(d: X86Decoder, operand: X86Operand, allowed: boolean): undefined {
    if (d.lock && (!allowed || operand.kind !== "memory")) throw new X86ProcessorFault(6, "LOCK requires a supported read-modify-write memory destination");
    return undefined;
  }
  #alu(d: X86Decoder, operation: AluOperation, width: X86Width, destination: X86Operand, right: bigint): undefined {
    const write = operation !== "cmp" && operation !== "test";
    this.#lock(d, destination, write);
    const left = d.read(destination, width);
    if (write) d.checkWrite(destination, width);
    const value = alu(operation, width, left, right, this.state.flags);
    if (write) d.write(destination, width, value);
    return undefined;
  }
  #incdec(d: X86Decoder, operand: X86Operand, width: X86Width, decrement: boolean): undefined {
    const carry = this.state.flags.get("carry");
    this.#alu(d, decrement ? "sub" : "add", width, operand, 1n);
    this.state.flags.set("carry", carry);
    return undefined;
  }

  #execute(d: X86Decoder): boolean {
    const op = d.opcode, width = d.operandBits;
    if (d.lock && !(op <= 0x3b && (op & 7) <= 3) && ![0x80, 0x81, 0x82, 0x83, 0x86, 0x87, 0xf6, 0xf7, 0xfe, 0xff, 0x0f].includes(op)) {
      throw new X86ProcessorFault(6, `LOCK is invalid for opcode 0x${op.toString(16)}`);
    }
    if (op <= 0x3d && (op & 7) <= 5) {
      const operation = arithmeticOperation(op >> 3), form = op & 7, bits = (form & 1) === 0 ? 8 : width;
      if (form <= 3) {
        const decoded = d.modrm(bits), destination = form < 2 ? decoded.operand : decoded.register;
        this.#alu(d, operation, bits, destination, d.read(form < 2 ? decoded.register : decoded.operand, bits));
      } else this.#alu(d, operation, bits, registerOperand(0, bits), d.immediate(bits));
      return false;
    }
    if (op >= 0x40 && op <= 0x4f) { this.#incdec(d, registerOperand(op & 7, width), width, op >= 0x48); return false; }
    if (op >= 0x50 && op <= 0x57) { this.#push(d, width, d.read(registerOperand(op & 7, width), width)); return false; }
    if (op >= 0x58 && op <= 0x5f) { d.write(registerOperand(op & 7, width), width, this.#pop(d, width)); return false; }
    if (op >= 0x70 && op <= 0x7f) { const relative = d.signed(8); if (condition(op & 15, this.state.flags)) d.cursor = BigInt.asUintN(width, d.cursor + relative); return false; }
    if (op >= 0x91 && op <= 0x97) {
      const operand = registerOperand(op & 7, width), accumulator = registerOperand(0, width), left = d.read(accumulator, width);
      d.write(accumulator, width, d.read(operand, width)); d.write(operand, width, left); return false;
    }
    if (op >= 0xb0 && op <= 0xbf) { const bits = op < 0xb8 ? 8 : width; d.write(registerOperand(op & 7, bits), bits, d.immediate(bits)); return false; }
    if (op >= 0xd8 && op <= 0xdf) { this.#floating(d, null); return false; }
    switch (op) {
      case 0x0f: this.#extended(d); return false;
      case 0x06: this.#push(d, width, BigInt(this.state.segments.es.selector)); return false;
      case 0x0e: this.#push(d, width, BigInt(this.state.segments.cs.selector)); return false;
      case 0x16: this.#push(d, width, BigInt(this.state.segments.ss.selector)); return false;
      case 0x1e: this.#push(d, width, BigInt(this.state.segments.ds.selector)); return false;
      case 0x07: this.#popSegment(d, "es"); return false;
      case 0x17: this.#popSegment(d, "ss"); return false;
      case 0x1f: this.#popSegment(d, "ds"); return false;
      case 0x60: {
        const initialSP = this.state.registers.read("rsp", width), stack = this.state.registers.read("rsp", 32);
        const target = this.#stackOperand(stack - BigInt(width));
        if (target.kind !== "memory") throw new Error("Expected stack operand");
        this.memory.check(d.address(target, width, "write"), width, "write");
        for (let index = 0; index < 8; index++) this.#push(d, width, index === 4 ? initialSP : d.read(registerOperand(index, width), width));
        return false;
      }
      case 0x61:
        for (let index = 7; index >= 0; index--) { const value = this.#pop(d, width); if (index !== 4) d.write(registerOperand(index, width), width, value); }
        return false;
      case 0x68: this.#push(d, width, d.immediate(width)); return false;
      case 0x6a: this.#push(d, width, d.signed(8)); return false;
      case 0x69: case 0x6b: {
        const decoded = d.modrm(width), immediate = op === 0x6b ? d.signed(8) : d.signed(width);
        d.write(decoded.register, width, signedMultiply(width, d.read(decoded.operand, width), immediate, this.state.flags)); return false;
      }
      case 0x80: case 0x81: case 0x82: case 0x83: {
        const bits = op === 0x80 || op === 0x82 ? 8 : width, decoded = d.modrm(bits);
        this.#alu(d, arithmeticOperation(decoded.group), bits, decoded.operand, op === 0x83 ? d.signed(8) : d.immediate(bits)); return false;
      }
      case 0x84: case 0x85: {
        const bits = op === 0x84 ? 8 : width, decoded = d.modrm(bits);
        this.#alu(d, "test", bits, decoded.operand, d.read(decoded.register, bits)); return false;
      }
      case 0x86: case 0x87: {
        const bits = op === 0x86 ? 8 : width, decoded = d.modrm(bits), old = d.read(decoded.operand, bits), replacement = d.read(decoded.register, bits);
        this.#lock(d, decoded.operand, true); d.write(decoded.operand, bits, replacement); d.write(decoded.register, bits, old); return false;
      }
      case 0x88: case 0x89: case 0x8a: case 0x8b: {
        const bits = (op & 1) === 0 ? 8 : width, decoded = d.modrm(bits);
        d.write(op < 0x8a ? decoded.operand : decoded.register, bits, d.read(op < 0x8a ? decoded.register : decoded.operand, bits)); return false;
      }
      case 0x8c: case 0x8e: {
        const decoded = d.modrm(16), segment = this.#segment(decoded.group);
        if (op === 0x8c) d.write(decoded.operand, decoded.operand.kind === "register" ? width : 16, BigInt(this.state.segments[segment].selector));
        else this.#setSelector(segment, Number(d.read(decoded.operand, 16)));
        return false;
      }
      case 0x8d: {
        const decoded = d.modrm(width);
        if (decoded.operand.kind !== "memory") throw new X86ProcessorFault(6, "LEA requires a memory addressing form");
        d.write(decoded.register, width, decoded.operand.offset); return false;
      }
      case 0x8f: {
        const decoded = d.modrm(width);
        if (decoded.group !== 0) throw new X86ProcessorFault(6, "Invalid POP group selector");
        const value = this.#pop(d, width);
        const target = decoded.operand.kind === "memory" && decoded.operand.stackPointerBase
          ? { ...decoded.operand, offset: BigInt.asUintN(d.addressBits, decoded.operand.offset + BigInt(width / 8)) } : decoded.operand;
        d.write(target, width, value); return false;
      }
      case 0x90: return false;
      case 0x98: this.state.registers.write("rax", width, BigInt.asIntN(width === 16 ? 8 : 16, this.state.registers.read("rax", width))); return false;
      case 0x99: this.state.registers.write("rdx", width, BigInt.asIntN(width, this.state.registers.read("rax", width)) < 0n ? -1n : 0n); return false;
      case 0x9b: this.#floating(d, null); return false;
      case 0x9c: this.#push(d, width, (this.state.flags.value & ~0x30000n) | 2n); return false;
      case 0x9d: {
        const value = this.#pop(d, width), mask = width === 16 ? 0x4dd5n : 0x244dd5n;
        this.state.flags.value = ((this.state.flags.value & ~mask) | (value & mask) | 2n) & ~0x10000n;
        return false;
      }
      case 0x9e: { const value = this.state.registers.read("rax", 8, true); this.state.flags.value = (this.state.flags.value & ~0xd5n) | (value & 0xd5n); return false; }
      case 0x9f: this.state.registers.write("rax", 8, (this.state.flags.value & 0xd5n) | 2n, true); return false;
      case 0xa0: case 0xa1: case 0xa2: case 0xa3: {
        const bits = (op & 1) === 0 ? 8 : width;
        const operand: X86Operand = { kind: "memory", offset: d.immediate(d.addressBits), segment: d.segment ?? "ds", stackPointerBase: false };
        const accumulator = registerOperand(0, bits);
        d.write(op < 0xa2 ? accumulator : operand, bits, d.read(op < 0xa2 ? operand : accumulator, bits)); return false;
      }
      case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf:
        this.#string(d); return false;
      case 0xa8: case 0xa9: { const bits = op === 0xa8 ? 8 : width; this.#alu(d, "test", bits, registerOperand(0, bits), d.immediate(bits)); return false; }
      case 0xc0: case 0xc1: case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
        const bits = (op & 1) === 0 ? 8 : width, decoded = d.modrm(bits);
        const count = op < 0xd0 ? d.byte() : op < 0xd2 ? 1 : Number(this.state.registers.read("rcx", 8));
        const value = d.read(decoded.operand, bits); d.checkWrite(decoded.operand, bits);
        d.write(decoded.operand, bits, shift(shiftOperation(decoded.group), bits, value, count, this.state.flags)); return false;
      }
      case 0xc2: case 0xc3: {
        const adjustment = op === 0xc2 ? d.immediate(16) : 0n;
        d.cursor = BigInt.asUintN(width, this.#pop(d, width));
        this.state.registers.write("rsp", 32, this.state.registers.read("rsp", 32) + adjustment); return false;
      }
      case 0xc6: case 0xc7: {
        const bits = op === 0xc6 ? 8 : width, decoded = d.modrm(bits);
        if (decoded.group !== 0) throw new X86ProcessorFault(6, "Invalid MOV immediate group selector");
        d.write(decoded.operand, bits, d.immediate(bits)); return false;
      }
      case 0xc8: this.#enter(d); return false;
      case 0xc9: this.state.registers.write("rsp", 32, this.state.registers.read("rbp", 32)); this.state.registers.write("rbp", width, this.#pop(d, width)); return false;
      case 0xcc: throw new X86ProcessorFault(3, "INT3 breakpoint");
      case 0xcd: throw new X86ProcessorFault(13, `INT ${d.byte()} requires a guest interrupt service`, 0n);
      case 0xce: if (this.state.flags.get("overflow")) throw new X86ProcessorFault(4, "INTO overflow trap"); return false;
      case 0xd4: {
        const base = BigInt(d.byte()); if (base === 0n) throw new X86ProcessorFault(0, "AAM divide by zero");
        const value = this.state.registers.read("rax", 8); this.state.registers.write("rax", 16, ((value / base) << 8n) | (value % base));
        resultFlags(8, value % base, this.state.flags); return false;
      }
      case 0xd5: {
        const base = BigInt(d.byte()), result = BigInt.asUintN(8, this.state.registers.read("rax", 8) + this.state.registers.read("rax", 8, true) * base);
        this.state.registers.write("rax", 16, result); resultFlags(8, result, this.state.flags); return false;
      }
      case 0xd7: {
        const offset = BigInt.asUintN(d.addressBits, this.state.registers.read("rbx", d.addressBits) + this.state.registers.read("rax", 8));
        this.state.registers.write("rax", 8, d.read({ kind: "memory", offset, segment: d.segment ?? "ds", stackPointerBase: false }, 8)); return false;
      }
      case 0xe0: case 0xe1: case 0xe2: case 0xe3: {
        const displacement = d.signed(8);
        let count = this.state.registers.read("rcx", d.addressBits);
        if (op !== 0xe3) { count = BigInt.asUintN(d.addressBits, count - 1n); this.state.registers.write("rcx", d.addressBits, count); }
        const take = op === 0xe3 ? count === 0n : count !== 0n && (op === 0xe2 || this.state.flags.get("zero") === (op === 0xe1));
        if (take) d.cursor = BigInt.asUintN(width, d.cursor + displacement); return false;
      }
      case 0xe8: { const displacement = d.signed(width), next = d.cursor; this.#push(d, width, next); d.cursor = BigInt.asUintN(width, next + displacement); return false; }
      case 0xe9: case 0xeb: { const displacement = d.signed(op === 0xeb ? 8 : width); d.cursor = BigInt.asUintN(width, d.cursor + displacement); return false; }
      case 0xf4: return true;
      case 0xf5: this.state.flags.set("carry", !this.state.flags.get("carry")); return false;
      case 0xf6: case 0xf7: this.#unary(d, op === 0xf6 ? 8 : width); return false;
      case 0xf8: this.state.flags.set("carry", false); return false;
      case 0xf9: this.state.flags.set("carry", true); return false;
      case 0xfa: case 0xfb: throw new X86ProcessorFault(13, "CLI/STI requires privileged guest execution", 0n);
      case 0xfc: this.state.flags.set("direction", false); return false;
      case 0xfd: this.state.flags.set("direction", true); return false;
      case 0xfe: case 0xff: {
        const bits = op === 0xfe ? 8 : width, decoded = d.modrm(bits);
        if (decoded.group <= 1) this.#incdec(d, decoded.operand, bits, decoded.group === 1);
        else {
          this.#lock(d, decoded.operand, false);
          if (op === 0xfe) throw new X86ProcessorFault(6, "Invalid FE group selector");
          const target = d.read(decoded.operand, width);
          if (decoded.group === 2) { this.#push(d, width, d.cursor); d.cursor = target; }
          else if (decoded.group === 4) d.cursor = target;
          else if (decoded.group === 6) this.#push(d, width, target);
          else throw new UnsupportedX86Instruction(`FF group /${decoded.group} far transfer is unsupported`);
        }
        return false;
      }
      default: throw new UnsupportedX86Instruction(`Unsupported i386 opcode 0x${op.toString(16).padStart(2, "0")} at 0x${d.start.toString(16)}`);
    }
  }

  #segment(index: number): SegmentName {
    switch (index) { case 0: return "es"; case 1: return "cs"; case 2: return "ss"; case 3: return "ds"; case 4: return "fs"; case 5: return "gs";
      default: throw new X86ProcessorFault(6, "Invalid segment register encoding"); }
  }
  #setSelector(segment: SegmentName, selector: number): undefined {
    if (segment === "cs") throw new X86ProcessorFault(6, "MOV cannot load CS");
    if (selector !== this.state.segments[segment].selector) throw new UnsupportedX86Instruction(`Segment descriptor resolution for ${segment}=0x${selector.toString(16)} is unavailable`);
    return undefined;
  }
  #popSegment(d: X86Decoder, segment: SegmentName): undefined { return this.#setSelector(segment, Number(this.#pop(d, d.operandBits) & 0xffffn)); }
  #enter(d: X86Decoder): undefined {
    const allocation = d.immediate(16), nesting = d.byte() & 31, width = d.operandBits;
    const priorFrame = this.state.registers.read("rbp", width);
    const values: bigint[] = [priorFrame];
    const frame = BigInt.asUintN(32, this.state.registers.read("rsp", 32) - BigInt(width / 8));
    for (let level = 1; level < nesting; level++) values.push(d.read(this.#stackOperand(priorFrame - BigInt(level * width / 8)), width));
    if (nesting !== 0) values.push(frame);
    const finalStack = BigInt.asUintN(32, this.state.registers.read("rsp", 32) - BigInt(values.length * width / 8));
    const operand = this.#stackOperand(finalStack);
    if (operand.kind !== "memory") throw new Error("Expected stack operand");
    this.memory.check(d.address(operand, values.length * width / 8, "write"), values.length * width / 8, "write");
    for (const value of values) this.#push(d, width, value);
    this.state.registers.write("rbp", width, frame);
    this.state.registers.write("rsp", 32, finalStack - allocation);
    return undefined;
  }
  #string(d: X86Decoder): undefined {
    const op = d.opcode, width = (op & 1) === 0 ? 8 : d.operandBits;
    const repeated = d.repeat !== "none", count = this.state.registers.read("rcx", d.addressBits);
    if (repeated && count === 0n) return undefined;
    const source: X86Operand = { kind: "memory", offset: this.state.registers.read("rsi", d.addressBits), segment: d.segment ?? "ds", stackPointerBase: false };
    const destination: X86Operand = { kind: "memory", offset: this.state.registers.read("rdi", d.addressBits), segment: "es", stackPointerBase: false };
    const increment = BigInt(width / 8) * (this.state.flags.get("direction") ? -1n : 1n);
    const category = op & 0xfe;
    if (category === 0xa4) d.write(destination, width, d.read(source, width));
    else if (category === 0xa6) alu("cmp", width, d.read(source, width), d.read(destination, width), this.state.flags);
    else if (category === 0xaa) d.write(destination, width, this.state.registers.read("rax", width));
    else if (category === 0xac) this.state.registers.write("rax", width, d.read(source, width));
    else alu("cmp", width, this.state.registers.read("rax", width), d.read(destination, width), this.state.flags);
    if (category === 0xa4 || category === 0xa6 || category === 0xac) this.state.registers.write("rsi", d.addressBits, source.offset + increment);
    if (category !== 0xac) this.state.registers.write("rdi", d.addressBits, destination.offset + increment);
    if (repeated) {
      this.state.registers.write("rcx", d.addressBits, count - 1n);
      const compare = category === 0xa6 || category === 0xae;
      if (count !== 1n && (!compare || this.state.flags.get("zero") === (d.repeat === "f3"))) d.cursor = d.start;
    }
    return undefined;
  }
  #unary(d: X86Decoder, width: X86Width): undefined {
    const decoded = d.modrm(width);
    this.#lock(d, decoded.operand, decoded.group === 2 || decoded.group === 3);
    const operand = d.read(decoded.operand, width);
    if (decoded.group === 0 || decoded.group === 1) { this.#alu(d, "test", width, decoded.operand, d.immediate(width)); return undefined; }
    if (decoded.group === 2) { d.write(decoded.operand, width, ~operand); return undefined; }
    if (decoded.group === 3) { d.checkWrite(decoded.operand, width); d.write(decoded.operand, width, alu("sub", width, 0n, operand, this.state.flags)); return undefined; }
    const low = this.state.registers.read("rax", width);
    if (decoded.group === 4 || decoded.group === 5) {
      const signed = decoded.group === 5;
      const product = signed ? BigInt.asIntN(width, low) * BigInt.asIntN(width, operand) : low * operand;
      const overflow = signed ? BigInt.asIntN(width, product) !== product : product >> BigInt(width) !== 0n;
      this.state.flags.set("carry", overflow); this.state.flags.set("overflow", overflow);
      if (width === 8) this.state.registers.write("rax", 16, product);
      else { this.state.registers.write("rax", width, product); this.state.registers.write("rdx", width, product >> BigInt(width)); }
      return undefined;
    }
    const rawDividend = width === 8 ? this.state.registers.read("rax", 16) : (this.state.registers.read("rdx", width) << BigInt(width)) | low;
    const signed = decoded.group === 7, divisor = signed ? BigInt.asIntN(width, operand) : operand;
    const dividend = signed ? BigInt.asIntN(width * 2, rawDividend) : rawDividend;
    if (divisor === 0n) throw new X86ProcessorFault(0, "Integer division by zero");
    const quotient = dividend / divisor, remainder = dividend % divisor;
    if ((signed ? BigInt.asIntN(width, quotient) : BigInt.asUintN(width, quotient)) !== quotient) throw new X86ProcessorFault(0, "Integer division quotient overflow");
    this.state.registers.write("rax", width, quotient);
    this.state.registers.write(width === 8 ? "rax" : "rdx", width, remainder, width === 8);
    return undefined;
  }
  #extended(d: X86Decoder): undefined {
    const op = d.byte(), width = d.operandBits;
    if (d.lock && ![0xab, 0xb0, 0xb1, 0xb3, 0xba, 0xbb, 0xc0, 0xc1, 0xc7].includes(op)) throw new X86ProcessorFault(6, "LOCK is invalid for this 0F opcode");
    if (op >= 0x80 && op <= 0x8f) { const relative = d.signed(width); if (condition(op & 15, this.state.flags)) d.cursor = BigInt.asUintN(width, d.cursor + relative); return undefined; }
    if (op >= 0x90 && op <= 0x9f) { const decoded = d.modrm(8); d.write(decoded.operand, 8, condition(op & 15, this.state.flags) ? 1n : 0n); return undefined; }
    if (op >= 0x40 && op <= 0x4f) { const decoded = d.modrm(width), value = d.read(decoded.operand, width); if (condition(op & 15, this.state.flags)) d.write(decoded.register, width, value); return undefined; }
    if (op >= 0xc8 && op <= 0xcf) {
      if (width !== 32) throw new UnsupportedX86Instruction("16-bit BSWAP has undefined architectural behavior");
      const operand = registerOperand(op & 7, 32), value = d.read(operand, 32);
      d.write(operand, 32, ((value & 255n) << 24n) | ((value & 0xff00n) << 8n) | ((value >> 8n) & 0xff00n) | ((value >> 24n) & 255n)); return undefined;
    }
    switch (op) {
      case 0x0b: throw new X86ProcessorFault(6, "UD2 invalid opcode");
      case 0x1f: { const decoded = d.modrm(width); if (decoded.group !== 0) throw new X86ProcessorFault(6, "Invalid multi-byte NOP selector"); return undefined; }
      case 0xa0: this.#push(d, width, BigInt(this.state.segments.fs.selector)); return undefined;
      case 0xa1: return this.#popSegment(d, "fs");
      case 0xa8: this.#push(d, width, BigInt(this.state.segments.gs.selector)); return undefined;
      case 0xa9: return this.#popSegment(d, "gs");
      case 0xaf: { const decoded = d.modrm(width); d.write(decoded.register, width, signedMultiply(width, d.read(decoded.register, width), d.read(decoded.operand, width), this.state.flags)); return undefined; }
      case 0xb6: case 0xb7: case 0xbe: case 0xbf: {
        const bits = (op & 1) === 0 ? 8 : 16, decoded = d.modrm(bits), value = d.read(decoded.operand, bits);
        d.write(registerOperand(decoded.group, width), width, op >= 0xbe ? BigInt.asIntN(bits, value) : value); return undefined;
      }
      case 0xbc: case 0xbd: {
        const decoded = d.modrm(width), value = d.read(decoded.operand, width); this.state.flags.set("zero", value === 0n);
        if (value !== 0n) { let bit = op === 0xbc ? 0 : width - 1; while ((value & (1n << BigInt(bit))) === 0n) bit += op === 0xbc ? 1 : -1; d.write(decoded.register, width, BigInt(bit)); }
        return undefined;
      }
      case 0xb0: case 0xb1: case 0xc0: case 0xc1: {
        const bits = (op & 1) === 0 ? 8 : width, decoded = d.modrm(bits);
        this.#lock(d, decoded.operand, true);
        const destination = d.read(decoded.operand, bits), source = d.read(decoded.register, bits); d.checkWrite(decoded.operand, bits);
        if (op < 0xc0) {
          const accumulator = this.state.registers.read("rax", bits); alu("cmp", bits, accumulator, destination, this.state.flags);
          if (accumulator === destination) d.write(decoded.operand, bits, source);
          else { d.write(decoded.operand, bits, destination); this.state.registers.write("rax", bits, destination); }
        } else { const result = alu("add", bits, destination, source, this.state.flags); d.write(decoded.register, bits, destination); d.write(decoded.operand, bits, result); }
        return undefined;
      }
      case 0xa3: case 0xab: case 0xb3: case 0xbb: case 0xba: this.#bit(d, op); return undefined;
      case 0xa4: case 0xa5: case 0xac: case 0xad: this.#doubleShift(d, op); return undefined;
      case 0xc7: this.#compareExchange8(d); return undefined;
      default:
        if (op >= 0x10 && op <= 0x17 || op >= 0x28 && op <= 0x2f || op >= 0x50 && op <= 0x7f || op >= 0xc2 && op <= 0xc6 || op >= 0xd0 || op === 0xae) {
          this.#floating(d, op); return undefined;
        }
        throw new UnsupportedX86Instruction(`Unsupported i386 opcode 0f ${op.toString(16).padStart(2, "0")} at 0x${d.start.toString(16)}`);
    }
  }
  #bit(d: X86Decoder, op: number): undefined {
    const width = d.operandBits, decoded = d.modrm(width);
    const operation = op === 0xba ? decoded.group : op === 0xa3 ? 4 : op === 0xab ? 5 : op === 0xb3 ? 6 : 7;
    if (operation < 4) throw new X86ProcessorFault(6, "Invalid bit-operation group selector");
    this.#lock(d, decoded.operand, operation !== 4);
    const index = op === 0xba ? BigInt(d.byte()) : BigInt.asIntN(width, d.read(decoded.register, width));
    const bit = BigInt.asUintN(width === 16 ? 4 : 5, index);
    let operand = decoded.operand;
    if (operand.kind === "memory" && op !== 0xba) operand = { ...operand,
      offset: BigInt.asUintN(d.addressBits, operand.offset + ((index - bit) / BigInt(width)) * BigInt(width / 8)) };
    const value = d.read(operand, width), mask = 1n << bit;
    if (operation !== 4) d.checkWrite(operand, width);
    this.state.flags.set("carry", (value & mask) !== 0n);
    if (operation !== 4) d.write(operand, width, operation === 5 ? value | mask : operation === 6 ? value & ~mask : value ^ mask);
    return undefined;
  }
  #doubleShift(d: X86Decoder, op: number): undefined {
    const width = d.operandBits, decoded = d.modrm(width), count = (op & 1) === 0 ? d.byte() & 31 : Number(this.state.registers.read("rcx", 8)) & 31;
    if (count > width) throw new UnsupportedX86Instruction("SHLD/SHRD count exceeding operand width has undefined behavior");
    const value = d.read(decoded.operand, width), source = d.read(decoded.register, width);
    if (count === 0) return undefined;
    d.checkWrite(decoded.operand, width);
    const left = op < 0xac;
    const result = BigInt.asUintN(width, left ? (value << BigInt(count)) | (source >> BigInt(width - count)) : (value >> BigInt(count)) | (source << BigInt(width - count)));
    const carry = ((left ? value >> BigInt(width - count) : value >> BigInt(count - 1)) & 1n) !== 0n;
    const oldOverflow = this.state.flags.get("overflow"), oldAuxiliary = this.state.flags.get("auxiliary-carry");
    alu("or", width, result, 0n, this.state.flags);
    this.state.flags.set("carry", carry); this.state.flags.set("auxiliary-carry", oldAuxiliary);
    this.state.flags.set("overflow", count === 1 ? ((value ^ result) & (1n << BigInt(width - 1))) !== 0n : oldOverflow);
    d.write(decoded.operand, width, result);
    return undefined;
  }
  #compareExchange8(d: X86Decoder): undefined {
    const decoded = d.modrm(32);
    if (decoded.group !== 1 || decoded.operand.kind !== "memory") throw new UnsupportedX86Instruction("Only memory CMPXCHG8B is supported in 0F C7 group");
    const address = d.address(decoded.operand, 8, "read"), value = this.memory.readUint64(address);
    this.memory.check(address, 8, "write");
    const expected = (this.state.registers.read("rdx", 32) << 32n) | this.state.registers.read("rax", 32);
    const equal = value === expected;
    this.memory.writeUint64(address, equal ? (this.state.registers.read("rcx", 32) << 32n) | this.state.registers.read("rbx", 32) : value);
    this.state.flags.set("zero", equal);
    if (!equal) { this.state.registers.write("rax", 32, value); this.state.registers.write("rdx", 32, value >> 32n); }
    return undefined;
  }
  #floating(d: X86Decoder, secondaryOpcode: number | null): undefined {
    const decoded = d.opcode === 0x9b || secondaryOpcode === 0x77 ? null : d.modrm(d.operandBits);
    let operand: NumericOperand | null = null;
    if (decoded !== null) operand = decoded.operand.kind === "memory"
      ? { kind: "memory", address: d.address(decoded.operand, 1, "read") }
      : { kind: "register", index: decoded.operand.index };
    const needsImmediate = secondaryOpcode !== null && [0x70, 0x71, 0x72, 0x73, 0xc2, 0xc4, 0xc5, 0xc6].includes(secondaryOpcode);
    const immediate = needsImmediate ? d.byte() : null;
    const result = this.#numeric({ state: this.state, memory: this.memory, instruction: { opcode: d.opcode, secondaryOpcode,
      modrm: decoded?.byte ?? null, operand, registerIndex: decoded?.group ?? 0,
      prefix: d.repeat !== "none" ? d.repeat : d.operandBits === 16 ? "66" : "none", operandBits: d.operandBits, immediate } });
    if (result.kind === "unsupported") throw new UnsupportedX86Instruction(result.detail);
    if (result.kind === "exception") throw new X86ProcessorFault(result.vector, result.detail);
    return undefined;
  }
}
