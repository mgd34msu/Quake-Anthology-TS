import { SeatMediaCaptions } from "../../src/text/media-captions.ts";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioVoiceEvent } from "../../src/audio/types.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { SeatSoundCaptions } from "../../src/app/bootstrap/sound-captions.ts";

test("authored sound captions follow delivered voice time, seat identity and queued stop boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "sound-caption-"));
  await mkdir(join(root, "sound"));
  await Bun.write(join(root, "sound/voice.wav"), new Uint8Array([1]));
  await Bun.write(join(root, "sound/voice.srt"), "1\n00:00:00,000 --> 00:00:02,000\nDoor opening\n");
  const content = "q1:rerelease:baseq1:caption-test", mount = "mount:test:captions";
  const mounts = await openMountPlan({ id: "mount-plan:test:captions", mounts: [{ kind: "loose", rootPath: root, identity: { id: mount, content, generation: 0 } }], defaultOrder: [mount], prefixOrders: [] });
  const owner = createIdentityOwner("voice-caption"), seat = owner.seat(0);
  let receive = (_event: AudioVoiceEvent): void => {}, sample = 0, disposed = false;
  const audio = { observeVoices: (listener: (event: AudioVoiceEvent) => void): (() => void) => { receive = listener; return () => { disposed = true; }; },
    get voiceClock() { return { outputSample: sample, sampleRate: 1000, paused: false }; } };
  const captions = new SeatSoundCaptions(seat, audio, () => "english");
  try {
    const opened = await mounts.open("sound/voice.wav"); if (opened === null) throw new Error("Missing authored sound");
    const sound = { resource: opened.reference.id, reference: opened.reference, name: "sound/voice.wav", pcm: { sampleRate: 1000, channels: 1, frameCount: 2000, samples: new Int16Array(2000), loopStart: null } } satisfies Extract<AudioVoiceEvent, { kind: "start" }>["sound"];
    receive({ kind: "start", seat: owner.seat(1), voiceId: 1, sound, outputSample: 100, sampleRate: 1000, sourceOffsetSeconds: 0 });
    await captions.prepare({ forContent: async id => { expect(id).toBe(content); return mounts; } });
    const preferences = { subtitles: true, soundCaptions: true, speakers: true };
    expect(captions.active(preferences)).toEqual([]);
    receive({ kind: "start", seat, voiceId: 2, sound, outputSample: 100, sampleRate: 1000, sourceOffsetSeconds: 0 });
    await captions.prepare({ forContent: async () => mounts });
    expect(captions.active(preferences)).toEqual([]);
    sample = 100; expect(captions.active(preferences)[0]?.localizedText).toBe("Door opening");
    receive({ kind: "stop", seat, voiceId: 2, outputSample: 600, reason: "replaced" });
    sample = 599; expect(captions.active(preferences).length).toBe(1);
    sample = 600; expect(captions.active(preferences)).toEqual([]);
    receive({ kind: "start", seat, voiceId: 3, sound, outputSample: 600, sampleRate: 1000, sourceOffsetSeconds: 0 });
    await captions.prepare({ forContent: async () => { throw new Error("Repeated sound should reuse authored caption resources"); } });
    expect(captions.active(preferences)[0]?.localizedText).toBe("Door opening");
    await captions.prepare({ forContent: async () => mounts });
  } finally { captions.close(); mounts.close(); await rm(root, { recursive: true, force: true }); }
  expect(disposed).toBe(true);
});

test("active movie captions replace their locale after a live preference change", async () => {
  const owner = createIdentityOwner("movie-language"); let language = "english";
  const failures: unknown[] = [];
  const captions = new SeatMediaCaptions(owner.seat(0), async path => path.endsWith(".srt")
    ? new TextEncoder().encode(`1\n00:00:00,000 --> 00:00:02,000\n${path.includes("_fr") ? "Bonjour" : "Hello"}\n`) : null,
    null, "subtitle", { read: () => language, failed: error => { failures.push(error); } });
  await captions.prepare("intro.cin", language);
  const state = { source: "intro.cin", sourceTimeMilliseconds: 100, status: "playing" } satisfies Parameters<SeatMediaCaptions["active"]>[0];
  const preferences = { subtitles: true, soundCaptions: true, speakers: true };
  expect(captions.active(state, preferences)[0]?.localizedText).toBe("Hello");
  language = "french"; expect(captions.active(state, preferences)).toEqual([]);
  await captions.prepare("intro.cin", language);
  expect(captions.active(state, preferences)[0]?.localizedText).toBe("Bonjour"); expect(failures).toEqual([]);
  captions.clear();
});
