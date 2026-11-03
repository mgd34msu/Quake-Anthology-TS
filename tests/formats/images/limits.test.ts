// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, test } from "bun:test";
import { decodeGif } from "../../../src/formats/images/gif.ts";
import { decodeJpeg } from "../../../src/formats/images/jpeg.ts";
import { encodeJpeg } from "../../../src/formats/images/jpeg-encoder.ts";
import { decodeTga } from "../../../src/formats/images/tga.ts";

function patchedJpeg(width: number, height: number): Uint8Array {
  const bytes = encodeJpeg({ width: 16, height: 16, pixels: new Uint8Array(16 * 16 * 4).fill(128) }, 80).slice();
  for (let i = 0; i + 9 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0) {
      bytes[i + 5] = height >> 8;
      bytes[i + 6] = height & 255;
      bytes[i + 7] = width >> 8;
      bytes[i + 8] = width & 255;
      return bytes;
    }
  }
  throw new Error("No SOF0 marker in encoder output");
}

describe("hostile image headers are rejected before allocation", () => {
  test("a tiny JPEG declaring a huge frame fails fast", () => {
    const started = performance.now();
    expect(() => decodeJpeg(patchedJpeg(40000, 40000))).toThrow();
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("a tiny JPEG whose entropy data ends far short of its frame is rejected", () => {
    expect(() => decodeJpeg(patchedJpeg(6000, 6000))).toThrow();
  });

  test("a TGA header with a 65535x65535 canvas is rejected", () => {
    const header = new Uint8Array(18);
    header[2] = 2;
    header[12] = 255;
    header[13] = 255;
    header[14] = 255;
    header[15] = 255;
    header[16] = 32;
    expect(() => decodeTga(header)).toThrow();
  });

  test("a GIF with unbounded frames on a large canvas is rejected", () => {
    const parts: number[] = [...new TextEncoder().encode("GIF89a"), 0, 4, 0, 4, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
    for (let i = 0; i < 5000; i++) parts.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0);
    parts.push(0x3b);
    expect(() => decodeGif(new Uint8Array(parts))).toThrow();
  });
});
