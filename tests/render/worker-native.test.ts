import { expect, test } from "bun:test";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { DrawBatch, ImageLevel, RenderCommand, RendererImage, RenderState } from "../../src/contracts/render.ts";
import { rgbaImage } from "../../src/render/scene/resources.ts";

type SettledImage = { readonly status: "fulfilled"; readonly value: ImageLevel } | { readonly status: "rejected"; readonly reason: unknown };
const state: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true,
  alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null };
const view = { viewport: { x: 0, y: 0, width: 16, height: 16 },
  clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: true }, clipPlane: null };
function batch(image: RendererImage): DrawBatch {
  return { texturing: "single", primitive: "triangles", indices: [0, 1, 2, 0, 2, 3], state,
    texture: { kind: "bind-image", image }, lighting: { kind: "vertex" },
    vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }].map(position => ({
      position: { ...position, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: { x: 1, y: 1, z: 1, w: 1 } })) };
}
function submit(renderer: NativeRenderer, commands: readonly RenderCommand[]): void {
  renderer.execute({ owner: renderer.owner, sequence: 0, commands });
}
async function capture(renderer: NativeRenderer): Promise<ImageLevel> {
  const result = renderer.captureNextFrame(); submit(renderer, [{ kind: "swap-buffers" }]); renderer.synchronize();
  const image = await result; expect(image.width).toBe(16); expect(image.height).toBe(16); expect(image.pixels.length).toBe(1024);
  return image;
}
async function picture(renderer: NativeRenderer, image: RendererImage): Promise<ImageLevel> {
  submit(renderer, [{ kind: "draw-buffer", buffer: "back", clear: true }, { kind: "stretch-pic", image,
    rect: { x: 0, y: 0, width: 16, height: 16 }, uv: { s1: 0, t1: 0, s2: 1, t2: 1 } }]);
  return capture(renderer);
}

