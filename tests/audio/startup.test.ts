import { defaultAudioOutputFormat } from "../../src/audio/output.ts";
import { bindMusicPlaylistSettings } from "../../src/ui/settings/index.ts";
import { registerMusicSettings } from "../../src/app/bootstrap/audio/playlist-settings.ts";
import { readMusicSettings } from "../../src/app/bootstrap/audio/playlist-settings.ts";
import { mountedMusicTracks } from "../../src/app/bootstrap/audio/playlist.ts";
import { saveAudioSettings } from "../../src/app/bootstrap/audio-settings.ts";
import { PreparedStartup } from "../../src/app/bootstrap/prepared-startup.ts";
import { ConsoleScriptFiles } from "../../src/app/bootstrap/config-scripts.ts";
import { CvarRegistry } from "../../src/core/cvars/index.ts";
import type { CommandContext, CommandDialect } from "../../src/contracts/common.ts";
import { expect, spyOn, test } from "bun:test";
import { ApplicationMusic, worldMusicTrack } from "../../src/app/bootstrap/audio/music.ts";
import { SoundBank, UnifiedAudio, remapQ2MusicTrack } from "../../src/audio/index.ts";
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
import type { PcmStream } from "../../src/audio/streams.ts";
import { CdMusic, MusicControls, MusicPlayer } from "../../src/audio/music.ts";
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
    expect(await loadAudioSettings(first)).toEqual({ deviceName: null, outputFormat: defaultAudioOutputFormat, effectsVolume: 0.5, musicVolume: 0.4, musicShuffle: false, menuTrack: "auto" });
    expect(await loadAudioSettings(second)).toEqual({ deviceName: null, outputFormat: defaultAudioOutputFormat, effectsVolume: 0.5, musicVolume: 0.4, musicShuffle: false, menuTrack: "auto" });
    await writeFile(join(second.root, "audio.json"), JSON.stringify({ version: 1, deviceName: "Game-selected output", effectsVolume: 0.5, musicVolume: 0.6 }));
    preferences.values = { effectsVolume: 0.5, musicVolume: 0.6 };
    await preferences.saveAudioBaseline(second);
    expect(await loadAudioSettings(second)).toEqual({ deviceName: "Game-selected output", outputFormat: defaultAudioOutputFormat, effectsVolume: 0.5, musicVolume: 0.6, musicShuffle: false, menuTrack: "auto" });
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
      const audio = await StartupAudio.open({ mounts: cues, source: { content: q3.id, ...q3.expectation }, seat, print: () => undefined,
        preferences: { effectsVolume: 0, musicVolume: 0 }, theme: withTheme ? { mounts: themeMounts, source: { content: theme.id, ...theme.expectation } } : null });
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
  override async listFiles(path: string, extension: string): Promise<readonly string[]> {
    return [...this.files.keys()].filter(name => name.startsWith(path + "/") && name.endsWith(extension)).map(name => name.slice(path.length + 1));
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
    const audio = await StartupAudio.open({ mounts, source: { content, family: fixture.family, edition: "classic", campaign: "base" }, theme: null,
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
    const audio = await StartupAudio.open({ mounts, source: { content, family: "q1", edition: "classic", campaign: "id1" }, theme: { mounts: theme, source: { content: themeContent, family: "q2", edition: "rerelease", campaign: "baseq2" } },
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
  const audio = await StartupAudio.open({ mounts, source: { content, family: "q1", edition: "classic", campaign: "id1" }, theme: null,
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


test("soundtrack source edition preserves classic expansion discs and remaps rerelease cues", async () => {
  expect(remapQ2MusicTrack(14, { kind: "remastered", campaign: "xatrix" })).toBe(14);
  expect(remapQ2MusicTrack(6, { kind: "remastered", campaign: "baseq2" })).toBe(6);
  for (const campaign of ["xatrix", "rogue"]) for (const edition of ["classic", "rerelease"]) {
    const content = createContentId({ family: "q2", edition, package: campaign, revision: "1" });
    const mounts = new MenuMemoryMounts(content, new Map([["music/06.wav", menuWave(1000)], ["music/16.wav", menuWave(2000)]]));
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    const music = new ApplicationMusic(engine, () => undefined);
    try {
      await music.play({ content, family: "q2", edition, campaign }, new SoundBank(mounts), "6");
      expect([...new Set(engine.mix(256))]).toEqual([edition === "classic" ? 250 : 500]);
      expect([...new Set(engine.mix(256))]).toEqual([edition === "classic" ? 250 : 500]);
      expect(engine.outputState).toBe("detached");
    } finally { music.stop(); mounts.close(); }
  }
});

test("soundtrack profiles preserve base Q2, Q1 numbers, and named Q3 intro loops", async () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly GameFamily[]) {
    const content = createContentId({ family, edition: "classic", package: "base", revision: "1" });
    const mounts = new MenuMemoryMounts(content, new Map([["music/06.wav", menuWave(1000)],
      ["music/intro.wav", menuWave(1000)], ["music/loop.wav", menuWave(2000)]]));
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    const music = new ApplicationMusic(engine, () => undefined, "immediate");
    try {
      await music.play({ content, family, edition: "classic", campaign: "baseq2" }, new SoundBank(mounts),
        family === "q3" ? "music/intro.wav music/loop.wav" : "6");
      expect([...new Set(engine.mix(32))]).toEqual([250]);
      expect([...new Set(engine.mix(128))]).toEqual([family === "q3" ? 500 : 250]);
      music.stop(); expect(engine.mix(16).every(sample => sample === 0)).toBe(true);
    } finally { music.stop(); mounts.close(); }
  }
});

test("world music honors rerelease named override without changing classic or Q3 cue rules", () => {
  const world = new Map([["sounds", "6"], ["music", "music/custom.ogg"]]);
  expect(worldMusicTrack(world, { family: "q2", edition: "rerelease" })).toBe("music/custom.ogg");
  expect(worldMusicTrack(world, { family: "q2", edition: "classic" })).toBe("6");
  expect(worldMusicTrack(world, { family: "q1", edition: "rerelease" })).toBe("6");
  expect(worldMusicTrack(world, { family: "q3", edition: "classic" })).toBe("music/custom.ogg");
  world.set("music", "");
  expect(worldMusicTrack(world, { family: "q2", edition: "rerelease" })).toBe("6");
  expect(worldMusicTrack(world, { family: "q3", edition: "classic" })).toBe("");
  world.set("music", "0");
  expect(worldMusicTrack(world, { family: "q2", edition: "rerelease" })).toBe("0");
  expect(worldMusicTrack(undefined, { family: "q2", edition: "rerelease" })).toBe("");
});

test("cd pause resume info preserves authored PCM position, loops and gain", async () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly GameFamily[]) {
    const content = createContentId({ family, edition: "test", package: "cd-command", revision: "1" });
    const wave = menuWave(1000), view = new DataView(wave.buffer);
    for (let frame = 0; frame < 32; frame++) view.setInt16(44 + frame * 2, (frame + 1) * 100, true);
    using mounts = new MenuMemoryMounts(content, new Map([["music/06.wav", wave], ["music/intro.wav", wave], ["music/loop.wav", menuWave(2000)]]));
    using actual = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    using control = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    const lines: string[] = [], music = new ApplicationMusic(actual, text => { lines.push(text); });
    const reference = new ApplicationMusic(control, () => undefined), bank = new SoundBank(mounts);
    const opening = spyOn(bank, "openMusic");
    const source = { content, family, edition: "classic", campaign: "base" };
    const track = family === "q3" ? "music/intro.wav music/loop.wav" : "6";
    try {
      await music.cdCommand(["pause"]); // An idle command must not pause the next authored track.
      await music.play(source, bank, track); await reference.play(source, new SoundBank(mounts), track);
      const opens = opening.mock.calls.length;
      expect(actual.mix(4)).toEqual(control.mix(4));
      await music.cdCommand(["PAUSE"]); await music.cdCommand(["pause"]);
      await music.cdCommand(["info"]);
      expect(lines.at(-2)).toBe(`Paused looping track ${track}\n`);
      expect(lines.at(-1)).toBe("Volume is 0.25\n");
      expect(actual.mix(96).every(sample => sample === 0)).toBe(true);
      music.volume = 0.5; reference.volume = 0.5;
      await music.cdCommand(["RESUME"]); await music.cdCommand(["resume"]);
      expect(actual.mix(96)).toEqual(control.mix(96));
      expect(opening.mock.calls.length).toBe(opens);
      await music.cdCommand(["info"]);
      expect(lines.at(-2)).toBe(`Currently looping track ${track}\n`);
      expect(lines.at(-1)).toBe("Volume is 0.5\n");
      await music.cdCommand(["pause"]); music.stop();
      await music.play(source, bank, track);
      expect(actual.mix(8).some(sample => sample !== 0)).toBe(true);
      music.stop(); await music.cdCommand(["info"]);
      expect(lines.slice(-2)).toEqual(["Not playing.\n", "Volume is 0.5\n"]);
    } finally { opening.mockRestore(); music.stop(); reference.stop(); }
  }
});

test("frontend cd commands control the existing menu music and retain mute", async () => {
  const content = createContentId({ family: "q2", edition: "test", package: "menu-cd", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)]]));
  const lines: string[] = [];
  const audio = await StartupAudio.open({ mounts, source: { content, family: "q2", edition: "classic", campaign: "baseq2" }, theme: null,
    seat: createIdentityOwner("menu-cd").seat(0), print: () => undefined, preferences: { musicVolume: 0.25 } });
  try {
    expect(audio.engine.outputState).toBe("detached");
    expect([...new Set(audio.engine.mix(16))]).toEqual([250]);
    await audio.cdCommand(["pause"], text => { lines.push(text); });
    expect(audio.engine.mix(32).every(sample => sample === 0)).toBe(true);
    audio.setVolumes(0.7, 0);
    await audio.cdCommand(["resume"], text => { lines.push(text); });
    expect(audio.engine.mix(32).every(sample => sample === 0)).toBe(true);
    audio.setVolumes(0.7, 0.25);
    expect([...new Set(audio.engine.mix(64))]).toEqual([250]);
    await audio.cdCommand(["info"], text => { lines.push(text); });
    expect(lines).toEqual(["Currently looping track music/02.wav\n", "Volume is 0.25\n"]);
    audio.close(); await audio.cdCommand(["info"], text => { lines.push(text); });
    expect(lines.length).toBe(2);
  } finally { audio.close(); }
});

