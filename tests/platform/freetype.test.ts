// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { FreeTypeFontLibrary } from "../../src/platform/freetype.ts";
import { freeTypeBitmapLength, freeTypeLayout, freeTypeMetric, normalizeFreeTypeBitmapRows } from "../../src/platform/freetype-layout.ts";

/** Authored unhinted squares, 1024 units/em, 768-unit advance, Unicode format 12. */
function squareFont(corruptB = false, symbolCharmap = false): Uint8Array {
  const table = (length: number) => new DataView(new ArrayBuffer(length));
  const head = table(54), hhea = table(36), maxp = table(32), hmtx = table(12), loca = table(8), glyf = table(102);
  head.setUint32(0, 0x10000); head.setUint32(12, 0x5f0f3cf5); head.setUint16(18, 1024);
  head.setInt16(40, 640); head.setInt16(42, 640); head.setUint16(46, 8);
  hhea.setUint32(0, 0x10000); hhea.setInt16(4, 800); hhea.setInt16(6, -200);
  hhea.setUint16(10, 768); hhea.setInt16(16, 640); hhea.setInt16(18, 1); hhea.setUint16(34, 3);
  maxp.setUint32(0, 0x10000); maxp.setUint16(4, 3); maxp.setUint16(6, 4); maxp.setUint16(8, 1); maxp.setUint16(14, 1);
  for (let i = 0; i < 3; i++) {
    hmtx.setUint16(i * 4, 768); loca.setUint16(i * 2 + 2, (i + 1) * 17);
    const offset = i * 34;
    glyf.setInt16(offset, corruptB && i === 2 ? 32767 : 1);
    glyf.setInt16(offset + 6, 640); glyf.setInt16(offset + 8, 640); glyf.setUint16(offset + 10, 3);
    for (let point = 14; point < 18; point++) glyf.setUint8(offset + point, 1);
    glyf.setInt16(offset + 20, 640); glyf.setInt16(offset + 24, -640); glyf.setInt16(offset + 30, 640);
  }
  const codes = [65, 66, 233, 937, 0x1f642], cmap = table(28 + codes.length * 12);
  cmap.setUint16(2, 1); cmap.setUint16(4, 3); cmap.setUint16(6, symbolCharmap ? 0 : 10); cmap.setUint32(8, 12);
  cmap.setUint16(12, 12); cmap.setUint32(16, cmap.byteLength - 12); cmap.setUint32(24, codes.length);
  for (const [index, code] of codes.entries()) {
    const offset = 28 + index * 12;
    cmap.setUint32(offset, code); cmap.setUint32(offset + 4, code); cmap.setUint32(offset + 8, code === 66 ? 2 : 1);
  }
  const tables = new Map([['cmap', cmap], ['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', loca], ['maxp', maxp]]);
  const bytes = new Uint8Array(12 + tables.size * 16 + [...tables.values()].reduce((sum, view) => sum + Math.ceil(view.byteLength / 4) * 4, 0));
  const view = new DataView(bytes.buffer); view.setUint32(0, 0x10000); view.setUint16(4, tables.size);
  view.setUint16(6, 64); view.setUint16(8, 2); view.setUint16(10, 48);
  let index = 0, offset = 12 + tables.size * 16;
  for (const [tag, content] of tables) {
    const start = 12 + index++ * 16;
    bytes.set(new TextEncoder().encode(tag), start); view.setUint32(start + 8, offset); view.setUint32(start + 12, content.byteLength);
    bytes.set(new Uint8Array(content.buffer), offset); offset += Math.ceil(content.byteLength / 4) * 4;
  }
  return bytes;
}

function openLibrary(): FreeTypeFontLibrary {
  const opened = FreeTypeFontLibrary.open();
  if (opened.kind !== "ready") throw new Error(`Real FreeType is required for platform qualification: ${opened.kind}`,
    { cause: opened.kind === "unavailable" ? opened.cause : opened.error });
  return opened.library;
}

