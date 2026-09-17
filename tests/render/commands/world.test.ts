import { SceneMaterialRegistrations } from "../../../src/render/scene/material-registrations.ts";
import { prepareMaterialBatches } from "../../../src/materials/evaluate.ts";
import { compiledDrawGroup, sequenceDrawGroup, finishSceneOperations, sceneModelBatches, createSourceSceneOrder, sourceDrawGroup } from "../../../src/render/scene/submissions.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DecodedWorld, SceneEntity, SceneLight } from "../../../src/contracts/scene.ts";
import type { DrawBatch, Palette, RenderOperation, RendererResourceOwner, SceneCamera } from "../../../src/contracts/render.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { localPoint, localVector, worldPoint, worldVector, createViewProjector } from "../../../src/render/scene/view.ts";
import { portalCamera } from "../../../src/render/scene/portal.ts";
import { anglesToAxis } from "../../../src/core/math.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import { decodeQ3World, parseEntities } from "../../../src/formats/q3-map/index.ts";
import { decodePcx } from "../../../src/formats/images/indexed.ts";
import { SceneImageRegistry, SceneTextureLoader, SceneShaderRegistry, WorldScene, perspectiveProjection } from "../../../src/render/scene/index.ts";
import { SceneFrameBuilder, clipPicture } from "../../../src/render/commands/frame.ts";
import { SoftwareRenderer } from "../../../src/render/cpu/rasterizer.ts";
import { CpuRenderTarget } from "../../../src/render/cpu/commands.ts";
import { encodePng } from "../../../src/formats/images/png.ts";
import { parseMd2 } from "../../../src/formats/q12-model/index.ts";
import { SceneModelRenderer } from "../../../src/render/scene/models/renderer.ts";
import { createWorldSurfaceAdmission, type WorldViewInput } from "../../../src/render/scene/world.ts";

test("HUD clipping keeps texture coordinates inside an independent seat", () => {
  expect(clipPicture({ x: -10, y: 0, width: 20, height: 10 }, { s1: 0, t1: 0, s2: 1, t2: 1 }, { x: 0, y: 0, width: 100, height: 100 }))
    .toEqual({ rect: { x: 0, y: 0, width: 10, height: 10 }, uv: { s1: 0.5, t1: 0, s2: 1, t2: 1 } });
});

