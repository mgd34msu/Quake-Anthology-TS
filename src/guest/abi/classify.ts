// SPDX-License-Identifier: GPL-2.0-or-later
import type { GuestValueLayout, NativeCallAbi } from "../../contracts/execution.ts";
import type { GuestCallSignature, GuestRegister } from "../core/contracts.ts";
import { alignUp, argumentBytes, storageBytes, validateValueLayout, valueAlignment, valueBytes } from "./values.ts";

export type AbiLocation =
  | { readonly kind: "integer"; readonly register: GuestRegister; readonly offset: number; readonly bytes: number }
  | { readonly kind: "sse"; readonly register: number; readonly offset: number; readonly bytes: number }
  | { readonly kind: "stack"; readonly stackOffset: number; readonly offset: number; readonly bytes: number };
export interface AbiArgument {
  readonly layout: GuestValueLayout;
  readonly indirect: boolean;
  readonly locations: readonly AbiLocation[];
}
export type AbiResult = { readonly kind: "void" } | { readonly kind: "x87"; readonly storage: "float32" | "float64" }
  | { readonly kind: "registers"; readonly layout: GuestValueLayout; readonly locations: readonly AbiLocation[] }
  | { readonly kind: "memory"; readonly layout: GuestValueLayout; readonly pointer: AbiArgument };
export interface AbiCallPlan {
  readonly abi: NativeCallAbi;
  readonly arguments: readonly AbiArgument[];
  readonly result: AbiResult;
  readonly stackBytes: number;
  readonly stackAlignment: number;
  readonly calleePopBytes: number;
  readonly vectorRegisters: number;
}
type EightbyteClass = "none" | "integer" | "sse";
/** Current GuestLayout describes POD aggregates of scalar fields, including overlapping union fields. */
export function classifySystemVAggregate(layout: GuestValueLayout): readonly EightbyteClass[] | "memory" {
  validateValueLayout(layout, 8);
  if (layout.kind === "scalar") return [layout.storage === "float32" || layout.storage === "float64" ? "sse" : "integer"];
  if (layout.layout.byteLength > 16) return "memory";
  const classes: EightbyteClass[] = Array.from({ length: Math.ceil(layout.layout.byteLength / 8) }, () => "none");
  for (const field of layout.layout.fields) {
    const size = storageBytes(field.storage, 8);
    if (field.byteOffset % size !== 0) return "memory";
    for (let index = 0; index < field.count; index++) {
      const start = field.byteOffset + index * size, end = start + size;
      for (let slot = Math.floor(start / 8); slot < Math.ceil(end / 8); slot++) {
        const prior = classes[slot];
        if (prior === undefined) throw new RangeError("Aggregate classification exceeds layout");
        const next = field.storage === "float32" || field.storage === "float64" ? "sse" : "integer";
        classes[slot] = prior === "integer" || next === "integer" ? "integer" : "sse";
      }
    }
  }
  return classes;
}
function hiddenResult(signature: GuestCallSignature): boolean {
  if (signature.result === "void" || signature.result.kind === "scalar") return false;
  if (signature.abi.kind === "windows-i386" && signature.abi.call === "thiscall") return true;
  if (signature.abi.kind === "linux-i386") return true;
  if (signature.abi.kind === "linux-x86-64") return classifySystemVAggregate(signature.result) === "memory";
  return ![1, 2, 4, 8].includes(signature.result.layout.byteLength);
}

