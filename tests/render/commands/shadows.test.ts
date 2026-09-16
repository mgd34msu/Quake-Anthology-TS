import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DrawBatch, SceneFog } from "../../../src/contracts/render.ts";
import type { SceneLight } from "../../../src/contracts/scene.ts";
import { q2FogColor } from "../../../src/materials/legacy-fog.ts";
import { SoftwareRenderer, CPU_OPAQUE_STATE } from "../../../src/render/cpu/rasterizer.ts";
import { SceneImageRegistry, rgbaImage } from "../../../src/render/scene/resources.ts";
import { Q2ShadowScene, StaticShadowWorld, shadowCaster } from "../../../src/render/scene/shadows.ts";
import { aliasShadeDivisor, aliasShadowLightFractions } from "../../../src/render/scene/models/lighting.ts";
import { SdlWindow } from "../../../src/platform/sdl.ts";
import { GlRenderer } from "../../../src/render/gl/renderer.ts";

test("cone and cube depth producers shadow the receiver and rebuild moving casters", () => {
  for (const kind of ["point", "cone"]) {
    const identity = createIdentityOwner(`shadow-${kind}`), owner = { identity: Symbol(kind), session: identity.session, generation: 0 };
    const images = new SceneImageRegistry(owner), shadows = new Q2ShadowScene(images), renderer = new SoftwareRenderer(64, 64, owner);
    const white = images.register("white", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }), { wrap: "clamp", filter: "nearest" });
    const indices = [0, 1, 2, 0, 2, 3], blocker = { positions: [{ x: -16, y: -16, z: 32 }, { x: 16, y: -16, z: 32 },
      { x: 16, y: 16, z: 32 }, { x: -16, y: 16, z: 32 }], indices };
    const caster = shadowCaster({ x: 0, y: 0, z: 32 }, [blocker]);
    const light: SceneLight = { origin: { x: 0, y: 0, z: 64 }, color: { x: 1, y: 0.5, z: 0.25 }, radius: 192, additive: false,
      profile: { kind: "q2", scale: 1, cone: kind === "cone" ? { direction: { x: 0, y: 0, z: -1 }, cosHalfAngle: 0.5 } : null,
        shadow: { kind: "cast", resolution: 128 } } };
    const prepared = shadows.prepare([light], [], [caster]);
    for (const operation of images.drainOperations()) renderer.applyImageResource(operation);
    for (const operation of prepared.operations) {
      if (operation.kind !== "depth-atlas") throw new Error("Shadow preparation must produce depth atlas operations");
      renderer.drawImmediate(operation);
    }
    expect(prepared.stats.facesRendered).toBe(kind === "cone" ? 1 : 6);
    const receiver = [{ x: -64, y: -64, z: 0 }, { x: 64, y: -64, z: 0 }, { x: 64, y: 64, z: 0 }, { x: -64, y: 64, z: 0 }];
    const batch: DrawBatch = { primitive: "triangles", texturing: "single", indices, texture: { kind: "bind-image", image: white },
      state: { ...CPU_OPAQUE_STATE, cull: "none" }, lighting: { kind: "q2-world", worldPositions: receiver,
        normals: receiver.map(() => ({ x: 0, y: 0, z: 1 })), pass: "texture", ...prepared.lighting },
      vertices: receiver.map(position => ({ position: { x: position.x / 64, y: position.y / 64, z: 0, w: 1 },
        texCoord: { x: 0, y: 0 }, color: { x: 0, y: 0, z: 0, w: 1 } })) };
    renderer.beginView({ viewport: { x: 0, y: 0, width: 64, height: 64 }, clipPlane: null, clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false } });
    renderer.draw(batch);
    expect(renderer.pixels[(32 * 64 + 32) * 4]).toBe(0);
    expect(renderer.pixels[(32 * 64 + 59) * 4]).toBeGreaterThan(20);
    const atlas = prepared.lighting.atlas;
    if (atlas === null) throw new Error("Shadow receiver has no atlas");
    const shade = { x: 0.8, y: 0.4, z: 0.2 }, shadeScale = aliasShadeDivisor(shade);
    const model: DrawBatch = { ...batch, lighting: { kind: "q2-model-shadow", worldPositions: receiver, atlas, shadeScale,
      lights: aliasShadowLightFractions({ x: 0, y: 0, z: 0 }, shade, prepared.lighting.lights) },
      vertices: batch.vertices.map(vertex => ({ ...vertex, color: { x: 1, y: 0.5, z: 0.25, w: 1 } })) };
    renderer.draw(model);
    expect(renderer.pixels[(32 * 64 + 32) * 4]).toBeCloseTo(153, -1);
    expect(renderer.pixels[(32 * 64 + 59) * 4]).toBe(255);
    expect(shadows.prepare([light], [], [caster]).stats.cachedLights).toBe(1);
    const moved = shadowCaster({ x: 80, y: 0, z: 32 }, [{ ...blocker, positions: blocker.positions.map(point => ({ ...point, x: point.x + 80 })) }]);
    const rebuilt = shadows.prepare([light], [], [moved]);
    expect(rebuilt.stats.rebuiltLights).toBe(1);
    for (const operation of rebuilt.operations) {
      if (operation.kind !== "depth-atlas") throw new Error("Shadow preparation must produce depth atlas operations");
      renderer.drawImmediate(operation);
    }
    renderer.beginView({ viewport: { x: 0, y: 0, width: 64, height: 64 }, clipPlane: null, clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false } });
    renderer.draw(batch);
    expect(renderer.pixels[(32 * 64 + 32) * 4]).toBeGreaterThan(20);
    shadows.close(); images.close(); renderer.close();
  }
});

