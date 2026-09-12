import { expect, test } from "bun:test";
import { openArchive } from "../../src/content/archive/index.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { Axis } from "../../src/contracts/math.ts";
import { UnifiedAudio, AudioMixer, decodeWav, decodeQuakeWav, RawAudioStream, parseEnvironments, StereoReverb, reverbPreset, MusicPlayer, MemoryPcmStream } from "../../src/audio/index.ts";
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
            const mixer = new AudioMixer(48000, () => 100);
            mixer.setListener(1, origin, axis);
            if (entry.family === "q1") mixer.startQ1Sound(pcm, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 1 }, { kind: "channel", channel: "weapon" }, () => 1234);
            else if (entry.family === "q2") mixer.startQ2Sound(pcm, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 1 }, { kind: "channel", channel: "weapon" });
            else mixer.startSound(pcm, { entity: 1, channel: 1, origin: { kind: "local" }, volume: 127 });
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
    audio.stopSound(actor0, "weapon");
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

test("shared voices retain rejected sounds and map weapon channels across source families", () => {
    let time = 100;
    const mixer = new AudioMixer(22050, () => time);
    mixer.setListener(1, origin, axis);
    expect(mixer.startSound(tone, { entity: 1, origin: { kind: "local" }, channel: 2, volume: 127 })).toBe(true);
    mixer.mix(1);
    time = 101;
    expect(mixer.startSound(tone, { entity: 1, origin: { kind: "local" }, channel: 2, volume: 127 })).toBe(false);
    expect(mixer.mix(1)[0]).toBeGreaterThan(0);
    const other: PcmSound = { ...tone, samples: new Int16Array(2048).fill(1000) };
    expect(mixer.startSound(other, { entity: 1, origin: { kind: "local" }, channel: 1, volume: 127 })).toBe(true);
    expect(mixer.startQ1Sound(other, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0 }, { kind: "channel", channel: "weapon" }, () => 0)).toBe(true);
    expect([...mixer.channelVolumes()].map(voice => voice.sound)).toEqual([other, other]);
    mixer.stopSharedChannel(1, "weapon");
    expect([...mixer.channelVolumes()].map(voice => voice.sound)).toEqual([other]);
    mixer.stopSharedChannel(1, "local");
    expect(mixer.mix(1).every(value => value === 0)).toBe(true);
});

test("Q1 effect, static, ambient and entity loops share the Q3 paint clock", () => {
    const mixer = new AudioMixer(22050, () => 100);
    mixer.setListener(1, origin, axis);
    const loop: PcmSound = { samples: new Int16Array([1000, 2000, 3000, 4000]), sampleRate: 22050, channels: 1, frameCount: 4, loopStart: 2 };
    mixer.startQ1Sound(tone, { entity: 1, origin: { kind: "local" }, volume: 0.1, attenuation: 0 }, { kind: "auto" }, () => 0);
    mixer.addStaticSound(loop, origin, 100, 0);
    mixer.updateAmbient([loop], [100], 1);
    mixer.setSourceLoopSounds([{ family: "q1", entity: 2, sound: loop, origin, volume: 0.1 }]);
    mixer.startSound(tone, { entity: 3, origin: { kind: "local" }, channel: 2, volume: 10 });
    mixer.clearLoopingSounds(true);
    expect([...mixer.channelVolumes()]).toHaveLength(5);
    expect(mixer.mix(10).every(value => value > 0)).toBe(true);
    expect(mixer.sampleClock).toBe(10);
    mixer.setSourceLoopSounds([]);
    mixer.updateAmbient([], [], 0);
    mixer.startQ1Sound(loop, { entity: -1, origin: { kind: "local" }, volume: 0.1, attenuation: 0 }, { kind: "replace-actor" }, () => 0);
    expect([...mixer.channelVolumes()]).toHaveLength(4);
    mixer.stopAll();
    mixer.addStaticSound(loop, origin, 255, 0);
    const pcm = mixer.mix(8);
    expect(pcm[0]).toBeLessThan(pcm[2] ?? 0);
    expect(pcm[4]).toBe(pcm[8]);
    expect(pcm[6]).toBe(pcm[10]);
    expect(pcm[8]).toBe(pcm[12]);
    expect(mixer.sampleClock).toBe(18);
});

