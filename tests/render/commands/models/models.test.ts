import { SceneMaterialRegistrations } from "../../../../src/render/scene/material-registrations.ts";
import { sceneModelBatches, finishSceneOperations, createSourceSceneOrder } from "../../../../src/render/scene/submissions.ts";
import { resolve } from "node:path";
import { weaponViewCamera } from "../../../../src/app/bootstrap/weapon-view.ts";
import { createMd5Model, parseMd5Anim, parseMd5Mesh, q1ReplacementSkinSelection } from "../../../../src/formats/q3-model/index.ts";
import { existsSync } from "node:fs";
import { expect, test } from "bun:test";
import { openArchive } from "../../../../src/content/archive/index.ts";
import { createContentDigest, createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../../../src/contracts/content.ts";
import type { DecodedModel, SceneEntity } from "../../../../src/contracts/scene.ts";
import type { SceneCamera } from "../../../../src/contracts/render.ts";
import { identityMat4 } from "../../../../src/core/math.ts";
import { GameRandom, gameAtof, gameAtoi } from "../../../../src/core/game-numeric.ts";
import { parseMdl, parseMd2, parseSpr } from "../../../../src/formats/q12-model/index.ts";
import { parseMd3, toSceneMd3 } from "../../../../src/formats/q3-model/index.ts";
import { prepareSceneEntity, q2ShellColor } from "../../../../src/render/scene/models/index.ts";
import { ParticleSystem, loadParticleAnimations, prepareParticleGeometry, q2BeamGeometry, sampleQ2Particle } from "../../../../src/render/scene/particles/index.ts";
import type { ParticleClientState } from "../../../../src/render/scene/particles/index.ts";
import { createIdentityOwner } from "../../../../src/contracts/identity.ts";
import { decodeQ2Map } from "../../../../src/formats/q2-map/index.ts";
import { decodeQ3World, parseEntities } from "../../../../src/formats/q3-map/index.ts";
import { parseSkin } from "../../../../src/formats/q3-model/md3.ts";
import { decodePcx } from "../../../../src/formats/images/index.ts";
import { SceneImageRegistry, SceneShaderRegistry, SceneTextureLoader, WorldScene, perspectiveProjection } from "../../../../src/render/scene/index.ts";
import { SceneModelRenderer } from "../../../../src/render/scene/models/index.ts";
import type { ModelSourceOptions } from "../../../../src/render/scene/models/types.ts";

const identityAxis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] satisfies SceneCamera["axis"];
const camera: SceneCamera = { origin: { x: -100, y: 0, z: 0 }, axis: identityAxis, projection: identityMat4(),
  viewport: { x: 0, y: 0, width: 640, height: 480 }, clip: { kind: "none" } };

async function asset(archivePath: string, path: string, family: "q1" | "q2" | "q3"): Promise<{ bytes: Uint8Array; resource: ResolvedResourceReference }> {
  const archive = await openArchive(archivePath);
  try {
    const entry = archive.findEntries(path)[0];
    if (entry === undefined) throw new Error(`Missing ${path}`);
    const bytes = await archive.readEntry(entry);
    const digest = createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
    const mount = { kind: "loose", identity: createMountIdentity(createMountId("scene", family), createContentId({ family, edition: "classic", package: "base", revision: "retail" }), 0), rootPath: "/" } satisfies Extract<ResolvedResourceReference["provenance"], { kind: "loose" }>["mount"];
    const resource: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, provenance: { kind: "loose", mount, memberPath: path }, digest,
      byteLength: bytes.length, resolution: { kind: "default-order", plan: createMountPlanId("scene", "test"), rank: 0 } };
    return { bytes, resource: { ...resource, id: createResourceId(resource) } };
  } finally { archive.close(); }
}

function entity(model: DecodedModel, resource: ResolvedResourceReference, family: "q1" | "q2" | "q3"): SceneEntity {
  return { actor: null, resource, model, transform: { origin: { x: 20, y: 30, z: 40 }, axis: identityAxis, scale: { x: 1, y: 1, z: 1 } },
    previousOrigin: { x: 20, y: 30, z: 40 }, pose: { kind: "frame", frame: 1, previousFrame: 0, backLerp: 0.5 },
    skin: 0, color: { x: 1, y: 1, z: 1, w: 1 }, shaderTime: { kind: "seconds", value: 0 },
    flags: { kind: family, bits: 0 }, lightingOrigin: { x: 20, y: 30, z: 40 }, shadowPlane: 0, attachments: [] };
}

