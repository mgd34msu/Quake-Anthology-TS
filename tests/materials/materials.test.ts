import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import { SceneShaderRegistry } from "../../src/render/scene/shaders.ts";
import { encodePng } from "../../src/formats/images/png.ts";
import { prepareMaterialText } from "../../src/render/commands/material2d.ts";
import { SoftwareRenderer } from "../../src/render/cpu/rasterizer.ts";
import { describe, expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RendererImage, RendererResourceOwner } from "../../src/contracts/render.ts";
import { compileImplicitMaterial, compileShaderScript, DEFAULT_SHADER_PROFILE, shaderSurfaceFlags } from "../../src/materials/compile.ts";
import { RendererNoise } from "../../src/materials/deform.ts";
import { prepareMaterialBatches } from "../../src/materials/evaluate.ts";
import type { MaterialDrawContext } from "../../src/materials/evaluate.ts";
import type { MaterialGeometry } from "../../src/materials/geometry.ts";
import { buildQ1Lightmap, buildQ2Lightmap, directLightmapPixels, lightmapCoordinates, q1LightStyle, q2LightStyle } from "../../src/materials/lighting.ts";
import type { LightmapFace, Q1LightmapEncoding } from "../../src/materials/lighting.ts";
import { evaluateTexCoords, evaluateWaveform, parseShaderScript } from "../../src/materials/material.ts";
import type { RegisteredImage, ShaderRegistrationHost } from "../../src/materials/material.ts";
import { createQ1Material, createQ2Material, prepareLegacyMaterialBatches, q1AnimatedTexture, q1TextureAnimations } from "../../src/materials/legacy.ts";
import { q2LightGridPoint } from "../../src/materials/q2-lightgrid.ts";
import type { Q2Lightgrid } from "../../src/contracts/scene.ts";
import { cloudTexCoord } from "../../src/materials/sky.ts";

const owner: RendererResourceOwner = { identity: Symbol("material-test"), session: createIdentityOwner("material-test").session, generation: 0 };
function image(name: string, ordinal: number): RendererImage {
  return { owner, ordinal, source: { kind: "generated", name }, width: 4, height: 4 };
}
function registered(name: string, ordinal: number): RegisteredImage { return { frame: { image: image(name, ordinal) }, tmu: ordinal === 2 ? 1 : 0 }; }
const white = registered("white", 0), base = registered("base", 1), lightmap = registered("lightmap", 2);
const host: ShaderRegistrationHost = {
  whiteImage: white, defaultImage: base, lightmapImage: lightmap,
  async findImage() { return base; }, async playShaderCinematic() { return null; },
  applySun() {}, initializeSkyTexCoords() {}, printWarning() {},
};
const vertex = { position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, texCoord: { x: 0.25, y: 0.5 },
  lightmapCoord: { x: 0.75, y: 0.25 }, color: { x: 255, y: 128, z: 64, w: 255 } };
const geometry: MaterialGeometry = { vertices: [vertex, { ...vertex, position: { x: 1, y: 0, z: 0 } }, { ...vertex, position: { x: 0, y: 1, z: 0 } }], indices: [0, 1, 2] };
const context: MaterialDrawContext = {
  time: 2, timeOffset: 0, refdefTime: 2000, identityLight: 1, entityRGBA: { x: 255, y: 255, z: 255, w: 255 },
  lighting: null, viewOrigin: { x: 0, y: 0, z: 10 }, localViewOrigin: { x: 0, y: 0, z: 10 }, noise: new RendererNoise(),
  shaderTexCoord: { x: 0, y: 0 }, deformView: { axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    mirror: false, entityAxis: null, nonNormalizedAxis: null }, projectionShadow: null, renderText: [], depthRange: [0, 1], polygonOffset: null,
  fog: null, project(position) { return { ...position, w: 1 }; },
};

const script = `textures/example/stone
{
  surfaceparm metalsteps
  {
    map $lightmap
    rgbGen identity
  }
  {
    map textures/example/stone.tga
    blendFunc filter
    rgbGen identity
  }
}
textures/example/liquid
{
  surfaceparm water
  cull none
  deformVertexes wave 100 sin 0 2 0 0.5
  {
    animMap 2 textures/example/a.tga textures/example/b.tga
    blendFunc blend
    rgbGen wave triangle 0.5 0.5 0 1
    tcMod scale 2 3
    tcMod scroll 0.25 -0.5
  }
}`;

