// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { Mat4 } from "../../../src/contracts/math.ts";
import type { DrawBatch, Q2FogOperation, RendererImage, RendererResourceOwner, RenderState, RenderVertex } from "../../../src/contracts/render.ts";
import { perspectiveMat4 } from "../../../src/core/math.ts";
import { SdlWindow } from "../../../src/platform/sdl.ts";
import { GlRenderer } from "../../../src/render/gl/renderer.ts";
import { packGeometry } from "../../../src/render/gl/buffers.ts";
import { StageProgram } from "../../../src/render/gl/programs.ts";
import type { loadGlPrograms } from "../../../src/platform/gl-programs.ts";
import { outputGammaTable } from "../../../src/render/output-gamma.ts";

const white = { x: 1, y: 1, z: 1, w: 1 };
const state: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal",
  depthWrite: true, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null };
const vertices: readonly RenderVertex[] = [
  { position: { x: -1, y: -1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
  { position: { x: 1, y: -1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
  { position: { x: 1, y: 1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
  { position: { x: -1, y: 1, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: white },
];

test("GL packing preserves float32 bytes, paired coordinates and world lighting arrays", () => {
  const paired = vertices.map((vertex, index) => ({ ...vertex,
    position: { ...vertex.position, z: index / 3, w: index === 0 ? -0 : 1 },
    texCoord2: { x: index / 7, y: -index / 9 } }));
  const worldPositions = paired.map(vertex => ({ x: vertex.position.x, y: vertex.position.y, z: vertex.position.z }));
  const normals = paired.map(() => ({ x: 0, y: -0, z: 1 }));
  const batch: DrawBatch = { texturing: "pair", primitive: "triangles", vertices: paired, indices: [0, 1, 2, 0, 2, 3],
    texture: { kind: "retain-current-texture" }, secondTexture: { binding: { kind: "retain-current-texture" }, environment: "modulate" }, state,
    lighting: { kind: "q2-world", worldPositions, normals, pass: "lightmap", lights: [], atlas: null } };
  const arrays = packGeometry(batch);
  const bytes = (values: Float32Array | Uint32Array): Uint8Array => new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  expect(bytes(arrays.positions)).toEqual(bytes(new Float32Array(paired.flatMap(vertex => [vertex.position.x, vertex.position.y, vertex.position.z, vertex.position.w]))));
  expect(bytes(arrays.colors)).toEqual(bytes(new Float32Array(paired.flatMap(vertex => [vertex.color.x, vertex.color.y, vertex.color.z, vertex.color.w]))));
  expect(bytes(arrays.coordinates)).toEqual(bytes(new Float32Array(paired.flatMap(vertex => [vertex.texCoord.x, vertex.texCoord.y]))));
  expect(bytes(arrays.coordinates2)).toEqual(bytes(new Float32Array(paired.flatMap(vertex => [vertex.texCoord2.x, vertex.texCoord2.y]))));
  expect(bytes(arrays.worldPositions)).toEqual(bytes(new Float32Array(worldPositions.flatMap(position => [position.x, position.y, position.z]))));
  expect(bytes(arrays.normals)).toEqual(bytes(new Float32Array(normals.flatMap(normal => [normal.x, normal.y, normal.z]))));
  expect(bytes(arrays.indices)).toEqual(bytes(new Uint32Array(batch.indices)));
  const single = packGeometry({ ...batch, texturing: "single", lighting: { kind: "vertex" } });
  expect(single.coordinates2).toEqual(new Float32Array(paired.length * 2));
  expect(single.worldPositions.length).toBe(0); expect(single.normals.length).toBe(0);
  expect(() => packGeometry({ ...batch, indices: [0, 1, 4] })).toThrow("index is outside");
  expect(() => packGeometry({ ...batch, indices: [0, 1] })).toThrow("index count");
  expect(() => packGeometry({ ...batch, vertices: paired.map(vertex => ({ ...vertex, position: { ...vertex.position, x: 1e40 } })) })).toThrow("finite float32");
  expect(() => packGeometry({ ...batch, lighting: { kind: "q2-world", worldPositions: [], normals, pass: "lightmap", lights: [], atlas: null } })).toThrow("world positions");
  expect(() => packGeometry({ ...batch, lighting: { kind: "q2-world", worldPositions, normals: [], pass: "lightmap", lights: [], atlas: null } })).toThrow("normals");
});

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
  renderer.beginView({ viewport: fogPass.camera.viewport, clear, clipPlane: null });
  renderer.withObjectOpacity(0.5, () => { draw(renderer, batch); return undefined; });
  expect(renderer.readPixels().slice(0, 3).every(value => value === 127 || value === 128)).toBe(true);
  draw(renderer, batch);
  expect(renderer.readPixels().slice(0, 4)).toEqual(new Uint8Array([255, 255, 255, 255]));
  expect(renderer.readDepthPixel(8, 8)).toBeCloseTo(0.5, 5);
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

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("GL output gamma follows blending and preserves raw buffers across capture, resize and disable", () => {
  using window = SdlWindow.open({ title: "Offscreen gamma smoke", width: 16, height: 16, backend: "gl", hidden: true, resizable: true, stencilBits: 8 });
  const owner: RendererResourceOwner = { identity: Symbol("GL gamma"), session: createIdentityOwner("GL gamma").session, generation: 0 };
  using renderer = new GlRenderer(window, owner);
  const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "gamma sample" }, width: 1, height: 1 };
  renderer.applyImageResource({ kind: "create-image", image,
    content: { kind: "rgba8", levels: [{ width: 1, height: 1, pixels: new Uint8Array([64, 128, 192, 128]) }], borderColor: white },
    sampling: { wrap: "repeat", filter: "nearest" } });
  const batch: DrawBatch = { texturing: "single", primitive: "triangles", vertices, indices: [0, 1, 2, 0, 2, 3],
    texture: { kind: "bind-image", image }, state: { ...state, blend: { source: "src-alpha", destination: "one-minus-src-alpha" } }, lighting: { kind: "vertex" } };
  const clear = { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: true };
  renderer.selectDrawBuffer("back", false);
  renderer.setOverdrawMeasurement(true);
  renderer.beginView({ viewport: { x: 0, y: 0, width: 16, height: 16 }, clear, clipPlane: null });
  draw(renderer, batch);
  const raw = renderer.readPixels(), stencil = new Uint8Array(16 * 16);
  renderer.readStencilOverdraw(stencil);
  expect(stencil.every(value => value === 1)).toBe(true);
  renderer.setOutputGamma(1); renderer.finish();
  expect(renderer.readPixels()).toEqual(raw);
  expect(() => renderer.setOutputGamma(0)).toThrow("0.5 and 3");
  renderer.setOutputGamma(2); renderer.finish();
  expect(renderer.getError()).toBe(0);
  const table = outputGammaTable(2); if (table === null) throw new Error("Gamma table missing");
  const corrected = raw.map((component, index) => index % 4 === 3 ? component : table[component] ?? 0);
  expect(renderer.readPixels()).toEqual(corrected);
  renderer.finish(); renderer.finish();
  expect(renderer.readPixels()).toEqual(corrected);
  expect(renderer.readDepthPixel(12, 8)).toBeCloseTo(0.5, 5);
  renderer.readStencilOverdraw(stencil);
  expect(stencil.every(value => value === 1)).toBe(true);
  renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 16 }, clear: { depth: 0.75, color: { x: 0.25, y: 0, z: 0, w: 1 }, stencil: true }, clipPlane: null });
  renderer.finish();
  const partial = renderer.readPixels();
  expect(partial.slice((8 * 16 + 12) * 4, (8 * 16 + 12) * 4 + 4)).toEqual(corrected.slice((8 * 16 + 12) * 4, (8 * 16 + 12) * 4 + 4));
  expect(partial.slice(0, 3)).toEqual(new Uint8Array([table[64] ?? 0, table[0] ?? 0, table[0] ?? 0]));
  expect(renderer.readDepthPixel(4, 8)).toBeCloseTo(0.75, 5);
  expect(renderer.readDepthPixel(12, 8)).toBeCloseTo(0.5, 5);
  renderer.setOutputGamma(1);
  const restored = renderer.readPixels();
  expect(restored.slice(0, 3)).toEqual(new Uint8Array([64, 0, 0]));
  expect(restored.slice((8 * 16 + 12) * 4, (8 * 16 + 12) * 4 + 4)).toEqual(raw.slice((8 * 16 + 12) * 4, (8 * 16 + 12) * 4 + 4));
  expect(renderer.readDepthPixel(4, 8)).toBeCloseTo(0.75, 5);
  renderer.setOutputGamma(2);
  window.setSize(12, 8); window.pollEvents();
  renderer.beginView({ viewport: { x: 0, y: 0, width: 12, height: 8 }, clear: { ...clear, color: { x: 0.25, y: 0.5, z: 0.75, w: 1 } }, clipPlane: null });
  renderer.finish();
  const resized = renderer.readPixels();
  renderer.setOutputGamma(1);
  const resizedRaw = renderer.readPixels();
  expect(resized).toEqual(resizedRaw.map((component, index) => index % 4 === 3 ? component : table[component] ?? 0));
  expect(resized.length).toBe(12 * 8 * 4);
  renderer.setOutputGamma(2); renderer.finish();
  expect(renderer.getError()).toBe(0);
  renderer.present(); renderer.close();
  using restarted = new GlRenderer(window, { ...owner, identity: Symbol("gamma restart"), generation: 1 });
  restarted.setOutputGamma(2);
  restarted.beginView({ viewport: { x: 0, y: 0, width: 12, height: 8 }, clear, clipPlane: null });
  restarted.finish(); expect(restarted.getError()).toBe(0);
});

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("stage uniform values preserve native state across changes, rejected inputs and restart", () => {
  using window = SdlWindow.open({ title: "Stage uniform cache", width: 16, height: 16, backend: "gl", hidden: true });
  const owner: RendererResourceOwner = { identity: Symbol("uniforms"), session: createIdentityOwner("uniforms").session, generation: 0 };
  const atlasImage: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "atlas" }, width: 16, height: 16 };
  const atlas = { image: atlasImage, texelSize: 1 / 16, nearPlane: 4 };
  const matrix: [...Mat4] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  let light: import("../../../src/contracts/render.ts").Q2FragmentLight = { origin: { x: 0, y: 1, z: 2 }, radius: 64, color: { x: 1, y: 0.5, z: 0.25 }, scale: 1,
    cone: { direction: { x: 0, y: 0, z: -1 }, cosHalfAngle: 0.5 }, shadow: { kind: "cone", matrix, atlasRect: { x: 0, y: 0, z: 1, w: 1 } } };
  const lighting = (): import("../../../src/contracts/render.ts").BatchLighting => ({ kind: "q2-world", worldPositions: [], normals: [], pass: "lightmap", lights: [light], atlas });
  const reference = new StageProgram(window), cached = new StageProgram(window);
  const referenceTrace = traceUniforms(reference["library"].symbols, reference["uniforms"]), trace = traceUniforms(cached["library"].symbols, cached["uniforms"]);
  const lookup = cached["uniforms"].get;
  let locationLookups = 0;
  cached["uniforms"].get = function (...args) { locationLookups++; return lookup.apply(this, args); };
  function freshReference(): void {
    reference["integers"].clear(); reference["scalars"].clear(); reference["vectors3"].clear(); reference["vectors4"].clear(); reference["matrices"].clear();
  }
  function use(...args: Parameters<StageProgram["use"]>): void {
    freshReference(); reference.use(...args); cached.use(...args);
    expect(trace.state).toEqual(referenceTrace.state);
  }
  try {
    use(null, "none", lighting());
    const initial = trace.calls;
    const initialLookups = locationLookups;
    use(null, "none", lighting()); expect(trace.calls).toBe(initial);
    expect(locationLookups).toBe(initialLookups);
    cached.useDepth(); cached.restore(0); use(null, "none", lighting()); expect(trace.calls).toBe(initial);
    const changed = (change: () => void): void => { const before = trace.calls; change(); use(null, "none", lighting()); expect(trace.calls).toBe(before + 1); };
    changed(() => { light = { ...light, radius: 65 }; });
    changed(() => { light = { ...light, scale: 0.75 }; });
    for (const component of ["x", "y", "z"] satisfies readonly ("x" | "y" | "z")[]) {
      changed(() => { light = { ...light, origin: { ...light.origin, [component]: light.origin[component] + 1 } }; });
      changed(() => { light = { ...light, color: { ...light.color, [component]: light.color[component] + 0.1 } }; });
      changed(() => { const cone = light.cone; if (cone === null) throw new Error("Missing cone"); light = { ...light, cone: { ...cone, direction: { ...cone.direction, [component]: cone.direction[component] + 0.1 } } }; });
    }
    changed(() => { const cone = light.cone; if (cone === null) throw new Error("Missing cone"); light = { ...light, cone: { ...cone, cosHalfAngle: 0.6 } }; });
    for (const component of ["x", "y", "z", "w"] satisfies readonly ("x" | "y" | "z" | "w")[]) changed(() => {
      const shadow = light.shadow; if (shadow.kind !== "cone") throw new Error("Missing shadow");
      light = { ...light, shadow: { ...shadow, atlasRect: { ...shadow.atlasRect, [component]: shadow.atlasRect[component] + 0.01 } } };
    });
    for (let index = 0; index < matrix.length; index++) changed(() => { matrix[index] = (matrix[index] ?? 0) + 0.01; });
    changed(() => { atlas.texelSize = 1 / 32; }); changed(() => { atlas.nearPlane = 2; });
    changed(() => { light = { ...light, origin: { ...light.origin, x: 0 } }; });
    changed(() => { light = { ...light, origin: { ...light.origin, x: -0 } }; });
    for (const environment of ["modulate", "add", "replace", null] satisfies readonly Parameters<StageProgram["use"]>[0][]) {
      for (const alpha of ["none", "gt0", "lt128", "ge128"] satisfies readonly RenderState["alphaTest"][]) use(environment, alpha, lighting(), true);
    }
    use(null, "none", lighting(), false);
    use(null, "none", { kind: "vertex" });
    const world = lighting(); if (world.kind !== "q2-world") throw new Error("Missing world lighting");
    use(null, "none", { ...world, lights: [light, { ...light, radius: 80 }] });
    use(null, "none", { ...world, lights: [] }); use(null, "none", { ...world, lights: [light, { ...light, radius: 90 }] });
    for (const pass of ["texture", "material-lightmap", "lightmap"] satisfies readonly typeof world.pass[]) use(null, "none", { ...world, pass });
    light = { ...light, shadow: { kind: "point", atlasRect: { x: 0, y: 0, z: 1, w: 2 / 3 } } }; use(null, "none", lighting());
    light = { ...light, shadow: { kind: "none" } }; use(null, "none", lighting());
    light = { ...light, shadow: { kind: "cone", matrix, atlasRect: { x: 0, y: 0, z: 1, w: 1 } } }; use(null, "none", lighting());
    const model = { kind: "q2-model-shadow", worldPositions: [], shadeScale: 1, lights: [{ origin: light.origin, radius: light.radius, fraction: { x: 1, y: 0.5, z: 0.25 }, shadow: light.shadow }], atlas } satisfies import("../../../src/contracts/render.ts").BatchLighting;
    use(null, "none", model); use(null, "none", { ...model, shadeScale: 0.5 });
    for (const component of ["x", "y", "z"] satisfies readonly ("x" | "y" | "z")[]) use(null, "none", { ...model, lights: model.lights.map(item => ({ ...item, fraction: { ...item.fraction, [component]: 0.75 } })) });
    const invalid = [
      { ...world, lights: Array.from({ length: 9 }, () => light) },
      { ...world, atlas: { ...atlas, nearPlane: 0 } },
      { ...world, lights: [{ ...light, radius: -1 }] },
      { ...world, lights: [{ ...light, origin: { ...light.origin, x: NaN } }] },
      { ...world, atlas: null, lights: [light] },
    ] satisfies readonly import("../../../src/contracts/render.ts").BatchLighting[];
    for (const malformed of invalid) {
      for (let repeat = 0; repeat < 2; repeat++) {
        freshReference(); expect(() => reference.use(null, "none", malformed)).toThrow(); expect(() => cached.use(null, "none", malformed)).toThrow();
        expect(trace.state).toEqual(referenceTrace.state);
      }
      use(null, "none", lighting());
    }
    trace.rejectScalar(); referenceTrace.rejectScalar(); light = { ...light, radius: light.radius + 1 };
    freshReference(); expect(() => reference.use(null, "none", lighting())).toThrow("native upload rejected"); expect(() => cached.use(null, "none", lighting())).toThrow("native upload rejected");
    use(null, "none", lighting());
    expect(trace.calls).toBeLessThan(referenceTrace.calls);
  } finally { cached.close(); reference.close(); }
  expect(() => cached.use(null, "none")).toThrow("closed");
  const restarted = new StageProgram(window), restartTrace = traceUniforms(restarted["library"].symbols, restarted["uniforms"]);
  const resolveLocation = restarted["library"].symbols.glGetUniformLocation;
  let missing = true, resolutionCalls = 0;
  restarted["library"].symbols.glGetUniformLocation = Object.assign((...args: Parameters<typeof resolveLocation>) => {
    resolutionCalls++; return missing ? -1 : resolveLocation(...args);
  }, resolveLocation);
  try {
    expect(() => restarted.use(null, "none", lighting())).toThrow("uniform is missing: secondaryMode");
    expect(() => restarted.use(null, "none", lighting())).toThrow("uniform is missing: secondaryMode");
    expect(resolutionCalls).toBe(2);
    missing = false;
    restarted.use(null, "none", lighting()); expect(restartTrace.calls).toBeGreaterThan(5);
  }
  finally { restarted.close(); }
});

