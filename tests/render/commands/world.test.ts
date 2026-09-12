import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DecodedWorld, SceneEntity, SceneLight } from "../../../src/contracts/scene.ts";
import type { Palette, RendererResourceOwner, SceneCamera } from "../../../src/contracts/render.ts";
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
import type { WorldViewInput } from "../../../src/render/scene/world.ts";

test("HUD clipping keeps texture coordinates inside an independent seat", () => {
  expect(clipPicture({ x: -10, y: 0, width: 20, height: 10 }, { s1: 0, t1: 0, s2: 1, t2: 1 }, { x: 0, y: 0, width: 100, height: 100 }))
    .toEqual({ rect: { x: 0, y: 0, width: 10, height: 10 }, uv: { s1: 0.5, t1: 0, s2: 1, t2: 1 } });
});

const root = process.env["QFILES_ROOT"] ?? "/home/buzzkill/Projects/qfiles";
const cases: readonly { readonly family: "q1" | "q2" | "q3"; readonly archive: string; readonly map: string }[] = [
  { family: "q1", archive: "q1/id1/PAK0.PAK", map: "maps/start.bsp" },
  { family: "q2", archive: "q2/baseq2/pak0.pak", map: "maps/base1.bsp" },
  { family: "q2", archive: "q2/rerelease/baseq2/pak0.pak", map: "maps/base1.bsp" },
  { family: "q3", archive: "q3a/baseq3/pak0.pk3", map: "maps/q3dm1.bsp" },
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
    const shaders = new SceneShaderRegistry(textures);
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
      const batches = brush.flatMap(operation => operation.kind === "draw" ? operation.batches : []);
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
      const batches = models.prepare([entity], lit);
      expect(batches.some(batch => batch.lighting.kind === "q2-model-shadow" && batch.lighting.shadeScale > 1)).toBe(true);
      drawInput = { ...lit, operations: [{ kind: "draw", batches }] };
    }
    const prepared = scene.prepareView(drawInput);
    expect(prepared.visibility.surfaces.length).toBeGreaterThan(0);
    expect(prepared.view.operations.some(operation => operation.kind === "draw" && operation.batches.some(batch => batch.indices.length > 0))).toBe(true);
    if (fixture.family === "q3") expect(prepared.view.operations.some(operation => operation.kind === "draw"
      && operation.batches.some(batch => batch.state.depthTest === "equal" && batch.state.blend.destination === "one"))).toBe(true);
    frame.world(prepared);
    const backend = new SoftwareRenderer(160, 120, owner);
    const target = new CpuRenderTarget(backend);
    target.execute(frame.finish(false));
    let colored = 0;
    for (let pixel = 0; pixel < backend.pixels.length; pixel += 4) if ((backend.pixels[pixel] ?? 0) + (backend.pixels[pixel + 1] ?? 0) + (backend.pixels[pixel + 2] ?? 0) > 0) colored++;
    if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/w17-scene/${fixture.family}${fixture.archive.includes("rerelease") ? "-rerelease" : ""}.png`, encodePng(160, 120, backend.pixels));
    expect(colored).toBeGreaterThan(1000);
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