test("retail Q1 MDL and SPR prepare transformed geometry and real embedded skins", async () => {
  const mdl = await asset("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK", "progs/player.mdl", "q1");
  const prepared = prepareSceneEntity(entity(parseMdl(mdl.bytes), mdl.resource, "q1"), { camera, timeSeconds: 0.25 });
  expect(prepared.surfaces[0]?.geometry.indices.length).toBe(408 * 3);
  const surface = prepared.surfaces[0];
  if (surface === undefined) throw new Error("Missing MDL surface");
  expect(surface.image.kind).toBe("indexed");
  expect(surface.cull).toBe("front");
  expect(surface.depthRange).toEqual([0, 1]);
  const viewModel = prepareSceneEntity(entity(parseMdl(mdl.bytes), mdl.resource, "q1"), { camera, timeSeconds: 0.25, options: () => ({ viewModel: true }) });
  expect(viewModel.surfaces[0]?.depthRange).toEqual([0, 0.3]);
  const local = surface.localGeometry.vertices[0], world = surface.geometry.vertices[0];
  if (local === undefined || world === undefined) throw new Error("Missing geometry");
  expect(world.position.x).toBeCloseTo(local.position.x + 20);
  const spr = await asset("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK", "progs/s_explod.spr", "q1");
  const sprite = prepareSceneEntity(entity(parseSpr(spr.bytes), spr.resource, "q1"), { camera, timeSeconds: 0.25 });
  expect(sprite.surfaces[0]?.geometry.vertices).toHaveLength(4);
  expect(sprite.surfaces[0]?.alphaTest).toBe("gt0");
});

test("retail Q2 shell geometry retains old-origin interpolation and shell color", async () => {
  const mdl = await asset("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak", "models/monsters/soldier/tris.md2", "q2");
  const source = entity(parseMd2(mdl.bytes), mdl.resource, "q2");
  const normal = prepareSceneEntity(source, { camera, timeSeconds: 1 });
  expect(normal.surfaces[0]?.cull).toBe("front");
  const shell = prepareSceneEntity({ ...source, flags: { kind: "q2", bits: 1024 | 4096 } }, { camera, timeSeconds: 1 });
  expect(shell.surfaces[0]?.geometry.indices.length).toBe(434 * 3);
  expect(shell.surfaces[0]?.image.kind).toBe("white");
  expect(q2ShellColor(1024 | 4096)).toEqual({ x: 1, y: 0, z: 1 });
  const faded = prepareSceneEntity({ ...source, color: { ...source.color, w: 0.25 }, flags: { kind: "q2", bits: 32768 } }, { camera, timeSeconds: 1 });
  expect(faded.surfaces[0]?.translucent).toBe(true);
  expect(faded.surfaces[0]?.geometry.vertices[0]?.color.w).toBe(63.75);
  expect(shell.surfaces[0]?.geometry.vertices[0]?.position).not.toEqual(normal.surfaces[0]?.geometry.vertices[0]?.position);
});

test("retail Q3 lower model interpolates actual torso tag and applies custom skin", async () => {
  const mdl = await asset("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3", "models/players/sarge/lower.md3", "q3");
  const source = entity(toSceneMd3(parseMd3(mdl.bytes)), mdl.resource, "q3");
  const child = { ...source, attachments: [], transform: { ...source.transform, origin: { x: 0, y: 0, z: 0 } } };
  const prepared = prepareSceneEntity({ ...source, attachments: [{ tag: "tag_torso", entity: child }, { tag: "invented", entity: child }] },
    { camera, timeSeconds: 1, options: part => ({ customShader: part === child ? "models/players/sarge/upper" : "models/players/sarge/lower" }) });
  expect(prepared.surfaces.length).toBeGreaterThan(0);
  expect(prepared.attachments).toHaveLength(1);
  expect(prepared.attachments[0]?.surfaces[0]?.image).toEqual({ kind: "external", name: "models/players/sarge/upper" });
  expect(prepared.attachments[0]?.surfaces[0]?.options.customShader).toBe("models/players/sarge/upper");
  expect(prepared.missingAttachments).toEqual(["invented"]);
  expect(prepared.attachments[0]?.entity.transform.origin.z).toBeGreaterThan(source.transform.origin.z);
  expect(prepared.surfaces[0]?.image).toEqual({ kind: "external", name: "models/players/sarge/lower" });
});

test("legacy particle triangle, instant particle, beam and QVM parsers preserve source inputs", () => {
  expect(gameAtoi("4294967297")).toBe(1);
  expect(gameAtof("1.5e2")).toBe(1.5);
  const particle = sampleQ2Particle({ spawnMilliseconds: 0, origin: { x: 10, y: 0, z: 0 }, velocity: { x: 100, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 }, color: 5, alpha: 1, alphaVelocity: -10000 }, 1000);
  if (particle === null) throw new Error("Instant particle vanished");
  expect(particle.origin.x).toBe(10);
  const geometry = prepareParticleGeometry([particle], { camera, indexedProfile: "q2", paletteColor: () => ({ x: 12, y: 34, z: 56 }) });
  expect(geometry.indices).toEqual([0, 1, 2]);
  expect(geometry.vertices[0]?.texCoord).toEqual({ x: 0.0625, y: 0.0625 });
  expect(q2BeamGeometry({ x: 10, y: 0, z: 0 }, { x: 110, y: 0, z: 0 }, 4, { x: 255, y: 0, z: 0, w: 255 }).vertices).toHaveLength(12);
});

