import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { sceneModelBatches } from "../../src/render/scene/submissions.ts";
import { expect, test } from "bun:test";
import { openArchive } from "../../src/content/archive/index.ts";
import { createContentDigest, createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../src/contracts/content.ts";
import type { OpenedResource } from "../../src/content/mounts/index.ts";
import type { SceneEntity } from "../../src/contracts/scene.ts";
import type { SceneCamera } from "../../src/contracts/render.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { loadApplicationModel } from "../../src/app/bootstrap/model-loader.ts";
import type { ApplicationModelProvider, LoadedApplicationModel } from "../../src/app/bootstrap/model-loader.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { decodeQ2Map } from "../../src/formats/q2-map/index.ts";
import { decodePcx, encodePng } from "../../src/formats/images/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene, perspectiveProjection } from "../../src/render/scene/index.ts";
import { SceneModelRenderer, prepareSceneEntity } from "../../src/render/scene/models/index.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { anglesToAxis } from "../../src/core/math.ts";

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
  const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:test"));
  const provider = { family: "q2", mounts: { open }, textures, shaders, palette: { colors, source: palette.reference } } satisfies ConstructorParameters<typeof SceneModelRenderer>[0] & ApplicationModelProvider;
  return { archive, identity, owner, images, overrides, ranks, required, provider };
}


function replacement(asset: LoadedApplicationModel) {
  if (asset.model.kind !== "q2-md2") throw new Error("Native MD2 was discarded");
  const model = asset.model.replacement?.model;
  if (model === undefined || model.skinSelection.kind !== "q2-md2-replacement") throw new Error("Missing Q2 replacement");
  return { ...model, skinSelection: model.skinSelection };
}

const paths = ["players/male/tris.md2", "models/monsters/soldier/tris.md2", "players/male/a_grenades.md2", "models/weapons/v_blast/tris.md2"];

