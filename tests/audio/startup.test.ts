import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { StartupAudio } from "../../src/app/bootstrap/startup-audio.ts";
import { FrontendPreferences } from "../../src/app/bootstrap/frontend-preferences.ts";
import { menuSoundPath } from "../../src/app/bootstrap/audio/menu.ts";
import { discoverInstalledContent } from "../../src/content/catalog/index.ts";
import { openMountPlan } from "../../src/content/mounts/index.ts";
import { createMountPlanId } from "../../src/contracts/content.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import { ConfigStore } from "../../src/settings/config.ts";
import { loadAudioSettings } from "../../src/app/bootstrap/audio-settings.ts";
import { MountedContent } from "../../src/content/mounts/index.ts";
import type { OpenedResource } from "../../src/content/mounts/index.ts";
import { createContentId, createContentDigest, createMountId, createMountIdentity, createResourceId } from "../../src/contracts/content.ts";
import type { ContentId, GameFamily, ResolvedResourceReference } from "../../src/contracts/content.ts";
import { MusicPlayer } from "../../src/audio/music.ts";
import { MemoryPcmStream } from "../../src/audio/streams.ts";

const evidence = join(import.meta.dir, "../../.artifacts/resume-20260913");
test("frontend audio uses saved gains, preserves selected overrides, and saves the matching product", async () => {
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(join(evidence, "audio-preferences-"));
  try {
    const first = new ConfigStore(join(directory, "first")), second = new ConfigStore(join(directory, "second"));
    await mkdir(first.root, { recursive: true });
    await writeFile(join(first.root, "audio.json"), JSON.stringify({ version: 1, deviceName: null, effectsVolume: 0, musicVolume: 0 }));
    const preferences = new FrontendPreferences(() => "q1-netquake");
    await preferences.loadBaseline(first);
    expect(preferences.audioValues).toEqual({ effectsVolume: 0, musicVolume: 0 });
    preferences.values = { effectsVolume: 0.5, musicVolume: 0.4 };
    await preferences.saveAudioBaseline(first);
    await preferences.loadBaseline(second);
    expect(preferences.audioValues).toEqual({ effectsVolume: 0.5, musicVolume: 0.4 });
    await preferences.saveAudioBaseline(second);
    expect(await loadAudioSettings(first)).toEqual({ deviceName: null, effectsVolume: 0.5, musicVolume: 0.4 });
    expect(await loadAudioSettings(second)).toEqual({ deviceName: null, effectsVolume: 0.5, musicVolume: 0.4 });
    await writeFile(join(second.root, "audio.json"), JSON.stringify({ version: 1, deviceName: "Game-selected output", effectsVolume: 0.5, musicVolume: 0.6 }));
    preferences.values = { effectsVolume: 0.5, musicVolume: 0.6 };
    await preferences.saveAudioBaseline(second);
    expect(await loadAudioSettings(second)).toEqual({ deviceName: "Game-selected output", effectsVolume: 0.5, musicVolume: 0.6 });
    await preferences.loadBaseline(second);
    expect(preferences.audioBaseline.deviceName).toBe("Game-selected output");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test.skipIf(!existsSync(join(import.meta.dir, "../../../qfiles/q3a/baseq3/pak0.pk3")) || !existsSync(join(import.meta.dir, "../../../qfiles/q2/rerelease/baseq2/music/track77.ogg")))("frontend shares real menu PCM and Q2 rerelease title music, with mute and cleanup", async () => {
  const catalog = await discoverInstalledContent({ corpusRoot: join(import.meta.dir, "../../../qfiles"), discoverMods: false, userContentRoot: join(evidence, "unused-user-content") });
  const q3 = catalog.product("q3-baseq3");
  const theme = catalog.products.find(product => product.expectation.family === "q2" && product.expectation.edition === "rerelease" && product.expectation.campaign === "baseq2");
  if (theme === undefined) throw new Error("Q2 rerelease test corpus missing");
  const mount = async (id: typeof q3.id) => {
    const mounts = await catalog.mountsFor(id);
    return openMountPlan({ id: createMountPlanId("startup-test", id.replaceAll(":", "-")), mounts, defaultOrder: mounts.map(value => value.identity.id), prefixOrders: [] });
  };
  const cues = await mount(q3.id), themeMounts = await mount(theme.id);
  const seat = createIdentityOwner("startup-audio-test").seat(0);
  try {
    for (const withTheme of [true, false]) {
      const audio = await StartupAudio.open({ mounts: cues, content: q3.id, family: "q3", seat, print: () => undefined,
        preferences: { effectsVolume: 0, musicVolume: 0 }, theme: withTheme ? { mounts: themeMounts, content: theme.id } : null });
      try {
        audio.sound("open"); expect(audio.engine.mix(4096).every(value => value === 0)).toBe(true);
        audio.setVolumes(0, 0.4);
        const music = audio.engine.mix(8192);
        expect(music.some(value => value !== 0)).toBe(true);
        audio.setVolumes(0.7, 0); audio.sound("move");
        expect(audio.engine.mix(4096).some(value => value !== 0)).toBe(true);
        audio.setVolumes(0, 0); audio.sound("close");
        expect(audio.engine.mix(4096).every(value => value === 0)).toBe(true);
      } finally { audio.close(); audio.close(); }
      expect(audio.engine.outputState).toBe("closed");
      audio.sound("open"); audio.pump();
    }
    expect(menuSoundPath("q1", "open")).toBe("misc/menu2.wav");
    expect(menuSoundPath("q1", "move")).toBe("misc/menu1.wav");
    expect(menuSoundPath("q1", "change")).toBe("misc/menu3.wav");
  } finally { cues.close(); themeMounts.close(); }
}, 60000);


function menuWave(sample: number): Uint8Array {
  const bytes = new Uint8Array(44 + 64), view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(value), offset); };
  tag(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, 64, true);
  for (let offset = 44; offset < bytes.length; offset += 2) view.setInt16(offset, sample, true);
  return bytes;
}

class MenuMemoryMounts extends MountedContent {
  constructor(readonly content: ContentId, private readonly files: ReadonlyMap<string, Uint8Array>) {
    super({ id: createMountPlanId("menu-memory", content.replaceAll(":", "-")), mounts: [], defaultOrder: [], prefixOrders: [] }, []);
  }
  override async open(path: string): Promise<OpenedResource | null> {
    this.assertOpen();
    const bytes = this.files.get(path); if (bytes === undefined) return null;
    const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, byteLength: bytes.length,
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      provenance: { kind: "loose", memberPath: path, mount: { kind: "loose", rootPath: "/menu-memory",
        identity: createMountIdentity(createMountId("menu-memory", this.content.replaceAll(":", "-")), this.content, 0) } },
      resolution: { kind: "default-order", plan: this.plan.id, rank: 0 } };
    return { bytes, reference: { ...record, id: createResourceId(record) } };
  }
}