test("real FreeType preserves Q3 square metrics, pitch, Unicode mapping, and owned font memory", () => {
  const library = openLibrary();
  try {
    const input = squareFont(), face = library.createFace(input, 16);
    if (face === null) throw new Error("Authored font did not load");
    input.fill(0); Bun.gc(true);
    for (const code of [65, 233, 937, 0x1f642]) {
      expect(library.glyphIndex(face, code)).toBe(1);
      const glyph = library.renderGlyph(face, code);
      if (glyph === null) throw new Error("Authored glyph did not rasterize");
      expect({ width: glyph.width, height: glyph.height, pitch: glyph.pitch, top: glyph.top, bottom: glyph.bottom, xSkip: glyph.xSkip })
        .toEqual({ width: 10, height: 10, pitch: 12, top: 11, bottom: 0, xSkip: 13 });
      for (let row = 0; row < 10; row++) {
        expect([...glyph.pixels.subarray(row * 12, row * 12 + 10)]).toEqual(Array.from({ length: 10 }, () => 255));
        expect([...glyph.pixels.subarray(row * 12 + 10, (row + 1) * 12)]).toEqual([0, 0]);
      }
    }
    expect(library.glyphIndex(face, 0x10ffff)).toBe(0);
    expect(library.renderGlyph(face, 0x10ffff)?.pixels).toEqual(library.renderGlyph(face, 65)?.pixels);
  } finally { library.close(); }
});

test("native rendering copies raster bytes before slot reuse and preserves 26.6 advances", () => {
  const library = openLibrary();
  try {
    const face = library.createFace(squareFont(), 16);
    if (face === null) throw new Error("Authored font did not load");
    const first = library.renderBitmap(face, 65);
    if (first === null) throw new Error("Native bitmap did not rasterize");
    expect({ width: first.width, height: first.height, pitch: first.pitch, nativePitch: first.nativePitch,
      pixelMode: first.pixelMode, numGrays: first.numGrays, left: first.left, top: first.top,
      advanceX26: first.advanceX26, advanceY26: first.advanceY26 })
      .toEqual({ width: 10, height: 10, pitch: 10, nativePitch: 10, pixelMode: 2, numGrays: 256,
        left: 0, top: 10, advanceX26: 768, advanceY26: 0 });
    expect(first.pixels).toEqual(new Uint8Array(100).fill(255));
    first.pixels.fill(17);
    expect(library.renderBitmap(face, 66)?.pixels).toEqual(new Uint8Array(100).fill(255));
    expect(library.renderGlyph(face, 65)?.pitch).toBe(12);
    library.releaseFace(face); library.close(); Bun.gc(true);
    expect(first.pixels).toEqual(new Uint8Array(100).fill(17));
  } finally { library.close(); }
});

test("invalid fonts, charmap failures and broken glyph loads clean up and never return stale pixels", () => {
  const library = openLibrary(), messages: string[] = [], print = (text: string) => { messages.push(text); };
  try {
    expect(library.createFace(new Uint8Array(), 16, print)).toBeNull();
    expect(library.createFace(new Uint8Array(64), 16, print)).toBeNull();
    expect(library.createFace(squareFont(false, true), 16, print)).toBeNull();
    expect(library.createFace(squareFont(), 0x1ffffff, print)).toBeNull();
    expect(library.faceCount).toBe(0);
    const face = library.createFace(squareFont(true), 16, print);
    if (face === null) throw new Error("Font with damaged B glyph did not load");
    expect(library.renderGlyph(face, 65, print)?.height).toBe(10);
    expect(library.renderGlyph(face, 66, print)).toBeNull();
    expect(library.renderBitmap(face, 66, print)).toBeNull();
    expect(messages.some(text => text.includes("FT_Load_Glyph failed"))).toBe(true);
    expect(library.renderGlyph(face, 65, print)?.height).toBe(10);
    library.releaseFace(face);
    expect(library.faceCount).toBe(0);
  } finally { library.close(); }
});