test("Q1 same-frame dephasing advances one shared cursor and rejected admission retains Q2 audio", () => {
    const mixer = new AudioMixer(22050, () => 100);
    mixer.setListener(1, origin, axis);
    const ramp: PcmSound = { samples: new Int16Array([1000, 2000, 3000, 4000, 5000]), sampleRate: 22050, channels: 1, frameCount: 5, loopStart: null };
    let calls = 0;
    const random = () => { calls++; return 2; };
    mixer.startQ1Sound(ramp, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0 }, { kind: "channel", channel: "weapon" }, random);
    expect(calls).toBe(0);
    mixer.startQ1Sound(ramp, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0 }, { kind: "channel", channel: "voice" }, random);
    expect(calls).toBe(1);
    mixer.stopSharedChannel(1, "weapon");
    const shifted = mixer.mix(4);
    expect(shifted[0]).toBeGreaterThan(shifted[6] ?? 0);
    expect(shifted[6]).toBe(0);
    expect(mixer.sampleClock).toBe(4);
    const seat = identity.seat(0), actor = identity.actor(10, 0);
    using audio = new UnifiedAudio({ sampleRate: 22050, milliseconds: () => 100, random: () => 0 });
    audio.setListeners([{ seat, actor, origin, axis, gain: 1, underwater: false }]);
    expect(audio.play({ family: "q2", sound: asset, actor, origin: { kind: "local" }, audience: { kind: "world" }, channel: 1, volume: 1, attenuation: 0 })).toBe(1);
    expect(audio.mix(1)[0]).toBeGreaterThan(0);
    expect(audio.play({ family: "q1", sound: asset, actor, origin: { kind: "fixed", position: origin }, audience: { kind: "world" }, channel: 1, volume: 0, attenuation: 0 })).toBe(0);
    expect(audio.mix(1)[0]).toBeGreaterThan(0);
});

test("a full shared pool of protected source loops admits a Q3 effect", () => {
    const mixer = new AudioMixer(22050, () => 100, 2);
    mixer.setListener(1, origin, axis);
    const loop: PcmSound = { ...tone, loopStart: 0 };
    mixer.addStaticSound(loop, origin, 20, 0);
    mixer.updateAmbient([loop], [100], 1);
    expect([...mixer.channelVolumes()]).toHaveLength(2);
    expect(mixer.startSound(tone, { entity: 1, origin: { kind: "local" }, channel: 2, volume: 20 })).toBe(true);
    expect([...mixer.channelVolumes()]).toHaveLength(3);
    expect(mixer.mix(8).every(value => value > 0)).toBe(true);
    expect(mixer.sampleClock).toBe(8);
});

test("Q1 frame and persistent loops retain source lifetimes through Q3 seat reset", () => {
    const seat = identity.seat(0), listener = identity.actor(20, 0), frameActor = identity.actor(21, 0), persistentActor = identity.actor(22, 0);
    using audio = new UnifiedAudio({ sampleRate: 22050, milliseconds: () => 100, random: () => 0 });
    audio.setListeners([{ seat, actor: listener, origin, axis, gain: 1, underwater: false }]);
    audio.loop({ family: "q1", sound: asset, actor: frameActor, origin: { kind: "fixed", position: { x: 0, y: 100, z: 0 } }, audience: { kind: "seat", seat }, volume: 0.1, attenuation: 1, velocity: origin, frameNumber: 1, lifetime: "frame" });
    audio.loop({ family: "q1", sound: asset, actor: persistentActor, origin: { kind: "fixed", position: { x: 0, y: 100, z: 0 } }, audience: { kind: "seat", seat }, volume: 0.1, attenuation: 1, velocity: origin, frameNumber: 1, lifetime: "persistent" });
    audio.endLoopFrame();
    audio.clearQ3SeatLoops(seat, true);
    const both = audio.mix(1);
    expect(both[0]).toBeGreaterThan(0);
    expect(both[1]).toBe(0);
    audio.beginLoopFrame();
    audio.endLoopFrame();
    const persistent = audio.mix(1);
    expect(persistent[0]).toBeGreaterThan(0);
    expect(persistent[0]).toBeLessThan(both[0] ?? 0);
    audio.stopLoop(persistentActor);
    expect(audio.mix(1).every(value => value === 0)).toBe(true);
    expect(audio.sampleClock).toBe(3);
});

