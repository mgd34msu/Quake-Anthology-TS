import { expect, test } from "bun:test";
import { decodeCheckpointValue, encodeCheckpointValue } from "../../src/persistence/value.ts";

function tagged(encoded: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ $qts: "bytes", value: encoded }));
}

test("large canonical checkpoint bytes survive the writer and decoder", () => {
  for (const length of [5_051_959, 5_051_960, 5_051_961]) {
    const input = Uint8Array.from({ length }, (_, index) => index % 256);
    const output = decodeCheckpointValue(encodeCheckpointValue({ bytes: input }));
    if (output === null || typeof output !== "object" || !("bytes" in output) || !(output.bytes instanceof Uint8Array)) {
      throw new Error("Decoded checkpoint has no byte array");
    }
    expect(output.bytes.length).toBe(length);
    expect(Buffer.compare(input, output.bytes)).toBe(0);
  }
});

test("tagged bytes require canonical alphabet, complete groups and padding", () => {
  for (const encoded of ["A", "AA", "AAA", "=", "====", "A===", "AA=A", "AA==AA==", "AA===", "AAAA=", "AA-_", "AA\u00ff", "AA==\n", "AAAA\r\n", " AAAA", "AAAA ", "AAAA\u0000"]) {
    expect(() => decodeCheckpointValue(tagged(encoded))).toThrow("unknown tagged checkpoint value");
  }
  for (const encoded of ["", "AA==", "/w==", "AAA=", "//8=", "AAAA", "////", "+/+/"]) {
    const output = decodeCheckpointValue(tagged(encoded));
    if (!(output instanceof Uint8Array)) throw new Error("Expected decoded bytes");
    expect(Buffer.from(output).toString("base64")).toBe(encoded);
  }
});

test("tagged bytes reject every nonzero unused tail-bit alternative", () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let digit = 0; digit < alphabet.length; digit++) {
    const character = alphabet.charAt(digit);
    const oneByte = `A${character}==`, twoBytes = `AA${character}=`;
    if ((digit & 15) !== 0) expect(() => decodeCheckpointValue(tagged(oneByte))).toThrow("unknown tagged checkpoint value");
    else expect(decodeCheckpointValue(tagged(oneByte))).toBeInstanceOf(Uint8Array);
    if ((digit & 3) !== 0) expect(() => decodeCheckpointValue(tagged(twoBytes))).toThrow("unknown tagged checkpoint value");
    else expect(decodeCheckpointValue(tagged(twoBytes))).toBeInstanceOf(Uint8Array);
  }
});

test("large tagged bytes still reject malformed trailing data", () => {
  const prefix = "AAAA".repeat(1_700_000);
  for (const suffix of ["AA#A", "AA=A", "AB==", "AAB=", "AAAA\n"]) {
    expect(() => decodeCheckpointValue(tagged(prefix + suffix))).toThrow("unknown tagged checkpoint value");
  }
});
