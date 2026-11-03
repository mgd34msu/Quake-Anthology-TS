import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner, RenderVertex } from "../../../src/contracts/render.ts";
import { CPU_OPAQUE_STATE, SoftwareRenderer } from "../../../src/render/cpu/index.ts";

const WIDTH = 320, HEIGHT = 240;

function solid(r: number, g: number, b: number): Uint8Array {
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) pixels.set([r, g, b, 255], i * 4);
  return pixels;
}

function session(workers: string) {
  process.env["QTS_CPU_WORKERS"] = workers;
  const owner: RendererResourceOwner = { identity: Symbol("row-registry"), session: createIdentityOwner("row registry test").session, generation: 0 };
  const renderer = new SoftwareRenderer(WIDTH, HEIGHT, owner, 8, 8, 8);
  const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "flat" }, width: 4, height: 4 };
  renderer.applyImageResource({ kind: "create-image", image,
    content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 0 }, levels: [{ width: 4, height: 4, pixels: solid(200, 10, 10) }] },
    sampling: { filter: "nearest", wrap: "repeat" } });
  const vertices: RenderVertex[] = [];
  const indices: number[] = [];
  for (let quad = 0; quad < 2; quad++) {
    const x0 = -1 + quad, x1 = x0 + 1, base = vertices.length;
    const corners: readonly (readonly [number, number, number, number])[] = [[x0, -1, 0, 0], [x1, -1, 1, 0], [x0, 1, 0, 1], [x1, 1, 1, 1]];
    for (const [x, y, u, v] of corners)
      vertices.push({ position: { x, y, z: 0, w: 1 }, texCoord: { x: u, y: v }, color: { x: 1, y: 1, z: 1, w: 1 } });
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const batch: Extract<DrawBatch, { readonly texturing: "single" }> = {
    lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single",
    texture: { kind: "bind-image", image }, indices, state: CPU_OPAQUE_STATE, vertices };
  const frame = (): Uint8Array => {
    renderer.beginView({ viewport: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, clipPlane: null,
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: true } });
    renderer.draw(batch);
    return renderer.readRgba().pixels;
  };
  return { renderer, image, frame };
}

test("row workers register a texture level once and never serve stale pixels after an update", () => {
  const previous = process.env["QTS_CPU_WORKERS"];
  try {
    const { renderer, image, frame } = session("2");
    try {
      const first = frame();
      expect(renderer.rowParallelBatches).toBeGreaterThan(0);
      for (let i = 0; i < 20; i++) expect(frame()).toEqual(first);
      expect(renderer.rowParallelBatches).toBe(21);
      expect(renderer.rowParallelLevelsSent).toBe(1);
      expect(first[0]).toBe(200);

      renderer.applyImageResource({ kind: "update-image", image, level: 0,
        content: { width: 4, height: 4, pixels: solid(10, 220, 10) } });
      const updated = frame();
      expect(updated[0]).toBe(10);
      expect(updated[1]).toBe(220);
      expect(renderer.rowParallelLevelsSent).toBe(2);
    } finally { renderer.close(); }
  } finally {
    if (previous === undefined) delete process.env["QTS_CPU_WORKERS"];
    else process.env["QTS_CPU_WORKERS"] = previous;
  }
}, 60_000);