test("Q3 particle pool submits registered animation geometry and retires expired explosions", async () => {
  const animations = await loadParticleAnimations({ registerShader: async name => ({ name }) });
  const state: ParticleClientState = { time: 0, refdef: { viewAxis: identityAxis }, snap: { playerState: { origin: { x: -100, y: 0, z: 0 } } } };
  let milliseconds = 0;
  const system = new ParticleSystem({ ...state, get time() { return milliseconds; } }, { animations,
    media: { tracerShader: null, smokePuffShader: null, waterBubbleShader: null }, random: new GameRandom(7), hardwareType: "generic",
    prediction: { trace: (_start, end) => ({ end, fraction: 1, solidity: "clear", entityNum: 1022 }) }, configString: () => "", print: () => undefined });
  system.explosion({ animation: "explode1", origin: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, duration: 1000, sizeStart: 4, sizeEnd: 16 });
  milliseconds = 250;
  const polys = system.addParticles();
  expect(polys).toHaveLength(1);
  expect(polys[0]?.vertices).toHaveLength(4);
  expect(polys[0]?.shader?.name).toBe("explode16");
  milliseconds = 1001;
  expect(system.addParticles()).toHaveLength(0);
  expect(system.activeCount).toBe(0);
});

test("retained Q1, Q2 and Q3 model resources preserve actual Q2 and Q3 world lighting", async () => {
  const q2 = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak");
  const q3 = await openArchive("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3");
  const identity = createIdentityOwner("model-render-cache"), registrations = new SceneMaterialRegistrations();
  const images = new SceneImageRegistry({ identity: Symbol("models"), session: identity.session, generation: 0 });
  let world: WorldScene | null = null;
  try {
    const paletteAsset = await asset("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak", "pics/colormap.pcx", "q2");
    const colors = decodePcx(paletteAsset.bytes).palette;
    if (colors === null) throw new Error("Missing Q2 palette");
    const palette = { colors, source: paletteAsset.resource };
    const reader = (archive: typeof q2) => ({ read: async (name: string) => {
      const entry = archive.findEntries(name)[0];
      return entry === undefined ? null : { bytes: await archive.readEntry(entry), source: { kind: "generated", name } satisfies Parameters<SceneImageRegistry["register"]>[3] };
    } });
    const textures2 = new SceneTextureLoader(images, reader(q2), palette), shaders2 = new SceneShaderRegistry(textures2, registrations.provider("q2:classic:retail:test"));
    const textures3 = new SceneTextureLoader(images, reader(q3)), shaders3 = new SceneShaderRegistry(textures3, registrations.provider("q3:classic:retail:test"));
    const mapAsset = await asset("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak", "maps/base1.bsp", "q2");
    const map = decodeQ2Map(mapAsset.bytes);
    world = await WorldScene.load(map, shaders2);
    const start = parseEntities(map.entities).find(item => item.get("classname") === "info_player_start");
    const coordinates = (start?.get("origin") ?? "0 0 0").split(/\s+/).map(Number);
    const origin = { x: coordinates[0] ?? 0, y: coordinates[1] ?? 0, z: (coordinates[2] ?? 0) + 24 };
    const view: SceneCamera = { ...camera, origin: { ...origin, x: origin.x - 100 }, projection: perspectiveProjection(90, 74, 4096) };
    const input = { camera: view, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: identity.seat(0) } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
    const q2Asset = await asset("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak", "models/monsters/soldier/tris.md2", "q2");
    const q3Asset = await asset("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3", "models/players/sarge/lower.md3", "q3");
    const q2Entity = entity(parseMd2(q2Asset.bytes), q2Asset.resource, "q2");
    const q3Entity = entity(toSceneMd3(parseMd3(q3Asset.bytes)), q3Asset.resource, "q3");
    const body2 = { ...q2Entity, transform: { ...q2Entity.transform, origin }, previousOrigin: origin, lightingOrigin: origin };
    const body3 = { ...q3Entity, transform: { ...q3Entity.transform, origin }, previousOrigin: origin, lightingOrigin: origin };
    const skinAsset = await reader(q3).read("models/players/sarge/lower_default.skin");
    if (skinAsset === null) throw new Error("Missing Sarge skin");
    const options = () => ({ customSkin: parseSkin(new TextDecoder().decode(skinAsset.bytes)) });
    const cache2 = new SceneModelRenderer({ family: "q2", textures: textures2, shaders: shaders2, palette }, world);
    const cache3 = new SceneModelRenderer({ family: "q3", textures: textures3, shaders: shaders3, palette: null }, world);
    await Promise.all([cache2.preload([body2]), cache3.preload([body3], options)]);
    const batches2 = sceneModelBatches(cache2.prepare([body2], input)), batches3 = sceneModelBatches(cache3.prepare([body3], input, options));
    expect(batches2.some(batch => batch.indices.length > 0)).toBe(true);
    expect(batches3.some(batch => batch.indices.length > 0)).toBe(true);
    expect(batches2.some(batch => batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated"
      && batch.texture.image.source.name.startsWith("models/monsters/soldier/"))).toBe(true);
    expect(batches3.some(batch => batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated"
      && batch.texture.image.source.name.startsWith("models/players/sarge/"))).toBe(true);
    if (body3.model.kind !== "q3-md3") throw new Error("Expected Sarge MD3 fixture");
    const originalSurface = body3.model.surfaces[0];
    if (originalSurface === undefined) throw new Error("Sarge fixture has no surface");
    shaders3.addScript(`ordering/model-flash { cull none
 { map $whiteimage blendFunc add rgbGen const ( 0.4 0.4 0.4 ) }
 { map $whiteimage blendFunc add rgbGen const ( 0.6 0.6 0.6 ) }
}
ordering/model-mark { polygonOffset cull none { map $whiteimage blendFunc GL_ZERO GL_ONE_MINUS_SRC_COLOR } }`, "<multisurface ordering>");
    const layered = { ...body3, model: { ...body3.model, surfaces: [
      { ...originalSurface, name: "ordering-flash" }, { ...originalSurface, name: "ordering-mark" },
    ] } };
    const layeredOptions = () => ({ customSkin: [{ name: "ordering-flash", shader: "ordering/model-flash" }, { name: "ordering-mark", shader: "ordering/model-mark" }] });
    await cache3.preload([layered], layeredOptions);
    const groups = cache3.prepare([layered], input, layeredOptions);
    expect(groups.map(group => group.order.kind === "compiled" ? group.order.material.finished.sort : null)).toEqual([9, 4]);
    expect(groups.map(group => sceneModelBatches([group]).length)).toEqual([2, 1]);
    const ordered = finishSceneOperations(groups).flatMap(operation => operation.kind === "draw" ? operation.batches : []);
    expect(ordered.map(batch => batch.state.blend.source)).toEqual(["zero", "one", "one"]);
    expect(ordered.every(batch => batch.indices.length > 0)).toBe(true);
    const sourceView = createSourceSceneOrder(registrations);
    const sourceGroups = cache3.prepare([layered], input, () => ({ ...layeredOptions(),
      source: { view: sourceView, entity: { kind: "refentity", index: 7 } } }));
    expect(sourceGroups).toHaveLength(2);
    expect(sourceGroups.map(group => group.order.kind === "source" ? {
      entity: group.order.source.entity, surface: group.order.source.surface, dlight: group.order.source.dlight,
    } : null)).toEqual([
      { entity: { kind: "refentity", index: 7 }, surface: 0, dlight: 0 },
      { entity: { kind: "refentity", index: 7 }, surface: 1, dlight: 0 },
    ]);
    expect(finishSceneOperations(sourceGroups).flatMap(operation => operation.kind === "draw" ? operation.batches : [])
      .map(batch => batch.state.blend.source)).toEqual(["zero", "one", "one"]);
    const originalFogs = world.fogSelections;
    world.fogSelections = [{ index: 6, volume: { bounds: {
      min: { x: origin.x - 1000, y: origin.y - 1000, z: origin.z - 1000 },
      max: { x: origin.x + 1000, y: origin.y + 1000, z: origin.z + 1000 },
    }, surface: null, color: { x: 0.1, y: 0.2, z: 0.3, w: 1 }, tcScale: 0.01 } }];
    try {
      const fogOptions = { ...layeredOptions(), source: { view: sourceView, entity: { kind: "refentity", index: 7 } } } satisfies ModelSourceOptions;
      const fogged = cache3.prepare([layered], input, () => fogOptions);
      expect(fogged.map(group => group.order.kind === "source" ? group.order.source.fog : null)).toEqual([7, 7]);
      const noWorld = cache3.prepare([layered], input, () => ({ ...fogOptions, noWorldModel: true }));
      expect(noWorld.map(group => group.order.kind === "source" ? group.order.source.fog : null)).toEqual([0, 0]);
    } finally { world.fogSelections = originalFogs; }
    expect(cache2.lighting.sample(origin, input).floor).not.toBeNull();
    expect(batches3.flatMap(batch => batch.vertices).some(vertex => vertex.color.x > 0)).toBe(true);
    const q1Asset = await asset("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK", "progs/v_shot.mdl", "q1");
    const q1Palette = await asset("/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK", "gfx/palette.lmp", "q1");
    const palette1 = { colors: q1Palette.bytes, source: q1Palette.resource };
    const textures1 = new SceneTextureLoader(images, { read: async () => null }, palette1);
    const cache1 = new SceneModelRenderer({ family: "q1", textures: textures1, shaders: new SceneShaderRegistry(textures1, registrations.provider("q1:classic:retail:test")), palette: palette1 }, world);
    const q1Entity = entity(parseMdl(q1Asset.bytes), q1Asset.resource, "q1"), gunOrigin = { x: -392, y: 840, z: -69.96875 };
    const gun = { ...q1Entity, transform: { ...q1Entity.transform, origin: gunOrigin }, previousOrigin: gunOrigin, lightingOrigin: gunOrigin };
    const gunInput = { ...input, camera: { ...view, origin: gunOrigin } };
    await cache1.preload([gun], () => ({ viewModel: true }));
    const sampled = cache1.lighting.sample(gunOrigin, gunInput).color;
    const gunBatches = sceneModelBatches(cache1.prepare([gun], gunInput, () => ({ viewModel: true })));
    const vertex = gunBatches[0]?.vertices.find(value => value.color.x > 0 && value.color.x < 250 && value.color.y > 0 && value.color.y < 250);
    if (vertex === undefined) throw new Error("Expected a lit Q1 gun vertex on the actual Q2 map");
    expect(sampled.x).toBeGreaterThan(sampled.y);
    // Actual BSP sample is (156,98,18): Q1 clamps shade to (64,94,24), including gun minimum.
    expect(vertex.color.x / vertex.color.y).toBeCloseTo(64 / 94, 2);
    expect(vertex.color.x / vertex.color.z).toBeCloseTo(64 / 24, 2);
    const ordinary = sceneModelBatches(cache1.prepare([gun], gunInput))[0]?.vertices.find(value => value.color.x > 0 && value.color.x < 250 && value.color.y > 0 && value.color.y < 250);
    if (ordinary === undefined) throw new Error("Expected ordinary Q1 model lighting");
    expect(ordinary.color.x / ordinary.color.y).toBeCloseTo(sampled.x / sampled.y, 2);
    const dynamic = { origin: gunOrigin, radius: 25.6, color: { x: 0, y: 0, z: 1 }, scale: 1, cone: null, shadow: { kind: "none" } } satisfies import("../../../../src/contracts/render.ts").Q2FragmentLight;
    const dynamicInput = { ...gunInput, q2FragmentLighting: { lights: [dynamic], atlas: null } };
    const dynamicBatches = sceneModelBatches(cache1.prepare([gun], dynamicInput, () => ({ viewModel: true })));
    const dynamicVertex = dynamicBatches[0]?.vertices.find(value => value.color.x > 0 && value.color.x < 250 && value.color.y > 0 && value.color.y < 250);
    if (dynamicVertex === undefined) throw new Error("Expected Q2 dynamic lighting on the Q1 gun");
    // Map-owned blue dynamic adds25.5 source units after the minimum24.
    expect(dynamicVertex.color.x / dynamicVertex.color.z).toBeCloseTo(64 / 49.5, 2);
    const once = sceneModelBatches(cache1.prepare([gun], { ...dynamicInput, lights: [{ ...dynamic, minimum: 0 }] }, () => ({ viewModel: true })));
    expect(once[0]?.vertices.map(value => value.color)).toEqual(dynamicBatches[0]?.vertices.map(value => value.color));
    const modulatedWorld = await WorldScene.load(map, shaders2, { q2LightModulate: 2, q2SkyName: "unit1_" });
    try {
      const modulated = new SceneModelRenderer({ family: "q1", textures: textures1, shaders: new SceneShaderRegistry(textures1, registrations.provider("q1:classic:retail:test")), palette: palette1 }, modulatedWorld);
      await modulated.preload([gun], () => ({ viewModel: true }));
      const worldBatches = modulatedWorld.prepareView(dynamicInput).view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches : []);
      const fragment = worldBatches.find(batch => batch.lighting.kind === "q2-world")?.lighting;
      if (fragment === undefined || fragment.kind !== "q2-world") throw new Error("Missing actual Q2 world fragment lighting");
      expect(fragment.lights[0]?.scale).toBe(2);
      expect(dynamic.scale).toBe(1);
      const staticSample = modulated.lighting.sample(gunOrigin, gunInput, false).color;
      expect(staticSample).toEqual({ x: sampled.x * 2, y: sampled.y * 2, z: sampled.z * 2 });
      const withDynamic = modulated.lighting.sample(gunOrigin, { ...gunInput, lights: [{ ...dynamic, minimum: 0 }] }).color;
      expect(withDynamic.z).toBeCloseTo(staticSample.z + 0.1, 6);
      const lit = sceneModelBatches(modulated.prepare([gun], dynamicInput, () => ({ viewModel: true })))[0]?.vertices.find(value => value.color.x > 0 && value.color.x < 250 && value.color.z > 0 && value.color.z < 250);
      if (lit === undefined) throw new Error("Missing modulated Q1 gun");
      expect(lit.color.x / lit.color.z).toBeCloseTo(64 / 61.5, 2);
    } finally { modulatedWorld.close(); }
    const q3Map = await asset("/home/buzzkill/Projects/qfiles/q3a/baseq3/pak0.pk3", "maps/q3dm1.bsp", "q3");
    const world3 = await WorldScene.load(decodeQ3World(q3Map.bytes), shaders3);
    try {
      const cache13 = new SceneModelRenderer({ family: "q1", textures: textures1, shaders: new SceneShaderRegistry(textures1, registrations.provider("q1:classic:retail:test")), palette: palette1 }, world3);
      const origin3 = { x: 212, y: 2360, z: 82.125 };
      const gun3 = { ...gun, transform: { ...gun.transform, origin: origin3 }, previousOrigin: origin3, lightingOrigin: origin3 };
      const input3 = { ...input, camera: { ...view, origin: origin3 } };
      await cache13.preload([gun3], () => ({ viewModel: true }));
      const current = sceneModelBatches(cache13.prepare([{ ...gun3, pose: { kind: "frame", frame: 1, previousFrame: 0, backLerp: 0 } }], input3, () => ({ viewModel: true })))[0];
      const previous = sceneModelBatches(cache13.prepare([{ ...gun3, pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 } }], input3, () => ({ viewModel: true })))[0];
      const halfway = sceneModelBatches(cache13.prepare([gun3], input3, () => ({ viewModel: true })))[0];
      if (current === undefined || previous === undefined || halfway === undefined) throw new Error("Expected Q1 gun geometry on the Q3 map");
      expect(current.vertices.some(vertex => vertex.color.x !== vertex.color.y)).toBe(true);
      expect(current.vertices.some((vertex, index) => vertex.color.x !== previous.vertices[index]?.color.x)).toBe(true);
      for (const [index, vertex] of halfway.vertices.entries()) {
        const a = current.vertices[index], b = previous.vertices[index];
        if (a === undefined || b === undefined) throw new Error("Q1 pose changed triangle topology");
        expect(vertex.color.x).toBeCloseTo((a.color.x + b.color.x) / 2, 5);
      }
    } finally { world3.close(); }
    const uploads = images.drainOperations().length;
    expect(uploads).toBeGreaterThan(0);
    sceneModelBatches(cache2.prepare([body2], input)); sceneModelBatches(cache3.prepare([body3], input, options));
    expect(images.drainOperations()).toHaveLength(0);
  } finally { world?.close(); images.close(); q2.close(); q3.close(); }
}, 60000);

