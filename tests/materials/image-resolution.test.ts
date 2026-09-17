import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { sceneModelBatches } from "../../src/render/scene/submissions.ts";
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

test("source white shader resolves owned builtins before files and keeps vertex blending through replacement", async () => {
  const textures = loader(new Map<string, SceneAsset>()), replacementTextures = loader(new Map<string, SceneAsset>());
  const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:white-picture"));
  try {
    await shaders.initializeSourceMaterials(async () => {
      shaders.addScript("white\n{\n\t{\n\t\tmap *white\n\t\tblendfunc GL_SRC_ALPHA GL_ONE_MINUS_SRC_ALPHA\n\t\trgbgen vertex\n\t}\n}\n");
    });
    for (const mipmap of [true, false]) {
      expect(await textures.load("*white", { mipmap, wrap: "clamp", family: "q3" })).toBe(textures.white);
      expect(await textures.load("*default", { mipmap, family: "q3" })).toBe(textures.missing);
    }
    expect(await textures.load("*WHITE")).toBeNull();
    const picture = await shaders.registerSourcePicture("white");
    if (picture === null) throw new Error("Authored white shader failed to register");
    const stage = picture.material.compiled.registered.definition.stages[0];
    expect(stage?.rgbGen).toEqual({ kind: "vertex" });
    expect(stage?.alphaGen).toEqual({ kind: "vertex" });
    expect(stage?.blend).toEqual({ source: "src-alpha", destination: "one-minus-src-alpha" });
    const binding = picture.material.compiled.registered.stages[0];
    if (binding?.kind !== "loaded" || binding.binding.kind !== "images" || binding.binding.playback.kind !== "single") throw new Error("White shader has no single image binding");
    expect(binding.binding.playback.image.image).toBe(textures.white.image);
    expect(shaders.warnings.some(warning => warning.includes("*white"))).toBe(false);
    const replacement = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(replacement);
    shaders.commitReplacement(replacement);
    const replaced = await shaders.registerSourcePicture("white");
    expect(replaced?.material.order).toBe(picture.material.order);
    const replacedBinding = replaced?.material.compiled.registered.stages[0];
    if (replacedBinding?.kind !== "loaded" || replacedBinding.binding.kind !== "images" || replacedBinding.binding.playback.kind !== "single") throw new Error("Replaced white shader has no single image binding");
    expect(replacedBinding.binding.playback.image.image).toBe(replacementTextures.white.image);
  } finally { textures.close(); replacementTextures.close(); }
});

test("source picture registration rejects missing shaders while retaining default draws and image replacement", async () => {
  const textures = loader(new Map<string, SceneAsset>()), replacementTextures = loader(new Map<string, SceneAsset>());
  const registrations = new SceneMaterialRegistrations();
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:retail:missing-picture"));
  try {
    await shaders.initializeSourceMaterials(async () => {
      shaders.addScript("icons/present { { map $whiteimage } }\nicons/broken { { map absent.tga } }");
    });
    const zero = shaders.sourceDefaultPicture;
    expect(zero.material.compiled).toBe(shaders.sourceMaterials.default);
    for (const mipmap of [true, false]) {
      expect(await shaders.registerSourcePicture("radar/q3ctf1.tga", mipmap)).toBeNull();
      expect(await shaders.registerSourcePicture("icons/broken", mipmap)).toBeNull();
    }
    const allocated = registrations.snapshot();
    expect(await shaders.registerSourcePicture("RADAR/Q3CTF1", false)).toBeNull();
    expect(registrations.snapshot()).toEqual(allocated);
    const generic = await shaders.registerPicture("radar/q3ctf1.tga");
    expect(generic.material.order).toBeGreaterThan(0);
    const missing = await shaders.register("radar/q3ctf1.tga", { kind: "unlit", lightmapIndex: -4, mipmap: false });
    expect(generic.material.compiled).toBe(missing);
    expect(shaders.sourceWorldMaterial(missing)).toBe(shaders.sourceMaterials.default);
    const valid = await shaders.registerSourcePicture("icons/present");
    if (valid === null) throw new Error("Valid shader registration failed");
    expect(valid.material.order).toBeGreaterThan(0);
    const beforeReplacement = registrations.snapshot();
    const replacement = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(replacement);
    expect(registrations.snapshot()).toEqual(beforeReplacement);
    shaders.commitReplacement(replacement);
    expect(shaders.sourceDefaultPicture.material.compiled).toBe(zero.material.compiled);
    expect(shaders.sourceDefaultPicture.material.order).toBe(zero.material.order);
    expect(await shaders.registerSourcePicture("radar/q3ctf1.tga")).toBeNull();
    expect((await shaders.registerSourcePicture("icons/present"))?.material.order).toBe(valid.material.order);
  } finally { textures.close(); replacementTextures.close(); }
});

