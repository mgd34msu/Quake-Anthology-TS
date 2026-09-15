import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { Rect } from "../../src/contracts/render.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { classicCharset } from "../../src/text/atlas.ts";
import { Draw2D } from "../../src/text/draw2d.ts";
import { SeatTextPresentation } from "../../src/text/layout.ts";
import { ConsoleBuffer } from "../../src/console/buffer.ts";
import { ConsoleField } from "../../src/console/field.ts";
import { drawConsole } from "../../src/console/draw.ts";

for (const width of [320, 640]) test(`console help stays below input inside ${width} viewport`, () => {
  const identity = createIdentityOwner(`console-draw-${width}`), seat = identity.seat(0);
  const images = new SceneImageRegistry({ identity: Symbol("console font"), session: identity.session, generation: 0 });
  const font = classicCharset(images.allocate(128, 128, { kind: "generated", name: "test font" }));
  const text = new SeatTextPresentation(seat, { kind: "classic", classic: font, unicode: null });
  const glyphs: { rect: Rect; character: string }[] = [];
  const height = width * 0.75 / 2;
  const draw = new Draw2D({ seat, target: { x: 0, y: 0, width, height: height * 2 }, setColor: () => undefined,
    stretchPixels: (rect, uv) => { glyphs.push({ rect, character: String.fromCharCode(Math.round(uv.t * 16) * 16 + Math.round(uv.s * 16)) }); } }, "pixels");
  const field = new ConsoleField(), buffer = new ConsoleBuffer("q3", width / 8 - 2);
  field.setText("draft_".repeat(30));
  const before = { text: field.text, cursor: field.cursor, scroll: field.scroll };
  for (let i = 0; i < 60; i++) buffer.print(`scrollback ${i}\n`, i);
  drawConsole({ draw, text, field, rows: buffer.visible(60), height, scale: 1, nowMilliseconds: 0, background: null,
    selectedEntry: { kind: "cvar", name: "setting", usage: "setting <" + "long_argument_".repeat(12) + ">", summary: "Actual registered summary", examples: [], allowedValues: undefined,
      value: "42", resetValue: "0", latchedValue: undefined } });
  const lines = new Map<number, string>();
  for (const glyph of glyphs) {
    expect(glyph.rect.x).toBeGreaterThanOrEqual(8); expect(glyph.rect.x + glyph.rect.width).toBeLessThanOrEqual(width - 8);
    expect(glyph.rect.y).toBeGreaterThanOrEqual(0); expect(glyph.rect.y + glyph.rect.height).toBeLessThanOrEqual(height);
    lines.set(glyph.rect.y, (lines.get(glyph.rect.y) ?? "").padEnd((glyph.rect.x - 8) / 8, " ") + glyph.character);
  }
  expect(lines.get(height - 34)).toStartWith("]"); expect(lines.get(height - 34)).toEndWith("|");
  expect(lines.get(height - 26)).toStartWith("Usage: setting <"); expect(lines.get(height - 26)).toEndWith("...");
  expect(lines.get(height - 18)).toBe("Actual registered summary"); expect(lines.get(height - 10)).toBe('Current: "42"');
  expect({ text: field.text, cursor: field.cursor, scroll: field.scroll }).toEqual(before);
});

test("console variable-width glyphs and caret share fixed cells", () => {
  const identity = createIdentityOwner("console-variable-font"), seat = identity.seat(0);
  const images = new SceneImageRegistry({ identity: Symbol("console font"), session: identity.session, generation: 0 });
  const classic = classicCharset(images.allocate(128, 128, { kind: "generated", name: "test font" }));
  const glyphMap = new Map(classic.glyphs);
  const narrow = glyphMap.get(105);
  if (narrow === undefined) throw new Error("Missing test glyph");
  glyphMap.set(105, { ...narrow, width: 2, advance: 2 });
  const text = new SeatTextPresentation(seat, { kind: "atlas", classic, font: { ...classic, glyphs: glyphMap } });
  const rectangles: Rect[] = [];
  const draw = new Draw2D({ seat, target: { x: 0, y: 0, width: 640, height: 480 }, setColor: () => undefined,
    stretchPixels: rect => { rectangles.push(rect); } }, "pixels");
  const field = new ConsoleField(); field.setText("iW");
  drawConsole({ draw, text, field, rows: [], height: 240, scale: 2, cellWidth: 16, nowMilliseconds: 0, background: null });
  expect(rectangles.map(rect => [rect.x, rect.width])).toEqual([[16, 16], [38, 4], [48, 16], [64, 16]]);
});

test("console clips glyph ink to its background, including fallback overshoot", () => {
  const identity = createIdentityOwner("console-clipping"), seat = identity.seat(0);
  const images = new SceneImageRegistry({ identity: Symbol("console font"), session: identity.session, generation: 0 });
  const classic = classicCharset(images.allocate(128, 128, { kind: "generated", name: "test font" }));
  const glyphs = new Map(classic.glyphs), glyph = glyphs.get(65);
  if (glyph === undefined) throw new Error("Missing test glyph");
  glyphs.set(65, { ...glyph, height: 16 });
  const text = new SeatTextPresentation(seat, { kind: "atlas", classic, font: { ...classic, glyphs } });
  const rectangles: Rect[] = [];
  const draw = new Draw2D({ seat, target: { x: 0, y: 0, width: 640, height: 480 }, setColor: () => undefined,
    stretchPixels: rect => { rectangles.push(rect); } }, "pixels");
  const field = new ConsoleField(); field.setText("A");
  drawConsole({ draw, text, field, rows: [], height: 240, scale: 2, cellWidth: 16, nowMilliseconds: 0, background: null });
  expect(rectangles.length).toBe(3);
  expect(rectangles.every(rect => rect.y >= 0 && rect.y + rect.height <= 240)).toBe(true);
  expect(rectangles[1]?.height).toBe(20);
});
