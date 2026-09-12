import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner, RenderVertex } from "../../../src/contracts/render.ts";
import { CPU_OPAQUE_STATE, CpuRenderTarget, SoftwareRenderer } from "../../../src/render/cpu/index.ts";
import { compileShaderScript } from "../../../src/materials/compile.ts";
import { prepareMaterialBatches } from "../../../src/materials/evaluate.ts";
import { RendererNoise } from "../../../src/materials/deform.ts";
import type { RegisteredImage } from "../../../src/materials/material.ts";
import type { SourceStageCell } from "../../../src/render/cpu/source.ts";
import { SourceStateBit } from "../../../src/materials/source-state.ts";
import { identityMat4, perspectiveMat4 } from "../../../src/core/math.ts";
import type { Q2FogOperation, Q2FragmentLight, Q2ShadowAtlas, SceneCamera } from "../../../src/contracts/render.ts";

function fixture(alphaBits: 0 | 8 = 8) {
  const owner: RendererResourceOwner = { identity: Symbol("cpu"), session: createIdentityOwner("cpu test").session, generation: 0 };
  const renderer = new SoftwareRenderer(8, 8, owner, 8, 8, alphaBits);
  const white: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "white" }, width: 1, height: 1 };
  renderer.applyImageResource({ kind: "create-image", image: white,
    content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 0 },
      levels: [{ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }] },
    sampling: { filter: "nearest", wrap: "repeat" } });
  return { owner, renderer, white };
}

function triangle(image: RendererImage, z: number, color: RenderVertex["color"]): Extract<DrawBatch, { readonly texturing: "single" }> {
  return { lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single", texture: { kind: "bind-image", image },
    indices: [0, 1, 2], state: CPU_OPAQUE_STATE,
    vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 1 }].map(position => ({
      position: { ...position, z, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color })) };
}

function pixel(renderer: SoftwareRenderer): number[] { return [...renderer.pixels.slice((4 * 8 + 4) * 4, (4 * 8 + 5) * 4)]; }

test("CPU object opacity composites completed destination-dependent passes and preserves scene depth/stencil", () => {
  const { renderer, white } = fixture();
  try {
    renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clipPlane: null,
      clear: { color: { x: 0.2, y: 0.4, z: 0.6, w: 1 }, depth: 0.9, stencil: true } });
    renderer.setOverdrawMeasurement(true);
    const first = triangle(white, 0, { x: 0.5, y: 0.5, z: 0.5, w: 1 });
    const second = triangle(white, 0, { x: 0.2, y: 0.1, z: 0, w: 1 });
    renderer.withObjectOpacity(0.5, () => {
      renderer.draw({ ...first, state: { ...first.state, blend: { source: "dst-color", destination: "zero" } } });
      renderer.draw(triangle(white, 0.2, { x: 0, y: 1, z: 0, w: 1 }));
      renderer.draw({ ...second, state: { ...second.state, blend: { source: "one", destination: "one" } } });
      expect(renderer.readDepthPixel(4, 3)).toBe(0.5);
      return undefined;
    });
    expect(pixel(renderer)).toEqual([64, 90, 115, 255]);
    expect(renderer.readDepthPixel(4, 3)).toBe(Math.fround(0.9));
    const stencil = new Uint8Array(64);
    renderer.readStencilOverdraw(stencil);
    expect(stencil.every(value => value === 0)).toBe(true);
    renderer.draw(triangle(white, 0.4, { x: 0, y: 0, z: 1, w: 1 }));
    expect(pixel(renderer)).toEqual([0, 0, 255, 255]);
  } finally { renderer.close(); }
});