test("Q2 height tint includes its extinction before blending", () => {
  const fog: Extract<SceneFog, { readonly kind: "q2" }> = { kind: "q2", density: 0, color: { x: 0, y: 0, z: 0 }, skyFactor: 0,
    height: { density: 1, falloff: 1, start: { distance: 0, color: { x: 1, y: 0, z: 0 } }, end: { distance: 2, color: { x: 0, y: 0, z: 1 } } } };
  const extinction = 1 - Math.exp(-(1 - Math.exp(-1))), expected = 0.5 * extinction * extinction * (1 - Math.exp(-1));
  const color = q2FogColor({ x: 0, y: 0, z: 0 }, fog, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 1, false);
  expect(color.x).toBeCloseTo(expected, 12); expect(color.z).toBeCloseTo(expected, 12);
});

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("GL draws the shared cone and cube caster operations", () => {
  using window = SdlWindow.open({ title: "Scene shadow producer", width: 64, height: 64, backend: "gl", hidden: true, stencilBits: 8 });
  const owner = { identity: Symbol("shadow producer"), session: createIdentityOwner("shadow producer").session, generation: 0 };
  using renderer = new GlRenderer(window, owner);
  const images = new SceneImageRegistry(owner), shadows = new Q2ShadowScene(images);
  const white = images.register("white", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }), { wrap: "clamp", filter: "nearest" });
  const indices = [0, 1, 2, 0, 2, 3];
  const point: SceneLight = { origin: { x: 0, y: 0, z: 64 }, color: { x: 1, y: 0.5, z: 0.25 }, radius: 192, additive: false,
    profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "cast", resolution: 128 } } };
  const cone: SceneLight = { ...point, profile: { kind: "q2", scale: 1, cone: { direction: { x: 0, y: 0, z: -1 }, cosHalfAngle: 0.5 },
    shadow: { kind: "cast", resolution: 128 } } };
  const prepared = shadows.prepare([point, cone], [{ positions: [{ x: -16, y: -16, z: 32 }, { x: 16, y: -16, z: 32 },
    { x: 16, y: 16, z: 32 }, { x: -16, y: 16, z: 32 }], indices }], []);
  for (const operation of images.drainOperations()) renderer.applyImageResource(operation);
  for (const operation of prepared.operations) {
    if (operation.kind !== "depth-atlas") throw new Error("Shadow preparation must produce depth atlas operations");
    renderer.drawImmediate(operation);
  }
  const positions = [{ x: -64, y: -64, z: 0 }, { x: 64, y: -64, z: 0 }, { x: 64, y: 64, z: 0 }, { x: -64, y: 64, z: 0 }];
  const batch: DrawBatch = { primitive: "triangles", texturing: "single", indices, texture: { kind: "bind-image", image: white },
    state: { ...CPU_OPAQUE_STATE, cull: "none" }, lighting: { kind: "q2-world", worldPositions: positions,
      normals: positions.map(() => ({ x: 0, y: 0, z: 1 })), pass: "texture", ...prepared.lighting },
    vertices: positions.map(position => ({ position: { x: position.x / 64, y: position.y / 64, z: 0, w: 1 },
      texCoord: { x: 0, y: 0 }, color: { x: 0, y: 0, z: 0, w: 1 } })) };
  renderer.beginView({ viewport: { x: 0, y: 0, width: 64, height: 64 }, clipPlane: null,
    clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false } });
  const geometry = renderer.prepareGeometry(batch); geometry.begin();
  try { geometry.applyTexture(0, batch.texture); geometry.draw(); } finally { geometry.cleanup(); }
  const pixels = renderer.readPixels();
  expect(prepared.stats.facesRendered).toBe(7);
  expect(pixels[(32 * 64 + 32) * 4]).toBe(0);
  expect(pixels[(32 * 64 + 59) * 4]).toBeGreaterThan(40);
  expect(renderer.getError()).toBe(0);
  shadows.close(); images.close();
});

