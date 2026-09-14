import { SceneMaterialRegistrations } from "../../src/render/scene/material-registrations.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { ImageResourceOperation } from "../../src/contracts/render.ts";
import { SceneImageRegistry, SceneTextureLoader, SceneShaderRegistry } from "../../src/render/scene/index.ts";
import type { SceneAsset } from "../../src/render/scene/textures.ts";
import { decodeGif, encodePng } from "../../src/formats/images/index.ts";
import { NativeRenderer } from "../../src/app/bootstrap/renderer.ts";
import { SceneFrameBuilder } from "../../src/render/commands/frame.ts";
import { prepareMaterialText } from "../../src/render/commands/material2d.ts";
import { RendererNoise } from "../../src/materials/deform.ts";
import type { MaterialDrawContext } from "../../src/materials/evaluate.ts";
import { DEFAULT_SHADER_PROFILE } from "../../src/materials/compile.ts";

const fixture = new Uint8Array([71, 73, 70, 56, 57, 97, 2, 0, 2, 0, 129, 0, 0, 10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 33, 255, 11, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 3, 1, 0, 0, 0, 33, 249, 4, 0, 10, 0, 0, 0, 44, 0, 0, 0, 0, 2, 0, 2, 0, 0, 8, 6, 0, 1, 8, 4, 16, 16, 0, 33, 249, 4, 1, 10, 0, 1, 0, 44, 0, 0, 0, 0, 2, 0, 2, 0, 129, 40, 50, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 1, 8, 4, 16, 16, 0, 33, 249, 4, 1, 10, 0, 1, 0, 44, 0, 0, 0, 0, 2, 0, 2, 0, 129, 70, 80, 90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 6, 0, 1, 8, 4, 16, 16, 0, 59]);
const context: MaterialDrawContext = {
  time: 2, timeOffset: 0, refdefTime: 2000, identityLight: 1, entityRGBA: { x: 255, y: 255, z: 255, w: 255 },
  lighting: null, viewOrigin: { x: 0, y: 0, z: 10 }, localViewOrigin: { x: 0, y: 0, z: 10 }, noise: new RendererNoise(),
  shaderTexCoord: { x: 0, y: 0 }, deformView: { axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    mirror: false, entityAxis: null, nonNormalizedAxis: null }, projectionShadow: null, renderText: [], depthRange: [0, 1], polygonOffset: null,
  fog: null, project(position) { return { ...position, w: 1 }; },
};
function setup() {
  let now = 0, samples = 0;
  const identity = createIdentityOwner("animated-images"), owner = { identity: Symbol("animated-images"), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner, { sample: () => { samples++; return now; } });
  const textures = new SceneTextureLoader(images, { read: async name => name.endsWith(".gif")
    ? { bytes: fixture, source: { kind: "generated", name } } : null });
  return { images, textures, setTime(value: number) { now = value; }, samples: () => samples };
}

for (const family of ["q1", "q2", "q3"] satisfies readonly ("q1" | "q2" | "q3")[]) test(`shared ${family} GIF timing, mips, sampling and lifetime`, async () => {
  const { images, textures, setTime, samples } = setup();
  const texture = await textures.load("logo", { family });
  if (texture === null) throw new Error("GIF fallback missing");
  expect(await textures.load("logo", { family })).toBe(texture);
  const sampled = await textures.sampleSurface(texture, { mipmap: false, wrap: "clamp" });
  expect(await textures.sampleSurface(texture, { mipmap: false, wrap: "clamp" })).toBe(sampled);
  expect(sampled.image.source).toBe(texture.image.source);
  const created = images.drainOperations();
  expect(created.some(op => op.kind === "create-image" && op.image === sampled.image && op.sampling.wrap === "clamp" && op.content.levels.length === 1)).toBe(true);
  const before = samples(); setTime(99); expect(images.drainOperations()).toHaveLength(0); expect(samples()).toBe(before + 1);
  setTime(100); const updated = images.drainOperations().filter(op => op.kind === "update-image");
  expect(updated).toHaveLength(3);
  expect(updated.filter(op => op.image === texture.image).map(op => op.level)).toEqual([0, 1]);
  expect(updated.find(op => op.image === sampled.image)?.content.pixels.slice(0, 4)).toEqual(new Uint8Array(family === "q2" ? [80, 100, 120, 255] : [40, 50, 60, 255]));
  expect(texture.content.levels[0].pixels.slice(0, 4)).toEqual(new Uint8Array(family === "q2" ? [20, 40, 60, 255] : [10, 20, 30, 255]));
  setTime(300); expect(images.drainOperations().filter(op => op.kind === "update-image")[0]?.content.pixels).toEqual(texture.content.levels[0].pixels);
  images.release(texture.image); images.drainOperations(); setTime(400);
  expect(images.drainOperations().filter(op => op.kind === "update-image").map(op => op.image)).toEqual([sampled.image]);
  textures.close(); setTime(500); expect(images.drainOperations()).toHaveLength(0);
  expect(() => textures.load("late.gif")).toThrow("closed");
  images.close(); images.drainOperations(); expect(images.drainOperations()).toHaveLength(0);
  expect(() => images.allocate(1, 1, { kind: "generated", name: "late" })).toThrow("closed");
});

