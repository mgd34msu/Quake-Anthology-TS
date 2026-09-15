import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { classicCharset } from "../../src/text/atlas.ts";
import { consoleMetrics, consoleCellWidth, consoleGlyphMetrics } from "../../src/console/metrics.ts";

const identity = createIdentityOwner("console-metrics");
const images = new SceneImageRegistry({ identity: Symbol("console font"), session: identity.session, generation: 0 });
const classic = classicCharset(images.allocate(128, 128, { kind: "generated", name: "test font" }));
const font = { kind: "classic", classic, unicode: null } satisfies Parameters<typeof consoleCellWidth>[0];

for (const [width, height, ratio, expected] of [
  [640, 480, 1, 2], [960, 720, 1, 2], [1280, 960, 2, 4], [320, 240, 1, 1], [640, 240, 1, 2],
]) test(`automatic console scale ${width}x${height} at ${ratio}x DPI`, () => {
  if (width === undefined || height === undefined || ratio === undefined || expected === undefined) throw new Error("Missing case");
  const metrics = consoleMetrics({ width, height, pixelRatio: ratio, requestedScale: 0, font });
  expect(metrics.scale).toBe(expected);
  expect(metrics.cellWidth).toBe(8 * expected);
  expect(metrics.columns * metrics.cellWidth + 16 * metrics.scale).toBeLessThanOrEqual(width);
});

test("console size choices stay integral and small seats remain usable", () => {
  for (const requestedScale of [1, 2, 3, 4]) {
    expect(consoleMetrics({ width: 1920, height: 1080, pixelRatio: 1, requestedScale, font }).scale).toBe(requestedScale);
    expect(consoleMetrics({ width: 64, height: 32, pixelRatio: 1, requestedScale, font }).scale).toBe(1);
  }
  expect(consoleMetrics({ width: 640, height: 480, pixelRatio: 1, requestedScale: NaN, font }).scale).toBe(2);
});

test("variable glyph advances fit the shared fixed console cell without distortion", () => {
  const proportional = { ...classic, kind: "kfont", lineHeight: 8,
    glyphs: new Map([[65, { x: 0, y: 0, width: 12, height: 8, advance: 12, color: false }]]) } satisfies typeof classic;
  expect(consoleCellWidth({ kind: "atlas", font: proportional, classic }, 16)).toBe(16);
  expect(consoleGlyphMetrics({ kind: "atlas", font: proportional, classic }, "A", 16, 16).lineHeight).toBeCloseTo(32 / 3);
});

test("explicit sizes change effective glyph height at ordinary window sizes", () => {
  for (const width of [640, 960]) {
    const heights = [1, 2, 3, 4].map(requestedScale => consoleMetrics({ width, height: width * 3 / 4,
      pixelRatio: 1, requestedScale, font }).lineHeight);
    expect(heights).toEqual([8, 16, 24, 32]);
  }
});

test("mounted qconfont ASCII ink determines size without its widest extended glyph widening every cell", () => {
  // Q2Game.kpf qconfont: M advance8, cap rows4..9 in a14px atlas cell; code508 is14px wide.
  const atlas = { ...classic, kind: "kfont", lineHeight: 14, capInk: { top: 4 * 8 / 14, height: 6 * 8 / 14 },
    glyphs: new Map([[77, { x: 0, y: 0, width: 8, height: 14, advance: 8, color: false }],
      [233, { x: 26, y: 128, width: 8, height: 14, advance: 8, color: false }],
      [508, { x: 0, y: 0, width: 14, height: 14, advance: 14, color: false }],
      [9733, { x: 0, y: 0, width: 14, height: 14, advance: 14, color: false }]]) } satisfies typeof classic;
  const selected = { kind: "atlas", classic, font: atlas } satisfies Parameters<typeof consoleCellWidth>[0];
  expect(consoleCellWidth(selected, 16)).toBe(16);
  const ascii = consoleGlyphMetrics(selected, "M", 16, 16);
  expect(ascii.lineHeight).toBe(28);
  expect(ascii.top).toBe(8);
  expect(6 * ascii.lineHeight / atlas.lineHeight).toBe(12);
  expect(consoleGlyphMetrics(selected, "é", 16, 16)).toEqual(ascii);
  const extended = consoleGlyphMetrics(selected, String.fromCodePoint(9733), 16, 16);
  expect(extended.lineHeight).toBe(16);
  expect(extended.top).toBe(0);
});