test("scene shader registration follows admission across providers and deferred image completion", async () => {
  const registrations = new SceneMaterialRegistrations(), deferred = Promise.withResolvers<SceneAsset | null>();
  const images = new SceneImageRegistry({ identity: Symbol("registration"), session: createIdentityOwner("registration").session, generation: 0 });
  const firstTextures = new SceneTextureLoader(images, { read: () => deferred.promise });
  const secondTextures = new SceneTextureLoader(images, { read: async () => null });
  const first = new SceneShaderRegistry(firstTextures, registrations.provider("q3:classic:retail:first"));
  const second = new SceneShaderRegistry(secondTextures, registrations.provider("q3:classic:retail:second"));
  try {
    first.addScript("registration/same { sort 3 { map delayed.bmp } }\nregistration/early { sort 1 { map $whiteimage } }");
    second.addScript("registration/same { sort 3 { map $whiteimage } }");
    const pending = first.register("registration/same");
    expect(first.register("REGISTRATION/SAME.tga")).toBe(pending);
    const completedSecond = await second.register("registration/same");
    expect(registrations.snapshot()).toEqual([completedSecond]);
    deferred.resolve(asset(bmp(2, 2), "delayed.bmp"));
    const completedFirst = await pending;
    expect(completedFirst.registration).not.toBe(completedSecond.registration);
    expect(await first.register("registration/same")).toBe(completedFirst);
    const earlier = registrations.snapshot();
    expect(earlier).toEqual([completedFirst, completedSecond]);
    const low = await first.register("registration/early");
    expect(registrations.snapshot()).toEqual([low, completedFirst, completedSecond]);
    expect(earlier).toEqual([completedFirst, completedSecond]);
  } finally { firstTextures.close(); secondTextures.close(); images.close(); }
});

test("source bootstrap publishes real internal materials before scripts and preserves handles through reload", async () => {
  const textures = loader(new Map<string, SceneAsset>()), replacementTextures = loader(new Map<string, SceneAsset>());
  const registrations = new SceneMaterialRegistrations();
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:retail:bootstrap"));
  try {
    let scriptLoads = 0;
    await shaders.initializeSourceMaterials(async () => {
      scriptLoads++;
      expect(registrations.snapshot().map(material => material.registered.definition.name))
        .toEqual(["*default", "<stencil shadow>"]);
      shaders.addScript("projectionShadow { sort 9 { map $whiteimage blendFunc add } }\nflareShader { sort 9 { map $whiteimage blendFunc add } }\nsun { sort 9 { map $whiteimage blendFunc add } }");
    });
    const original = shaders.sourceMaterials;
    expect((await shaders.register("")).registration).toBe(original.default.registration);
    const builtins = [original.default, original.stencilShadow, original.projectionShadow, original.flare, original.sun];
    expect(new Set(builtins.map(material => material.registration)).size).toBe(5);
    expect(registrations.snapshot().filter(material => material.finished.sort === 9))
      .toEqual([original.projectionShadow, original.flare, original.sun]);
    await shaders.initializeSourceMaterials(async () => { scriptLoads++; });
    expect(scriptLoads).toBe(1);
    const before = registrations.snapshot();
    const replacement = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(replacement);
    expect(registrations.snapshot()).toEqual(before);
    shaders.commitReplacement(replacement);
    for (const key of ["default", "stencilShadow", "projectionShadow", "flare", "sun"] satisfies readonly (keyof typeof original)[])
      expect(shaders.sourceMaterials[key]).toBe(original[key]);
    expect((await shaders.register("")).registration).toBe(original.default.registration);
    expect(registrations.snapshot()).toHaveLength(5);
  } finally { textures.close(); replacementTextures.close(); }
});

