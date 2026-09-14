import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner } from "../../../src/contracts/render.ts";
import { SdlWindow } from "../../../src/platform/sdl.ts";
import { CPU_OPAQUE_STATE } from "../../../src/render/cpu/index.ts";
import { GeometryBuffer, packGeometry, type GeometryArrays } from "../../../src/render/gl/buffers.ts";
import { GlRenderer } from "../../../src/render/gl/renderer.ts";

const packingOwner: RendererResourceOwner = { identity: Symbol("packing"), session: createIdentityOwner("packing").session, generation: 0 };
const atlasImage: RendererImage = { owner: packingOwner, ordinal: 0, source: { kind: "generated", name: "packing atlas" }, width: 1, height: 1 };

function batch(count: number, paired: boolean, lighting: "vertex" | "q2-world" | "q2-model-shadow"): DrawBatch {
  const vertices = Array.from({ length: count }, (_, index) => ({ position: { x: index / 7, y: -0, z: index / 9, w: 1 },
    color: { x: 1, y: index / 13, z: -0, w: 1 }, texCoord: { x: index / 3, y: -0 }, texCoord2: { x: -index / 9, y: index / 5 } }));
  const worldPositions = vertices.map(vertex => ({ x: vertex.position.x, y: -0, z: vertex.position.z }));
  const common = { primitive: "triangles", indices: count < 3 ? [] : [0, 1, 2], vertices, state: CPU_OPAQUE_STATE,
    texture: { kind: "retain-current-texture" }, lighting: lighting === "vertex" ? { kind: lighting }
      : lighting === "q2-world" ? { kind: lighting, worldPositions, normals: worldPositions, pass: "lightmap", lights: [], atlas: null }
      : { kind: lighting, worldPositions, lights: [], atlas: { image: atlasImage, texelSize: 1, nearPlane: 1 }, shadeScale: 1 } } satisfies Omit<DrawBatch, "texturing">;
  return paired ? { ...common, texturing: "pair", secondTexture: { binding: { kind: "retain-current-texture" }, environment: "modulate" } }
    : { ...common, texturing: "single" };
}
const fields = ["positions", "colors", "coordinates", "coordinates2", "worldPositions", "normals", "indices"] satisfies readonly (keyof GeometryArrays)[];
function bytes(array: Float32Array | Uint32Array): Uint8Array { return new Uint8Array(array.buffer, array.byteOffset, array.byteLength); }
function equalArrays(actual: GeometryArrays, expected: GeometryArrays): void {
  for (const field of fields) expect(bytes(actual[field])).toEqual(bytes(expected[field]));
}

