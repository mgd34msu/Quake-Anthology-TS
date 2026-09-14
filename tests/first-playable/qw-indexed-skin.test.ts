import { sceneModelBatches } from "../../src/render/scene/submissions.ts";
import { expect, spyOn, test } from "bun:test";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { SceneEntity } from "../../src/contracts/scene.ts";
import { QwPlayerSkins } from "../../src/app/bootstrap/network/qw-skins.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { anglesToAxis } from "../../src/core/math.ts";
import { encodePcx, encodePng, q1PlayerTranslation } from "../../src/formats/images/index.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { perspectiveProjection } from "../../src/render/scene/view.ts";
import { WorldScene } from "../../src/render/scene/world.ts";
import { prepareSceneEntity, SceneModelRenderer } from "../../src/render/scene/models/index.ts";
import type { SceneTexture } from "../../src/render/scene/textures.ts";

for (const backend of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) test(`QW indexed player skin preserves native geometry and palette on ${backend}`, async () => {
  const parsed = parseApplicationCommand(["--game", "q1-rerelease-id1", "--map", "e1m1", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing launch");
  const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner("qw-indexed-skin");
  const owner = { identity: Symbol("qw-skin"), session: identity.session, generation: 0 };
  const assets = new ApplicationAssets(content, owner), renderer = NativeRenderer.open({ renderer: backend, width: 320, height: 240, hidden: true, gamma: 1 }, owner);
  try {
    await assets.loadWorld();
    const provider = await assets.provider(content.recipe.map.entities.content), loaded = await assets.model(content.recipe.map.entities.content, "progs/player.mdl");
    if (loaded.model.kind !== "q1-mdl") throw new Error("Missing native player");
    const model = loaded.model;
    expect(model.skinWidth).toBe(296); expect(model.skinHeight).toBe(194); expect(model.replacement?.model.kind).toBe("md5");
    const indices = Uint8Array.from({ length: 320 * 200 }, (_, i) => {
      const x = i % 320, y = Math.trunc(i / 320);
      return x >= 296 || y >= 194 ? 250 : x === 0 && y === 0 ? 0 : y >= 50 && y < 70 && x >= 80 && x < 100 ? 230 : x < 148 ? 20 : 100;
    });
    const pcx = encodePcx({ width: 320, height: 200, indices }, new Uint8Array(768));
    const skins = new QwPlayerSkins({ read: async () => pcx, noskins: () => 0, baseskin: () => "base", allskins: () => "" });
    const skin = await skins.select("fixture");
    if (skin === null) throw new Error("Missing decoded QW skin");
    const pixels = skin.pixels;
    expect(pixels.includes(250)).toBe(false); expect(pixels[296]).toBe(20); expect(pixels[193 * 296 + 295]).toBe(100);
    const origin = { x: 0, y: 0, z: 0 }, axis = anglesToAxis(origin);
    const entity: SceneEntity = { actor: identity.actor(1, 0), resource: loaded.resource, model, transform: { origin, axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: origin,
      pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: 0, color: { x: 1, y: 1, z: 1, w: 1 },
      shaderTime: { kind: "seconds", value: 0 }, flags: { kind: "q1", bits: 0 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] };
    const camera: SceneCamera = { origin: { x: 90, y: 0, z: 12 }, axis: anglesToAxis({ x: 0, y: 180, z: 0 }), projection: perspectiveProjection(65, 50, 4096),
      viewport: { x: 0, y: 0, width: 320, height: 240 }, clip: { kind: "none" } };
    const source = () => ({ indexedSkin: skin, playerColors: { top: 4, bottom: 12 } });
    const prepared = prepareSceneEntity(entity, { camera, timeSeconds: 0, options: source });
    const native = prepareSceneEntity({ ...entity, model: { ...model, replacement: null } }, { camera, timeSeconds: 0 });
    expect(prepared.entity.model).toBe(model); expect(prepared.surfaces[0]?.geometry).toEqual(native.surfaces[0]?.geometry);
    expect(prepared.surfaces[0]?.image).toMatchObject({ kind: "indexed", name: skin.name, width: 296, height: 194 });
    expect(prepareSceneEntity(entity, { camera, timeSeconds: 0 }).entity.model.kind).toBe("md5");
    const textures: SceneTexture[] = [], register = provider.textures.register.bind(provider.textures);
    const captureTextures = spyOn(provider.textures, "register").mockImplementation((...args) => { const result = register(...args); textures.push(result); return result; });
    try {
      const scene = new SceneModelRenderer(provider, assets.world), frames = new SceneFrameBuilder(assets.images);
      await scene.preload([entity], source);
      const texture = textures.find(value => value.name === skin.name + ":4:12");
      if (texture === undefined || texture.content.kind !== "indexed8") throw new Error("Missing indexed material");
      expect(texture.content.translation).toEqual(q1PlayerTranslation(4, 12)); expect(texture.fullbright).not.toBeNull();
      expect(texture.content.levels[0].pixels.length).toBe(296 * 194); expect(pixels[0]).toBe(0);
      const count = textures.length; await scene.preload([entity], source); expect(textures).toHaveLength(count);
      const snapshots: Uint8Array[] = [];
      for (const colors of [{ top: 4, bottom: 12 }, { top: 12, bottom: 4 }]) {
        const options = () => ({ indexedSkin: skin, playerColors: colors }); await scene.preload([entity], options);
        const input = { camera, lights: [{ origin, radius: 96, minimum: 0, color: { x: 1, y: 1, z: 1 } }], time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: identity.seat(0) }, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
        const batches = sceneModelBatches(scene.prepare([entity], input, options)); expect(batches.length).toBeGreaterThan(0);
        frames.begin(); frames.view({ target: input.target, time: input.time, viewport: camera.viewport, clear: input.clear, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
        const pending = renderer.captureNextFrame(); renderer.execute(frames.finish()); const image = await pending;
        expect(image.filter((value, index) => index % 4 !== 3 && value > 5).length).toBeGreaterThan(100);
        snapshots.push(image); await Bun.write(`/tmp/qw-indexed-skin-${backend}-${colors.top}.png`, encodePng(320, 240, image));
      }
      expect(snapshots[0]).not.toEqual(snapshots[1]);
      const other = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
      if (other.kind !== "run") throw new Error("Missing Q2 map launch");
      const q2 = await loadApplicationContent(other.options);
      try {
        const q2Provider = await assets.provider(q2.recipe.map.entities.content);
        const world = await WorldScene.load(q2.world, q2Provider.shaders, { q2SkyName: "unit1_" });
        try {
          const foreign = new SceneModelRenderer(provider, world); await foreign.preload([entity], source);
          const input = { camera, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: identity.seat(0) } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
          const batches = sceneModelBatches(foreign.prepare([entity], input, source));
          expect(batches.some(batch => batch.texture.kind === "bind-image" && batch.texture.image.width === 296 && batch.texture.image.height === 194)).toBe(true);
          expect(prepareSceneEntity(entity, { camera, timeSeconds: 0, options: source }).surfaces[0]?.geometry).toEqual(native.surfaces[0]?.geometry);
          frames.begin(); frames.view({ target: input.target, time: input.time, viewport: camera.viewport, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
          const pending = renderer.captureNextFrame(); renderer.execute(frames.finish());
          await Bun.write(`/tmp/qw-indexed-skin-${backend}-q2-map.png`, encodePng(320, 240, await pending));
        } finally { world.close(); }
      } finally { await q2.close(); }
    } finally { captureTextures.mockRestore(); }
  } finally { renderer.close(); assets.close(); await content.close(); }
}, 30000);