test("CPU object scopes skip dynamic uploads at zero and retain successful uploads after failed draws", () => {
  const { owner, renderer, white } = fixture(), target = new CpuRenderTarget(renderer);
  let uploads = 0;
  const dynamic: DrawBatch = { ...triangle(white, 0, { x: 1, y: 1, z: 1, w: 1 }),
    texture: { kind: "dynamic-image", source: { resolve: apply => {
      uploads++;
      apply({ kind: "update-image", image: white, level: 0,
        content: { width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) } });
      return white;
    } } } };
  const frame = (opacity: number) => target.execute({ owner, sequence: 0, commands: [{ kind: "view", view: {
    viewport: { x: 0, y: 0, width: 8, height: 8 }, clear: null, clipPlane: null,
    target: { kind: "preview", id: "opacity" }, time: { kind: "seconds", value: 0 }, beforeView: [],
    operations: [{ kind: "object-opacity", opacity, batches: [dynamic] }],
  } }] });
  try {
    frame(0);
    expect(uploads).toBe(0);
    expect(pixel(renderer)).toEqual([0, 0, 0, 0]);
    expect(() => renderer.withObjectOpacity(0.5, () => {
      renderer.draw(dynamic);
      throw new Error("late object failure");
    })).toThrow("late object failure");
    expect(uploads).toBe(1);
    expect(pixel(renderer)).toEqual([0, 0, 0, 0]);
    expect(renderer.readDepthPixel(4, 3)).toBe(1);
    renderer.draw(triangle(white, 0, { x: 1, y: 1, z: 1, w: 1 }));
    expect(pixel(renderer)).toEqual([255, 0, 0, 255]);
    frame(1);
    expect(uploads).toBe(2);
    expect(renderer.readDepthPixel(4, 3)).toBe(0.5);
  } finally { renderer.close(); }
});

test("CPU opacity isolates offset viewports and line depth and rejects nesting", () => {
  const { renderer, white } = fixture();
  try {
    renderer.beginView({ viewport: { x: 4, y: 0, width: 4, height: 8 }, clipPlane: null,
      clear: { color: { x: 0, y: 0, z: 1, w: 1 }, depth: 1, stencil: true } });
    const base = triangle(white, 0, { x: 1, y: 0, z: 0, w: 1 });
    renderer.withObjectOpacity(0.5, () => {
      renderer.draw({ ...base, primitive: "lines", lineWidth: 1, indices: [0, 1],
        vertices: base.vertices.map(vertex => ({ ...vertex, position: { ...vertex.position, y: 0 } })) });
      expect(() => renderer.withObjectOpacity(0.5, () => undefined)).toThrow("cannot nest");
      return undefined;
    });
    let faded = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const offset = (y * 8 + x) * 4;
      if (x < 4) expect([...renderer.pixels.slice(offset, offset + 4)]).toEqual([0, 0, 0, 0]);
      if (renderer.pixels[offset] === 128) faded++;
      expect(renderer.readDepthPixel(x, 7 - y)).toBe(1);
    }
    expect(faded).toBeGreaterThan(0);
    for (const invalid of [NaN, Infinity, -0.1, 1.1]) expect(() => renderer.withObjectOpacity(invalid, () => undefined)).toThrow("0..1");
  } finally { renderer.close(); }
});

test("CPU object opacity retains portal clipping and framebuffer alpha precision", () => {
  for (const alphaBits of [0, 8] satisfies readonly (0 | 8)[]) {
    const { renderer, white } = fixture(alphaBits);
    try {
      renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clipPlane: { x: 1, y: 0, z: 0, w: 0 },
        clear: { color: { x: 0, y: 0, z: 1, w: 0.4 }, depth: 1, stencil: true } });
      renderer.withObjectOpacity(0.5, () => {
        renderer.draw(triangle(white, 0, { x: 1, y: 0, z: 0, w: 0.2 }));
        return undefined;
      });
      expect(pixel(renderer)).toEqual([128, 0, 128, alphaBits === 0 ? 255 : 77]);
      expect([...renderer.pixels.slice((4 * 8 + 2) * 4, (4 * 8 + 3) * 4)])
        .toEqual([0, 0, 255, alphaBits === 0 ? 255 : 102]);
    } finally { renderer.close(); }
  }
});

