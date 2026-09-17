import type { Q3SeatAudioFrame } from "../../src/app/bootstrap/audio/q3.ts";
import { ApplicationInput } from "../../src/app/bootstrap/input.ts";
import { InputRouter } from "../../src/input/router.ts";
import { SdlControllers } from "../../src/platform/controller.ts";
import { SdlAudioDevice } from "../../src/platform/audio.ts";
import type { ControllerOperationResult } from "../../src/platform/controller.ts";
import { FrontendPreferences, applyFrontendPreferences } from "../../src/app/bootstrap/frontend-preferences.ts";
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

test("audio diagnostics and play use the actual common console and queued PCM for every family", async () => {
  const fixtures = [
    { game: "q1-classic-id1", map: "start", family: "q1", sound: "weapons/rocket1i", listed: "sound/weapons/rocket1i.wav" },
    { game: "q2-classic-baseq2", map: "base1", family: "q2", sound: "weapons/railgf1a", listed: "sound/weapons/railgf1a.wav" },
    { game: "q3-baseq3", map: "q3dm1", family: "q3", sound: "sound/weapons/machinegun/machgf1b.wav", listed: "sound/weapons/machinegun/machgf1b.wav" },
  ];
  const bind = ApplicationAudio.prototype.bindHaptics, queue = SdlAudioDevice.prototype.queue;
  const joined: { readonly audio: ApplicationAudio; readonly input: ApplicationInput }[] = [];
  let observe = false, nonzeroQueued = 0;
  ApplicationAudio.prototype.bindHaptics = function(this: ApplicationAudio, input): void { bind.call(this, input); joined.push({ audio: this, input }); };
  SdlAudioDevice.prototype.queue = function(this: SdlAudioDevice, samples): void {
    queue.call(this, samples);
    if (observe && samples.some(value => value !== 0)) nonzeroQueued++;
  };
  try {
    for (const fixture of fixtures) {
      const parsed = parseApplicationCommand(["--game", fixture.game, "--map", fixture.map, "--movement", fixture.family, "--character", fixture.family,
        "--renderer", "cpu", "--hidden", "--width", "160", "--height", "120"]);
      if (parsed.kind !== "run") throw new Error("Expected audio console launch");
      const messages: string[] = [];
      const application = await Application.open(parsed.options, { print: text => { messages.push(text); return undefined; } });
      try {
        const owners = joined.at(-1);
        if (owners === undefined) throw new Error("Application did not bind its shared audio/input owner");
        await application.step(50);
        nonzeroQueued = 0; observe = true;
        owners.input.commands.append(`stopsound; play ${fixture.sound}; soundlist; soundinfo\n`);
        await application.step(50);
        observe = false;
        expect(nonzeroQueued).toBeGreaterThan(0);
        expect(messages.some(text => text.includes(fixture.listed) && text.includes("16-bit"))).toBe(true);
        const output = owners.audio.engine.outputConfiguration;
        if (output === null) throw new Error("Audio output did not open");
        expect(messages.some(text => text.includes(`${output.sampleRate} Hz, ${output.channels} ${output.channels === 1 ? "channel" : "channels"}, ${output.sampleBits}-bit PCM`))).toBe(true);
        expect(messages.some(text => text.includes("queued frames"))).toBe(true);
        expect(output.sampleRate).toBe(owners.audio.outputFormat.sampleRate);
        if (fixture.family === "q3") {
          const source = application.simulation.q3Source();
          if (source === null) throw new Error("Expected authoritative Q3 command source");
          nonzeroQueued = 0; observe = true;
          source.host.engine.appendConsoleCommand("stopsound; play sound/player/announce/crash.wav; soundlist\n");
          await application.step(50);
          await application.step(50);
          observe = false;
          expect(messages.some(text => text.includes("sound/player/announce/crash.wav") && text.includes("16-bit"))).toBe(true);
          expect(nonzeroQueued).toBeGreaterThan(0);
          expect(messages.some(text => text.includes("Unbound source engine command"))).toBe(false);
        }
        owners.input.commands.append("play missing/audio-diagnostic-file; s_info\n");
        await application.step(50);
        expect(messages.some(text => text.includes("Sound unavailable:") && text.includes("missing/audio-diagnostic-file.wav"))).toBe(true);
        await owners.audio.command({ name: "s_stop", args: [], seat: null });
        expect(owners.audio.engine.queuedFrames).toBe(0);
        expect(owners.audio.engine.mix(256).every(value => value === 0)).toBe(true);
        expect(await owners.audio.command({ name: "not-an-audio-command", args: [], seat: null })).toBe(false);
        const loading = owners.audio.command({ name: "play", args: [fixture.sound], seat: null });
        owners.audio.close();
        await expect(loading).rejects.toThrow("closed during sound loading");
      } finally { observe = false; await application.close(); }
    }
  } finally { ApplicationAudio.prototype.bindHaptics = bind; SdlAudioDevice.prototype.queue = queue; }
}, 60000);

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
      await audioWet.receive([{ ...source, content: q3, kind: "q3-character", event: { actor,
        sequence: 1, timeMilliseconds: 1000, event: EntityEvent.EV_PAIN, parameter: 20 } }]);
      expect(audioWet.engine.mix(4096).some(sample => sample !== 0)).toBe(true);
      audioWet.engine.stopAll();
      await audioWet.receive([{ ...source, content: q3, kind: "q3-character", event: { actor,
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
      await audioWet.command({ name: "stopsound", args: [], seat: null });
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
    expect(audio.pump(undefined, 5000)).toBe(8820);
    expect(audio.sampleClock).toBe(8820);
    audio.stopAll();
    expect(audio.pump(undefined, 5000)).toBe(88200);
    expect(() => audio.pump(undefined, -1)).toThrow("Invalid measured audio frame work");
  }
});


test("explicit Quake II environments preserve native Q1 and Q3 audio and trace actual geometry", async () => {
  const corpus = join(import.meta.dir, "../../../qfiles");
  const catalog = await discoverInstalledContent({ corpusRoot: corpus, discoverMods: false });
  const audioContent = catalog.require("q2-rerelease-baseq2").id;
  const cgameFrames: Q3SeatAudioFrame[] = [], tactileRequests: { readonly content: string; readonly sound: string }[] = [];
  const receiveCgame = ApplicationAudio.prototype.receiveCgameFrame, tactileSound = ApplicationInput.prototype.soundHaptics, environmentRumble = SdlControllers.prototype.rumble;
  SdlControllers.prototype.rumble = function(this: SdlControllers): ControllerOperationResult { return { kind: "accepted" }; };
  ApplicationAudio.prototype.receiveCgameFrame = function(this: ApplicationAudio, frame): void { cgameFrames.push(frame); receiveCgame.call(this, frame); };
  ApplicationInput.prototype.soundHaptics = function(this: ApplicationInput, content, sound, actor, audience): Promise<void> {
    tactileRequests.push({ content, sound }); return tactileSound.call(this, content, sound, actor, audience);
  };
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
    for (const [game, map] of [["q2-rerelease-baseq2", "base1"], ["q1-classic-id1", "e1m1"], ["q3-baseq3", "q3dm1"]]) {
      if (game === undefined || map === undefined) throw new Error("Missing actual map pair");
      const command = parseApplicationCommand(["--content-root", corpus, "--game", game, "--map", map, "--renderer", "cpu", "--hidden", "--width", "320", "--height", "200"]);
      if (command.kind !== "run") throw new Error("Expected actual map command");
      const preset = applicationPreset(catalog, command.options);
      const recipe = await resolveLaunch({ catalog, preset, choice: { ...presetChoice(preset.id), presentation: { kind: "selected", value: { ...preset.presentation, environment: { kind: "selected", resource: { content: audioContent, path: "sound/default.environments" } } } } } });
      expect(recipe.presentation.audio).toEqual(preset.presentation.audio);
      expect(recipe.resources.find(resource => resource.requestedPath === "sound/default.environments")?.provenance.mount.identity.content).toBe(audioContent);
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
        if (world.kind !== "q3-bsp") {
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
        }
        const configurations = traces.length;
        await application.step(100);
        expect(traces).toHaveLength(configurations);
        if (game === "q3-baseq3") {
          const local = application.localPlayers[0]; if (local === undefined) throw new Error("Missing Q3 local player");
          application.input({ kind: "focus", seat: local.seat.id, timeMilliseconds: performance.now(), focused: true });
          application.input({ kind: "mouse-button", seat: local.seat.id, timeMilliseconds: performance.now(), button: 1, down: true });
          for (let frame = 0; frame < 3; frame++) await application.step(100);
          const q3Content = recipe.engineBehavior.content;
          expect(cgameFrames.length).toBeGreaterThan(0);
          expect(cgameFrames.every(frame => frame.content === q3Content)).toBe(true);
          const sound = cgameFrames.flatMap(frame => frame.operations).find(operation => operation.kind === "play" && operation.sound.actor?.equals(local.actor));
          if (sound?.kind !== "play") throw new Error("Actual cgame did not produce a local-player sound");
          expect(tactileRequests).toContainEqual({ content: q3Content, sound: sound.sound.sound.name });
        }
      } finally { await application.close(); }
    }
    expect(traces).toHaveLength(3);
  } finally { UnifiedAudio.prototype.setEnvironment = original; EnvironmentReverb.prototype.update = update;
    ApplicationAudio.prototype.receiveCgameFrame = receiveCgame; ApplicationInput.prototype.soundHaptics = tactileSound; SdlControllers.prototype.rumble = environmentRumble; }
}, 60000);

