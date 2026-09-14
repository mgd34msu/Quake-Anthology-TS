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
        expect(preparedOverride.some(operation => operation.kind === "draw" && operation.batches.some(batch => (batch.texture.kind === "bind-image" && batch.texture.image === surface.lightmap?.image || batch.texturing === "pair" && batch.secondTexture.binding.kind === "bind-image" && batch.secondTexture.binding.image === surface.lightmap?.image)))).toBe(true);
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
            const capture = renderer.captureNextFrame(); renderer.execute(frames.finish(true)); const pixels = await capture;
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
        const drawControl = NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, firstOwner);
        try {
          const frames = new SceneFrameBuilder(controlAssets.images); frames.begin();
          frames.world(control.prepareView({ camera, target: { kind: "preview", id: "stock-control" }, time: { kind: "milliseconds", value: 0 } }));
          const capture = drawControl.captureNextFrame(); drawControl.execute(frames.finish(true));
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
        const renderer = NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, owner);
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
            const capture = renderer.captureNextFrame(); renderer.execute(frames.finish(true)); const pixels = await capture;
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
          const assets = new ApplicationAssets(content, owner), renderer = NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, owner);
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