test("CPU triangles write actual pixels and reject occluded depth", () => {
  const { renderer, white } = fixture();
  renderer.draw(triangle(white, 0, { x: 1, y: 0, z: 0, w: 1 }));
  renderer.draw(triangle(white, 0.5, { x: 0, y: 1, z: 0, w: 1 }));
  expect(pixel(renderer)).toEqual([255, 0, 0, 255]);
  expect(renderer.readDepthPixel(4, 3)).toBe(0.5);
});

test("CPU paired material combines texture and lightmap before alpha blending", () => {
  const { renderer, white, owner } = fixture();
  const image: RendererImage = { ...white, ordinal: 1 };
  renderer.applyImageResource({ kind: "create-image", image,
    content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 0 },
      levels: [{ width: 1, height: 1, pixels: new Uint8Array([128, 64, 32, 255]) }] },
    sampling: { filter: "nearest", wrap: "repeat" } });
  const base = triangle(white, 0, { x: 1, y: 1, z: 1, w: 1 });
  renderer.draw({ ...base, texturing: "pair", vertices: base.vertices.map(vertex => ({ ...vertex, texCoord2: vertex.texCoord })),
    secondTexture: { binding: { kind: "bind-image", image }, environment: "modulate" } });
  expect(pixel(renderer)).toEqual([128, 64, 32, 255]);
  const target = new CpuRenderTarget(renderer);
  target.execute({ owner, sequence: 0, commands: [
    { kind: "set-color", color: { x: 1, y: 0, z: 0, w: 0.5 } },
    { kind: "stretch-pic", image: white, rect: { x: 0, y: 0, width: 8, height: 8 }, uv: { s1: 0, t1: 0, s2: 1, t2: 1 } },
    { kind: "swap-buffers" },
  ] });
  expect(pixel(renderer)).toEqual([192, 32, 16, 191]);
});

test("parsed Q3 material evaluates into CPU pixels", async () => {
  const { renderer, white } = fixture();
  const registered: RegisteredImage = { frame: { image: white }, tmu: 0 };
  const compiled = await compileShaderScript(`cpu/material
  {
    cull none
    {
      map $whiteimage
      rgbGen const ( 0.25 0.5 1 )
    }
  }`, { whiteImage: registered, defaultImage: registered, lightmapImage: registered,
    findImage: async () => registered, playShaderCinematic: async () => null,
    applySun: () => {}, initializeSkyTexCoords: () => {}, printWarning: message => { throw new Error(message); } });
  const material = compiled[0];
  if (material === undefined) throw new Error("Shader was not compiled");
  const geometry = { indices: [0, 1, 2], vertices: [{ x: -1, y: -1, z: 0 }, { x: 1, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }].map(position => ({
    position, normal: { x: 0, y: 0, z: 1 }, texCoord: { x: 0.5, y: 0.5 }, lightmapCoord: { x: 0.5, y: 0.5 },
    color: { x: 255, y: 255, z: 255, w: 255 } })) };
  const batches = prepareMaterialBatches(material, geometry, {
    time: 0, timeOffset: 0, refdefTime: 0, identityLight: 1,
    entityRGBA: { x: 255, y: 255, z: 255, w: 255 }, lighting: null,
    viewOrigin: { x: 0, y: 0, z: 2 }, localViewOrigin: { x: 0, y: 0, z: 2 }, noise: new RendererNoise(),
    shaderTexCoord: { x: 0, y: 0 }, projectionShadow: null, renderText: [], depthRange: [0, 1], polygonOffset: null, fog: null,
    deformView: { axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
      mirror: false, entityAxis: null, nonNormalizedAxis: null },
    project: position => ({ ...position, w: 1 }),
  });
  for (const batch of batches) renderer.draw(batch);
  expect(pixel(renderer)).toEqual([63, 127, 255, 255]);
});