const rereleaseBeamArchive = new URL("../../../../../qfiles/q2/rerelease/baseq2/pak0.pak", import.meta.url).pathname;
test.skipIf(!existsSync(rereleaseBeamArchive))("rerelease modeled parasite beam centers segments and stretches the final model with its real skin", async () => {
  const file = rereleaseBeamArchive;
  const source = await asset(file, "models/monsters/parasite/segment/tris.md2", "q2");
  const model = entity(parseMd2(source.bytes), source.resource, "q2");
  const beam: SceneEntity = { ...model, transform: { ...model.transform, origin: { x: 0, y: 0, z: 0 } },
    previousOrigin: { x: 75, y: 0, z: 0 }, flags: { kind: "q2", bits: 128 } };
  const prepared = prepareSceneEntity(beam, { camera, timeSeconds: 0.1, options: () => ({ modelBeam: { segmentLength: 0 } }) });
  expect(prepared.surfaces).toHaveLength(0);
  expect(prepared.attachments).toHaveLength(3);
  expect(prepared.attachments.map(segment => segment.entity.transform.origin.x)).toEqual([15, 45, 67.5]);
  expect(prepared.attachments.map(segment => segment.entity.transform.scale.x)).toEqual([1, 1, 0.5]);
  for (const segment of prepared.attachments) {
    expect(segment.entity.flags).toEqual({ kind: "q2", bits: 8192 });
    expect(segment.surfaces[0]?.image.kind).toBe("external");
    expect(segment.surfaces[0]?.unlit).toBe(false);
    expect(segment.surfaces[0]?.translucent).toBe(false);
  }
  const beamVertices = prepared.attachments.flatMap(segment => segment.surfaces.flatMap(surface => surface.geometry.vertices));
  expect(Math.max(...beamVertices.map(vertex => vertex.position.x))).toBeGreaterThan(75);
  expect(Math.max(...beamVertices.map(vertex => vertex.position.x))).toBeLessThan(77);
  const vertical = prepareSceneEntity({ ...beam, previousOrigin: { x: 0, y: 0, z: 75 } },
    { camera, timeSeconds: 0.1, options: () => ({ modelBeam: { segmentLength: 0 } }) });
  expect(vertical.attachments.map(segment => segment.entity.transform.origin.z)).toEqual([15, 45, 67.5]);
  const verticalVertices = vertical.attachments.flatMap(segment => segment.surfaces.flatMap(surface => surface.geometry.vertices));
  expect(Math.max(...verticalVertices.map(vertex => vertex.position.z))).toBeGreaterThan(75);
  const custom = prepareSceneEntity(beam, { camera, timeSeconds: 0.1, options: () => ({ modelBeam: { segmentLength: 50 } }) });
  expect(custom.attachments.map(segment => segment.entity.transform.origin.x)).toEqual([25, 62.5]);
  expect(custom.attachments.map(segment => segment.entity.transform.scale.x)).toEqual([1, 0.5]);
});