test("retained cd registration routes Q1 QW Q2 Q3 frontend commands and survives owner forwarding", async () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const identity = createIdentityOwner("frontend-cd-registry"), context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
    const cvars = new CvarRegistry({ dialect, context }), output: string[] = [];
    const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
    const prepared = new PreparedStartup(cvars, cvars, scripts, { dialect, movementDialect: dialect, seats: [], shared: null,
      sharedNames: [], print: text => { output.push(text); }, forward: () => undefined });
    const content = createContentId({ family: "q2", edition: "test", package: "registered-cd", revision: "1" });
    using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)]]));
    const audio = await StartupAudio.open({ mounts, source: { content, family: "q2", edition: "classic", campaign: "baseq2" }, theme: null,
      seat: identity.seat(0), print: () => undefined, preferences: { musicVolume: 0.25 } });
    const forwarded: string[] = [];
    const frontend = (name: string, args: readonly string[]): undefined => {
      forwarded.push(name); if (name === "cd") audio.queueCdCommand(args, text => { output.push(text); }); return undefined;
    };
    try {
      prepared.forwardCommands(frontend);
      expect(prepared.commands.registeredNames().filter(name => name === "cd")).toEqual(["cd"]);
      expect(prepared.commands.commandDocumentation("cd")?.usage).toContain("cd <play|loop> <track>");
      prepared.commands.append("cd pause" + "\n", context);
      await prepared.commands.executeAsync(() => audio.flushCommands());
      expect(audio.engine.mix(32).every(sample => sample === 0)).toBe(true);
      prepared.commands.append("cd info" + "\n", context);
      await prepared.commands.executeAsync(() => audio.flushCommands());
      expect(output).toContain("Paused looping track music/02.wav\n");
      const world: string[] = [];
      prepared.forwardCommands((name, args) => { world.push(`${name} ${args.join(" ")}`); return undefined; });
      prepared.commands.append("cd resume" + "\n", context);
      await prepared.commands.executeAsync(() => audio.flushCommands());
      expect(world).toEqual(["cd resume"]);
      expect(audio.engine.mix(32).every(sample => sample === 0)).toBe(true);
      prepared.forwardCommands(frontend);
      prepared.commands.append("cd resume" + "\n", context);
      await prepared.commands.executeAsync(() => audio.flushCommands());
      expect([...new Set(audio.engine.mix(64))]).toEqual([250]);
      expect(prepared.commands.registeredNames().filter(name => name === "cd")).toEqual(["cd"]);
      expect(forwarded).toEqual(["cd", "cd", "cd"]);
      expect(output.some(line => /unknown|already|allready/i.test(line))).toBe(false);
    } finally { audio.close(); }
  }
});

