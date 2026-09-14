import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner, RenderState, RenderVertex } from "../../../src/contracts/render.ts";
import { SdlWindow } from "../../../src/platform/sdl.ts";
import { CPU_OPAQUE_STATE, SoftwareRenderer } from "../../../src/render/cpu/index.ts";
import { GlRenderer } from "../../../src/render/gl/renderer.ts";

const cases: readonly { blend: RenderState["blend"]; expected: readonly number[] }[] = [
  { blend: { source: "src-alpha", destination: "one-minus-src-alpha" }, expected: [160, 32, 96] },
  { blend: { source: "one", destination: "one" }, expected: [255, 64, 192] },
  { blend: { source: "dst-color", destination: "zero" }, expected: [64, 0, 32] },
  { blend: { source: "dst-color", destination: "one-minus-dst-alpha" }, expected: [64, 0, 32] },
  { blend: { source: "zero", destination: "src-color" }, expected: [64, 0, 32] },
  { blend: { source: "one-minus-src-color", destination: "one" }, expected: [64, 64, 128] },
];

for (const primitive of ["triangles", "lines"] satisfies readonly DrawBatch["primitive"][]) for (const backend of ["cpu", "gl"]) test.skipIf(backend === "gl" && process.env["QUAKE_GL_SMOKE"] !== "1")(`${backend} ${primitive} clamps lit source color before fixed framebuffer blending`, () => {
  const owner: RendererResourceOwner = { identity: Symbol("fragment clamp"), session: createIdentityOwner("fragment clamp").session, generation: 0 };
  const window = backend === "gl" ? SdlWindow.open({ title: "Fragment clamp", width: 8, height: 8, backend: "gl", hidden: true }) : null;
  const renderer = window === null ? new SoftwareRenderer(8, 8, owner) : new GlRenderer(window, owner);
  try {
    const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "black lightmap" }, width: 1, height: 1 };
    renderer.applyImageResource({ kind: "create-image", image, content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 1 },
      levels: [{ width: 1, height: 1, pixels: new Uint8Array([0, 0, 0, 255]) }] }, sampling: { wrap: "repeat", filter: "nearest" } });
    renderer.selectDrawBuffer("back", false);
    const positions = primitive === "lines" ? [{ x: -1, y: 0 }, { x: 1, y: 0 }] : [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
    const vertices: readonly RenderVertex[] = positions.map(position => ({
      position: { ...position, z: 0, w: 1 }, color: { x: 1, y: 1, z: 1, w: 0.5 }, texCoord: { x: 0.5, y: 0.5 } }));
    for (const entry of cases) {
      renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clipPlane: null,
        clear: { depth: 1, color: { x: 64 / 255, y: 64 / 255, z: 64 / 255, w: 1 }, stencil: true } });
      // Distance 32, radius 128 and scale 2 give unit contribution, so RGB is exactly [2, -1, 0.5].
      const batch: DrawBatch = { ...(primitive === "lines" ? { primitive, lineWidth: 1 } : { primitive }), texturing: "single", texture: { kind: "bind-image", image }, vertices, indices: primitive === "lines" ? [0, 1] : [0, 1, 2, 0, 2, 3],
        state: { ...CPU_OPAQUE_STATE, blend: entry.blend }, lighting: { kind: "q2-world", pass: "material-lightmap", atlas: null,
          worldPositions: vertices.map(() => ({ x: 0, y: 0, z: 0 })), normals: vertices.map(() => ({ x: 0, y: 0, z: 1 })),
          lights: [{ origin: { x: 0, y: 0, z: 16 }, radius: 128, color: { x: 2, y: -1, z: 0.5 }, scale: 2, cone: null, shadow: { kind: "none" } }] } };
      if (renderer instanceof SoftwareRenderer) renderer.draw(batch);
      else { const prepared = renderer.prepareGeometry(batch); prepared.begin(); try { prepared.applyTexture(0, batch.texture); prepared.draw(); } finally { prepared.cleanup(); } }
      const pixels = renderer instanceof SoftwareRenderer ? renderer.pixels : renderer.readPixels();
      let offset = -1;
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] !== 64 || pixels[index + 1] !== 64 || pixels[index + 2] !== 64) { offset = index; break; }
      expect(offset).toBeGreaterThanOrEqual(0);
      const actual = Array.from(pixels.slice(offset, offset + 3));
      if (process.env["QUAKE_CLAMP_DIAGNOSTIC"] === "1") console.log(backend, primitive, entry.blend, actual);
      for (const [channel, expected] of entry.expected.entries()) expect(Math.abs((actual[channel] ?? -999) - expected)).toBeLessThanOrEqual(1);
    }
    for (const staticLight of [0.2, 0.8]) {
      renderer.applyImageResource({ kind: "update-image", image, level: 0, content: { width: 1, height: 1,
        pixels: new Uint8Array([staticLight * 255, staticLight * 255, staticLight * 255, 255]) } });
      const deltas: number[] = [];
      for (const authoredColor of [1, 0.5]) {
        const values: number[] = [];
        for (const enabled of [false, true]) {
          renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clipPlane: null,
            clear: { depth: 1, color: { x: 64 / 255, y: 64 / 255, z: 64 / 255, w: 1 }, stencil: true } });
          const batch: DrawBatch = { ...(primitive === "lines" ? { primitive, lineWidth: 1 } : { primitive }), texturing: "single",
            texture: { kind: "bind-image", image }, vertices: vertices.map(vertex => ({ ...vertex, color: { x: authoredColor, y: authoredColor, z: authoredColor, w: 0.5 } })),
            indices: primitive === "lines" ? [0, 1] : [0, 1, 2, 0, 2, 3], state: { ...CPU_OPAQUE_STATE, blend: { source: "dst-color", destination: "zero" } },
            lighting: { kind: "q2-world", pass: authoredColor === 1 ? "lightmap" : "material-lightmap", atlas: null,
              worldPositions: vertices.map(() => ({ x: 0, y: 0, z: 0 })), normals: vertices.map(() => ({ x: 0, y: 0, z: 1 })),
              lights: enabled ? [{ origin: { x: 0, y: 0, z: 16 }, radius: 128, color: { x: staticLight, y: staticLight, z: staticLight }, scale: 2, cone: null, shadow: { kind: "none" } }] : [] } };
          if (renderer instanceof SoftwareRenderer) renderer.draw(batch);
          else { const prepared = renderer.prepareGeometry(batch); prepared.begin(); try { prepared.applyTexture(0, batch.texture); prepared.draw(); } finally { prepared.cleanup(); } }
          const pixels = renderer instanceof SoftwareRenderer ? renderer.pixels : renderer.readPixels();
          const expected = Math.round(Math.min(1, staticLight * (enabled ? 2 : 1) * authoredColor) * 64);
          // The line is on the middle row; saturated output can equal the clear color.
          const offset = primitive === "triangles" ? 0 : 4 * 8 * 4 + 4 * 4;
          const actual = pixels[offset];
          if (actual === undefined) throw new Error("Missing rendered sample");
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
          values.push(actual);
          if (process.env["QUAKE_CLAMP_DIAGNOSTIC"] === "1") console.log(backend, primitive, { staticLight, authoredColor, enabled, actual, expected });
        }
        const [dark, lit] = values;
        if (dark === undefined || lit === undefined) throw new Error("Missing lighting pair");
        deltas.push(lit - dark);
      }
      const [nativeDelta, authoredDelta] = deltas;
      if (nativeDelta === undefined || authoredDelta === undefined) throw new Error("Missing color pair");
      if (staticLight === 0.2) expect(Math.abs(authoredDelta - nativeDelta * 0.5)).toBeLessThanOrEqual(1);
      else expect(authoredDelta).toBeGreaterThan(nativeDelta);
    }
  } finally { renderer.close(); window?.close(); }
});
