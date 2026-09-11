import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openArchive } from "../../src/content/archive/index.ts";
import { buildFontAtlas, parseFont, rasterizeColorGlyph, rasterizeContours, rasterizeGlyph } from "../../src/text/truetype.ts";
import type { ParsedFontT } from "../../src/text/truetype.ts";

const pakPath = new URL("../../../qfiles/q1/rerelease/QuakeEX.kpf", import.meta.url).pathname;

async function realFont(name: string): Promise<ParsedFontT> {
    const archive = await openArchive(pakPath);
    try {
        const entry = archive.findEntries(`fonts/${name}`)[0];
        if (entry === undefined) throw new Error(`Missing font ${name}`);
        const result = parseFont(await archive.readEntry(entry));
        if (!result.ok) throw new Error(result.reason);
        return result.font;
    } finally { archive.close(); }
}

test.skipIf(!existsSync(pakPath))("real TrueType composite accents survive parsing and atlas packing", async () => {
    const font = await realFont("RobotoMono-Regular.ttf");
    expect(font.outlineFormat).toBe("glyf");
    const base = font.cmapLookup(0x6f);
    const accented = font.cmapLookup(0xf6);
    expect(accented).toBeGreaterThan(0);
    expect(font.contours(accented).length).toBeGreaterThan(font.contours(base).length);
    const glyph = rasterizeGlyph(font, accented, 24);
    expect(glyph.coverage.some(alpha => alpha > 0)).toBe(true);
    const atlas = buildFontAtlas(font, [0x41, 0xf6, 0xe9], 24, 8);
    expect(atlas.glyphs.size).toBe(3);
    expect(atlas.pixels.length).toBe(atlas.width * atlas.height * 4);
    for (const region of atlas.glyphs.values()) {
        expect(region.color).toBe(false);
        expect(region.x + region.w).toBeLessThan(atlas.width);
        expect(region.y + region.h).toBeLessThan(atlas.height);
    }
});

test.skipIf(!existsSync(pakPath))("real CFF and CID fonts retain subroutine outlines", async () => {
    for (const [name, codepoint] of [
        ["AtkinsonHyperLegible-Regular.otf", 0x41],
        ["NotoSansJP-Regular.otf", 0x65e5],
    ] satisfies readonly (readonly [string, number])[]) {
        const font = await realFont(name);
        expect(font.outlineFormat).toBe("cff");
        const gid = font.cmapLookup(codepoint);
        expect(gid).toBeGreaterThan(0);
        expect(font.contours(gid).length).toBeGreaterThan(0);
        const glyph = rasterizeGlyph(font, gid, 24);
        expect(glyph.coverage.some(alpha => alpha > 0)).toBe(true);
        expect(glyph.coverage.some(alpha => alpha > 0 && alpha < 255)).toBe(true);
    }
});

test.skipIf(!existsSync(pakPath))("real COLR/CPAL controller glyphs render colored atlas regions", async () => {
    const font = await realFont("KexControllerIconsDS4.ttf");
    const gid = font.cmapLookup(0xf0000);
    expect(font.contours(gid).length).toBe(0);
    expect(font.colorLayers(gid)?.length).toBeGreaterThan(1);
    const glyph = rasterizeColorGlyph(font, gid, 24);
    if (glyph === null) throw new Error("Missing controller glyph layers");
    const colors = new Set<string>();
    for (let offset = 0; offset < glyph.pixels.length; offset += 4) {
        const alpha = glyph.pixels[offset + 3];
        if (alpha !== undefined && alpha > 0) colors.add(`${glyph.pixels[offset]},${glyph.pixels[offset + 1]},${glyph.pixels[offset + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(1);
    const atlas = buildFontAtlas(font, [0xf0000, 0xf0001], 24);
    expect(atlas.glyphs.get(0xf0000)?.color).toBe(true);
    expect(atlas.glyphs.get(0xf0001)?.color).toBe(true);
});

test("font boundary failures and fractional scanline coverage stay explicit", () => {
    expect(parseFont(new Uint8Array(3)).ok).toBe(false);
    const truncated = new Uint8Array(28);
    const view = new DataView(truncated.buffer);
    view.setUint32(0, 0x00010000); view.setUint16(4, 1);
    truncated.set(new TextEncoder().encode("head"), 12);
    view.setUint32(20, 28); view.setUint32(24, 54);
    expect(parseFont(truncated).ok).toBe(false);
    const glyph = rasterizeContours([[{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }]], 1, 1);
    expect(glyph.coverage).toEqual(new Uint8Array([128]));
});