test("cd numbered controls retain silent source, remap atomically, stop and disable automatic playback", async () => {
  const content = createContentId({ family: "q2", edition: "test", package: "cd-full", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)], ["music/03.wav", menuWave(2000)]]));
  using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const lines: string[] = [], music = new ApplicationMusic(engine, text => { lines.push(text); }), bank = new SoundBank(mounts);
  const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
  try {
    await music.play(source, bank, "0");
    await music.cdCommand(["loop", "2"]); expect([...new Set(engine.mix(96))]).toEqual([250]);
    await music.cdCommand(["remap", "1", "3"]); await music.cdCommand(["loop", "2"]);
    expect([...new Set(engine.mix(64))]).toEqual([500]);
    await music.cdCommand(["remap", "1", "2"]); await music.cdCommand(["loop", "2"]);
    expect([...new Set(engine.mix(64))]).toEqual([250]);
    await music.cdCommand(["stop"]); expect(engine.mix(16).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["play", "3"]); expect([...new Set(engine.mix(32))]).toEqual([500]);
    expect(engine.mix(32).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["remap", "3", "3"]);
    await music.cdCommand(["remap", "2", "999"]);
    await music.cdCommand(["remap"]);
    expect(lines.slice(-2)).toEqual(["  1 -> 3\n", "  2 -> 3\n"]);
    await music.cdCommand(["loop", "2"]); expect([...new Set(engine.mix(96))]).toEqual([500]);
    await music.cdCommand(["off"]);
    await music.play(source, bank, "2"); await music.cdCommand(["play", "3"]);
    expect(engine.mix(96).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["on"]); expect(engine.mix(16).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["loop", "2"]); expect([...new Set(engine.mix(64))]).toEqual([500]);
    await music.cdCommand(["off"]); await music.cdCommand(["reset"]);
    expect(engine.mix(16).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["loop", "2"]); expect([...new Set(engine.mix(64))]).toEqual([250]);
    expect(music.volume).toBe(0.25);
    await music.cdCommand(["eject"]); expect(lines.at(-1)).toContain("unavailable with file-backed music");
    expect([...new Set(engine.mix(64))]).toEqual([250]);
  } finally { music.stop(); }
});

test("CdMusic validates the complete remap before changing its table", () => {
  const player = new MusicPlayer(44100, "q2"), cd = new CdMusic(player, async () => null);
  cd.setRemap([3, 4]);
  expect(() => cd.setRemap([2, 999])).toThrow("Invalid CD track");
  expect(cd.remappedTracks.slice(0, 3)).toEqual([3, 4, 3]);
  cd.close();
});