test("shared view orders remapped world and multipass effects across legacy groups without crossing state barriers", async () => {
  const identity = createIdentityOwner("material-order"), owner = { identity: Symbol("material-order"), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner), textures = new SceneTextureLoader(images, { read: async () => null });
  const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:test"));
  shaders.addScript(`ordering/world { sort 3 cull none { map $whiteimage rgbGen const ( 0.1 0.1 0.1 ) } }
ordering/remap { sort 9 cull none { map $whiteimage blendFunc add rgbGen const ( 0.2 0.2 0.2 ) } }
ordering/mark { polygonOffset cull none { map $whiteimage blendFunc GL_ZERO GL_ONE_MINUS_SRC_COLOR } }
ordering/flash { cull none
 { map $whiteimage blendFunc add rgbGen const ( 0.4 0.4 0.4 ) }
 { map $whiteimage blendFunc add rgbGen const ( 0.6 0.6 0.6 ) }
}`, "<material ordering>");
  const bounds = { min: { x: 32, y: -8, z: -8 }, max: { x: 32, y: 8, z: 8 } };
  const map: Extract<DecodedWorld, { readonly kind: "q3-bsp" }> = {
    kind: "q3-bsp", format: "ibsp46", entities: "{}", shaders: [{ name: "ordering/world", surfaceFlags: 0, contentFlags: 0 }],
    planes: [], nodes: [], leaves: [{ cluster: 0, area: 0, bounds, surfaces: { first: 0, count: 1 }, brushes: { first: 0, count: 0 } }],
    leafSurfaces: [0], leafBrushes: [], models: [{ bounds, surfaces: { first: 0, count: 1 }, brushes: { first: 0, count: 0 } }],
    brushes: [], brushSides: [], vertices: [{ x: 32, y: -8, z: -8 }, { x: 32, y: 8, z: -8 }, { x: 32, y: 0, z: 8 }].map(position => ({
      position, normal: { x: -1, y: 0, z: 0 }, texCoord: { x: 0, y: 0 }, lightmapCoord: { x: 0, y: 0 }, color: { x: 255, y: 255, z: 255, w: 255 },
    })), indices: [0, 1, 2], fogs: [], surfaces: [{ kind: "triangles", shader: 0, fog: -1, vertices: { first: 0, count: 3 }, indices: { first: 0, count: 3 },
      lightmap: { image: -1, x: 0, y: 0, width: 0, height: 0, origin: { x: 0, y: 0, z: 0 }, vectors: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }] } }],
    lightmaps: [], lightGrid: [], visibility: null,
  };
  const scene = await WorldScene.load(map, shaders);
  try {
    const camera: SceneCamera = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
      viewport: { x: 0, y: 0, width: 32, height: 32 }, projection: perspectiveProjection(90, 90, 4096), clip: { kind: "none" } };
    const input: WorldViewInput = { camera, target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0 } };
    const context = scene.materialContext(input), geometry = { vertices: map.vertices, indices: map.indices };
    const drawBatches = (operations: readonly RenderOperation[]) => operations.flatMap(operation => operation.kind === "draw" ? operation.batches : []);
    const mark = await shaders.register("ordering/mark"), flash = await shaders.register("ordering/flash");
    expect(mark.finished.sort).toBe(4); expect(flash.finished.sort).toBe(9);
    const markBatches = prepareMaterialBatches(mark, geometry, context), flashBatches = prepareMaterialBatches(flash, geometry, context);
    expect(flashBatches).toHaveLength(2);
    const legacyBatches: readonly DrawBatch[] = flashBatches.map(batch => ({ ...batch, state: { ...batch.state, depthWrite: true } }));
    const markGroup = compiledDrawGroup(mark, markBatches), flashGroup = compiledDrawGroup(flash, flashBatches);
    const sourceView = createSourceSceneOrder(shaders.registrations.owner);
    const sourceOrder = { view: sourceView, entity: { kind: "world" }, surface: 0, fog: 0, dlight: 0 } satisfies Parameters<typeof sourceDrawGroup>[1];
    const sourceA = sourceDrawGroup(flash, sourceOrder, flashBatches);
    const sourceB = sourceDrawGroup(flash, { ...sourceOrder, surface: 1 }, markBatches);
    const sourceC = sourceDrawGroup(flash, { ...sourceOrder, surface: 2 }, legacyBatches);
    // Donor shortsort swaps the first maximum to the end, including equal words.
    expect(finishSceneOperations([sourceA, sourceB, sourceC])).toEqual([...sourceB.operations, ...sourceC.operations, ...sourceA.operations]);
    const empty = sourceDrawGroup(flash, { ...sourceOrder, surface: 3 }, []);
    expect(empty.operations).toEqual([]);
    expect(finishSceneOperations([empty, sourceA, sourceC])).toEqual([...sourceA.operations, ...sourceC.operations]);
    expect(finishSceneOperations([sourceA, sourceC])).toEqual([...sourceC.operations, ...sourceA.operations]);
    const sourceKeys = [
      { entity: { kind: "world" }, fog: 0, dlight: 0 },
      { entity: { kind: "refentity", index: 2 }, fog: 0, dlight: 0 },
      { entity: { kind: "refentity", index: 1 }, fog: 2, dlight: 0 },
      { entity: { kind: "refentity", index: 1 }, fog: 1, dlight: 1 },
      { entity: { kind: "refentity", index: 1 }, fog: 1, dlight: 0 },
    ] satisfies readonly Pick<Parameters<typeof sourceDrawGroup>[1], "entity" | "fog" | "dlight">[];
    const keyed = sourceKeys.map((key, surface) => sourceDrawGroup(flash, { ...sourceOrder, ...key, surface }, flashBatches));
    const keyedResult = finishSceneOperations(keyed), keyedExpected = [...keyed].reverse().flatMap(group => group.operations);
    expect(keyedResult).toHaveLength(keyedExpected.length);
    for (const [index, operation] of keyedResult.entries()) expect(operation === keyedExpected[index]).toBe(true);
    // Fixed full-range donor qsortFast oracle, including its partition history for equal words.
    const partitionKeys = [4, 1, 4, 2, 1, 4, 0, 2, 4, 1, 3, 2, 0, 4, 3, 1, 4];
    const partitionOrder = [12, 6, 1, 4, 9, 15, 3, 7, 11, 10, 14, 2, 13, 5, 0, 8, 16];
    const partitionGroups = partitionKeys.map((fog, surface) => sourceDrawGroup(flash, { ...sourceOrder, fog, surface }, flashBatches));
    const partitionResult = finishSceneOperations(partitionGroups);
    expect(partitionResult).toHaveLength(partitionOrder.length);
    for (const [index, original] of partitionOrder.entries()) expect(partitionResult[index]).toBe(partitionGroups[original]?.operations[0]);
    shaders.addScript("ordering/late { sort 2 { map $whiteimage } }");
    const late = await shaders.register("ordering/late"), lateGroup = sourceDrawGroup(late, sourceOrder, markBatches);
    expect(finishSceneOperations([sourceA, lateGroup])).toEqual([...lateGroup.operations, ...sourceA.operations]);
    const sourceMark = sourceDrawGroup(mark, sourceOrder, markBatches);
    expect(finishSceneOperations([sourceA, sourceMark])).toEqual([...sourceMark.operations, ...sourceA.operations]);
    const otherView = sourceDrawGroup(mark, { ...sourceOrder, view: createSourceSceneOrder(shaders.registrations.owner) }, markBatches);
    expect(() => finishSceneOperations([sourceA, otherView])).toThrow("Different source views");
    const scaledTransform = { origin: { x: 0, y: 80, z: 0 }, axis: camera.axis, scale: 3 };
    expect(drawBatches(finishSceneOperations(scene.prepareModel(0, { ...scaledTransform, scale: 1 }, input)))).toHaveLength(0);
    expect(drawBatches(finishSceneOperations(scene.prepareModel(0, scaledTransform, input))).length).toBeGreaterThan(0);
    const numberedMap: typeof map = { ...map, shaders: [{ name: "ordering/flash", surfaceFlags: 0, contentFlags: 0 }],
      surfaces: map.surfaces.map(surface => ({ ...surface, fog: 7 })) };
    const numberedScene = await WorldScene.load(numberedMap, shaders);
    try {
      const admitted = numberedScene.prepareModel(0, { origin: camera.origin, axis: camera.axis }, {
        ...input, source: createWorldSurfaceAdmission(sourceView),
        q3Lights: [{ origin: { x: 32, y: 0, z: 0 }, radius: 64, color: { x: 1, y: 1, z: 1 }, additive: false }],
      }, { kind: "refentity", index: 5 });
      expect(admitted).toHaveLength(1);
      const first = admitted[0], order = first?.kind === "scene-group" ? first.order : undefined;
      if (order?.kind !== "source") throw new Error("Missing source world admission");
      expect(order.source.fog).toBe(8);
      expect(order.source.dlight).toBe(1);
      const admittedBatches = drawBatches(finishSceneOperations(admitted));
      expect(admittedBatches).toHaveLength(2);
      expect(admittedBatches.every(batch => batch.state.blend.source === "one" && batch.state.blend.destination === "one")).toBe(true);
    } finally { numberedScene.close(); }
    const nativeShaders = new SceneShaderRegistry(textures, shaders.registrations.owner.provider("q3:classic:retail:source-default"));
    await nativeShaders.initializeSourceMaterials(async () => {});
    const beforeMissing = shaders.registrations.owner.snapshot().length;
    const missingScene = await WorldScene.load({ ...map, shaders: [{ name: "ordering/missing-image", surfaceFlags: 0, contentFlags: 0 }] }, nativeShaders);
    try {
      expect(shaders.registrations.owner.snapshot()).toHaveLength(beforeMissing + 1);
      expect(missingScene.surfaces[0]?.shader).toBe(nativeShaders.sourceMaterials.default);
    } finally { missingScene.close(); }
    const legacy = sequenceDrawGroup("opaque", legacyBatches);
    const before = drawBatches(scene.prepareView({ ...input, operations: [flashGroup, legacy, markGroup] }).view.operations);
    expect(before.slice(1)).toEqual([...legacyBatches, ...markBatches, ...flashBatches]);
    await scene.remapShader("ordering/world", "ordering/remap");
    shaders.addScript("ordering/peer { sort 6 { map $whiteimage } }");
    const peer = await shaders.register("ordering/peer"), peerGroup = sourceDrawGroup(peer, sourceOrder, markBatches);
    const originalSortGroups = scene.prepareModel(0, { origin: camera.origin, axis: camera.axis },
      { ...input, source: createWorldSurfaceAdmission(sourceView) }, { kind: "refentity", index: 0 });
    const originalGroup = originalSortGroups[0];
    if (originalGroup?.kind !== "scene-group" || originalGroup.order.kind !== "source") throw new Error("Missing remapped source world group");
    expect(originalGroup.order.material.finished.sort).toBe(3);
    expect(drawBatches(finishSceneOperations(originalSortGroups))[0]?.state.blend).toEqual({ source: "one", destination: "one" });
    expect(finishSceneOperations([peerGroup, ...originalSortGroups])[0]).toBe(originalGroup.operations[0]);
    const genericRemapped = scene.prepareModel(0, { origin: camera.origin, axis: camera.axis }, input);
    expect(finishSceneOperations([...genericRemapped, compiledDrawGroup(peer, markBatches)])[0]?.kind).toBe("draw");
    expect(drawBatches(finishSceneOperations([...genericRemapped, compiledDrawGroup(peer, markBatches)]))[0]).toBe(markBatches[0]);
    const remapped = drawBatches(scene.prepareView({ ...input, operations: [flashGroup, legacy, markGroup] }).view.operations);
    expect(remapped.slice(0, legacyBatches.length + markBatches.length)).toEqual([...legacyBatches, ...markBatches]);
    expect(remapped.at(legacyBatches.length + markBatches.length)?.vertices[0]?.color.x).toBeCloseTo(0.2, 2);
    expect(remapped.slice(-2)).toEqual([...flashBatches]);
    const barrier: RenderOperation = { kind: "depth-range", range: [0, 0.3] };
    expect(finishSceneOperations([sourceA, barrier, otherView])).toEqual([...sourceA.operations, barrier, ...otherView.operations]);
    expect(finishSceneOperations([flashGroup, barrier, markGroup])).toEqual([...flashGroup.operations, barrier, ...markGroup.operations]);
    const translucent = sequenceDrawGroup("translucent", markBatches);
    expect(drawBatches(finishSceneOperations([translucent, legacy]))).toEqual([...markBatches, ...legacyBatches]);
    expect(drawBatches(finishSceneOperations([flashGroup, translucent, legacy, markGroup])))
      .toEqual([...markBatches, ...flashBatches, ...markBatches, ...legacyBatches]);
    shaders.addScript("ordering/lightmapped { sort 3 { map $lightmap } }");
    const lightmappedMap: typeof map = { ...map, shaders: [{ name: "ordering/lightmapped", surfaceFlags: 0, contentFlags: 0 }], surfaces: map.surfaces.map(surface => ({ ...surface, kind: "planar", lightmap: { ...surface.lightmap, image: 0 } })),
      lightmaps: [new Uint8Array(128 * 128 * 3).fill(96)] };
    const lightmapped = await WorldScene.load(lightmappedMap, shaders);
    const replacementTextures = new SceneTextureLoader(images, { read: async () => null }), replacementShaders = shaders.replacement(replacementTextures);
    try {
      const original = lightmapped.surfaces[0]?.shader, originalImage = lightmapped.surfaces[0]?.lightmap;
      if (original === undefined || original === null) throw new Error("Missing lightmapped registration");
      expect(original.finished.lightmapIndex).toBe(0);
      const originalContent = original.registered, registrations = shaders.registrations.owner.snapshot();
      await shaders.prepareReplacement(replacementShaders);
      const staged = await lightmapped.prepareImages(replacementShaders);
      expect(staged.materialWorld).toBe(lightmapped.materialWorld);
      expect(staged.surfaces[0]?.shader?.registration).toBe(original.registration);
      expect(staged.surfaces[0]?.lightmap).not.toBe(originalImage);
      expect(original.registered).toBe(originalContent);
      expect(shaders.registrations.owner.snapshot()).toEqual(registrations);
      shaders.commitReplacement(replacementShaders); lightmapped.commitImages(staged);
      expect(lightmapped.surfaces[0]?.shader).toBe(original);
      expect(original.registered).not.toBe(originalContent);
      const secondWorld = await WorldScene.load({ ...lightmappedMap }, shaders);
      try {
        expect(secondWorld.materialWorld).not.toBe(lightmapped.materialWorld);
        expect(secondWorld.surfaces[0]?.shader?.registration).not.toBe(original.registration);
      } finally { secondWorld.close(); }
    } finally { lightmapped.close(); replacementTextures.close(); }
  } finally { scene.close(); images.close(); }
});

