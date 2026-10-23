import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner, RenderVertex } from "../../../src/contracts/render.ts";
import { CPU_OPAQUE_STATE, SoftwareRenderer } from "../../../src/render/cpu/index.ts";

const WIDTH = 320, HEIGHT = 240;

function render(workers: string): { pixels: Uint8Array; batches: number; depths: number[] } {
  process.env["QTS_CPU_WORKERS"] = workers;
  const owner: RendererResourceOwner = { identity: Symbol("cpu-parallel"), session: createIdentityOwner("cpu parallel test").session, generation: 0 };
  const renderer = new SoftwareRenderer(WIDTH, HEIGHT, owner, 8, 8, 8);
  try {
    const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "checker" }, width: 4, height: 4 };
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const offset = (y * 4 + x) * 4, bright = (x + y) % 2 === 0 ? 255 : 96;
      pixels[offset] = bright; pixels[offset + 1] = 255 - bright; pixels[offset + 2] = 160; pixels[offset + 3] = 255;
    }
    renderer.applyImageResource({ kind: "create-image", image,
      content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 0 }, levels: [{ width: 4, height: 4, pixels }] },
      sampling: { filter: "nearest", wrap: "repeat" } });
    renderer.beginView({ viewport: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, clipPlane: null,
      clear: { color: { x: 0.1, y: 0.2, z: 0.3, w: 1 }, depth: 1, stencil: true } });
    // One large batch of overlapping colored quads at varying depth: many
    // setups across every row band, blending/depth interaction included.
    const vertices: RenderVertex[] = [];
    const indices: number[] = [];
    const cols = 16, rows = 12;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x0 = -1 + (col / cols) * 2, x1 = -1 + ((col + 1.7) / cols) * 2;
      const y0 = -1 + (row / rows) * 2, y1 = -1 + ((row + 1.7) / rows) * 2;
      const z = ((col * 31 + row * 17) % 89) / 89 * 0.8 - 0.4;
      const color = { x: ((col * 53) % 101) / 100, y: ((row * 41) % 103) / 102, z: ((col + row * 7) % 97) / 96, w: 1 };
      const base = vertices.length;
      for (const [x, y, u, v] of [[x0, y0, 0, 0], [x1, y0, 2, 0], [x0, y1, 0, 2], [x1, y1, 2, 2]] as const)
        vertices.push({ position: { x, y, z, w: 1 }, texCoord: { x: u, y: v }, color });
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const batch: Extract<DrawBatch, { readonly texturing: "single" }> = {
      lighting: { kind: "vertex" }, primitive: "triangles", texturing: "single",
      texture: { kind: "bind-image", image }, indices, state: CPU_OPAQUE_STATE, vertices };
    renderer.draw(batch);
    const depths: number[] = [];
    for (let y = 0; y < HEIGHT; y += 37) for (let x = 0; x < WIDTH; x += 41) depths.push(renderer.readDepthPixel(x, y));
    return { pixels: renderer.readRgba().pixels, batches: renderer.rowParallelBatches, depths };
  } finally { renderer.close(); }
}

test("row-parallel rasterization is bit-identical to the serial kernel", () => {
  const previous = process.env["QTS_CPU_WORKERS"];
  try {
    const serial = render("0");
    const parallel = render("3");
    expect(serial.batches).toBe(0);
    expect(parallel.batches).toBeGreaterThan(0);
    expect(parallel.pixels).toEqual(serial.pixels);
    expect(parallel.depths).toEqual(serial.depths);
  } finally {
    if (previous === undefined) delete process.env["QTS_CPU_WORKERS"];
    else process.env["QTS_CPU_WORKERS"] = previous;
  }
}, 120_000);