test("cd pending opens are cancelled by stop off reset retirement and source replacement", async () => {
  for (const action of ["stop", "off", "reset", "retire", "replace", "missing-after-stop"]) {
    const content = createContentId({ family: "q2", edition: "test", package: "pending-cd", revision: "1" });
    using mounts = new MenuMemoryMounts(content, new Map<string, Uint8Array>());
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    let release: ((value: PcmStream | null) => void) | undefined;
    const opened: string[] = [];
    class PendingBank extends SoundBank {
      override openMusic(path: string): Promise<PcmStream | null> {
        opened.push(path); return new Promise(resolve => { release = resolve; });
      }
    }
    const music = new ApplicationMusic(engine, () => undefined), bank = new PendingBank(mounts);
    const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
    const stream = new MemoryPcmStream({ samples: new Int16Array(32).fill(1000), channels: 1, sampleRate: 44100, frameCount: 32, loopStart: null });
    const closed = spyOn(stream, "close");
    try {
      await music.play(source, bank, "0");
      const pending = music.cdCommand(["loop", "2"]);
      if (release === undefined) throw new Error("Track open did not begin");
      if (action === "retire") music.stop();
      else if (action === "replace") music.select(source, new SoundBank(mounts));
      else await music.cdCommand([action === "missing-after-stop" ? "stop" : action]);
      release(action === "missing-after-stop" ? null : stream); await pending;
      expect(opened).toEqual(["music/02.ogg"]);
      expect(closed.mock.calls.length).toBe(action === "missing-after-stop" ? 0 : 1);
      expect(engine.mix(32).every(sample => sample === 0)).toBe(true);
    } finally { music.stop(); closed.mockRestore(); stream.close(); }
  }
});

test("registered frontend cd commands await track opens in order with no automatic menu cue", async () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const identity = createIdentityOwner("ordered-cd"), context: CommandContext = { session: identity.session, origin: { kind: "server-console" } };
    const cvars = new CvarRegistry({ dialect, context }), output: string[] = [];
    const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
    const prepared = new PreparedStartup(cvars, cvars, scripts, { dialect, movementDialect: dialect, seats: [], shared: null,
      sharedNames: [], print: text => { output.push(text); }, forward: () => undefined });
    const content = createContentId({ family: "q2", edition: "test", package: "no-menu-cue", revision: "1" });
    using mounts = new MenuMemoryMounts(content, new Map([["music/03.wav", menuWave(2000)]]));
    const audio = await StartupAudio.open({ mounts, source: { content, family: "q2", edition: "classic", campaign: "baseq2" }, theme: null,
      seat: identity.seat(0), print: () => undefined, preferences: { musicVolume: 0.25 } });
    try {
      expect(audio.engine.mix(16).every(sample => sample === 0)).toBe(true);
      prepared.forwardCommands((name, args) => { if (name === "cd") audio.queueCdCommand(args, text => { output.push(text); }); return undefined; });
      prepared.commands.append("cd play 3; cd info\n", context);
      await prepared.commands.executeScriptsAsync(() => audio.flushCommands());
      expect(output).toEqual(["Currently playing track 3\n", "Volume is 0.25\n"]);
      expect([...new Set(audio.engine.mix(32))]).toEqual([500]);
      expect(audio.engine.mix(32).every(sample => sample === 0)).toBe(true);
      prepared.commands.append("cd loop 3; cd pause; cd info; cd resume\n", context);
      await prepared.commands.executeScriptsAsync(() => audio.flushCommands());
      expect(output.slice(-2)).toEqual(["Paused looping track 3\n", "Volume is 0.25\n"]);
      expect([...new Set(audio.engine.mix(96))]).toEqual([500]);
      audio.queueCdCommand(["loop", "3"], text => { output.push(text); });
      audio.close(); await audio.flushCommands();
    } finally { audio.close(); }
  }
});

test("manual cd tracks preserve selected Q2 edition mapping and Q1 fallback", async () => {
  for (const edition of ["classic", "rerelease"]) {
    const content = createContentId({ family: "q2", edition, package: "rogue", revision: "test" });
    using mounts = new MenuMemoryMounts(content, new Map([["music/06.wav", menuWave(1000)], ["music/16.wav", menuWave(2000)]]));
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    const music = new ApplicationMusic(engine, () => undefined);
    try {
      await music.play({ content, family: "q2", edition, campaign: "rogue" }, new SoundBank(mounts), "0");
      await music.cdCommand(["loop", "6"]);
      expect([...new Set(engine.mix(64))]).toEqual([edition === "classic" ? 250 : 500]);
    } finally { music.stop(); }
  }
  const content = createContentId({ family: "q1", edition: "classic", package: "id1", revision: "test" });
  using mounts = new MenuMemoryMounts(content, new Map<string, Uint8Array>()), alternate = new MenuMemoryMounts(content, new Map([["music/track03.wav", menuWave(1200)]]));
  using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const music = new ApplicationMusic(engine, () => undefined), bank = new SoundBank(alternate);
  try {
    await music.play({ content, family: "q1", edition: "classic", campaign: "id1" }, new SoundBank(mounts), "0", path => bank.openMusic(path));
    await music.cdCommand(["loop", "3"]);
    expect([...new Set(engine.mix(64))]).toEqual([300]);
    await music.cdCommand(["stop"]); await music.cdCommand(["play", "3"]);
    expect([...new Set(engine.mix(32))]).toEqual([300]);
    expect(engine.mix(32).every(sample => sample === 0)).toBe(true);
  } finally { music.stop(); }
});

