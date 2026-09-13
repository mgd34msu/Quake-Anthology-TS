import { expect, test } from "bun:test";
import { openArchive } from "../../src/content/archive/index.ts";
import { createContentDigest, createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../src/contracts/content.ts";
import type { OpenedResource } from "../../src/content/mounts/index.ts";
import type { SceneEntity } from "../../src/contracts/scene.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { loadApplicationModel } from "../../src/app/bootstrap/model-loader.ts";
import type { ApplicationModelProvider } from "../../src/app/bootstrap/model-loader.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { decodeQ2Map } from "../../src/formats/q2-map/index.ts";
import { decodePcx, encodePng } from "../../src/formats/images/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene, perspectiveProjection } from "../../src/render/scene/index.ts";
import { SceneModelRenderer, prepareSceneEntity } from "../../src/render/scene/models/index.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";

async function fixture() {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/rerelease/baseq2/pak0.pak");
  const identity = createIdentityOwner("q2-md5-loader"), owner = { identity: Symbol("q2-md5"), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner), overrides = new Map<string, Uint8Array | null>(), ranks = new Map<string, number>();
  async function open(path: string): Promise<OpenedResource | null> {
    const entry = archive.findEntries(path)[0];
    const bytes = overrides.has(path) ? overrides.get(path) : entry === undefined ? null : await archive.readEntry(entry);
    if (bytes == null) return null;
    const mount = { kind: "loose", identity: createMountIdentity(createMountId("md5", "q2"), createContentId({ family: "q2", edition: "rerelease", package: "base", revision: "retail" }), 0), rootPath: "/" } satisfies Extract<ResolvedResourceReference["provenance"], { kind: "loose" }>["mount"];
    const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, provenance: { kind: "loose", mount, memberPath: path },
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")), byteLength: bytes.length,
      resolution: { kind: "default-order", plan: createMountPlanId("md5", "test"), rank: ranks.get(path) ?? 0 } };
    return { bytes, reference: { ...record, id: createResourceId(record) } };
  }
  async function required(path: string) { const result = await open(path); if (result === null) throw new Error(`Missing ${path}`); return result; }
  const palette = await required("pics/colormap.pcx"), colors = decodePcx(palette.bytes).palette;
  if (colors === null) throw new Error("Missing palette");
  const textures = new SceneTextureLoader(images, { read: async path => { const asset = await open(path); return asset === null ? null : { bytes: asset.bytes, source: { kind: "resource", resource: asset.reference } }; } }, { colors, source: palette.reference });
  const shaders = new SceneShaderRegistry(textures);
  const provider = { family: "q2", mounts: { open }, textures, shaders, palette: { colors, source: palette.reference } } satisfies ConstructorParameters<typeof SceneModelRenderer>[0] & ApplicationModelProvider;
  return { archive, identity, owner, images, overrides, ranks, required, provider };
}

const paths = ["players/male/tris.md2", "models/monsters/soldier/tris.md2", "players/male/a_grenades.md2", "models/weapons/v_blast/tris.md2"];

test("application loader selects Q2 MD5 pairs and preserves rank, fallback and optional scale diagnostics", async () => {
  const f = await fixture();
  try {
    for (const path of paths) {
      const asset = await f.required(path), enhanced = await loadApplicationModel(f.provider, asset);
      expect(enhanced.model.kind).toBe("md5");
      const plain = await loadApplicationModel(f.provider, asset, { enhancedModels: false });
      expect(plain.model.kind).toBe("q2-md2"); expect(plain.resource).toBe(asset.reference);
      if (enhanced.model.kind !== "md5" || enhanced.model.skinSelection.kind !== "q2-md2-replacement" || plain.model.kind !== "q2-md2") throw new Error("Missing alias metadata");
      expect(enhanced.model.skinSelection.sourceFrameCount).toBe(plain.model.frames.length);
      expect(enhanced.model.frames.length).toBe(plain.model.frames.length);
      expect(enhanced.model.skinSelection.diagnostics).toEqual([]);
      expect(enhanced.model.skinSelection.skins.length).toBe(plain.model.skins.length);
      if (path.includes("a_grenades")) expect(enhanced.model.frames.some(frame => frame.joints.some(joint => joint.scale !== 1))).toBe(true);
    }
    const asset = await f.required(paths[0] ?? ""), mesh = "players/male/md5/tris.md5mesh", animation = "players/male/md5/tris.md5anim", scale = "players/male/md5/tris.md5scale";
    f.ranks.set(mesh, 1); expect((await loadApplicationModel(f.provider, asset)).model.kind).toBe("q2-md2"); f.ranks.clear();
    for (const path of [mesh, animation]) {
      f.overrides.set(path, null); expect((await loadApplicationModel(f.provider, asset)).model.kind).toBe("q2-md2");
      f.overrides.set(path, new TextEncoder().encode("invalid")); expect((await loadApplicationModel(f.provider, asset)).model.kind).toBe("q2-md2"); f.overrides.clear();
    }
    f.overrides.set(scale, new TextEncoder().encode("not JSON"));
    const scaled = await loadApplicationModel(f.provider, asset);
    if (scaled.model.kind !== "md5" || scaled.model.skinSelection.kind !== "q2-md2-replacement") throw new Error("Optional scale incorrectly rejected replacement");
    expect(scaled.model.skinSelection.diagnostics).toHaveLength(1);
    expect(scaled.model.frames.every(frame => frame.joints.every(joint => joint.scale === 1))).toBe(true);
  } finally { f.archive.close(); }
});

