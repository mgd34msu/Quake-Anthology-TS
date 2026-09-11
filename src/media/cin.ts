/* Quake II cl_cin.c, order-1 Huffman CIN decoding.
 * Copyright (C) 1997-2001 Id Software, Inc. GPL-2.0-or-later. */
import { BinaryError, BinaryReader } from "../core/binary/index.ts";
import { mediaBytes, readMedia, type MediaInput } from "./source.ts";

export interface CinAudioFormat { readonly sampleRate: number; readonly channels: 1 | 2; readonly sampleBytes: 1 | 2; }
export interface CinAudio {
  readonly samples: Int16Array | Uint8Array;
  readonly channels: 1 | 2;
  readonly sampleRate: number;
  readonly sourceSample: number;
}
export interface CinFrame {
  readonly kind: "frame";
  readonly index: number;
  readonly time: number;
  readonly pixels: Uint8Array;
  readonly palette: Uint8Array;
  readonly audio: CinAudio | null;
}

/** C's integer division partitions rates that are not divisible by fourteen. */
export function cinSampleRange(frame: number, sampleRate: number): { readonly start: number; readonly end: number } {
  if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isSafeInteger(sampleRate) || sampleRate < 0
    || !Number.isSafeInteger((frame + 1) * sampleRate)) throw new RangeError("Invalid CIN sample position");
  return { start: Math.trunc(frame * sampleRate / 14), end: Math.trunc((frame + 1) * sampleRate / 14) };
}

export class CinHuffman {
  private readonly nodes = new Int32Array(256 * 256 * 2);
  private readonly roots = new Int32Array(256);

  constructor(counts: Uint8Array, readonly source = "<CIN Huffman>") {
    if (counts.length !== 65536) throw new BinaryError(source, 0, "CIN requires 65536 Huffman counts");
    const weights = new Int32Array(512);
    const used = new Uint8Array(512);
    const weight = (index: number): number => weights[index] ?? 0;
    const smallest = (limit: number): number => {
      let best = 99999999, selected = -1;
      for (let index = 0; index < limit; index++) {
        const count = weight(index);
        if (used[index] === 0 && count !== 0 && count < best) { best = count; selected = index; }
      }
      if (selected !== -1) used[selected] = 1;
      return selected;
    };
    for (let context = 0; context < 256; context++) {
      weights.fill(0); used.fill(0);
      weights.set(counts.subarray(context * 256, (context + 1) * 256));
      let count = 256;
      while (count !== 511) {
        const left = smallest(count);
        if (left === -1) break;
        const right = smallest(count);
        if (right === -1) break;
        const offset = context * 512 + (count - 256) * 2;
        this.nodes[offset] = left; this.nodes[offset + 1] = right;
        weights[count] = weight(left) + weight(right);
        count++;
      }
      this.roots[context] = count - 1;
    }
  }

  decode(compressed: Uint8Array, expectedPixels: number): Uint8Array {
    const reader = new BinaryReader(compressed, this.source);
    const count = reader.i32();
    if (count !== expectedPixels) throw new BinaryError(this.source, 0, `CIN frame has ${count} pixels, expected ${expectedPixels}`);
    const output = new Uint8Array(count);
    let context = 0, value = 0, bits = 0;
    for (let index = 0; index < count; index++) {
      const root = this.roots[context];
      if (root === undefined) throw new BinaryError(this.source, reader.offset, "invalid CIN Huffman context");
      let node: number = root;
      while (node >= 256) {
        if (bits === 0) { value = reader.u8(); bits = 8; }
        const child = this.nodes[context * 512 + (node - 256) * 2 + (value & 1)];
        if (child === undefined || child < 0 || child >= node) throw new BinaryError(this.source, reader.offset, "invalid CIN Huffman branch");
        node = child; value >>>= 1; bits--;
      }
      output[index] = node;
      context = node;
    }
    return output;
  }
}

export class CinDecoder {
  readonly width: number;
  readonly height: number;
  readonly frameRate = 14;
  readonly audioFormat: CinAudioFormat | null;
  private readonly input: MediaInput;
  private readonly huffman: CinHuffman;
  private readonly colors = new Uint8Array(768);
  private offset = 20 + 65536;
  private frameIndex = 0;
  private ended = false;
  private closed = false;

