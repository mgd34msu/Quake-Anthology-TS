import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { RenderCommand, RendererImage } from "../../../src/contracts/render.ts";
import { NativeRenderer } from "../../../src/app/bootstrap/renderer.ts";
import { GlRenderer } from "../../../src/render/gl/renderer.ts";
import { rgbaImage } from "../../../src/render/scene/resources.ts";

async function draw(renderer: NativeRenderer, image: RendererImage): Promise<Uint8Array> {
  const capture = renderer.captureNextFrame().then(frame => frame.pixels);
  const commands: RenderCommand[] = renderer.images.drainOperations().map(operation => ({ kind: "image-resource", operation }));
  commands.push({ kind: "draw-buffer", buffer: "back", clear: true },
    { kind: "stretch-pic", image, rect: { x: 0, y: 0, width: 16, height: 16 }, uv: { s1: 0, t1: 0, s2: 1, t2: 1 } }, { kind: "swap-buffers" });
  renderer.execute({ owner: renderer.owner, sequence: 0, commands });
  return capture;
}

for (const initial of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")(`retained ${initial} renderer stages, discards and publishes resource replacement`, async () => {
  const owner = { identity: Symbol("renderer restart"), session: createIdentityOwner("renderer restart").session, generation: 0 };
  const renderer = await NativeRenderer.open({ renderer: initial, width: 16, height: 16, hidden: true, gamma: 1.25 }, owner);
  const root = renderer.images, scope = root.fork();
  const pixels = new Uint8Array([64,128,192,255]);
  const image = scope.register("retained", rgbaImage({ width: 1, height: 1, pixels }), { wrap: "clamp", filter: "nearest" });
  try {
    const expected = await draw(renderer, image);
    pixels.fill(0);
    const discarded = await renderer.prepareRestart(initial);
    expect(discarded.published).toBe(false); expect(renderer.window).not.toBe(discarded.window);
    expect(() => renderer.execute({ owner, sequence: 0, commands: [] })).toThrow("prepared");
    discarded.discard(); discarded.discard(); expect(discarded.window.closed).toBe(true);
    expect(await draw(renderer, image)).toEqual(expected);
    for (const kind of [initial, initial === "cpu" ? "gl" : "cpu", initial] satisfies readonly ("cpu" | "gl")[]) {
      const old = renderer.window, pending = renderer.captureNextFrame().then(frame => frame.pixels);
      const prepared = await renderer.prepareRestart(kind);
      expect(prepared.window.flags & 8).not.toBe(0);
      const retire = prepared.publish();
      expect(prepared.published).toBe(true); expect(renderer.window).toBe(prepared.window);
      expect(old.closed).toBe(false); expect(renderer.images).toBe(root); expect(renderer.owner).toBe(owner);
      retire(); retire(); prepared.discard(); expect(old.closed).toBe(true);
      expect(await draw(renderer, image)).toEqual(expected); expect(await pending).toEqual(expected);
      expect(renderer.outputGamma).toBe(1.25); expect(scope.isResident(image)).toBe(true);
      if (renderer.backend instanceof GlRenderer) expect(renderer.backend.getError()).toBe(0);
    }
    const update = new Uint8Array([192,64,128,255]);
    scope.update(image, 0, { width: 1, height: 1, pixels: update });
    const updated = await draw(renderer, image); update.fill(0);
    const prepared = await renderer.prepareRestart(initial); prepared.publish()();
    expect(await draw(renderer, image)).toEqual(updated);
    const failure = await renderer.prepareRestart(initial);
    failure.window.restorePresentation = () => { throw Error("publication rejected"); };
    expect(() => failure.publish()).toThrow("publication rejected"); expect(failure.published).toBe(false);
    failure.discard(); expect(await draw(renderer, image)).toEqual(updated);
    scope.close(); renderer.execute({ owner, sequence: 0, commands: [] });
    const last = await renderer.prepareRestart(initial); last.publish()();
    expect(scope.isResident(image)).toBe(false);
  } finally { renderer.close(); }
});

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("failed GL resource replay restores the old context and renderer", async () => {
  const owner = { identity: Symbol("replay failure"), session: createIdentityOwner("replay failure").session, generation: 0 };
  const renderer = await NativeRenderer.open({ renderer: "gl", width: 16, height: 16, hidden: true, gamma: 1 }, owner);
  const image = renderer.images.register("retained", rgbaImage({ width: 1, height: 1, pixels: new Uint8Array([255,0,0,255]) }), { wrap: "clamp", filter: "nearest" });
  const apply = GlRenderer.prototype.applyImageResource;
  try {
    const expected = await draw(renderer, image), old = renderer.backend;
    GlRenderer.prototype.applyImageResource = function(operation) {
      if (this !== old) throw Error("candidate upload rejected");
      return apply.call(this, operation);
    };
    await expect(renderer.prepareRestart("gl")).rejects.toThrow("candidate upload rejected");
    GlRenderer.prototype.applyImageResource = apply;
    expect(renderer.backend).toBe(old); expect(await draw(renderer, image)).toEqual(expected);
  } finally { GlRenderer.prototype.applyImageResource = apply; renderer.close(); }
});

test.skipIf(process.env["QUAKE_GL_SMOKE"] !== "1")("restart preserves latest mip pixels and texture-mode ordering around later creations", async () => {
  const owner = { identity: Symbol("mip replay"), session: createIdentityOwner("mip replay").session, generation: 0 };
  const renderer = await NativeRenderer.open({ renderer: "gl", width: 16, height: 16, hidden: true, gamma: 1 }, owner);
  const root = renderer.images, base = new Uint8Array(16).fill(255), mip = new Uint8Array([32,64,96,255]);
  const content = { kind: "rgba8", levels: [{ width: 2, height: 2, pixels: base }, { width: 1, height: 1, pixels: mip }], borderColor: { x: 0, y: 0, z: 0, w: 0 } } satisfies Parameters<typeof root.register>[1];
  const sampling = { wrap: "repeat", filter: "nearest-mipmap-nearest" } satisfies Parameters<typeof root.register>[2];
  const early = root.register("early", content, sampling); root.textureMode("linear");
  const late = root.register("late", content, sampling), latest = new Uint8Array([128,64,32,255]);
  root.update(late, 1, { width: 1, height: 1, pixels: latest });
  try {
    renderer.execute({ owner, sequence: 0, commands: [] });
    const read = () => {
      const backend = renderer.backend;
      if (!(backend instanceof GlRenderer)) throw Error("GL expected");
      const gl = backend["gl"], results: { filter: number | undefined; pixels: Uint8Array }[] = [];
      for (const image of [early, late]) {
        gl.glBindTexture(0xde1, backend["textures"].registered(image).name);
        const filter = new Float32Array(1), pixels = new Uint8Array(4);
        gl.glGetTexParameterfv(0xde1, 0x2801, filter); gl.glGetTexImage(0xde1, 1, 0x1908, 0x1401, pixels);
        results.push({ filter: filter[0], pixels });
      }
      expect(backend.getError()).toBe(0); return results;
    };
    const expected = read(); expect(expected.map(value => value.filter)).toEqual([0x2601, 0x2700]);
    base.fill(0); mip.fill(0); latest.fill(0);
    const stage = await renderer.prepareRestart("gl"); stage.publish()();
    expect(read()).toEqual(expected);
  } finally { renderer.close(); }
});