test("authored bitmap font retains packed mono rows while the Q3 outline path rejects it", () => {
  const bdf = new TextEncoder().encode(`STARTFONT 2.1
FONT -misc-square-medium-r-normal--8-80-72-72-c-80-iso10646-1
SIZE 8 72 72
FONTBOUNDINGBOX 8 8 0 0
STARTPROPERTIES 4
FONT_ASCENT 8
FONT_DESCENT 0
CHARSET_REGISTRY "ISO10646"
CHARSET_ENCODING "1"
ENDPROPERTIES
CHARS 1
STARTCHAR A
ENCODING 65
SWIDTH 1000 0
DWIDTH 8 0
BBX 8 8 0 0
BITMAP
FF
81
81
81
81
81
81
FF
ENDCHAR
ENDFONT
`);
  const library = openLibrary(), messages: string[] = [];
  try {
    const face = library.createFace(bdf, 8, text => { messages.push(text); });
    if (face === null) throw new Error(`Authored BDF failed: ${messages.join("")}`);
    expect(library.renderGlyph(face, 65, text => { messages.push(text); })).toBeNull();
    expect(messages).toEqual(["Non-outline fonts are not supported\n"]);
    const glyph = library.renderBitmap(face, 65);
    if (glyph === null) throw new Error("Authored bitmap glyph failed");
    expect({ width: glyph.width, height: glyph.height, pitch: glyph.pitch, pixelMode: glyph.pixelMode })
      .toEqual({ width: 8, height: 8, pitch: 1, pixelMode: 1 });
    expect([...glyph.pixels]).toEqual([255, 129, 129, 129, 129, 129, 129, 255]);
  } finally { library.close(); }
});

test("released, forged and foreign face identities cannot reach native memory", () => {
  const library = openLibrary(), other = openLibrary();
  try {
    const face = library.createFace(squareFont(), 16);
    if (face === null) throw new Error("Authored font did not load");
    expect(() => other.renderGlyph(face, 65)).toThrow("not owned");
    expect(() => library.renderGlyph({ kind: "freetype-face" }, 65)).toThrow("not owned");
    for (const code of [-1, 0xd800, 0xdfff, 0x110000, 1.5, NaN, Infinity])
      expect(() => library.glyphIndex(face, code)).toThrow(RangeError);
    library.releaseFace(face);
    const replacement = library.createFace(squareFont(), 16);
    expect(replacement).not.toBeNull();
    expect(() => library.renderGlyph(face, 65)).toThrow("released");
    expect(() => library.releaseFace(face)).toThrow("released");
    library.close();
    expect(library.faceCount).toBe(0);
    expect(() => library.createFace(squareFont(), 16)).toThrow("closed");
    expect(() => library.renderGlyph(face, 65)).toThrow("closed");
  } finally { library.close(); other.close(); }
});

test("repeated library and face open/close releases both explicit and outstanding faces", () => {
  const bytes = squareFont();
  for (let iteration = 0; iteration < 25; iteration++) {
    const library = openLibrary();
    try {
      const first = library.createFace(bytes, 16), second = library.createFace(bytes, 24);
      if (first === null || second === null) throw new Error("Repeated native face allocation failed");
      expect(library.faceCount).toBe(2);
      expect(library.renderGlyph(second, 65)?.height).toBe(15);
      library.releaseFace(first);
      expect(library.faceCount).toBe(1);
    } finally { library.close(); library.close(); }
    expect(library.faceCount).toBe(0);
  }
});

test("native size input and bitmap allocation boundaries fail before unsafe native use", () => {
  const library = openLibrary();
  try {
    for (const size of [0, -1, 0.5, NaN, Infinity, 0x2000000])
      expect(() => library.createFace(squareFont(), size)).toThrow(RangeError);
    expect(library.faceCount).toBe(0);
  } finally { library.close(); }
  expect(freeTypeBitmapLength(9, 3, -2, 1)).toBe(6);
  expect(freeTypeBitmapLength(9, 3, 3, 3)).toBe(9);
  expect(freeTypeBitmapLength(9, 3, 5, 4)).toBe(15);
  expect(freeTypeBitmapLength(9, 3, 36, 7)).toBe(108);
  expect(freeTypeBitmapLength(0, 0, 0, 0)).toBe(0);
  expect(() => freeTypeBitmapLength(9, 3, 1, 1)).toThrow(RangeError);
  expect(() => freeTypeBitmapLength(10, 3, 9, 2)).toThrow(RangeError);
  expect(() => freeTypeBitmapLength(1, 0x7fffffff, 1, 2)).toThrow(RangeError);
  expect(() => freeTypeBitmapLength(1, 1, 4, 255)).toThrow(RangeError);
  expect(() => freeTypeBitmapLength(1, 1, 0, 0)).toThrow(RangeError);
});