function checkAxisSpanningCaster(renderer: SoftwareRenderer | GlRenderer, images: SceneImageRegistry): void {
  const shadows = new Q2ShadowScene(images);
  const white = images.register("cone-receiver", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }), { wrap: "clamp", filter: "nearest" });
  const light: SceneLight = { origin: { x: 0, y: 0, z: 132 }, radius: 256, color: { x: 1, y: 1, z: 1 }, additive: false,
    profile: { kind: "q2", scale: 1, cone: { direction: { x: 0, y: 0, z: -1 }, cosHalfAngle: 0.99 }, shadow: { kind: "cast", resolution: 128 } } };
  const indices = [0, 1, 2, 0, 2, 3];
  const caster = (halfSize: number, x = 0) => shadowCaster({ x, y: 0, z: 32 }, [{ indices,
    positions: [{ x: x - halfSize, y: -halfSize, z: 32 }, { x: x + halfSize, y: -halfSize, z: 32 },
      { x: x + halfSize, y: halfSize, z: 32 }, { x: x - halfSize, y: halfSize, z: 32 }] }]);
  const receiver = [{ x: -16, y: -16, z: 0 }, { x: 16, y: -16, z: 0 }, { x: 16, y: 16, z: 0 }, { x: -16, y: 16, z: 0 }];
  const cases = [{ body: caster(4), retained: 1 }, { body: caster(45), retained: 1 }, { body: caster(45, 120), retained: 0 }];
  try {
    for (const { body, retained } of cases) {
      const prepared = shadows.prepare([light], [], [body]);
      for (const operation of images.drainOperations()) renderer.applyImageResource(operation);
      for (const operation of prepared.operations) {
        if (operation.kind !== "depth-atlas") throw new Error("Expected a depth atlas");
        renderer.drawImmediate(operation);
      }
      const batch: DrawBatch = { primitive: "triangles", texturing: "single", indices, texture: { kind: "bind-image", image: white },
        state: { ...CPU_OPAQUE_STATE, cull: "none" }, lighting: { kind: "q2-world", worldPositions: receiver,
          normals: receiver.map(() => ({ x: 0, y: 0, z: 1 })), pass: "texture", ...prepared.lighting },
        vertices: receiver.map(position => ({ position: { x: position.x / 16, y: position.y / 16, z: 0, w: 1 },
          texCoord: { x: 0, y: 0 }, color: { x: 0, y: 0, z: 0, w: 1 } })) };
      renderer.beginView({ viewport: { x: 0, y: 0, width: 64, height: 64 }, clipPlane: null,
        clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false } });
      if (renderer instanceof SoftwareRenderer) renderer.draw(batch);
      else {
        const geometry = renderer.prepareGeometry(batch); geometry.begin();
        try { geometry.applyTexture(0, batch.texture); geometry.draw(); } finally { geometry.cleanup(); }
      }
      const pixels = renderer instanceof SoftwareRenderer ? renderer.pixels : renderer.readPixels();
      if (retained === 1) expect(pixels[(32 * 64 + 32) * 4]).toBe(0);
      else expect(pixels[(32 * 64 + 32) * 4]).toBeGreaterThan(20);
      expect(prepared.stats.entityCasters).toBe(retained);
      expect(prepared.stats.facesRendered).toBe(1);
      const cached = shadows.prepare([light], [], [body]);
      expect(cached.stats.cachedLights).toBe(1);
      expect(cached.operations).toHaveLength(0);
    }
    if (renderer instanceof GlRenderer) expect(renderer.getError()).toBe(0);
  } finally { shadows.close(); }
}