const rereleaseGunArchive = resolve(import.meta.dir, "../../../../../qfiles/q1/rerelease/id1/pak0.pak");
test.skipIf(!existsSync(rereleaseGunArchive))("Q1 replacement MD5 gun retains source FRONT winding; ordinary MD5 retains BACK", async () => {
  const mesh = await asset(rereleaseGunArchive, "progs/v_shot2.md5mesh", "q1");
  const animation = await asset(rereleaseGunArchive, "progs/v_shot2.md5anim", "q1");
  const original = await asset(rereleaseGunArchive, "progs/v_shot2.mdl", "q1");
  const model = createMd5Model(parseMd5Mesh(new TextDecoder().decode(mesh.bytes)), parseMd5Anim(new TextDecoder().decode(animation.bytes)));
  const replacement = { ...model, skinSelection: q1ReplacementSkinSelection(model, parseMdl(original.bytes)) };
  const prepared = prepareSceneEntity(entity(replacement, mesh.resource, "q1"), { camera, timeSeconds: 0, options: () => ({ viewModel: true }) });
  expect(prepared.surfaces.length).toBeGreaterThan(0);
  expect(prepared.surfaces.every(surface => surface.cull === "front")).toBe(true);
  const ordinary = prepareSceneEntity(entity(model, mesh.resource, "q1"), { camera, timeSeconds: 0 });
  expect(ordinary.surfaces.every(surface => surface.cull === "back")).toBe(true);
});