for (const kind of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) {
  test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")(`native ${kind} serial and worker preserve pixels, callbacks and restart lifetime`, async () => {
    const owner = { identity: Symbol("worker native"), session: createIdentityOwner("worker native").session, generation: 0 };
    const renderer = await NativeRenderer.open({ renderer: kind, width: 16, height: 16, hidden: true, gamma: 1.25, renderWorker: false }, owner);
    const root = renderer.images, scope = root.fork();
    const image = scope.register("dynamic first", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([0,0,0,255]) }), { wrap: "clamp", filter: "nearest" });
    const second = scope.register("dynamic second", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([0,0,0,255]) }), { wrap: "clamp", filter: "nearest" });
    const results: { packet: ImageLevel; nested: ImageLevel; stencil: Uint8Array }[] = [];
    try {
      submit(renderer, root.drainOperations().map(operation => ({ kind: "image-resource", operation })));
      for (const worker of [false, true]) {
        if (worker) { const old = renderer.window, replacement = await renderer.prepareRestart(kind, true); replacement.publish()(); expect(old.closed).toBe(true); }
        expect(renderer.renderWorker).toBe(worker);
        const calls: string[] = [];
        const firstSource = { resolve(apply: (operation: import("../../src/contracts/render.ts").ImageResourceOperation) => void) {
          calls.push("first"); apply({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([64,0,0,255]) } }); return image;
        } };
        const secondSource = { resolve(apply: (operation: import("../../src/contracts/render.ts").ImageResourceOperation) => void) {
          calls.push("second"); apply({ kind: "update-image", image: second, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([0,64,0,255]) } }); return second;
        } };
        const plain = batch(image);
        const pair: DrawBatch = { ...plain, texturing: "pair", vertices: plain.vertices.map(vertex => ({ ...vertex, texCoord2: vertex.texCoord })),
          texture: { kind: "dynamic-image", source: firstSource }, secondTexture: { binding: { kind: "dynamic-image", source: secondSource }, environment: "add" } };
        const stencilBits = renderer.backend.stencilBits;
        expect(Number.isInteger(stencilBits)).toBe(true); expect(stencilBits).toBeGreaterThanOrEqual(0);
        if (stencilBits > 0) renderer.backend.setOverdrawMeasurement(true);
        submit(renderer, [{ kind: "draw-buffer", buffer: "back", clear: false }, { kind: "view", view: { ...view,
          target: { kind: "preview", id: "worker" }, time: { kind: "seconds", value: 0 }, beforeView: [], operations: [{ kind: "draw", batches: [pair] }] } }]);
        expect(renderer.backend.readDepthPixel(8, 8)).toBeCloseTo(0.5, 5);
        const stencil = new Uint8Array(stencilBits > 0 ? 256 : 0);
        if (stencilBits > 0) {
          renderer.backend.readStencilOverdraw(stencil); expect(stencil.every(value => value === 1)).toBe(true);
        } else expect(renderer.backend.stencilBits).toBe(0);
        const packet = await capture(renderer); expect(calls).toEqual(["first", "second"]);
        expect(packet.pixels[0]).toBeGreaterThan(0); expect(packet.pixels[1]).toBeGreaterThan(0); expect(packet.pixels[2]).toBe(0);
        if (stencilBits > 0) renderer.backend.setOverdrawMeasurement(false);
        renderer.backend.beginView(view);
        const order: string[] = [];
        const callbackSource = { resolve(apply: (operation: import("../../src/contracts/render.ts").ImageResourceOperation) => void) {
          order.push("dynamic");
          apply({ kind: "update-image", image, level: 0, content: { width: 1, height: 1, pixels: new Uint8Array([32,0,0,255]) } });
          order.push("uploaded"); return image;
        } };
        renderer.backend.withObjectOpacity(0.5, () => {
          order.push("outer");
          const prepared = renderer.backend.prepareGeometry(plain);
          try {
            prepared.begin(); prepared.applyTexture(0, { kind: "dynamic-image", source: callbackSource }); prepared.draw();
          } finally { prepared.cleanup(); }
          order.push("return"); return undefined;
        });
        const nested = await capture(renderer); expect(order).toEqual(["outer", "dynamic", "uploaded", "return"]);
        expect(nested.pixels[0]).toBeGreaterThan(0); expect(nested.pixels[0]).toBeLessThan(packet.pixels[0] ?? 0);
        results.push({ packet, nested, stencil });
        console.info(JSON.stringify({ kind, worker, stencilBits, driver: renderer.driver, interval: renderer.swapInterval, gamma: renderer.outputGamma }));
      }
      expect(results[1]).toEqual(results[0]);
      scope.update(image, 0, { width: 1, height: 1, pixels: new Uint8Array([96,0,0,255]) });
      submit(renderer, []); renderer.synchronize();
      const snapshot = await picture(renderer, image);
      scope.update(image, 0, { width: 1, height: 1, pixels: new Uint8Array([32,0,0,255]) });
      submit(renderer, []); renderer.synchronize();
      expect(await picture(renderer, image)).not.toEqual(snapshot);
      const mutable = new Uint8Array([96,0,0,255]);
      scope.update(image, 0, { width: 1, height: 1, pixels: mutable });
      submit(renderer, []); mutable.fill(0); renderer.synchronize();
      expect(await picture(renderer, image)).toEqual(snapshot);
      submit(renderer, [{ kind: "set-color", color: { x: 0.5, y: 1, z: 1, w: 1 } }]);
      const expected = await picture(renderer, image);
      for (const [backend, worker] of [[kind, false], [kind === "cpu" ? "gl" : "cpu", true], [kind, true]] satisfies readonly (readonly ["cpu" | "gl", boolean])[]) {
        const old = renderer.window, abort = new AbortController();
        const pending = renderer.captureNextFrame(abort.signal).then(
          (value): SettledImage => ({ status: "fulfilled", value }),
          (reason: unknown): SettledImage => ({ status: "rejected", reason }));
        try {
          const stage = await renderer.prepareRestart(backend, worker);
          stage.publish()(); expect(old.closed).toBe(true); expect(renderer.images).toBe(root); expect(renderer.owner).toBe(owner);
          expect(renderer.outputGamma).toBe(1.25); expect(scope.isResident(image)).toBe(true);
          expect(await picture(renderer, image)).toEqual(expected);
          expect(await pending).toEqual({ status: "fulfilled", value: expected });
        } finally { abort.abort(); await pending; }
      }
      const discarded = await renderer.prepareRestart(kind, false); discarded.discard(); expect(discarded.window.closed).toBe(true);
      expect(await picture(renderer, image)).toEqual(expected);
    } finally {
      const window = renderer.window, backend = renderer.backend; renderer.close(); renderer.close();
      expect(window.closed).toBe(true); expect(() => backend.readDepthPixel(0, 0)).toThrow();
    }
  }, 30000);
}

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("native worker failure rejects an armed capture without another frame or barrier", async () => {
  const owner = { identity: Symbol("worker failure"), session: createIdentityOwner("worker failure").session, generation: 0 };
  const renderer = await NativeRenderer.open({ renderer: "cpu", width: 16, height: 16, hidden: true, gamma: 1, renderWorker: true }, owner);
  const image: RendererImage = { owner, ordinal: 100, source: { kind: "generated", name: "not resident" }, width: 1, height: 1 };
  const window = renderer.window;
  const capture = renderer.captureNextFrame().then(
    (value): SettledImage => ({ status: "fulfilled", value }),
    (reason: unknown): SettledImage => ({ status: "rejected", reason }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    submit(renderer, [{ kind: "stretch-pic", image, rect: { x: 0, y: 0, width: 16, height: 16 },
      uv: { s1: 0, t1: 0, s2: 1, t2: 1 } }, { kind: "swap-buffers" }]);
    const result = await Promise.race([capture, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Worker capture rejection timed out")), 3000);
    })]);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(Error);
  } finally {
    clearTimeout(timer);
    expect(() => renderer.close()).toThrow();
    expect(window.closed).toBe(true);
    await capture;
  }
}, 10000);
