// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioVoiceEvent } from "../../src/audio/types.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { SeatSoundCaptions } from "../../src/app/bootstrap/sound-captions.ts";

type Start = Extract<AudioVoiceEvent, { kind: "start" }>;
const preferences = { subtitles: true, soundCaptions: true, speakers: true };

async function fixture(sidecars: Readonly<Record<string, string>>) {
  const root = await mkdtemp(join(tmpdir(), "sound-caption-table-"));
  await mkdir(join(root, "sound"));
  await Bun.write(join(root, "sound/voice.wav"), new Uint8Array([1]));
  for (const [name, text] of Object.entries(sidecars)) await Bun.write(join(root, name), text);
  const content = "q1:rerelease:baseq1:caption-table",
    mount = "mount:test:caption-table";
  const mounts = await openMountPlan({
    id: "mount-plan:test:caption-table",
    mounts: [{ kind: "loose", rootPath: root, identity: { id: mount, content, generation: 0 } }],
    defaultOrder: [mount],
    prefixOrders: [],
  });
  const opened = await mounts.open("sound/voice.wav");
  if (opened === null) throw new Error("Missing authored sound");
  const sound = {
    resource: opened.reference.id,
    reference: opened.reference,
    name: "sound/voice.wav",
    pcm: { sampleRate: 1000, channels: 1, frameCount: 4000, samples: new Int16Array(4000), loopStart: null },
  } satisfies Start["sound"];
  const owner = createIdentityOwner("voice-caption-table"),
    seat = owner.seat(0);
  let receive = (_event: AudioVoiceEvent): void => {},
    sample = 0,
    paused = false,
    language = "english";
  const audio = {
    observeVoices: (listener: (event: AudioVoiceEvent) => void): (() => void) => {
      receive = listener;
      return () => {};
    },
    get voiceClock() {
      return { outputSample: sample, sampleRate: 1000, paused };
    },
  };
  const captions = new SeatSoundCaptions(seat, audio, () => language);
  const start = (voiceId: number, overrides: Partial<Start> = {}): void =>
    receive({ kind: "start", seat, voiceId, sound, outputSample: 0, sampleRate: 1000, sourceOffsetSeconds: 0, ...overrides });
  return {
    captions,
    mounts,
    start,
    sound,
    seat,
    send: (event: AudioVoiceEvent) => receive(event),
    setSample: (value: number) => {
      sample = value;
    },
    setPaused: (value: boolean) => {
      paused = value;
    },
    setLanguage: (value: string) => {
      language = value;
    },
    prepare: () => captions.prepare({ forContent: async () => mounts }),
    close: async () => {
      captions.close();
      mounts.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const sidecar = "1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond\n";

test("sound captions follow the source offset of a voice that started part-way in", async () => {
  const f = await fixture({ "sound/voice.srt": sidecar });
  try {
    const cases: readonly (readonly [number, number, string | null])[] = [
      [0, 500, "First"],
      [0, 1500, null],
      [2, 500, "Second"],
      [1.5, 600, "Second"],
    ];
    for (const [offsetSeconds, sampleNow, expected] of cases) {
      f.start(10 + Math.round(offsetSeconds * 10) + sampleNow, { sourceOffsetSeconds: offsetSeconds, outputSample: 0 });
      f.setSample(sampleNow);
      await f.prepare();
      const texts = f.captions.active(preferences).map(caption => caption.localizedText);
      expect(texts.includes("First")).toBe(expected === "First");
      expect(texts.includes("Second")).toBe(expected === "Second");
      f.send({ kind: "stop", seat: f.seat, voiceId: 10 + Math.round(offsetSeconds * 10) + sampleNow, outputSample: 0, reason: "ended" });
      await f.prepare();
    }
  } finally {
    await f.close();
  }
});

test("sound captions: voices without a sidecar, without a reference, or already stopped show nothing", async () => {
  const f = await fixture({});
  try {
    f.start(1);
    const { reference: _reference, ...anonymous } = f.sound;
    f.start(2, { sound: anonymous });
    f.setSample(100);
    await f.prepare();
    expect(f.captions.active(preferences)).toEqual([]);
    f.send({ kind: "stop", seat: f.seat, voiceId: 1, outputSample: 50, reason: "ended" });
    await f.prepare();
    expect(f.captions.active(preferences)).toEqual([]);
  } finally {
    await f.close();
  }
});

test("sound captions switch sidecar with the language and report paused playback", async () => {
  const f = await fixture({ "sound/voice.srt": sidecar, "sound/voice_fr.srt": "1\n00:00:00,000 --> 00:00:01,000\nPremier\n" });
  try {
    f.start(1);
    f.setSample(300);
    await f.prepare();
    expect(f.captions.active(preferences)[0]?.localizedText).toBe("First");
    f.setPaused(true);
    expect(f.captions.active(preferences)).toHaveLength(1);
    f.setLanguage("french");
    await f.prepare();
    const french = f.captions.active(preferences).map(caption => caption.localizedText);
    expect(french).toEqual(["Premier"]);
  } finally {
    await f.close();
  }
});

test("a closed sound caption owner holds nothing and ignores later voices", async () => {
  const f = await fixture({ "sound/voice.srt": sidecar });
  f.start(1);
  f.setSample(100);
  await f.prepare();
  expect(f.captions.active(preferences)).toHaveLength(1);
  await f.close();
  expect(f.captions.active(preferences)).toEqual([]);
  await f.prepare();
  expect(f.captions.active(preferences)).toEqual([]);
});