function traceUniforms(gl: ReturnType<typeof loadGlPrograms>["symbols"], locations: ReadonlyMap<string, number>) {
  const state = new Map<string, readonly number[]>(); let calls = 0, rejectScalar = false;
  const record = (location: number, values: readonly number[]): void => {
    for (const [name, id] of locations) if (id === location) { state.set(name, [...values]); calls++; return; }
    throw new Error("Unknown uniform location");
  };
  const integer = gl.glUniform1i, scalar = gl.glUniform1f, vector3 = gl.glUniform3f, vector4 = gl.glUniform4f, matrix = gl.glUniformMatrix4fv;
  gl.glUniform1i = Object.assign((location: number, value: number) => { const result = integer(location, value); record(location, [value]); return result; }, integer);
  gl.glUniform1f = Object.assign((location: number, value: number) => {
    if (rejectScalar) { rejectScalar = false; throw new Error("native upload rejected"); }
    const result = scalar(location, value); record(location, [Math.fround(value)]); return result;
  }, scalar);
  gl.glUniform3f = Object.assign((location: number, x: number, y: number, z: number) => { const result = vector3(location, x, y, z); record(location, [Math.fround(x), Math.fround(y), Math.fround(z)]); return result; }, vector3);
  gl.glUniform4f = Object.assign((location: number, x: number, y: number, z: number, w: number) => { const result = vector4(location, x, y, z, w); record(location, [Math.fround(x), Math.fround(y), Math.fround(z), Math.fround(w)]); return result; }, vector4);
  gl.glUniformMatrix4fv = Object.assign((location: number, count: number, transpose: number, value: Float32Array) => {
    const result = matrix(location, count, transpose, value); record(location, [...value]); return result;
  }, matrix);
  return { state, get calls() { return calls; }, rejectScalar() { rejectScalar = true; } };
}
