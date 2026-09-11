// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Mat4 } from "../../../src/contracts/math.ts";
import type { DrawBatch, Q2FogOperation, RendererImage, RendererResourceOwner, RenderState, RenderVertex } from "../../../src/contracts/render.ts";
import { perspectiveMat4 } from "../../../src/core/math.ts";
import { SdlWindow } from "../../../src/platform/sdl.ts";
import { GlRenderer } from "../../../src/render/gl/renderer.ts";

const white = { x: 1, y: 1, z: 1, w: 1 };
const state: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal",
  depthWrite: true, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null };
const vertices: readonly RenderVertex[] = [
  { position: { x: -1, y: -1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
  { position: { x: 1, y: -1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
  { position: { x: 1, y: 1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
  { position: { x: -1, y: 1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
];

function draw(renderer: GlRenderer, batch: DrawBatch): void {
  const prepared = renderer.prepareGeometry(batch);
  prepared.begin();
  try {
    prepared.applyTexture(0, batch.texture);
    if (batch.texturing === "pair") prepared.applyTexture(1, batch.secondTexture.binding);
    Bun.gc(true);
    prepared.draw();
  } finally { prepared.cleanup(); }
}

// Run on an owned display: env -u WAYLAND_DISPLAY QUAKE_GL_SMOKE=1 SDL_VIDEODRIVER=x11
// LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a bun test tests/render/gl
test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("GLSL stages, shadow atlases, ordered fog and renderer restart", () => {
  using window = SdlWindow.open({ title: "OpenGL renderer smoke", width: 16, height: 16, backend: "gl", hidden: true, resizable: true, stencilBits: 8 });
  const owner: RendererResourceOwner = { identity: Symbol("GL smoke"), session: createIdentityOwner("GL smoke").session, generation: 0 };
  using renderer = new GlRenderer(window, owner);
  expect(renderer.driver.vendor.length).toBeGreaterThan(0);
  expect(renderer.driver.shadingLanguage.length).toBeGreaterThan(0);
  expect(() => window.close()).toThrow("procedure tables");
  expect(() => new GlRenderer(window, owner)).toThrow("active");
  const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "green" }, width: 1, height: 1 };
  const secondary: RendererImage = { owner, ordinal: 1, source: { kind: "generated", name: "blue" }, width: 1, height: 1 };
  for (const [resource, pixels] of [[image, new Uint8Array([0, 255, 0, 255])], [secondary, new Uint8Array([0, 0, 255, 255])]] satisfies readonly (readonly [RendererImage, Uint8Array])[]) {
    renderer.applyImageResource({ kind: "create-image", image: resource,
      content: { kind: "rgba8", levels: [{ width: 1, height: 1, pixels }], borderColor: white },
      sampling: { wrap: "repeat", filter: "nearest" } });
  }
  const batch: DrawBatch = { texturing: "single", primitive: "triangles", vertices, indices: [0, 1, 2, 0, 2, 3],
    texture: { kind: "bind-image", image }, state, lighting: { kind: "vertex" } };
  const clear = { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: true };
  renderer.selectDrawBuffer("back", false);
  renderer.beginView({ viewport: { x: 0, y: 0, width: 16, height: 16 }, clear, clipPlane: null });
  expect(renderer.readPixels().slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 255]));
  draw(renderer, batch);
  expect(renderer.readPixels()).toEqual(Uint8Array.from({ length: 16 * 16 * 4 }, (_, index) => index % 4 === 1 || index % 4 === 3 ? 255 : 0));
  expect(renderer.readDepthPixel(8, 8)).toBeCloseTo(0.5, 5);
  renderer.applyImageResource({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) } });
  renderer.beginView({ viewport: { x: 0, y: 0, width: 16, height: 16 }, clear, clipPlane: { x: 1, y: 0, z: 0, w: 0 } });
  draw(renderer, batch);
  let pixels = renderer.readPixels();
  expect(pixels.slice((8 * 16 + 4) * 4, (8 * 16 + 4) * 4 + 4)).toEqual(new Uint8Array([0, 0, 0, 255]));
  expect(pixels.slice((8 * 16 + 12) * 4, (8 * 16 + 12) * 4 + 4)).toEqual(new Uint8Array([255, 0, 0, 255]));
  renderer.drawImmediate({ kind: "disable-portal-clip" });
  const paired: DrawBatch = { ...batch, texturing: "pair", vertices: vertices.map(vertex => ({ ...vertex, texCoord2: vertex.texCoord })),
    secondTexture: { binding: { kind: "bind-image", image: secondary }, environment: "add" } };
  draw(renderer, paired);
  expect(renderer.readPixels().slice(0, 4)).toEqual(new Uint8Array([255, 0, 255, 255]));
  renderer.applyImageResource({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([0, 255, 0, 0]) } });
  draw(renderer, { ...batch, state: { ...state, alphaTest: "gt0" } });
  expect(renderer.readPixels().slice(0, 4)).toEqual(new Uint8Array([255, 0, 255, 255]));
  renderer.applyImageResource({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) } });
  renderer.setOverdrawMeasurement(true);
  renderer.beginView({ viewport: { x: 0, y: 0, width: 16, height: 16 }, clear, clipPlane: null });
  draw(renderer, batch); draw(renderer, batch);
  const stencil = new Uint8Array(16 * 16);
  renderer.readStencilOverdraw(stencil);
  expect(stencil.every(value => value === 2)).toBe(true);
  renderer.setOverdrawMeasurement(false);
  renderer.applyImageResource({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([0, 0, 0, 255]) } });
  const worldPositions = vertices.map(vertex => ({ x: vertex.position.x * 128, y: vertex.position.y * 128, z: 0 }));
  const normals = vertices.map(() => ({ x: 0, y: 0, z: 1 }));
  const light = { origin: { x: 0, y: 0, z: 32 }, radius: 256, color: { x: 0, y: 1, z: 0 }, scale: 1,
    cone: { direction: { x: 0, y: 0, z: -1 }, cosHalfAngle: 0.5 }, shadow: { kind: "none" } } satisfies import("../../../src/contracts/render.ts").Q2FragmentLight;
  const lit: DrawBatch = { ...batch, lighting: { kind: "q2-world", worldPositions, normals, pass: "lightmap", lights: [light], atlas: null } };
  draw(renderer, lit);
  pixels = renderer.readPixels();
  const centerGreen = pixels[(8 * 16 + 8) * 4 + 1], cornerGreen = pixels[1];
  if (centerGreen === undefined || cornerGreen === undefined) throw new Error("Missing GL lighting pixels");
  expect(centerGreen).toBeGreaterThan(100);
  expect(cornerGreen).toBeLessThan(centerGreen);
  const atlas: RendererImage = { owner, ordinal: 2, source: { kind: "generated", name: "shadow atlas" }, width: 96, height: 96 };
  renderer.applyImageResource({ kind: "create-image", image: atlas,
    content: { kind: "depth32f", levels: [{ width: 96, height: 96, pixels: new Float32Array(96 * 96).fill(1) }] },
    sampling: { wrap: "clamp", filter: "nearest" } });
  renderer.drawImmediate({ kind: "depth-atlas", image: atlas, passes: [{ viewport: { x: 0, y: 0, width: 96, height: 96 }, clearDepth: 1,
    draws: [{ positions: vertices.map(vertex => ({ ...vertex.position, z: -0.5 })), indices: batch.indices, cull: "none", polygonOffset: null }] }] });
  expect(renderer.readDepthImage(atlas).pixels.every(depth => Math.abs(depth - 0.25) < 0.00001)).toBe(true);
  expect(renderer.readPixels()).toEqual(pixels);
  const matrix: Mat4 = [1 / 256, 0, 0, 0, 0, 1 / 256, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.75, 1];
  draw(renderer, { ...lit, lighting: { kind: "q2-world", worldPositions, normals, pass: "lightmap",
    lights: [{ ...light, shadow: { kind: "cone", matrix, atlasRect: { x: 0, y: 0, z: 1, w: 1 } } }],
    atlas: { image: atlas, texelSize: 1 / 96, nearPlane: 4 } } });
  expect(renderer.readPixels().slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)).toEqual(new Uint8Array([0, 0, 0, 255]));
  renderer.applyImageResource({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) } });
  draw(renderer, { ...batch, lighting: { kind: "q2-model-shadow", worldPositions: vertices.map(() => ({ x: 0, y: 0, z: 0 })),
    lights: [{ origin: light.origin, radius: 256, fraction: { x: 1, y: 0, z: 0 }, shadow: { kind: "point", atlasRect: { x: 0, y: 0, z: 1, w: 2 / 3 } } }],
    shadeScale: 1, atlas: { image: atlas, texelSize: 1 / 96, nearPlane: 4 } } });
  expect(renderer.readPixels().slice(0, 4)).toEqual(new Uint8Array([0, 255, 255, 255]));
  const fogPass: Q2FogOperation = { kind: "q2-fog", camera: {
    origin: { x: 0, y: 0, z: 10 }, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    projection: perspectiveMat4(90, 1, 4, 1024), viewport: { x: 0, y: 0, width: 16, height: 16 }, clip: { kind: "none" } },
    fog: { kind: "q2", color: { x: 0, y: 0, z: 1 }, density: 16, skyFactor: 0.5,
      height: { start: { color: { x: 1, y: 0, z: 0 }, distance: 0 }, end: { color: { x: 0, y: 0, z: 1 }, distance: 100 },
        density: 0, falloff: 0 } }, farDepth: 1 - 1e-6, skyDrawn: false };
  renderer.beginView({ viewport: fogPass.camera.viewport, clear: { ...clear, depth: 0.5 }, clipPlane: null });
  renderer.drawImmediate(fogPass);
  pixels = renderer.readPixels();
  expect(pixels[0]).toBe(0);
  expect(pixels[2]).toBeCloseTo(160, -1);
  expect(renderer.readDepthPixel(8, 8)).toBeCloseTo(0.5, 5);
  renderer.beginView({ viewport: fogPass.camera.viewport, clear: { ...clear, depth: 0.5 }, clipPlane: null });
  renderer.drawImmediate({ ...fogPass, fog: { ...fogPass.fog, density: 0,
    height: { ...fogPass.fog.height, density: 0.3, falloff: 0.1 } } });
  pixels = renderer.readPixels();
  const heightRed = pixels[(8 * 16 + 8) * 4], heightBlue = pixels[(8 * 16 + 8) * 4 + 2];
  if (heightRed === undefined || heightBlue === undefined) throw new Error("Missing GL height fog pixels");
  expect(heightRed).toBeGreaterThan(100); expect(heightBlue).toBeLessThan(heightRed);
  renderer.beginView({ viewport: fogPass.camera.viewport, clear, clipPlane: null });
  renderer.drawImmediate(fogPass);
  expect(renderer.readPixels().slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 255]));
  renderer.drawImmediate({ ...fogPass, skyDrawn: true });
  const skyBlue = renderer.readPixels()[2];
  if (skyBlue === undefined) throw new Error("Missing GL sky fog pixel");
  expect([127, 128]).toContain(skyBlue);
  renderer.finish();
  expect(renderer.getError()).toBe(0);
  renderer.present();
  renderer.close();
  using restarted = new GlRenderer(window, { ...owner, identity: Symbol("GL restart"), generation: 1 });
  expect(() => restarted.applyImageResource({ kind: "release-image", image })).toThrow("another renderer");
  window.setSize(12, 8); window.pollEvents();
  expect(restarted.width).toBe(12); expect(restarted.height).toBe(8);
  restarted.beginView({ viewport: { x: 0, y: 0, width: 12, height: 8 }, clear, clipPlane: null });
  pixels = restarted.readPixels();
  expect(pixels.length).toBe(12 * 8 * 4);
  expect(pixels.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 255]));
  expect(restarted.getError()).toBe(0);
});
