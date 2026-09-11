import { expect, test } from "bun:test";
import { openArchive } from "../../src/content/archive/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { Axis } from "../../src/contracts/math.ts";
import { UnifiedAudio, AudioMixer, QuakeMixer, decodeWav, decodeQuakeWav, RawAudioStream, parseEnvironments, StereoReverb, reverbPreset, MusicPlayer, MemoryPcmStream } from "../../src/audio/index.ts";
import type { PcmSound, SoundAsset } from "../../src/audio/index.ts";
import { join } from "node:path";
const identity = createIdentityOwner("audio-smoke");
const axis: Axis = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
const origin = { x: 0, y: 0, z: 0 };
const tone: PcmSound = { samples: new Int16Array(2048).fill(12000), sampleRate: 22050, channels: 1, frameCount: 2048, loopStart: null };
const asset: SoundAsset = { resource: "resource:audio-smoke", name: "sound/test", pcm: tone };
test("real Q1, Q2 rerelease and Q3 archive sounds decode and mix", async () => {
    const corpus = join(import.meta.dir, "../../../qfiles");
    const cases = [{ path: "q1/rerelease/id1/pak0.pak", family: "q1" }, { path: "q2/rerelease/baseq2/pak0.pak", family: "q2" }, { path: "q3a/baseq3/pak0.pk3", family: "q3" }];
    for (const entry of cases) {
        const archive = await openArchive(join(corpus, entry.path));
        try {
            const wav = archive.entries.find(value => entry.family === "q2" ? value.path === "sound/player/steps/splash1.wav" : value.path.startsWith("sound/") && value.path.endsWith(".wav"));
            if (wav === undefined)
                throw new Error(`No WAV in ${entry.path}`);
            const bytes = await archive.readEntry(wav);
            const pcm = entry.family === "q3" ? decodeWav(bytes, wav.path) : decodeQuakeWav(bytes, wav.path);
            expect(pcm.frameCount).toBeGreaterThan(0);
            const mixer = entry.family === "q3" ? new AudioMixer(48000, () => 100) : new QuakeMixer(entry.family === "q1" ? "q1" : "q2", 48000, () => 1234);
            mixer.setListener(1, origin, axis);
            mixer.startSound(pcm, { entity: 1, channel: 1, origin: { kind: "local" }, volume: entry.family === "q3" ? 127 : 1, attenuation: 1 });
            expect(mixer.mix(4800).some(value => value !== 0)).toBe(true);
        }
        finally {
            archive.close();
        }
    }
});
test("seat sound routing, channel replacement and pause preserve mixer time", () => {
    const seat0 = identity.seat(0), seat1 = identity.seat(1), actor0 = identity.actor(1, 0), actor1 = identity.actor(2, 0);
    using audio = new UnifiedAudio({ sampleRate: 22050, milliseconds: () => 100, random: () => 0 });
    audio.setListeners([{ seat: seat0, actor: actor0, origin, axis, gain: 1, underwater: false }, { seat: seat1, actor: actor1, origin, axis, gain: 0, underwater: false }]);
    expect(audio.play({ family: "q1", sound: asset, actor: actor0, origin: { kind: "local" }, audience: { kind: "seat", seat: seat0 }, channel: 1, volume: 1, attenuation: 1 })).toBe(1);
    const first = audio.mix(32);
    expect(first[0]).toBeGreaterThan(0);
    audio.pause(true);
    expect(audio.mix(32).every(value => value === 0)).toBe(true);
    expect(audio.sampleClock).toBe(32);
    audio.pause(false);
    audio.stopSound(actor0, 1);
    expect(audio.mix(32).every(value => value === 0)).toBe(true);
    audio.play({ family: "q1", sound: asset, actor: actor1, origin: { kind: "local" }, audience: { kind: "seat", seat: seat1 }, channel: 1, volume: 1, attenuation: 1 });
    expect(audio.mix(32).every(value => value === 0)).toBe(true);
});
test("raw PCM is continuous over chunk boundaries and a paused stream keeps samples", () => {
    const stream = new RawAudioStream(48000);
    stream.queue({ samples: new Int16Array([100, 200]), channels: 1, sampleRate: 22050, sourceSample: 0, resetStream: true });
    stream.queue({ samples: new Int16Array([300, 400]), channels: 1, sampleRate: 22050, sourceSample: 2, resetStream: false });
    stream.paused = true;
    expect(stream.mix(3).every(v => v === 0)).toBe(true);
    stream.paused = false;
    expect([...stream.mix(9)].filter((_, i) => i % 2 === 0)).toEqual([100, 100, 100, 200, 200, 300, 300, 400, 400]);
});
test("music changes intro to loop and keeps pause position", () => {
    const player = new MusicPlayer(22050, "q1");
    player.setVolume(1);
    const intro = new MemoryPcmStream({ ...tone, frameCount: 2, samples: new Int16Array([100, 200]) });
    const loop = new MemoryPcmStream({ ...tone, frameCount: 2, samples: new Int16Array([300, 400]) });
    player.start(intro, loop);
    expect([...player.mix(6)].filter((_, i) => i % 2 === 0)).toEqual([100, 200, 300, 400, 300, 400]);
    player.paused = true;
    const position = player.sourcePosition;
    player.mix(4);
    expect(player.sourcePosition).toBe(position);
    player.close();
});
test("Q2 environment data selects presets and the owned DSP produces a tail", async () => {
    const archive = await openArchive(join(import.meta.dir, "../../../qfiles/q2/rerelease/baseq2/pak0.pak"));
    try {
        const entry = archive.entries.find(value => value.path === "sound/default.environments");
        if (entry === undefined)
            throw new Error("No environments data");
        const environments = parseEnvironments(new TextDecoder().decode(await archive.readEntry(entry)));
        expect(environments.length).toBe(8);
        const dsp = new StereoReverb(22050), samples = new Float64Array(22050 * 2);
        samples[0] = 32767;
        samples[1] = 32767;
        dsp.process(samples, reverbPreset(5));
        expect(samples.subarray(1000).some(value => Math.abs(value) > 0.01)).toBe(true);
    }
    finally {
        archive.close();
    }
});
test("real Ogg streams through unified SDL output", async () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "native-smoke.ts")], { env: { ...process.env, SDL_AUDIODRIVER: "dummy", SDL_AUDIO_FREQUENCY: "48000" }, stdout: "pipe", stderr: "pipe" });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exit).toBe(0);
});
