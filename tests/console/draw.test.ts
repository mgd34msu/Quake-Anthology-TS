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
  expect(lines.get(height - 32)).toStartWith("]"); expect(lines.get(height - 32)).toEndWith("|");
  expect(lines.get(height - 24)).toStartWith("Usage: setting <"); expect(lines.get(height - 24)).toEndWith("...");
  expect(lines.get(height - 16)).toBe("Actual registered summary"); expect(lines.get(height - 8)).toBe('Current: "42"');
  expect({ text: field.text, cursor: field.cursor, scroll: field.scroll }).toEqual(before);
});