  constructor(input: Uint8Array | MediaInput, source = "<CIN>") {
    this.input = input instanceof Uint8Array ? mediaBytes(input, source) : input;
    try {
      const header = new BinaryReader(readMedia(this.input, 0, 20), this.input.source);
      this.width = header.i32(); this.height = header.i32();
      const sampleRate = header.i32(), sampleBytes = header.i32(), channels = header.i32();
      if (this.width <= 0 || this.height <= 0 || this.width * this.height > 0x1000000) throw new BinaryError(this.input.source, 0, "invalid CIN dimensions");
      if (sampleRate === 0 && sampleBytes === 0 && channels === 0) this.audioFormat = null;
      else if (sampleRate > 0 && (sampleBytes === 1 || sampleBytes === 2) && (channels === 1 || channels === 2)) {
        this.audioFormat = { sampleRate, sampleBytes, channels };
      } else throw new BinaryError(this.input.source, 8, "invalid CIN audio format");
      this.huffman = new CinHuffman(readMedia(this.input, 20, 65536), this.input.source);
    } catch (error: unknown) { this.input.close(); throw error; }
  }

  get palette(): Uint8Array { return this.colors.slice(); }
  get nextFrameIndex(): number { return this.frameIndex; }

  private read(length: number): Uint8Array {
    const bytes = readMedia(this.input, this.offset, length);
    this.offset += length;
    return bytes;
  }

  next(): CinFrame | { readonly kind: "end" } {
    if (this.closed) throw new Error("CIN decoder is closed");
    if (this.ended) return { kind: "end" };
    const command = new BinaryReader(this.read(4), this.input.source).i32();
    if (command === 2) { this.ended = true; return { kind: "end" }; }
    if (command === 1) this.colors.set(this.read(768));
    const size = new BinaryReader(this.read(4), this.input.source).i32();
    if (size < 4 || size > 0x20000) throw new BinaryError(this.input.source, this.offset - 4, "bad CIN compressed frame size");
    const compressed = this.read(size);
    let audio: CinAudio | null = null;
    if (this.audioFormat !== null) {
      const { sampleRate, sampleBytes, channels } = this.audioFormat;
      const { start, end } = cinSampleRange(this.frameIndex, sampleRate);
      const bytes = this.read((end - start) * sampleBytes * channels);
      let samples: Uint8Array | Int16Array = bytes;
      if (sampleBytes === 2) {
        const reader = new BinaryReader(bytes, this.input.source);
        const signed = new Int16Array(bytes.length / 2);
        for (let index = 0; index < signed.length; index++) signed[index] = reader.i16();
        samples = signed;
      }
      audio = { samples, sampleRate, channels, sourceSample: start };
    }
    const pixels = this.huffman.decode(compressed, this.width * this.height);
    const index = this.frameIndex++;
    return { kind: "frame", index, time: index * 1000 / 14, pixels, palette: this.palette, audio };
  }

  rewind(): void {
    if (this.closed) throw new Error("CIN decoder is closed");
    this.offset = 20 + 65536; this.frameIndex = 0; this.ended = false; this.colors.fill(0);
  }

  close(): void { if (!this.closed) { this.closed = true; this.input.close(); } }
}

export function cinRgba(pixels: Uint8Array, palette: Uint8Array): Uint8Array {
  if (palette.length !== 768) throw new RangeError("CIN palette requires 256 RGB colors");
  const colors = new DataView(palette.buffer, palette.byteOffset, palette.byteLength);
  const rgba = new Uint8Array(pixels.length * 4);
  for (let index = 0; index < pixels.length; index++) {
    const pixel = pixels[index];
    if (pixel === undefined) throw new RangeError("CIN pixel index is missing");
    rgba[index * 4] = colors.getUint8(pixel * 3);
    rgba[index * 4 + 1] = colors.getUint8(pixel * 3 + 1);
    rgba[index * 4 + 2] = colors.getUint8(pixel * 3 + 2);
    rgba[index * 4 + 3] = 255;
  }
  return rgba;
}
