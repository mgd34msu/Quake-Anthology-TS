import { join } from "node:path";
import { expect, test } from "bun:test";
import { UnifiedAudio } from "../../src/audio/engine.ts";
import { Application } from "../../src/app/bootstrap/application.ts";
import { applicationPreset } from "../../src/app/bootstrap/content.ts";
import { discoverInstalledContent, presetChoice, resolveLaunch } from "../../src/content/catalog/index.ts";
import { EnvironmentReverb } from "../../src/audio/environments.ts";
import { REVERB_PRESET_PLAIN } from "../../src/audio/reverb-presets.ts";
import type { AudioTraceQuery } from "../../src/audio/environments.ts";
import { ApplicationAudio } from "../../src/app/bootstrap/audio.ts";
import { loadApplicationContent } from "../../src/app/bootstrap/content.ts";
import { parseApplicationCommand } from "../../src/app/bootstrap/options.ts";
import { createSimulation } from "../../src/app/bootstrap/simulation/index.ts";
import type { SimulationPresentationEvent } from "../../src/app/bootstrap/simulation/types.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { AudioListener } from "../../src/audio/types.ts";
import { EntityEvent } from "../../src/movement/q3/constants.ts";
import { q2MuzzleSounds, q2MonsterMuzzleSounds } from "../../src/app/bootstrap/audio/q2-events.ts";

// Run with SDL_AUDIODRIVER=dummy; this exercises the normal shared mixer/device path.
test("bootstrap plays source player events, filters a wet listener, replaces music and closes world audio", async () => {
  const command = parseApplicationCommand(["--game", "q2-classic-baseq2", "--character", "q2", "--movement", "q2"]);
  if (command.kind !== "run") throw new Error("Expected run options");
  const content = await loadApplicationContent(command.options);
  const identity = createIdentityOwner("bootstrap-audio");
  const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts,
    skill: 1, mode: "singleplayer", seed: 1, maxClients: 1 });
  const player = simulation.admitPlayer(identity.client(0, 0));
  const snapshot = simulation.step({ elapsedMilliseconds: 100, commands: [] }).snapshot;
  const events = simulation.drainPresentationEvents();
  const playerView = events.find(event => event.kind === "q2-player" && event.event.kind === "view");
  if (playerView?.kind !== "q2-player" || playerView.event.kind !== "view") throw new Error("Player source did not publish a view");
  const actor = player.actor, seat = identity.seat(0), origin = simulation.playerView(actor).origin;
  const listener: AudioListener = { actor, seat, origin, axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false };
  const messages: string[] = [];
  const createAudio = (): ApplicationAudio => new ApplicationAudio(content, () => 1000, 1, "missing-custom-model", text => { messages.push(text); return undefined; });
  const source = { content: content.recipe.character.definition.content, sequence: 100, seconds: 1 };
  const loop: SimulationPresentationEvent = { ...source, kind: "q2", event: { kind: "sound", actor, origin,
    path: "weapons/rg_hum.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" } };
  let dry: Int16Array = new Int16Array();
  try {
    const audio = createAudio();
    try {
      await audio.frame(snapshot, [listener], [loop]);
      expect(audio.engine.outputState).toBe("playing");
      dry = audio.engine.mix(1024);
      expect(dry.some(sample => sample !== 0)).toBe(true);
      await audio.frame({ ...snapshot, actors: [], bodies: [] }, [listener], []);
      expect(audio.engine.mix(1024).every(sample => sample === 0)).toBe(true);
    } finally { audio.close(); }
    const audioWet = createAudio();
    try {
      await audioWet.frame(snapshot, [listener], [loop, { ...playerView, event: { ...playerView.event, view: { ...playerView.event.view, underwater: true } } }]);
      const wet = audioWet.engine.mix(1024);
      expect(wet.some(sample => sample !== 0)).toBe(true);
      expect(wet).not.toEqual(dry);
      audioWet.engine.stopAll();
      await audioWet.receive([
        { ...source, kind: "q2-player", event: { kind: "userinfo", actor, slot: 0, name: "player", skin: "missing-model/default" } },
        { ...source, kind: "q2", event: { kind: "sound", actor, origin, path: "*pain25_1.wav", channel: 2, volume: 1, attenuation: 1, reliable: false, loop: "once" } },
      ]);
      expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      audioWet.engine.stopAll();
      const q3 = content.catalog.require("q3-baseq3").id;
      await audioWet.receive([{ ...source, content: q3, kind: "q3-character", event: { actor: identity.ownedActor(actor, "q3:character"),
        sequence: 1, timeMilliseconds: 1000, event: EntityEvent.EV_PAIN, parameter: 20 } }]);
      expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      audioWet.engine.stopAll();
      await audioWet.receive([{ ...source, content: q3, kind: "q3-character", event: { actor: identity.ownedActor(actor, "q3:character"),
        sequence: 2, timeMilliseconds: 1200, event: EntityEvent.EV_PAIN, parameter: 20 } }]);
      expect(audioWet.engine.mix(128).every(sample => sample === 0)).toBe(true);
      for (const flash of [26, 39, 41, 43, 45, 53, 58, 62, 82, 1, 4, 23, 57]) {
        audioWet.engine.stopAll();
        await audioWet.receive([{ ...source, kind: "q2", event: { kind: "monster-muzzleflash", actor, flash, origin, direction: { x: 1, y: 0, z: 0 } } }]);
        expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      }
      const rerelease = content.catalog.require("q2-rerelease-baseq2").id;
      for (const flash of [39, 41, 43, 251, 252, 253, 232, 233, 234, 235, 236, 237, 238, 239, 260, 256, 257, 258, 259, 263]) {
        audioWet.engine.stopAll();
        await audioWet.receive([{ ...source, content: rerelease, kind: "q2", event: { kind: "monster-muzzleflash", actor, flash, origin, direction: { x: 1, y: 0, z: 0 } } }]);
        expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      }
      await audioWet.playMusic(source.content, "2");
      expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true);
      await audioWet.playMusic(source.content, "03.ogg");
      expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true);
      await audioWet.playMusic(source.content, "2");
      expect(audioWet.engine.mix(22050).some(sample => sample !== 0)).toBe(true);
      await audioWet.playMusic(source.content, "0");
      expect(audioWet.engine.mix(128).every(sample => sample === 0)).toBe(true);
      expect(q2MuzzleSounds(5, true, () => 2).map(sound => [sound.volume, sound.delaySeconds])).toEqual([[0.2, 0], [0.2, 0.033], [0.2, 0.066]]);
    } finally { audioWet.close(); }
    expect(audioWet.engine.outputState).toBe("closed");
    expect(messages).toEqual([]);
  } finally { simulation.close(); await content.close(); }
}, 120000);

