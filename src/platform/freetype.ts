// SPDX-License-Identifier: GPL-2.0-or-later
// Outline raster metrics follow id Software's code/renderer/tr_font.c.
// FreeType ABI: little-endian 64-bit LP64 and Windows x64 LLP64.
import { dlopen, ptr } from "bun:ffi";
import { endianness } from "node:os";
import { freeTypeBitmapLength, freeTypeLayout, freeTypeMetric, normalizeFreeTypeBitmapRows } from "./freetype-layout.ts";
import type { FreeTypeLayout } from "./freetype-layout.ts";
import { openNativeLibrary } from "./native-libraries.ts";

function loadFreeType(layout: FreeTypeLayout) {
  return openNativeLibrary("freetype", path => dlopen(path, {
    FT_Init_FreeType: { args: ["buffer"], returns: "i32" },
    FT_Done_FreeType: { args: ["u64"], returns: "i32" },
    FT_New_Memory_Face: { args: ["u64", "buffer", layout.signedLong, layout.signedLong, "buffer"], returns: "i32" },
    FT_Done_Face: { args: ["u64"], returns: "i32" },
    FT_Set_Char_Size: { args: ["u64", layout.signedLong, layout.signedLong, "u32", "u32"], returns: "i32" },
    FT_Select_Charmap: { args: ["u64", "u32"], returns: "i32" },
    FT_Get_Char_Index: { args: ["u64", layout.unsignedLong], returns: "u32" },
    FT_Load_Glyph: { args: ["u64", "u32", "i32"], returns: "i32" },
    FT_Render_Glyph: { args: ["u64", "i32"], returns: "i32" },
    FT_Outline_Translate: { args: ["u64", layout.signedLong, layout.signedLong], returns: "void" },
    FT_Outline_Get_Bitmap: { args: ["u64", "u64", "buffer"], returns: "i32" },
  }));
}

function loadMemory() {
  // Pointer out parameters stay uint64. memcpy avoids an unchecked Bun Pointer
  // cast; all supported ABIs pass pointers and uint64 in integer registers.
  return dlopen(process.platform === "win32" ? "msvcrt.dll"
    : process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
  { memcpy: { args: ["buffer", "u64", "u64"], returns: "ptr" } });
}

export class FreeTypeError extends Error {
  constructor(readonly operation: string, readonly code: number) {
    super(`${operation} failed with FreeType error ${code}`);
    this.name = "FreeTypeError";
  }
}

/** Identity is checked against the owning library; native addresses stay private. */
export interface FreeTypeFace { readonly kind: "freetype-face" }
interface FaceRecord { readonly address: bigint; readonly bytes: Uint8Array }

export interface FontGlyphBitmap {
  readonly width: number;
  readonly height: number;
  readonly pitch: number;
  readonly top: number;
  readonly bottom: number;
  readonly xSkip: number;
  readonly pixels: Uint8Array;
}

export interface NativeFontGlyphBitmap {
  readonly width: number;
  readonly height: number;
  /** Owned pixels run top to bottom, with this positive row stride. */
  readonly pitch: number;
  readonly nativePitch: number;
  readonly pixelMode: number;
  readonly numGrays: number;
  readonly left: number;
  readonly top: number;
  readonly advanceX26: number;
  readonly advanceY26: number;
  readonly pixels: Uint8Array;
}

export type FreeTypeInitialization = { readonly kind: "unavailable"; readonly cause: unknown }
  | { readonly kind: "failed"; readonly error: FreeTypeError }
  | { readonly kind: "ready"; readonly library: FreeTypeFontLibrary };

/** Owns font bytes and native faces until release or library close. */
export class FreeTypeFontLibrary {
  private handle: bigint;
  private readonly faces = new Map<FreeTypeFace, FaceRecord>();

  private constructor(private readonly library: ReturnType<typeof loadFreeType>,
    private readonly memory: ReturnType<typeof loadMemory>, private readonly layout: FreeTypeLayout,
    handle: bigint) { this.handle = handle; }

  static open(print: (text: string) => void = () => undefined): FreeTypeInitialization {
    const layout = freeTypeLayout(process.platform, process.arch, endianness());
    if (layout === null) return { kind: "unavailable", cause: new Error("Unsupported FreeType ABI") };
    let library: ReturnType<typeof loadFreeType>;
    try { library = loadFreeType(layout); } catch (cause) { return { kind: "unavailable", cause }; }
    let memory: ReturnType<typeof loadMemory>;
    try { memory = loadMemory(); } catch (cause) { library.close(); return { kind: "unavailable", cause }; }
    const result = new Uint8Array(8);
    const code = library.symbols.FT_Init_FreeType(result);
    if (code !== 0) {
      memory.close(); library.close();
      print("R_InitFreeType: Unable to initialize FreeType.\n");
      return { kind: "failed", error: new FreeTypeError("FT_Init_FreeType", code) };
    }
    const handle = new DataView(result.buffer).getBigUint64(0, true);
    if (handle === 0n) { memory.close(); library.close(); throw new Error("FreeType initialized a null library"); }
    return { kind: "ready", library: new FreeTypeFontLibrary(library, memory, layout, handle) };
  }

