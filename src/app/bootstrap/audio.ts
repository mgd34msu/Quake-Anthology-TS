import { mountedMusicTracks } from "./audio/playlist.ts";
import { readMusicSettings, type MusicPreferences } from "./audio/playlist-settings.ts";
import { geometryTransmission } from "../../audio/geometry.ts";
import { readAudioOutputCvars, writeAudioOutputCvars } from "./audio/output-settings.ts";
import type { AudioOutputFormat } from "../../audio/output.ts";
import type { MusicControls } from "../../audio/music.ts";
import { menuSoundPath } from "./audio/menu.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { Q3_FOOTSTEP_PATHS } from "../../content/q3/presentation/character-resources.ts";
import type { ApplicationInput } from "./input.ts";
import type { ContentId, GameFamily } from "../../contracts/content.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { Vec3 } from "../../contracts/math.ts";
import type { WorldSnapshot } from "../../contracts/session.ts";
import { parseEnvironments } from "../../audio/environments.ts";
import type { AudioTraceQuery, ReverbEnvironment } from "../../audio/environments.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import { SoundBank, UnifiedAudio } from "../../audio/index.ts";
import { sourceSoundChannel } from "../../audio/types.ts";
import type { AudioAudience, AudioListener, LoopSound, SoundAsset } from "../../audio/index.ts";
import { GameRandom } from "../../core/game-numeric.ts";
import { EntityEvent } from "../../movement/q3/constants.ts";
import { findQ1Leaf } from "../../formats/q1-map/queries.ts";
import { parseEntities } from "../../formats/q3-map/index.ts";
import { parsePlayerAnimationConfig } from "../../content/q3/foundation/animation-config.ts";
import type { PlayerFootsteps } from "../../content/q3/foundation/animation-config.ts";
import type { Q3CharacterPresentationEvent } from "./simulation/types.ts";
import type { LoadedApplicationContent } from "./content.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";
import type { UiSound } from "../../ui/common/controller.ts";
import { ApplicationMusic, q1MusicFallback, worldMusicTrack } from "./audio/music.ts";
import { q2EntitySound, q2MuzzleSounds, q2MonsterMuzzleSounds } from "./audio/q2-events.ts";
import { q3VoiceFallback } from "./audio/q3.ts";
import type { Q3SeatAudioFrame } from "./audio/q3.ts";
import type { SourceEffectSound } from "./effects/q3.ts";
import { applicationAudioCommands } from "./audio/commands.ts";
import type { SoundRegistration } from "../../content/q3/presentation/audio.ts";

export interface ApplicationAudioCommand {
  readonly name: string;
  readonly args: readonly string[];
  readonly seat: SeatId | null;
  readonly registrations?: readonly Pick<SoundRegistration, "path" | "sound">[];
  readonly print?: (text: string) => void;
}

interface ActorAudio {
  readonly actor: ActorId;
  model: string;
  underwater: boolean | null;
  chase: ActorId | null;
  painTime: number;
}
interface StaticAudio {
  readonly audience: AudioAudience;
  readonly sound: SoundAsset;
  readonly origin: Vec3;
  readonly volume: number;
  readonly attenuation: number;
  readonly seats: SeatId[];
}
export type ApplicationEffectSound = SourceEffectSound;
export interface ApplicationAudioSeatEvents {
  readonly seat: SeatId;
  readonly scene?: SceneQueries;
  readonly snapshot: WorldSnapshot;
  readonly events: readonly SimulationPresentationEvent[];
  readonly music: boolean;
  readonly effectSounds?: readonly ApplicationEffectSound[];
}
export interface ApplicationAudioOptions {
  readonly q3TeamGame?: () => boolean;
  readonly musicControls?: MusicControls;
  readonly outputFormat?: AudioOutputFormat;
  readonly deferOutput?: boolean;
  readonly deviceName?: string | null;
  readonly effectsVolume?: number;
  readonly musicVolume?: number;
}

