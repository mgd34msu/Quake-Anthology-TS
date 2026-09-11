import { BinaryReader, BinaryWriter } from "../core/binary/index.ts";
import { SaveFormatError } from "./value.ts";

export function byteText(bytes: Uint8Array): string { return Array.from(bytes, byte => String.fromCharCode(byte)).join(""); }
export function textBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const byte = text.charCodeAt(index);
    if (byte > 255) throw new SaveFormatError("text", "source save requires byte characters");
    bytes[index] = byte;
  }
  return bytes;
}
export function readCString(reader: BinaryReader): string {
  const bytes: number[] = [];
  for (;;) { const byte = reader.u8(); if (byte === 0) break; bytes.push(byte); }
  return byteText(new Uint8Array(bytes));
}
export function writeCString(writer: BinaryWriter, value: string): void {
  if (value.includes("\0")) throw new SaveFormatError("text", "source string contains an interior NUL");
  writer.bytes(textBytes(value)); writer.u8(0);
}
export function readFixed(reader: BinaryReader, width: number): string {
  const bytes = reader.bytes(width); const end = bytes.indexOf(0);
  return byteText(end < 0 ? bytes : bytes.subarray(0, end));
}
export function writeFixed(writer: BinaryWriter, value: string, width: number): void {
  if (value.includes("\0") || value.length >= width) throw new SaveFormatError("text", `source string must fit ${width - 1} bytes`);
  const bytes = new Uint8Array(width); bytes.set(textBytes(value)); writer.bytes(bytes);
}
