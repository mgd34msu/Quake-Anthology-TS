import { resolveTextGlyph } from "../text/atlas.ts";
import type { TextFontSelection } from "../text/atlas.ts";

export interface ConsoleMetrics {
  readonly scale: number;
  readonly lineHeight: number;
  readonly cellWidth: number;
  readonly columns: number;
}

/** Keep the source glyph aspect ratio inside a fixed console character grid. */
export function consoleCellWidth(font: TextFontSelection, lineHeight: number): number {
  const glyph = resolveTextGlyph(font, 77);
  const cap = glyph.atlas.capInk;
  const normalization = cap === undefined ? 1 : 6 / cap.height;
  return Math.ceil(glyph.glyph.advance * lineHeight / glyph.atlas.lineHeight * normalization);
}

export function consoleMetrics(options: {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly requestedScale: number;
  readonly font: TextFontSelection;
}): ConsoleMetrics {
  const ratio = Math.max(1, options.pixelRatio);
  const automatic = Math.max(2, Math.floor(options.height / ratio / 300));
  const explicit = Number.isFinite(options.requestedScale) && options.requestedScale > 0;
  const requested = explicit
    ? Math.max(1, Math.min(4, Math.round(options.requestedScale))) : automatic;
  const fit = explicit
    ? Math.max(1, Math.floor(Math.min(options.width / 40, options.height / 16)))
    : Math.max(1, Math.floor(Math.min(options.width / 256, options.height / 96)));
  const scale = Math.max(1, Math.min(fit, Math.round(requested * ratio)));
  const lineHeight = 8 * scale, cellWidth = consoleCellWidth(options.font, lineHeight);
  return { scale, lineHeight, cellWidth, columns: Math.max(1, Math.floor((options.width - 16 * scale) / cellWidth)) };
}

/** Text cap ink occupies six of eight source console pixels, with room for descenders. */
export function consoleGlyphMetrics(font: TextFontSelection, character: string, lineHeight: number, cellWidth: number): {
  readonly lineHeight: number; readonly top: number;
} {
  const code = character.codePointAt(0) ?? 32, glyph = resolveTextGlyph(font, code);
  const text = code >= 32 && code <= 126 || /[\p{L}\p{N}\p{M}]/u.test(character);
  const cap = text ? glyph.atlas.capInk : undefined;
  const normalization = cap === undefined ? 1 : 6 / cap.height;
  const naturalWidth = glyph.glyph.width * lineHeight / glyph.atlas.lineHeight * normalization;
  const fit = Math.min(1, cellWidth / Math.max(1, naturalWidth));
  return { lineHeight: lineHeight * normalization * fit, top: (cap?.top ?? 0) * lineHeight / 8 * normalization * fit };
}
