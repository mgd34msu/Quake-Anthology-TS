// SPDX-License-Identifier: GPL-2.0-or-later
import type { SeatId } from "../contracts/identity.ts";
import type { Vec2, Vec4 } from "../contracts/math.ts";
import type { Rect } from "../contracts/render.ts";
import { glyphUv, resolveTextGlyph } from "./atlas.ts";
import type { ResolvedTextGlyph, TextFontSelection } from "./atlas.ts";
import type { Draw2D, TextureRect } from "./draw2d.ts";

const colors: readonly Vec4[] = [
  { x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0, w: 1 }, { x: 0, y: 1, z: 0, w: 1 }, { x: 1, y: 1, z: 0, w: 1 },
  { x: 0, y: 0, z: 1, w: 1 }, { x: 0, y: 1, z: 1, w: 1 }, { x: 1, y: 0, z: 1, w: 1 }, { x: 1, y: 1, z: 1, w: 1 },
];
export interface TextLayoutOptions {
  readonly text: string;
  readonly font: TextFontSelection;
  readonly scale: number;
  readonly color: Vec4;
  readonly colorCodes?: "literal" | "q3";
  readonly forceColor?: boolean;
  readonly alternate?: boolean;
  readonly maxWidth?: number;
  readonly align?: "left" | "center" | "right";
  readonly lineHeight?: number;
  readonly maxGlyphs?: number;
  readonly tabColumns?: number;
}
interface TextCell { readonly glyph: ResolvedTextGlyph; readonly color: Vec4; readonly sourceOffset: number; readonly character: string; readonly advance: number; readonly scale: number; }
export interface PositionedGlyph {
  readonly sourceOffset: number;
  readonly glyph: ResolvedTextGlyph;
  readonly rect: Rect;
  readonly uv: TextureRect;
  readonly color: Vec4;
}
export interface TextLine { readonly width: number; readonly y: number; readonly glyphs: readonly PositionedGlyph[]; }
export interface TextLayout { readonly width: number; readonly height: number; readonly lineHeight: number; readonly lines: readonly TextLine[]; readonly glyphCount: number; }

/** One layout calculation supplies both measurement and the actual draw positions. */
export function layoutText(options: TextLayoutOptions): TextLayout {
  if (!Number.isFinite(options.scale) || options.scale <= 0) throw new RangeError("Text scale must be positive");
  const lineHeight = options.lineHeight ?? 8 * options.scale, maximum = options.maxWidth ?? Infinity;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || maximum <= 0 || Number.isNaN(maximum)) throw new RangeError("Invalid text layout dimensions");
  const rows: TextCell[][] = [], current: TextCell[] = [];
  const tabColumns = options.tabColumns ?? 4;
  if (!Number.isInteger(tabColumns) || tabColumns <= 0) throw new RangeError("Invalid tab width");
  let width = 0, color = options.color, count = 0, offset = 0, skipThrough = 0;
  const flush = () => { rows.push(current.splice(0)); width = 0; };
  const push = (cell: TextCell) => {
    if (width + cell.advance > maximum && current.length > 0) {
      let breakAt = -1;
      for (let i = current.length - 1; i >= 0; i--) if (current[i]?.character === " " || current[i]?.character === "\t") { breakAt = i; break; }
      if (breakAt >= 0) {
        const remainder = current.splice(breakAt + 1);
        current.splice(breakAt); flush();
        current.push(...remainder); width = remainder.reduce((sum, item) => sum + item.advance, 0);
        if (width + cell.advance > maximum && current.length > 0) flush();
      } else flush();
    }
    current.push(cell); width += cell.advance;
  };
  for (const character of options.text) {
    const sourceOffset = offset; offset += character.length;
    if (sourceOffset < skipThrough) continue;
    if (character === "\0") break;
    const next = options.text.charAt(offset);
    if (options.colorCodes === "q3" && character === "^" && next !== "" && next !== "^") {
      // The following code unit is consumed by the source escape, even for non-digits.
      const palette = colors[(next.charCodeAt(0) - 48) & 7];
      if (palette !== undefined && !options.forceColor) color = { ...palette, w: options.color.w };
      skipThrough = offset + 1;
      continue;
    }
    if (character === "\r") continue;
    if (character === "\n") { flush(); continue; }
    if (options.maxGlyphs !== undefined && count >= options.maxGlyphs) break;
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) continue;
    const glyph = resolveTextGlyph(options.font, character === "\t" ? 32 : codepoint, options.alternate ?? false);
    const scale = lineHeight / Math.max(1, glyph.atlas.lineHeight);
    const advance = character === "\t" ? lineHeight * tabColumns - width % (lineHeight * tabColumns) : glyph.glyph.advance * scale;
    const tint = glyph.glyph.color ? { x: 1, y: 1, z: 1, w: color.w }
      : options.alternate ? { x: 0.85, y: 0.65, z: 0.12, w: color.w } : color;
    push({ glyph, color: tint, sourceOffset, character, advance, scale }); count++;
  }
  if (current.length > 0 || rows.length === 0 || options.text.endsWith("\n")) flush();
  const lines: TextLine[] = [];
  let widest = 0;
  for (const [lineNumber, row] of rows.entries()) {
    const rowWidth = row.reduce((sum, cell) => sum + cell.advance, 0), y = lineNumber * lineHeight;
    const available = Number.isFinite(maximum) ? maximum : rowWidth;
    let x = options.align === "center" ? (available - rowWidth) / 2 : options.align === "right" ? available - rowWidth : 0;
    const glyphs: PositionedGlyph[] = [];
    for (const cell of row) {
      glyphs.push({ sourceOffset: cell.sourceOffset, glyph: cell.glyph,
        rect: { x, y, width: cell.glyph.glyph.width * cell.scale, height: cell.glyph.glyph.height * cell.scale }, uv: glyphUv(cell.glyph), color: cell.color });
      x += cell.advance;
    }
    widest = Math.max(widest, rowWidth); lines.push({ width: rowWidth, y, glyphs });
  }
  return { width: widest, height: lines.length * lineHeight, lineHeight, lines, glyphCount: count };
}

