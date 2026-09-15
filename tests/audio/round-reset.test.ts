import { expect, spyOn, test } from "bun:test";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import { AudioMixer } from "../../src/audio/mixer.ts";
import { MusicPlayer } from "../../src/audio/music.ts";
import { MemoryPcmStream } from "../../src/audio/streams.ts";
import { SdlAudioDevice } from "../../src/platform/audio.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { AudioListener, SoundAsset } from "../../src/audio/types.ts";

const identity = createIdentityOwner("round-audio");
const origin = { x: 8192, y: 4096, z: 512 };
const sound: SoundAsset = { name: "round-tone", resource: "resource:round-tone", pcm: {
  samples: new Int16Array(2048).fill(12000), sampleRate: 44100, channels: 1, frameCount: 2048, loopStart: null,
} };
function listener(generation: number): AudioListener {
  return { actor: identity.actor(1, generation), seat: identity.seat(0), origin,
    axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false };
}
function fire(audio: UnifiedAudio, actor = identity.actor(1, 0)): number {
  return audio.play({ family: "q3", sound, actor, origin: { kind: "actor", actor }, audience: { kind: "world" }, channel: 2, volume: 1, attenuation: 1 });
}

test("double round reset reuses mixer and gain across actor generations without old listeners or positions", () => {
  using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0, maxActors: 3 });
  const mixers = new Set<AudioMixer>();
  const original = AudioMixer.prototype.setListener;
  const capture = spyOn(AudioMixer.prototype, "setListener").mockImplementation(function(this: AudioMixer, ...args) {
    mixers.add(this); return original.apply(this, args);
  });
  try {
    audio.setEffectsVolume(0.3);
    let expected: Int16Array | null = null;
    for (let generation = 0; generation < 16; generation++) {
      const local = listener(generation), remote = identity.actor(2, generation);
      audio.setListeners([local]);
      expect(fire(audio, remote)).toBe(1);
      audio.endLoopFrame();
      expect(audio.mix(8).every(sample => sample === 0)).toBe(true);
      audio.stopAll();
      audio.updateActor(remote, origin);
      expect(fire(audio, remote)).toBe(1);
      audio.endLoopFrame();
      const audible = audio.mix(8);
      expect(audible.some(sample => sample !== 0)).toBe(true);
      if (expected === null) expected = audible;
      else expect(audible).toEqual(expected);
      const clock = audio.sampleClock;
      audio.resetRound();
      expect(audio.sampleClock).toBe(clock);
      expect(audio.play({ family: "q3", sound, actor: null, origin: { kind: "local" }, audience: { kind: "world" }, channel: 2, volume: 1, attenuation: 0 })).toBe(0);
      expect(audio.mix(8).every(sample => sample === 0)).toBe(true);
      audio.resetRound();
    }
    expect(mixers.size).toBe(1);
  } finally { capture.mockRestore(); }
});

test("double reset retains the seat mixer while stopping loops, streams and music", () => {
  using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
  const mixers: AudioMixer[] = [], original = AudioMixer.prototype.setListener;
  const capture = spyOn(AudioMixer.prototype, "setListener").mockImplementation(function(this: AudioMixer, ...args) { mixers.push(this); return original.apply(this, args); });
  try {
    audio.setListeners([listener(0)]);
    audio.updateActor(identity.actor(1, 0), origin);
    audio.loop({ family: "q2", sound, actor: identity.actor(1, 0), origin: { kind: "actor", actor: identity.actor(1, 0) }, audience: { kind: "world" }, volume: 1, attenuation: 1,
      velocity: { x: 0, y: 0, z: 0 }, frameNumber: 1, lifetime: "persistent" });
    audio.queueStream({ id: "old", audience: { kind: "world" }, gain: 1 }, { samples: sound.pcm.samples, sampleRate: 44100, channels: 1, sourceSample: 0, resetStream: true });
    const music = new MusicPlayer(44100, "q3");
    music.start(new MemoryPcmStream(sound.pcm));
    audio.attachMusic({ id: "world", audience: { kind: "world" }, gain: 1 }, music);
    audio.endLoopFrame();
    expect(audio.mix(8).some(sample => sample !== 0)).toBe(true);
    audio.resetRound();
    audio.resetRound();
    expect(music.playing).toBe(false);
    audio.setListeners([listener(1)]);
    audio.endLoopFrame();
    expect(audio.mix(8).every(sample => sample === 0)).toBe(true);
    expect(mixers.at(-1)).toBe(mixers[0]);
    expect(fire(audio, identity.actor(1, 1))).toBe(1);
    audio.endLoopFrame();
    expect(audio.mix(8).some(sample => sample !== 0)).toBe(true);
    audio.resetRound();
    audio.setListeners([]);
    audio.setListeners([listener(2)]);
    expect(mixers.at(-1)).not.toBe(mixers[0]);
  } finally { capture.mockRestore(); }
});

test.skipIf(process.env["QUAKE_ROUND_AUDIO_DEVICE"] !== "1")("round reset clears the real dummy device queue without reopening output", () => {
  if (process.env["SDL_AUDIODRIVER"] !== "dummy") throw new Error("Dummy audio required");
  using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
  let round = 0;
  const queued: { readonly round: number; readonly device: SdlAudioDevice; readonly samples: number; readonly nonzero: boolean }[] = [];
  const original = SdlAudioDevice.prototype.queue;
  const capture = spyOn(SdlAudioDevice.prototype, "queue").mockImplementation(function(this: SdlAudioDevice, samples) {
    original.call(this, samples);
    queued.push({ round, device: this, samples: samples.length, nonzero: samples.some(sample => sample !== 0) });
  });
  try {
    audio.openDevice(); audio.setListeners([listener(0)]); fire(audio); audio.endLoopFrame(); audio.pump(); audio.pause(true);
    expect(audio.queuedFrames).toBeGreaterThan(0);
    expect(queued.some(entry => entry.round === 0 && entry.samples > 0 && entry.nonzero)).toBe(true);
    const configuration = audio.outputConfiguration;
    audio.resetRound();
    expect(audio.queuedFrames).toBe(0); expect(audio.pendingOutput.length).toBe(0);
    expect(audio.outputConfiguration).toEqual(configuration);
    round = 1;
    audio.setListeners([listener(1)]); expect(fire(audio, identity.actor(1, 1))).toBe(1); audio.endLoopFrame(); audio.pause(false);
    expect(audio.pump()).toBeGreaterThan(0);
    expect(queued.filter(entry => entry.round === 1).length).toBeGreaterThan(0);
    expect(queued.some(entry => entry.round === 1 && entry.samples > 0 && entry.nonzero)).toBe(true);
    expect(new Set(queued.map(entry => entry.device)).size).toBe(1);
  } finally { capture.mockRestore(); }
});