const menuFixtures: readonly { readonly family: GameFamily; readonly path: string }[] = [
  { family: "q1", path: "music/track02.wav" }, { family: "q2", path: "music/02.wav" },
  { family: "q2", path: "music/track02.wav" }, { family: "q3", path: "music/sonic5.wav" },
];

test("in-memory menu fallback uses each mounted family, loops once, and respects immediate mute", async () => {
  for (const fixture of menuFixtures) {
    const content = createContentId({ family: fixture.family, edition: "test", package: "menu", revision: "1" });
    const mounts = new MenuMemoryMounts(content, new Map([[fixture.path, menuWave(1000)]]));
    const messages: string[] = [];
    const audio = await StartupAudio.open({ mounts, content, family: fixture.family, theme: null,
      seat: createIdentityOwner("menu-fallback").seat(0), print: text => { messages.push(text); }, preferences: { effectsVolume: 0, musicVolume: 0 } });
    try {
      expect(audio.engine.outputState).toBe("detached");
      expect(audio.engine.mix(64).every(sample => sample === 0)).toBe(true);
      audio.setVolumes(0, 0.25);
      expect([...new Set(audio.engine.mix(256))]).toEqual([250]);
      expect([...new Set(audio.engine.mix(256))]).toEqual([250]);
      audio.setVolumes(0, 0);
      expect(audio.engine.mix(64).every(sample => sample === 0)).toBe(true);
      expect(messages).toEqual([]);
      expect(mounts.content).toBe(content);
    } finally { audio.close(); audio.close(); }
    expect(audio.engine.outputState).toBe("closed");
    mounts.assertOpen(); mounts.close();
  }
});

