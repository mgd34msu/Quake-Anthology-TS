import type { NativeAbi, GuestValueLayout } from "../../contracts/execution.ts";
import type { NativeModScalar } from "../../contracts/native-mod-callbacks.ts";
import type { NativeItemField, NativeItemTest } from "../../contracts/native-mod-items.ts";
import type { GuestCallSignature, GuestRegister } from "../../guest/core/contracts.ts";
import { SaveReader } from "../../persistence/value.ts";

export function nativeOffset(reader: SaveReader): number { const value = reader.integer(0); if (value > 0xffffffff) reader.fail("native offset exceeds PE address space"); return value; }
export function nativeRegion(reader: SaveReader): { readonly entry: number; readonly join: number } {
  const entry = nativeOffset(reader.field("entry")), join = nativeOffset(reader.field("join"));
  if (entry === join) reader.fail("source region must contain instructions");
  return { entry, join };
}
export function nativeScalar(reader: SaveReader): NativeModScalar { return reader.choice("int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64", "float32", "float64"); }
export function nativeRegister(reader: SaveReader): GuestRegister { return reader.choice("rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi", "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15"); }
export function nativeField(reader: SaveReader): NativeItemField {
  return { record: reader.field("record").choice("entity", "client", "image"), offset: nativeOffset(reader.field("offset")), encoding: nativeScalar(reader.field("encoding")) };
}
export function nativeTest(reader: SaveReader): NativeItemTest {
  if (reader.field("kind").choice("scalar", "pointer") === "pointer") {
    const field = reader.field("field");
    return { kind: "pointer", field: { record: field.field("record").choice("entity", "client", "image"), offset: nativeOffset(field.field("offset")) },
      value: reader.field("value").nullable(value => ({ rva: nativeOffset(value.field("rva")), indirections: value.field("indirections").list(nativeOffset) })) };
  }
  return { kind: "scalar", field: nativeField(reader.field("field")), mask: reader.field("mask").nullable(nativeOffset),
    comparison: reader.field("comparison").choice("equals", "at-most"), value: reader.field("value").finite() };
}
export function nativeAbi(reader: SaveReader, expected: NativeAbi): NativeAbi {
  reader.field("kind").literal(expected.kind); reader.field("image").literal(expected.image);
  reader.field("call").literal(expected.call); reader.field("pointerBytes").literal(expected.pointerBytes); return expected;
}
export function nativeSignature(reader: SaveReader, abi: NativeAbi): GuestCallSignature {
  const value = (reader: SaveReader): GuestValueLayout => {
    reader.field("kind").literal("scalar");
    return { kind: "scalar", storage: reader.field("storage").value === "pointer" ? "pointer" : nativeScalar(reader.field("storage")) };
  };
  return { abi: nativeAbi(reader.field("abi"), abi), parameters: reader.field("parameters").list(value),
    result: reader.field("result").value === "void" ? "void" : value(reader.field("result")), variadic: reader.field("variadic").literal(false) };
}