test("source replacement rejects a live lookup still waiting for image resolution", async () => {
  const started = Promise.withResolvers<void>(), held = Promise.withResolvers<SceneAsset | null>();
  const images = new SceneImageRegistry({ identity: Symbol("pending-source"), session: createIdentityOwner("pending-source").session, generation: 0 });
  const textures = new SceneTextureLoader(images, { read: async name => {
    if (name.startsWith("pending-source")) { started.resolve(); return held.promise; }
    return null;
  } });
  const replacementTextures = loader(new Map<string, SceneAsset>()), registrations = new SceneMaterialRegistrations();
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:retail:pending"));
  try {
    await shaders.initializeSourceMaterials(async () => {});
    const replacement = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(replacement);
    const before = registrations.snapshot(), pending = shaders.register("pending-source.bmp");
    await started.promise;
    try {
      expect(() => shaders.validateReplacement(replacement)).toThrow("pending");
      expect(registrations.snapshot()).toEqual(before);
    } finally { held.resolve(asset(bmp(2, 2), "pending-source.bmp")); await pending; replacement.discardReplacement(); }
    expect(registrations.snapshot()).toHaveLength(before.length + 1);
  } finally { textures.close(); replacementTextures.close(); images.close(); }
});

test("scene shader registration keeps retained pictures isolated until replacement commit and discards failed stages", async () => {
  const registrations = new SceneMaterialRegistrations();
  const images = new SceneImageRegistry({ identity: Symbol("retained-registration"), session: createIdentityOwner("retained-registration").session, generation: 0 });
  const textures = new SceneTextureLoader(images, { read: async name => asset(bmp(2, 2), name) });
  const replacementTextures = new SceneTextureLoader(images, { read: async name => asset(bmp(4, 4), name) });
  const failedTextures = new SceneTextureLoader(images, { read: async () => { throw new Error("replacement image failed"); } });
  const shaders = new SceneShaderRegistry(textures, registrations.provider("q3:classic:retail:retained"));
  try {
    shaders.addScript("registration/picture { sort 3 { map registration/picture.bmp } }");
    const picture = await shaders.registerPicture("registration/picture"), original = await shaders.register("registration/picture", { kind: "unlit", lightmapIndex: -4, mipmap: false });
    expect(picture.material.compiled).toBe(original);
    const content = original.registered, before = registrations.snapshot();
    const failed = shaders.replacement(failedTextures);
    await expect(shaders.prepareReplacement(failed)).rejects.toThrow("replacement image failed");
    failed.discardReplacement();
    expect(original.registered).toBe(content); expect(registrations.snapshot()).toEqual(before);
    const discarded = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(discarded);
    const discardedNew = await discarded.register("registration/discarded.bmp");
    discarded.discardReplacement();
    expect(original.registered).toBe(content); expect(registrations.snapshot()).toEqual(before);
    const replacement = shaders.replacement(replacementTextures);
    await shaders.prepareReplacement(replacement);
    const stagedPicture = await replacement.register("registration/picture", { kind: "unlit", lightmapIndex: -4, mipmap: false });
    expect(stagedPicture.registration).toBe(original.registration);
    expect(stagedPicture.registered).not.toBe(content);
    const stagedNew = await replacement.register("registration/staged.bmp");
    const live = await shaders.register("registration/live.bmp");
    expect(registrations.snapshot()).toEqual([original, live]);
    shaders.commitReplacement(replacement);
    expect(original.registered).not.toBe(content);
    expect((await shaders.registerPicture("registration/picture")).material.compiled).toBe(original);
    expect((await shaders.registerPicture("registration/picture")).material.order).toBe(picture.material.order);
    const publishedNew = await shaders.register("registration/staged.bmp");
    expect(publishedNew.registration).toBe(stagedNew.registration);
    expect(registrations.snapshot()).toEqual([original, live, publishedNew]);
    const later = await shaders.register("registration/discarded.bmp");
    expect(later.registration).not.toBe(discardedNew.registration);
    expect(registrations.snapshot()).toEqual([original, live, publishedNew, later]);
  } finally { textures.close(); replacementTextures.close(); failedTextures.close(); images.close(); }
});

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

