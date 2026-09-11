import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { BinaryWriter } from "../../src/core/binary/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { RendererImage } from "../../src/contracts/render.ts";
import { openArchive } from "../../src/content/archive/index.ts";
import { CinDecoder, cinRgba, cinSampleRange } from "../../src/media/cin.ts";
import { CinPlayback } from "../../src/media/cin-playback.ts";
import { CinematicPlayback, cinematicBytes } from "../../src/media/playback.ts";
import { cinematicDimensions, FullscreenCinematic } from "../../src/media/presentation.ts";
import { MaterialCinematic } from "../../src/media/material.ts";
import { RoqDecoder } from "../../src/media/roq.ts";
import { RoqPlayback } from "../../src/media/roq-playback.ts";
import { openMediaFile } from "../../src/media/source.ts";
import { cinematicTransition } from "../../src/media/transitions.ts";
import type { CinematicAudio, CinematicEndReason, CinematicOptions } from "../../src/media/types.ts";

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
  const fullscreen = new FullscreenCinematic(playback, image);
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
  const material = new MaterialCinematic(playback, image);
  const call = material.prepareAtExecution();
  if (call === null) throw new Error("Missing first cinematic upload");
  expect(call.upload.kind).toBe("create-image");
  call.afterShaderUpload();
  expect(material.prepareAtExecution()).toBeNull();
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