test("weapon HUD framing preserves world camera, viewport and horizontal scale", () => {
  const source: SceneCamera = { ...camera, projection: perspectiveProjection(90, 73.73979529168804, 16384) };
  expect(weaponViewCamera(source, [])).toBe(source);
  const framed = weaponViewCamera(source, [{ x: 120, y: 434, width: 400, height: 42 }]);
  expect(framed.viewport).toBe(source.viewport);
  expect(framed.axis).toBe(source.axis);
  expect(framed.origin).toBe(source.origin);
  expect(framed.projection[0]).toBe(source.projection[0]);
  expect(framed.projection[5]).toBe(source.projection[5]);
  expect(framed.projection[9]).toBeCloseTo(-46 / 480, 8);
  expect(source.projection[9]).toBe(0);
});

test("native alias bounds reject geometry before lighting while retaining replacement attachments and shadow casters", async () => {
  const original = await asset(rereleaseGunArchive, "progs/v_shot2.mdl", "q1");
  const mesh = await asset(rereleaseGunArchive, "progs/v_shot2.md5mesh", "q1");
  const animation = await asset(rereleaseGunArchive, "progs/v_shot2.md5anim", "q1");
  const alias = parseMdl(original.bytes);
  const skeleton = createMd5Model(parseMd5Mesh(new TextDecoder().decode(mesh.bytes)), parseMd5Anim(new TextDecoder().decode(animation.bytes)));
  const replacement = { ...skeleton, skinSelection: q1ReplacementSkinSelection(skeleton, alias) };
  const joint = replacement.joints[0];
  if (joint === undefined) throw new Error("Missing replacement attachment joint");
  const child = entity(alias, original.resource, "q1");
  const source: SceneEntity = { ...entity({ ...alias, replacement: { model: replacement, resource: mesh.resource } }, original.resource, "q1"),
    attachments: [{ tag: joint.name, entity: { ...child, transform: { ...child.transform, origin: { x: 2000, y: 0, z: 0 } } } }] };
  const frustum = [{ normal: { x: 1, y: 0, z: 0 }, distance: 1000 }];
  let parentLights = 0, childLights = 0;
  const context = { camera, timeSeconds: 0, frustum, finalVertexLight: (current: SceneEntity) => {
    if (current.model.kind === "md5") parentLights++; else childLights++;
    return { x: 1, y: 1, z: 1 };
  } };
  const culled = prepareSceneEntity(source, context);
  expect(culled.cull).toBe("out"); expect(culled.surfaces).toHaveLength(0); expect(parentLights).toBe(0);
  expect(culled.attachments[0]?.cull).not.toBe("out"); expect(childLights).toBeGreaterThan(0);
  const shadow = prepareSceneEntity(source, { ...context, noCull: true, purpose: "shadow" });
  expect(shadow.surfaces.length).toBeGreaterThan(0); expect(parentLights).toBeGreaterThan(0);
  const native = await asset("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak", "models/monsters/soldier/tris.md2", "q2");
  const q2 = entity(parseMd2(native.bytes), native.resource, "q2");
  const hidden = prepareSceneEntity(q2, context);
  expect(hidden.cull).toBe("out"); expect(hidden.surfaces).toHaveLength(0);
  const weapon = prepareSceneEntity({ ...q2, flags: { kind: "q2", bits: 4 } }, context);
  expect(weapon.cull).toBe("in"); expect(weapon.surfaces.length).toBeGreaterThan(0);
});

