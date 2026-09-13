import { expect, test } from "bun:test";
import { DEFAULT_IMAGE_POLICY, imagePolicyFromControls, parseImageFormats } from "../../src/render/scene/image-policy.ts";
import type { ImageFormat, ImagePolicy, ImageUsage } from "../../src/render/scene/image-policy.ts";
import { SceneTextureLoader } from "../../src/render/scene/textures.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";

async function candidates(name: string, usage: ImageUsage, policy?: ImagePolicy, family: "q1" | "q2" | "q3" = "q2"): Promise<readonly string[]> {
  const paths: string[] = [], images = new SceneImageRegistry({ identity: Symbol("policy"), session: createIdentityOwner("policy").session, generation: 0 });
  const loader = new SceneTextureLoader(images, { read: async path => { paths.push(path); return null; } }, null, policy === undefined ? {} : { policy });
  try { expect(await loader.load(name, { family, usage })).toBeNull(); return paths; }
  finally { loader.close(); images.close(); }
}

test("format controls parse source tokens, legacy initials, case and duplicate removal", () => {
  expect(parseImageFormats('TGA JPEG bmp gif PNG jpg tga')).toEqual(["tga", "jpeg", "bmp", "gif", "png", "jpg"]);
  expect(parseImageFormats('pjt // ignored gif\n "BMP" xyz')).toEqual(["png", "jpg", "tga", "bmp"]);
  expect(parseImageFormats('???')).toEqual([]);
  expect(DEFAULT_IMAGE_POLICY.formats).toEqual(["png", "jpg", "tga", "jpeg", "bmp", "gif"]);
});

test("override level and semantic mask control candidate priority, retaining native fallback", async () => {
  const policy = (overrideLevel: number, overrideMask = -1) => imagePolicyFromControls({ overrideLevel, overrideMask, formats: "bmp jpeg" });
  expect(await candidates("pics/a.pcx", "picture", policy(0))).toEqual(["pics/a.pcx", "pics/a.bmp", "pics/a.jpeg"]);
  expect(await candidates("pics/a.pcx", "picture", policy(-1))).toEqual(["pics/a.pcx", "pics/a.bmp", "pics/a.jpeg"]);
  expect(await candidates("pics/a.pcx", "picture", policy(1))).toEqual(["pics/a.bmp", "pics/a.jpeg", "pics/a.pcx"]);
  expect(await candidates("pics/a.png", "picture", policy(1))).toEqual(["pics/a.png", "pics/a.bmp", "pics/a.jpeg", "pics/a.pcx"]);
  expect(await candidates("pics/a.png", "picture", policy(2))).toEqual(["pics/a.bmp", "pics/a.jpeg", "pics/a.png", "pics/a.pcx"]);
  expect(await candidates("textures/a", "wall", policy(0))).toEqual(["textures/a.wal", "textures/a.bmp", "textures/a.jpeg"]);
  expect(await candidates("textures/a", "wall", imagePolicyFromControls({ overrideLevel: 1, overrideMask: -1, formats: "???" }))).toEqual(["textures/a.wal"]);
  for (const [usage, bit] of new Map<ImageUsage, number>([["skin", 1], ["sprite", 2], ["wall", 4], ["picture", 8], ["sky", 16]])) {
    expect((await candidates("custom/a.pcx", usage, policy(1, bit)))[0]).toBe("custom/a.bmp");
    expect((await candidates("custom/a.pcx", usage, policy(1, 0)))[0]).toBe("custom/a.pcx");
  }
});

test("policy is a lifetime snapshot and other family defaults remain native", async () => {
  expect((await candidates("pics/a.pcx", "picture", undefined, "q1"))[0]).toBe("pics/a.pcx");
  expect((await candidates("pics/a.tga", "picture", undefined, "q3"))[0]).toBe("pics/a.tga");
  expect((await candidates("pics/a.tga", "picture", imagePolicyFromControls({ overrideLevel: 2, overrideMask: -1, formats: "bmp" }), "q3"))[0]).toBe("pics/a.bmp");
  const formats: ImageFormat[] = ["bmp"], usages: ImageUsage[] = ["picture"], paths: string[] = [];
  const images = new SceneImageRegistry({ identity: Symbol("snapshot"), session: createIdentityOwner("snapshot").session, generation: 0 });
  const loader = new SceneTextureLoader(images, { read: async path => { paths.push(path); return null; } }, null, { policy: { overrideLevel: 1, formats, overrideUsages: usages }, fullbrightFirst: 230 });
  formats.splice(0); usages.splice(0);
  try { await loader.load("pics/a.pcx", { family: "q2", usage: "picture" }); expect(paths).toEqual(["pics/a.bmp", "pics/a.pcx"]); expect(loader.fullbrightFirst).toBe(230); }
  finally { loader.close(); images.close(); }
});