test("in-memory menu prefers rerelease theme and falls back only when it is missing", async () => {
  const content = createContentId({ family: "q1", edition: "test", package: "base", revision: "1" });
  const themeContent = createContentId({ family: "q2", edition: "test", package: "theme", revision: "1" });
  for (const themePresent of [true, false]) {
    const mounts = new MenuMemoryMounts(content, new Map([["music/track02.wav", menuWave(1000)]]));
    const theme = new MenuMemoryMounts(themeContent, new Map(themePresent ? [["music/track77.wav", menuWave(2000)]] : []));
    const started = spyOn(MusicPlayer.prototype, "start");
    const audio = await StartupAudio.open({ mounts, content, family: "q1", theme: { mounts: theme, content: themeContent },
      seat: createIdentityOwner("menu-preference").seat(0), print: () => undefined, preferences: { effectsVolume: 0, musicVolume: 0.25 } });
    try {
      expect([...new Set(audio.engine.mix(256))]).toEqual([themePresent ? 500 : 250]);
      expect(started).toHaveBeenCalledTimes(1);
    } finally { audio.close(); started.mockRestore(); mounts.close(); theme.close(); }
  }
});

test("in-memory menu with no supported soundtrack remains silent and closes cleanly", async () => {
  const content = createContentId({ family: "q1", edition: "test", package: "missing", revision: "1" });
  const mounts = new MenuMemoryMounts(content, new Map([["music/track02.mp3", new Uint8Array([1, 2, 3])]]));
  const messages: string[] = [];
  const audio = await StartupAudio.open({ mounts, content, family: "q1", theme: null,
    seat: createIdentityOwner("menu-missing").seat(0), print: text => { messages.push(text); }, preferences: { musicVolume: 1 } });
  try { expect(audio.engine.mix(256).every(sample => sample === 0)).toBe(true); expect(messages).toEqual([]); }
  finally { audio.close(); mounts.close(); }
});


test("in-memory menu gain is immediate while default Q3 source smoothing remains unchanged", () => {
  const stream = (): MemoryPcmStream => new MemoryPcmStream({ samples: new Int16Array(32).fill(1000),
    channels: 1, sampleRate: 44100, frameCount: 32, loopStart: null });
  const source = new MusicPlayer(44100, "q3"), menu = new MusicPlayer(44100, "q3", "immediate");
  try {
    const sourceStream = stream(), menuStream = stream();
    source.start(sourceStream, sourceStream); menu.start(menuStream, menuStream);
    source.setVolume(0.25); menu.setVolume(0.25);
    expect(source.volume).toBe(0.5); expect(menu.volume).toBe(0.25);
    source.update(); menu.update();
    expect(source.volume).toBe(0.25); expect(menu.volume).toBe(0.25);
    source.setVolume(0); menu.setVolume(0); source.update(); menu.update();
    expect(source.volume).toBe(0.0625); expect(menu.volume).toBe(0);
    expect(menu.mix(64).every(sample => sample === 0)).toBe(true);
  } finally { source.close(); menu.close(); }
});
