import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { ApplicationAssets } from "../../src/app/bootstrap/assets.ts";
import { ApplicationAudio } from "../../src/app/bootstrap/audio.ts";
import { Q3ApplicationEffects } from "../../src/app/bootstrap/effects/q3.ts";
import { applicationPreset, loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { WorldSnapshot } from "../../src/contracts/session.ts";
import type { AudioListener, PlaySound } from "../../src/audio/types.ts";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import { createSceneQueries } from "../../src/world/collision/index.ts";

test("mixed Q3 rocket effects preserve shooter identity and fixed impact through bootstrap PCM playback", async () => {
  const temporary = await mkdtemp("/tmp/quake-rocket-audio-");
  const device = spyOn(UnifiedAudio.prototype, "openDevice").mockImplementation(() => {});
  const pump = spyOn(UnifiedAudio.prototype, "pump").mockImplementation(() => 0);
  try {
    const parsed = parseApplicationCommand(["--game", "q2-classic-baseq2", "--map", "base1", "--dedicated", "--user-content-root", temporary]);
    if (parsed.kind !== "run") throw Error("Expected launch");
    const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, userContentRoot: temporary });
    const preset = applicationPreset(catalog, parsed.options), q3 = catalog.require("q3-baseq3").id;
    const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id),
      weapons: { kind: "selected", value: [{ provider: "q3:official", content: q3 }] },
      enemies: { kind: "selected", value: { kind: "replace", default: {
        source: { provider: "q1:monsters/classic/id1", content: catalog.require("q1-classic-id1").id }, classname: "monster_army" }, byClassname: {} } } } });
    const content = await loadApplicationContent(parsed.options, recipe);
    const identity = createIdentityOwner("rocket-effects"), actor = identity.actor(1, 0), remote = identity.actor(2, 0);
    const assets = new ApplicationAssets(content, { identity: Symbol("rocket-effects"), session: identity.session, generation: 0 });
    try {
      await assets.loadWorld();
      const effects = await Q3ApplicationEffects.create(assets, createSceneQueries(content.world), q3, candidate => candidate.equals(actor));
      const audio = new ApplicationAudio(content, () => 1000, 1, "sarge", () => undefined);
      const observed: PlaySound[] = [], original = audio.engine.play.bind(audio.engine);
      const capture = spyOn(audio.engine, "play").mockImplementation(request => { observed.push(request); return original(request); });
      try {
        const origin = { x: 8192, y: -4096, z: 384 }, zero = { x: 0, y: 0, z: 0 };
        const listener: AudioListener = { actor, seat: identity.seat(0), origin,
          axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false };
        const snapshot: WorldSnapshot = { session: identity.session,
          frame: { frame: 1, time: { kind: "seconds", value: 1 }, elapsed: { kind: "seconds", value: 0.1 }, phase: "frame-exit" },
          actors: [], bodies: [actor, remote].map(owner => ({ actor: owner, body: { origin: owner.equals(actor) ? origin : { ...origin, x: origin.x + 350 },
            angles: zero, velocity: zero, bounds: { min: zero, max: zero }, ground: null } })), inventories: [], configurations: [],
          scene: { session: identity.session, time: { kind: "seconds", value: 1 }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } };
        const measurements: object[] = [];
        const firingPeaks: number[] = [];
        for (const shooter of [actor, remote]) {
          await effects.ballistic({ kind: "fire", actor: shooter, weapon: 5, origin: { ...origin, x: origin.x + 14 }, end: origin,
            normal: zero, target: null, surfaceFlags: 0, timeMilliseconds: 1000, volume: 1 });
          const sounds = effects.drainSounds();
          expect(sounds).toHaveLength(1);
          expect(sounds[0]?.playback).toEqual({ kind: "actor", actor: shooter });
          audio.receiveEffectSounds(sounds);
          await audio.frame(snapshot, [listener], []);
          const request = observed.at(-1);
          expect(request?.origin).toEqual({ kind: "actor", actor: shooter });
          expect(request?.actor).toEqual(shooter);
          const pcm = audio.engine.mix(4096);
          firingPeaks.push(Math.max(...pcm.map(Math.abs)));
          measurements.push({ kind: shooter.equals(actor) ? "local-fire" : "remote-fire", listener: origin, origin: request?.origin.kind,
            peak: Math.max(...pcm.map(Math.abs)) });
          expect(pcm.some(sample => sample !== 0)).toBe(true);
          audio.engine.stopAll();
        }
        const localPeak = firingPeaks[0], remotePeak = firingPeaks[1];
        if (localPeak === undefined || remotePeak === undefined) throw Error("Missing firing capture");
        expect(localPeak).toBeGreaterThan(remotePeak * 2);
        const impact = { ...origin, y: origin.y - 350 };
        await effects.ballistic({ kind: "impact", hitKind: "wall", actor: identity.actor(3, 0), weapon: 5, origin: impact, end: impact,
          normal: { x: 0, y: 1, z: 0 }, target: null, surfaceFlags: 0, timeMilliseconds: 1000 });
        const sounds = effects.drainSounds();
        expect(sounds).toHaveLength(1);
        expect(sounds[0]?.origin).toEqual(impact);
        expect(sounds[0]?.playback).toEqual({ kind: "once" });
        audio.receiveEffectSounds(sounds);
        await audio.frame(snapshot, [listener], []);
        expect(observed.at(-1)?.origin).toEqual({ kind: "fixed", position: impact });
        expect(observed.at(-1)?.actor).toBeNull();
        const pcm = audio.engine.mix(4096);
        expect(pcm.filter((_, index) => index % 2 === 0).every(sample => sample === 0)).toBe(true);
        expect(pcm.filter((_, index) => index % 2 === 1).some(sample => sample !== 0)).toBe(true);
        measurements.push({ kind: "impact", listener: origin, origin: impact, distance: 350, peak: Math.max(...pcm.map(Math.abs)) });
        await writeFile(".artifacts/resume-20260913/rocket-audio/measurements.json", JSON.stringify(measurements, null, 2));
      } finally { capture.mockRestore(); audio.close(); effects.close(); }
    } finally { assets.close(); await content.close(); }
  } finally { device.mockRestore(); pump.mockRestore(); await rm(temporary, { recursive: true, force: true }); }
}, 60000);