test("source tess arrays retain strip and discrete primitive execution", () => {
  for (const primitives of [1, 2, 3]) {
    const { renderer, white } = fixture();
    const batch = triangle(white, 0, { x: 0, y: 1, z: 0, w: 1 });
    if (batch.texturing !== "single" || batch.primitive !== "triangles") throw new Error("Expected triangle fixture");
    const scratch: readonly SourceStageCell[] = batch.vertices.map(vertex => ({ color: vertex.color, texCoord: vertex.texCoord,
      texCoord2: { x: 0, y: 0 }, rawTexCoord: vertex.texCoord, rawTexCoord2: { x: 0, y: 0 } }));
    renderer.beginSourceIterator(true, scratch);
    const draw = renderer.prepareSourceGeometry({ kind: "generic-single", stateBits: SourceStateBit.DEFAULT, batch, scratch });
    draw.begin(); draw.prepareTexture(0); draw.applyTexture(0, batch.texture); draw.finishTextures(); draw.draw(primitives); draw.cleanup();
    expect(pixel(renderer)).toEqual([0, 255, 0, 255]);
  }
});

test("Q1 true-color fog uses reconstructed depth and leaves classic pixels alone", () => {
  const { renderer, white } = fixture(), projection = perspectiveMat4(90, 1, 1, 128);
  const eyeZ = -64, clipZ = projection[10] * eyeZ + projection[14], w = -eyeZ;
  const batch = triangle(white, clipZ / w, { x: 1, y: 0, z: 0, w: 1 });
  renderer.draw(batch);
  const fog = { density: 1, color: { x: 0, y: 0, z: 1 } };
  renderer.applyQ1Fog(projection, fog, 0, "classic-indexed");
  expect(pixel(renderer)).toEqual([255, 0, 0, 255]);
  renderer.applyQ1Fog(projection, fog, 0);
  expect(pixel(renderer)).toEqual([94, 0, 161, 255]);
});

test("CPU depth atlas occludes Q2 world lights and removes model light shares before clamping", () => {
  const { renderer, white } = fixture();
  const image: RendererImage = { ...white, ordinal: 1, width: 8, height: 8 };
  renderer.applyImageResource({ kind: "create-image", image, content: { kind: "depth32f",
    levels: [{ width: 8, height: 8, pixels: new Float32Array(64).fill(1) }] }, sampling: { filter: "nearest", wrap: "clamp" } });
  const atlas: Q2ShadowAtlas = { image, texelSize: 1 / 8, nearPlane: 4 };
  const light: Q2FragmentLight = { origin: { x: 0, y: 0, z: 64 }, radius: 128, color: { x: 1, y: 0, z: 0 },
    scale: 1, cone: null, shadow: { kind: "cone", matrix: identityMat4(), atlasRect: { x: 0, y: 0, z: 1, w: 1 } } };
  const points = [{ x: 0.5, y: 0.5, z: 0.75 }, { x: 0.5, y: 0.5, z: 0.75 }, { x: 0.5, y: 0.5, z: 0.75 }];
  const batch: DrawBatch = { ...triangle(white, 0, { x: 0, y: 0, z: 0, w: 1 }),
    lighting: { kind: "q2-world", worldPositions: points, normals: points.map(() => ({ x: 0, y: 0, z: 1 })), pass: "texture", lights: [light], atlas } };
  renderer.draw(batch);
  expect(pixel(renderer)[0]).toBeGreaterThan(60);
  renderer.drawImmediate({ kind: "depth-atlas", image, passes: [{ viewport: { x: 0, y: 0, width: 8, height: 8 },
    clearDepth: 1, draws: [{ positions: [{ x: -1, y: -1, z: -0.5, w: 1 }, { x: 1, y: -1, z: -0.5, w: 1 },
      { x: 1, y: 1, z: -0.5, w: 1 }, { x: -1, y: 1, z: -0.5, w: 1 }],
      indices: [0, 1, 2, 0, 2, 3], cull: "none", polygonOffset: null }] }] });
  renderer.draw(batch);
  expect(pixel(renderer)).toEqual([0, 0, 0, 255]);
  renderer.draw({ ...triangle(white, 0, { x: 0.5, y: 0.5, z: 0.5, w: 1 }),
    lighting: { kind: "q2-model-shadow", worldPositions: points, shadeScale: 4, atlas,
      lights: [{ ...light, fraction: { x: 0.75, y: 0.5, z: 0 } }] } });
  expect(pixel(renderer)).toEqual([128, 255, 255, 255]);
});

