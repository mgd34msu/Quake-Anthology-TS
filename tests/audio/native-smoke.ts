import { join } from "node:path";
import { UnifiedAudio, MusicPlayer, VorbisPcmStream } from "../../src/audio/index.ts";
const stream = VorbisPcmStream.open(join(import.meta.dir, "../../../qfiles/q1/rerelease/rogue/music/track02.ogg"));
using audio = new UnifiedAudio({ sampleRate: 48000, milliseconds: () => 100, random: () => 123 });
const music = new MusicPlayer(48000, "q1");
music.setVolume(0.25);
music.start(stream, stream);
audio.attachMusic({ id: "cd", audience: { kind: "world" }, gain: 1 }, music);
audio.openDevice({ bufferFrames: 256 });
const queued = audio.pump(4096);
if (queued !== 4096 || audio.outputState !== "playing")
    throw new Error("Unified music did not reach SDL");
audio.pause(true);
const position = audio.sampleClock;
if (audio.pump(4096) !== 0 || audio.sampleClock !== position)
    throw new Error("Paused music advanced");
audio.pause(false);