  get faceCount(): number { return this.faces.size; }

  createFace(bytes: Uint8Array, size: number, print: (text: string) => void = () => undefined): FreeTypeFace | null {
    this.requireOpen();
    if (!Number.isInteger(size) || size <= 0 || size > 0x1ffffff) throw new RangeError("FreeType size must be a positive int32 26.6 pixel size");
    if (bytes.length > 0x7fffffff) throw new RangeError("FreeType font exceeds signed long length");
    if (bytes.length === 0) { print("RE_RegisterFont: FreeType2, unable to allocate new face.\n"); return null; }
    const ownedBytes = new Uint8Array(bytes);
    const result = new Uint8Array(8);
    const api = this.library.symbols;
    const code = api.FT_New_Memory_Face(this.handle, ownedBytes, ownedBytes.length, 0, result);
    if (code !== 0) { print("RE_RegisterFont: FreeType2, unable to allocate new face.\n"); return null; }
    const address = new DataView(result.buffer).getBigUint64(0, true);
    if (address === 0n) throw new Error("FreeType created a null face");
    const face: FreeTypeFace = Object.freeze({ kind: "freetype-face" });
    this.faces.set(face, { address, bytes: ownedBytes });
    // Unicode is selected explicitly so code points never use a symbol charmap.
    const charmapError = api.FT_Select_Charmap(address, 0x756e6963);
    const sizeError = charmapError === 0 ? api.FT_Set_Char_Size(address, size * 64, size * 64, 72, 72) : 0;
    if (charmapError !== 0 || sizeError !== 0) {
      this.releaseFace(face);
      print(charmapError !== 0 ? `FreeType Unicode charmap unavailable (${charmapError}).\n`
        : "RE_RegisterFont: FreeType2, Unable to set face char size.\n");
      return null;
    }
    return face;
  }