test("Quake signed chunk termination retains complete PCM and earlier cue/LIST loop metadata", () => {
    const bytes = new Uint8Array(126), words = new DataView(bytes.buffer);
    const tag = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(value), offset); };
    tag(0, "RIFF"); words.setUint32(4, 118, true); tag(8, "WAVE");
    tag(12, "fmt "); words.setUint32(16, 16, true); words.setUint16(20, 1, true); words.setUint16(22, 1, true);
    words.setUint32(24, 11025, true); words.setUint32(28, 11025, true); words.setUint16(32, 1, true); words.setUint16(34, 8, true);
    tag(36, "data"); words.setUint32(40, 6, true); bytes.set([128, 129, 130, 131, 132, 133], 44);
    tag(50, "cue "); words.setUint32(54, 28, true); words.setUint32(58, 1, true); words.setUint32(82, 1, true);
    tag(86, "LIST"); words.setUint32(90, 24, true); words.setUint32(110, 3, true); tag(114, "mark");
    tag(118, "LIST"); words.setUint32(122, 0xffffffff, true);
    const decoded = decodeQuakeWav(bytes);
    expect(decoded.loopStart).toBe(1); expect(decoded.frameCount).toBe(4);
    expect([...decoded.samples]).toEqual([0, 256, 512, 768]);
    expect(() => decodeWav(bytes)).toThrow("exceeds RIFF bounds");
    const missing = bytes.slice(); missing.set(new TextEncoder().encode("JUNK"), 36);
    expect(() => decodeQuakeWav(missing)).toThrow("missing WAV data");
    const truncated = bytes.slice(); new DataView(truncated.buffer).setUint32(40, 500, true);
    expect(() => decodeQuakeWav(truncated)).toThrow("exceeds RIFF bounds");
    const unidentified = bytes.slice(); const invalid = new DataView(unidentified.buffer); invalid.setUint32(122, 24, true);
    expect(() => decodeQuakeWav(unidentified)).toThrow("exceeds RIFF bounds");
    const sampler = new Uint8Array(118), samplerWords = new DataView(sampler.buffer);
    sampler.set(bytes.subarray(0, 50)); samplerWords.setUint32(4, 110, true);
    sampler.set(new TextEncoder().encode("smpl"), 50); samplerWords.setUint32(54, 60, true);
    samplerWords.setUint32(86, 1, true); samplerWords.setUint32(98, 0, true);
    samplerWords.setUint32(102, 2, true); samplerWords.setUint32(106, 4, true);
    expect(decodeQuakeWav(sampler).loopStart).toBe(2);
    samplerWords.setUint32(98, 255, true); samplerWords.setUint32(102, 0xffffffff, true); samplerWords.setUint32(106, 0xffffffff, true);
    expect(decodeQuakeWav(sampler).loopStart).toBe(null);
    expect(() => decodeWav(sampler)).toThrow();
    samplerWords.setUint32(106, 4, true);
    expect(() => decodeQuakeWav(sampler)).toThrow();
});

test("dense mixed voices clip once without positive or negative accumulator wrap", () => {
    for (const sample of [32767, -32768]) {
        const mixer = new AudioMixer(22050, () => 100);
        mixer.setListener(1, origin, axis);
        const full: PcmSound = { samples: new Int16Array([sample]), sampleRate: 22050, channels: 1, frameCount: 1, loopStart: null };
        for (let index = 0; index < 600; index++) mixer.startQ1Sound(full, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0 }, { kind: "auto" }, () => 0);
        expect(mixer.startSound(full, { entity: 1, origin: { kind: "local" }, channel: 2, volume: 127 })).toBe(true);
        expect([...mixer.mix(1)]).toEqual([sample, sample]);
        expect(mixer.sampleClock).toBe(1);
    }
});

