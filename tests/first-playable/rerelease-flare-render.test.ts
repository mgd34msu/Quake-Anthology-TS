import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../../src/app/bootstrap/application.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { encodePng } from "../../src/formats/images/png.ts";

for (const backend of ["cpu", "gl"]) test.skipIf(process.env["QUAKE_FLARE_RENDER"] !== "1")(`unchanged q64/rtest ${backend} draws authored flares for two seats`, async () => {
  const root = await mkdtemp(join(tmpdir(), "quake-flare-"));
  const parsed = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--map", "q64/rtest", "--mode", "coop", "--seats", "2", "--renderer", backend,
    "--width", "640", "--height", "480", "--hidden", "--user-content-root", root]);
  if (parsed.kind !== "run") throw new Error("Expected application launch");
  const app = await Application.open(parsed.options, { print: () => undefined });
  try {
    await app.step(25);
    const source = app.simulation.q2Source();
    if (source === null) throw new Error("Missing source game");
    const flares = [...source.game.entities.values()].filter(entity => entity.flare !== null);
    expect(flares.length).toBeGreaterThan(0);
    const capture = async (name: string): Promise<Uint8Array> => {
      const pending = app.captureNextFrame(); await app.step(0.001); const pixels = await pending;
      await Bun.write(`/tmp/quake-flare-${backend}-${name}.png`, encodePng(640, 480, pixels)); return pixels;
    };
    await capture("spawn");
    const first = flares[0];
    if (first === undefined) throw new Error("Missing authored flare");
    const origin = source.game.body(first).origin;
    await Bun.write(`/tmp/quake-flare-${backend}-origins.json`, JSON.stringify(flares.map(entity => ({ origin: source.game.body(entity).origin, flare: entity.flare }))));
    for (const [index, player] of app.localPlayers.entries()) {
      source.players.hooks.setMovement(player.actor, { kind: "freeze", origin: { x: origin.x - (index === 0 ? 240 : 80), y: origin.y, z: origin.z - 22 }, angles: { x: 0, y: 0, z: 0 } });
    }
    await app.step(25); await app.step(25);
    for (const entity of flares) if (entity !== first) entity.serverFlags |= 1;
    const on = await capture("near-far-on");
    for (const entity of flares) entity.serverFlags |= 1;
    const off = await capture("near-far-off");
    const changes = [0, 0];
    for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) {
      const offset = (y * 640 + x) * 4;
      if (on[offset] !== off[offset] || on[offset + 1] !== off[offset + 1] || on[offset + 2] !== off[offset + 2]) {
        const seat = y < 240 ? 0 : 1; changes[seat] = (changes[seat] ?? 0) + 1;
      }
    }
    await Bun.write(`/tmp/quake-flare-${backend}-changes.json`, JSON.stringify(changes));
    expect(changes[0]).toBeGreaterThan(0);
    expect(changes[1]).toBe(0);
    const fallback = source.game.spawn({ ...first.spawn, ordinal: 100001, values: new Map([...first.spawn.values, ["image", "missing-flare-test.tga"]]) });
    const fallbackPixels = await capture("custom-fallback");
    expect(fallbackPixels).toEqual(on);
    source.game.remove(fallback);
    for (const entity of flares) entity.serverFlags &= ~1;
    const save = join(root, "flare.sav"); await app.saveGame(save); await app.loadGame(save);
    expect(app.simulation.presentations().filter(value => value.flare !== undefined).length).toBe(flares.length);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);

import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { DrawBatch, RendererImage, RendererResourceOwner, RenderVertex } from "../../src/contracts/render.ts";
import { SdlWindow } from "../../src/platform/sdl.ts";
import { GlRenderer } from "../../src/render/gl/renderer.ts";
import { SoftwareRenderer } from "../../src/render/cpu/index.ts";

test.skipIf(process.env["QUAKE_FLARE_RENDER"] !== "1")("CPU and GL apply flare luminance after bilinear sampling and reset the ordinary draw", () => {
  using window = SdlWindow.open({ title: "Flare sampling proof", width: 8, height: 8, backend: "gl", hidden: true });
  const owner: RendererResourceOwner = { identity: Symbol("flare sampling"), session: createIdentityOwner("flare sampling").session, generation: 0 };
  using gl = new GlRenderer(window, owner);
  const cpu = new SoftwareRenderer(8, 8, owner);
  const image: RendererImage = { owner, ordinal: 0, source: { kind: "generated", name: "flare sampling" }, width: 2, height: 1 };
  const vertices: RenderVertex[] = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }].map(point => ({
    position: { ...point, z: 0, w: 1 }, texCoord: { x: 0.5, y: 0.5 }, color: { x: 1, y: 1, z: 1, w: 0.5 } }));
  const ordinary: DrawBatch = { primitive: "triangles", texturing: "single", vertices, indices: [0, 1, 2, 0, 2, 3],
    lighting: { kind: "vertex" }, texture: { kind: "bind-image", image }, state: { blend: { source: "src-alpha", destination: "one" },
      depthTest: "less-equal", depthWrite: false, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } };
  try {
    for (const renderer of [cpu, gl]) {
      renderer.applyImageResource({ kind: "create-image", image, content: { kind: "rgba8", borderColor: { x: 0, y: 0, z: 0, w: 0 }, levels: [{ width: 2, height: 1,
        pixels: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }] }, sampling: { wrap: "repeat", filter: "linear" } });
      for (const effect of [true, false]) {
        renderer.beginView({ viewport: { x: 0, y: 0, width: 8, height: 8 }, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null });
        const batch: DrawBatch = effect ? { ...ordinary, textureEffect: "luminance-alpha" } : ordinary;
        const prepared = renderer.prepareGeometry(batch); prepared.begin();
        try { prepared.applyTexture(0, batch.texture); prepared.draw(); } finally { prepared.cleanup(); }
        const pixels = renderer instanceof SoftwareRenderer ? renderer.pixels : renderer.readPixels();
        expect(Math.abs((pixels[0] ?? 0) - (effect ? 16 : 64))).toBeLessThanOrEqual(1);
      }
    }
  } finally { cpu.close(); }
});