test("shared client music controls survive dormant menu and replacement owners without moving gain", async () => {
  const controls = new MusicControls(), content = createContentId({ family: "q2", edition: "test", package: "shared-cd", revision: "1" });
  const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)], ["music/03.wav", menuWave(2000)]]));
  const menu = await StartupAudio.open({ mounts, source, musicControls: controls, theme: null,
    seat: createIdentityOwner("shared-cd").seat(0), print: () => undefined, preferences: { musicVolume: 0.25 } });
  using localEngine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  using replacementEngine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const local = new ApplicationMusic(localEngine, () => undefined, "source", controls);
  const replacement = new ApplicationMusic(replacementEngine, () => undefined, "source", controls);
  try {
    expect([...new Set(menu.engine.mix(32))]).toEqual([250]);
    local.volume = 0.5; await local.play(source, new SoundBank(mounts), "0");
    await local.cdCommand(["remap", "1", "3"]); await local.cdCommand(["loop", "2"]);
    expect([...new Set(localEngine.mix(64))]).toEqual([1000]);
    await local.cdCommand(["off"]);
    expect(menu.engine.mix(64).every(sample => sample === 0)).toBe(true);
    expect(localEngine.mix(64).every(sample => sample === 0)).toBe(true);
    local.stop();
    await replacement.play(source, new SoundBank(mounts), "2");
    expect(replacementEngine.mix(64).every(sample => sample === 0)).toBe(true);
    expect(controls.remappedTracks[1]).toBe(3);
    await replacement.cdCommand(["on"]);
    expect(replacementEngine.mix(64).every(sample => sample === 0)).toBe(true);
    await replacement.cdCommand(["loop", "2"]);
    expect([...new Set(replacementEngine.mix(64))]).toEqual([500]);
    await replacement.cdCommand(["stop"]);
    await menu.cdCommand(["stop"], () => undefined);
    await replacement.cdCommand(["reset"]);
    expect(menu.engine.mix(32).every(sample => sample === 0)).toBe(true);
    expect(replacementEngine.mix(32).every(sample => sample === 0)).toBe(true);
    await menu.cdCommand(["loop", "2"], () => undefined);
    expect([...new Set(menu.engine.mix(64))]).toEqual([250]);
    expect(local.volume).toBe(0.5); expect(replacement.volume).toBe(0.25);
  } finally { menu.close(); local.stop(); replacement.stop(); }
});

test("standalone music controls remain independent", async () => {
  const content = createContentId({ family: "q2", edition: "test", package: "standalone-cd", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)]]));
  using firstEngine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  using secondEngine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const first = new ApplicationMusic(firstEngine, () => undefined), second = new ApplicationMusic(secondEngine, () => undefined);
  const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
  try {
    expect(first.controls).not.toBe(second.controls);
    await first.play(source, new SoundBank(mounts), "2"); await second.play(source, new SoundBank(mounts), "2");
    await first.cdCommand(["off"]);
    expect(firstEngine.mix(32).every(sample => sample === 0)).toBe(true);
    expect([...new Set(secondEngine.mix(64))]).toEqual([250]);
    await second.cdCommand(["remap", "3", "3"]);
    expect(first.controls.remappedTracks[1]).toBe(2);
  } finally { first.stop(); second.stop(); }
});

test("explicit cd play and loop change the same cue mode and info reports disabled remaps", async () => {
  const controls = new MusicControls(), content = createContentId({ family: "q2", edition: "test", package: "cd-mode", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)], ["music/03.wav", menuWave(2000)]]));
  using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const lines: string[] = [], music = new ApplicationMusic(engine, text => { lines.push(text); }, "source", controls);
  const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
  try {
    await music.play(source, new SoundBank(mounts), "2");
    expect([...new Set(engine.mix(64))]).toEqual([250]);
    await music.cdCommand(["play", "2"]);
    expect([...new Set(engine.mix(32))]).toEqual([250]);
    expect(engine.mix(32).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["play", "2"]); engine.mix(8);
    await music.cdCommand(["loop", "2"]);
    expect([...new Set(engine.mix(96))]).toEqual([250]);
    await music.cdCommand(["remap", "1", "3"]); await music.cdCommand(["loop", "2"]);
    await music.cdCommand(["info"]);
    expect(lines.at(-2)).toBe("Currently looping track 2 (mapped to 3)\n");
    controls.enabled = false;
    expect(engine.mix(32).every(sample => sample === 0)).toBe(true);
    await music.cdCommand(["info"]);
    expect(lines.slice(-2)).toEqual(["CD music is disabled.\n", "Volume is 0.25\n"]);
  } finally { music.stop(); }
});