test("actual id1 PCM survives source-supported trailing authoring metadata", async () => {
    const archive = await openArchive(join(import.meta.dir, "../../../qfiles/q1/id1/PAK0.PAK"));
    try {
        for (const entry of [{ path: "sound/knight/ksight.wav", frames: 13436 }, { path: "sound/doors/baseuse.wav", frames: 16360 }]) {
            const file = archive.entries.find(value => value.path === entry.path);
            if (file === undefined) throw new Error(`Missing actual PCM ${entry.path}`);
            const bytes = await archive.readEntry(file), decoded = decodeQuakeWav(bytes, entry.path);
            expect(decoded.sampleRate).toBe(11025);
            expect(decoded.frameCount).toBe(entry.frames);
            expect(decoded.loopStart).toBe(null);
            expect(decoded.samples.some(value => value !== 0)).toBe(true);
            expect(() => decodeWav(bytes, entry.path)).toThrow();
        }
    }
    finally { archive.close(); }
});

test("full-pan Q1 voice products retain positive and negative polarity before clipping", () => {
    for (const sample of [32767, -32768]) {
        const mixer = new AudioMixer(22050, () => 100);
        mixer.setEffectsVolume(1);
        mixer.setListener(1, origin, axis);
        const full: PcmSound = { samples: new Int16Array([sample]), sampleRate: 22050, channels: 1, frameCount: 1, loopStart: null };
        expect(mixer.startQ1Sound(full, { entity: 2, origin: { kind: "fixed", position: { x: 0, y: 100, z: 0 } }, volume: 1, attenuation: 0 }, { kind: "auto" }, () => 0)).toBe(true);
        expect([...mixer.channelVolumes()].map(voice => [voice.left, voice.right])).toEqual([[510, 0]]);
        expect([...mixer.mix(1)]).toEqual([sample, 0]);
    }
});

test("Q2 deadlines replace shared weapon voices at issuance and cancel before issuance", () => {
    const mixer = new AudioMixer(1000, () => 100);
    mixer.setListener(1, origin, axis);
    const old: PcmSound = { samples: new Int16Array(100).fill(1000), sampleRate: 1000, channels: 1, frameCount: 100, loopStart: null };
    const next: PcmSound = { ...old, samples: new Int16Array(100).fill(-1000) };
    mixer.startQ1Sound(old, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0 }, { kind: "channel", channel: "weapon" }, () => 0);
    mixer.startQ2Sound(next, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, delaySeconds: 0.005 }, { kind: "channel", channel: "weapon" });
    expect([...mixer.channelVolumes()].map(voice => voice.sound)).toEqual([old]);
    const crossing = mixer.mix(8);
    expect(crossing[8]).toBeGreaterThan(0);
    expect(crossing[10]).toBeLessThan(0);
    expect([...mixer.channelVolumes()].map(voice => voice.sound)).toEqual([next]);
    mixer.startQ2Sound(old, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, delaySeconds: 0.005 }, { kind: "channel", channel: "weapon" });
    mixer.stopSharedChannel(1, "weapon");
    expect(mixer.mix(20).every(value => value === 0)).toBe(true);
    expect(mixer.sampleClock).toBe(28);
});

test("Q2 equal deadlines issue newest first and late issuance starts at sample zero", () => {
    const mixer = new AudioMixer(1000, () => 100);
    mixer.setListener(1, origin, axis);
    const first: PcmSound = { samples: new Int16Array([1000, 2000, 3000, 4000]), sampleRate: 1000, channels: 1, frameCount: 4, loopStart: null };
    const second: PcmSound = { ...first, samples: new Int16Array(4).fill(-1000) };
    for (const sound of [first, second]) mixer.startQ2Sound(sound, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, delaySeconds: 0.005 }, { kind: "channel", channel: "weapon" });
    expect(mixer.mix(5).every(value => value === 0)).toBe(true);
    expect(mixer.mix(1)[0]).toBeGreaterThan(0);
    expect([...mixer.channelVolumes()].map(voice => voice.sound)).toEqual([first]);
    mixer.stopAll();
    mixer.startQ2Sound(first, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, delaySeconds: -0.1 }, { kind: "auto" });
    const late = mixer.mix(2);
    expect(late[0]).toBeGreaterThan(0);
    expect(late[2]).toBeGreaterThan(late[0] ?? 0);
});

