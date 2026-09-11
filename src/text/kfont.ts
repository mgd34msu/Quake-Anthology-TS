// SPDX-License-Identifier: GPL-2.0-or-later
// Ported from quake-1-re-ts/src/lib/kfont.ts.
export const KFONT_ASCII_MIN = 32;
export const KFONT_ASCII_MAX = 126;
const KFONT_NUM_CHARS = KFONT_ASCII_MAX - KFONT_ASCII_MIN + 1;
export interface KfontCharT {
    x: number;
    y: number;
    w: number;
    h: number;
    color?: boolean;
}
export interface ParsedKfontT {
    textureToken: string;
    chars: (KfontCharT | null)[];
    glyphs: Map<number, KfontCharT>;
    line_height: number;
}
import { parseQ2Token, type LegacyParseState } from "../core/common-parse.ts";
import type { FontAtlasT } from "./truetype.ts";
function parseError(reason: string): null {
    void reason;
    return null;
}
export function ParseKfont(text: string): ParsedKfontT | null {
    const state: LegacyParseState = { data: text, index: 0 };
    let textureToken: string | null = null;
    const chars: (KfontCharT | null)[] = Array.from({ length: KFONT_NUM_CHARS }, () => null);
    const glyphs = new Map<number, KfontCharT>();
    let line_height = 0;
    for (;;) {
        const token = parseQ2Token(state);
        if (token === "")
            break;
        if (token === "texture") {
            textureToken = parseQ2Token(state);
        }
        else if (token === "unicode") {
        }
        else if (token === "mapchar") {
            parseQ2Token(state);
            for (;;) {
                const entryToken = parseQ2Token(state);
                if (entryToken === "}" || entryToken === "")
                    break;
                const codepoint = parseInt(entryToken, 10);
                const x = parseInt(parseQ2Token(state), 10);
                const y = parseInt(parseQ2Token(state), 10);
                const w = parseInt(parseQ2Token(state), 10);
                const h = parseInt(parseQ2Token(state), 10);
                parseQ2Token(state);
                if (!Number.isFinite(codepoint) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
                    return parseError("malformed mapchar entry");
                }
                const glyph: KfontCharT = { x, y, w, h };
                glyphs.set(codepoint, glyph);
                if (h > line_height)
                    line_height = h;
                const index = codepoint - KFONT_ASCII_MIN;
                if (index >= 0 && index < KFONT_NUM_CHARS) {
                    chars[index] = glyph;
                }
            }
        }
    }
    if (textureToken === null)
        return parseError("missing texture line");
    return { textureToken, chars, glyphs, line_height };
}
export interface KfontT {
    pic: string;
    chars: (KfontCharT | null)[];
    glyphs: Map<number, KfontCharT>;
    line_height: number;
}
export function SCR_KFontLookup(font: KfontT, codepoint: number): KfontCharT | null {
    const index = codepoint - KFONT_ASCII_MIN;
    if (index < 0 || index >= KFONT_NUM_CHARS)
        return null;
    const ch = font.chars[index];
    if (!ch || !ch.w)
        return null;
    return ch;
}
export function kfontGlyph(font: KfontT, codepoint: number): KfontCharT | null {
    const ch = font.glyphs.get(codepoint);
    if (!ch || !ch.w)
        return null;
    return ch;
}
export function kfontHasGlyph(font: KfontT, codepoint: number): boolean {
    return kfontGlyph(font, codepoint) !== null;
}
export interface TtfKfontT {
    pic: string;
    chars: Map<number, KfontCharT>;
    line_height: number;
}
export function TtfKfont_Lookup(font: TtfKfontT, codepoint: number): KfontCharT | null {
    const ch = font.chars.get(codepoint);
    if (!ch || !ch.w)
        return null;
    return ch;
}
export function Kfont_FromTTF(atlas: FontAtlasT, pic: string): TtfKfontT {
    const chars = new Map<number, KfontCharT>();
    for (const [codepoint, rect] of atlas.glyphs) {
        chars.set(codepoint, { x: rect.x, y: rect.y, w: rect.w, h: rect.h, color: rect.color });
    }
    return { pic, chars, line_height: atlas.lineHeight };
}
