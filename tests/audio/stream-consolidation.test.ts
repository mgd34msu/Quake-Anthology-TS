import { expect, test } from "bun:test";
import { MusicPlayer } from "../../src/audio/music.ts";
import { MemoryPcmStream, RawAudioStream } from "../../src/audio/streams.ts";
import type { PcmSound } from "../../src/audio/wav.ts";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import { cinematicAudio } from "../../src/media/audio.ts";

function sound(frames: number, rate: number, channels: 1 | 2): PcmSound {
    return { sampleRate: rate, channels, frameCount: frames, loopStart: null,
        samples: Int16Array.from({ length: frames * channels }, (_, index) => index % 16001 - 8000) };
}

for (const family of ["q1", "q2", "q3"] satisfies readonly ("q1" | "q2" | "q3")[]) {
    test(`${family} music and queued cinema keep identical fractional phase across decode and mix blocks`, () => {
        const pcm = sound(33000, 22050, 2), player = new MusicPlayer(48000, family);
        player.setVolume(0.8);
        player.start(new MemoryPcmStream(pcm));
        player.update();
        const raw = new RawAudioStream(48000);
        for (let start = 0; start < pcm.frameCount; start += 16384)
            raw.queue({ ...pcm, samples: pcm.samples.subarray(start * 2, Math.min(start + 16384, pcm.frameCount) * 2),
                sourceSample: start, resetStream: start === 0 });
        let painted = 0;
        for (const frames of [1, 17003, 23000, 32000, 17]) {
            const music = player.mix(frames);
            expect(music).toEqual(raw.mix(frames, player.volume));
            for (let frame = 0; frame < frames; frame++) {
                const source = Math.floor((painted + frame) * 22050 / 48000);
                expect(music[frame * 2]).toBe((pcm.samples[source * 2] ?? 0) * player.volume);
                expect(music[frame * 2 + 1]).toBe((pcm.samples[source * 2 + 1] ?? 0) * player.volume);
            }
            painted += frames;
        }
        player.close();
    });
}

test("intro and loop reset phase at their own rates while pause and zero music gain retain position", () => {
    const intro: PcmSound = { ...sound(2, 22050, 1), samples: new Int16Array([100, 200]) };
    const loop: PcmSound = { ...sound(2, 32000, 2), samples: new Int16Array([300, -300, 400, -400]) };
    const player = new MusicPlayer(48000, "q1");
    player.setVolume(1);
    player.start(new MemoryPcmStream(intro), new MemoryPcmStream(loop));
    expect([...player.mix(4)]).toEqual([100, 100, 100, 100, 100, 100, 200, 200]);
    const position = player.sourcePosition;
    player.paused = true;
    expect([...player.mix(7)]).toEqual(new Array<number>(14).fill(0));
    player.paused = false;
    player.setVolume(0);
    expect([...player.mix(7)]).toEqual(new Array<number>(14).fill(0));
    expect(player.sourcePosition).toBe(position);
    player.setVolume(1);
    expect([...player.mix(8)]).toEqual([200, 200, 300, -300, 300, -300, 400, -400, 300, -300, 300, -300, 400, -400, 300, -300]);
    player.stop();
    expect([...player.mix(1)]).toEqual([0, 0]);
});

test("music and cinematic consumers accumulate into the same output with independent pause policy", () => {
    using audio = new UnifiedAudio({ sampleRate: 48000, milliseconds: () => 0, random: () => 0 });
    const pcm: PcmSound = { ...sound(2, 48000, 1), samples: new Int16Array([1000, 2000]) };
    const player = new MusicPlayer(48000, "q2");
    player.setVolume(0.5);
    const loop = new MemoryPcmStream(pcm);
    player.start(loop, loop);
    audio.attachMusic({ id: "music", gain: 1, audience: { kind: "world" } }, player);
    const cinema = cinematicAudio(audio, "movie", 0.25);
    cinema.onAudio?.({ ...pcm, sourceSample: 0, sourceTime: 0, time: 0, loop: 0, resetStream: true }, { kind: "material", id: "screen" });
    expect([...audio.mix(1)]).toEqual([750, 750]);
    cinema.onAudioPause?.(true, { kind: "material", id: "screen" });
    expect([...audio.mix(1)]).toEqual([1000, 1000]);
    cinema.onAudioPause?.(false, { kind: "material", id: "screen" });
    expect([...audio.mix(1)]).toEqual([1000, 1000]);
});

test("downsampling can cross several decoder chunks without skipping output or reading while paused", () => {
    class ShortReads extends MemoryPcmStream {
        reads = 0;
        override read(frames: number): PcmSound | null {
            this.reads++;
            return super.read(Math.min(frames, 3));
        }
    }
    const pcm = sound(29, 192000, 1), stream = new ShortReads(pcm);
    const player = new MusicPlayer(8000, "q2");
    player.setVolume(1);
    player.start(stream);
    player.paused = true;
    player.mix(10);
    expect(stream.reads).toBe(0);
    player.paused = false;
    expect([...player.mix(3)]).toEqual([-8000, -8000, -7976, -7976, 0, 0]);
    expect(player.playing).toBe(false);
    expect(player.sourcePosition).toBe(48);
    player.close();
});