test("native user images retain authored picture and wall dimensions", async () => {
  const colors = new Uint8Array(768), palette = { colors, source: reference("palette", colors) };
  const qpic = (width: number, height: number): Uint8Array => {
    const bytes = new Uint8Array(8 + width * height), view = new DataView(bytes.buffer);
    view.setUint32(0, width, true); view.setUint32(4, height, true); return bytes;
  };
  const wal = (size: number): Uint8Array => {
    const bytes = new Uint8Array(100 + size * size * 85 / 64), view = new DataView(bytes.buffer);
    view.setUint32(32, size, true); view.setUint32(36, size, true);
    let offset = 100;
    for (let mip = 0; mip < 4; mip++) { view.setUint32(40 + mip * 4, offset, true); offset += (size >> mip) ** 2; }
    return bytes;
  };
  const fixtures = [
    { path: "pics/icon.pcx", family: "q2", usage: "picture", original: encodePcx({ width: 2, height: 3, indices: new Uint8Array(6) }, colors), replacement: encodePcx({ width: 8, height: 8, indices: new Uint8Array(64) }, colors), width: 2, height: 3 },
    { path: "gfx/icon.lmp", family: "q1", usage: "picture", original: qpic(2, 3), replacement: qpic(8, 8), width: 2, height: 3 },
    { path: "textures/wall.wal", family: "q2", usage: "wall", original: wal(16), replacement: wal(32), width: 16, height: 16 },
  ] satisfies readonly { path: string; family: "q1" | "q2"; usage: "picture" | "wall"; original: Uint8Array; replacement: Uint8Array; width: number; height: number }[];
  for (const fixture of fixtures) {
    const images = new SceneImageRegistry({ identity: Symbol("native-size"), session: createIdentityOwner("native-size").session, generation: 0 });
    const files = new Map([[fixture.path, asset(fixture.replacement, "user")]]);
    const textures = new SceneTextureLoader(images, { read: async path => files.get(path) ?? null,
      readOriginal: async path => path === fixture.path ? asset(fixture.original, "authored") : null }, palette);
    try {
      const loaded = await textures.load(fixture.path, { family: fixture.family, usage: fixture.usage, mipmap: false });
      expect([loaded?.width, loaded?.height]).toEqual([fixture.width, fixture.height]);
      expect(loaded?.image.width).toBe(fixture.usage === "wall" ? 32 : 8);
      if (fixture.usage === "wall") {
        files.set("textures/wall.bmp", asset(bmp(64, 64), "truecolor-user"));
        const replaced = await textures.load("textures/wall", { family: "q2", usage: "wall", mipmap: false });
        expect([replaced?.width, replaced?.height, replaced?.image.width]).toEqual([16, 16, 64]);
      }
    } finally { textures.close(); images.close(); }
  }
});