/** The output device mixes independent local listeners without advancing the game. */
export class ApplicationAudio {
  readonly engine: UnifiedAudio;
  private readonly q3TeamGame: () => boolean;
  private readonly playlists = new Map<ContentId, Promise<readonly string[]>>();
  get musicPreferences(): MusicPreferences { return readMusicSettings(this.volumeCvars); }
  private readonly banks = new Map<ContentId, Promise<SoundBank>>();
  private readonly music: ApplicationMusic;
  private readonly random: GameRandom;
  private readonly actorAudio: ActorAudio[] = [];
  private readonly statics: StaticAudio[] = [];
  private readonly loops: LoopSound[] = [];
  private readonly sounds = new Map<string, Promise<SoundAsset | null>>();
  private readonly footsteps = new Map<ContentId, Promise<PlayerFootsteps>>();
  private readonly warned = new Set<string>();
  private readonly uiSounds: { readonly seat: SeatId; readonly sound: UiSound }[] = [];
  private readonly effectSounds: ApplicationEffectSound[] = [];
  private readonly cgameFrames: Q3SeatAudioFrame[] = [];
  private listeners: readonly AudioListener[] = [];
  private seatScenes: readonly { readonly seat: SeatId; readonly scene: SceneQueries }[] = [];
  private snapshot: WorldSnapshot | null = null;
  private geometry: ((listener: AudioListener, position: Vec3) => number) | null = null;
  private geometryEnabled = false;
  private syncGeometry(): void {
    const enabled = (this.volumeCvars?.variableValue("s_geometryAcoustics") ?? 0) !== 0;
    if (enabled === this.geometryEnabled) return;
    this.geometryEnabled = enabled; this.engine.setGeometryTransmission(enabled ? this.geometry : null);
  }
  private environment: { readonly definitions: readonly ReverbEnvironment[]; readonly trace: (listener: AudioListener) => AudioTraceQuery } | null = null;
  private readonly environmentSeats: SeatId[] = [];
  private volume = 0.7;
  private volumeCvars: CvarRegistry | null = null;
  private outputCvars: CvarRegistry | null = null;
  private closed = false;
  private haptics: ApplicationInput | null = null;

  constructor(private readonly content: LoadedApplicationContent, now: () => number, seed: number,
    private readonly characterModel: string, private readonly print: (text: string) => undefined, options: ApplicationAudioOptions = {}) {
    this.q3TeamGame = options.q3TeamGame ?? (() => false);
    this.random = new GameRandom(seed);
    this.engine = new UnifiedAudio({ ...(options.outputFormat === undefined ? {} : { outputFormat: options.outputFormat }), milliseconds: () => Math.trunc(now()), random: () => this.random.rand() });
    this.engine.setDopplerEnabled(content.recipe.presentation.doppler.kind === "source");
    this.music = new ApplicationMusic(this.engine, print, "source", options.musicControls);
    this.effectsVolume = options.effectsVolume ?? this.volume;
    this.musicVolume = options.musicVolume ?? this.music.volume;
    if (options.deferOutput === true) return;
    const outputDevice = options.deviceName ?? null;
    try { this.engine.openDevice({ deviceName: outputDevice }); }
    catch (error) {
      if (outputDevice === null) { this.engine.close(); throw error; }
      this.print(`Audio output ${outputDevice} unavailable: ${error instanceof Error ? error.message : String(error)}. Using system default.\n`);
      try { this.engine.openDevice(); } catch (fallbackError) { this.engine.close(); throw fallbackError; }
    }
  }

  prepareOutputTransfer(next: ApplicationAudio): () => void { return this.engine.prepareOutputTransfer(next.engine); }

  get outputFormat(): AudioOutputFormat { return this.engine.outputFormat; }
  bindOutputCvars(cvars: CvarRegistry): void { this.outputCvars = cvars; }
  selectOutputFormat(format: AudioOutputFormat): void {
    this.engine.selectOutput(this.selectedOutput, format);
    if (this.outputCvars !== null) writeAudioOutputCvars(this.outputCvars, this.outputFormat);
  }
  restartOutput(): void {
    this.engine.selectOutput(this.selectedOutput, this.outputCvars === null ? this.outputFormat : readAudioOutputCvars(this.outputCvars), true);
  }
  get selectedOutput(): string | null { return this.engine.selectedOutput; }
  outputDeviceNames(): readonly string[] { return this.engine.outputDeviceNames(); }
  selectOutput(deviceName: string | null): void { this.engine.selectOutput(deviceName); }
  detachOutput(): void { this.engine.detachOutput(); }

  bindHaptics(input: ApplicationInput): void {
    this.haptics = input;
    input.bindHaptics(async request => {
      const mounts = await this.content.forContent(request.content);
      const resource = await mounts.resolve(request.path);
      return resource === null ? null : mounts.read(resource);
    });
  }