test("shared Q1 and Q2 entity loops retain phase and source attenuation", () => {
    const mixer = new AudioMixer(1000, () => 100);
    mixer.setListener(1, origin, axis);
    const loop: PcmSound = { samples: new Int16Array([1000, 2000, 3000, 4000]), sampleRate: 1000, channels: 1, frameCount: 4, loopStart: null };
    mixer.setSourceLoopSounds([{ family: "q1", entity: 2, sound: loop, origin, volume: 0.1 }, { family: "q2", entity: 3, sound: loop, origin, volume: 0.1 }]);
    expect([...mixer.channelVolumes()]).toHaveLength(2);
    const first = mixer.mix(3);
    mixer.setSourceLoopSounds([{ family: "q1", entity: 2, sound: loop, origin, volume: 0.1 }, { family: "q2", entity: 3, sound: loop, origin, volume: 0.1 }]);
    const refreshed = mixer.mix(2);
    expect(refreshed[0]).toBeGreaterThan(first[4] ?? 0);
    expect(refreshed[2]).toBe(first[0]);
    mixer.setSourceLoopSounds([]);
    mixer.startQ2Sound(loop, { entity: 2, origin: { kind: "fixed", position: { x: 0, y: 80, z: 0 } }, volume: 1, attenuation: 1 }, { kind: "auto" });
    const pan = mixer.mix(1);
    expect(pan[0]).toBeGreaterThan(0);
    expect(pan[1]).toBe(0);
    expect([...mixer.channelVolumes()].map(voice => [voice.left, voice.right])).toEqual([[255, 0]]);
    expect(mixer.sampleClock).toBe(6);
});

test("Q2 server drift correction bounds future starts and preserves zero-delay immediacy", () => {
    const mixer = new AudioMixer(1000, () => 100);
    mixer.setListener(1, origin, axis);
    const short: PcmSound = { samples: new Int16Array([1000, 2000]), sampleRate: 1000, channels: 1, frameCount: 2, loopStart: null };
    mixer.startQ2Sound(short, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, serverMilliseconds: 10000, delaySeconds: 0.005 }, { kind: "auto" });
    expect(mixer.mix(105).every(value => value === 0)).toBe(true);
    expect(mixer.mix(1)[0]).toBeGreaterThan(0);
    mixer.stopAll();
    mixer.startQ2Sound(short, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, serverMilliseconds: -10000, delaySeconds: 0.005 }, { kind: "auto" });
    expect(mixer.mix(5).every(value => value === 0)).toBe(true);
    expect(mixer.mix(1)[0]).toBeGreaterThan(0);
    mixer.stopAll();
    mixer.startQ2Sound(short, { entity: 1, origin: { kind: "local" }, volume: 1, attenuation: 0, serverMilliseconds: 10000 }, { kind: "auto" });
    expect(mixer.mix(1)[0]).toBeGreaterThan(0);
    expect(mixer.sampleClock).toBe(113);
});

