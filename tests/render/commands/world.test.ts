import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../../src/contracts/identity.ts";
import type { DecodedWorld } from "../../../src/contracts/scene.ts";
import type { Palette, RendererResourceOwner, SceneCamera } from "../../../src/contracts/render.ts";
import { openArchive } from "../../../src/content/archive/index.ts";
import { createContentDigest } from "../../../src/contracts/content.ts";
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
    const prepared = scene.prepareView({ camera, target: { kind: "seat", seat: identity.seat(0) }, time: { kind: "seconds", value: 0 },
      ...(fixture.family === "q3" ? { q3Lights: [{ origin: camera.origin, radius: 300, color: { x: 1, y: 0.25, z: 0.1 } }] } : {}),
      clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } });
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