export function planGuestCall(signature: GuestCallSignature, layouts: readonly GuestValueLayout[] = signature.parameters): AbiCallPlan {
  const abi = signature.abi, word = abi.pointerBytes, hidden = hiddenResult(signature);
  if ((!signature.variadic && layouts.length !== signature.parameters.length) || layouts.length < signature.parameters.length) throw new RangeError("Call argument count differs from signature");
  for (const layout of layouts) validateValueLayout(layout, word);
  if (signature.result !== "void") validateValueLayout(signature.result, word);
  const microsoft64 = abi.kind === "windows-x86-64", system64 = abi.kind === "linux-x86-64";
  const integerRegisters: readonly GuestRegister[] = microsoft64 ? ["rcx", "rdx", "r8", "r9"] : system64 ? ["rdi", "rsi", "rdx", "rcx", "r8", "r9"] : [];
  let stackBytes = word + (microsoft64 ? 32 : 0), integerCount = 0, vectorCount = 0, ordinal = 0;
  let stackAlignment = word === 8 || abi.kind === "linux-i386" ? 16 : 4;
  const pointerLayout: GuestValueLayout = { kind: "scalar", storage: "pointer" };
  const stack = (layout: GuestValueLayout, indirect: boolean): AbiArgument => {
    const size = indirect ? word : argumentBytes(layout, word);
    const alignment = abi.kind === "windows-i386" ? 4 : indirect ? word : Math.max(word, valueAlignment(layout, word));
    stackAlignment = Math.max(stackAlignment, alignment);
    stackBytes = alignUp(stackBytes - word, alignment) + word;
    const location: AbiLocation = { kind: "stack", stackOffset: stackBytes, offset: 0, bytes: size };
    stackBytes += alignUp(size, word);
    return { layout, indirect, locations: [location] };
  };
  const assign = (layout: GuestValueLayout, isHidden: boolean, parameterIndex: number): AbiArgument => {
    const size = argumentBytes(layout, word), floating = layout.kind === "scalar" && (layout.storage === "float32" || layout.storage === "float64");
    if (microsoft64) {
      const position = ordinal++, register = integerRegisters[position], indirect = layout.kind === "aggregate" && ![1, 2, 4, 8].includes(size);
      if (register === undefined) return stack(layout, indirect);
      const locations: AbiLocation[] = floating ? [{ kind: "sse", register: position, offset: 0, bytes: size }] : [{ kind: "integer", register, offset: 0, bytes: indirect ? word : size }];
      if (floating && signature.variadic) locations.push({ kind: "integer", register, offset: 0, bytes: size });
      if (floating) vectorCount = Math.max(vectorCount, position + 1);
      return { layout, indirect, locations };
    }
    if (system64) {
      const classes = classifySystemVAggregate(layout);
      if (classes === "memory") return stack(layout, false);
      const neededIntegers = classes.filter(kind => kind === "integer").length, neededVectors = classes.filter(kind => kind === "sse").length;
      if (integerCount + neededIntegers > integerRegisters.length || vectorCount + neededVectors > 8) return stack(layout, false);
      const locations: AbiLocation[] = [];
      for (const [index, kind] of classes.entries()) {
        const offset = index * 8, bytes = Math.min(8, size - offset);
        if (kind === "integer") {
          const register = integerRegisters[integerCount++];
          if (register === undefined) throw new RangeError("System V integer register allocation overflow");
          locations.push({ kind, register, offset, bytes });
        } else if (kind === "sse") locations.push({ kind, register: vectorCount++, offset, bytes });
      }
      return { layout, indirect: false, locations };
    }
    if (abi.kind === "windows-i386" && !signature.variadic) {
      if (abi.call === "thiscall" && parameterIndex === 0 && !isHidden) {
        if (layout.kind !== "scalar" || layout.storage !== "pointer") throw new TypeError("thiscall's first explicit argument must be the this pointer");
        return { layout, indirect: false, locations: [{ kind: "integer", register: "rcx", offset: 0, bytes: 4 }] };
      }
      if (abi.call === "fastcall" && layout.kind === "scalar" && !floating && size <= 4 && integerCount < 2) {
        const register: GuestRegister = integerCount++ === 0 ? "rcx" : "rdx";
        return { layout, indirect: false, locations: [{ kind: "integer", register, offset: 0, bytes: size }] };
      }
    }
    return stack(layout, false);
  };
  const thisBeforeHidden = hidden && abi.kind === "windows-i386" && abi.call === "thiscall" && signature.variadic;
  const firstLayout = layouts[0];
  if (thisBeforeHidden && (firstLayout?.kind !== "scalar" || firstLayout.storage !== "pointer")) throw new TypeError("Variadic thiscall requires an explicit this pointer");
  const firstArgument = thisBeforeHidden && firstLayout !== undefined ? assign(firstLayout, false, 0) : null;
  const hiddenPointer = hidden ? assign(pointerLayout, true, -1) : null;
  const arguments_ = layouts.map((layout, index) => index === 0 && firstArgument !== null ? firstArgument : assign(layout, false, index));
  let result: AbiResult;
  if (signature.result === "void") result = { kind: "void" };
  else if (hiddenPointer !== null) result = { kind: "memory", layout: signature.result, pointer: hiddenPointer };
  else if (word === 4 && signature.result.kind === "scalar" && (signature.result.storage === "float32" || signature.result.storage === "float64")) result = { kind: "x87", storage: signature.result.storage };
  else {
    const size = valueBytes(signature.result, word), locations: AbiLocation[] = [];
    if (system64) {
      const classes = classifySystemVAggregate(signature.result);
      if (classes === "memory") throw new Error("Memory result lacks hidden pointer");
      let integerReturn = 0, vectorReturn = 0;
      for (const [index, kind] of classes.entries()) {
        const offset = index * 8, bytes = Math.min(8, size - offset);
        if (kind === "integer") locations.push({ kind, register: integerReturn++ === 0 ? "rax" : "rdx", offset, bytes });
        else if (kind === "sse") locations.push({ kind, register: vectorReturn++, offset, bytes });
      }
    } else if (microsoft64 && signature.result.kind === "scalar" && (signature.result.storage === "float32" || signature.result.storage === "float64")) locations.push({ kind: "sse", register: 0, offset: 0, bytes: size });
    else {
      locations.push({ kind: "integer", register: "rax", offset: 0, bytes: Math.min(word, size) });
      if (size > word) locations.push({ kind: "integer", register: "rdx", offset: word, bytes: size - word });
    }
    result = { kind: "registers", layout: signature.result, locations };
  }
  const calleePopBytes = abi.kind === "linux-i386" && hidden ? 4 : abi.kind === "windows-i386" && !signature.variadic && abi.call !== "cdecl" ? stackBytes - word : 0;
  return { abi, arguments: arguments_, result, stackBytes, stackAlignment, calleePopBytes, vectorRegisters: vectorCount };
}
