import { expect, test } from "bun:test";
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
        expect(music.some(value => value !== 0)).toBe(withTheme);
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