test("playlist canonical aliases menu choices persisted settings and actual menu PCM share one owner", async () => {
  const identity = createIdentityOwner("playlist-menu"), content = createContentId({ family: "q2", edition: "test", package: "playlist", revision: "1" });
  const cvars = new CvarRegistry({ dialect: "q2-classic", context: { session: identity.session, origin: { kind: "local-seat", seat: identity.seat(0), client: identity.client(0, 0) } } });
  registerMusicSettings(cvars);
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)], ["music/track77.wav", menuWave(2000)], ["music/nested/title theme.wav", menuWave(3000)], ["music/unsupported.mp3", new Uint8Array()]]));
  const audio = await StartupAudio.open({ mounts, source: { content, family: "q2", edition: "classic", campaign: "baseq2" }, theme: null,
    seat: identity.seat(0), print: () => undefined, preferences: { effectsVolume: 0, musicVolume: 0.25 } });
  audio.bindOutputCvars(cvars);
  try {
    expect(audio.engine.outputState).toBe("detached");
    expect([...new Set(audio.engine.mix(64))]).toEqual([250]);
    const bindings = bindMusicPlaylistSettings(cvars, () => audio.musicTracks), choice = bindings.find(binding => binding.id === "ui:audio:menu-track"), shuffle = bindings.find(binding => binding.id === "ui:audio:shuffle");
    if (choice?.kind !== "choice" || shuffle?.kind !== "toggle") throw new Error("Music options missing");
    expect(choice.choices().map(value => value.id)).toEqual(["auto", "0", "music/02.wav", "music/nested/title theme.wav", "music/track77.wav"]);
    choice.write("music/nested/title theme.wav"); await audio.flushCommands();
    expect(cvars.variableString("ogg_menu_track")).toBe("music/nested/title theme.wav");
    expect([...new Set(audio.engine.mix(64))]).toEqual([750]);
    cvars.set("ogg_menu_track", "77"); await audio.flushCommands();
    expect([...new Set(audio.engine.mix(64))]).toEqual([500]);
    expect(choice.choices().some(value => value.id === "77")).toBe(true);
    cvars.set("ogg_menu_track", "0"); await audio.flushCommands();
    expect(audio.engine.mix(64).every(value => value === 0)).toBe(true);
    choice.write("auto"); await audio.flushCommands();
    expect([...new Set(audio.engine.mix(64))]).toEqual([250]);
    shuffle.write(true); expect(cvars.variableString("ogg_shuffle")).toBe("1");
    cvars.set("ogg_menu_track", "music/missing.wav"); await audio.flushCommands();
    expect(choice.choices().some(value => value.id === "music/missing.wav")).toBe(true);
    expect(audio.engine.mix(64).every(value => value === 0)).toBe(true);
    expect(await mountedMusicTracks(mounts)).toEqual(audio.musicTracks);
    await mkdir(evidence, { recursive: true });
    const directory = await mkdtemp(join(evidence, "playlist-settings-"));
    try {
      const store = new ConfigStore(directory), preferences = new FrontendPreferences(() => "q2-classic");
      preferences.bindings(undefined, () => readMusicSettings(cvars));
      await preferences.saveAudioBaseline(store);
      expect(await loadAudioSettings(store)).toMatchObject({ musicShuffle: true, menuTrack: "music/missing.wav" });
      await saveAudioSettings(store, { selectedOutput: null, effectsVolume: 0.7, musicVolume: 0.25 });
      expect(await loadAudioSettings(store)).toMatchObject({ musicShuffle: true, menuTrack: "music/missing.wav" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { audio.close(); }
});

test("playlist gameplay advances on real EOF, avoids repeats, preserves pause mute and manual override", async () => {
  const content = createContentId({ family: "q2", edition: "test", package: "shuffle", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)], ["music/03.wav", menuWave(2000)]]));
  using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const controls = new MusicControls(), music = new ApplicationMusic(engine, () => undefined, "source", controls, () => 0.99), bank = new SoundBank(mounts);
  const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
  const playlist = { shuffle: true, tracks: await mountedMusicTracks(mounts) };
  const started = spyOn(MusicPlayer.prototype, "start");
  try {
    await music.play(source, bank, "2", null, playlist);
    expect(started).toHaveBeenCalledTimes(1);
    await music.updateAutomatic(true); expect(started).toHaveBeenCalledTimes(1);
    await music.cdCommand(["pause"]); expect(engine.mix(64).every(value => value === 0)).toBe(true);
    await music.updateAutomatic(true); expect(started).toHaveBeenCalledTimes(1);
    await music.cdCommand(["resume"]); music.volume = 0;
    expect(engine.mix(64).every(value => value === 0)).toBe(true);
    await music.updateAutomatic(true); expect(started).toHaveBeenCalledTimes(1);
    music.volume = 0.25;
    expect(engine.mix(128).some(value => value === 250)).toBe(true);
    await music.updateAutomatic(true); expect(started).toHaveBeenCalledTimes(2);
    expect(engine.mix(128).some(value => value === 500)).toBe(true);
    await music.updateAutomatic(true); expect(started).toHaveBeenCalledTimes(3);
    expect(engine.mix(128).some(value => value === 250)).toBe(true);
    await music.cdCommand(["loop", "3"]);
    const manualStarts = started.mock.calls.length;
    expect(engine.mix(128).every(value => value === 500)).toBe(true);
    await music.updateAutomatic(true); await music.play(source, bank, "2", null, playlist);
    expect(started).toHaveBeenCalledTimes(manualStarts);
    await music.cdCommand(["off"]); await music.updateAutomatic(true);
    expect(engine.mix(64).every(value => value === 0)).toBe(true);
    await music.cdCommand(["on"]); await music.updateAutomatic(true);
    expect(started).toHaveBeenCalledTimes(manualStarts);
    await music.play(source, bank, "3", null, playlist);
    await music.updateAutomatic(false);
    expect(engine.mix(128).every(value => value === 500)).toBe(true);
  } finally { music.stop(); bank.clear(); started.mockRestore(); }
});

test("playlist source policy leaves Q1 Q3 and silent authored maps unchanged", async () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly GameFamily[]) {
    const content = createContentId({ family, edition: "test", package: "shuffle-policy", revision: "1" });
    using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)], ["music/03.wav", menuWave(2000)]]));
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    const music = new ApplicationMusic(engine, () => undefined, "immediate"), bank = new SoundBank(mounts);
    const source = { content, family, edition: "classic", campaign: "base" }, playlist = { shuffle: true, tracks: await mountedMusicTracks(mounts) };
    try {
      await music.play(source, bank, "0", null, playlist); await music.updateAutomatic(true);
      expect(engine.mix(128).every(value => value === 0)).toBe(true);
      if (family === "q2") continue;
      await music.play(source, bank, "music/02.wav", null, playlist);
      for (let index = 0; index < 3; index++) { expect(engine.mix(128).every(value => value === 250)).toBe(true); await music.updateAutomatic(true); }
    } finally { music.stop(); bank.clear(); }
  }
});

