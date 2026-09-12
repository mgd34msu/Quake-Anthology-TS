import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { openArchive } from "../../src/content/archive/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { SceneImageRegistry, SceneTextureLoader } from "../../src/render/scene/index.ts";
import { BinaryReader } from "../../src/core/binary/index.ts";
import type { Palette } from "../../src/contracts/render.ts";
import { decodePcx, encodePcx, decodeQ1MipTexture, decodeWal, decodeLit } from "../../src/formats/images/indexed.ts";
import { decodePng, encodePng } from "../../src/formats/images/png.ts";
import { decodeTga, decodeQ3Tga, encodeTga } from "../../src/formats/images/tga.ts";
import { decodeJpeg } from "../../src/formats/images/jpeg.ts";
import { encodeJpeg } from "../../src/formats/images/jpeg-encoder.ts";
import { decodeGif } from "../../src/formats/images/gif.ts";
import { decodeWad, decodeWadImage } from "../../src/formats/images/wad.ts";
import { buildGammaTable, decodeQ1Colormap, expandIndexedImage, indexedRenderImage, q1PlayerTranslation } from "../../src/formats/images/palette.ts";
import { generateMipChain, resampleImage } from "../../src/formats/images/mip.ts";

const qfiles = new URL("../../../qfiles/", import.meta.url).pathname;

async function member(path: string, name: string): Promise<Uint8Array> {
  const archive = await openArchive(path);
  try {
    const entry = archive.findEntries(name)[0];
    if (entry === undefined) throw new Error(`Missing ${name} in ${path}`);
    return await archive.readEntry(entry);
  } finally { archive.close(); }
}

