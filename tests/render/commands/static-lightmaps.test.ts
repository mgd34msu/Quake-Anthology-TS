import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DecodedWorld } from "../../../src/contracts/scene.ts";
import type { Palette, RendererResourceOwner, SceneCamera, RendererImage, ImageLevel, DepthImageLevel } from "../../../src/contracts/render.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
import { anglesToAxis } from "../../../src/core/math.ts";
import { readQ1Bsp } from "../../../src/formats/q1-map/index.ts";
import { decodeQ2Map } from "../../../src/formats/q2-map/index.ts";
import { parseEntities } from "../../../src/formats/q3-map/index.ts";
import { decodePcx } from "../../../src/formats/images/indexed.ts";
import { SceneImageRegistry, SceneTextureLoader, SceneShaderRegistry, WorldScene, perspectiveProjection } from "../../../src/render/scene/index.ts";
import { SceneFrameBuilder } from "../../../src/render/commands/frame.ts";
import { SoftwareRenderer } from "../../../src/render/cpu/rasterizer.ts";
import { CpuRenderTarget } from "../../../src/render/cpu/commands.ts";
import type { Q1LightmapEncoding } from "../../../src/materials/lighting.ts";
import type { WorldViewInput } from "../../../src/render/scene/world.ts";

const root = process.env["QFILES_ROOT"] ?? "/home/buzzkill/Projects/qfiles";
const cases: readonly { readonly family: "q1" | "q2"; readonly archive: string; readonly map: string; readonly encoding?: Q1LightmapEncoding }[] = [
  { family: "q1", archive: "q1/id1/PAK0.PAK", map: "maps/start.bsp" },
  { family: "q2", archive: "q2/baseq2/pak0.pak", map: "maps/base1.bsp" },
  { family: "q2", archive: "q2/rerelease/baseq2/pak0.pak", map: "maps/base1.bsp" },
  { family: "q1", archive: "q1/id1/PAK0.PAK", map: "maps/start.bsp", encoding: "inverted-alpha" },
  { family: "q1", archive: "q1/id1/PAK0.PAK", map: "maps/start.bsp", encoding: "inverted-luminance" },
];

