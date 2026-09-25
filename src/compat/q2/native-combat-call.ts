import type { GuestAddress, GuestCallValue, GuestLayout, GuestValueLayout, NativeCallAbi } from "../../contracts/execution.ts";
import type { GuestCallSignature, GuestCpu, MappedGuestMemory } from "../../guest/core/contracts.ts";
import type { NativeModAddress } from "../../contracts/native-mod-callbacks.ts";
import { decodeValue, validateValueLayout, valueBytes } from "../../guest/abi/values.ts";
import { readLayout } from "../../persistence/execution.ts";
import type { SaveReader } from "../../persistence/value.ts";
import { X86AbiAdapter } from "../../guest/abi/adapter.ts";
import { planGuestCall } from "../../guest/abi/classify.ts";
import { nativeOffset, nativeScalar } from "./native-primary-reader.ts";

export type NativeCombatField = "target" | "inflictor" | "attacker" | "direction" | "point" | "normal" | "amount" | "knockback" | "flags" | "cause" | "sparks" | "kick";
export type NativeCombatArgument = { readonly kind: "field"; readonly field: NativeCombatField }
  | { readonly kind: "value"; readonly layout: GuestValueLayout; readonly bytes: readonly number[] }
  | { readonly kind: "address"; readonly address: NativeModAddress | null };