describe("image codecs", () => {
  test("PCX keeps odd-width padded rows, indices and RGB palette", () => {
    const indices = new Uint8Array([1, 224, 255, 192, 7, 8]), palette = Uint8Array.from({ length: 768 }, (_, index) => index & 255);
    const decoded = decodePcx(encodePcx({ width: 3, height: 2, indices }, palette));
    expect(decoded.indices).toEqual(indices);
    expect(decoded.palette).toEqual(palette);
  });

  test("PNG/TGA screenshots retain RGBA and TGA exposes the Q3 origin profile", () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const image = { width: 1, height: 2, pixels };
    expect(decodePng(encodePng(1, 2, pixels)).pixels).toEqual(pixels);
    const tga = encodeTga(image);
    expect(decodeTga(tga).pixels).toEqual(pixels);
    expect(decodeQ3Tga(tga).pixels).toEqual(new Uint8Array([0, 255, 0, 128, 255, 0, 0, 255]));
    const corrupt = encodePng(1, 2, pixels); corrupt[20] = 255;
    expect(() => decodePng(corrupt)).toThrow("CRC");
  });

  test("JPEG encoding decodes solid RGB through the source IJG path", () => {
    const pixels = new Uint8Array(8 * 8 * 4);
    for (let index = 0; index < 64; index++) pixels.set([64, 128, 192, 255], index * 4);
    const image = decodeJpeg(encodeJpeg({ width: 8, height: 8, pixels }, 100));
    expect([image.width, image.height]).toEqual([8, 8]);
    expect(Math.abs((image.pixels[0] ?? 0) - 64)).toBeLessThanOrEqual(2);
    expect(Math.abs((image.pixels[1] ?? 0) - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs((image.pixels[2] ?? 0) - 192)).toBeLessThanOrEqual(2);
  });

  test("palette translation, fence alpha, fullbright masks and gamma stay separate", () => {
    const palette: Palette = { colors: Uint8Array.from({ length: 768 }, (_, index) => index % 256), source: {
      id: "resource:palette", requestedPath: "gfx/palette.lmp", digest: `sha256:${"0".repeat(64)}`, byteLength: 768,
      provenance: { kind: "loose", memberPath: "gfx/palette.lmp", mount: { kind: "loose", rootPath: "/qfiles", identity: { id: "mount:q1:test", content: "q1:classic:id1:test", generation: 0 } } },
      resolution: { kind: "default-order", plan: "mount-plan:q1:test", rank: 0 },
    } };
    const source = new Uint8Array([16, 224, 255]);
    const image = indexedRenderImage([{ width: 3, height: 1, pixels: source }], palette, { kind: "q1-fence", index: 255 }, { first: 224, last: 255 }, q1PlayerTranslation(9, 4));
    expect(Array.from(expandIndexedImage(image).pixels).filter((_, index) => index % 4 === 3)).toEqual([255, 255, 0]);
    expect(Array.from(expandIndexedImage(image, 0, "fullbright").pixels).filter((_, index) => index % 4 === 3)).toEqual([0, 255, 0]);
    expect(source).toEqual(new Uint8Array([16, 224, 255]));
    expect(image.translation?.[16]).toBe(159);
    expect(buildGammaTable({ kind: "q3", gamma: 2, intensity: 1, overbrightBits: 0, onlyGamma: true })[64]).toBe(128);
  });

  test("LIT keeps RGB samples and image processing preserves source bytes", () => {
    const lit = new Uint8Array([81, 76, 73, 84, 1, 0, 0, 0, 10, 20, 30]);
    expect(decodeLit(lit, 1).samples).toEqual(new Uint8Array([10, 20, 30]));
    expect(() => decodeLit(lit, 2)).toThrow("sample count");
    const input = { width: 2, height: 2, pixels: new Uint8Array([0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 192, 192, 192, 255]) };
    expect(generateMipChain(input)[1]?.pixels).toEqual(new Uint8Array([96, 96, 96, 255]));
    expect(resampleImage(input, 1, 1, "q1").pixels).toEqual(new Uint8Array([64, 64, 64, 255]));
    expect(resampleImage(input, 1, 1, "q2").pixels).toEqual(new Uint8Array([96, 96, 96, 255]));
    expect(input.pixels.length).toBe(16);
  });

  test("GIF retains palette indices and transparency", () => {
    const gif = decodeGif(new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")));
    expect([gif.width, gif.height]).toEqual([1, 1]);
    expect(gif.frames[0].transparentIndex).toBe(0);
    expect(gif.frames[0].image.pixels[3]).toBe(0);
    expect(gif.frames[0].indices).toEqual(new Uint8Array([0]));
    // Pillow-generated donor fixture from quake-2-re-ts/test/gif.test.ts.
    const animated = decodeGif(new Uint8Array([71, 73, 70, 56, 57, 97, 2, 0, 2, 0, 129, 0, 0, 10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 33, 255, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0, 33, 249, 4, 0, 10, 0, 0, 0, 44, 0, 0, 0, 0, 2, 0, 2, 0, 0, 8, 6, 0, 1, 8, 4, 16, 16, 0, 33, 249, 4, 1, 10, 0, 1, 0, 44, 0, 0, 0, 0, 2, 0, 2, 0, 129, 40, 50, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 1, 8, 4, 16, 16, 0, 33, 249, 4, 1, 10, 0, 1, 0, 44, 0, 0, 0, 0, 2, 0, 2, 0, 129, 70, 80, 90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 1, 8, 4, 16, 16, 0, 59]));
    expect(animated.frames.map(frame => Array.from(frame.image.pixels.subarray(0, 4)))).toEqual([[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255]]);
    expect(animated.frames.map(frame => frame.delayCentiseconds)).toEqual([10, 10, 10]);
    expect(animated.loopCount).toBe(0);
  });
});

describe("installed Quake image smoke", () => {
  test.skipIf(!existsSync(`${qfiles}q1/id1/PAK0.PAK`))("Q1 palette, colormap, WAD pictures and embedded map miptex", async () => {
    const path = `${qfiles}q1/id1/PAK0.PAK`;
    expect((await member(path, "gfx/palette.lmp")).length).toBe(768);
    expect(decodeQ1Colormap(await member(path, "gfx/colormap.lmp")).fullbright.first).toBe(224);
    const wad = decodeWad(await member(path, "gfx.wad"));
    const picture = wad.lumps.find(lump => lump.type === 66);
    if (picture === undefined) throw new Error("No Q1 WAD picture");
    expect(decodeWadImage(wad, picture).kind).toBe("qpic");
    const bsp = new BinaryReader(await member(path, "maps/start.bsp"));
    bsp.seek(20); const textureOffset = bsp.i32(), textureLength = bsp.i32(), textures = bsp.section(textureOffset, textureLength);
    const count = textures.i32(); expect(count).toBeGreaterThan(0);
    const first = textures.i32();
    const mip = decodeQ1MipTexture(textures.section(first, textures.length - first).bytes(textures.length - first));
    expect(mip.kind).toBe("embedded");
    if (mip.kind === "embedded") expect(mip.levels[3].pixels.length).toBe(mip.width * mip.height / 64);
  });

  test.skipIf(!existsSync(`${qfiles}q2/baseq2/pak0.pak`))("Q2 PCX palette and WAL levels", async () => {
    const path = `${qfiles}q2/baseq2/pak0.pak`, pcx = decodePcx(await member(path, "pics/colormap.pcx"));
    expect(pcx.palette?.length).toBe(768);
    expect(pcx.indices.length).toBe(pcx.width * pcx.height);
    const charsetBytes = await member(path, "pics/conchars.pcx"), charset = decodePcx(charsetBytes);
    const identity = createIdentityOwner("pcx-charset"), images = new SceneImageRegistry({ identity: Symbol("pcx"), session: identity.session, generation: 0 });
    const textures = new SceneTextureLoader(images, { read: async name => name === "pics/conchars.pcx"
      ? { bytes: charsetBytes, source: { kind: "generated", name } } : null });
    const loaded = await textures.load("pics/conchars.pcx", { family: "q2", mipmap: false });
    if (loaded === null || loaded.content.kind !== "rgba8") throw new Error("Q2 charset was not uploaded as RGBA");
    const transparent = charset.indices.indexOf(255), solid = charset.indices.findIndex(index => index !== 255);
    expect(transparent).toBeGreaterThanOrEqual(0); expect(solid).toBeGreaterThanOrEqual(0);
    expect(loaded.content.levels[0].pixels[transparent * 4 + 3]).toBe(0);
    expect(loaded.content.levels[0].pixels[solid * 4 + 3]).toBe(255);
    expect(loaded.content.levels[0].pixels.filter((_, index) => index % 4 === 3 && loaded.content.levels[0].pixels[index] === 0).length)
      .toBe(charset.indices.filter(index => index === 255).length);
    if (charset.palette === null) throw new Error("Retail Q2 charset has no embedded palette");
    const transparentRgb = charset.palette.slice(255 * 3, 256 * 3);
    for (const family of ["q1", "q3", undefined] satisfies readonly ("q1" | "q3" | undefined)[]) {
      const opaque = await textures.load("pics/conchars.pcx", family === undefined ? { mipmap: false } : { family, mipmap: false });
      if (opaque === null || opaque.content.kind !== "rgba8") throw new Error("Opaque PCX was not uploaded as RGBA");
      expect(opaque.content.levels[0].pixels[transparent * 4 + 3]).toBe(255);
      expect(opaque.content.levels[0].pixels.slice(transparent * 4, transparent * 4 + 3)).toEqual(transparentRgb);
    }
    images.close();
    const archive = await openArchive(path);
    try {
      const entry = archive.entries.find(candidate => candidate.path.endsWith(".wal"));
      if (entry === undefined) throw new Error("No Q2 WAL");
      const wal = decodeWal(await archive.readEntry(entry), entry.path);
      expect(wal.levels[0].pixels.length).toBe(wal.width * wal.height);
      expect(wal.levels[3].width).toBe(wal.width / 8);
    } finally { archive.close(); }
  });

  test.skipIf(!existsSync(`${qfiles}q2/rerelease/Q2Game.kpf`))("Q2 rerelease PNG font", async () => {
    const png = decodePng(await member(`${qfiles}q2/rerelease/Q2Game.kpf`, "fonts/qconfont.png"));
    expect(png.width).toBeGreaterThan(0);
    expect(png.pixels.length).toBe(png.width * png.height * 4);
  });

  test.skipIf(!existsSync(`${qfiles}q2/rerelease/baseq2/pak0.pak`))("Q2 indexed, 16-bit and Adam7 PNG variants", async () => {
    const path = `${qfiles}q2/rerelease/baseq2/pak0.pak`;
    const indexed = decodePng(await member(path, "tags/bloody.png"));
    expect(indexed.indexed?.palette.length).toBe(768);
    expect(indexed.indexed?.indices.length).toBe(indexed.width * indexed.height);
    expect(decodePng(await member(path, "tags/id.png")).bitDepth).toBe(16);
    const adam7 = decodePng(await member(path, "textures/tomf/+acomp1_glow.png"));
    expect([adam7.width, adam7.height, adam7.pixels.length]).toEqual([64, 16, 4096]);
  });

  test.skipIf(!existsSync(`${qfiles}q3a/baseq3/pak0.pk3`))("Q3 retail JPEG and TGA", async () => {
    const archive = await openArchive(`${qfiles}q3a/baseq3/pak0.pk3`);
    try {
      for (const extension of [".jpg", ".tga"]) {
        const entry = archive.entries.find(candidate => candidate.path.endsWith(extension));
        if (entry === undefined) throw new Error(`No Q3 ${extension}`);
        const bytes = await archive.readEntry(entry), image = extension === ".jpg" ? decodeJpeg(bytes, entry.path) : decodeQ3Tga(bytes, entry.path);
        expect(image.width).toBeGreaterThan(0);
        expect(image.pixels.length).toBe(image.width * image.height * 4);
      }
    } finally { archive.close(); }
  });
});
