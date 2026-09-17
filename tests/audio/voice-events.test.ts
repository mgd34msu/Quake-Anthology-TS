import { expect, test } from "bun:test";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { AudioListener, AudioVoiceEvent, SoundAsset, SoundFamily } from "../../src/audio/types.ts";
const ids = createIdentityOwner("voice-events"), zero = { x: 0, y: 0, z: 0 };
const listener = (seat: number): AudioListener => ({ seat: ids.seat(seat), actor: null, origin: zero, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false });
const sound: SoundAsset = { name: "authored.wav", resource: "resource:voice", pcm: { samples: new Int16Array(128).fill(10000), sampleRate: 44100, channels: 1, frameCount: 128, loopStart: null } };
function play(audio: UnifiedAudio, family: SoundFamily): void { audio.play({ sound, family, actor: null, audience: { kind: "world" }, origin: { kind: "local" }, channel: 1, volume: 1, attenuation: 1 }); }
test("effect events preserve asset identity and exact natural endpoint across source families", () => {
    for (const family of ["q1", "q2", "q3"] satisfies readonly SoundFamily[]) {
        using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
        const events: AudioVoiceEvent[] = [];
        audio.observeVoices(event => events.push(event)); audio.setListeners([listener(0)]);
        play(audio, family); audio.mix(64);
        const start = events[0]; expect(start?.kind).toBe("start");
        if (start?.kind !== "start") throw new Error("Missing actual voice start");
        expect(start.sound).toBe(sound); expect(start.outputSample).toBe(0); expect(start.sourceOffsetSeconds).toBe(0);
        expect(audio.voiceClock.outputSample).toBe(64);
        audio.pause(true); audio.mix(64); expect(audio.voiceClock.outputSample).toBe(64);
        audio.pause(false); audio.mix(64);
        expect(events[1]).toEqual({ kind: "stop", seat: ids.seat(0), voiceId: start.voiceId, outputSample: 128, reason: "ended" });
        audio.mix(64); audio.stopAll(); expect(events.length).toBe(2);
    }
});
test("replacements, seat retirement and retained round mixers keep unique voice lifetimes", () => {
    let milliseconds = 1000; using audio = new UnifiedAudio({ milliseconds: () => milliseconds, random: () => 0 });
    const events: AudioVoiceEvent[] = []; const unsubscribe = audio.observeVoices(event => events.push(event));
    audio.setListeners([listener(0), listener(1)]); play(audio, "q3"); audio.mix(16);
    milliseconds += 100; play(audio, "q3"); audio.mix(16);
    expect(events.filter(event => event.kind === "stop" && event.reason === "replaced")).toHaveLength(2);
    audio.setListeners([listener(0)]); audio.resetRound(); audio.setListeners([listener(0)]); play(audio, "q3"); audio.mix(16); audio.stopAll();
    const starts = events.filter(event => event.kind === "start"), stops = events.filter(event => event.kind === "stop");
    expect(new Set(starts.map(event => event.voiceId)).size).toBe(5); expect(stops).toHaveLength(5);
    unsubscribe(); play(audio, "q3"); audio.mix(16); expect(events).toHaveLength(10);
});
test("Q2 scheduled admission waits for paint and cancelled pending voices never start", () => {
    using audio = new UnifiedAudio({ milliseconds: () => 1000, random: () => 0 });
    const events: AudioVoiceEvent[] = []; audio.observeVoices(event => events.push(event)); audio.setListeners([listener(0)]);
    const delayed = (): void => { audio.play({ sound, family: "q2", actor: null, audience: { kind: "world" }, origin: { kind: "local" }, channel: 1, volume: 1, attenuation: 1, delaySeconds: 0.01 }); };
    delayed(); audio.mix(100); expect(events).toHaveLength(0); audio.stopAll(); audio.mix(500); expect(events).toHaveLength(0);
    delayed(); audio.mix(442);
    expect(events[0]?.kind).toBe("start"); expect(events[0]?.outputSample).toBe(1041);
});