test("Q2 monster muzzle sounds preserve native variants, channels and silent flashes", () => {
  expect(q2MonsterMuzzleSounds(39, () => 0, false)).toEqual([{ path: "soldier/solatck2.wav", channel: 1, volume: 1, attenuation: 1, delaySeconds: 0 }]);
  expect(q2MonsterMuzzleSounds(41, () => 0, true)?.map(sound => sound.path)).toEqual(["soldier/solatck1.wav"]);
  expect(q2MonsterMuzzleSounds(43, () => 0, true)?.map(sound => sound.path)).toEqual(["soldier/solatck3.wav"]);
  for (let variant = 0; variant < 5; variant++) expect(q2MonsterMuzzleSounds(4, () => variant, false)?.map(sound => sound.path)).toEqual([`tank/tnkatk2${String.fromCharCode(97 + variant)}.wav`]);
  expect(q2MonsterMuzzleSounds(74, () => 0, false)).toEqual([{ path: "infantry/infatck1.wav", channel: 1, volume: 1, attenuation: 0, delaySeconds: 0 }]);
  expect(q2MonsterMuzzleSounds(74, () => 0, true)?.map(sound => sound.path)).toEqual(["flyer/flyatck3.wav"]);
  expect(q2MonsterMuzzleSounds(134, () => 0, false)).toEqual([]);
  expect(q2MonsterMuzzleSounds(134, () => 0, true)?.map(sound => sound.path)).toEqual(["flyer/flyatck3.wav"]);
  expect(q2MonsterMuzzleSounds(61, () => 0, false)).toEqual([]);
  expect(q2MonsterMuzzleSounds(9999, () => 0, true)).toBeNull();
  for (const [flash, path] of [[251, "soldier/solatck2.wav"], [252, "soldier/solatck1.wav"], [253, "soldier/solatck3.wav"], [260, "infantry/infatck1.wav"], [256, "gunner/gunatck3.wav"], [263, "hover/hovatck1.wav"]] satisfies readonly (readonly [number, string])[]) {
    expect(q2MonsterMuzzleSounds(flash, () => 0, true)).toEqual([{ path, channel: 1, volume: 1, attenuation: 1, delaySeconds: 0 }]);
    expect(q2MonsterMuzzleSounds(flash, () => 0, false)).toBeNull();
  }

});


test("measured audio work respects explicit lookahead and the device queue limit", () => {
  {
    using audio = new UnifiedAudio({ sampleRate: 44100, milliseconds: () => 0, random: () => 0 });
    audio.openDevice();
    expect(audio.pump(400, 5000)).toBe(400);
    expect(audio.sampleClock).toBe(400);
  }
  {
    using audio = new UnifiedAudio({ sampleRate: 44100, milliseconds: () => 0, random: () => 0 });
    audio.openDevice();
    expect(audio.pump(undefined, 5000)).toBe(88200);
    expect(audio.sampleClock).toBe(88200);
    expect(() => audio.pump(undefined, -1)).toThrow("Invalid measured audio frame work");
  }
});