  glyphIndex(face: FreeTypeFace, code: number): number {
    const record = this.requireFace(face);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff)
      throw new RangeError("FreeType code point must be a Unicode scalar value");
    return this.library.symbols.FT_Get_Char_Index(record.address, code);
  }

  /** Q3 outline raster contract, including padded pitch and source top/xSkip. */
  renderGlyph(face: FreeTypeFace, code: number, print: (text: string) => void = () => undefined): FontGlyphBitmap | null {
    const slot = this.loadGlyph(face, code, print);
    if (slot === null) return null;
    const glyph = this.read(slot, this.layout.slotFormat + 4);
    if (glyph.getUint32(this.layout.slotFormat, true) !== 0x6f75746c) {
      print("Non-outline fonts are not supported\n"); return null;
    }
    const width26 = this.metric(glyph, 0), height26 = this.metric(glyph, 1);
    const bearingX = this.metric(glyph, 2), bearingY = this.metric(glyph, 3);
    const left = Math.floor(bearingX / 64) * 64, right = Math.ceil((bearingX + width26) / 64) * 64;
    const top = Math.ceil(bearingY / 64) * 64, bottom = Math.floor((bearingY - height26) / 64) * 64;
    if (width26 < 0 || height26 < 0 || -left < -2147483648 || -left > 2147483647
      || -bottom < -2147483648 || -bottom > 2147483647)
      throw new RangeError("FreeType outline translation exceeds source int32");
    const width = (right - left) / 64, height = (top - bottom) / 64, pitch = Math.ceil(width / 4) * 4;
    const length = freeTypeBitmapLength(width, height, pitch, 2);
    const pixels = new Uint8Array(Math.max(1, length));
    const bitmap = new Uint8Array(40), view = new DataView(bitmap.buffer);
    view.setUint32(0, height, true); view.setUint32(4, width, true); view.setInt32(8, pitch, true);
    view.setBigUint64(16, BigInt(ptr(pixels)), true); view.setUint16(24, 256, true); view.setUint8(26, 2);
    const outline = slot + BigInt(this.layout.slotOutline), api = this.library.symbols;
    api.FT_Outline_Translate(outline, -left, -bottom);
    const error = length === 0 ? 0 : api.FT_Outline_Get_Bitmap(this.handle, outline, bitmap);
    if (error !== 0) { print(`FT_Outline_Get_Bitmap failed (${error}).\n`); return null; }
    return { width, height, pitch, top: Math.floor(bearingY / 64) + 1, bottom,
      xSkip: Math.floor(this.metric(glyph, 4) / 64) + 1, pixels: pixels.subarray(0, length) };
  }

  /** FreeType's normal renderer; copy rows before the reusable slot changes. */
  renderBitmap(face: FreeTypeFace, code: number, print: (text: string) => void = () => undefined): NativeFontGlyphBitmap | null {
    const slot = this.loadGlyph(face, code, print);
    if (slot === null) return null;
    const error = this.library.symbols.FT_Render_Glyph(slot, 0);
    if (error !== 0) { print(`FT_Render_Glyph failed (${error}).\n`); return null; }
    const record = this.read(slot, this.layout.slotOutline), offset = this.layout.slotBitmap;
    const height = record.getUint32(offset, true), width = record.getUint32(offset + 4, true);
    const nativePitch = record.getInt32(offset + 8, true), pitch = Math.abs(nativePitch);
    const pixelMode = record.getUint8(offset + 26), numGrays = record.getUint16(offset + 24, true);
    const length = freeTypeBitmapLength(width, height, nativePitch, pixelMode);
    const pixels = new Uint8Array(length), address = record.getBigUint64(offset + 16, true);
    if (length !== 0) {
      const start = nativePitch < 0 ? address + BigInt((height - 1) * nativePitch) : address;
      this.copy(pixels, start);
      normalizeFreeTypeBitmapRows(pixels, height, nativePitch);
    }
    const advance = this.layout.slotFormat - 2 * this.layout.longBytes;
    return { width, height, pitch, nativePitch, pixelMode, numGrays,
      left: record.getInt32(offset + 40, true), top: record.getInt32(offset + 44, true),
      advanceX26: freeTypeMetric(record, advance, this.layout),
      advanceY26: freeTypeMetric(record, advance + this.layout.longBytes, this.layout), pixels };
  }

  releaseFace(face: FreeTypeFace): void {
    const record = this.requireFace(face);
    const error = this.library.symbols.FT_Done_Face(record.address);
    this.faces.delete(face);
    if (error !== 0) throw new FreeTypeError("FT_Done_Face", error);
  }

  close(): void {
    if (this.handle === 0n) return;
    const errors: FreeTypeError[] = [];
    for (const record of this.faces.values()) {
      const code = this.library.symbols.FT_Done_Face(record.address);
      if (code !== 0) errors.push(new FreeTypeError("FT_Done_Face", code));
    }
    const code = this.library.symbols.FT_Done_FreeType(this.handle);
    if (code !== 0) errors.push(new FreeTypeError("FT_Done_FreeType", code));
    this.handle = 0n; this.faces.clear(); this.library.close(); this.memory.close();
    if (errors.length !== 0) throw new AggregateError(errors, "FreeType cleanup failed");
  }

  private requireOpen(): void { if (this.handle === 0n) throw new Error("FreeType library is closed"); }
  private requireFace(face: FreeTypeFace): FaceRecord {
    this.requireOpen();
    const record = this.faces.get(face);
    if (record === undefined) throw new Error("FreeType face is not owned by this library or was released");
    return record;
  }
  private loadGlyph(face: FreeTypeFace, code: number, print: (text: string) => void): bigint | null {
    const index = this.glyphIndex(face, code), record = this.requireFace(face);
    const error = this.library.symbols.FT_Load_Glyph(record.address, index, 0);
    if (error !== 0) { print(`FT_Load_Glyph failed (${error}).\n`); return null; }
    const view = this.read(record.address, this.layout.faceGlyph + 8);
    const slot = view.getBigUint64(this.layout.faceGlyph, true);
    if (slot === 0n) throw new Error("FreeType face has no glyph slot");
    return slot;
  }
  private copy(bytes: Uint8Array, address: bigint): void {
    if (address <= 0n || address + BigInt(bytes.length) > 0xffffffffffffffffn)
      throw new RangeError("Invalid FreeType native memory range");
    if (bytes.length !== 0) this.memory.symbols.memcpy(bytes, address, bytes.length);
  }
  private read(address: bigint, length: number): DataView {
    const bytes = new Uint8Array(length);
    this.copy(bytes, address);
    return new DataView(bytes.buffer);
  }
  private metric(view: DataView, index: number): number {
    return freeTypeMetric(view, 48 + index * this.layout.longBytes, this.layout);
  }
}