export interface NativeCombatCall { readonly convention: "cdecl" | "stdcall" | "fastcall" | "thiscall" | "microsoft-x64"; readonly arguments: readonly NativeCombatArgument[]; }
export type NativeCombatOperation = "damage" | "regular-armor" | "power-armor" | "pain" | "death" | "deferred-reaction";
const damageFields: readonly NativeCombatField[] = ["target", "inflictor", "attacker", "direction", "point", "normal", "amount", "knockback", "flags", "cause"];
const regularFields: readonly NativeCombatField[] = ["target", "point", "normal", "amount", "sparks", "flags"];
const powerFields: readonly NativeCombatField[] = ["target", "point", "normal", "amount", "flags"];
const pointer: GuestValueLayout = { kind: "scalar", storage: "pointer" }, integer: GuestValueLayout = { kind: "scalar", storage: "int32" };
export const nativeRereleaseModLayout: GuestLayout = { id: "q2-rerelease:mod_t", byteLength: 3, alignment: 1, pointerBytes: 8, byteOrder: "little-endian", fields: [
  { name: "id", byteOffset: 0, storage: "uint8", count: 1 }, { name: "friendly_fire", byteOffset: 1, storage: "uint8", count: 1 }, { name: "no_point_loss", byteOffset: 2, storage: "uint8", count: 1 },
] };
function fields(operation: NativeCombatOperation, pointerBytes: 4 | 8): readonly NativeCombatField[] {
  switch (operation) {
    case "damage": return damageFields;
    case "regular-armor": return regularFields;
    case "power-armor": return powerFields;
    case "pain": return pointerBytes === 4 ? ["target", "attacker", "kick", "amount"] : ["target", "attacker", "kick", "amount", "cause"];
    case "death": return pointerBytes === 4 ? ["target", "inflictor", "attacker", "amount", "point"] : ["target", "inflictor", "attacker", "amount", "point", "cause"];
    case "deferred-reaction": return ["target"];
  }
}
export function stockNativeCombatCall(operation: NativeCombatOperation, abi?: NativeCallAbi): NativeCombatCall {
  return { convention: abi?.pointerBytes === 8 ? "microsoft-x64" : "cdecl", arguments: fields(operation, abi?.pointerBytes ?? 4).map(field => ({ kind: "field", field })) };
}
function layout(argument: NativeCombatArgument, abi: NativeCallAbi): GuestValueLayout {
  if (argument.kind === "address") return pointer;
  if (argument.kind === "value") return argument.layout;
  switch (argument.field) {
    case "target": case "inflictor": case "attacker": case "direction": case "point": case "normal": return pointer;
    case "amount": case "knockback": case "flags": case "sparks": return integer;
    case "kick": return { kind: "scalar", storage: "float32" };
    case "cause": return abi.pointerBytes === 4 ? integer : { kind: "aggregate", layout: nativeRereleaseModLayout };
  }
}
export function nativeCombatSignature(call: NativeCombatCall, operation: NativeCombatOperation, abi: NativeCallAbi): GuestCallSignature {
  let sourceAbi: NativeCallAbi;
  if (abi.kind === "windows-i386" && call.convention !== "microsoft-x64") sourceAbi = { ...abi, call: call.convention };
  else if (abi.kind === "windows-x86-64" && call.convention === "microsoft-x64") sourceAbi = abi;
  else throw new Error("Native combat convention does not match its source architecture");
  return { abi: sourceAbi, parameters: call.arguments.map(argument => layout(argument, sourceAbi)), result: operation === "regular-armor" || operation === "power-armor" ? integer : "void", variadic: false };
}
export function validateNativeCombatCall(call: NativeCombatCall, operation: NativeCombatOperation, abi: NativeCallAbi): void {
  planGuestCall(nativeCombatSignature(call, operation, abi));
  const required = fields(operation, abi.pointerBytes), seen = new Set<NativeCombatField>();
  if (call.arguments.length > 64) throw new Error("Native combat argument extent exceeds its declared boundary");
  for (const argument of call.arguments) {
    if (argument.kind === "field") {
      if (!required.includes(argument.field) || seen.has(argument.field)) throw new Error("Native combat fields must occur exactly once");
      seen.add(argument.field);
    } else if (argument.kind === "address") {
      if (argument.address !== null) for (const value of [argument.address.rva, ...argument.address.indirections])
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error("Native combat address exceeds its image declaration");
    } else {
      validateValueLayout(argument.layout, abi.pointerBytes);
      if (argument.layout.kind === "scalar" ? argument.layout.storage === "pointer" : argument.layout.layout.fields.some(field => field.storage === "pointer"))
        throw new Error("Native combat pointer defaults require an image-relative address");
      if (argument.bytes.length !== valueBytes(argument.layout, abi.pointerBytes) || argument.bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255))
        throw new Error("Native combat default bytes do not match their source argument");
    }
  }
  if (seen.size !== required.length) throw new Error("Native combat declaration omits a required source field");
}
export function readNativeCombatCall(reader: SaveReader, operation: NativeCombatOperation, abi: NativeCallAbi): NativeCombatCall {
  const result: NativeCombatCall = { convention: reader.field("convention").choice("cdecl", "stdcall", "fastcall", "thiscall", "microsoft-x64"), arguments: reader.field("arguments").list(value => {
    const kind = value.field("kind").choice("field", "value", "address");
    if (kind === "field") return { kind, field: value.field("field").choice("target", "inflictor", "attacker", "direction", "point", "normal", "amount", "knockback", "flags", "cause", "sparks", "kick") };
    if (kind === "address") return { kind, address: value.field("address").nullable(address => ({ rva: nativeOffset(address.field("rva")), indirections: address.field("indirections").list(nativeOffset) })) };
    const source = value.field("layout");
    return { kind, layout: source.field("kind").choice("scalar", "aggregate") === "scalar" ? { kind: "scalar", storage: nativeScalar(source.field("storage")) }
      : { kind: "aggregate", layout: readLayout(source.field("layout")) }, bytes: value.field("bytes").list(byte => byte.integer(0)) };
  }) };
  validateNativeCombatCall(result, operation, abi); return result;
}
export function readNativeCombatField(cpu: GuestCpu, call: NativeCombatCall, signature: GuestCallSignature, field: NativeCombatField): GuestCallValue {
  const index = call.arguments.findIndex(argument => argument.kind === "field" && argument.field === field);
  return new X86AbiAdapter(signature.abi).argument(cpu, signature, index);
}
/** Only the semantic slots are projected; extra values belong to the exact intercepted invocation. */
export function readNativeCombatArguments(call: NativeCombatCall, operation: NativeCombatOperation, values: readonly GuestCallValue[], pointerBytes: 4 | 8): readonly GuestCallValue[] {
  if (values.length !== call.arguments.length) throw new Error("Native combat invocation differs from its declared signature");
  return fields(operation, pointerBytes).map(field => {
    const index = call.arguments.findIndex(argument => argument.kind === "field" && argument.field === field), value = values[index];
    if (value === undefined) throw new Error("Native combat invocation lacks a declared field");
    return value;
  });
}
export function lowerNativeCombatArguments(call: NativeCombatCall, operation: NativeCombatOperation, values: readonly GuestCallValue[],
  memory: MappedGuestMemory, image: GuestAddress | null, original?: readonly GuestCallValue[]): readonly GuestCallValue[] {
  const semantic = fields(operation, memory.pointerBytes);
  if (values.length !== semantic.length || original !== undefined && original.length !== call.arguments.length) throw new Error("Native combat continuation changed its argument extent");
  return call.arguments.map((argument, index) => {
    if (argument.kind === "field") {
      const value = values[semantic.indexOf(argument.field)]; if (value === undefined) throw new Error("Missing native combat field"); return value;
    }
    if (original !== undefined) { const value = original[index]; if (value === undefined) throw new Error("Missing captured native combat argument"); return value; }
    if (argument.kind === "value") return decodeValue(argument.layout, new Uint8Array(argument.bytes), memory);
    if (argument.address !== null && image === null) throw new Error("Native combat address default requires its source image base");
    let address = argument.address === null || image === null ? null : memory.offset(image, BigInt(argument.address.rva));
    for (const offset of argument.address?.indirections ?? []) {
      if (address === null) throw new Error("Native combat default address dereferences null");
      address = memory.readPointer(memory.offset(address, BigInt(offset)));
    }
    return { kind: "pointer", value: address };
  });
}
