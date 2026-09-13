import { expect, test } from "bun:test";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { encodePcx } from "../../src/formats/images/indexed.ts";
import { encodeJpeg } from "../../src/formats/images/jpeg-encoder.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import type { SceneAsset } from "../../src/render/scene/textures.ts";

function bmp(width: number, height: number): Uint8Array {
  const stride = Math.ceil(width * 3 / 4) * 4, bytes = new Uint8Array(54 + stride * height), view = new DataView(bytes.buffer);
  bytes.set([66, 77]); view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  bytes.fill(96, 54); return bytes;
}
function asset(bytes: Uint8Array, name: string): SceneAsset { return { bytes, source: { kind: "generated", name } }; }
function loader(files: ReadonlyMap<string, SceneAsset>, originals: ReadonlyMap<string, SceneAsset> = new Map<string, SceneAsset>()): SceneTextureLoader {
  return new SceneTextureLoader(new SceneImageRegistry({ identity: Symbol("image-resolution"), session: createIdentityOwner("image-resolution").session, generation: 0 }), {
    read: async path => files.get(path) ?? null, readOriginal: async path => originals.get(path) ?? null,
  });
}

test("Q2 explicit, extensionless and absent native requests discover JPEG and BMP", async () => {
  const pixels = new Uint8Array(8 * 8 * 4).fill(192);
  for (const [extension, bytes] of new Map([["jpeg", encodeJpeg({ width: 8, height: 8, pixels }, 90)], ["bmp", bmp(8, 8)]])) {
    const textures = loader(new Map([[`pics/example.${extension}`, asset(bytes, extension)], [`textures/example.${extension}`, asset(bytes, extension)]]));
    try {
      for (const path of [`pics/example.${extension}`, "pics/example", "pics/example.pcx", "textures/example.wal", "textures/example"]) {
        const result = await textures.load(path, { family: "q2", mipmap: false });
        expect(result?.image.source).toEqual({ kind: "generated", name: extension });
        expect(result?.image.width).toBe(8);
      }
    } finally { textures.close(); textures.images.close(); }
  }
});

test("Q2 retains original requested PCX dimensions and same-format BMP dimensions without shrinking uploaded pixels", async () => {
  const originalPcx = encodePcx({ width: 2, height: 3, indices: new Uint8Array(6) }, new Uint8Array(768));
  const textures = loader(new Map([["pics/icon.bmp", asset(bmp(8, 8), "replacement")]]), new Map([
    ["pics/icon.pcx", asset(originalPcx, "native")], ["pics/icon.bmp", asset(bmp(4, 5), "original-bmp")],
  ]));
  try {
    const pcx = await textures.load("pics/icon.pcx", { family: "q2", mipmap: false });
    expect([pcx?.width, pcx?.height, pcx?.image.width, pcx?.image.height]).toEqual([2, 3, 8, 8]);
    const bitmap = await textures.load("pics/icon.bmp", { family: "q2", mipmap: false });
    expect([bitmap?.width, bitmap?.height, bitmap?.image.width, bitmap?.image.height]).toEqual([4, 5, 8, 8]);
  } finally { textures.close(); textures.images.close(); }
});

test("Q2 picture dimensions ignore an unrelated same-basename WAL or PCX", async () => {
  const textures = loader(new Map([
    ["pics/icon.bmp", asset(bmp(8, 8), "bitmap")], ["pics/icon.wal", asset(new Uint8Array(), "unrelated-invalid-wal")],
    ["pics/icon.pcx", asset(new Uint8Array(), "unrelated-invalid-pcx")],
  ]));
  try {
    const result = await textures.load("pics/icon.bmp", { family: "q2", mipmap: false });
    expect([result?.width, result?.height]).toEqual([8, 8]);
  } finally { textures.close(); textures.images.close(); }
});