test("playlist failed tracks are bounded and pending EOF opens obey stop and retirement", async () => {
  const content = createContentId({ family: "q2", edition: "test", package: "shuffle-cancel", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map<string, Uint8Array>());
  const source = { content, family: "q2", edition: "classic", campaign: "baseq2" } satisfies Parameters<ApplicationMusic["play"]>[0];
  for (const action of ["missing", "stop", "off", "retire"]) {
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    let release: ((stream: PcmStream | null) => void) | undefined;
    const opened: string[] = [];
    class PendingBank extends SoundBank {
      override openMusic(path: string): Promise<PcmStream | null> {
        opened.push(path);
        if (action === "missing") return Promise.resolve(null);
        return new Promise(resolve => { release = resolve; });
      }
    }
    const bank = new PendingBank(mounts), music = new ApplicationMusic(engine, () => undefined);
    const pending = music.play(source, bank, "2", null, { shuffle: true, tracks: ["music/02.wav"] });
    if (action !== "missing") {
      if (release === undefined) throw new Error("Missing pending open");
      if (action === "retire") music.stop(); else await music.cdCommand([action]);
      const stream = new MemoryPcmStream({ samples: new Int16Array(32).fill(1000), channels: 1, sampleRate: 44100, frameCount: 32, loopStart: null });
      const closed = spyOn(stream, "close"); release(stream); await pending;
      expect(closed).toHaveBeenCalledTimes(1); closed.mockRestore();
    } else await pending;
    await music.updateAutomatic(true); await music.updateAutomatic(true);
    expect(opened).toEqual(["music/02.wav"]);
    expect(engine.mix(128).every(value => value === 0)).toBe(true);
    music.stop(); bank.clear();
  }
});

test("playlist menu off automatic toggle restarts the same title and respects shared cd off", async () => {
  const identity = createIdentityOwner("playlist-title"), content = createContentId({ family: "q1", edition: "test", package: "title", revision: "1" });
  const cvars = new CvarRegistry({ dialect: "q1-netquake", context: { session: identity.session, origin: { kind: "local-console" } } });
  registerMusicSettings(cvars);
  using mounts = new MenuMemoryMounts(content, new Map([["music/track02.wav", menuWave(1000)]]));
  const controls = new MusicControls();
  const audio = await StartupAudio.open({ mounts, source: { content, family: "q1", edition: "classic", campaign: "id1" }, theme: null,
    musicControls: controls, seat: identity.seat(0), print: () => undefined, preferences: { musicVolume: 0.25 } });
  audio.bindOutputCvars(cvars);
  try {
    for (let index = 0; index < 2; index++) {
      cvars.set("music_menu_track", "0"); await audio.flushCommands(); expect(audio.engine.mix(64).every(value => value === 0)).toBe(true);
      cvars.set("music_menu_track", "auto"); await audio.flushCommands(); expect(audio.engine.mix(64).every(value => value === 250)).toBe(true);
    }
    await audio.cdCommand(["off"], () => undefined);
    cvars.set("music_menu_track", "2"); await audio.flushCommands(); expect(audio.engine.mix(64).every(value => value === 0)).toBe(true);
    await audio.cdCommand(["on"], () => undefined); await audio.flushCommands(); expect(audio.engine.mix(64).every(value => value === 0)).toBe(true);
  } finally { audio.close(); }
});

test("playlist aliases execute in all source consoles and reject invalid values atomically", async () => {
  for (const dialect of ["q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3"] satisfies readonly CommandDialect[]) {
    const identity = createIdentityOwner("playlist-console"), context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
    const cvars = new CvarRegistry({ dialect, context }); registerMusicSettings(cvars);
    const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
    const prepared = new PreparedStartup(cvars, cvars, scripts, { dialect, movementDialect: dialect, seats: [], shared: null, sharedNames: [], print: () => undefined, forward: () => undefined });
    prepared.commands.append(`ogg_shuffle 1\n${dialect.startsWith("q1") ? "" : "set "}ogg_menu_track 77\n`, context); prepared.commands.execute();
    expect(readMusicSettings(cvars)).toEqual({ musicShuffle: true, menuTrack: "77" });
    prepared.commands.append('music_menu_track auto\nogg_menu_track ../secret.wav\nogg_shuffle potato\n', context); prepared.commands.execute();
    expect(readMusicSettings(cvars)).toEqual({ musicShuffle: true, menuTrack: "auto" });
    expect(cvars.canonicalSnapshots().filter(value => value.name.startsWith("ogg_")).length).toBe(0);
  }
});

test("playlist discovery uses real mounted nested loose paths and excludes unsupported files", async () => {
  await mkdir(evidence, { recursive: true });
  const directory = await mkdtemp(join(evidence, "playlist-mount-"));
  const content = createContentId({ family: "q2", edition: "test", package: "loose-playlist", revision: "1" });
  try {
    await mkdir(join(directory, "music/nested"), { recursive: true });
    await writeFile(join(directory, "music/02.wav"), menuWave(1000));
    await writeFile(join(directory, "music/nested/title.wav"), menuWave(2000));
    await writeFile(join(directory, "music/no.mp3"), new Uint8Array());
    const mount = { kind: "loose", rootPath: directory, identity: createMountIdentity(createMountId("playlist-test", "loose"), content, 0) } satisfies Parameters<typeof openMountPlan>[0]["mounts"][number];
    using mounts = await openMountPlan({ id: createMountPlanId("playlist-test", "list"), mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
    expect(await mountedMusicTracks(mounts)).toEqual(["music/02.wav", "music/nested/title.wav"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("playlist source round reset replays unchanged authored music while manual stop suppresses it", async () => {
  for (const family of ["q1", "q2", "q3"] satisfies readonly GameFamily[]) {
    const content = createContentId({ family, edition: "test", package: "round-music", revision: "1" });
    using mounts = new MenuMemoryMounts(content, new Map([["music/02.wav", menuWave(1000)]]));
    using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
    const controls = new MusicControls(), music = new ApplicationMusic(engine, () => undefined, "immediate", controls), bank = new SoundBank(mounts);
    const source = { content, family, edition: "classic", campaign: "base" }, playlist = { shuffle: false, tracks: await mountedMusicTracks(mounts) };
    const cue = family === "q3" ? "music/02.wav" : "2";
    try {
      await music.play(source, bank, cue, null, playlist);
      expect(engine.mix(64).every(value => value === 250)).toBe(true);
      for (let index = 0; index < 2; index++) {
        music.stopPlayback("source"); engine.resetRound();
        expect(engine.mix(64).every(value => value === 0)).toBe(true);
        await music.play(source, bank, cue, null, playlist);
        expect(engine.mix(64).every(value => value === 250)).toBe(true);
      }
      await music.cdCommand(["stop"]); await music.play(source, bank, cue, null, playlist);
      expect(engine.mix(64).every(value => value === 0)).toBe(true);
      music.stopPlayback("source"); await music.play(source, bank, cue, null, playlist);
      expect(engine.mix(64).every(value => value === 250)).toBe(true);
      await music.cdCommand(["off"]); music.stopPlayback("source"); await music.play(source, bank, cue, null, playlist);
      expect(engine.mix(64).every(value => value === 0)).toBe(true);
      expect(controls.enabled).toBe(false); expect(music.volume).toBe(0.25);
    } finally { music.stop(); bank.clear(); }
  }
});

test("named music command uses retained source and source one-shot or intro-loop semantics", async () => {
  const content = createContentId({ family: "q3", edition: "test", package: "postgame-music", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/win.wav", menuWave(1000)], ["music/loop.wav", menuWave(2000)]]));
  using engine = new UnifiedAudio({ milliseconds: () => 0, random: () => 0 });
  const music = new ApplicationMusic(engine, () => undefined, "immediate"), bank = new SoundBank(mounts), output: string[] = [];
  const source = { content, family: "q3", edition: "classic", campaign: "baseq3" } satisfies Parameters<ApplicationMusic["play"]>[0];
  music.select(source, bank); music.volume = 0.25;
  try {
    await music.musicCommand(["music/win"], text => { output.push(text); });
    expect(engine.mix(64).some(value => value === 250)).toBe(true);
    expect(engine.mix(64).every(value => value === 0)).toBe(true);
    await music.musicCommand(["music/win", "music/loop"], text => { output.push(text); });
    const first = engine.mix(128); expect(first.some(value => value === 250)).toBe(true); expect(first.some(value => value === 500)).toBe(true);
    expect(engine.mix(128).every(value => value === 500)).toBe(true);
    await music.cdCommand(["pause"]); expect(engine.mix(64).every(value => value === 0)).toBe(true);
    await music.cdCommand(["resume"]); expect(engine.mix(64).every(value => value === 500)).toBe(true);
    await music.musicCommand([], text => { output.push(text); }); expect(output).toEqual(["music <intro> [loop]\n"]);
    await music.cdCommand(["off"]); await music.musicCommand(["music/win"]); expect(engine.mix(64).every(value => value === 0)).toBe(true);
  } finally { music.stop(); bank.clear(); }
});

test("retained frontend music command drains in order without creating another music owner", async () => {
  const dialect = "q3", identity = createIdentityOwner("frontend-named-music"), context: CommandContext = { session: identity.session, origin: { kind: "local-console" } };
  const cvars = new CvarRegistry({ dialect, context }), output: string[] = [];
  const scripts = new ConsoleScriptFiles({ consoleRoot: "/unused", settings: new ConfigStore("/unused"), mounted: undefined });
  const prepared = new PreparedStartup(cvars, cvars, scripts, { dialect, movementDialect: dialect, seats: [], shared: null, sharedNames: [], print: text => { output.push(text); }, forward: () => undefined });
  const content = createContentId({ family: "q3", edition: "test", package: "queued-music", revision: "1" });
  using mounts = new MenuMemoryMounts(content, new Map([["music/win.wav", menuWave(1000)], ["music/loop.wav", menuWave(2000)]]));
  const audio = await StartupAudio.open({ mounts, source: { content, family: "q3", edition: "classic", campaign: "baseq3" }, theme: null,
    seat: identity.seat(0), print: () => undefined, preferences: { musicVolume: 0.25, menuTrack: "0" } });
  prepared.forwardCommands((name, args) => { if (name === "music") audio.queueMusicCommand(args, text => { output.push(text); }); else if (name === "cd") audio.queueCdCommand(args, text => { output.push(text); }); });
  try {
    expect(prepared.commands.registeredNames().filter(name => name === "music")).toEqual(["music"]);
    expect(prepared.commands.commandDocumentation("music")?.usage).toBe("music <intro> [loop]");
    prepared.commands.append("music music/win music/loop\ncd pause\n", context);
    await prepared.commands.executeAsync(() => audio.flushCommands()); expect(audio.engine.mix(64).every(value => value === 0)).toBe(true);
    prepared.commands.append("cd resume\n", context); await prepared.commands.executeAsync(() => audio.flushCommands());
    expect(audio.engine.mix(64).some(value => value === 250)).toBe(true); expect(audio.engine.mix(64).every(value => value === 500)).toBe(true);
    expect(output).toEqual([]);
  } finally { audio.close(); }
});