test("CPU retains growing cone-axis casters and rejects a sphere outside the cone", () => {
  const owner = { identity: Symbol("cone-axis-cpu"), session: createIdentityOwner("cone-axis-cpu").session, generation: 0 };
  const images = new SceneImageRegistry(owner), renderer = new SoftwareRenderer(64, 64, owner);
  try { checkAxisSpanningCaster(renderer, images); } finally { images.close(); renderer.close(); }
});

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("GL retains growing cone-axis casters and rejects a sphere outside the cone", () => {
  using window = SdlWindow.open({ title: "Cone-axis caster", width: 64, height: 64, backend: "gl", hidden: true, stencilBits: 8 });
  const owner = { identity: Symbol("cone-axis-gl"), session: createIdentityOwner("cone-axis-gl").session, generation: 0 };
  using renderer = new GlRenderer(window, owner);
  const images = new SceneImageRegistry(owner);
  try { checkAxisSpanningCaster(renderer, images); } finally { images.close(); }
});

test("static world snapshots preserve digest signatures and isolate mutable source meshes", () => {
  const owner = { identity: Symbol("static-world"), session: createIdentityOwner("static-world").session, generation: 0 };
  const images = new SceneImageRegistry(owner), shadows = new Q2ShadowScene(images);
  const mesh = { positions: [{ x: 0, y: 0, z: 32 }, { x: 16, y: 0, z: 32 }, { x: 0, y: 16, z: 32 }], indices: [0, 1, 2] };
  const snapshot = new StaticShadowWorld([mesh]);
  const light: SceneLight = { origin: { x: 0, y: 0, z: 64 }, color: { x: 1, y: 1, z: 1 }, radius: 192, additive: false,
    profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "cast", resolution: 128 } } };
  try {
    expect(shadows.prepare([light], [mesh], []).stats.rebuiltLights).toBe(1);
    expect(shadows.prepare([light], snapshot, []).stats.cachedLights).toBe(1);
    const digest = snapshot.digest;
    mesh.positions[0] = { x: 80, y: 0, z: 32 }; mesh.indices.reverse();
    expect(snapshot.digest).toBe(digest);
    expect(snapshot.meshes[0]?.indices).toEqual([0, 1, 2]);
    expect(Object.isFrozen(snapshot.meshes[0]?.positions[0])).toBe(true);
    expect(shadows.prepare([light], snapshot, []).stats.cachedLights).toBe(1);
    expect(shadows.prepare([light], [mesh], []).stats.rebuiltLights).toBe(1);
    shadows.prepare([light], snapshot, [], { enabled: false });
    expect(shadows.prepare([light], snapshot, []).stats.rebuiltLights).toBe(1);
    expect(shadows.prepare([light], [], []).stats.rebuiltLights).toBe(1);
    expect(shadows.prepare([light], new StaticShadowWorld([]), []).stats.cachedLights).toBe(1);
  } finally { shadows.close(); images.close(); }
});