test.skipIf(process.env["QUAKE_IMAGE_HUD"] !== "1")("actual weapon HUD keeps authored icon aspect across replacement refresh", async () => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises"), { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { loadApplicationContent } = await import("../../src/app/bootstrap/content.ts");
  const { parseApplicationCommand } = await import("../../src/app/bootstrap/options.ts");
  const { ApplicationAssets } = await import("../../src/app/bootstrap/assets.ts");
  const { ApplicationWeaponHudAssets } = await import("../../src/app/bootstrap/weapon-hud.ts");
  const users = await mkdtemp(join(tmpdir(), "weapon-hud-aspect-"));
  try {
    const pictures = join(users, "q2/baseq2/pics"); await mkdir(pictures, { recursive: true });
    await Bun.write(join(pictures, "w_blaster.bmp"), bmp(8, 4));
    const parsed = parseApplicationCommand(["--content-root", "/home/buzzkill/Projects/qfiles", "--user-content-root", users,
      "--game", "q2-classic-baseq2", "--map", "base1", "--dedicated"]);
    if (parsed.kind !== "run") throw new Error("Missing installed HUD content options");
    const content = await loadApplicationContent(parsed.options);
    const owner = { identity: Symbol("hud-aspect"), session: createIdentityOwner("hud-aspect").session, generation: 0 };
    const assets = new ApplicationAssets(content, owner), replacement = new ApplicationAssets(content, owner);
    try {
      const source = content.recipe.map.geometryContent, provider = await assets.provider(source);
      const original = await provider.mounts.open("pics/w_blaster.pcx");
      if (original === null) throw new Error("Missing installed blaster HUD icon");
      const authored = decodePcx(original.bytes), hud = new ApplicationWeaponHudAssets(assets);
      const id = await hud.load({ kind: "image", resource: { content: source, path: "pics/w_blaster.pcx" } });
      const before = hud.picture(id);
      if (before?.kind !== "image") throw new Error("HUD icon did not load shared image");
      expect([before.image.width, before.image.height]).toEqual([8, 4]);
      expect(hud.aspect(id)).toBe(authored.width / authored.height);
      await Bun.write(join(pictures, "w_blaster.bmp"), bmp(4, 8));
      const publish = await hud.prepareImageRefresh(replacement);
      expect(hud.picture(id)).toBe(before);
      expect(hud.aspect(id)).toBe(authored.width / authored.height);
      publish();
      const after = hud.picture(id);
      if (after?.kind !== "image") throw new Error("HUD refresh lost shared image");
      expect([after.image.width, after.image.height]).toEqual([4, 8]);
      expect(hud.aspect(id)).toBe(authored.width / authored.height);
    } finally { replacement.close(); assets.close(); await content.close(); }
  } finally { await rm(users, { recursive: true, force: true }); }
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
  const images = new SceneImageRegistry(owner), renderer = await NativeRenderer.open({ renderer: backend, width: 320, height: 240, hidden: true, gamma: 1 }, owner);
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
    const shaders = new SceneShaderRegistry(worldTextures, new SceneMaterialRegistrations().provider("q3:classic:retail:test")), world = await WorldScene.load(decodeQ2Map(await required("maps/base1.bsp")), shaders);
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
      const batches = sceneModelBatches(scene.prepare([entity], input, options));
      expect(batches.some(batch => batch.texture.kind === "bind-image" && batch.texture.image.source.kind === "generated" && batch.texture.image.source.name === sourceName)).toBe(true);
      const texture = await textures.load(`${custom}.pcx`, { family: "q2", usage: "skin" });
      expect([texture?.width, texture?.height]).toEqual([decodePcx(skinBytes).width, decodePcx(skinBytes).height]);
      frames.begin(); frames.view({ target: input.target, time: input.time, viewport: camera.viewport, clear: input.clear, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
      const capture = renderer.captureNextFrame().then(frame => frame.pixels); renderer.execute(frames.finish()); const pixels = await capture;
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