test("owned GL buffer reuse preserves fresh bytes through growth, shape changes and rejected packs", () => {
  const buffer = new GeometryBuffer();
  const allocations = new Set<ArrayBufferLike>();
  for (const count of [40, 3, 17, 0, 8, 40, 120, 3]) for (const paired of [true, false])
    for (const lighting of ["q2-world", "vertex", "q2-model-shadow"] satisfies readonly Parameters<typeof batch>[2][]) {
      const input = batch(count, paired, lighting), actual = buffer.pack(input);
      equalArrays(actual, packGeometry(input)); allocations.add(actual.positions.buffer);
    }
  expect(allocations.size).toBe(2);
  const input: Extract<DrawBatch, { readonly texturing: "single" }> = { ...batch(3, false, "vertex"), texturing: "single" };
  const first = buffer.pack(input), second = buffer.pack(input);
  expect(second).toBe(first);
  const paired = batch(3, true, "vertex");
  if (paired.texturing !== "pair") throw new Error("Expected paired batch");
  for (const value of [NaN, Infinity, 1e40]) {
    const invalid = { ...paired, vertices: paired.vertices.map(vertex => ({ ...vertex, texCoord2: { x: value, y: 0 } })) };
    expect(() => buffer.pack(invalid)).toThrow("finite float32");
    const cleared = buffer.pack(input);
    expect(bytes(cleared.coordinates2)).toEqual(new Uint8Array(input.vertices.length * 8));
    equalArrays(cleared, packGeometry(input));
    equalArrays(buffer.pack(paired), packGeometry(paired));
  }
  for (const invalid of [{ ...input, indices: [0, 1, 9] }, { ...input, indices: [0, 1] },
    { ...input, vertices: input.vertices.map(vertex => ({ ...vertex, position: { ...vertex.position, x: Infinity } })) },
    { ...input, vertices: input.vertices.map(vertex => ({ ...vertex, color: { ...vertex.color, x: NaN } })) },
    { ...input, vertices: input.vertices.map(vertex => ({ ...vertex, texCoord: { x: 1e40, y: 0 } })) },
    { ...input, lighting: { kind: "q2-world", worldPositions: [], normals: [], pass: "lightmap", lights: [], atlas: null } },
    { ...input, primitive: "lines", lineWidth: 0, indices: [0, 1] }] satisfies readonly DrawBatch[]) {
    let message = "";
    try { packGeometry(invalid); } catch (error) { if (error instanceof Error) message = error.message; else throw error; }
    expect(message).not.toBe(""); expect(() => buffer.pack(invalid)).toThrow(message);
    equalArrays(buffer.pack(input), packGeometry(input));
  }
  const independent = packGeometry(input); buffer.pack(batch(100, true, "q2-world"));
  equalArrays(independent, packGeometry(input));
});

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("GL retained prepared buffers, failure cleanup and close preserve fresh color and depth", () => {
  const owner: RendererResourceOwner = { identity: Symbol("buffer reuse"), session: createIdentityOwner("buffer reuse").session, generation: 0 };
  const window = SdlWindow.open({ title: "buffer reuse", width: 16, height: 16, backend: "gl", hidden: true });
  const renderer = new GlRenderer(window, owner);
  const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "white" }, width: 1, height: 1 };
  const packed = GeometryBuffer.prototype.pack;
  try {
    renderer.applyImageResource({ kind: "create-image", image, content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 1 },
      levels: [{ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }] }, sampling: { wrap: "repeat", filter: "nearest" } });
    renderer.selectDrawBuffer("back", false);
    function triangle(red: number, depth: number): DrawBatch {
      return { ...batch(3, false, "vertex"), texturing: "single", texture: { kind: "bind-image", image },
        vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 0, y: 1 }].map(position => ({ position: { ...position, z: depth, w: 1 },
          color: { x: red, y: 1 - red, z: 0.25, w: 1 }, texCoord: { x: 0.5, y: 0.5 } })) };
    }
    const inputA = triangle(0.25, 0), inputB = triangle(0.75, 0.5);
    function frame(): { pixels: Uint8Array; depth: readonly number[] } {
      renderer.beginView({ viewport: { x: 0, y: 0, width: 16, height: 16 }, clipPlane: null, clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: true } });
      const a = renderer.prepareGeometry(inputA), b = renderer.prepareGeometry(inputB);
      b.begin(); b.applyTexture(0, inputB.texture); b.draw(); b.cleanup();
      const abandoned = renderer.prepareGeometry(triangle(1, -0.5)); abandoned.cleanup(); abandoned.cleanup();
      const failed = renderer.prepareGeometry(inputB);
      failed.begin();
      expect(() => failed.applyTexture(0, { kind: "bind-image", image: { ...image, ordinal: 999 } })).toThrow();
      failed.cleanup();
      expect(() => renderer.prepareGeometry({ ...inputB, indices: [0, 1, 99] })).toThrow();
      a.begin(); a.applyTexture(0, inputA.texture); a.draw(); a.cleanup(); a.cleanup();
      const pixels = renderer.readPixels(), depth: number[] = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) depth.push(renderer.readDepthPixel(x, y));
      expect(renderer.getError()).toBe(0);
      return { pixels, depth };
    }
    GeometryBuffer.prototype.pack = packGeometry;
    const fresh = frame();
    GeometryBuffer.prototype.pack = packed;
    expect(frame()).toEqual(fresh);
    expect(frame()).toEqual(fresh);
    const retained = renderer.prepareGeometry(inputA);
    renderer.close(); retained.cleanup(); retained.cleanup();
    expect(() => retained.begin()).toThrow();
  } finally { GeometryBuffer.prototype.pack = packed; renderer.close(); window.close(); }
});