function checkModelConeLighting(renderer: SoftwareRenderer | GlRenderer, images: SceneImageRegistry): void {
  const shadows = new Q2ShadowScene(images), indices = [0, 1, 2, 0, 2, 3];
  const skin = images.register("model-cone-skin", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([128, 64, 32, 128]) }), { wrap: "clamp", filter: "nearest" });
  const positions = [{ x: -64, y: -64, z: 0 }, { x: 64, y: -64, z: 0 }, { x: 64, y: 64, z: 0 }, { x: -64, y: 64, z: 0 }];
  const blocker = { positions: [{ x: -4, y: -4, z: 32 }, { x: 4, y: -4, z: 32 }, { x: 4, y: 4, z: 32 }, { x: -4, y: 4, z: 32 }], indices };
  const point: SceneLight = { origin: { x: 0, y: 0, z: 64 }, radius: 512, color: { x: 1, y: 1, z: 1 }, additive: true,
    profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "cast", resolution: 128 } } };
  const cone: SceneLight = { ...point, profile: { kind: "q2", scale: 2, cone: { direction: { x: 0, y: 0, z: -1 }, cosHalfAngle: Math.cos(22 * Math.PI / 180) }, shadow: { kind: "cast", resolution: 128 } } };
  try {
    const prepared = shadows.prepare([point, cone], [blocker], []);
    for (const operation of images.drainOperations()) renderer.applyImageResource(operation);
    for (const operation of prepared.operations) {
      if (operation.kind !== "depth-atlas") throw new Error("Expected model-light depth atlas operation");
      renderer.drawImmediate(operation);
    }
    const atlas = prepared.lighting.atlas;
    if (atlas === null) throw new Error("Missing real model shadow atlas");
    const outputs: Uint8Array[] = [];
    for (const blended of [false, true]) for (const enabled of [false, true]) {
      const batch: DrawBatch = { primitive: "triangles", texturing: "single", indices, texture: { kind: "bind-image", image: skin },
        state: { ...CPU_OPAQUE_STATE, cull: "none", blend: blended ? { source: "src-alpha", destination: "one-minus-src-alpha" } : CPU_OPAQUE_STATE.blend }, lighting: { kind: "q2-world", pass: "model", shadeScale: 1, worldPositions: positions,
          normals: positions.map(() => ({ x: 0, y: 0, z: 1 })), atlas,
          lights: prepared.lighting.lights.map(light => ({ ...light, color: light.cone === null ? { x: 0, y: 0, z: 0 } : light.color,
            scale: light.cone === null || !enabled ? 0 : light.scale, fraction: light.cone === null ? { x: 0.25, y: 0.25, z: 0.25 } : { x: 0, y: 0, z: 0 } })) },
        vertices: positions.map(position => ({ position: { x: position.x / 64, y: position.y / 64, z: 0, w: 1 }, texCoord: { x: 0, y: 0 }, color: { x: 0.4, y: 0.4, z: 0.4, w: 0.5 } })) };
      renderer.beginView({ viewport: { x: 0, y: 0, width: 64, height: 64 }, clipPlane: null, clear: { color: { x: 0.2, y: 0.4, z: 0.6, w: 0 }, depth: 1, stencil: false } });
      if (renderer instanceof SoftwareRenderer) renderer.draw(batch);
      else { const draw = renderer.prepareGeometry(batch); draw.begin(); try { draw.applyTexture(0, batch.texture); draw.draw(); } finally { draw.cleanup(); } }
      outputs.push(new Uint8Array(renderer instanceof SoftwareRenderer ? renderer.pixels : renderer.readPixels()));
    }
    const [off, on, blendedOff, blendedOn] = outputs;
    if (off === undefined || on === undefined || blendedOff === undefined || blendedOn === undefined) throw new Error("Missing model-light pixels");
    const pixel = (x: number) => (32 * 64 + x) * 4;
    expect(on[pixel(32)]).toBe(off[pixel(32)]); // Real occluder blocks both contributions.
    expect(on[pixel(41)] ?? 0).toBeGreaterThan((off[pixel(41)] ?? 0) + 10);
    expect(on[pixel(59)]).toBe(off[pixel(59)]); // Outside the authored cone.
    expect(on[pixel(41) + 3]).toBe(off[pixel(41) + 3]);
    if (renderer instanceof SoftwareRenderer) expect(on[pixel(41) + 3]).toBeCloseTo(64, -1);
    const sourceAlpha = (128 / 255) * 0.5;
    for (const [opaque, blended] of [[off, blendedOff], [on, blendedOn]]) {
      if (opaque === undefined || blended === undefined) throw new Error("Missing blend comparison");
      for (const [channel, background] of [0.2, 0.4, 0.6].entries()) {
        const expected = (opaque[pixel(41) + channel] ?? 0) * sourceAlpha + background * 255 * (1 - sourceAlpha);
        expect(Math.abs((blended[pixel(41) + channel] ?? 0) - expected)).toBeLessThanOrEqual(2);
      }
    }
    if (renderer instanceof GlRenderer) expect(renderer.getError()).toBe(0);
  } finally { shadows.close(); }
}