for (const fixture of cases) test.skipIf(!existsSync(`${root}/${fixture.archive}`))(`static lightmaps match rebuilt retail frames for ${fixture.archive}:${fixture.encoding ?? "rgb"}`, async () => {
  const path = `${root}/${fixture.archive}`, archive = await openArchive(path);
  try {
    const read = async (name: string): Promise<Uint8Array | null> => {
      const entry = archive.findEntries(name, "ascii-insensitive")[0];
      return entry === undefined ? null : archive.readEntry(entry);
    };
    const bytes = await read(fixture.map);
    if (bytes === null) throw new Error(`Missing map ${fixture.map}`);
    const map: DecodedWorld = fixture.family === "q1" ? readQ1Bsp(bytes) : decodeQ2Map(bytes);
    let palette: Palette | null = null;
    {
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
    const entities = parseEntities(map.entities);
    const world = entities.find(entity => entity.get("classname") === "worldspawn");
    const options = { q2SkyName: world?.get("sky") ?? "unit1_", q2LightModulate: 1, q1LightmapEncoding: fixture.encoding ?? "rgb" };
    const scene = await WorldScene.load(map, shaders, options);
    expect(scene.surfaces.length).toBeGreaterThan(100);
    const spawn = entities.find(entity => entity.get("classname") === "info_player_start") ?? entities.find(entity => entity.get("classname") === "info_player_deathmatch");
    const values = (spawn?.get("origin") ?? "0 0 0").split(/\s+/).map(Number);
    const camera: SceneCamera = { origin: { x: values[0] ?? 0, y: values[1] ?? 0, z: (values[2] ?? 0) + 24 },
      axis: anglesToAxis({ x: 0, y: Number(spawn?.get("angle") ?? 0), z: 0 }),
      viewport: { x: 0, y: 0, width: 160, height: 120 }, projection: perspectiveProjection(90, 73.739795, 16384), clip: { kind: "none" } };
    const frame = new SceneFrameBuilder(images), backend = new SoftwareRenderer(160, 120, owner), target = new CpuRenderTarget(backend);
    const input: WorldViewInput = { camera, target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0 },
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } };
    const transform = { origin: { x: 0, y: 0, z: 0 }, axis: anglesToAxis({ x: 0, y: 0, z: 0 }) };
    const contents = new Map<RendererImage, ImageLevel | DepthImageLevel>();
    const render = (view: WorldViewInput, force: boolean) => {
      frame.begin();
      if (force) {
        const { q2FragmentLighting, ...unfragmented } = view;
        // A nonempty light list invalidates the cache; radius < minimum adds no energy.
        const invalidated = { ...unfragmented, lights: [...(fixture.family === "q2" && q2FragmentLighting !== undefined ? [] : view.lights ?? []),
          { origin: camera.origin, radius: 0, minimum: 1, color: { x: 1, y: 1, z: 1 } }] };
        scene.prepareModel(0, transform, invalidated);
        for (const model of view.inlineModels ?? []) scene.prepareModel(model.model, model.transform, invalidated);
      }
      const prepared = scene.prepareView(view);
      let updates = 0;
      for (const operation of prepared.imageOperations) {
        if (operation.kind === "create-image") contents.set(operation.image, operation.content.levels[0]);
        if (operation.kind === "update-image") { contents.set(operation.image, operation.content); updates++; }
      }
      frame.world(prepared); target.execute(frame.finish(false));
      const used = new Set<RendererImage>();
      for (const operation of prepared.view.operations) if (operation.kind === "draw") for (const batch of operation.batches) {
        if (batch.texture.kind === "bind-image") used.add(batch.texture.image);
        if (batch.texturing === "pair" && batch.secondTexture.binding.kind === "bind-image") used.add(batch.secondTexture.binding.image);
      }
      for (const surface of scene.surfaces) if (surface.kind === "legacy" && surface.lightmap !== null && used.has(surface.lightmap.image)) used.add(surface.lightmap.direct);
      return { pixels: backend.pixels.slice(), updates, contents: new Map([...contents].filter(([image]) => used.has(image))) };
    };
    const compare = (view: WorldViewInput, expectedUpdates: boolean) => {
      const actual = render(view, false), expected = render(view, true);
      expect(actual.updates > 0).toBe(expectedUpdates);
      expect(actual.pixels).toEqual(expected.pixels);
      for (const [image, content] of actual.contents) expect(expected.contents.get(image)).toEqual(content);
      return actual;
    };
    render(input, false);
    compare(input, false);
    const q1Styles = Array.from({ length: 256 }, () => 128);
    const q2Styles = Array.from({ length: 256 }, () => ({ rgb: { x: 0.5, y: 0.75, z: 1 }, white: 3 }));
    const styled = { ...input, q1Styles, q2Styles };
    compare(styled, true);
    compare(styled, false);
    const brushModels = Array.from({ length: map.models.length }, (_, model) => ({ model, transform }));
    const brushes = { ...styled, inlineModels: brushModels };
    render(brushes, false);
    compare(brushes, false);
    const movedBrushes = { ...brushes, target: { kind: "seat", seat: identity.seat(1) } satisfies WorldViewInput["target"],
      inlineModels: [...brushModels, ...brushModels.map(model => ({ ...model, transform: {
        origin: { x: 0, y: 32, z: 16 }, axis: anglesToAxis({ x: 0, y: 30, z: 0 }), scale: 1.25 } }))] };
    render(movedBrushes, false);
    compare(movedBrushes, false);
    compare(brushes, false);
    const dimBrushes = { ...movedBrushes, q1Styles: Array.from({ length: 256 }, () => 32),
      q2Styles: Array.from({ length: 256 }, () => ({ rgb: { x: 0.125, y: 0.25, z: 0.5 }, white: 0.875 })) };
    compare(dimBrushes, true);
    compare(movedBrushes, true);
    compare(movedBrushes, false);
    expect(scene.surfaces.every(surface => surface.kind !== "legacy" || surface.lightmap === null || !surface.lightmap.face.styles.includes(254))).toBe(true);
    q1Styles[254] = 64;
    q2Styles[254] = { rgb: { x: 0.25, y: 0.75, z: 1 }, white: 3 };
    compare(styled, false);
    q2Styles[0] = { rgb: { x: 0.5, y: 0.75, z: 1 }, white: 999 };
    compare(styled, false);
    q1Styles[0] = 64;
    q2Styles[0] = { rgb: { x: 0.25, y: 0.75, z: 1 }, white: 3 };
    compare(styled, true);
    const lit = { ...styled, lights: [{ origin: camera.origin, radius: 500, minimum: 0, color: { x: 1, y: 0.5, z: 0.25 } }] };
    const litFrame = compare(lit, true);
    const unlitFrame = compare(styled, true);
    expect(litFrame.pixels).not.toEqual(unlitFrame.pixels);
    compare(styled, false);
    if (fixture.family === "q2") compare({ ...lit, q2FragmentLighting: { lights: [], atlas: null } }, false);
    const moved = { ...lit, inlineModels: [{ model: 0, transform: { ...transform, origin: { x: 0, y: 32, z: 16 }, scale: 1.25 } }] };
    compare(moved, true);
    compare(styled, true);
    const otherView = { ...styled, camera: { ...camera, axis: anglesToAxis({ x: 0, y: 180, z: 0 }) } };
    const other = render(otherView, false), otherExpected = render(otherView, true);
    expect(other.pixels).toEqual(otherExpected.pixels);
    compare(styled, true);
    options.q2LightModulate = 1.5;
    compare(styled, true);
    compare(styled, false);
    const replacement = await scene.prepareImages(shaders);
    scene.commitImages(replacement);
    contents.clear();
    compare(styled, true);
    compare(styled, false);
    target.close(); scene.close();
    expect(() => scene.prepareView(styled)).toThrow("released");
    images.close();
  } finally { archive.close(); }
}, 60000);
