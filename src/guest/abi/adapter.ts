// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestAddress, GuestCallResult, GuestCallValue, GuestValueLayout, NativeCallAbi } from "../../contracts/execution.ts";
import type { GuestAbiAdapter, GuestCallSignature, GuestCpu, MappedGuestMemory } from "../core/contracts.ts";
import { readX87Return, writeX87Return } from "../floating-point/index.ts";
import { planGuestCall, type AbiArgument, type AbiCallPlan, type AbiLocation } from "./classify.ts";
import { alignDown, argumentBytes, decodeValue, encodeArgumentValue, encodeValue, inferredLayout, valueAlignment, valueBytes } from "./values.ts";

export function guestPointer(memory: MappedGuestMemory, raw: bigint): GuestAddress {
  const address = memory.pointer(raw);
  if (address === null) throw new RangeError("ABI address cannot be null");
  return address;
}
function registerWidth(cpu: GuestCpu): 32 | 64 { return cpu.state.architecture === "i386" ? 32 : 64; }
function stackPointer(cpu: GuestCpu): bigint { return cpu.state.registers.read("rsp", registerWidth(cpu)); }

function readLocations(cpu: GuestCpu, locations: readonly AbiLocation[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let view: DataView | undefined;
  for (const location of locations) {
    if (location.offset + location.bytes > size) throw new RangeError("ABI part exceeds its value");
    if (location.kind === "integer") {
      const value = cpu.state.registers.read(location.register, registerWidth(cpu));
      view ??= new DataView(output.buffer, output.byteOffset, output.byteLength);
      switch (location.bytes) {
        case 8: view.setBigUint64(location.offset, value, true); break;
        case 4: view.setUint32(location.offset, Number(BigInt.asUintN(32, value)), true); break;
        case 2: view.setUint16(location.offset, Number(BigInt.asUintN(16, value)), true); break;
        case 1: view.setUint8(location.offset, Number(BigInt.asUintN(8, value))); break;
        default: for (let index = 0; index < location.bytes; index++) output[location.offset + index] = Number(value >> BigInt(index * 8) & 255n);
      }
    } else if (location.kind === "sse") {
      const start = location.register * 16;
      if (start + location.bytes > cpu.state.simd.xmm.length) throw new RangeError("ABI XMM register is unavailable");
      output.set(cpu.state.simd.xmm.subarray(start, start + location.bytes), location.offset);
    } else output.set(cpu.memory.copy(guestPointer(cpu.memory, stackPointer(cpu) + BigInt(location.stackOffset)), location.bytes), location.offset);
  }
  return output;
}
function writeLocations(cpu: GuestCpu, locations: readonly AbiLocation[], bytes: Uint8Array): void {
  let view: DataView | undefined;
  for (const location of locations) {
    const part = bytes.subarray(location.offset, location.offset + location.bytes);
    if (part.length !== location.bytes) throw new RangeError("ABI value is shorter than its assigned location");
    if (location.kind === "integer") {
      view ??= new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let raw = 0n;
      switch (location.bytes) {
        case 8: raw = view.getBigUint64(location.offset, true); break;
        case 4: raw = BigInt(view.getUint32(location.offset, true)); break;
        case 2: raw = BigInt(view.getUint16(location.offset, true)); break;
        case 1: raw = BigInt(view.getUint8(location.offset)); break;
        default: for (const [index, byte] of part.entries()) raw |= BigInt(byte) << BigInt(index * 8);
      }
      cpu.state.registers.write(location.register, registerWidth(cpu), raw);
    } else if (location.kind === "sse") {
      const start = location.register * 16;
      if (start + part.length > cpu.state.simd.xmm.length) throw new RangeError("ABI XMM register is unavailable");
      cpu.state.simd.xmm.set(part, start);
    } else cpu.memory.write(guestPointer(cpu.memory, stackPointer(cpu) + BigInt(location.stackOffset)), part);
  }
}
function readInteger(cpu: GuestCpu, layout: GuestValueLayout, locations: readonly AbiLocation[]): GuestCallValue | null {
  if (layout.kind !== "scalar" || layout.storage === "float32" || layout.storage === "float64") return null;
  const location = locations.length === 1 ? locations[0] : undefined;
  if (location === undefined || location.offset !== 0 || location.kind === "sse"
    || (location.bytes !== 8 && location.bytes !== 4 && location.bytes !== 2 && location.bytes !== 1)) return null;
  let raw: bigint;
  if (location.kind === "integer") raw = cpu.state.registers.read(location.register, registerWidth(cpu));
  else {
    const address = guestPointer(cpu.memory, stackPointer(cpu) + BigInt(location.stackOffset));
    raw = location.bytes === 8 ? cpu.memory.readUint64(address) : BigInt(location.bytes === 4 ? cpu.memory.readUint32(address)
      : location.bytes === 2 ? cpu.memory.readUint16(address) : cpu.memory.readUint8(address));
  }
  switch (layout.storage) {
    case "int8": return { kind: "int32", value: Number(BigInt.asIntN(8, raw)) };
    case "uint8": return { kind: "uint32", value: Number(BigInt.asUintN(8, raw)) };
    case "int16": return { kind: "int32", value: Number(BigInt.asIntN(16, raw)) };
    case "uint16": return { kind: "uint32", value: Number(BigInt.asUintN(16, raw)) };
    case "int32": return { kind: "int32", value: Number(BigInt.asIntN(32, raw)) };
    case "uint32": return { kind: "uint32", value: Number(BigInt.asUintN(32, raw)) };
    case "int64": return { kind: "int64", value: BigInt.asIntN(64, raw) };
    case "uint64": return { kind: "uint64", value: BigInt.asUintN(64, raw) };
    case "pointer": return { kind: "pointer", value: cpu.memory.pointer(BigInt.asUintN(cpu.memory.pointerBytes * 8, raw)) };
  }
}
function readArgument(cpu: GuestCpu, argument: AbiArgument): GuestCallValue {
  if (!argument.indirect) { const value = readInteger(cpu, argument.layout, argument.locations); if (value !== null) return value; }
  if (!argument.indirect) return decodeValue(argument.layout, readLocations(cpu, argument.locations, argumentBytes(argument.layout, cpu.memory.pointerBytes)).subarray(0, valueBytes(argument.layout, cpu.memory.pointerBytes)), cpu.memory);
  const pointer = decodeValue({ kind: "scalar", storage: "pointer" }, readLocations(cpu, argument.locations, cpu.memory.pointerBytes), cpu.memory);
  if (pointer.kind !== "pointer" || pointer.value === null) throw new RangeError("Indirect aggregate has a null guest address");
  return decodeValue(argument.layout, cpu.memory.copy(pointer.value, valueBytes(argument.layout, cpu.memory.pointerBytes)), cpu.memory);
}
function returnBuffer(cpu: GuestCpu, plan: AbiCallPlan): GuestAddress {
  if (plan.result.kind !== "memory") throw new TypeError("Call does not return an aggregate in memory");
  const pointer = readArgument(cpu, plan.result.pointer);
  if (pointer.kind !== "pointer" || pointer.value === null) throw new RangeError("Aggregate return pointer is null");
  return pointer.value;
}

export class X86AbiAdapter implements GuestAbiAdapter {
  constructor(readonly abi: NativeCallAbi) {}

  #check(cpu: GuestCpu, signature: GuestCallSignature): void {
    if (signature.abi.kind !== this.abi.kind || signature.abi.call !== this.abi.call || cpu.memory.pointerBytes !== this.abi.pointerBytes
      || (cpu.state.architecture === "i386") !== (this.abi.pointerBytes === 4)) throw new TypeError("ABI, signature, processor, and memory architecture disagree");
  }

  enter(cpu: GuestCpu, target: GuestAddress, signature: GuestCallSignature, arguments_: readonly GuestCallValue[], returnAddress: GuestAddress): undefined {
    this.#check(cpu, signature);
    cpu.memory.check(target, 1, "execute");
    cpu.memory.check(returnAddress, 1, "execute");
    const layouts = arguments_.length === signature.parameters.length ? signature.parameters
      : arguments_.map((value, index) => signature.parameters[index] ?? inferredLayout(value, signature.variadic));
    const plan = planGuestCall(signature, layouts), word = this.abi.pointerBytes;
    const encoded = arguments_.map((value, index) => {
      const layout = layouts[index];
      if (layout === undefined) throw new RangeError("Argument layout missing");
      return encodeArgumentValue(layout, value, cpu.memory);
    });
    const callerStack = stackPointer(cpu);
    let temporaryTop = callerStack;
    const reserve = (size: number, alignment: number): GuestAddress => {
      temporaryTop = alignDown(temporaryTop - BigInt(size), alignment);
      return guestPointer(cpu.memory, temporaryTop);
    };
    const output = plan.result.kind === "memory" ? reserve(valueBytes(plan.result.layout, word), Math.max(16, valueAlignment(plan.result.layout, word))) : null;
    const indirect = plan.arguments.map(argument => argument.indirect ? reserve(valueBytes(argument.layout, word), 16) : null);
    const entryStack = alignDown(temporaryTop - BigInt(plan.stackBytes - word), plan.stackAlignment) - BigInt(word);
    const frameSize = Number(callerStack - entryStack);
    if (!Number.isSafeInteger(frameSize) || frameSize < 0) throw new RangeError("Guest call frame exceeds safe bounds");
    cpu.memory.check(guestPointer(cpu.memory, entryStack), frameSize, "write");
    cpu.memory.write(guestPointer(cpu.memory, entryStack), encodeValue({ kind: "scalar", storage: "pointer" }, { kind: "pointer", value: returnAddress }, cpu.memory));
    cpu.state.registers.write("rsp", registerWidth(cpu), entryStack);
    if (output !== null && plan.result.kind === "memory") {
      cpu.memory.write(output, new Uint8Array(valueBytes(plan.result.layout, word)));
      writeLocations(cpu, plan.result.pointer.locations, encodeValue({ kind: "scalar", storage: "pointer" }, { kind: "pointer", value: output }, cpu.memory));
    }
    for (const [index, argument] of plan.arguments.entries()) {
      const bytes = encoded[index], temporary = indirect[index];
      if (bytes === undefined || temporary === undefined) throw new RangeError("Argument allocation missing");
      if (temporary === null) writeLocations(cpu, argument.locations, bytes);
      else {
        cpu.memory.write(temporary, bytes);
        writeLocations(cpu, argument.locations, encodeValue({ kind: "scalar", storage: "pointer" }, { kind: "pointer", value: temporary }, cpu.memory));
      }
    }
    if (this.abi.kind === "linux-x86-64" && signature.variadic) cpu.state.registers.write("rax", 8, BigInt(plan.vectorRegisters));
    cpu.state.flags.set("direction", false);
    cpu.state.instructionPointer = target.byteOffset;
    return undefined;
  }

  /** Additional variadic layouts come from the host API contract or a format-string parser. */
  arguments(cpu: GuestCpu, signature: GuestCallSignature, variadicLayouts: readonly GuestValueLayout[] = []): readonly GuestCallValue[] {
    this.#check(cpu, signature);
    const plan = planGuestCall(signature, variadicLayouts.length === 0 ? signature.parameters : [...signature.parameters, ...variadicLayouts]);
    return plan.arguments.map(argument => readArgument(cpu, argument));
  }

  argument(cpu: GuestCpu, signature: GuestCallSignature, index: number): GuestCallValue {
    this.#check(cpu, signature);
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Guest argument index is outside its signature");
    const plan = planGuestCall(signature);
    const argument = plan.arguments[index];
    if (argument === undefined) throw new RangeError("Guest argument index is outside its signature");
    return readArgument(cpu, argument);
  }

  returnValue(cpu: GuestCpu, signature: GuestCallSignature): GuestCallResult {
    this.#check(cpu, signature);
    const plan = planGuestCall(signature);
    switch (plan.result.kind) {
      case "void": return { kind: "void" };
      case "registers": return readInteger(cpu, plan.result.layout, plan.result.locations)
        ?? decodeValue(plan.result.layout, readLocations(cpu, plan.result.locations, valueBytes(plan.result.layout, this.abi.pointerBytes)), cpu.memory);
      case "memory": {
        const address = guestPointer(cpu.memory, cpu.state.registers.read("rax", registerWidth(cpu)));
        return decodeValue(plan.result.layout, cpu.memory.copy(address, valueBytes(plan.result.layout, this.abi.pointerBytes)), cpu.memory);
      }
      case "x87": {
        const value = readX87Return(cpu.state.x87, plan.result.storage);
        const top = cpu.state.x87.statusWord >>> 11 & 7;
        cpu.state.x87.tagWord |= 3 << top * 2;
        cpu.state.x87.statusWord = cpu.state.x87.statusWord & ~0x3800 | (top + 1 & 7) << 11;
        return { kind: plan.result.storage, value };
      }
    }
  }

  /** Called at a trapped host function's entry, before any guest prologue. */
  leave(cpu: GuestCpu, signature: GuestCallSignature, result: GuestCallResult): undefined {
    this.#check(cpu, signature);
    const plan = planGuestCall(signature), word = this.abi.pointerBytes, entryStack = stackPointer(cpu);
    const address = decodeValue({ kind: "scalar", storage: "pointer" }, cpu.memory.copy(guestPointer(cpu.memory, entryStack), word), cpu.memory);
    if (address.kind !== "pointer" || address.value === null) throw new RangeError("Guest return address is null");
    if (plan.result.kind === "void") {
      if (result.kind !== "void") throw new TypeError("Void callback returned a value");
    } else {
      if (result.kind === "void") throw new TypeError("Nonvoid callback did not return a value");
      if (plan.result.kind === "x87") {
        if (result.kind !== "float32" && result.kind !== "float64") throw new TypeError("x87 callback result must be floating point");
        writeX87Return(cpu.state.x87, result.value, plan.result.storage);
      } else {
        const bytes = encodeValue(plan.result.layout, result, cpu.memory);
        if (plan.result.kind === "registers") writeLocations(cpu, plan.result.locations, bytes);
        else {
          const destination = returnBuffer(cpu, plan);
          cpu.memory.write(destination, bytes);
          cpu.state.registers.write("rax", registerWidth(cpu), destination.byteOffset);
        }
      }
    }
    cpu.state.registers.write("rsp", registerWidth(cpu), entryStack + BigInt(word + plan.calleePopBytes));
    cpu.state.instructionPointer = address.value.byteOffset;
    return undefined;
  }
}