test("CPU model spotlight preserves point shadows, skin modulation and alpha", () => {
  const owner = { identity: Symbol("model-light-cpu"), session: createIdentityOwner("model-light-cpu").session, generation: 0 };
  const images = new SceneImageRegistry(owner), renderer = new SoftwareRenderer(64, 64, owner);
  try { checkModelConeLighting(renderer, images); } finally { renderer.close(); images.close(); }
});
test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("GL model spotlight preserves point shadows, skin modulation and alpha", () => {
  using window = SdlWindow.open({ title: "Model spotlight", width: 64, height: 64, backend: "gl", hidden: true, stencilBits: 8 });
  const owner = { identity: Symbol("model-light-gl"), session: createIdentityOwner("model-light-gl").session, generation: 0 };
  using renderer = new GlRenderer(window, owner);
  const images = new SceneImageRegistry(owner);
  try { checkModelConeLighting(renderer, images); } finally { images.close(); }
});

test("inactive dynamic lights do not require or sample a shadow atlas", async () => {
  const { shadeQ2Fragment } = await import("../../../src/render/cpu/lighting.ts");
  const { identityMat4 } = await import("../../../src/core/math.ts");
  const position = { x: 0, y: 0, z: 0 }, normal = { x: 0, y: 0, z: 1 }, vertex = { x: 0.5, y: 0.25, z: 1, w: 0.5 };
  for (const inactive of [{ scale: 0, color: { x: 1, y: 1, z: 1 } }, { scale: 2, color: { x: 0, y: 0, z: 0 } }]) {
    const parameters: DrawBatch["lighting"] = { kind: "q2-world", pass: "texture", worldPositions: [position], normals: [normal], atlas: null,
      lights: [{ ...inactive, origin: { x: 0, y: 0, z: 64 }, radius: 512, cone: null,
        shadow: { kind: "cone", matrix: identityMat4(), atlasRect: { x: 0, y: 0, z: 1, w: 1 } } }] };
    expect(shadeQ2Fragment({ parameters, depth: null }, position, normal, vertex, { r: 0.4, g: 0.8, b: 0.1, a: 0.6 }))
      .toEqual({ r: 0.2, g: 0.2, b: 0.1, a: 0.3 });
  }
});