test("pure Q3 effects and unique loops grow independently of initial allocation", () => {
    const small = new AudioMixer(1000, () => 100, 2), roomy = new AudioMixer(1000, () => 100, 8);
    const sounds = [1000, 2000, 3000].map(value => ({ samples: new Int16Array(8).fill(value), sampleRate: 1000, channels: 1, frameCount: 8, loopStart: null } satisfies PcmSound));
    for (const mixer of [small, roomy]) {
        mixer.setListener(1, origin, axis);
        for (const [index, sound] of sounds.entries()) expect(mixer.startSound(sound, { entity: index + 2, origin: { kind: "local" }, channel: 0, volume: 127 })).toBe(true);
        expect([...mixer.channelVolumes()]).toHaveLength(3);
    }
    const effects = small.mix(1);
    expect(effects[0]).toBeGreaterThan(0);
    expect([...effects]).toEqual([...roomy.mix(1)]);
    for (const mixer of [small, roomy]) {
        mixer.stopAll();
        for (const [index, sound] of sounds.entries()) mixer.updateRealLoopingSound(sound, { entity: index + 2, origin, velocity: origin });
        mixer.setListener(1, origin, axis);
    }
    const loops = small.mix(1);
    expect(loops[0]).toBeGreaterThan(0);
    expect([...loops]).toEqual([...roomy.mix(1)]);
    expect(small.sampleClock).toBe(2);
});

test("ordinary Q3 Doppler retains its captured source-compatible PCM", () => {
    const mixer = new AudioMixer(1000, () => 0);
    const sound: PcmSound = { sampleRate: 1000, channels: 1, frameCount: 2048, loopStart: null,
        samples: Int16Array.from({ length: 2048 }, (_, index) => (index % 13 - 6) * 3000) };
    mixer.setListener(1, origin, axis);
    mixer.updateLoopingSound(sound, { entity: 2, origin: { x: 100, y: 0, z: 0 }, velocity: { x: 1000, y: 0, z: 0 }, frameNumber: 1 });
    mixer.setListener(1, origin, axis);
    expect([...mixer.mix(12)]).toEqual([-3474, -3474, -2895, -2895, -2316, -2316, -1737, -1737,
        -869, -869, 0, 0, 578, 578, 1157, 1157, 1736, 1736, 2605, 2605, 3473, 3473, -3474, -3474]);
});

test("Doppler singularities and arbitrarily large finite rates have bounded sample work", () => {
    const cases = [
        { distance: 0, velocity: 1000, maximumReads: 32 },
        { distance: 0.000001, velocity: 1000, maximumReads: 2048 },
        { distance: 1, velocity: Math.sqrt(1023.5 * 100) - 1, maximumReads: 32 * 1024 },
        { distance: 1, velocity: Math.sqrt(1024.5 * 100) - 1, maximumReads: 2048 },
        // These finite source vectors produce exactly FLT_MAX, without private-state injection.
        { distance: 0.09999964386224747, velocity: 18446678103011885000, maximumReads: 2048 },
    ];
    for (const entry of cases) for (const value of [12000, -12000]) {
        const mixer = new AudioMixer(1000, () => 0);
        const sound: PcmSound = { sampleRate: 1000, channels: 1, frameCount: 2048, loopStart: null, samples: new Int16Array(2048).fill(value) };
        let reads = 0;
        mixer.bindSoundMemory({ frameCount: pcm => pcm.frameCount, hasData: () => true, touch: () => undefined,
            sample: (pcm, index) => { reads++; const sample = pcm.samples[index]; if (sample === undefined) throw new Error("Read beyond prepared PCM"); return sample; } });
        mixer.setListener(1, origin, axis);
        mixer.updateLoopingSound(sound, { entity: 2, origin: { x: entry.distance, y: 0, z: 0 }, velocity: { x: entry.velocity, y: 0, z: 0 }, frameNumber: 1 });
        mixer.setListener(1, origin, axis);
        const output = mixer.mix(32);
        expect(reads).toBeGreaterThan(0);
        expect(reads).toBeLessThanOrEqual(entry.maximumReads);
        expect(output.every(sample => Number.isFinite(sample) && Math.sign(sample) === Math.sign(value))).toBe(true);
        expect(mixer.sampleClock).toBe(32);
        const before = reads;
        expect(mixer.mix(32).every(sample => Math.sign(sample) === Math.sign(value))).toBe(true);
        expect(reads - before).toBeLessThanOrEqual(entry.maximumReads);
    }
});

