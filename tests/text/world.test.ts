import { expect, test } from "bun:test";
import { WorldTextStore } from "../../src/text/world.ts";
import type { WorldText } from "../../src/text/world.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { DrawBatch, SceneCamera } from "../../src/contracts/render.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { classicCharset } from "../../src/text/atlas.ts";
import type { TextFontSelection } from "../../src/text/atlas.ts";
import { prepareWorldText } from "../../src/render/scene/world-text.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import { SceneImageRegistry, rgbaImage } from "../../src/render/scene/resources.ts";
import { SoftwareRenderer } from "../../src/render/cpu/rasterizer.ts";
import { GlRenderer } from "../../src/render/gl/renderer.ts";
import { SdlWindow } from "../../src/platform/sdl.ts";
import { encodePng } from "../../src/formats/images/png.ts";

const source: WorldText = { content: "q2:rerelease:baseq2:test", text: "A\nBC", origin: { x: 32, y: 0, z: 8 },
  color: { x: 1, y: 0.5, z: 0.25, w: 0.5 }, cellSize: 8, font: "classic", depthTest: true, orientation: { kind: "billboard" } };
test("world text copies caller values, keeps both seats, expires on server time, and clears", () => {
  const store = new WorldTextStore(), origin = { x: 32, y: 0, z: 8 };
  store.submit({ ...source, origin }, 4, 0.1); origin.x = -32;
  const first = store.snapshot(4, 1), second = store.snapshot(4, 1);
  expect(first).toEqual(second); expect(first[0]?.origin.x).toBe(32);
  expect(store.snapshot(4.09, 2)).toHaveLength(1); expect(store.snapshot(4.1, 3)).toHaveLength(0);
  store.submit(source, 4.2, 0);
  expect(store.snapshot(4.2, 4)).toHaveLength(1); expect(store.snapshot(4.2, 4)).toHaveLength(1);
  expect(store.snapshot(4.2, 5)).toHaveLength(0);
  store.submit(source, 4.3, 0);
  store.submit({ ...source, text: "positive" }, 4.4, 0.1);
  expect(store.snapshot(4.8, 6)).toEqual([source]); expect(store.snapshot(4.8, 6)).toEqual([source]);
  expect(store.snapshot(4.8, 7)).toHaveLength(0);
  store.submit(source, 5, 1); store.clear(); expect(store.snapshot(5, 8)).toHaveLength(0);
});

async function renderText(kind: "cpu" | "gl"): Promise<void> {
  const owner = { identity: Symbol(kind), session: createIdentityOwner(`world-text-${kind}`).session, generation: 0 };
  const images = new SceneImageRegistry(owner), pixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const value = x % 8 === 1 || y % 8 === 1 || x % 8 === 6 ? 255 : 0, index = (y * 128 + x) * 4;
    pixels[index] = 255; pixels[index + 1] = 255; pixels[index + 2] = 255; pixels[index + 3] = value;
  }
  const image = images.register("world-text-probe", rgbaImage({ width: 128, height: 128, pixels }), { filter: "nearest", wrap: "clamp" });
  const font: TextFontSelection = { kind: "classic", classic: classicCharset(image), unicode: null };
  const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
    projection: perspectiveProjection(90, 90, 1024), viewport: { x: 0, y: 0, width: 96, height: 96 }, clip: { kind: "none" } };
  const window = kind === "gl" ? SdlWindow.open({ title: "World text offscreen probe", width: 96, height: 96, backend: "gl", hidden: true }) : null;
  const renderer = window === null ? new SoftwareRenderer(96, 96, owner) : new GlRenderer(window, owner);
  const draw = (batch: DrawBatch): void => {
    if (renderer instanceof SoftwareRenderer) { renderer.draw(batch); return; }
    const geometry = renderer.prepareGeometry(batch); geometry.begin();
    try { geometry.applyTexture(0, batch.texture); geometry.draw(); } finally { geometry.cleanup(); }
  };
  const read = () => renderer instanceof SoftwareRenderer ? renderer.pixels.slice() : renderer.readPixels();
  const count = (values: Uint8Array) => values.filter((value, index) => index % 4 === 0 && value > 0).length;
  try {
    for (const operation of images.drainOperations()) renderer.applyImageResource(operation);
    if (renderer instanceof GlRenderer) renderer.selectDrawBuffer("back", false);
    const begin = (depth: number) => renderer.beginView({ viewport: camera.viewport, clipPlane: null,
      clear: { depth, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false } });
    const store = new WorldTextStore(); store.submit(source, 0, 1); const snapshot = store.snapshot(0, 0);
    const batches = prepareWorldText(snapshot, camera, () => font);
    expect(batches).toHaveLength(3);
    begin(1); for (const batch of batches) draw(batch);
    const visible = read(); expect(count(visible)).toBeGreaterThan(30);
    await Bun.write(`/tmp/world-text-${kind}.png`, encodePng(96, 96, visible));
    begin(0); for (const batch of batches) draw(batch); expect(count(read())).toBe(0);
    const through = prepareWorldText([{ ...source, depthTest: false }], camera, () => font);
    for (const batch of through) draw(batch); expect(count(read())).toBeGreaterThan(30);
    const rolled = { ...camera, axis: anglesToAxis({ x: 0, y: 0, z: 35 }) };
    const billboard = prepareWorldText(snapshot, rolled, () => font), fixed = prepareWorldText([{ ...source,
      orientation: { kind: "fixed", angles: { x: 0, y: 0, z: 0 } } }], rolled, () => font);
    expect(billboard[0]?.vertices).not.toEqual(fixed[0]?.vertices);
    begin(1); for (const batch of fixed) draw(batch); expect(count(read())).toBeGreaterThan(20);
    if (renderer instanceof GlRenderer) expect(renderer.getError()).toBe(0);
  } finally { images.close(); if (renderer instanceof GlRenderer) renderer.close(); window?.close(); }
}
test("world text triangles render with alpha and optional depth on CPU", () => renderText("cpu"));
test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("world text triangles render with alpha and optional depth on offscreen GL", () => renderText("gl"));