test("FreeType record layouts gate ABI access and range-check long metrics", () => {
  const linux = freeTypeLayout("linux", "x64", "LE"), windows = freeTypeLayout("win32", "x64", "LE");
  if (linux === null || windows === null) throw new Error("Expected ABI layouts");
  expect(linux.faceGlyph).toBe(152); expect(windows.faceGlyph).toBe(120);
  expect(freeTypeLayout("linux", "arm64", "LE")).toEqual(linux);
  expect(freeTypeLayout("darwin", "arm64", "LE")).toEqual(linux);
  expect(freeTypeLayout("linux", "x64", "BE")).toBeNull();
  expect(freeTypeLayout("linux", "ia32", "LE")).toBeNull();
  expect(freeTypeLayout("win32", "arm64", "LE")).toBeNull();
  const view = new DataView(new ArrayBuffer(8));
  view.setBigInt64(0, -64n, true); expect(freeTypeMetric(view, 0, linux)).toBe(-64);
  expect(freeTypeMetric(view, 0, windows)).toBe(-64);
  view.setBigInt64(0, 2147483648n, true); expect(() => freeTypeMetric(view, 0, linux)).toThrow(RangeError);
});

test("negative native pitch reverses complete padded rows and validates storage bounds", () => {
  const rows = new Uint8Array([30, 31, 0, 20, 21, 0, 10, 11, 0]);
  normalizeFreeTypeBitmapRows(rows, 3, -3);
  expect([...rows]).toEqual([10, 11, 0, 20, 21, 0, 30, 31, 0]);
  normalizeFreeTypeBitmapRows(rows, 3, 3);
  expect([...rows]).toEqual([10, 11, 0, 20, 21, 0, 30, 31, 0]);
  expect(() => normalizeFreeTypeBitmapRows(rows, 4, -3)).toThrow(RangeError);
  expect(() => normalizeFreeTypeBitmapRows(rows, 3, NaN)).toThrow(RangeError);
  normalizeFreeTypeBitmapRows(new Uint8Array(), 0, 0);
});

const fontOverride = process.env['QUAKE_TEST_FONT'];
const localFont = fontOverride ?? [
  "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf",
].find(path => existsSync(path));

test.skipIf(localFont === undefined)("installed font rasterizes Latin and Greek and an empty space without vendoring assets", () => {
  if (localFont === undefined) throw new Error("No local font fixture");
  const library = openLibrary();
  try {
    const bytes = readFileSync(localFont), face = library.createFace(bytes, 24);
    if (face === null) throw new Error(`Local font failed to load: ${localFont}`);
    for (const code of [65, 233, 937]) {
      expect(library.glyphIndex(face, code)).toBeGreaterThan(0);
      const glyph = library.renderBitmap(face, code);
      if (glyph === null) throw new Error(`Local glyph failed: ${code}`);
      expect(glyph.width).toBeGreaterThan(0); expect(glyph.height).toBeGreaterThan(0);
      expect(glyph.pixels.some(value => value > 0)).toBe(true);
      expect(glyph.pixels.length).toBe(glyph.pitch * glyph.height);
    }
    const space = library.renderBitmap(face, 32);
    expect(space?.pixels.byteLength).toBe(0); expect(space?.advanceX26).toBeGreaterThan(0);
    expect(library.renderGlyph(face, 32)?.pixels.byteLength).toBe(0);
  } finally { library.close(); }
});