test("MD5 frame-local skinning reuses a pose without retaining animated monster poses across frames", async () => {
  const meshAsset = await asset(rereleaseGunArchive, "progs/soldier.md5mesh", "q1");
  const animation = await asset(rereleaseGunArchive, "progs/soldier.md5anim", "q1");
  const model = createMd5Model(parseMd5Mesh(new TextDecoder().decode(meshAsset.bytes)), parseMd5Anim(new TextDecoder().decode(animation.bytes)));
  const mesh = model.meshes[0], firstPose = model.frames[0]?.joints, nextPose = model.frames[1]?.joints;
  if (mesh === undefined || firstPose === undefined || nextPose === undefined) throw new Error("Missing animated soldier fixture");
  const skinningFrame: import("../../../../src/render/scene/models/types.ts").ModelSkinningFrame = new WeakMap();
  const source: SceneEntity = { ...entity(model, meshAsset.resource, "q1"), pose: { kind: "skeleton", joints: firstPose } };
  const context = { camera, timeSeconds: 0, skinningFrame };
  const prepared = prepareSceneEntity(source, context), first = skinningFrame.get(mesh)?.get(firstPose);
  expect(first).toBeDefined();
  for (const [index, vertex] of (first ?? []).entries()) expect(mesh.vertices[index]?.texCoord).toBe(vertex.texCoord);
  expect(prepareSceneEntity(source, context)).toEqual(prepared);
  expect(skinningFrame.get(mesh)?.get(firstPose)).toBe(first);
  expect(prepared).toEqual(prepareSceneEntity(source, { camera, timeSeconds: 0 }));
  const animated = { ...source, pose: { kind: "skeleton", joints: nextPose } } satisfies SceneEntity;
  const changed = prepareSceneEntity(animated, context), next = skinningFrame.get(mesh)?.get(nextPose);
  expect(next).toBeDefined(); expect(next).not.toBe(first); expect(next).not.toEqual(first);
  expect(changed).toEqual(prepareSceneEntity(animated, { camera, timeSeconds: 0 }));
  const nextFrame: import("../../../../src/render/scene/models/types.ts").ModelSkinningFrame = new WeakMap();
  expect(prepareSceneEntity(source, { ...context, skinningFrame: nextFrame })).toEqual(prepared);
  expect(nextFrame.get(mesh)?.get(firstPose)).not.toBe(first);
  for (const backLerp of [0, 0.25, 0.75, 1]) {
    const interpolated = { ...source, pose: { kind: "frame", frame: 1, previousFrame: 0, backLerp } } satisfies SceneEntity;
    expect(prepareSceneEntity(interpolated, context)).toEqual(prepareSceneEntity(interpolated, { camera, timeSeconds: 0 }));
  }
  const shell = { ...source, flags: { kind: "q2", bits: 1024 } } satisfies SceneEntity;
  expect(prepareSceneEntity(shell, context)).toEqual(prepareSceneEntity(shell, { camera, timeSeconds: 0 }));
  expect(skinningFrame.get(mesh)?.get(firstPose)).toBe(first);
  expect(prepareSceneEntity(source, context)).toEqual(prepared);
});