  async prepareEnvironment(scene: SceneQueries): Promise<void> {
    const timing = this.content.recipe.timing.find(value => value.provider === this.content.recipe.engineBehavior.provider);
    if (timing === undefined) throw new Error("Audio geometry has no numeric profile");
    const sceneFor = (listener: AudioListener): SceneQueries => this.seatScenes.find(value => value.seat.equals(listener.seat))?.scene ?? scene;
    this.geometry = (listener, position) => geometryTransmission(listener.origin, position, (start, end) =>
      sceneFor(listener).trace({ start, end, shape: { kind: "point" }, target: { kind: "world" }, passActor: listener.actor, numeric: timing.numeric,
        policy: { kind: "q2", contentsMask: 3, leafContents: "merged" } }));
    this.engine.setGeometryTransmission(this.geometryEnabled ? this.geometry : null);
    this.syncGeometry();
    const selection = this.content.recipe.presentation.environment;
    if (selection.kind === "disabled") return;
    const request = selection.kind === "selected" ? selection.resource
      : { content: this.content.recipe.presentation.audio.content, path: "sound/default.environments" };
    const mounts = await this.content.forContent(request.content);
    const resource = await mounts.resolve(request.path);
    if (resource === null) {
      if (selection.kind === "selected") throw new Error(`Required environment resource is missing: ${request.content}/${request.path}`);
      return;
    }
    const definitions = parseEnvironments(new TextDecoder().decode(await mounts.read(resource)), text => this.print(text));
    if (this.closed) return;
    this.environment = { definitions, trace: listener => (start, end, mins, maxs) => {
      const current = this.listeners.find(value => value.seat.equals(listener.seat));
      if (current === undefined) throw new Error("Reverb seat has no current listener");
      const point = mins.x === 0 && mins.y === 0 && mins.z === 0 && maxs.x === 0 && maxs.y === 0 && maxs.z === 0;
      const result = sceneFor(current).trace({ start, end, shape: point ? { kind: "point" } : { kind: "box", bounds: { min: mins, max: maxs } }, target: { kind: "world" },
        passActor: current.actor, numeric: timing.numeric, policy: { kind: "q2", contentsMask: 3, leafContents: "merged" } });
      if (result.kind !== "q2") throw new Error("Audio trace did not honor its shared query policy");
      return { fraction: result.fraction, end: result.end, material: result.surface?.material || null, sky: ((result.surface?.flags ?? 0) & 4) !== 0 };
    } };
  }

  bindVolumeCvars(cvars: CvarRegistry): void {
    if (cvars.find("volume") === undefined || cvars.find("bgmvolume") === undefined) return;
    this.volumeCvars = cvars;
    this.engine.setEffectsVolume(this.effectsVolume); this.music.volume = this.musicVolume;
  }
  get effectsVolume(): number { return this.volumeCvars === null ? this.volume : Math.max(0, Math.min(1, this.volumeCvars.variableValue("volume"))); }
  set effectsVolume(value: number) { this.volumeCvars?.set("volume", String(value)); this.engine.setEffectsVolume(value); this.volume = value; }
  get musicVolume(): number { return this.volumeCvars === null ? this.music.volume : Math.max(0, Math.min(1, this.volumeCvars.variableValue("bgmvolume"))); }
  set musicVolume(value: number) { this.volumeCvars?.set("bgmvolume", String(value)); this.music.volume = value; }
  uiSound(sound: UiSound, seat: SeatId): void { this.uiSounds.push({ sound, seat }); }
  receiveEffectSounds(sounds: readonly ApplicationEffectSound[]): void { this.effectSounds.push(...sounds); }
  receiveCgameFrame(frame: Q3SeatAudioFrame): void { this.cgameFrames.push(frame); }

