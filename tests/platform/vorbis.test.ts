// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VorbisDecoder, VorbisError } from "../../src/platform/vorbis.ts";

const fixture = process.env["QUAKE_TEST_OGG"]
  ?? new URL("../../../qfiles/q1/rerelease/id1/music/track02.ogg", import.meta.url).pathname;
const hasFixture = existsSync(fixture);
if (process.env["QUAKE_TEST_OGG"] !== undefined && !hasFixture) throw new Error(`Missing QUAKE_TEST_OGG: ${fixture}`);

test("invalid paths and malformed files reject without leaked native file descriptors", async () => {
  for (const path of ["", "music\0.ogg"]) expect(() => VorbisDecoder.open(path)).toThrow("path");
  const temporary = mkdtempSync(join(tmpdir(), "quake-vorbis-"));
  try {
    const invalid = join(temporary, "invalid.ogg");
    await Bun.write(invalid, new Uint8Array([79, 103, 103, 83, 0, 255, 0, 1]));
    expect(() => VorbisDecoder.open(invalid)).toThrow(VorbisError);
    const before = process.platform === "linux" ? readdirSync("/proc/self/fd").length : null;
    for (let index = 0; index < 20; index++) {
      expect(() => VorbisDecoder.open(invalid)).toThrow(VorbisError);
      expect(() => VorbisDecoder.open(join(temporary, "missing.ogg"))).toThrow(VorbisError);
    }
    if (before !== null) expect(readdirSync("/proc/self/fd").length).toBe(before);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test.skipIf(!hasFixture)("external OGG metadata, exact seeking, owned PCM and reopen", () => {
  const decoder = VorbisDecoder.open(fixture);
  try {
    const { metadata } = decoder;
    expect(metadata.sampleRate).toBeGreaterThanOrEqual(8000);
    expect(metadata.channels).toBeGreaterThanOrEqual(1);
    expect(metadata.totalFrames).toBeGreaterThan(4096);
    expect(metadata.durationSeconds).toBe(metadata.totalFrames / metadata.sampleRate);
    expect(Object.isFrozen(metadata)).toBe(true);
    const first = decoder.read(4096);
    if (first === null) throw new Error("OGG fixture decoded no PCM");
    expect(first.frames).toBe(4096);
    const retained = first.samples.slice();
    expect(decoder.positionFrames).toBe(4096);
    decoder.read(17);
    decoder.seek(0);
    const repeated = decoder.read(4096);
    if (repeated === null) throw new Error("OGG seek failed to restore PCM");
    expect(repeated.samples).toEqual(retained);
    expect(first.samples).toEqual(retained);
    decoder.seek(metadata.totalFrames - 7);
    expect(decoder.read(4096)?.frames).toBe(7);
    expect(decoder.read()).toBeNull();
    expect(decoder.positionFrames).toBe(metadata.totalFrames);
    decoder.seek(metadata.totalFrames);
    expect(decoder.read()).toBeNull();
    decoder.close(); decoder.close();
    expect(first.samples).toEqual(retained);
    expect(decoder.closed).toBe(true);
    expect(() => decoder.read()).toThrow("closed");
    expect(() => decoder.seek(0)).toThrow("closed");
    expect(() => decoder.positionFrames).toThrow("closed");
  } finally { decoder.close(); }
  const before = process.platform === "linux" ? readdirSync("/proc/self/fd").length : null;
  for (let index = 0; index < 8; index++) {
    using reopened = VorbisDecoder.open(fixture);
    expect(reopened.read(1)?.frames).toBe(1);
  }
  if (before !== null) expect(readdirSync("/proc/self/fd").length).toBe(before);
});

test.skipIf(!hasFixture)("external OGG decodes to its full native frame total", () => {
  using decoder = VorbisDecoder.open(fixture);
  let frames = 0, nonzero = false;
  while (true) {
    const chunk = decoder.read(65536);
    if (chunk === null) break;
    frames += chunk.frames;
    nonzero ||= chunk.samples.some(sample => sample !== 0);
  }
  expect(frames).toBe(decoder.metadata.totalFrames);
  expect(nonzero).toBe(true);
}, 15000);

test.skipIf(!hasFixture)("invalid read and seek bounds preserve decoder position", () => {
  using decoder = VorbisDecoder.open(fixture);
  for (const frames of [0, -1, 1.5, NaN, Infinity, 1048577])
    expect(() => decoder.read(frames)).toThrow("frame limit");
  for (const frame of [-1, NaN, Infinity, 0.5, decoder.metadata.totalFrames + 1])
    expect(() => decoder.seek(frame)).toThrow("seek frame");
  expect(decoder.positionFrames).toBe(0);
  expect(decoder.read(1)?.frames).toBe(1);
});
