import { SoftwareRenderer, CpuRenderTarget } from "../../src/render/cpu/index.ts";
import { SceneImageRegistry } from "../../src/render/scene/resources.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { BinaryWriter } from "../../src/core/binary/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { DrawBatch, ImageResourceOperation, RenderCommand, RendererImage, TextureBinding } from "../../src/contracts/render.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { CinDecoder, cinRgba, cinSampleRange } from "../../src/media/cin.ts";
import { CinPlayback } from "../../src/media/cin-playback.ts";
import { CinematicPlayback, cinematicBytes } from "../../src/media/playback.ts";
import { cinematicDimensions, FullscreenCinematic, CinematicImage } from "../../src/media/presentation.ts";
import { MaterialCinematic } from "../../src/media/material.ts";
import { RoqDecoder } from "../../src/media/roq.ts";
import { RoqPlayback } from "../../src/media/roq-playback.ts";
import { openMediaFile } from "../../src/media/source.ts";
import { cinematicTransition } from "../../src/media/transitions.ts";
import type { CinematicAudio, CinematicEndReason, CinematicFrame, CinematicOptions } from "../../src/media/types.ts";

function shortCin(sampleRate = 22051): Uint8Array {
  const writer = new BinaryWriter(100000);
  for (const value of [2, 1, sampleRate, 1, 1]) writer.i32(value);
  const counts = new Uint8Array(65536);
  for (let context = 0; context < 256; context++) { counts[context * 256] = 1; counts[context * 256 + 1] = 1; }
  writer.bytes(counts);
  for (let frame = 0; frame < 4; frame++) {
    writer.i32(frame === 0 ? 1 : 0);
    if (frame === 0) {
      const palette = new Uint8Array(768);
      palette[0] = 255; palette[4] = 255;
      writer.bytes(palette);
    }
    writer.i32(5); writer.i32(2); writer.u8(frame % 2 === 0 ? 2 : 1);
    const { start, end } = cinSampleRange(frame, sampleRate);
    writer.bytes(new Uint8Array(end - start).fill(128 + frame));
  }
  writer.i32(2);
  return writer.finish();
}

test("RoQ decodes stereo deltas and holds the final frame on its source clock", () => {
  const writer = new BinaryWriter(256);
  writer.u16(0x1084); writer.u32(0xffffffff); writer.u16(30);
  const chunk = (id: number, data: readonly number[], flags = 0): void => {
    writer.u16(id); writer.u32(data.length); writer.u16(flags); writer.bytes(Uint8Array.from(data));
  };
  chunk(0x1021, [1, 2, 3, 4], 0x0102);
  chunk(0x1001, [8, 0, 8, 0, 8, 0, 4, 0]);
  chunk(0x1002, [0, 0, 0, 0, 128, 128, 0, 0, 0, 0], 0x0101);
  chunk(0x1011, [0, 128, 0]);
  chunk(0x1013, []);
  const bytes = writer.finish();
  const event = new RoqDecoder(bytes).next();
  if (event.kind !== "audio") throw new Error("Missing RoQ stereo block");
  expect(Array.from(event.samples)).toEqual([257, 516, 266, 532]);
  expect(event.channels).toBe(2);
  const clock = { time: 0, sample(): number { return this.time; } };
  const playback = new RoqPlayback(bytes, { clock, hold: true, onAudio: () => undefined, developerPrint: () => undefined });
  playback.run(clock);
  clock.time = 34; expect(playback.run(clock).update.kind).toBe("frame");
  clock.time = 67; expect(playback.run(clock).status).toBe("held");
  expect(playback.currentFrame?.rgba.length).toBe(8 * 8 * 4);
});