const root = process.env["QFILES_ROOT"] ?? "/home/buzzkill/Projects/qfiles";
const cases: readonly { readonly family: "q1" | "q2" | "q3"; readonly archive: string; readonly map: string }[] = [
  { family: "q1", archive: "q1/id1/PAK0.PAK", map: "maps/start.bsp" },
  { family: "q2", archive: "q2/baseq2/pak0.pak", map: "maps/base1.bsp" },
  { family: "q2", archive: "q2/rerelease/baseq2/pak0.pak", map: "maps/base1.bsp" },
  { family: "q3", archive: "q3a/baseq3/pak0.pk3", map: "maps/q3dm1.bsp" },
  { family: "q3", archive: "q2/baseq2/pak6.pak", map: "maps/q3test1.bsp" },
];

for (const fixture of cases) test.skipIf(!existsSync(`${root}/${fixture.archive}`))(`prepares and draws ${fixture.archive}:${fixture.map}`, async () => {
  const path = `${root}/${fixture.archive}`, archive = await openArchive(path);
  try {
    const read = async (name: string): Promise<Uint8Array | null> => {
      const entry = archive.findEntries(name, "ascii-insensitive")[0];
      return entry === undefined ? null : archive.readEntry(entry);
    };
    const bytes = await read(fixture.map);
    if (bytes === null) throw new Error(`Missing map ${fixture.map}`);
    const map: DecodedWorld = fixture.family === "q1" ? readQ1Bsp(bytes) : fixture.family === "q2" ? decodeQ2Map(bytes) : decodeQ3World(bytes);
    let palette: Palette | null = null;
    if (fixture.family !== "q3") {
      const palettePath = fixture.family === "q1" ? "gfx/palette.lmp" : "pics/colormap.pcx", paletteBytes = await read(palettePath);
      if (paletteBytes === null) throw new Error(`Missing palette ${palettePath}`);
      const colors = fixture.family === "q1" ? paletteBytes : decodePcx(paletteBytes).palette;
      if (colors === null) throw new Error("PCX did not contain its palette");
      const hasher = new Bun.CryptoHasher("sha256");
      for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
      const entry = archive.findEntries(palettePath, "ascii-insensitive")[0];
      if (entry === undefined) throw new Error("Palette archive ordinal was lost");
      palette = { colors, source: { id: `resource:test-${fixture.family}-palette`, requestedPath: palettePath,
        digest: createContentDigest(new Bun.CryptoHasher("sha256").update(paletteBytes).digest("hex")), byteLength: paletteBytes.length,
        provenance: { kind: "archive", memberPath: palettePath, memberIndex: entry.ordinal, mount: { kind: "archive", format: "pak", archivePath: path,
          archiveDigest: createContentDigest(hasher.digest("hex")), identity: { id: `mount:${fixture.family}:scene-test`, content: `${fixture.family}:classic:retail:test`, generation: 0 } } },
        resolution: { kind: "default-order", plan: "mount-plan:scene:test", rank: 0 } } };
    }
    const identity = createIdentityOwner(`world-${fixture.family}`);
    const owner: RendererResourceOwner = { identity: Symbol(fixture.family), session: identity.session, generation: 0 };
    const images = new SceneImageRegistry(owner);
    const textures = new SceneTextureLoader(images, { read: async name => { const bytes = await read(name); return bytes === null ? null : { bytes, source: { kind: "generated", name: `${fixture.archive}:${name}` } }; } }, palette);
    const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:test"));
    if (fixture.family === "q3") for (const entry of archive.entries) {
      if (entry.path.startsWith("scripts/") && entry.path.endsWith(".shader")) shaders.addScript(new TextDecoder().decode(await archive.readEntry(entry)), entry.path);
    }
    const entities = parseEntities(map.entities);
    const world = entities.find(entity => entity.get("classname") === "worldspawn");
    const scene = await WorldScene.load(map, shaders, { q2SkyName: world?.get("sky") ?? "unit1_" });
    expect(scene.surfaces.length).toBeGreaterThan(100);
    const spawn = entities.find(entity => entity.get("classname") === "info_player_start") ?? entities.find(entity => entity.get("classname") === "info_player_deathmatch");
    const values = (spawn?.get("origin") ?? "0 0 0").split(/\s+/).map(Number);
    const camera: SceneCamera = { origin: { x: values[0] ?? 0, y: values[1] ?? 0, z: (values[2] ?? 0) + 24 },
      axis: anglesToAxis({ x: 0, y: Number(spawn?.get("angle") ?? 0), z: 0 }),
      viewport: { x: 0, y: 0, width: 160, height: 120 }, projection: perspectiveProjection(90, 73.739795, 16384), clip: { kind: "none" } };
    const frame = new SceneFrameBuilder(images); frame.begin();
    const input: WorldViewInput = { camera, target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0 },
      ...(fixture.family === "q3" ? { q3Lights: [{ origin: camera.origin, radius: 300, color: { x: 1, y: 0.25, z: 0.1 } }] } : {}),
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } };
    if (fixture.family !== "q3" && map.models.length > 1) {
      const brush = scene.prepareModel(fixture.family === "q2" ? 20 : 1, { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }), scale: 1.5 },
        { ...input, materialContext: { entityRGBA: { x: 255, y: 255, z: 255, w: 127.5 } } });
      const batches = finishSceneOperations(brush).flatMap(operation => operation.kind === "draw" ? operation.batches : []);
      expect(batches.length).toBeGreaterThan(0);
      expect(batches.some(batch => batch.vertices.some(vertex => vertex.color.w > 0 && vertex.color.w <= 0.5))).toBe(true);
      expect(batches.every(batch => !batch.state.depthWrite)).toBe(true);
    }
    let drawInput = input;
    if (fixture.archive.includes("rerelease")) {
      const modelPath = "models/monsters/soldier/tris.md2", modelBytes = await read(modelPath), member = archive.findEntries(modelPath, "ascii-insensitive")[0];
      if (modelBytes === null || member === undefined || palette === null || palette.source.provenance.kind !== "archive") throw new Error("Missing real soldier fixture");
      const origin = { x: camera.origin.x + camera.axis[0].x * 96, y: camera.origin.y + camera.axis[0].y * 96, z: camera.origin.z - 24 };
      const entity: SceneEntity = { actor: null, resource: { ...palette.source, id: "resource:q2:shadow-soldier", requestedPath: modelPath,
        digest: createContentDigest(new Bun.CryptoHasher("sha256").update(modelBytes).digest("hex")), byteLength: modelBytes.length,
        provenance: { ...palette.source.provenance, memberPath: modelPath, memberIndex: member.ordinal } }, model: parseMd2(modelBytes),
        transform: { origin, axis: camera.axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: { ...origin, x: origin.x - 4 },
        pose: { kind: "frame", frame: 1, previousFrame: 0, backLerp: 0.5 }, skin: 0, color: { x: 1, y: 1, z: 1, w: 1 },
        shaderTime: { kind: "seconds", value: 0 }, flags: { kind: "q2", bits: 0 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] };
      const models = new SceneModelRenderer({ family: "q2", palette, textures, shaders }, scene);
      await models.preload([entity]);
      const casters = models.prepareShadowCasters([entity], input);
      expect(casters[0]?.meshes[0]?.indices.length).toBe(434 * 3);
      expect(models.prepareShadowCasters([{ ...entity, flags: { kind: "q2", bits: 1024 } }], input)).toEqual(casters);
      const light: SceneLight = { origin: { ...camera.origin, z: camera.origin.z + 64 }, radius: 600, color: { x: 1, y: 0.5, z: 0.25 }, additive: false,
        profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "cast", resolution: 128 } } };
      const shadows = scene.prepareShadows([light], input, casters);
      expect(shadows.stats.facesRendered).toBe(6);
      expect(shadows.stats.entityCasters).toBe(1);
      const lit = { ...input, q2FragmentLighting: shadows.lighting, beforeView: shadows.operations };
      const groups = models.prepare([entity], lit), batches = sceneModelBatches(groups);
      expect(batches.some(batch => batch.lighting.kind === "q2-model-shadow" && batch.lighting.shadeScale > 1)).toBe(true);
      drawInput = { ...lit, operations: groups };
    }
    const prepared = scene.prepareView(drawInput);
    expect(prepared.visibility.surfaces.length).toBeGreaterThan(0);
    expect(prepared.view.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length > 0))).toBe(true);
    if (fixture.family === "q3") expect(prepared.view.operations.some(operation => operation.kind === "draw"
      && operation.batches.some(batch => batch.state.depthTest === "equal" && batch.state.blend.destination === "one"))).toBe(true);
    frame.world(prepared);
    const backend = new SoftwareRenderer(160, 120, owner);
    const target = new CpuRenderTarget(backend);
    const commands = frame.finish(false);
    target.execute(commands);
    if (fixture.map === "maps/q3test1.bsp" && process.env["QUAKE_BSP44_GL"] === "1") {
      const { NativeRenderer } = await import("../../../src/app/bootstrap/renderer.ts");
      const renderer = await NativeRenderer.open({ renderer: "gl", width: 160, height: 120, hidden: true, gamma: 1 }, owner);
      try {
        const captured = renderer.captureNextFrame().then(frame => frame.pixels);
        renderer.execute({ ...commands, commands: [...commands.commands, { kind: "swap-buffers" }] });
        const pixels = await captured;
        const diagnostics = renderer.diagnostics();
        expect(diagnostics.backend).toBe("gl");
        const uploads = commands.commands.flatMap(command => command.kind === "image-resource" && command.operation.kind === "create-image" ? [command.operation.image] : []);
        for (const image of uploads) expect(diagnostics.images.find(resident => resident.ordinal === image.ordinal)).toMatchObject({ width: image.width, height: image.height });
        let colored = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) if ((pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0) > 0) colored++;
        expect(colored).toBeGreaterThan(1000);
        console.log(JSON.stringify({ format: "IBSP44", backend: diagnostics.backend, driver: diagnostics.driver, images: uploads.length, colored }));
      } finally { renderer.close(); }
    }
    let colored = 0;
    for (let pixel = 0; pixel < backend.pixels.length; pixel += 4) if ((backend.pixels[pixel] ?? 0) + (backend.pixels[pixel + 1] ?? 0) + (backend.pixels[pixel + 2] ?? 0) > 0) colored++;
    if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/w17-scene/${fixture.family}${fixture.archive.includes("rerelease") ? "-rerelease" : ""}.png`, encodePng(160, 120, backend.pixels));
    expect(colored).toBeGreaterThan(1000);
    if (fixture.map === "maps/q3test1.bsp") console.log(JSON.stringify({ format: "IBSP44", backend: "cpu", surfaces: scene.surfaces.length, visible: prepared.visibility.surfaces.length, colored }));
    if (fixture.family !== "q3" && !fixture.archive.includes("rerelease")) {
      const candidate = scene.surfaces.find(surface => surface.kind === "legacy" && surface.lightmap !== null);
      if (candidate === undefined || candidate.kind !== "legacy" || candidate.lightmap === null) throw new Error("Missing authored override candidate");
      const name = `textures/${candidate.material.name}`;
      expect(shaders.hasAuthored(name)).toBe(false);
      expect(scene.surfaces.every(surface => surface.shader === null)).toBe(true);
      shaders.addScript(`${name}
{
 {
  map ${name}
 }
 {
  map $lightmap
  blendFunc filter
 }
}`, "<explicit fixture override>");
      expect(shaders.hasAuthored(name)).toBe(true);
      const overridden = await WorldScene.load(map, shaders, { q2SkyName: world?.get("sky") ?? "unit1_" });
      try {
        const surface = overridden.surfaces[candidate.index];
        if (surface === undefined || surface.kind !== "legacy" || surface.shader === null || surface.lightmap === null) throw new Error("Explicit override was not joined");
        expect(surface.geometry).toEqual(candidate.geometry);
        expect(surface.material.name).toBe(candidate.material.name);
        expect(surface.material.kind).toBe(candidate.material.kind);
        expect(surface.lightmap.face).toEqual(candidate.lightmap.face);
        expect(surface.shader.finished.hasLightmapStage).toBe(true);
        expect(overridden.surfaces.some(other => other.shader === null)).toBe(true);
        const directed = { ...input, camera: { ...camera, origin: { x: surface.bounds.min.x, y: surface.bounds.min.y, z: surface.bounds.max.z + 32 } } };
        const preparedOverride = overridden.prepareModel(0, { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }) }, directed);
        expect(finishSceneOperations(preparedOverride).some(operation => operation.kind === "draw" && operation.batches.some(batch => (batch.texture.kind === "bind-image" && batch.texture.image === surface.lightmap?.image || batch.texturing === "pair" && batch.secondTexture.binding.kind === "bind-image" && batch.secondTexture.binding.image === surface.lightmap?.image)))).toBe(true);
        const near = { origin: { x: (surface.bounds.min.x + surface.bounds.max.x) / 2,
          y: (surface.bounds.min.y + surface.bounds.max.y) / 2, z: (surface.bounds.min.z + surface.bounds.max.z) / 2 },
          radius: 512, color: { x: 1, y: 0.25, z: 0.1 }, additive: false };
        const far = { ...near, origin: { x: 100000, y: 100000, z: 100000 } };
        const projected = (lights: typeof near[]) => finishSceneOperations(overridden.prepareModel(0,
          { origin: { x: 0, y: 0, z: 0 }, axis: camera.axis }, { ...directed, q3Lights: lights }))
          .flatMap(operation => operation.kind === "draw" ? operation.batches : [])
          .filter(batch => batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated" && batch.texture.image.source.name === "*dlight");
        const firstLight = projected([near]), secondLight = projected([far, near]);
        expect(firstLight.length).toBeGreaterThan(0);
        expect(secondLight).toEqual(firstLight);
        expect(images.drainOperations().some(operation => operation.kind === "update-image" && operation.image === surface.lightmap?.image)).toBe(true);
        await overridden.remapShader(name, name);
        const shadowLight: SceneLight = { origin: directed.camera.origin, color: { x: 1, y: 1, z: 1 }, radius: 512, additive: false,
          profile: { kind: "q2", scale: 1, cone: null, shadow: { kind: "cast", resolution: 128 } } };
        overridden.prepareShadows([shadowLight], directed);
        const staticWorld = overridden["staticShadowWorld"];
        expect(staticWorld).not.toBeNull();
        overridden.prepareShadows([shadowLight], { ...directed, time: { kind: "seconds", value: 1 } });
        expect(overridden["staticShadowWorld"]).toBe(staticWorld);
        shaders.addScript(`shadow-cache-moving { deformVertexes move 0 0 16 sin 0 1 0 1 { map $whiteimage } }
