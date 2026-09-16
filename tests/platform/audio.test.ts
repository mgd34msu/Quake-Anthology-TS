// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { SdlAudioDevice, SdlAudioUnavailableError } from "../../src/platform/audio.ts";
import { VorbisDecoder } from "../../src/platform/vorbis.ts";
import { UnifiedAudio } from "../../src/audio/engine.ts";

const fixture = process.env["QUAKE_TEST_OGG"]
  ?? new URL("../../../qfiles/q1/rerelease/id1/music/track02.ogg", import.meta.url).pathname;

if (process.env["QUAKE_AUDIO_TEST_CHILD"] !== "1") {
  test("real SDL audio tests use an isolated dummy driver", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, SDL_AUDIODRIVER: "dummy", SDL_AUDIO_DRIVER: "dummy", SDL_AUDIO_FREQUENCY: "48000", QUAKE_AUDIO_TEST_CHILD: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`SDL dummy tests failed (${code})\n${stdout}${stderr}`);
    expect(code).toBe(0);
  }, 15000);
  test.skipIf(!existsSync(fixture))("real external Vorbis PCM plays through isolated SDL dummy output", async () => {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], {
      env: { ...process.env, SDL_AUDIODRIVER: "dummy", SDL_AUDIO_DRIVER: "dummy", QUAKE_AUDIO_TEST_CHILD: "1", QUAKE_AUDIO_OGG_CHILD: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`Vorbis/SDL child failed (${code})\n${stdout}${stderr}`);
    expect(code).toBe(0);
  }, 15000);
} else if (process.env["QUAKE_AUDIO_OGG_CHILD"] === "1") {
  if (process.env["SDL_AUDIODRIVER"] !== "dummy") throw new Error("Audio tests require the dummy driver");
  test("decoded PCM survives decoder close and drains at its native sample rate", async () => {
    const decoder = VorbisDecoder.open(fixture);
    try {
      process.env["SDL_AUDIO_FREQUENCY"] = String(decoder.metadata.sampleRate);
      decoder.seek(Math.min(decoder.metadata.sampleRate, decoder.metadata.totalFrames - 1));
      const chunk = decoder.read(4096);
      if (chunk === null) throw new Error("External OGG contains no PCM");
      decoder.close();
      expect(chunk.samples.some(sample => sample !== 0)).toBe(true);
      using device = SdlAudioDevice.open({ sampleRate: chunk.sampleRate, channels: chunk.channels, bufferFrames: 256 });
      device.queue(chunk.samples);
      expect(device.queuedFrames).toBe(chunk.frames);
      device.start();
      const deadline = performance.now() + 2000;
      while (device.queuedFrames !== 0 && performance.now() < deadline) await Bun.sleep(10);
      expect(device.queuedFrames).toBe(0);
    } finally { decoder.close(); }
  });
} else {
  if (process.env["SDL_AUDIODRIVER"] !== "dummy") throw new Error("Audio tests require the dummy driver");

  test("shared mixer adapts its queue to frames slower than the default lookahead", async () => {
    using engine = new UnifiedAudio({ sampleRate: 48000, milliseconds: () => performance.now(), random: () => 0 });
    engine.openDevice({ bufferFrames: 256 });
    expect(engine.pump()).toBe(9600);
    await Bun.sleep(130);
    engine.pump();
    expect(engine.queuedFrames).toBeGreaterThan(6000);
    for (let frame = 0; frame < 8; frame++) engine.pump();
    engine.stopAll();
    expect(engine.pump()).toBe(3840);
    engine.pause(true);
    engine.stopAll();
    engine.pause(false);
    expect(engine.pump()).toBe(3840);
  });

  test("U8/S16 mono/stereo own paused queues and survive enumeration", () => {
    const deviceName = SdlAudioDevice.outputDeviceNames()[0];
    if (deviceName === undefined) throw new Error("SDL dummy did not enumerate a device");
    const formats: readonly (8 | 16)[] = [8, 16];
    const channelCounts: readonly (1 | 2)[] = [1, 2];
    for (const sampleRate of [11025, 22050, 44100, 48000]) for (const sampleBits of formats) for (const channels of channelCounts) {
      using device = SdlAudioDevice.open({ sampleRate, channels, sampleBits, deviceName, bufferFrames: 256 });
      expect(device.state).toBe("paused");
      const samples = sampleBits === 8 ? new Uint8Array(10 * channels).fill(128) : new Int16Array(10 * channels);
      device.queue(samples.subarray(channels, 6 * channels));
      expect(device.queuedFrames).toBe(5);
      samples.fill(0);
      expect(SdlAudioDevice.outputDeviceNames()).toContain(deviceName);
      expect(device.queuedFrames).toBe(5);
      expect(() => device.queue(sampleBits === 8 ? new Int16Array(channels) : new Uint8Array(channels))).toThrow("device format");
      device.clear();
      expect(device.queuedFrames).toBe(0);
      device.queue(sampleBits === 8 ? new Uint8Array(device.maxQueuedFrames * channels).fill(128)
        : new Int16Array(device.maxQueuedFrames * channels));
      expect(device.queuedFrames).toBe(sampleRate * 2);
      expect(() => device.queue(samples)).toThrow("two-second limit");
      const actualFrames = device.bufferFrames;
      expect(actualFrames).toBeGreaterThan(0);
      device.close();
      using reopened = SdlAudioDevice.open({ sampleRate, channels, sampleBits, deviceName, bufferFrames: actualFrames });
      expect(reopened.state).toBe("paused");
      expect(reopened.queuedFrames).toBe(0);
    }
  });

  test("native playback drains, pause freezes the clock, clear retains clock ownership", async () => {
    using device = SdlAudioDevice.open({ sampleRate: 48000, channels: 2, bufferFrames: 256 });
    device.queue(new Int16Array(4096));
    await Bun.sleep(25);
    expect(device.queuedFrames).toBe(2048);
    expect(device.playbackFrames).toBe(0);
    device.start(); device.start();
    expect(device.state).toBe("playing");
    const deadline = performance.now() + 1000;
    while (device.queuedFrames !== 0 && performance.now() < deadline) await Bun.sleep(10);
    expect(device.queuedFrames).toBe(0);
    device.pause(); device.pause();
    const played = device.playbackFrames;
    expect(played).toBeGreaterThan(0);
    device.clear();
    await Bun.sleep(20);
    expect(device.playbackFrames).toBe(played);
    expect(device.state).toBe("paused");
    device.resume();
    await Bun.sleep(20);
    device.pause();
    expect(device.playbackFrames).toBeGreaterThan(played);
  });

  test("failed open releases its subsystem reference; repeated close and reopen work", () => {
    expect(() => SdlAudioDevice.open({ sampleRate: 48000, channels: 2, deviceName: "quake-typescript-no-such-output" }))
      .toThrow(SdlAudioUnavailableError);
    for (let iteration = 0; iteration < 6; iteration++) {
      const device = SdlAudioDevice.open({ sampleRate: 48000, channels: 2 });
      expect(() => device.queue(new Int16Array(3))).toThrow("channel aligned");
      device.queue(new Int16Array(0));
      device.close(); device.close();
      expect(device.state).toBe("closed");
      expect(() => device.queue(new Int16Array(2))).toThrow("closed");
      expect(() => device.queuedFrames).toThrow("closed");
      expect(() => device.playbackFrames).toThrow("closed");
      expect(() => device.start()).toThrow("closed");
      expect(() => device.pause()).toThrow("closed");
      expect(() => device.clear()).toThrow("closed");
    }
  });

  test("malformed options fail before a native open", () => {
    for (const sampleRate of [NaN, Infinity, 0, 7999, 192001, 48000.5])
      expect(() => SdlAudioDevice.open({ sampleRate, channels: 2 })).toThrow("sample rate");
    for (const bufferFrames of [0, -1, 32769, 1.5, Infinity, NaN])
      expect(() => SdlAudioDevice.open({ sampleRate: 48000, channels: 2, bufferFrames })).toThrow("buffer frames");
    for (const deviceName of ["", "dummy\0suffix"])
      expect(() => SdlAudioDevice.open({ sampleRate: 48000, channels: 2, deviceName })).toThrow("device name");
  });
}