for (const backend of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) test.skipIf(process.env["QUAKE_MD5_RENDER"] !== "1")(`application-loaded Q2 MD5 renders real male, soldier, blaster and joint scales through ${backend}`, async () => {
  const f = await fixture();
  const renderer = NativeRenderer.open({ renderer: backend, width: 320, height: 240, hidden: true, gamma: 1 }, f.owner);
  try {
    const map = await f.required("maps/base1.bsp"), world = await WorldScene.load(decodeQ2Map(map.bytes), f.provider.shaders, { q2SkyName: "unit1_" });
    const scene = new SceneModelRenderer(f.provider, world), frames = new SceneFrameBuilder(f.images);
    const axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] satisfies SceneCamera["axis"];
    for (const path of paths) {
      const loaded = await loadApplicationModel(f.provider, await f.required(path));
      if (loaded.model.kind !== "md5" || loaded.model.skinSelection.kind !== "q2-md2-replacement") throw new Error("Application loader left MD2 selected");
      const origin = { x: 128, y: -320, z: 24 }, small = path.includes("a_grenades");
      const camera: SceneCamera = { origin: { ...origin, x: origin.x - (small ? 28 : 110), z: origin.z + (small ? 0 : 6) }, axis,
        projection: perspectiveProjection(65, 50, 4096), viewport: { x: 0, y: 0, width: 320, height: 240 }, clip: { kind: "none" } };
      const entity: SceneEntity = { actor: null, resource: loaded.resource, model: loaded.model, transform: { origin, axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: origin,
        pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: path.includes("soldier") ? 2 : 0,
        color: { x: 1, y: 1, z: 1, w: 1 }, shaderTime: { kind: "seconds", value: 0 }, flags: { kind: "q2", bits: 8 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] };
      const options = () => ({ player: path === paths[0], customShader: path === paths[0] ? "players/male/grunt.pcx" : null });
      const prepared = prepareSceneEntity(entity, { camera, timeSeconds: 0, options });
      expect(prepared.surfaces[0]?.image).toEqual({ kind: "external", name: path === paths[0] ? "players/male/grunt.pcx" : path.includes("soldier") ? "models/monsters/soldier/md5/skin.pcx" : path.includes("v_blast") ? "models/weapons/v_blast/md5/skin.pcx" : "models/objects/grenade3/md5/skin.pcx" });
      expect(prepared.surfaces.every(surface => surface.cull === "front")).toBe(true);
      const shell = prepareSceneEntity({ ...entity, flags: { kind: "q2", bits: 1024 | 16 | 32 } }, { camera, timeSeconds: 0, options });
      expect(shell.surfaces[0]?.image.kind).toBe("white"); expect(shell.surfaces[0]?.depthRange).toEqual([0, 0.3]); expect(shell.surfaces[0]?.translucent).toBe(true);
      const invalid = prepareSceneEntity({ ...entity, pose: { kind: "frame", frame: loaded.model.skinSelection.sourceFrameCount + 1, previousFrame: 1, backLerp: 0.5 } }, { camera, timeSeconds: 0, options });
      expect(invalid.surfaces[0]?.geometry.vertices).toEqual(prepared.surfaces[0]?.geometry.vertices);
      await scene.preload([entity], options);
      const snapshots: Uint8Array[] = [];
      for (const frame of small ? [0, 110, 112, 120] : [0, 40]) {
        const animated = { ...entity, pose: { kind: "frame", frame, previousFrame: frame, backLerp: 0 } } satisfies SceneEntity;
        const input = { camera, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: f.identity.seat(0) }, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
        const batches = scene.prepare([animated], input, options); expect(batches.length).toBeGreaterThan(0);
        frames.begin(); frames.view({ target: input.target, time: input.time, viewport: camera.viewport, clear: input.clear,
          clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
        const capture = renderer.captureNextFrame(); renderer.execute(frames.finish()); const pixels = await capture;
        const visibleChannels = pixels.filter((value, index) => index % 4 !== 3 && value > 5).length;
        if (small && frame === 112) { expect(loaded.model.frames[frame]?.joints.some(joint => joint.scale === 0)).toBe(true); expect(visibleChannels).toBe(0); }
        else expect(visibleChannels).toBeGreaterThan(100);
        snapshots.push(pixels);
        await Bun.write(`/tmp/q2-md5-${backend}-${path.includes("soldier") ? "soldier" : small ? "grenades" : path.includes("v_blast") ? "blaster" : "male"}-${frame}.png`, encodePng(320, 240, pixels));
      }
      expect(snapshots[0]).not.toEqual(snapshots[1]);
    }
  } finally { renderer.close(); f.archive.close(); }
}, 30000);