import { createContentId, createMountId, createMountIdentity, createMountPlanId, createResourceId } from "../../src/contracts/content.ts";
import type { ResolvedResourceReference } from "../../src/contracts/content.ts";
import { digestBytes } from "../../src/content/mounts/index.ts";
import { encodePng } from "../../src/formats/images/png.ts";

test("extensionless BSP wall requests retain native WAL intent under level and mask controls", async () => {
  const colors = new Uint8Array(768).fill(127);
  const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: "palette", byteLength: colors.length, digest: digestBytes(colors),
    provenance: { kind: "loose", memberPath: "palette", mount: { kind: "loose", rootPath: "/", identity: createMountIdentity(createMountId("policy", "palette"), createContentId({ family: "q2", edition: "classic", package: "base", revision: "test" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("policy", "test"), rank: 0 } };
  const palette = { colors, source: { ...record, id: createResourceId(record) } };
  const wal = new Uint8Array(440), header = new DataView(wal.buffer);
  header.setUint32(32, 16, true); header.setUint32(36, 16, true);
  let offset = 100;
  for (let mip = 0; mip < 4; mip++) { header.setUint32(40 + mip * 4, offset, true); offset += (16 >> mip) ** 2; }
  const png = encodePng(32, 32, new Uint8Array(32 * 32 * 4).fill(192));
  for (const [level, mask, nativePresent, expected] of [[0, -1, true, "wal"], [1, 0, true, "wal"], [1, -1, true, "png"], [0, -1, false, "png"]] satisfies readonly (readonly [number, number, boolean, string])[]) {
    const images = new SceneImageRegistry({ identity: Symbol("wall-policy"), session: createIdentityOwner("wall-policy").session, generation: 0 });
    const loader = new SceneTextureLoader(images, { read: async path => path.endsWith(".png") ? { bytes: png, source: { kind: "generated", name: "png" } }
      : path.endsWith(".wal") && nativePresent ? { bytes: wal, source: { kind: "generated", name: "wal" } } : null }, palette,
    { policy: imagePolicyFromControls({ overrideLevel: level, overrideMask: mask, formats: "png jpg tga jpeg bmp gif" }) });
    try {
      // Same extensionless name and semantic options supplied by WorldScene.load's Q2 BSP path.
      const texture = await loader.load("textures/example", { family: "q2", usage: "wall" });
      expect(texture?.image.source).toEqual({ kind: "generated", name: expected });
      expect(texture?.image.width).toBe(expected === "wal" ? 16 : 32);
      expect(texture?.width).toBe(nativePresent ? 16 : 32);
    } finally { loader.close(); images.close(); }
  }
});

test("source format sentinel preserves each family's search order when controls change", async () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly ("q1" | "q2" | "q3")[]) {
    const inherited = imagePolicyFromControls({ overrideLevel: 0, overrideMask: 0, formats: " SOURCE " });
    expect(inherited.formats).toBeUndefined();
    const actual = await candidates("pics/example", "picture", inherited, family);
    const original = await candidates("pics/example", "picture", undefined, family);
    expect(actual).toEqual(original);
  }
});

test("loader disposal retires only its images and sampled variants after users rebind", async () => {
  const images = new SceneImageRegistry({ identity: Symbol("retirement"), session: createIdentityOwner("retirement").session, generation: 0 });
  const loader = new SceneTextureLoader(images, { read: async () => null });
  const other = new SceneTextureLoader(images, { read: async () => null });
  const sampled = await loader.sampleSurface(loader.missing, { mipmap: false, wrap: "clamp" });
  const colors = new Uint8Array(768);
  const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: "palette", byteLength: colors.length, digest: digestBytes(colors),
    provenance: { kind: "loose", memberPath: "palette", mount: { kind: "loose", rootPath: "/", identity: createMountIdentity(createMountId("retire", "palette"), createContentId({ family: "q1", edition: "classic", package: "base", revision: "test" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("retire", "test"), rank: 0 } };
  const bright = loader.register("bright", { kind: "indexed8", levels: [{ width: 1, height: 1, pixels: new Uint8Array([224]) }],
    palette: { colors, source: { ...record, id: createResourceId(record) } }, transparency: { kind: "opaque" }, fullbright: { first: 224, last: 255 }, translation: null });
  images.release(loader.white.image);
  images.drainOperations();
  loader.close();
  expect(images.isResident(loader.missing.image)).toBe(true);
  loader.disposeImages();
  expect(images.isResident(loader.missing.image)).toBe(false);
  expect(images.isResident(sampled.image)).toBe(false);
  expect(images.isResident(other.white.image)).toBe(true);
  if (bright.fullbright === null) throw new Error("Fullbright image absent");
  expect(images.isResident(bright.fullbright)).toBe(false);
  expect(images.isResident(bright.image)).toBe(false);
  expect(images.drainOperations().filter(operation => operation.kind === "release-image")).toHaveLength(4);
  loader.disposeImages();
  expect(images.drainOperations()).toHaveLength(0);
  other.disposeImages(); images.close();
});

test("replacement preparation replays used skin requests and rejects a newly selected corrupt image before retirement", async () => {
  const images = new SceneImageRegistry({ identity: Symbol("replay"), session: createIdentityOwner("replay").session, generation: 0 });
  const png = encodePng(2, 2, new Uint8Array(16).fill(255));
  const reader = { read: async (path: string) => path.endsWith(".png") ? { bytes: png, source: { kind: "generated", name: path } satisfies Parameters<SceneImageRegistry["register"]>[3] }
    : path.endsWith(".gif") ? { bytes: new Uint8Array([1]), source: { kind: "generated", name: path } satisfies Parameters<SceneImageRegistry["register"]>[3] } : null };
  const original = new SceneTextureLoader(images, reader, null, { policy: imagePolicyFromControls({ overrideLevel: 2, overrideMask: 1, formats: "png gif" }) });
  const replacement = new SceneTextureLoader(images, reader, null, { policy: imagePolicyFromControls({ overrideLevel: 2, overrideMask: 1, formats: "gif png" }) });
  try {
    const image = await original.load("models/custom/skin.png", { family: "q2", usage: "skin", mipmap: false });
    if (image === null) throw new Error("Missing original skin");
    await expect(original.prepareReplacement(replacement)).rejects.toThrow();
    expect(images.isResident(image.image)).toBe(true);
    expect(await original.load("models/custom/skin.png", { family: "q2", usage: "skin", mipmap: false })).toBe(image);
  } finally { replacement.disposeImages(); original.disposeImages(); images.close(); }
});

test("explicit Q1 indexed skins retain LMP intent and logical dimensions under replacement controls", async () => {
  const colors = new Uint8Array(768);
  const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: "palette", byteLength: colors.length, digest: digestBytes(colors),
    provenance: { kind: "loose", memberPath: "palette", mount: { kind: "loose", rootPath: "/", identity: createMountIdentity(createMountId("q1-intent", "palette"), createContentId({ family: "q1", edition: "rerelease", package: "id1", revision: "test" }), 0) } },
    resolution: { kind: "default-order", plan: createMountPlanId("q1-intent", "test"), rank: 0 } };
  const palette = { colors, source: { ...record, id: createResourceId(record) } };
  const lmp = new Uint8Array(8 + 2 * 3), header = new DataView(lmp.buffer); header.setUint32(0, 2, true); header.setUint32(4, 3, true); lmp.fill(224, 8);
  const png = encodePng(8, 8, new Uint8Array(256).fill(192));
  for (const [level, mask, expected] of [[0, -1, "lmp"], [1, 0, "lmp"], [1, 1, "png"]] satisfies readonly (readonly [number, number, string])[]) {
    const images = new SceneImageRegistry({ identity: Symbol("q1-intent"), session: createIdentityOwner("q1-intent").session, generation: 0 });
    const textures = new SceneTextureLoader(images, { read: async path => ({ bytes: path.endsWith(".lmp") ? lmp : png, source: { kind: "generated", name: path } }) }, palette,
      { policy: imagePolicyFromControls({ overrideLevel: level, overrideMask: mask, formats: "png" }) });
    try {
      const skin = await textures.load("progs/dog_00_00.lmp", { family: "q1", usage: "skin" });
      expect(skin?.image.source).toEqual({ kind: "generated", name: `progs/dog_00_00.${expected}` });
      expect([skin?.width, skin?.height, skin?.image.width]).toEqual([2, 3, expected === "lmp" ? 2 : 8]);
      if (expected === "lmp") {
        expect(skin?.content.kind).toBe("indexed8"); expect(skin?.fullbright).not.toBeNull();
        if (skin?.content.kind === "indexed8") expect(skin.content.palette).toBe(palette);
      }
    } finally { textures.disposeImages(); images.close(); }
  }
});