test("Q2 fog commands blend global then height at scene depth and gate the flat sky pass", () => {
  const { owner, renderer, white } = fixture(), projection = perspectiveMat4(90, 1, 1, 128);
  renderer.draw(triangle(white, (projection[10] * -64 + projection[14]) / 64, { x: 1, y: 0, z: 0, w: 1 }));
  const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 },
    axis: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }], projection,
    viewport: { x: 0, y: 0, width: 8, height: 8 }, clip: { kind: "none" } };
  const operation: Q2FogOperation = { kind: "q2-fog", camera, farDepth: 1 - 1e-6, skyDrawn: false,
    fog: { kind: "q2", color: { x: 0, y: 0, z: 1 }, density: 1, skyFactor: 0.25,
      height: { start: { color: { x: 1, y: 0, z: 0 }, distance: 0 },
        end: { color: { x: 0, y: 1, z: 0 }, distance: 128 }, density: 0.02, falloff: 1 } } };
  const target = new CpuRenderTarget(renderer);
  target.execute({ owner, sequence: 0, commands: [{ kind: "view", view: {
    viewport: camera.viewport, clear: null, clipPlane: null, target: { kind: "preview", id: "fog" },
    time: { kind: "seconds", value: 0 }, beforeView: [], operations: [operation],
  } }] });
  // Source global blend gives [95,0,160,195]; height tint includes extinction.
  expect(pixel(renderer)).toEqual([89, 37, 87, 159]);
  expect([...renderer.pixels.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  const depth = renderer.readDepthPixel(4, 3);
  renderer.drawImmediate({ ...operation, skyDrawn: true,
    fog: { ...operation.fog, density: 0, height: { ...operation.fog.height, density: 0 } } });
  expect([...renderer.readRgba().pixels.slice(0, 4)]).toEqual([0, 0, 64, 16]);
  expect(pixel(renderer)).toEqual([89, 37, 87, 159]);
  expect(renderer.readDepthPixel(4, 3)).toBe(depth);
});

test("output gamma preserves raw rendering and repeated completion", () => {
  const { renderer } = fixture();
  const clear = (value: number) => renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clipPlane: null,
    clear: { color: { x: value, y: value, z: value, w: 0.25 }, depth: 1, stencil: false } });
  clear(64 / 255);
  const neutral = renderer.pixels;
  renderer.setOutputGamma(1); renderer.finish();
  expect(renderer.pixels).toBe(neutral);
  expect([...renderer.pixels.slice(0, 4)]).toEqual([64, 64, 64, 64]);
  renderer.setOutputGamma(2); renderer.finish();
  expect([...renderer.pixels.slice(0, 4)]).toEqual([128, 128, 128, 64]);
  renderer.finish(); expect(renderer.readRgba().pixels).toEqual(renderer.pixels);
  clear(16 / 255); new CpuRenderTarget(renderer).present();
  expect([...renderer.pixels.slice(0, 4)]).toEqual([64, 64, 64, 64]);
  renderer.setOutputGamma(1);
  expect(renderer.pixels).toBe(neutral);
  expect([...renderer.pixels.slice(0, 4)]).toEqual([16, 16, 16, 64]);
  expect(() => renderer.setOutputGamma(Number.NaN)).toThrow();
  renderer.close();
});