describe("source material paths", () => {
  test("parses ordered stages and compiles a lightmap/base pair", async () => {
    const materials = await compileShaderScript(script, host, { lightmapIndex: 0 });
    const material = materials[0], liquid = materials[1];
    if (material === undefined || liquid === undefined) throw new Error("Shader fixture did not compile");
    expect(material.material.stages).toHaveLength(2);
    expect(material.finished.numUnfoggedPasses).toBe(1);
    expect(material.finished.iterator.multitextureEnv).toBe("modulate");
    expect(material.material.stages[0]?.sourceState.isLightmap).toBe(true);
    const batches = prepareMaterialBatches(material, geometry, context), batch = batches[0];
    if (batch?.texturing !== "pair") throw new Error("Expected a two-texture draw batch");
    expect(batch.vertices[0]?.texCoord).toEqual(vertex.texCoord);
    expect(batch.vertices[0]?.texCoord2).toEqual(vertex.lightmapCoord);
    expect(liquid.material.deformations[0]?.kind).toBe("wave");
    expect(liquid.material.stages[0]?.map.kind).toBe("animation");
    expect(shaderSurfaceFlags(liquid.material.surfaceParameters)).toEqual({ surface: 0, contents: 32, clearSolid: true });
  });

  test("evaluates source lookup waves and texture modifiers in authored order", () => {
    const material = parseShaderScript(script)[1], stage = material?.stages[0];
    if (stage === undefined) throw new Error("Missing liquid stage");
    expect(evaluateTexCoords(stage, vertex.texCoord, vertex.position, vertex.normal, 1)).toEqual({ x: 0.75, y: 2 });
    expect(evaluateWaveform({ kind: "triangle", base: 0, amplitude: 1, phase: 0.25, frequency: 0 }, 0)).toBe(1);
    expect(Number.isFinite(cloudTexCoord(4, 0.5, 0.5, 512).x)).toBe(true);
  });

  test("implicit picture shaders disable depth writes and retain vertex alpha", () => {
    const compiled = compileImplicitMaterial({ kind: "picture", name: "ui/icon", baseImage: { kind: "loaded", tmu: 0,
      binding: { kind: "images", playback: { kind: "single", image: base.frame } } }, profile: DEFAULT_SHADER_PROFILE });
    const batch = prepareMaterialBatches(compiled, geometry, context)[0];
    expect(batch?.state.depthTest).toBe("always");
    expect(batch?.state.depthWrite).toBe(false);
    expect(batch?.vertices[0]?.color.y).toBe(128 / 255);
  });

  test("Q1 and Q2 lightstyles keep different scaling and lightmap encodings", () => {
    expect(q1LightStyle("m", 0)).toBe(264);
    expect(q1LightStyle("am", 0.05, 1)).toBe(0);
    expect(q1LightStyle("am", 0.05, 2)).toBe(132);
    expect(q2LightStyle("m", 0)).toEqual({ rgb: { x: 1, y: 1, z: 1 }, white: 3 });
    const face: LightmapFace = { width: 1, height: 1, lighting: { kind: "luminance8", samples: new Uint8Array([64]) }, offset: 0,
      styles: [0, 255], plane: { normal: { x: 0, y: 0, z: 1 }, distance: 0 },
      projection: { kind: "classic", texture: { s: { x: 1, y: 0, z: 0, w: 0 }, t: { x: 0, y: 1, z: 0, w: 0 } }, textureMins: { x: 0, y: 0 } } };
    const q1 = buildQ1Lightmap(face, [256]);
    expect([...q1.image.pixels]).toEqual([127, 127, 127, 255]);
    expect([...directLightmapPixels(q1).pixels]).toEqual([128, 128, 128, 255]);
    const q2 = buildQ2Lightmap({ ...face, lighting: { kind: "rgb8", source: "bspx", samples: new Uint8Array([200, 100, 50]) } }, [q2LightStyle("m", 0)], { modulate: 2 });
    expect([...q2.image.pixels]).toEqual([255, 127, 63, 255]);
    expect(lightmapCoordinates({ x: 4, y: 8, z: 0 }, { kind: "decoupled", mapping: { width: 16, height: 16, lightingOffset: 0,
      axes: [{ x: 0.5, y: 0, z: 0 }, { x: 0, y: 0.25, z: 0 }], offset: { x: 1, y: 2 } } })).toEqual({ x: 3, y: 4 });
  });

  test("BSPX octree lighting interpolates RGB without tripling monochrome styles", () => {
    const grid: Q2Lightgrid = { spacing: { x: 1, y: 1, z: 1 }, scale: { x: 1, y: 1, z: 1 }, min: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 2 }, styleCount: 1, root: { kind: "leaf", index: 0 }, nodes: [],
      leaves: [{ min: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, firstSample: 0, pointCount: 8 }],
      samples: [10, 20, 30, 40, 50, 60, 70, 80].map(value => ({ style: 0, rgb: { x: value, y: value, z: value } })) };
    const color = q2LightGridPoint(grid, { x: 0.5, y: 0.5, z: 0.5 }, [q2LightStyle("m", 0)]);
    expect(color?.x).toBeCloseTo(45 / 255, 6);
    expect(color?.y).toBe(color?.x);
  });

  test("Q1 alternate frames and fullbright overlay survive material preparation", () => {
    const frames = q1TextureAnimations("+0button", [{ name: "+0button", image: base.frame.image },
      { name: "+1button", image: lightmap.frame.image }, { name: "+Abutton", image: white.frame.image }]);
    const material = createQ1Material("+0button", base.frame.image, { kind: "unlit" }, frames);
    expect(q1AnimatedTexture(material, 0.25, false)).toBe(lightmap.frame.image);
    expect(q1AnimatedTexture(material, 0.25, true)).toBe(white.frame.image);
    const batches = prepareLegacyMaterialBatches(material, geometry, { time: 0, animationFrame: 0, alternateAnimation: false,
      fullbright: white.frame.image, q1LightmapEncoding: "rgb", cull: "front", depthRange: [0, 1], project: context.project });
    expect(batches).toHaveLength(2);
    expect(batches[1]?.state.depthTest).toBe("equal");
    expect(batches[1]?.state.depthWrite).toBe(false);
    expect(batches[1]?.vertices[0]?.color).toEqual({ x: 1, y: 1, z: 1, w: 1 });
  });

  test("opaque legacy lightmaps retain separate numeric passes with one projection per vertex", () => {
    const lighting = { kind: "lightmap", image: lightmap.frame.image, styles: [0] } satisfies Parameters<typeof createQ1Material>[2];
    const materials = [createQ1Material("stone", base.frame.image, lighting), createQ2Material("stone", [base.frame.image], lighting)];
    const encodings: readonly Q1LightmapEncoding[] = ["rgb", "inverted-alpha", "inverted-luminance"];
    const varied: MaterialGeometry = { indices: [2, 0, 1], vertices: geometry.vertices.map((source, index) => ({ ...source,
      texCoord: { x: index / 4, y: (index + 1) / 8 }, lightmapCoord: { x: (index + 2) / 8, y: index / 2 },
      color: { x: index * 50, y: 200 - index * 30, z: 128, w: 255 } })) };
    for (const material of materials) for (const encoding of encodings) {
      let projections = 0;
      const batches = prepareLegacyMaterialBatches(material, varied, { time: 0, animationFrame: 0, alternateAnimation: false,
        fullbright: white.frame.image, q1LightmapEncoding: encoding, cull: "back", depthRange: [0.125, 0.875],
        entityRGBA: { x: 128, y: 64, z: 32, w: 255 }, project(position) {
          projections++; return { x: position.x * 2 + 3, y: position.y * 4 - 1, z: position.z + 0.5, w: 2 };
        } });
      expect(projections).toBe(3);
      expect(batches).toHaveLength(3);
      const [texture, illumination, fullbright] = batches;
      if (texture === undefined || illumination === undefined || fullbright === undefined) throw new Error("Missing legacy passes");
      const positions = [{ x: 3, y: -1, z: 0.5, w: 2 }, { x: 5, y: -1, z: 0.5, w: 2 }, { x: 3, y: 3, z: 0.5, w: 2 }];
      for (const batch of batches) {
        expect(batch.vertices.map(value => value.position)).toEqual(positions);
        expect(batch.indices).toEqual([2, 0, 1]);
        expect(batch.texturing).toBe("single");
        expect(batch.lighting).toEqual({ kind: "vertex" });
      }
      expect(texture.vertices.map(value => value.texCoord)).toEqual([{ x: 0, y: 0.125 }, { x: 0.25, y: 0.25 }, { x: 0.5, y: 0.375 }]);
      expect(illumination.vertices.map(value => value.texCoord)).toEqual([{ x: 0.25, y: 0 }, { x: 0.375, y: 0.5 }, { x: 0.5, y: 1 }]);
      expect(texture.vertices.map(value => value.color)).toEqual(Array.from({ length: 3 }, () => ({ x: 128 / 255, y: 64 / 255, z: 32 / 255, w: 1 })));
      expect(illumination.vertices.map(value => value.color)).toEqual(Array.from({ length: 3 }, () => ({ x: 1, y: 1, z: 1, w: 1 })));
      expect(fullbright.vertices).toEqual(texture.vertices);
      expect(illumination.texture).toEqual({ kind: "bind-image", image: lightmap.frame.image });
      expect(illumination.state).toEqual({ ...texture.state, depthTest: "equal", depthWrite: false, alphaTest: "none",
        blend: material.kind === "q1" && encoding !== "rgb" ? { source: "zero", destination: encoding === "inverted-alpha" ? "one-minus-src-alpha" : "one-minus-src-color" }
          : { source: "dst-color", destination: "zero" } });
    }
  });
});