test("actual Q2 rerelease reverb uses native and foreign geometry without tracing the listener", async () => {
  const corpus = join(import.meta.dir, "../../../qfiles");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const audioContent = catalog.require("q2-rerelease-baseq2").id;
  const original = UnifiedAudio.prototype.setEnvironment;
  const traces: AudioTraceQuery[] = [];
  const selectors: EnvironmentReverb[] = [];
  const update = EnvironmentReverb.prototype.update;
  EnvironmentReverb.prototype.update = function(this: EnvironmentReverb, origin, milliseconds): void {
    update.call(this, origin, milliseconds);
    if (!selectors.includes(this)) selectors.push(this);
  };
  UnifiedAudio.prototype.setEnvironment = function(this: UnifiedAudio, seat, definitions, trace): void {
    expect(definitions).toHaveLength(8);
    expect(definitions[0]?.dimension).toBe(200);
    traces.push(trace);
    original.call(this, seat, definitions, trace);
  };
  try {
    for (const [game, map] of [["q2-rerelease-baseq2", "base1"], ["q1-classic-id1", "e1m1"]]) {
      if (game === undefined || map === undefined) throw new Error("Missing actual map pair");
      const command = parseApplicationCommand(["--content-root", corpus, "--game", game, "--map", map, "--renderer", "cpu", "--hidden", "--width", "320", "--height", "200"]);
      if (command.kind !== "run") throw new Error("Expected actual map command");
      const preset = applicationPreset(catalog, command.options);
      const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), presentation: { kind: "selected", value: { ...preset.presentation, audio: { provider: "q2:official", content: audioContent } } } } });
      const application = await Application.open(command.options, { print: () => undefined }, recipe);
      try {
        await application.step(100);
        const selector = selectors.at(-1);
        if (selector === undefined) throw new Error("Actual listener selector was not updated");
        expect(selector.presetIndex).not.toBe(REVERB_PRESET_PLAIN);
        const trace = traces.at(-1), player = application.localPlayers[0];
        if (trace === undefined || player === undefined) throw new Error("Reverb was not joined to the actual application");
        const position = application.simulation.playerView(player.actor).origin, zero = { x: 0, y: 0, z: 0 };
        const start = { ...position, z: position.z + 1 };
        const floor = trace(start, { ...start, z: start.z - 256 }, { x: -16, y: -16, z: 0 }, { x: 16, y: 16, z: 0 });
        expect(floor.fraction).toBeGreaterThan(0);
        expect(floor.fraction).toBeLessThan(1);
        expect(floor.sky).toBe(false);
        if (game === "q1-classic-id1") expect(floor.material).toBeNull();
        const air = trace(position, { ...position, z: position.z + 1 }, zero, zero);
        expect(air.fraction).toBe(1);
        expect(air.material).toBeNull();
        const world = application.content.world;
        if (world.kind === "q3-bsp") throw new Error("Unexpected fixture geometry");
        let skyHits = 0;
        for (const face of world.faces) {
          const info = world.textureInfo[face.textureInfo];
          const sky = world.kind === "q2-bsp" ? (world.textureInfo[face.textureInfo]?.flags ?? 0) & 4 : world.textures[world.textureInfo[face.textureInfo]?.texture ?? -1]?.name.startsWith("sky");
          if (!sky || info === undefined) continue;
          const plane = world.planes[face.plane];
          if (plane === undefined) throw new Error("Missing actual sky plane");
          const center = { x: 0, y: 0, z: 0 };
          for (let edgeOffset = 0; edgeOffset < face.edges.count; edgeOffset++) {
            const signed = world.surfaceEdges[face.edges.first + edgeOffset];
            if (signed === undefined) throw new Error("Missing sky edge");
            const edge = world.edges[Math.abs(signed)], vertex = edge === undefined ? undefined : world.vertices[edge.vertices[signed < 0 ? 1 : 0]];
            if (vertex === undefined) throw new Error("Missing sky vertex");
            center.x += vertex.x / face.edges.count; center.y += vertex.y / face.edges.count; center.z += vertex.z / face.edges.count;
          }
          const side = face.back ? -1 : 1;
          const before = { x: center.x + plane.normal.x * side * 16, y: center.y + plane.normal.y * side * 16, z: center.z + plane.normal.z * side * 16 };
          const after = { x: center.x - plane.normal.x * side * 16, y: center.y - plane.normal.y * side * 16, z: center.z - plane.normal.z * side * 16 };
          const hit = trace(before, after, zero, zero);
          if (hit.sky && hit.fraction < 1) { skyHits++; break; }
        }
        expect(skyHits).toBeGreaterThan(0);
        const configurations = traces.length;
        await application.step(100);
        expect(traces).toHaveLength(configurations);
      } finally { await application.close(); }
    }
    expect(traces).toHaveLength(2);
  } finally { UnifiedAudio.prototype.setEnvironment = original; EnvironmentReverb.prototype.update = update; }
}, 30000);