test("CIN keeps integer frame and sample boundaries, palette colors, and source prefetch order", () => {
  expect(cinSampleRange(13, 22051)).toEqual({ start: 20475, end: 22051 });
  const decoder = new CinDecoder(shortCin());
  const first = decoder.next();
  if (first.kind !== "frame") throw new Error("Expected first CIN frame");
  expect(Array.from(cinRgba(first.pixels, first.palette))).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  expect(first.audio?.sourceSample).toBe(0);
  expect(first.audio?.samples.length).toBe(1575);
  decoder.close();
  const clock = { time: 0, sample(): number { return this.time; } };
  const audio: CinematicAudio[] = [];
  const playback = new CinPlayback(shortCin(), { clock, onAudio: block => { audio.push(block); } });
  clock.time = 142; expect(playback.run(clock).update.kind).toBe("unchanged");
  clock.time = 143;
  const blank = playback.run(clock);
  expect(blank.update.kind === "frame" && blank.update.frame === null).toBe(true);
  expect(audio.map(block => block.sourceSample)).toEqual([0, 1575]);
  clock.time = 215;
  const next = playback.run(clock);
  expect(next.update.kind === "frame" ? next.update.frame?.index : -1).toBe(1);
  playback.close();
});

test("fullscreen CIN pauses its clock and audio, targets a second seat, and completes its transition once", () => {
  const identity = createIdentityOwner("media-smoke");
  const seat = identity.seat(1);
  const clock = { time: 0, sample(): number { return this.time; } };
  const completed: CinematicEndReason[] = [], paused: boolean[] = [], commands: string[] = [];
  const transition = cinematicTransition(seat, { kind: "q2-nextserver", serverCount: 7 }, {
    sendClientCommand(target, command) { expect(target.equals(seat)).toBe(true); commands.push(command); },
    appendCommand() { throw new Error("Unexpected Q3 command"); },
    leaveCinematic(target) { expect(target.equals(seat)).toBe(true); },
  });
  const options: CinematicOptions = { clock, target: { kind: "seat", seat },
    onAudio: () => {}, onAudioReset: () => {}, onAudioPause: value => { paused.push(value); },
    onComplete(reason) { completed.push(reason); transition(reason); } };
  const source = cinematicBytes("cin", shortCin());
  expect(cinematicDimensions(source)).toEqual({ width: 2, height: 1 });
  const playback = new CinematicPlayback(source, options);
  const image: RendererImage = { owner: { identity: Symbol("render"), session: identity.session, generation: 0 },
    ordinal: 1, source: { kind: "generated", name: "cinematic:test" }, width: 2, height: 1 };
  const fullscreen = new FullscreenCinematic(playback, image, (width, height, source) => ({ ...image, ordinal: image.ordinal + 1, width, height, source }));
  const viewport = { x: 400, y: 0, width: 400, height: 300 };
  const draw = fullscreen.prepare(viewport);
  expect(draw.seat.equals(seat)).toBe(true);
  expect(draw.commands.map(command => command.kind)).toEqual(["image-resource", "set-color", "stretch-pic"]);
  draw.complete();
  clock.time = 100; playback.pause(true);
  clock.time = 1000; expect(playback.playbackTimeMilliseconds).toBe(100);
  expect(playback.tick().status).toBe("paused");
  playback.pause(false);
  clock.time = 1050; expect(playback.playbackTimeMilliseconds).toBe(150);
  playback.skip(); playback.skip();
  expect(paused).toEqual([true, false]);
  expect(completed).toEqual(["skipped"]);
  expect(commands).toEqual(["nextserver 7\n"]);
  expect(fullscreen.close()?.kind).toBe("release-image");
});

test("material uploads acknowledge execution and OGV reports the missing decoder", () => {
  const identity = createIdentityOwner("material-media");
  const options: CinematicOptions = { clock: { sample: () => 0 }, target: { kind: "material", id: "wall" },
    onAudio: () => {}, onAudioReset: () => {}, onAudioPause: () => {}, onComplete: () => {} };
  const playback = new CinematicPlayback(cinematicBytes("cin", shortCin()), options);
  const image: RendererImage = { owner: { identity: Symbol("render"), session: identity.session, generation: 0 }, ordinal: 0,
    source: { kind: "generated", name: "wall" }, width: 2, height: 1 };
  const registry = new SceneImageRegistry(image.owner);
  const first = registry.allocate(image.width, image.height, image.source);
  const material = new MaterialCinematic(playback, first, (width, height, source) => registry.allocate(width, height, source));
  const operations: string[] = [];
  material.resolve(operation => { operations.push(operation.kind); });
  expect(operations).toEqual(["create-image"]);
  material.resolve(operation => { operations.push(operation.kind); });
  expect(operations).toEqual(["create-image"]);
  expect(material.close()?.kind).toBe("release-image");
  expect(() => new CinematicPlayback({ format: "ogv", source: "intro.ogv" }, options)).toThrow("not implemented yet");
});