test("large finite Doppler averages complete cycles without capping pitch", () => {
    const mixer = new AudioMixer(1000, () => 0);
    const sound: PcmSound = { sampleRate: 1000, channels: 1, frameCount: 2048, loopStart: null,
        samples: Int16Array.from({ length: 2048 }, (_, index) => index < 1024 ? 12000 : -12000) };
    mixer.setListener(1, origin, axis);
    // (1 + 639)^2 / (1^2 * 100) = 4096: two complete source cycles per output.
    mixer.updateLoopingSound(sound, { entity: 2, origin: { x: 1, y: 0, z: 0 }, velocity: { x: 639, y: 0, z: 0 }, frameNumber: 1 });
    mixer.setListener(1, origin, axis);
    expect(mixer.mix(32).every(sample => sample === 0)).toBe(true);
    mixer.setDopplerEnabled(false);
    mixer.updateLoopingSound(sound, { entity: 2, origin: { x: 1, y: 0, z: 0 }, velocity: { x: 639, y: 0, z: 0 }, frameNumber: 2 });
    mixer.setListener(1, origin, axis);
    expect(mixer.mix(32).every(sample => sample > 0)).toBe(true);
});


test("global Doppler disable overrides source cvars and already-submitted loops", () => {
    const sound: PcmSound = { sampleRate: 1000, channels: 1, frameCount: 2048, loopStart: null,
        samples: Int16Array.from({ length: 2048 }, (_, index) => index < 1024 ? 12000 : -12000) };
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: identity.session, origin: { kind: "server-console" } } });
    cvars.register("s_doppler", "1"); cvars.register("s_testsound", "0");
    const mixer = new AudioMixer(1000, () => 0);
    mixer.bindSoundCvars(cvars);
    const submit = () => {
        mixer.updateLoopingSound(sound, { entity: 2, origin: { x: 1, y: 0, z: 0 }, velocity: { x: 639, y: 0, z: 0 }, frameNumber: 1 });
        mixer.setListener(1, origin, axis);
    };
    mixer.setListener(1, origin, axis); submit();
    expect(mixer.mix(8).every(sample => sample === 0)).toBe(true);
    mixer.setDopplerEnabled(false);
    expect(mixer.mix(8).every(sample => sample > 0)).toBe(true);
    submit(); // s_doppler remains enabled, but cannot override the global choice.
    expect(mixer.mix(8).every(sample => sample > 0)).toBe(true);
    mixer.setDopplerEnabled(true); submit();
    expect(mixer.mix(8).every(sample => sample === 0)).toBe(true);
    cvars.set("s_doppler", "0"); submit();
    expect(mixer.mix(8).every(sample => sample > 0)).toBe(true);
});

test("Doppler choice reaches current and newly-created seats in the shared engine", () => {
    const first = identity.seat(0), second = identity.seat(1), actor = identity.actor(50, 0);
    const sound: SoundAsset = { ...asset, pcm: { sampleRate: 8000, channels: 1, frameCount: 2048, loopStart: null,
        samples: Int16Array.from({ length: 2048 }, (_, index) => index < 1024 ? 12000 : -12000) } };
    using audio = new UnifiedAudio({ sampleRate: 8000, milliseconds: () => 0, random: () => 0 });
    const listener = (seat: typeof first, gain: number) => ({ seat, actor: null, origin, axis, gain, underwater: false });
    audio.setListeners([listener(first, 1)]);
    const submit = () => {
        audio.beginLoopFrame();
        audio.loop({ sound, family: "q3", actor, origin: { kind: "fixed", position: { x: 1, y: 0, z: 0 } }, audience: { kind: "world" },
            volume: 1, attenuation: 1, velocity: { x: 639, y: 0, z: 0 }, frameNumber: 1, lifetime: "frame" });
        audio.endLoopFrame();
    };
    submit(); expect(audio.mix(8).every(sample => sample === 0)).toBe(true);
    audio.setDopplerEnabled(false);
    expect(audio.mix(8).every(sample => sample > 0)).toBe(true);
    audio.setListeners([listener(first, 0), listener(second, 1)]);
    submit(); expect(audio.mix(8).every(sample => sample > 0)).toBe(true);
    audio.setDopplerEnabled(true);
    submit(); expect(audio.mix(8).every(sample => sample === 0)).toBe(true);
});