export function drawTextLayout(draw: Draw2D, layout: TextLayout, origin: Vec2, shadowOffset = 0): void {
  const pass = (shadow: boolean) => {
    for (const line of layout.lines) for (const glyph of line.glyphs) {
      if (!glyph.glyph.visible) continue;
      draw.setColor(shadow ? { x: 0, y: 0, z: 0, w: glyph.color.w } : glyph.color);
      draw.stretchPic({ ...glyph.rect, x: origin.x + glyph.rect.x + (shadow ? shadowOffset : 0),
        y: origin.y + glyph.rect.y + (shadow ? shadowOffset : 0) }, glyph.uv, glyph.glyph.atlas.picture);
    }
  };
  if (shadowOffset > 0) pass(true);
  pass(false); draw.setColor(null);
}

export interface SeatTextScale { readonly console: number; readonly consoleWidth: number; readonly consoleHeight: number; readonly statusBar: number; readonly crosshair: number; }
/** Source scaling formulas applied to a seat viewport, without process-global video state. */
export function seatTextScale(viewport: Rect, consoleScale = 0, statusBarScale = 1, crosshairScale = 1): SeatTextScale {
  const automatic = Math.max(1, Math.floor(viewport.height / 300));
  const requested = consoleScale > 0 ? consoleScale : automatic;
  const consoleWidth = Math.max(8, Math.floor(Math.max(320, Math.min(viewport.width / requested, Math.max(320, viewport.width)))) & ~7);
  const fit = Math.max(1, Math.min(Math.floor(viewport.width / 320), Math.floor(viewport.height / 144)));
  return { console: viewport.width / consoleWidth, consoleWidth,
    consoleHeight: viewport.width <= 0 ? viewport.height : Math.round(consoleWidth * viewport.height / viewport.width),
    statusBar: statusBarScale > 0 ? Math.max(1, Math.min(statusBarScale, fit)) : fit,
    crosshair: Math.max(1, Math.min(crosshairScale, 10)) };
}

export class SeatTextPresentation {
  constructor(readonly seat: SeatId, public font: TextFontSelection) {}
  layout(options: Omit<TextLayoutOptions, "font">): TextLayout { return layoutText({ ...options, font: this.font }); }
  draw(draw: Draw2D, options: Omit<TextLayoutOptions, "font">, origin: Vec2, shadowOffset = 0): TextLayout {
    if (!this.seat.equals(draw.commands.seat)) throw new Error("Text presentation belongs to a different seat");
    const layout = this.layout(options); drawTextLayout(draw, layout, origin, shadowOffset); return layout;
  }
}