const corpus = "/home/buzzkill/Projects/qfiles";
const cinPath = `${corpus}/q2/baseq2/video/idlog.cin`;
test.skipIf(!existsSync(cinPath))("retail Q2 CIN and expansion movies decode real video and PCM", () => {
  for (const [name, width, height, channels] of [
    ["q2/baseq2/video/idlog.cin", 320, 240, 2],
    ["q2/xatrix/video/xin.cin", 256, 256, 1],
    ["q2/rogue/video/rintro.cin", 320, 240, 1],
  ] satisfies readonly [string, number, number, 1 | 2][]) {
    const decoder = new CinDecoder(openMediaFile(`${corpus}/${name}`));
    try {
      expect([decoder.width, decoder.height]).toEqual([width, height]);
      for (let index = 0; index < 8; index++) {
        const frame = decoder.next();
        if (frame.kind !== "frame") throw new Error(`Early cinematic end: ${name}`);
        expect(frame.pixels.length).toBe(width * height);
        expect(frame.palette.length).toBe(768);
        expect(frame.audio?.sourceSample).toBe(index * 1575);
        expect(frame.audio?.channels).toBe(channels);
        expect(frame.audio?.samples.length).toBe(1575 * channels);
      }
      decoder.rewind();
      const rewound = decoder.next();
      expect(rewound.kind === "frame" ? rewound.index : -1).toBe(0);
    } finally { decoder.close(); }
  }
});

const roqArchive = `${corpus}/q3a/missionpack/pak0.pk3`;
test.skipIf(!existsSync(roqArchive))("Team Arena RoQ reads from PK3 and decodes actual frame/codebook data", async () => {
  const archive = await openArchive(roqArchive);
  try {
    const entry = archive.findEntries("video/mpintro.roq")[0];
    if (entry === undefined) throw new Error("Missing Team Arena intro");
    const bytes = await archive.readEntry(entry);
    const source = cinematicBytes("roq", bytes, entry.path);
    expect(cinematicDimensions(source)).toEqual({ width: 256, height: 256 });
    const decoder = new RoqDecoder(bytes, entry.path);
    const hashes: string[] = [];
    while (hashes.length < 3) {
      const event = decoder.next();
      if (event.kind === "end") throw new Error("Unexpected intro EOF");
      if (event.kind === "frame") hashes.push(new Bun.CryptoHasher("sha256").update(event.rgba).digest("hex"));
    }
    expect(hashes).toEqual([
      "6f85c33acc70dcca64865c7f9c28122e23546f6640d7d585916141fb575d3d23",
      "d3ab279ad9bfe65174d02b92db849635027152ce1150d6e045fffc08e5aa6346",
      "e0c09a33d4b22c4df19b4f33d3023392b94774f8cfd16a24fa055e1c7bd4e21f",
    ]);
  } finally { archive.close(); }
});