test("mipmapped implicit pictures retain 2D alpha blending and native first-registration sampling", async () => {
  const images = new SceneImageRegistry(owner);
  const pixels = Uint8Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 128 : 255);
  const png = encodePng(4, 4, pixels);
  const textures = new SceneTextureLoader(images, { read: async path => path.endsWith(".png") ? { bytes: png, source: { kind: "generated", name: path } } : null });
  const registry = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:test"));
  const picture = await registry.registerPicture("icons/noammo-fixture", true);
  expect(picture.material.compiled.material.stages[0]?.color.kind).toBe("vertex");
  expect(picture.material.compiled.material.stages[0]?.blend).toEqual({ source: "src-alpha", destination: "one-minus-src-alpha" });
  expect((await registry.registerPicture("icons/noammo-fixture", false)).material.compiled).toBe(picture.material.compiled);
  const noMip = await registry.registerPicture("icons/default-preview");
  expect(noMip.material.compiled.material.stages[0]?.color.kind).toBe("vertex");
  const operations = images.drainOperations();
  const mip = operations.find(operation => operation.kind === "create-image" && operation.image.source.kind === "generated" && operation.image.source.name === "icons/noammo-fixture.png");
  if (mip?.kind !== "create-image") throw new Error("Missing mipmapped image registration");
  expect(mip.content.levels).toHaveLength(3); expect(mip.sampling.wrap).toBe("repeat");
  const preview = operations.find(operation => operation.kind === "create-image" && operation.image.source.kind === "generated" && operation.image.source.name === "icons/default-preview.png");
  if (preview?.kind !== "create-image") throw new Error("Missing default preview image");
  expect(preview.content.levels).toHaveLength(1); expect(preview.sampling.wrap).toBe("clamp");
  const renderer = new SoftwareRenderer(4, 4, owner);
  try {
    for (const operation of operations) renderer.applyImageResource(operation);
    const rect = { x: 0, y: 0, width: 4, height: 4 };
    renderer.beginView({ viewport: rect, clipPlane: null, clear: { color: { x: 0, y: 0, z: 1, w: 1 }, depth: 1, stencil: true } });
    for (const batch of prepareMaterialText({ seat: createIdentityOwner("picture").seat(0), rect, uv: { s: 0, t: 0, s2: 1, t2: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, picture }, rect, context)) renderer.draw(batch);
    expect(Array.from(renderer.pixels.slice(20, 23))).toEqual([128, 128, 255]);
  } finally { renderer.close(); }
});