  async command(request: ApplicationAudioCommand): Promise<boolean> {
    if (!applicationAudioCommands.includes(request.name)) return false;
    if (this.closed) throw new Error("Sound system is closed");
    const print = request.print ?? this.print;
    if (request.name === "snd_restart") { this.restartOutput(); return true; }
    if (request.name === "music") { await this.music.musicCommand(request.args, print); return true; }
    if (request.name === "cd") { await this.music.cdCommand(request.args, print); return true; }
    if (request.name === "soundinfo" || request.name === "s_info") {
      const output = this.engine.outputConfiguration;
      print(`Sound output: ${this.engine.outputState}\n`);
      if (output !== null) {
        print(`SDL device: ${output.deviceName ?? "system default"}\n`);
        print(`${output.sampleRate} Hz, ${output.channels} ${output.channels === 1 ? "channel" : "channels"}, ${output.sampleBits}-bit PCM; buffer ${output.bufferFrames} frames\n`);
        print(`${this.engine.queuedFrames} queued frames, maximum ${output.maximumQueuedFrames}; mixed clock ${this.engine.sampleClock}\n`);
      }
      print(`Effects volume ${Number(this.effectsVolume.toPrecision(6))}; music volume ${Number(this.musicVolume.toPrecision(6))}; listeners ${this.listeners.length}\n`);
      return true;
    }
    if (request.name === "soundlist" || request.name === "s_list") {
      const registrations = [...this.sounds.entries()];
      const results = await Promise.allSettled(registrations.map(([, pending]) => pending));
      if (this.closed) throw new Error("Sound system closed during sound listing");
      const assets = new Set<SoundAsset>();
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled" && result.value !== null) assets.add(result.value);
        else print(`unavailable: ${registrations[index]?.[0] ?? "unknown sound"}\n`);
      }
      for (const entry of request.registrations ?? []) {
        if (entry.sound !== null) assets.add(entry.sound);
        else print(`unavailable: ${entry.path}\n`);
      }
      let bytes = 0;
      for (const sound of [...assets].sort((a, b) => a.name.localeCompare(b.name))) {
        const pcm = sound.pcm; bytes += pcm.samples.byteLength;
        print(`${pcm.loopStart === null ? " " : "L"} ${pcm.sampleRate} Hz ${pcm.channels}ch 16-bit ${pcm.frameCount} frames ${pcm.samples.byteLength} bytes : ${sound.name} [${sound.resource}]\n`);
      }
      print(`Decoded PCM storage: ${bytes} bytes in ${assets.size} registered resources\n`);
      return true;
    }
    if (request.name === "stopsound" || request.name === "s_stop") {
      this.music.stopPlayback("manual"); this.engine.stopAll();
      this.statics.length = 0; this.loops.length = 0; this.uiSounds.length = 0; this.effectSounds.length = 0; this.cgameFrames.length = 0;
      return true;
    }
    if (request.args.length === 0) throw new Error("Usage: play <sound> [sound ...]");
    const listener = this.listeners.find(value => request.seat === null || value.seat.equals(request.seat));
    if (listener === undefined) throw new Error("Sound playback requires a local listener");
    const content = this.content.recipe.presentation.audio.content, family = this.content.catalog.product(content).expectation.family;
    for (const argument of request.args) {
      const path = argument.includes(".") ? argument : `${argument}.wav`;
      const sound = await this.sound(content, path, family, listener.actor);
      if (this.closed) throw new Error("Sound system closed during sound loading");
      if (sound === null) throw new Error(`Sound unavailable: ${content}/${path}`);
      this.engine.play({ sound, family, actor: null, origin: { kind: "local" }, audience: { kind: "seat", seat: listener.seat },
        channel: family === "q3" ? 6 : 0, volume: 1, attenuation: 0 });
    }
    return true;
  }

  private bank(content: ContentId): Promise<SoundBank> {
    const existing = this.banks.get(content);
    if (existing !== undefined) return existing;
    const pending = this.content.forContent(content).then(mounts => new SoundBank(mounts));
    this.banks.set(content, pending);
    return pending;
  }

  private actor(actor: ActorId): ActorAudio {
    const existing = this.actorAudio.find(value => value.actor.equals(actor));
    if (existing !== undefined) return existing;
    const selectedQ2 = this.content.catalog.product(this.content.recipe.character.definition.content).expectation.family === "q2";
    const state: ActorAudio = { actor, model: selectedQ2 ? this.characterModel : "male", underwater: null, chase: null, painTime: 0 };
    this.actorAudio.push(state);
    return state;
  }

  private sound(content: ContentId, path: string, family: GameFamily, actor: ActorId | null = null, selectedModel?: string): Promise<SoundAsset | null> {
    if (path.startsWith("sound/")) path = path.slice(6);
    const model = selectedModel ?? (family === "q2" ? actor === null ? "male" : this.actor(actor).model : this.characterModel);
    const fallback = family === "q3" && path.startsWith("*") ? q3VoiceFallback(this.content.catalog, content, this.q3TeamGame()) : "";
    const key = `${content}/${family}/${path}/${path.startsWith("*") ? `${model}/${fallback}` : ""}`;
    const prior = this.sounds.get(key);
    if (prior !== undefined) return prior;
    const pending = this.loadSound(content, path, family, model, fallback);
    this.sounds.set(key, pending);
    return pending;
  }

  async preloadSound(content: ContentId, path: string, selectedModel?: string): Promise<void> {
    await this.sound(content, path, this.content.catalog.product(content).expectation.family, null, selectedModel);
  }

  async preloadCharacterFootsteps(): Promise<void> {
    const content = this.content.recipe.character.definition.content;
    if (this.content.catalog.product(content).expectation.family !== "q3") return;
    const selected = await this.q3Footsteps(content);
    for (const [kind, path] of Q3_FOOTSTEP_PATHS) if (kind === selected || kind === "metal" || kind === "splash") {
      for (let index = 1; index <= 4; index++) await this.sound(content, `player/footsteps/${path}${index}.wav`, "q3");
    }
  }

  private async loadSound(content: ContentId, path: string, family: GameFamily, model: string, fallback: string): Promise<SoundAsset | null> {
    const bank = await this.bank(content);
    const sound = !path.startsWith("*") ? await bank.register(path, family)
      : family === "q2" ? await bank.registerSexedSound(path, model)
      : family === "q3" ? await bank.register(`player/${model}/${path.slice(1)}`, "q3")
        ?? await bank.register(`player/${fallback}/${path.slice(1)}`, "q3") : null;
    if (sound === null && !this.warned.has(`${content}/${path}`)) {
      this.warned.add(`${content}/${path}`);
      this.print(`Sound unavailable: ${content}/${path}\n`);
    }
    return sound;
  }

  private playHaptics(content: ContentId, sound: SoundAsset, actor: ActorId | null, audience: AudioAudience): void {
    const tactile = this.haptics?.soundHaptics(content, sound.name, actor, audience);
    if (tactile !== undefined) void tactile.catch((error: unknown) => {
      if (!this.closed) this.print(`Controller vibration unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }

  private async play(content: ContentId, family: GameFamily, path: string, actor: ActorId | null, origin: Vec3 | null,
    channel: number, volume: number, attenuation: number, delaySeconds = 0, audience: AudioAudience = { kind: "world" }): Promise<void> {
    const sound = await this.sound(content, path, family, actor);
    if (sound === null || this.closed) return;
    this.playHaptics(content, sound, actor, audience);
    this.engine.play({ sound, family, actor, origin: origin !== null ? { kind: "fixed", position: origin }
      : actor === null ? { kind: "local" } : { kind: "actor", actor }, audience, channel, volume, attenuation, delaySeconds });
  }

  async playMusic(content: ContentId, track: string): Promise<void> {
    const bank = await this.bank(content), product = this.content.catalog.product(content).expectation;
    const alternate = q1MusicFallback(content, this.content.catalog);
    let tracks: readonly string[] = [];
    if (product.family === "q2") {
      let pending = this.playlists.get(content);
      if (pending === undefined) { pending = this.content.forContent(content).then(mountedMusicTracks); this.playlists.set(content, pending); }
      tracks = await pending;
    }
    if (!this.closed) await this.music.play({ content, ...product }, bank, track,
      alternate === null ? null : async path => (await this.bank(alternate)).openMusic(path, alternate), { shuffle: this.musicPreferences.musicShuffle, tracks });
  }

  async startWorldMusic(): Promise<void> {
    const world = parseEntities(this.content.world.entities).find(entity => entity.get("classname") === "worldspawn");
    const content = this.content.recipe.map.entities.content;
    const track = worldMusicTrack(world, this.content.catalog.product(content).expectation);
    await this.playMusic(content, track);
  }

  private async q3Footsteps(content: ContentId): Promise<PlayerFootsteps> {
    const prior = this.footsteps.get(content);
    if (prior !== undefined) return prior;
    const pending = (async (): Promise<PlayerFootsteps> => {
      const mounts = await this.content.forContent(content);
      const file = await mounts.open(`models/players/${this.characterModel}/animation.cfg`)
        ?? await mounts.open("models/players/sarge/animation.cfg");
      return file === null ? "normal" : parsePlayerAnimationConfig(new TextDecoder().decode(file.bytes), file.reference.requestedPath).footsteps;
    })();
    this.footsteps.set(content, pending);
    return pending;
  }

  private async characterSound(content: ContentId, event: Q3CharacterPresentationEvent, audience: AudioAudience): Promise<void> {
    const actor = event.actor, state = this.actor(actor);
    const play = (path: string, channel: number): Promise<void> => this.play(content, "q3", path, actor, null, channel, 1, 1, 0, audience);
    switch (event.event & ~0x300) {
      case EntityEvent.EV_PAIN: {
        if (((event.timeMilliseconds - state.painTime) | 0) < 500) return;
        state.painTime = event.timeMilliseconds;
        const health = event.parameter;
        await play(`*pain${health < 25 ? 25 : health < 50 ? 50 : health < 75 ? 75 : 100}_1.wav`, 3);
        break;
      }
      case EntityEvent.EV_DEATH1: case EntityEvent.EV_DEATH2: case EntityEvent.EV_DEATH3:
        await play(`*death${(event.event & ~0x300) - EntityEvent.EV_DEATH1 + 1}.wav`, 3); break;
      case EntityEvent.EV_JUMP_PAD: {
        const origin = this.snapshot?.bodies.find(body => body.actor.equals(actor))?.body.origin;
        if (origin !== undefined) await this.play(content, "q3", "world/jumppad.wav", null, origin, 3, 1, 1);
        await play("*jump1.wav", 3); break;
      }
      case EntityEvent.EV_JUMP: await play("*jump1.wav", 3); break;
      case EntityEvent.EV_TAUNT: await play("*taunt.wav", 3); break;
      case EntityEvent.EV_FALL_SHORT: await play("player/land1.wav", 0); break;
      case EntityEvent.EV_FALL_MEDIUM: await play("*pain100_1.wav", 3); break;
      case EntityEvent.EV_FALL_FAR: state.painTime = event.timeMilliseconds; await play("*fall1.wav", 0); break;
      case EntityEvent.EV_WATER_TOUCH: await play("player/watr_in.wav", 0); break;
      case EntityEvent.EV_WATER_LEAVE: await play("player/watr_out.wav", 0); break;
      case EntityEvent.EV_WATER_UNDER: await play("player/watr_un.wav", 0); break;
      case EntityEvent.EV_WATER_CLEAR: await play("*gasp.wav", 0); break;
      case EntityEvent.EV_FOOTSTEP: case EntityEvent.EV_FOOTSTEP_METAL:
      case EntityEvent.EV_FOOTSPLASH: case EntityEvent.EV_FOOTWADE: case EntityEvent.EV_SWIM: {
        const kind = (event.event & ~0x300) === EntityEvent.EV_FOOTSTEP ? await this.q3Footsteps(content) : (event.event & ~0x300) === EntityEvent.EV_FOOTSTEP_METAL ? "metal" : "splash";
        const name = kind === "normal" ? "step" : kind === "metal" ? "clank" : kind;
        await play(`player/footsteps/${name}${(this.random.rand() & 3) + 1}.wav`, 5); break;
      }
      case EntityEvent.EV_PLAYER_TELEPORT_IN: await play("world/telein.wav", 0); break;
      case EntityEvent.EV_PLAYER_TELEPORT_OUT: await play("world/teleout.wav", 0); break;
      case EntityEvent.EV_GIB_PLAYER: await play("player/gibsplt1.wav", 5); break;
      case EntityEvent.EV_ITEM_POP: case EntityEvent.EV_ITEM_RESPAWN: await play("items/respawn1.wav", 0); break;
      case EntityEvent.EV_CHANGE_WEAPON: await play("weapons/change.wav", 0); break;
      case EntityEvent.EV_STOPLOOPINGSOUND: this.stopLoop(actor, audience); break;
    }
  }

  private stopLoop(actor: ActorId, audience: AudioAudience = { kind: "world" }): void {
    for (let index = this.loops.length - 1; index >= 0; index--) { const loop = this.loops[index]; if (loop?.actor.equals(actor) && (audience.kind === "world" || loop.audience.kind === "seat" && loop.audience.seat.equals(audience.seat))) this.loops.splice(index, 1); }
    this.engine.stopLoop(actor, audience);
  }

  private async chat(content: ContentId, family: GameFamily, target: ActorId | null, audience: AudioAudience = { kind: "world" }): Promise<void> {
    for (const listener of this.listeners) {
      if (audience.kind === "seat" && !listener.seat.equals(audience.seat)) continue;
      if (target !== null && !listener.actor?.equals(target)) continue;
      await this.play(content, family, family === "q3" ? "player/talk.wav" : "misc/talk.wav", null, null, 0, 1, 0, 0,
        { kind: "seat", seat: listener.seat });
    }
  }

  async receive(events: readonly SimulationPresentationEvent[], audience: AudioAudience = { kind: "world" }, music = true): Promise<void> {
    for (const source of events) {
      if (source.kind === "music") {
        if (music) await this.playMusic(source.content, String(source.event.track));
      } else if (source.kind === "q1") {
        const event = source.event;
        if (event.kind === "sound") {
          const channel = typeof event.channel === "number" ? event.channel : event.channel === "auto" ? 0 : event.channel === "weapon" ? 1 : event.channel === "voice" ? 2 : event.channel === "item" ? 3 : 4;
          await this.play(source.content, "q1", event.path, event.actor, event.origin ?? null, channel, event.volume, event.attenuation, 0, audience);
        } else if (event.kind === "stop-sound") {
          const command = sourceSoundChannel("q1", event.channel);
          if (command.kind === "replace-actor") throw new Error("NetQuake stop sound requires a nonnegative channel");
          this.engine.stopSound(event.actor, command.kind === "auto" ? null : command.channel, audience);
        } else if (event.kind === "ambient") {
          const sound = await this.sound(source.content, event.path, "q1");
          if (sound !== null && sound.pcm.loopStart !== null) this.statics.push({ audience, sound, origin: event.origin,
            volume: Math.trunc(event.volume * 255), attenuation: Math.trunc(event.attenuation * 64), seats: [] });
        }
      } else if (source.kind === "q1-level" && source.event.kind === "finale") {
        if (music) await this.playMusic(source.content, String(source.event.track));
      } else if (source.kind === "q2") {
        const event = source.event;
        if (event.kind === "music") { if (music) await this.playMusic(source.content, event.track); }
        else if (event.kind === "sound") {
          if (event.loop === "stop" && event.actor !== null) this.stopLoop(event.actor, audience);
          else if (event.loop === "start" && event.actor !== null) {
            const sound = await this.sound(source.content, event.path, "q2", event.actor);
            this.stopLoop(event.actor, audience);
            this.engine.updateActor(event.actor, event.origin);
            if (sound !== null) this.loops.push({ sound, family: "q2", actor: event.actor, origin: { kind: "actor", actor: event.actor },
              audience, volume: event.volume, attenuation: event.attenuation, velocity: { x: 0, y: 0, z: 0 },
              frameNumber: 0, lifetime: "frame" });
          } else {
            const live = event.actor !== null && this.snapshot?.actors.some(actor => event.actor?.equals(actor.id));
            await this.play(source.content, "q2", event.path, event.actor, live ? null : event.origin, event.channel, event.volume, event.attenuation, 0, audience);
          }
        } else if (event.kind === "monster-muzzleflash") {
          const sounds = q2MonsterMuzzleSounds(event.flash, () => this.random.rand(), this.content.catalog.product(source.content).expectation.edition === "rerelease");
          if (sounds === null) this.print(`Unresolved Quake II monster muzzle sound ${event.flash}\n`);
          else for (const sound of sounds) await this.play(source.content, "q2", sound.path, event.actor, null, sound.channel, sound.volume, sound.attenuation, sound.delaySeconds, audience);
        } else if (event.kind === "entity-event") {
          const sound = q2EntitySound(event.event, () => this.random.rand());
          if (sound !== null) await this.play(source.content, "q2", sound.path, event.actor, null, sound.channel, sound.volume, sound.attenuation, 0, audience);
        } else if (event.kind === "print" && event.level === "chat") await this.chat(source.content, "q2", event.actor, audience);
      } else if (source.kind === "q2-rerelease" && source.event.kind === "mission-objective" && source.event.talkSound) {
        await this.chat(source.content, "q2", source.event.actor, audience);
      } else if (source.kind === "q2-player") {
        const event = source.event;
        if (event.kind === "userinfo") { this.actor(event.actor).model = event.skin.split("/")[0] || "male"; if (event.name === "") this.stopLoop(event.actor, audience); }
        else if (event.kind === "view") this.actor(event.actor).underwater = event.view.underwater;
        else if (event.kind === "chase") this.actor(event.actor).chase = event.target;
        else if (event.kind === "print" && event.level === "chat") await this.chat(source.content, "q2", event.target, audience);
      } else if (source.kind === "q2-weapon" && source.event.kind === "muzzleflash") {
        for (const sound of q2MuzzleSounds(source.event.flash, source.event.silenced, () => this.random.rand(), this.content.catalog.product(source.content).expectation.edition === "rerelease"))
          await this.play(source.content, "q2", sound.path, source.event.actor, null, sound.channel, sound.volume, sound.attenuation, sound.delaySeconds, audience);
      } else if (source.kind === "q3-character") await this.characterSound(source.content, source.event, audience);
    }
  }

  async frame(snapshot: WorldSnapshot, listeners: readonly AudioListener[], events: readonly SimulationPresentationEvent[], frameStartedAt = performance.now(), seatEvents: readonly ApplicationAudioSeatEvents[] = []): Promise<void> {
    this.seatScenes = seatEvents.flatMap(batch => batch.scene === undefined ? [] : [{ seat: batch.seat, scene: batch.scene }]);
    this.syncGeometry();
    this.engine.setEffectsVolume(this.effectsVolume); this.music.volume = this.musicVolume;
    const snapshots = [snapshot, ...seatEvents.map(batch => batch.snapshot)];
    const actors = snapshots.flatMap(value => value.actors), bodies = snapshots.flatMap(value => value.bodies);
    this.snapshot = { ...snapshot, actors: actors.filter((actor, index) => actors.findIndex(other => other.id.equals(actor.id)) === index),
      bodies: bodies.filter((body, index) => bodies.findIndex(other => other.actor.equals(body.actor)) === index) };
    this.listeners = listeners;
    for (const body of this.snapshot.bodies) this.engine.updateActor(body.actor, body.body.origin);
    this.engine.setListeners(listeners);
    for (let index = this.environmentSeats.length - 1; index >= 0; index--) {
      const seat = this.environmentSeats[index];
      if (seat !== undefined && !listeners.some(listener => listener.seat.equals(seat))) this.environmentSeats.splice(index, 1);
    }
    if (this.environment !== null) for (const listener of listeners) {
      if (this.environmentSeats.some(seat => seat.equals(listener.seat))) continue;
      this.engine.setEnvironment(listener.seat, this.environment.definitions, this.environment.trace(listener));
      this.environmentSeats.push(listener.seat);
    }
    this.engine.beginLoopFrame();
    for (const event of this.uiSounds.splice(0)) {
      const content = this.content.recipe.presentation.audio.content, family = this.content.catalog.product(content).expectation.family;
      const sound = await this.sound(content, menuSoundPath(family, event.sound), family);
      if (sound !== null) this.engine.play({ sound, family, actor: null, origin: { kind: "local" }, audience: { kind: "seat", seat: event.seat },
        channel: 0, volume: 1, attenuation: 0 });
    }
    await this.receive(events);
    for (const batch of seatEvents) await this.receive(batch.events, { kind: "seat", seat: batch.seat }, batch.music);
    const effects: { readonly sound: ApplicationEffectSound; readonly audience: AudioAudience }[] = this.effectSounds.splice(0).map(sound => ({ sound, audience: { kind: "world" } }));
    for (const batch of seatEvents) for (const sound of batch.effectSounds ?? []) effects.push({ sound, audience: { kind: "seat", seat: batch.seat } });
    for (const { sound, audience } of effects) {
      const family = this.content.catalog.product(sound.content).expectation.family;
      if (sound.playback.kind === "once") await this.play(sound.content, family, sound.path, null, sound.origin, sound.channel, sound.volume, 1, 0, audience);
      else if (sound.playback.kind === "actor") await this.play(sound.content, family, sound.path, sound.playback.actor, null, sound.channel, sound.volume, 1, 0, audience);
      else {
        const asset = await this.sound(sound.content, sound.path, family, sound.playback.actor);
        if (asset !== null) this.engine.loop({ sound: asset, family, actor: sound.playback.actor, origin: { kind: "fixed", position: sound.origin },
          audience, volume: sound.volume, attenuation: 1, velocity: sound.playback.velocity, frameNumber: snapshot.frame.frame, lifetime: "frame" });
      }
    }
    if (this.closed) return;
    this.engine.setListeners(listeners.map(listener => {
      if (listener.actor === null) return listener;
      const state = this.actor(listener.actor), followed = state.chase === null ? state : this.actor(state.chase);
      return { ...listener, underwater: followed.underwater ?? listener.underwater };
    }));
    for (const loop of [...this.loops]) {
      if (!this.snapshot.actors.some(actor => actor.id.equals(loop.actor))) { this.stopLoop(loop.actor, loop.audience); continue; }
      this.engine.loop({ ...loop, frameNumber: snapshot.frame.frame });
    }
    for (const sound of this.statics) {
      for (let index = sound.seats.length - 1; index >= 0; index--) {
        const seat = sound.seats[index];
        if (seat !== undefined && !listeners.some(listener => listener.seat.equals(seat))) sound.seats.splice(index, 1);
      }
      for (const listener of listeners) if ((sound.audience.kind === "world" || sound.audience.seat.equals(listener.seat)) && !sound.seats.some(seat => seat.equals(listener.seat))) {
        this.engine.addStaticSound(listener.seat, sound.sound, sound.origin, sound.volume, sound.attenuation);
        sound.seats.push(listener.seat);
      }
    }
    if (this.content.world.kind === "q1-bsp") {
      const content = this.content.recipe.map.entities.content;
      const water = await this.sound(content, "ambience/water1.wav", "q1"), wind = await this.sound(content, "ambience/wind2.wav", "q1");
      if (water !== null && wind !== null) for (const listener of listeners) {
        const leaf = this.content.world.leaves[findQ1Leaf(this.content.world, listener.origin)];
        const elapsed = snapshot.frame.elapsed;
        this.engine.updateAmbient(listener.seat, [water, wind], leaf?.ambientSound ?? [0, 0], elapsed.value / (elapsed.kind === "milliseconds" ? 1000 : 1));
      }
    }
    for (const frame of this.cgameFrames.splice(0)) {
      if (!listeners.some(listener => listener.seat.equals(frame.seat))) continue;
      for (const operation of frame.operations) switch (operation.kind) {
        case "play":
          this.playHaptics(frame.content, operation.sound.sound, operation.sound.actor, operation.sound.audience);
          this.engine.play(operation.sound); break;
        case "loop": this.engine.loop(operation.sound); break;
        case "position": this.engine.updateQ3SeatActor(frame.seat, operation.actor, operation.origin); break;
        case "clear-loops": this.engine.clearQ3SeatLoops(frame.seat, operation.killAll); break;
        case "stop-loop": this.engine.stopQ3SeatLoop(frame.seat, operation.actor); break;
      }
    }
    this.engine.endLoopFrame();
    await this.music.updateAutomatic(this.musicPreferences.musicShuffle);
    this.engine.updateMusic();
    this.engine.pump(undefined, performance.now() - frameStartedAt);
  }

  resetRound(): void {
    if (this.closed) throw new Error("Application audio closed");
    this.music.stopPlayback("source");
    this.engine.resetRound();
    this.actorAudio.length = 0; this.loops.length = 0; this.statics.length = 0;
    this.uiSounds.length = 0; this.effectSounds.length = 0; this.cgameFrames.length = 0;
    this.listeners = []; this.seatScenes = []; this.snapshot = null; this.environmentSeats.length = 0;
  }

  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    this.geometry = null; this.geometryEnabled = false;
    this.music.stop(); this.engine.close(); this.banks.clear(); this.sounds.clear(); this.footsteps.clear();
    this.actorAudio.length = 0; this.loops.length = 0; this.statics.length = 0; this.uiSounds.length = 0; this.effectSounds.length = 0; this.cgameFrames.length = 0;
    this.listeners = []; this.seatScenes = []; this.snapshot = null;
    return undefined;
  }
}