function movieQuad(texture: TextureBinding): DrawBatch {
  return { primitive: "triangles", texturing: "single", lighting: { kind: "vertex" }, texture,
    vertices: [{ position: { x: -1, y: -1, z: 0, w: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, texCoord: { x: 0, y: 0 } },
      { position: { x: 1, y: -1, z: 0, w: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, texCoord: { x: 1, y: 0 } },
      { position: { x: 1, y: 1, z: 0, w: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, texCoord: { x: 1, y: 1 } },
      { position: { x: -1, y: 1, z: 0, w: 1 }, color: { x: 1, y: 1, z: 1, w: 1 }, texCoord: { x: 0, y: 1 } }], indices: [0, 1, 2, 0, 2, 3],
    state: { blend: { source: "one", destination: "zero" }, depthTest: "always", depthWrite: false, alphaTest: "none", cull: "none", depthRange: [0, 1], polygonOffset: null } };
}

test("dynamic movie textures resolve in draw order, resize once and retry a failed creation", () => {
  const identity = createIdentityOwner("cinematic-resize"), owner = { identity: Symbol("cinematic-resize"), session: identity.session, generation: 0 };
  const images = new SceneImageRegistry(owner), initial = images.allocate(1, 1, { kind: "generated", name: "resize" });
  const texture = new CinematicImage(initial, (width, height, source) => images.allocate(width, height, source));
  const backend = new SoftwareRenderer(8, 8, owner), target = new CpuRenderTarget(backend);
  const operations: ImageResourceOperation[] = [];
  const apply = (operation: ImageResourceOperation): void => { backend.applyImageResource(operation); images.commit(operation); operations.push(operation); };
  const frame = (width: number, red: boolean): CinematicFrame => ({ width, height: 1, index: width, loop: 0, sourceTime: 0, time: 0,
    rgba: Uint8Array.from(Array.from({ length: width }, () => red ? [255, 0, 0, 255] : [0, 255, 0, 255]).flat()) });
  let sourceFrame = frame(1, true), revision = 0;
  let nextDraw = 0;
  const source = { resolve: (upload: (operation: ImageResourceOperation) => void) => {
    sourceFrame = frame(nextDraw + 1, nextDraw === 0); revision = nextDraw++;
    return texture.resolve(sourceFrame, revision, operation => { upload(operation); images.commit(operation); operations.push(operation); });
  } };
  const batch = movieQuad({ kind: "dynamic-image", source });
  try {
    const queued = [batch, batch];
    expect(operations).toHaveLength(0);
    target.execute({ owner, sequence: 0, commands: queued.map((draw, index): RenderCommand => ({ kind: "view", view: {
      target: { kind: "preview", id: `resize-${index}` }, time: { kind: "milliseconds", value: 0 },
      viewport: { x: index * 4, y: 0, width: 4, height: 8 }, clear: { color: null, depth: 1, stencil: false }, clipPlane: null,
      beforeView: [], operations: [{ kind: "draw", batches: [draw] }] } })) });
    for (const index of [0, 1]) {
      const pixel = (4 * 8 + index * 4 + 2) * 4;
      expect(backend.pixels[pixel + index]).toBeGreaterThan(0);
      expect(backend.pixels[pixel + 1 - index]).toBe(0);
      expect(backend.pixels[pixel + 2]).toBe(0);
    }
    expect(operations.map(operation => operation.kind)).toEqual(["create-image", "release-image", "create-image"]);
    expect(texture.image.ordinal).not.toBe(initial.ordinal);
    sourceFrame = frame(3, true); revision = 2;
    let fail = true;
    const flaky = (operation: ImageResourceOperation): void => {
      if (operation.kind === "create-image" && fail) { fail = false; throw new Error("injected upload failure"); }
      apply(operation);
    };
    expect(() => texture.resolve(sourceFrame, revision, flaky)).toThrow("injected upload failure");
    const releases = operations.filter(operation => operation.kind === "release-image").length;
    texture.resolve(sourceFrame, revision, flaky);
    expect(operations.filter(operation => operation.kind === "release-image")).toHaveLength(releases);
    expect(texture.image.width).toBe(3);
    sourceFrame = frame(3, false); revision = 3;
    expect(() => texture.resolve(sourceFrame, revision, operation => {
      expect(() => texture.resolve(sourceFrame, revision, apply)).toThrow("cannot reenter");
      expect(() => texture.release()).toThrow("during upload");
      apply(operation);
    })).not.toThrow();
    expect(() => images.require(initial)).toThrow();
    const release = texture.release(); if (release !== null) apply(release);
    expect(texture.release()).toBeNull();
    images.close(); expect(images.drainOperations()).toHaveLength(0);
  } finally { target.close(); }
});

for (const rendererKind of ["cpu", "gl"] satisfies readonly ("cpu" | "gl")[]) test.skipIf(process.env["SDL_VIDEODRIVER"] !== "offscreen" || !existsSync("../qfiles/q3a/missionpack/pak0.pk3"))(`shipped Team Arena videoMap executes through shared ${rendererKind} world materials`, async () => {
  const { ApplicationAssets } = await import("../../src/app/bootstrap/assets.ts");
  const { loadApplicationContent } = await import("../../src/app/bootstrap/content.ts");
  const { parseApplicationCommand } = await import("../../src/app/bootstrap/options.ts");
  const { NativeRenderer } = await import("../../src/app/bootstrap/renderer.ts");
  const { SceneFrameBuilder } = await import("../../src/render/commands/frame.ts");
  const { anglesToAxis, vectorToAngles } = await import("../../src/core/math.ts");
  const { perspectiveProjection } = await import("../../src/render/scene/view.ts");
  const { encodePng } = await import("../../src/formats/images/png.ts");
  const parsed = parseApplicationCommand(["--content-root", "../qfiles", "--game", "q3-missionpack", "--map", "mpteam1", "--dedicated"]);
  if (parsed.kind !== "run") throw new Error("Missing Team Arena selection");
  const content = await loadApplicationContent(parsed.options);
  const identity = createIdentityOwner(`world-video-${rendererKind}`), owner = { identity: Symbol("world-video"), session: identity.session, generation: 0 };
  let now = 0;
  const assets = new ApplicationAssets(content, owner, { sample: () => now });
  const renderer = NativeRenderer.open({ renderer: rendererKind, width: 640, height: 400, hidden: true, gamma: 1 }, owner);
  const frames = new SceneFrameBuilder(assets.images);
  try {
    const world = content.world;
    if (world.kind !== "q3-bsp") throw new Error("Expected Q3 world");
    const surface = world.surfaces.find(surface => world.shaders[surface.shader]?.name === "textures/proto2/mpteam1");
    if (surface === undefined) throw new Error("Shipped movie surface missing");
    const vertices = world.vertices.slice(surface.vertices.first, surface.vertices.first + surface.vertices.count), first = vertices[0];
    if (first === undefined) throw new Error("Movie surface has no vertices");
    const center = vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.position.x / vertices.length, y: sum.y + vertex.position.y / vertices.length,
      z: sum.z + vertex.position.z / vertices.length }), { x: 0, y: 0, z: 0 });
    const normal = first.normal;
    const camera = { origin: { x: center.x + normal.x * 180, y: center.y + normal.y * 180, z: center.z + normal.z * 180 },
      axis: anglesToAxis(vectorToAngles({ x: -normal.x, y: -normal.y, z: -normal.z })), viewport: { x: 0, y: 0, width: 640, height: 400 },
      projection: perspectiveProjection(80, 55.41, 4096), clip: { kind: "none" } } satisfies import("../../src/contracts/render.ts").SceneCamera;
    const scene = await assets.loadWorld();
    const hashes: string[] = [];
    const decodedFrames: number[] = [];
    let sharedMovie: MaterialCinematic | null = null;
    for (const time of [0, 34, 68, 102, 136]) {
      now = time;
      frames.begin();
      const prepared = scene.prepareView({ camera, target: { kind: "preview", id: "authored-videoMap" }, time: { kind: "milliseconds", value: time },
        clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false } });
      const movies = prepared.view.operations.flatMap(operation => operation.kind === "draw" ? operation.batches : [])
        .filter(batch => batch.texture.kind === "dynamic-image" || batch.texturing === "pair" && batch.secondTexture.binding.kind === "dynamic-image");
      expect(movies.length).toBeGreaterThan(0);
      const source = movies.flatMap(batch => [batch.texture, ...(batch.texturing === "pair" ? [batch.secondTexture.binding] : [])])
        .find(binding => binding.kind === "dynamic-image");
      if (source?.kind !== "dynamic-image" || !(source.source instanceof MaterialCinematic)) throw new Error("Missing actual shared material movie");
      if (sharedMovie === null) sharedMovie = source.source; else expect(source.source).toBe(sharedMovie);
      frames.world(prepared);
      const capture = renderer.captureNextFrame();
      try { renderer.execute(frames.finish(true)); } catch (error: unknown) { renderer.close(); await capture.catch(() => undefined); throw error; }
      const pixels = await capture;
      if (time === 68 || time === 136) {
        hashes.push(new Bun.CryptoHasher("sha256").update(pixels).digest("hex"));
        const decoded = sharedMovie.playback.currentFrame;
        if (decoded === null) throw new Error("Actual movie frame was not decoded");
        decodedFrames.push(decoded.index);
        const provenance = sharedMovie.image.source;
        if (provenance.kind !== "resource") throw new Error("Material movie lost resource provenance");
        expect(provenance.resource.requestedPath).toBe("video/mpteam1.roq");
        expect(provenance.resource.provenance.mount.identity.content).toBe(content.recipe.presentation.assets);
      }
      if (process.env["QUAKE_SCENE_CAPTURE"] === "1" && (time === 68 || time === 136)) {
        await Bun.write(`.artifacts/tmp/world-video/${rendererKind}-${time}.png`, encodePng(640, 400, pixels));
        await Bun.write(`.artifacts/tmp/world-video/${rendererKind}.json`, JSON.stringify({ source: content.recipe.presentation.assets, shader: "textures/proto2/mpteam1",
          movie: "video/mpteam1.roq", camera, center, normal, times: [68, 136], decodedFrames }, null, 2));
      }
    }
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(decodedFrames[0]).not.toBe(decodedFrames[1]);
    // The standalone prepared-draw API must preserve its primary binding while uploading unit 1.
    const primary = assets.images.register("paired-primary", { kind: "rgba8", levels: [{ width: 1, height: 1, pixels: new Uint8Array([255, 0, 0, 255]) }],
      borderColor: { x: 1, y: 0, z: 0, w: 1 } }, { wrap: "clamp", filter: "nearest" });
    renderer.execute({ owner, sequence: 6, commands: assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
    const initial = assets.images.allocate(1, 1, { kind: "generated", name: "paired-secondary" });
    const image = new CinematicImage(initial, (width, height, source) => assets.images.allocate(width, height, source));
    const source = { resolve: (apply: (operation: ImageResourceOperation) => void) => image.resolve({ width: 1, height: 1,
      rgba: new Uint8Array([0, 255, 0, 255]), index: 0, loop: 0, sourceTime: 0, time: 0 }, 0, operation => { apply(operation); assets.images.commit(operation); }) };
    const quad = movieQuad({ kind: "bind-image", image: primary });
    if (quad.primitive !== "triangles" || quad.texturing !== "single") throw new Error("Expected quad geometry");
    const paired: DrawBatch = { ...quad, texturing: "pair", vertices: quad.vertices.map(vertex => ({ ...vertex, texCoord2: vertex.texCoord })),
      secondTexture: { binding: { kind: "dynamic-image", source }, environment: "add" } };
    renderer.backend.beginView({ viewport: camera.viewport, clear: { color: { x: 0, y: 0, z: 0, w: 1 }, depth: 1, stencil: false }, clipPlane: null });
    const draw = renderer.backend.prepareGeometry(paired);
    try { draw.begin(); draw.applyTexture(0, paired.texture); draw.applyTexture(1, paired.secondTexture.binding); draw.draw(); }
    finally { draw.cleanup(); }
    const pairCapture = renderer.captureNextFrame(); renderer.execute({ owner, sequence: 7, commands: [{ kind: "swap-buffers" }] });
    const pairPixels = await pairCapture, centerPixel = (200 * 640 + 320) * 4;
    expect(pairPixels[centerPixel]).toBeGreaterThan(200);
    expect(pairPixels[centerPixel + 1]).toBeGreaterThan(200);
    expect(pairPixels[centerPixel + 2]).toBe(0);
    image.release();
    assets.close();
    renderer.execute({ owner, sequence: 3, commands: assets.images.drainOperations().map(operation => ({ kind: "image-resource", operation })) });
    expect(assets.images.drainOperations()).toHaveLength(0);
  } finally { assets.close(); renderer.close(); await content.close(); }
}, 60000);