test("GIF metadata does not override the donor's fixed infinite beat", async () => {
  const bytes = fixture.slice();
  for (let index = 0; index < bytes.length - 4; index++) {
    if (bytes[index] === 33 && bytes[index + 1] === 249 && bytes[index + 2] === 4) bytes[index + 4] = 99;
    if (bytes[index] === 3 && bytes[index + 1] === 1 && bytes[index + 2] === 0 && bytes[index + 3] === 0 && bytes[index + 4] === 0) bytes[index + 2] = 2;
  }
  expect(decodeGif(bytes).loopCount).toBe(2);
  expect(decodeGif(bytes).frames[0].delayCentiseconds).toBe(99);
  const { images, setTime } = setup();
  const textures = new SceneTextureLoader(images, { read: async () => ({ bytes, source: { kind: "generated", name: "metadata.gif" } }) });
  await textures.load("metadata.gif", { mipmap: false }); images.drainOperations();
  setTime(3100);
  const update = images.drainOperations().find(operation => operation.kind === "update-image");
  expect(update?.content.pixels.slice(0, 4)).toEqual(new Uint8Array([40, 50, 60, 255]));
  textures.close(); images.close();
});

test("pending GIF reads cannot register after loader or registry close", async () => {
  for (const closeLoader of [true, false]) {
    const { images } = setup();
    const pending = Promise.withResolvers<SceneAsset | null>();
    const textures = new SceneTextureLoader(images, { read: () => pending.promise });
    images.drainOperations();
    const loading = textures.load("late.gif");
    if (closeLoader) textures.close(); else images.close();
    pending.resolve({ bytes: fixture, source: { kind: "generated", name: "late.gif" } });
    await expect(loading).rejects.toThrow("closed");
    expect(images.drainOperations().some(op => op.kind === "create-image")).toBe(false);
    textures.close(); images.close();
  }
});

const root = new URL("../../../qfiles/q3a/lrctf", import.meta.url).pathname;
for (const asset of ["media/lrctf_logo-small_animated.gif", "help/images/flaming_logo.gif"])
for (const family of ["q1", "q2", "q3"] satisfies readonly ("q1" | "q2" | "q3")[])
for (const rendererKind of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[])
test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen" || !existsSync(`${root}/${asset}`))(`installed ${asset} shared ${family} material ${rendererKind}`, async () => {
  const bytes = new Uint8Array(await Bun.file(`${root}/${asset}`).arrayBuffer()), gif = decodeGif(bytes, asset);
  expect(gif.frames.length).toBeGreaterThan(1);
  let now = 0;
  const identity = createIdentityOwner("installed-gif"), owner = { identity: Symbol("installed-gif"), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner, { sample: () => now });
  const textures = new SceneTextureLoader(images, { read: async path => path === asset ? { bytes, source: { kind: "generated", name: path } } : null });
  const shaders = new SceneShaderRegistry(textures, new SceneMaterialRegistrations().provider("q3:classic:retail:test"), DEFAULT_SHADER_PROFILE, undefined, family);
  const picture = await shaders.registerPicture(asset), width = gif.width, height = gif.height;
  const viewport = { x: 0, y: 0, width, height };
  const batches = prepareMaterialText({ seat: identity.seat(0), rect: viewport, uv: { s: 0, t: 0, s2: 1, t2: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, picture }, viewport, context);
  expect(batches.length).toBeGreaterThan(0);
  const renderer = NativeRenderer.open({ renderer: rendererKind, width, height, hidden: true, gamma: 1 }, owner);
  try {
    const frames = new SceneFrameBuilder(images), captures: Uint8Array[] = [];
    const operations: ImageResourceOperation[] = [];
    for (const time of [0, 500, 1200]) {
      now = time; frames.begin();
      frames.view({ target: { kind: "preview", id: "animated-image" }, time: { kind: "milliseconds", value: time }, viewport, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: true }, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
      const frame = frames.finish(true);
      operations.push(...frame.commands.flatMap(command => command.kind === "image-resource" ? [command.operation] : []));
      const capture = renderer.captureNextFrame(); renderer.execute(frame); const pixels = await capture; captures.push(pixels);
      if (process.env["QUAKE_SCENE_CAPTURE"] === "1") await Bun.write(`.artifacts/tmp/animated-images/${asset.split("/").at(-1)}-${family}-${rendererKind}-${time}.png`, encodePng(width, height, pixels));
    }
    expect(captures[0]).not.toEqual(captures[1]);
    expect(captures[1]).not.toEqual(captures[2]);
    expect(operations.some(op => op.kind === "update-image")).toBe(true);
    renderer.close();
    const restarted = NativeRenderer.open({ renderer: rendererKind, width, height, hidden: true, gamma: 1 }, owner);
    try {
      const replay = new SceneFrameBuilder(images); replay.begin(); replay.resources(operations);
      replay.view({ target: { kind: "preview", id: "animated-image-replay" }, time: { kind: "milliseconds", value: now }, viewport,
        clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: true }, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches }] });
      const capture = restarted.captureNextFrame(); restarted.execute(replay.finish(true));
      const expected = captures[2];
      if (expected === undefined) throw new Error("Missing final GIF capture");
      expect(await capture).toEqual(expected);
    } finally { restarted.close(); }
    textures.close(); images.close();
    expect(images.drainOperations().every(operation => operation.kind === "release-image")).toBe(true);
  } finally { textures.close(); images.close(); renderer.close(); }
});