import { encodePng, encodeTga, decodePcx } from "../../src/formats/images/index.ts";
import { createContentDigest, createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../src/contracts/content.ts";
import type { SceneCamera, Palette } from "../../src/contracts/render.ts";
import type { SceneEntity } from "../../src/contracts/scene.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { parseMd2 } from "../../src/formats/q12-model/index.ts";
import { decodeQ2Map } from "../../src/formats/q2-map/index.ts";
import { SceneShaderRegistry, WorldScene, perspectiveProjection } from "../../src/render/scene/index.ts";
import { SceneModelRenderer } from "../../src/render/scene/models/index.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";

function reference(path: string, bytes: Uint8Array): ResolvedResourceReference {
  const mount = { kind: "loose", identity: createMountIdentity(createMountId("resolution", "q2"), createContentId({ family: "q2", edition: "classic", package: "base", revision: "test" }), 0), rootPath: "/" } satisfies Extract<ResolvedResourceReference["provenance"], { kind: "loose" }>["mount"];
  const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, provenance: { kind: "loose", mount, memberPath: path },
    digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")), byteLength: bytes.length,
    resolution: { kind: "default-order", plan: createMountPlanId("resolution", "test"), rank: 0 } };
  return { ...record, id: createResourceId(record) };
}
const rgba = { width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4).fill(192) };
const formatFixtures = new Map([
  ["png", encodePng(8, 8, rgba.pixels)], ["jpg", encodeJpeg(rgba, 90)], ["tga", encodeTga(rgba)],
  ["jpeg", encodeJpeg(rgba, 90)], ["bmp", bmp(8, 8)],
  ["gif", new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkwBADs=", "base64"))],
]);

test("all Q2 usages share native override precedence, explicit truecolor priority and logical PCX dimensions", async () => {
  const pcx = encodePcx({ width: 2, height: 3, indices: new Uint8Array(6) }, new Uint8Array(768));
  const files = new Map([...formatFixtures].map(([extension, bytes]) => [`custom/example.${extension}`, asset(bytes, extension)]));
  files.set("custom/example.pcx", asset(pcx, "native"));
  for (const extension of formatFixtures.keys()) {
    const textures = loader(files);
    try {
      for (const usage of ["skin", "sprite", "picture", "wall", "sky"] satisfies readonly NonNullable<Parameters<SceneTextureLoader["load"]>[1]>["usage"][]) {
        const replacement = await textures.load("custom/example.pcx", { family: "q2", usage, mipmap: false });
        expect(replacement?.image.source).toEqual({ kind: "generated", name: extension });
        expect([replacement?.width, replacement?.height]).toEqual([2, 3]);
      }
      const exact = await textures.load(`custom/example.${extension}`, { family: "q2", mipmap: false });
      expect(exact?.image.source).toEqual({ kind: "generated", name: extension });
    } finally { textures.close(); textures.images.close(); }
    files.delete(`custom/example.${extension}`);
  }
  const broken = loader(new Map([["pics/broken.png", asset(new Uint8Array(), "bad-png")], ["pics/broken.pcx", asset(pcx, "native")]]));
  try { await expect(broken.load("pics/broken.pcx", { family: "q2" })).rejects.toThrow(); } finally { broken.close(); broken.images.close(); }
});

test("semantic Q2 skin and sprite PCX retain global palette, flood fill, transparency and separate cache entries", async () => {
  const colors = new Uint8Array(768); colors.set([40, 80, 120], 3); colors.set([80, 160, 240], 6);
  const palette: Palette = { colors, source: reference("pics/colormap.pcx", colors) };
  const indices = new Uint8Array([1, 1, 2, 2, 255, 2]), bytes = encodePcx({ width: 3, height: 2, indices }, new Uint8Array(768));
  const images = new SceneImageRegistry({ identity: Symbol("usage"), session: createIdentityOwner("usage").session, generation: 0 });
  const textures = new SceneTextureLoader(images, { read: async path => path.endsWith(".pcx") ? asset(bytes, "native") : null }, palette);
  try {
    const sprite = await textures.load("model.pcx", { family: "q2", usage: "sprite", mipmap: false });
    const skin = await textures.load("model.pcx", { family: "q2", usage: "skin", mipmap: false });
    if (sprite?.content.kind !== "indexed8" || skin?.content.kind !== "indexed8") throw new Error("Native Q2 image lost indices");
    expect(sprite.content.palette).toBe(palette); expect(skin.content.palette).toBe(palette);
    expect(sprite.content.levels[0].pixels).toEqual(indices); expect(skin.content.levels[0].pixels).not.toEqual(indices);
    expect(sprite.content.transparency).toEqual({ kind: "index", index: 255 }); expect(skin.content.levels[0].pixels[4]).toBe(255);
    const mipped = await textures.load("model.pcx", { family: "q2", usage: "skin" });
    expect(mipped?.content.kind).toBe("rgba8"); expect(mipped?.content.levels.length).toBeGreaterThan(1);
    expect(mipped?.content.levels[0].pixels[4 * 4 + 3]).toBe(0);
    const picture = await textures.load("model.pcx", { family: "q2", usage: "picture", mipmap: false });
    expect(picture?.content.kind).toBe("rgba8"); expect(picture?.content.levels[0].pixels[0]).toBe(0);
  } finally { textures.close(); images.close(); }
});

for (const backend of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) test.skipIf(process.env["QUAKE_IMAGE_RENDER"] !== "1")(`actual MD2 custom skins use every shared image format through ${backend}`, async () => {
  const archive = await openArchive("/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak");
  const identity = createIdentityOwner(`image-model-${backend}`), owner = { identity: Symbol(backend), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner), renderer = NativeRenderer.open({ renderer: backend, width: 320, height: 240, hidden: true, gamma: 1 }, owner);
  const loaders: SceneTextureLoader[] = [];
  async function read(path: string): Promise<SceneAsset | null> {
    const entry = archive.findEntries(path)[0]; return entry === undefined ? null : asset(await archive.readEntry(entry), path);
  }
  async function required(path: string): Promise<Uint8Array> { const result = await read(path); if (result === null) throw new Error(`Missing ${path}`); return result.bytes; }
  try {
    const paletteBytes = await required("pics/colormap.pcx"), colors = decodePcx(paletteBytes).palette;
    if (colors === null) throw new Error("Missing native palette");
    const palette = { colors, source: reference("pics/colormap.pcx", paletteBytes) };
    const worldTextures = new SceneTextureLoader(images, { read }, palette); loaders.push(worldTextures);
    const shaders = new SceneShaderRegistry(worldTextures), world = await WorldScene.load(decodeQ2Map(await required("maps/base1.bsp")), shaders);
    const path = "models/monsters/soldier/tris.md2", modelBytes = await required(path), model = parseMd2(modelBytes), skinBytes = await required(model.skins[0] ?? "missing-native-skin");
    const axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }] satisfies SceneCamera["axis"], origin = { x: 128, y: -320, z: 24 };
    const camera: SceneCamera = { origin: { ...origin, x: origin.x - 110, z: origin.z + 6 }, axis, projection: perspectiveProjection(65, 50, 4096), viewport: { x: 0, y: 0, width: 320, height: 240 }, clip: { kind: "none" } };
    const entity: SceneEntity = { actor: null, resource: reference(path, modelBytes), model, transform: { origin, axis, scale: { x: 1, y: 1, z: 1 } }, previousOrigin: origin,
      pose: { kind: "frame", frame: 0, previousFrame: 0, backLerp: 0 }, skin: 0, color: { x: 1, y: 1, z: 1, w: 1 }, shaderTime: { kind: "seconds", value: 0 },
      flags: { kind: "q2", bits: 8 }, lightingOrigin: origin, shadowPlane: 0, attachments: [] };
    const input = { camera, time: { kind: "seconds", value: 0 }, target: { kind: "seat", seat: identity.seat(0) }, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } } satisfies Parameters<SceneModelRenderer["prepare"]>[1];
    const frames = new SceneFrameBuilder(images);
    for (const [extension, bytes] of [...formatFixtures, ["pcx", skinBytes] satisfies [string, Uint8Array]]) {
      const custom = `players/male/custom-${extension}`, sourceName = `${custom}.${extension}`;
      const textures = new SceneTextureLoader(images, { read: async name => name === sourceName ? asset(bytes, sourceName) : name === `${custom}.pcx` ? asset(skinBytes, "original-skin") : read(name) }, palette); loaders.push(textures);
      const scene = new SceneModelRenderer({ family: "q2", palette, textures, shaders }, world), options = () => ({ player: true, customShader: `${custom}.pcx` });
      await scene.preload([entity], options);
      const batches = scene.prepare([entity], input, options);
      expect(batches.some(batch => batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated" && batch.texture.image.source.name === sourceName)).toBe(true);
      const texture = await textures.load(`${custom}.pcx`, { family: "q2", usage: "skin" });
      expect([texture?.width, texture?.height]).toEqual([decodePcx(skinBytes).width, decodePcx(skinBytes).height]);
      frames.begin(); frames.view({ target: input.target, time: input.time, viewport: camera.viewport, clear: input.clear, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
      const capture = renderer.captureNextFrame(); renderer.execute(frames.finish()); const pixels = await capture;
      expect(pixels.filter((value, index) => index % 4 !== 3 && value > 5).length).toBeGreaterThan(100);
      if (extension === "gif" || extension === "pcx") await Bun.write(`/tmp/shared-image-${backend}-${extension}.png`, encodePng(320, 240, pixels));
    }
  } finally { for (const textures of loaders) textures.close(); images.close(); renderer.close(); archive.close(); }
}, 30000);

test("wall usage retains WAL dimensions and opaque index255 while pictures keep explicit truecolor and Q1/Q3 request order", async () => {
  const wal = new Uint8Array(100 + 256 + 64 + 16 + 4), header = new DataView(wal.buffer);
  header.setUint32(32, 16, true); header.setUint32(36, 16, true);
  let offset = 100;
  for (let mip = 0; mip < 4; mip++) { header.setUint32(40 + mip * 4, offset, true); offset += (16 >> mip) ** 2; }
  wal.fill(255, 100);
  const colors = new Uint8Array(768).fill(127), palette = { colors, source: reference("palette", colors) };
  const files = new Map([["nonstandard/wall.wal", asset(wal, "native-wall")], ["nonstandard/wall.png", asset(encodePng(8, 8, rgba.pixels), "hires-wall")],
    ["pics/icon.pcx", asset(encodePcx({ width: 2, height: 3, indices: new Uint8Array(6) }, colors), "native-picture")],
    ["pics/icon.png", asset(encodePng(8, 8, rgba.pixels), "png")], ["pics/icon.bmp", asset(bmp(8, 8), "bmp")]]);
  const images = new SceneImageRegistry({ identity: Symbol("walls"), session: createIdentityOwner("walls").session, generation: 0 });
  const textures = new SceneTextureLoader(images, { read: async path => files.get(path) ?? null }, palette);
  try {
    const replacement = await textures.load("nonstandard/wall", { family: "q2", usage: "wall", mipmap: false });
    expect([replacement?.width, replacement?.height, replacement?.image.width]).toEqual([16, 16, 8]);
    expect((await textures.load("pics/icon.bmp", { family: "q2", usage: "picture" }))?.image.source).toEqual({ kind: "generated", name: "bmp" });
    for (const family of ["q1", "q3"] satisfies readonly ("q1" | "q3")[]) expect((await textures.load("pics/icon.pcx", { family, mipmap: false }))?.image.source).toEqual({ kind: "generated", name: "native-picture" });
    files.delete("nonstandard/wall.png");
    const native = await textures.load("nonstandard/wall.wal", { family: "q2", usage: "wall", mipmap: false });
    if (native?.content.kind !== "indexed8") throw new Error("Native WAL lost palette");
    expect(native.content.transparency).toEqual({ kind: "opaque" }); expect(native.content.palette).toBe(palette); expect(native.content.levels[0].pixels[0]).toBe(255);
    files.set("pics/unknown.blob", asset(new Uint8Array(), "unsupported"));
    await expect(textures.load("pics/unknown.blob")).rejects.toThrow("Unsupported scene image format");
  } finally { textures.close(); images.close(); }
});