shadow-cache-hidden { surfaceparm nodraw { map $whiteimage } }`, "<shadow cache remap>");
        await overridden.remapShader(name, "shadow-cache-moving");
        expect(overridden["staticShadowWorld"]).toBeNull();
        const moving = overridden.prepareShadows([shadowLight], directed);
        const moved = overridden.prepareShadows([shadowLight], { ...directed, time: { kind: "seconds", value: 0.25 } });
        expect(overridden["staticShadowWorld"]).toBeNull();
        expect(moving.operations).not.toEqual(moved.operations);
        await overridden.remapShader(name, "shadow-cache-hidden");
        overridden.prepareShadows([shadowLight], directed);
        expect(overridden["staticShadowWorld"]?.world.meshes.length).toBeLessThan(staticWorld?.world.meshes.length ?? 0);
        await overridden.remapShader(name, name);
        overridden.prepareShadows([shadowLight], directed);
        expect(overridden["staticShadowWorld"]?.world.digest).toBe(staticWorld?.world.digest);
        const previous = overridden["staticShadowWorld"];
        overridden.surfaces = [...overridden.surfaces];
        overridden.prepareShadows([shadowLight], directed);
        expect(overridden["staticShadowWorld"]).not.toBe(previous);
        const refreshed = await overridden.prepareImages(shaders);
        overridden.commitImages(refreshed);
        expect(overridden["staticShadowWorld"]).toBeNull();
        overridden.prepareShadows([shadowLight], directed);
        expect(overridden["staticShadowWorld"]?.world.digest).toBe(staticWorld?.world.digest);
        const nativeTexture = surface.material.kind === "q1" ? surface.material.texture : surface.material.frames[0];
        if (nativeTexture === undefined) throw new Error("Missing native source texture");
        const sampled = textures.register("fixture-native-sampling", { kind: "rgba8", levels: [
          { width: 2, height: 2, pixels: new Uint8Array(16).fill(255) }, { width: 1, height: 1, pixels: new Uint8Array(4).fill(255) }],
          borderColor: { x: 0, y: 0, z: 0, w: 1 } }, undefined, nativeTexture.source);
        expect(await textures.sampleSurface(sampled, { mipmap: true, wrap: "repeat" })).toBe(sampled);
        const clamped = await textures.sampleSurface(sampled, { mipmap: false, wrap: "clamp" });
        expect(await textures.sampleSurface(sampled, { mipmap: false, wrap: "clamp" })).toBe(clamped);
        expect(clamped.content.levels).toHaveLength(1);
        expect(clamped.image.source).toBe(nativeTexture.source);
        expect(clamped.content.levels[0].pixels).toBe(sampled.content.levels[0].pixels);
        expect(images.drainOperations().some(operation => operation.kind === "create-image" && operation.image === clamped.image
          && operation.sampling.wrap === "clamp" && operation.sampling.filter === "linear")).toBe(true);
      } finally { overridden.close(); }
    }
    target.close(); scene.close(); images.close();
  } finally { archive.close(); }
}, 60000);


test("uniform brush transforms preserve inverse points, vectors and transformed portal planes", () => {
  const camera: SceneCamera = { origin: { x: -100, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }),
    viewport: { x: 0, y: 0, width: 160, height: 120 }, projection: perspectiveProjection(90, 75, 4096), clip: { kind: "none" } };
  for (const scale of [1.31337, -1.31337]) {
    const transform = { origin: { x: 10, y: 20, z: 30 }, axis: anglesToAxis({ x: 0, y: 90, z: 0 }), scale };
    const point = { x: 128, y: 4, z: 8 }, world = worldPoint(point, transform), local = localPoint(world, transform);
    expect(local.x).toBeCloseTo(point.x, 4); expect(local.y).toBeCloseTo(point.y, 4); expect(local.z).toBeCloseTo(point.z, 4);
    expect(localVector(worldVector(point, transform), transform).x).toBeCloseTo(point.x, 4);
    const projected = createViewProjector(camera, transform)(point), direct = createViewProjector(camera)(world);
    expect(projected.x).toBeCloseTo(direct.x, 4); expect(projected.y).toBeCloseTo(direct.y, 4); expect(projected.z).toBeCloseTo(direct.z, 4);
    const center = worldPoint({ x: 128, y: 0, z: 0 }, transform);
    const portal = portalCamera({ normal: { x: 1, y: 0, z: 0 }, distance: 128 }, [{ origin: center, oldOrigin: center,
      axis: camera.axis, frame: 0, oldFrame: 0, skinNum: 0 }], camera, 0, transform);
    expect(portal?.mirror).toBe(true);
  }
  expect(() => localPoint(camera.origin, { origin: camera.origin, axis: camera.axis, scale: 0 })).toThrow("nonzero");
});

for (const family of ["q1", "q2"] satisfies readonly ("q1" | "q2")[]) for (const rendererKind of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[])
  test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen" || !existsSync(`${root}/q3a/missionpack/pak0.pk3`))(`authored movie override on unchanged ${family} surfaces uses shared ${rendererKind} materials`, async () => {
    const { mkdtemp, mkdir, copyFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { ApplicationAssets } = await import("../../../src/app/bootstrap/assets.ts");
    const { loadApplicationContent } = await import("../../../src/app/bootstrap/content.ts");
    const { parseApplicationCommand } = await import("../../../src/app/bootstrap/options.ts");
    const { NativeRenderer } = await import("../../../src/app/bootstrap/renderer.ts");
    const { MaterialCinematic } = await import("../../../src/media/material.ts");
    const { vectorToAngles } = await import("../../../src/core/math.ts");
    const temporary = await mkdtemp(join(tmpdir(), "authored-material-"));
    try {
      const directory = join(temporary, family, family === "q1" ? "id1" : "baseq2");
      await mkdir(join(directory, "scripts"), { recursive: true }); await mkdir(join(directory, "video"));
      await copyFile(`${root}/${family === "q1" ? "q1/id1/PAK0.PAK" : "q2/baseq2/pak0.pak"}`, join(directory, "pak0.pak"));
      const id1 = join(temporary, "q1", "id1"); await mkdir(id1, { recursive: true });
      if (family !== "q1") await copyFile(`${root}/q1/id1/PAK0.PAK`, join(id1, "pak0.pak"));
      await copyFile(`${root}/q1/id1/PAK1.PAK`, join(id1, "pak1.pak"));
      if (family === "q2") for (const pak of ["pak1.pak", "pak2.pak"]) await copyFile(`${root}/q2/baseq2/${pak}`, join(directory, pak));
      const movieArchive = await openArchive(`${root}/q3a/missionpack/pak0.pk3`);
      try {
        const member = movieArchive.findEntries("video/mpteam1.roq", "ascii-insensitive")[0];
        if (member === undefined) throw new Error("Missing genuine movie fixture");
        await Bun.write(join(directory, "video", "mpteam1.roq"), await movieArchive.readEntry(member));
      } finally { movieArchive.close(); }
      const parsed = parseApplicationCommand(["--content-root", temporary, "--game", family === "q1" ? "q1-classic-id1" : "q2-classic-baseq2",
        "--map", family === "q1" ? "start" : "base1", "--movement", family, "--character", family, "--dedicated"]);
      if (parsed.kind !== "run") throw new Error("Missing native content fixture");
      const content = await loadApplicationContent(parsed.options);
      let now = 0;
      const firstIdentity = createIdentityOwner("authored-control"), firstOwner = { identity: Symbol("authored-control"), session: firstIdentity.session, generation: 0 };
      const controlAssets = new ApplicationAssets(content, firstOwner, { sample: () => now });
      try {
        const control = await controlAssets.loadWorld();
        const worldModel = content.world.models[0];
        if (worldModel === undefined || !("faces" in worldModel)) throw new Error("Missing native world range");
        const candidate = control.surfaces.filter(surface => surface.index >= worldModel.faces.first && surface.index < worldModel.faces.first + worldModel.faces.count && surface.kind === "legacy" && surface.lightmap !== null && surface.plane !== null && Math.abs(surface.plane.normal.z) < 0.5)
          .sort((a, b) => ((b.bounds.max.x - b.bounds.min.x) + (b.bounds.max.y - b.bounds.min.y)) * (b.bounds.max.z - b.bounds.min.z)
            - ((a.bounds.max.x - a.bounds.min.x) + (a.bounds.max.y - a.bounds.min.y)) * (a.bounds.max.z - a.bounds.min.z))[0];
        if (candidate === undefined || candidate.kind !== "legacy" || candidate.plane === null) throw new Error("Missing native wall");
        const name = `textures/${candidate.material.name}`, normal = candidate.plane.normal;
        const center = candidate.geometry.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.position.x / candidate.geometry.vertices.length,
          y: sum.y + vertex.position.y / candidate.geometry.vertices.length, z: sum.z + vertex.position.z / candidate.geometry.vertices.length }), { x: 0, y: 0, z: 0 });
        const camera: SceneCamera = { origin: { x: center.x + normal.x * 96, y: center.y + normal.y * 96, z: center.z + normal.z * 96 },
          axis: anglesToAxis(vectorToAngles({ x: -normal.x, y: -normal.y, z: -normal.z })), viewport: { x: 0, y: 0, width: 640, height: 400 },
          projection: perspectiveProjection(80, 55.41, 4096), clip: { kind: "none" } };
        const lightingFrames = async (scene: WorldScene, images: SceneImageRegistry, renderer: import("../../../src/app/bootstrap/renderer.ts").NativeRenderer, label: string): Promise<number[]> => {
          const values: number[] = [], frames = new SceneFrameBuilder(images);
          // Four styles at 0.05 with modulation 2 contribute at most 0.4; the dynamic light adds at most 0.2.
          const q2Styles = Array.from({ length: 256 }, () => ({ rgb: { x: 0.05, y: 0.05, z: 0.05 }, white: 0.15 }));
          let unlitPixel: Uint8Array | null = null;
          for (const enabled of [false, true]) {
            const input: WorldViewInput = { camera, target: { kind: "preview", id: label }, time: { kind: "milliseconds", value: 0 }, q2Styles };
            const light: SceneLight = { origin: camera.origin, radius: 400, color: { x: 1, y: 0.5, z: 0.25 }, additive: false,
              profile: { kind: "q2", scale: 0.1, cone: null, shadow: { kind: "cast", resolution: 128 } } };
            const shadows = scene.prepareShadows(enabled ? [light] : [], input);
            if (enabled) expect(shadows.lighting.atlas).not.toBeNull();
            frames.begin();
            const prepared = scene.prepareView({ ...input, q2FragmentLighting: shadows.lighting, beforeView: shadows.operations });
            if (label === "unlit") {
              const movieBatches = prepared.view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches : [])
                .filter(batch => batch.texture.kind === "dynamic-image");
              expect(movieBatches.length).toBeGreaterThan(0);
              expect(movieBatches.every(batch => batch.lighting.kind === "vertex")).toBe(true);
            }
            frames.world(prepared);
            const capture = renderer.captureNextFrame().then(frame => frame.pixels); renderer.execute(frames.finish(true)); const pixels = await capture;
            let total = 0; for (let offset = 0; offset < pixels.length; offset += 4) total += (pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0);
            values.push(total);
            if (label === "unlit") {
              const pixel = pixels.slice((200 * 640 + 320) * 4, (200 * 640 + 320) * 4 + 4);
              if (unlitPixel === null) unlitPixel = pixel; else expect(Array.from(pixel)).toEqual(Array.from(unlitPixel));
            }
            if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/tmp/authored-lighting/${rendererKind}-${label}-${enabled ? "lit" : "dark"}.png`, encodePng(640, 400, pixels));
          }
          return values;
        };
        let nativeLighting: number[] = [];
        const drawControl = await NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, firstOwner);
        try {
          const frames = new SceneFrameBuilder(controlAssets.images); frames.begin();
          frames.world(control.prepareView({ camera, target: { kind: "preview", id: "stock-control" }, time: { kind: "milliseconds", value: 0 } }));
          const capture = drawControl.captureNextFrame().then(frame => frame.pixels); drawControl.execute(frames.finish(true));
          const pixels = await capture;
          if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/tmp/authored-video/${family}-${rendererKind}-stock.png`, encodePng(640, 400, pixels));
          if (family === "q2") nativeLighting = await lightingFrames(control, controlAssets.images, drawControl, "native");
        } finally { drawControl.close(); }
        const minS = Math.min(...candidate.geometry.vertices.map(vertex => vertex.texCoord.x)), maxS = Math.max(...candidate.geometry.vertices.map(vertex => vertex.texCoord.x));
        const minT = Math.min(...candidate.geometry.vertices.map(vertex => vertex.texCoord.y)), maxT = Math.max(...candidate.geometry.vertices.map(vertex => vertex.texCoord.y));
        const scaleS = 1 / (maxS - minS), scaleT = 1 / (maxT - minT);
        await Bun.write(join(directory, "scripts", "fixture.shader"), `${name}\n{\n cull none\n {\n  videoMap mpteam1.roq\n  rgbGen identity\n  tcMod transform ${scaleS} 0 0 ${scaleT} ${-minS * scaleS} ${-minT * scaleT}\n }\n}\n`);
        const identity = createIdentityOwner("authored-video"), owner = { identity: Symbol("authored-video"), session: identity.session, generation: 0 };
        const assets = new ApplicationAssets(content, owner, { sample: () => now });
        const renderer = await NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, owner);
        try {
          const scene = await assets.loadWorld(), surface = scene.surfaces[candidate.index];
          if (surface === undefined || surface.shader === null) throw new Error("Missing authored shader surface");
          expect(scene.map).toBe(content.world);
          expect(surface.geometry).toEqual(candidate.geometry);
          const frames = new SceneFrameBuilder(assets.images), hashes: string[] = [], decodedFrames: number[] = [];
          for (const time of [0, 34, 68, 102, 136]) {
            now = time; frames.begin();
            const prepared = scene.prepareView({ camera, target: { kind: "preview", id: "explicit-authored-video" }, time: { kind: "milliseconds", value: time } });
            const binding = prepared.view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches : [])
              .map(batch => batch.texture).find(texture => texture.kind === "dynamic-image");
            if (binding?.kind !== "dynamic-image" || !(binding.source instanceof MaterialCinematic)) throw new Error("Missing shared authored movie");
            const provenance = binding.source.image.source;
            if (provenance.kind !== "resource") throw new Error("Movie lost its actual resource");
            expect(provenance.resource.provenance.mount.identity.content).toBe(content.recipe.presentation.assets);
            expect(provenance.resource.requestedPath).toBe("video/mpteam1.roq");
            frames.world(prepared);
            const capture = renderer.captureNextFrame().then(frame => frame.pixels); renderer.execute(frames.finish(true)); const pixels = await capture;
            if (time === 68 || time === 136) {
              hashes.push(new Bun.CryptoHasher("sha256").update(pixels).digest("hex"));
              const decoded = binding.source.playback.currentFrame;
              if (decoded === null) throw new Error("Missing executed movie frame");
              decodedFrames.push(decoded.index);
              if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/tmp/authored-video/${family}-${rendererKind}-${time}.png`, encodePng(640, 400, pixels));
            }
          }
          expect(hashes[0]).not.toBe(hashes[1]);
          expect(decodedFrames[0]).not.toBe(decodedFrames[1]);
          if (family === "q2") await lightingFrames(scene, assets.images, renderer, "unlit");
          if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/tmp/authored-video/${family}-${rendererKind}.json`, JSON.stringify({
            fixture: "Explicit loose shader/movie overlay; unchanged copied retail map archive", source: content.recipe.presentation.assets,
            shader: name, movie: "video/mpteam1.roq", originalMovieArchive: "q3a/missionpack/pak0.pk3", surface: candidate.index, camera, center, normal, uvTransform: [scaleS, 0, 0, scaleT, -minS * scaleS, -minT * scaleT], times: [68, 136], decodedFrames }, null, 2));
        } finally { assets.close(); renderer.close(); }
        if (family === "q2") for (const variant of [{ label: "authored", color: 1 }, { label: "colored", color: 0.5 }]) {
          await Bun.write(join(directory, "scripts", "fixture.shader"), `${name}\n{\n {\n map ${name}\n }\n {\n map $lightmap\n blendFunc filter\n rgbGen const ( ${variant.color} ${variant.color} ${variant.color} )\n alphaGen const 0.5\n }\n}\n`);
          const identity = createIdentityOwner("authored-lighting"), owner = { identity: Symbol("authored-lighting"), session: identity.session, generation: 0 };
          const assets = new ApplicationAssets(content, owner), renderer = await NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, owner);
          try {
            const scene = await assets.loadWorld();
            const authored = await lightingFrames(scene, assets.images, renderer, variant.label);
            const [nativeDark, nativeLit] = nativeLighting, [authoredDark, authoredLit] = authored;
            if (nativeDark === undefined || nativeLit === undefined || authoredDark === undefined || authoredLit === undefined) throw new Error("Missing lighting comparisons");
            expect(nativeLit - nativeDark).toBeGreaterThan(10000);
            expect(authoredLit - authoredDark).toBeGreaterThan((nativeLit - nativeDark) * variant.color * 0.8);
            expect(authoredLit - authoredDark).toBeLessThan((nativeLit - nativeDark) * variant.color * 1.2);
          } finally { assets.close(); renderer.close(); }
        }
      } finally { controlAssets.close(); await content.close(); }
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }, 60000);

test("authored lightmap color scales static and dynamic RGB while preserving sampled alpha", async () => {
  const { shadeQ2Fragment } = await import("../../../src/render/cpu/lighting.ts");
  const parameters: Extract<import("../../../src/contracts/render.ts").BatchLighting, { readonly kind: "q2-world" }> = {
    kind: "q2-world", pass: "lightmap", worldPositions: [], normals: [], atlas: null,
    lights: [{ origin: { x: 0, y: 0, z: 32 }, radius: 128, color: { x: 1, y: 0.5, z: 0.25 }, scale: 1, cone: null, shadow: { kind: "none" } }],
  };
  const position = { x: 0, y: 0, z: 0 }, normal = { x: 0, y: 0, z: 1 }, color = { x: 0.25, y: 0.5, z: 0.75, w: 0.5 };
  const texel = { r: 0.1, g: 0.2, b: 0.3, a: 0.4 };
  const native = shadeQ2Fragment({ parameters, depth: null }, position, normal, color, texel);
  const authored = shadeQ2Fragment({ parameters: { ...parameters, pass: "material-lightmap" }, depth: null }, position, normal, color, texel);
  expect(native.r).toBeGreaterThan(texel.r);
  expect(authored.r).toBeCloseTo(native.r * color.x, 6);
  expect(authored.g).toBeCloseTo(native.g * color.y, 6);
  expect(authored.b).toBeCloseTo(native.b * color.z, 6);
  expect(authored.a).toBeCloseTo(texel.a * color.w, 6);
});