test("actual rerelease sound dispatch scopes genuine tactile data to its owning input seat", async () => {
  const command = parseApplicationCommand(["--game", "q2-rerelease-baseq2", "--character", "q2", "--movement", "q2", "--map", "base1", "--renderer", "cpu", "--hidden", "--width", "320", "--height", "200", "--seats", "2"]);
  if (command.kind !== "run") throw new Error("Expected actual map command");
  const joined: { readonly audio: ApplicationAudio; readonly input: ApplicationInput }[] = [];
  const pendingHaptics: Promise<void>[] = [];
  const motors: { readonly device: number; readonly low: number; readonly high: number }[] = [];
  const bind = ApplicationAudio.prototype.bindHaptics, controller = InputRouter.prototype.controllerFor, rumble = SdlControllers.prototype.rumble, soundHaptics = ApplicationInput.prototype.soundHaptics;
  ApplicationInput.prototype.soundHaptics = function(this: ApplicationInput, content, sound, actor, audience): Promise<void> {
    const pending = soundHaptics.call(this, content, sound, actor, audience); pendingHaptics.push(pending); return pending;
  };
  ApplicationAudio.prototype.bindHaptics = function(this: ApplicationAudio, input): void { bind.call(this, input); joined.push({ audio: this, input }); };
  InputRouter.prototype.controllerFor = function(this: InputRouter, seat): number | null {
    const index = joined.at(-1)?.input.locals.findIndex(local => local.player.seat.id.equals(seat)) ?? -1;
    return index < 0 ? null : 100 + index;
  };
  SdlControllers.prototype.rumble = function(this: SdlControllers, device, low, high): ControllerOperationResult {
    motors.push({ device, low, high }); return { kind: "accepted" };
  };
  let application: Application | null = null;
  try {
    application = await Application.open(command.options, { print: () => undefined });
    const pair = joined.at(-1), first = pair?.input.locals[0], second = pair?.input.locals[1];
    if (pair === undefined || first === undefined || second === undefined) throw new Error("Actual local seat haptics not joined");
    for (const local of pair.input.locals) local.input.input({ kind: "focus", seat: local.player.seat.id, timeMilliseconds: 0, focused: true });
    const content = application.content.catalog.require("q2-rerelease-baseq2").id;
    const event: SimulationPresentationEvent = { content, sequence: 1, seconds: 0, kind: "q2", event: {
      kind: "sound", actor: first.player.actor, origin: application.simulation.playerView(first.player.actor).origin, path: "weapons/hyprbf1a.wav", channel: 1, volume: 1, attenuation: 1, reliable: false, loop: "once" } };
    await pair.audio.receive([event]); await Promise.all(pendingHaptics);
    expect(first.haptics.scheduler.active).toBe(true);
    expect(second.haptics.scheduler.active).toBe(false);
    expect(motors.every(value => value.device === 100)).toBe(true);
    first.haptics.cancel();
    await pair.input.soundHaptics(content, "sound/weapons/hyprbf1a.wav", first.player.actor, { kind: "seat", seat: second.player.seat.id });
    expect(first.haptics.scheduler.active).toBe(false);
    await pair.input.soundHaptics(content, "sound/weapons/hyprbf1a.wav", null, { kind: "world" });
    expect(first.haptics.scheduler.active).toBe(false);
    const classic = application.content.catalog.require("q2-classic-baseq2").id;
    await pair.input.soundHaptics(classic, "sound/weapons/hyprbf1a.wav", first.player.actor, { kind: "world" });
    expect(first.haptics.scheduler.active).toBe(false);
    const preferences = new FrontendPreferences(() => "q2-rerelease");
    const toggle = preferences.bindings().find(binding => binding.id === "ui:input:controller-vibration");
    if (toggle?.kind !== "toggle") throw new Error("Missing controller vibration setting");
    toggle.write(false); applyFrontendPreferences(preferences.values, pair.input, pair.audio);
    await pair.audio.receive([event]); await Promise.all(pendingHaptics);
    expect(first.haptics.scheduler.active).toBe(false);
    expect(application.frontendValues?.controllerVibration).toBe(false);
    first.haptics.setEnabled(true);
    first.input.setFocus({ kind: "console" }, 0);
    await pair.audio.receive([event]); await Promise.all(pendingHaptics); expect(first.haptics.scheduler.active).toBe(false);
    first.input.setFocus({ kind: "game" }, 0);
    await pair.audio.receive([event]); await Promise.all(pendingHaptics); expect(first.haptics.scheduler.active).toBe(true);
    pair.input.rebindPlayers(application.localPlayers, application.simulation);
    expect(first.haptics.scheduler.active).toBe(false);
    const mounts = await application.content.forContent(content), tactile = await mounts.open("tactile/weapons/hyprbf1a.bnvib");
    if (tactile === null) throw new Error("Missing genuine tactile resource");
    const deferred = Promise.withResolvers<Uint8Array | null>();
    pair.input.bindHaptics(() => deferred.promise);
    pair.audio.engine.setListeners(pair.input.locals.map(local => ({ seat: local.player.seat.id, actor: local.player.actor,
      origin: { x: 0, y: 0, z: 0 },
      axis: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], gain: 1, underwater: false })));
    pair.audio.engine.stopAll();
    await pair.audio.receive([event]);
    expect(first.haptics.scheduler.active).toBe(false);
    expect(pair.audio.engine.mix(512).some(sample => sample !== 0)).toBe(true);
    pair.input.router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 100, instance: 101 });
    pair.input.router.handleController({ kind: "assignment", timestamp: 0, slot: 0, previous: 101, instance: 100 });
    deferred.resolve(tactile.bytes); await Promise.all(pendingHaptics);
    expect(first.haptics.scheduler.active).toBe(false);
    const focusPending = Promise.withResolvers<Uint8Array | null>();
    pair.input.bindHaptics(() => focusPending.promise);
    await pair.audio.receive([event]);
    pair.input.input({ kind: "focus", seat: first.player.seat.id, timeMilliseconds: 0, focused: false });
    pair.input.input({ kind: "focus", seat: first.player.seat.id, timeMilliseconds: 0, focused: true });
    focusPending.resolve(tactile.bytes); await Promise.all(pendingHaptics);
    expect(first.haptics.scheduler.active).toBe(false);
  } finally {
    if (application !== null) await application.close();
    ApplicationAudio.prototype.bindHaptics = bind; InputRouter.prototype.controllerFor = controller; SdlControllers.prototype.rumble = rumble;
    ApplicationInput.prototype.soundHaptics = soundHaptics;
  }
}, 30000);