test("application loader selects Q2 MD5 pairs and preserves rank, fallback and optional scale diagnostics", async () => {
  const f = await fixture();
  try {
    for (const path of paths) {
      const asset = await f.required(path), enhanced = await loadApplicationModel(f.provider, asset);
      expect(enhanced.model.kind).toBe("q2-md2");
      expect(enhanced.resource).toBe(asset.reference);
      const enhancedModel = replacement(enhanced);
      const plain = await loadApplicationModel(f.provider, asset, { enhancedModels: false });
      expect(plain.model.kind).toBe("q2-md2"); expect(plain.resource).toBe(asset.reference);
      if (plain.model.kind !== "q2-md2") throw new Error("Missing alias metadata");
      expect(enhancedModel.skinSelection.sourceFrameCount).toBe(plain.model.frames.length);
      expect(enhancedModel.frames.length).toBe(plain.model.frames.length);
      expect(enhancedModel.skinSelection.diagnostics).toEqual([]);
      expect(enhancedModel.skinSelection.skins.length).toBe(plain.model.skins.length);
      if (path.includes("a_grenades")) expect(enhancedModel.frames.some(frame => frame.joints.some(joint => joint.scale !== 1))).toBe(true);
    }
    const asset = await f.required(paths[0] ?? ""), mesh = "players/male/md5/tris.md5mesh", animation = "players/male/md5/tris.md5anim", scale = "players/male/md5/tris.md5scale";
    f.ranks.set(mesh, 1); expect((await loadApplicationModel(f.provider, asset)).model).toMatchObject({ kind: "q2-md2", replacement: null }); f.ranks.clear();
    for (const path of [mesh, animation]) {
      f.overrides.set(path, null); expect((await loadApplicationModel(f.provider, asset)).model).toMatchObject({ kind: "q2-md2", replacement: null });
      f.overrides.set(path, new TextEncoder().encode("invalid")); expect((await loadApplicationModel(f.provider, asset)).model).toMatchObject({ kind: "q2-md2", replacement: null }); f.overrides.clear();
    }
    f.overrides.set(scale, new TextEncoder().encode("not JSON"));
    const scaled = await loadApplicationModel(f.provider, asset);
    const scaledModel = replacement(scaled);
    expect(scaledModel.skinSelection.diagnostics).toHaveLength(1);
    expect(scaledModel.frames.every(frame => frame.joints.every(joint => joint.scale === 1))).toBe(true);
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
      const skeletal = replacement(loaded);
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
      const invalid = prepareSceneEntity({ ...entity, pose: { kind: "frame", frame: skeletal.skinSelection.sourceFrameCount + 1, previousFrame: 1, backLerp: 0.5 } }, { camera, timeSeconds: 0, options });
      expect(invalid.surfaces[0]?.geometry.vertices).toEqual(prepared.surfaces[0]?.geometry.vertices);
      await scene.preload([entity], options);
      const snapshots: Uint8Array[] = [];
      for (const frame of small ? [0, 110, 112, 120] : [0, 40]) {
        const animated = { ...entity, pose: { kind: "frame", frame, previousFrame: frame, backLerp: 0 } } satisfies SceneEntity;
        const input = { camera, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: f.identity.seat(0) }, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
        const batches = sceneModelBatches(scene.prepare([animated], input, options)); expect(batches.length).toBeGreaterThan(0);
        frames.begin(); frames.view({ target: input.target, time: input.time, viewport: camera.viewport, clear: input.clear,
          clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
        const capture = renderer.captureNextFrame(); renderer.execute(frames.finish()); const pixels = await capture;
        const visibleChannels = pixels.filter((value, index) => index % 4 !== 3 && value > 5).length;
        if (small && frame === 112) { expect(skeletal.frames[frame]?.joints.some(joint => joint.scale === 0)).toBe(true); expect(visibleChannels).toBe(0); }
        else expect(visibleChannels).toBeGreaterThan(100);
        snapshots.push(pixels);
        await Bun.write(`/tmp/q2-md5-${backend}-${path.includes("soldier") ? "soldier" : small ? "grenades" : path.includes("v_blast") ? "blaster" : "male"}-${frame}.png`, encodePng(320, 240, pixels));
      }
      expect(snapshots[0]).not.toEqual(snapshots[1]);
    }
  } finally { renderer.close(); f.archive.close(); }
}, 30000);

test("retained Q2 aliases select by each eye, preserve native bounds and commit load changes together", async () => {
  const f = await fixture();
  try {
    const loaded = await loadApplicationModel(f.provider, await f.required("models/monsters/soldier/tris.md2"));
    if (loaded.model.kind !== "q2-md2" || loaded.variants === undefined) throw new Error("Missing retained alias pair");
    const native = loaded.model, skeletal = replacement(loaded);
    const axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] satisfies SceneCamera["axis"];
    const origin = { x: 0, y: 0, z: 0 };
    const entity: SceneEntity = { actor: null, resource: loaded.resource, model: native,
      transform: { origin, axis, scale: { x: 2, y: 1, z: 1 } }, previousOrigin: origin,
      pose: { kind: "frame", frame: 0, previousFrame: 1, backLerp: 0.5 }, skin: 500,
      color: { x: 1, y: 1, z: 1, w: 1 }, shaderTime: { kind: "seconds", value: 0 },
      flags: { kind: "q2", bits: 0 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] };
    const camera: SceneCamera = { origin: { x: -2048, y: 0, z: 0 }, axis,
      projection: perspectiveProjection(65, 50, 8192), viewport: { x: 0, y: 0, width: 320, height: 240 }, clip: { kind: "none" } };
    const near = prepareSceneEntity(entity, { camera, timeSeconds: 0 });
    const far = prepareSceneEntity(entity, { camera: { ...camera, origin: { ...camera.origin, x: -2049 } }, timeSeconds: 0 });
    expect(near.entity.model.kind).toBe("md5"); expect(far.entity.model).toBe(native);
    expect(near.bounds).toEqual(far.bounds); expect(near.surfaces[0]?.image).toEqual({ kind: "external", name: skeletal.skinSelection.skins[0] ?? "" });
    expect(far.surfaces[0]?.image).toEqual({ kind: "external", name: native.skins[0] ?? "" });
    const first = native.frames[0], previous = native.frames[1];
    if (first === undefined || previous === undefined) throw new Error("Missing original bounds frames");
    expect(near.bounds?.max.x).toBeCloseTo(Math.max(first.translation.x + first.scale.x * 255, previous.translation.x + previous.scale.x * 255) * 2, 4);
    for (const x of [-2048, -2049]) {
      const bad = prepareSceneEntity({ ...entity, pose: { kind: "frame", frame: native.frames.length, previousFrame: 1, backLerp: 0.5 } },
        { camera: { ...camera, origin: { x, y: 0, z: 0 } }, timeSeconds: 0 });
      expect(bad.frame).toBe(0); expect(bad.previousFrame).toBe(0); expect(bad.frameFallback).toBe(true);
    }
    const custom = prepareSceneEntity(entity, { camera, timeSeconds: 0,
      options: () => ({ customSkin: [{ name: "mesh0", shader: "players/male/grunt.pcx" }] }) });
    expect(custom.surfaces[0]?.image).toEqual({ kind: "external", name: "players/male/grunt.pcx" });
    const clear = await loaded.variants.prepareReplacement(f.provider, false);
    expect(native.replacement?.model.kind).toBe("md5"); clear(); expect(native.replacement).toBeNull();
    expect(prepareSceneEntity(entity, { camera, timeSeconds: 0 }).entity.model).toBe(native);
    const restore = await loaded.variants.prepareReplacement(f.provider, true);
    expect(native.replacement).toBeNull(); restore();
    expect(prepareSceneEntity(entity, { camera, timeSeconds: 0 }).entity.model.kind).toBe("md5");
    const joint = skeletal.joints[0];
    if (joint === undefined) throw new Error("Missing source skeleton joint");
    const world = await WorldScene.load(decodeQ2Map((await f.required("maps/base1.bsp")).bytes), f.provider.shaders, { q2SkyName: "unit1_" });
    try {
      const renderer = new SceneModelRenderer(f.provider, world), attached = { ...entity, attachments: [{ tag: joint.name, entity }] };
      await renderer.preload([attached]);
      const input = { camera, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: f.identity.seat(0) },
        clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
      const turning = { ...near.entity, model: skeletal, flags: { kind: "q2", bits: 8 },
        transform: { ...entity.transform, axis: anglesToAxis({ x: 0, y: 90, z: 0 }) } } satisfies SceneEntity;
      const still = { ...turning, transform: { ...turning.transform, axis: entity.transform.axis } };
      const before = sceneModelBatches(renderer.prepare([turning], input)), fixed = sceneModelBatches(renderer.prepare([still], input));
      expect(before.length).toBeGreaterThan(0); expect(fixed.length).toBeGreaterThan(0);
      expect(sceneModelBatches(renderer.prepare([turning, still], input))).toEqual([...before, ...fixed]);
      turning.transform.axis = anglesToAxis({ x: 0, y: -90, z: 0 });
      const after = sceneModelBatches(renderer.prepare([turning], input));
      expect(after).toEqual(sceneModelBatches(renderer.prepare([{ ...turning, transform: { ...turning.transform } }], input)));
      expect(after.flatMap(batch => batch.vertices.map(vertex => vertex.color)))
        .not.toEqual(before.flatMap(batch => batch.vertices.map(vertex => vertex.color)));
      expect(prepareSceneEntity(attached, { camera, timeSeconds: 0 }).attachments).toHaveLength(1);
      expect(renderer.prepareShadowCasters([attached], { ...input, camera: { ...camera, origin: { x: -4096, y: 0, z: 0 } } })).toHaveLength(2);
      const eager = renderer.prepareShadowCasters([attached], input);
      let bodies = 0;
      const childOnly = renderer.prepareShadowCasters([attached], input, undefined, undefined, () => ++bodies !== 1);
      expect(bodies).toBe(2);
      expect(childOnly).toEqual(eager.slice(1));
      const indexed = { ...entity, model: { ...native, replacement: null } };
      expect(renderer.prepareShadowCasters([indexed], input, undefined, undefined, () => false))
        .toEqual(renderer.prepareShadowCasters([indexed], input));
      const shell = { ...entity, flags: { kind: "q2", bits: 1024 } } satisfies SceneEntity;
      expect(renderer.prepareShadowCasters([shell], input, undefined, undefined, () => true)).toEqual(eager.slice(0, 1));
      f.provider.shaders.addScript(`shadow-bound-deform
{
 deformVertexes move 800 0 0 sin 1 0 0 0
 {
  map $whiteimage
 }
}
shadow-bound-static
{
 {
  map $whiteimage
 }
}`, "<shadow envelope material fixture>");
      const scripted = new SceneModelRenderer({ ...f.provider, family: "q3" }, world);
      const deformed = () => ({ customShader: "shadow-bound-deform" });
      const staticSkin = () => ({ customShader: "shadow-bound-static" });
      await scripted.preload([entity], deformed);
      await scripted.preload([entity], staticSkin);
      let boundCalls = 0;
      expect(scripted.prepareShadowCasters([entity], input, deformed)).toHaveLength(1);
      expect(scripted.prepareShadowCasters([entity], input, staticSkin)).toHaveLength(1);
      expect(scripted.prepareShadowCasters([entity], input, deformed, undefined, () => { boundCalls++; return false; }))
        .toEqual(scripted.prepareShadowCasters([entity], input, deformed));
      expect(boundCalls).toBe(0);
      expect(scripted.prepareShadowCasters([entity], input, staticSkin, undefined, () => false)).toEqual([]);
    } finally { world.close(); }
  } finally { f.archive.close(); }
}, 30000);
