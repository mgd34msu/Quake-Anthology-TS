import type { WeaponHudReader } from "./player-state.ts";
// Composition of source cgame runtimes over one unified client/seat. GPL-2.0-or-later.
import type { Axis } from "../../../contracts/math.ts";
import type { CommandContext } from "../../../contracts/common.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import type { Product } from "../base/shared/definitions.ts";
import type { SourcePlayerState } from "../base/shared/player-state.ts";
import type { StartSoundOptions } from "../../../audio/mixer.ts";
import type { Draw2D } from "../../../text/draw2d.ts";
import type { WorldScene } from "../../../render/scene/world.ts";
import type { ClientEntity } from "./state.ts";
import type { RefModelEntity } from "./ref-entity.ts";
import type { SnapshotSource } from "./snapshots.ts";
import type { CommandSource } from "./prediction.ts";
import type { PresentationMovementHost } from "./movement-host.ts";
import type { Q3PresentationSoundBank } from "./audio.ts";
import type { Q3SceneRecorder } from "./scene.ts";
import type { LightingSample } from "./scene-host.ts";
import { Q3PresentationFrameRuntime } from "./frame.ts";
import type { PcmSound } from "../../../audio/wav.ts";
import type { CollisionWorld } from "./collision-host.ts";
import { CommonError } from "../../../core/common-error.ts";
import type { CvarSnapshot } from "../../../core/cvars/index.ts";
import { infoValueForKey } from "../../../core/info-string.ts";
import type { Vec3 } from "../../../core/math.ts";
import { EngineUiModelPainter } from "./ui-adapters.ts";
import { gameFormat } from "../base/game/format.ts";
import { GameRandom, gameAtoi } from "../base/game/numeric.ts";
import { UiAssetRegistry } from "../../../text/q3-font.ts";
import { worldMarkProjector } from "./mark-projector.ts";
import type { RendererResources } from "./resources.ts";
import { Team, Weapon } from "../base/shared/definitions.ts";
import { ClientConfiguration, ClientVmCvarSymbol } from "./config.ts";
import { ClientConsoleRuntime, clientConsoleCommandNames } from "./console.ts";
import { ClientDrawIcons } from "./draw-icons.ts";
import { ClientDrawStatus } from "./draw-status.ts";
import { ClientDrawTools, drawStrlen, fadeColor } from "./draw-tools.ts";
import { ClientEffects } from "./effects.ts";
import { PacketEntityPresenter } from "./entities.ts";
import { ClientEventRuntime } from "./events.ts";
import { ClientFrameAudio } from "./frame-audio.ts";
import { ClientHud } from "./hud.ts";
import { ClientHudCorners } from "./hud-corners.ts";
import { ClientLoadingScreen } from "./info.ts";
import { LocalEntityPool, LocalEntitySystem } from "./local-entities.ts";
import { ImpactMarkSystem } from "./marks.ts";
import { ClientMedia, registerClientLoadingGraphics, registerClientSounds, registerClientGraphics, registerClients } from "./media.ts";
import type { ClientMediaHost } from "./media.ts";
import { MissionHud } from "./mission-hud.ts";
import type { MissionHudHost } from "./mission-hud.ts";
import { ParticleSystem } from "../../../render/scene/particles/q3-system.ts";
import { PlayerStateRuntime } from "./player-state.ts";
import { ClientInfoStore, PlayerPresenter } from "./players.ts";
import { PredictionRuntime } from "./prediction.ts";
import { BaseScoreboard } from "./scoreboard.ts";
import { ClientServerCommandRuntime } from "./server-commands.ts";
import { SnapshotRuntime } from "./snapshots.ts";
import type { SoundAssetReader } from "./resources.ts";
import { ClientGameState, ClientGameStaticState } from "./state.ts";
import { ViewRuntime } from "./view.ts";
import { ClientWeaponRuntime, ClientWeaponSelection } from "./weapons.ts";


export interface Q3PresentationSession {
  readonly product: Product; readonly clientNumber: number; readonly serverMessageSequence: number;
  readonly lastExecutedServerCommand: number; readonly mode: { readonly kind: "demo" | "live" };
  readonly commands: CommandSource; readonly snapshots: SnapshotSource; readonly cvars: CvarRegistry;
  getGameState(): readonly string[];
  getServerCommand(sequence: number): readonly string[] | null | Promise<readonly string[] | null>;
  snapshotPing(number: number): number | null;
  addReliableCommand(text: string): void;
  appendConsoleCommand(text: string): void;
  registerCgameCommand(name: string): void;
  setUserCommandValue(weapon: number, sensitivity: number): void;
  assertCurrent(): void;
  print(text: string): void;
}
export interface Q3ClientSound {
  readonly bank: Q3PresentationSoundBank;
  startSound(origin: Vec3 | null, entity: number, channel: number, pcm: PcmSound | null): void;
  startSourceSound(pcm: PcmSound | null, options: StartSoundOptions): void;
  startLocalSound(pcm: PcmSound | null, channel: number): void;
  addLoopSound(entity: number, origin: Vec3, velocity: Vec3, pcm: PcmSound | null, real: boolean): void;
  updateSoundPosition(entity: number, position: Vec3): void;
  stopLoopingSound(entity: number): void;
  clearLoopingSounds(killAll: boolean): void;
  setListener(client: number, origin: Vec3, axis: Axis): void;
  startBackgroundTrack(intro: string, loop: string): Promise<void>;
}
export interface Q3ClientPresentationOptions {
  readonly weaponHud?: WeaponHudReader;
  readonly session: Q3PresentationSession; readonly commandContext: CommandContext;
  readonly assets: SoundAssetReader; readonly resources: RendererResources; readonly scene: Q3SceneRecorder;
  readonly world: WorldScene; readonly collision: CollisionWorld; readonly movement: PresentationMovementHost;
  readonly sound: Q3ClientSound; readonly draw: Draw2D; readonly fontRegistry: UiAssetRegistry;
  readonly target: { readonly width: number; readonly height: number };
  readonly hardware: "generic" | "ragepro"; readonly sourceDebug?: boolean;
  readonly clock: { milliseconds(): number; serverTime(): number; frameNumber(): number };
  readonly menus: { readonly kind: "baseq3" } | ({ readonly kind: "missionpack" } & Pick<MissionHudHost, "cinematics" | "audio" | "setKeyCatcher">);
  memoryRemaining(): number;
  updateLoadingScreen(draw: () => Promise<void>): Promise<void>;
  lightForPoint(point: Vec3): LightingSample;
  /** The selected character and arsenal receive source data before optional Q3 fallback. */
  character(entity: ClientEntity, source: () => void): void;
  event(entity: ClientEntity, position: Vec3, source: () => Promise<void>): Promise<void>;
  predictItem(entity: ClientEntity, source: () => void): void;
  viewWeapon(state: SourcePlayerState, source: () => void): void;
  playerWeapon(parent: RefModelEntity, state: SourcePlayerState | null, entity: ClientEntity, team: Team, source: () => void): void;
}
interface FrameContext { loading: boolean; demoPlayback: boolean; engineFrameNumber: number; }
const VM_SYMBOLS = new Map<string, ClientVmCvarSymbol>();
for (const symbol of Object.values(ClientVmCvarSymbol)) VM_SYMBOLS.set(symbol, symbol);
export async function createQ3ClientPresentation(input: Q3ClientPresentationOptions) {
  input.session.assertCurrent();
    const options = input;
    const { session, resources, assets, sound, target } = options;
    const commands = options.draw.commands;
    const soundBank = sound.bank;
    const memoryRemaining = () => options.memoryRemaining();
    const initialMessageSequence = session.serverMessageSequence;
    const state = new ClientGameState(session.product, session.clientNumber, initialMessageSequence);
    const staticState = new ClientGameStaticState(session.product);
    staticState.serverCommandSequence = session.lastExecutedServerCommand;
    const context: FrameContext = { loading: false, demoPlayback: session.mode.kind === "demo", engineFrameNumber: options.clock.frameNumber() };

    const random = new GameRandom();
    let strings: readonly string[] = Array.from({ length: 1024 }, () => "");
    const configString = (index: number): string => {
      if (Number.isInteger(index) && (index < 0 || index >= 1024)) throw new CommonError("drop", `CG_ConfigString: bad index: ${index}`);
      const value = strings[index];
      if (!Number.isInteger(index) || value === undefined) throw new RangeError(`CG_ConfigString: bad index ${index}`);
      return value;
    };
    const print = (text: string) => session.print(text);
    const setCvar = (name: string, value: string) => { session.cvars.set(name, value, true); };
    const readVm = (name: string): CvarSnapshot => {
      const symbol = VM_SYMBOLS.get(name);
      return symbol === undefined ? configuration.readVmCvar(name) : configuration.readVmSymbol(symbol);
    };
    const integer = (name: string) => readVm(name).integerValue;
    const numeric = (name: string) => readVm(name).numericValue;
    const enabled = (name: string) => integer(name) !== 0;
    const missionEnabled = (name: string) => session.product === "missionpack" && enabled(name);
    const sendClientCommand = (text: string) => { session.addReliableCommand(text); };
    const sendConsoleCommand = (text: string) => session.appendConsoleCommand(text);
    const startSound = (origin: Vec3 | null, entity: number, channel: number, pcm: PcmSound | null) => {
      sound.startSound(origin, entity, channel, pcm);
    };
    const startLocalSound = (pcm: PcmSound | null, channel: number) => {
      sound.startLocalSound(pcm, channel);
    };
    const addLoopSound = (entity: number, origin: Vec3, velocity: Vec3, pcm: PcmSound | null, realLoop: boolean) => {
      if (realLoop) sound.addLoopSound(entity, origin, velocity, pcm, true);
      else sound.addLoopSound(entity, origin, velocity, pcm, false);
    };
    const clients = new ClientInfoStore({ state, assets, resources, print,
      memoryRemaining,
      registerShaderNoMip: name => resources.registerShaderNoMip(name),
      registerSound: (name, compressed) => soundBank.registerSound(name, compressed),
      sound: (name, compressed) => soundBank.sound(name, compressed),
      settings: () => ({ gameType: staticState.gameType, maxClients: staticState.maxclients, forceModel: enabled("cg_forceModel"),
        model: session.cvars.get("model")?.value ?? "", headModel: session.cvars.get("headmodel")?.value ?? "",
        redTeamName: session.product === "missionpack" ? readVm("cg_redTeamName").value : "",
        blueTeamName: session.product === "missionpack" ? readVm("cg_blueTeamName").value : "",
        deferPlayers: enabled("cg_deferPlayers"), buildScript: enabled("cg_buildScript"), loading: context.loading }),
    }, staticState.clientInfo);
    const configuration = new ClientConfiguration(session.product, { state, staticState, cvars: session.cvars, clients, configString });
    const media = new ClientMedia(session.product, staticState, resources, soundBank);
    const draw = options.draw, tools = new ClientDrawTools(draw, media);
    const icons = new ClientDrawIcons(state, tools, () => ({ drawIcons: enabled("cg_drawIcons"), draw3dIcons: enabled("cg_draw3dIcons") }), commands);
    const loading = new ClientLoadingScreen(state, media, session.cvars, { configString, updateScreen: async () => {
      session.assertCurrent();
      if (session.serverMessageSequence !== initialMessageSequence) throw new Error("Snapshot parsing must serialize behind cgame initialization");
      await options.updateLoadingScreen(() => loading.drawInformation(draw));
    } });
    const serverCommands = new ClientServerCommandRuntime({ state, staticState, clients, resources, assets, random,
      resetPlayerEntity: entity => players.resetPlayerEntity(entity), getServerCommand: sequence => session.getServerCommand(sequence),
      refreshGameState: () => { strings = session.getGameState(); }, configString, readVmCvar: readVm, setCvar, print,
      centerPrint: (text, y, width) => status.centerPrint(text, y, width), sendConsoleCommand,
      sound: name => media.sounds[name], registerSound: (path, compressed) => soundBank.registerSound(path, compressed), startLocalSound,
      startBackgroundTrack: (intro, loop) => sound.startBackgroundTrack(intro, loop), remapShader: (original, replacement, offset) => resources.remapShader(original, replacement, offset),
      clearLocalEntities: () => pool.initialize(), clearMarks: () => marks.reset(), clearParticles: () => particles.clear(resources),
      clearLoopingSounds: killAll => sound.clearLoopingSounds(killAll),
      setScoreSelection: () => { if (menus === null) throw new Error("Mission score selection called in baseq3"); menus.setScoreSelection(); },
      showResponseHead: () => { if (menus === null) throw new Error("Mission response head called in baseq3"); return menus.showResponseHead(); },
      memoryRemaining,
    });
    const snapshots = new SnapshotRuntime(state, { source: session.snapshots,
      get demoPlayback() { return context.demoPlayback; }, get noPredict() { return enabled("cg_nopredict"); },
      get synchronousClients() { return enabled("cg_synchronousClients"); },
      executeServerCommands: sequence => serverCommands.executeNewServerCommands(sequence), respawn: () => playerState.respawn(),
      resetPlayerEntity: entity => players.resetPlayerEntity(entity), checkEvents: entity => events.checkEvents(entity),
      transitionPlayerState: (current, previous) => playerState.transitionPlayerState(current, previous),
      lagometerSnapshot: snapshot => {
        if (snapshot === null) { status.addLagometerSnapshotInfo(null); return; }
        const ping = session.snapshotPing(snapshot.messageNumber);
        if (ping === null) throw new Error("Cgame snapshot has no engine-owned ping record");
        status.addLagometerSnapshotInfo({ ping, flags: snapshot.flags });
      }, warn: print,
    });
    const view = new ViewRuntime(state, { state,
      trace: (start, end, bounds, skip, mask) => prediction.trace(start, end, bounds, skip, mask),
      pointContents: (point, passEntity) => prediction.pointContents(point, passEntity),
    }, {
      settings: () => ({ videoWidth: target.width, videoHeight: target.height, viewSize: integer("cg_viewsize"),
        thirdPerson: enabled("cg_thirdPerson"), thirdPersonRange: numeric("cg_thirdPersonRange"), thirdPersonAngle: numeric("cg_thirdPersonAngle"),
        cameraMode: enabled("cg_cameraMode"), cameraOrbitInteger: integer("cg_cameraOrbit"), cameraOrbitValue: numeric("cg_cameraOrbit"),
        cameraOrbitDelay: integer("cg_cameraOrbitDelay"), errorDecay: numeric("cg_errorDecay"), runPitch: numeric("cg_runpitch"), runRoll: numeric("cg_runroll"),
        bobPitch: numeric("cg_bobpitch"), bobRoll: numeric("cg_bobroll"), bobUp: numeric("cg_bobup"), fov: numeric("cg_fov"), zoomFov: numeric("cg_zoomFov"),
        dmFlags: staticState.dmFlags, gunX: numeric("cg_gun_x"), gunY: numeric("cg_gun_y"), gunZ: numeric("cg_gun_z") }),
      setViewSize: value => setCvar("cg_viewsize", String(value)),
      setThirdPersonAngleValue: value => configuration.setVmNumericValue(ClientVmCvarSymbol.cg_thirdPersonAngle, value),
      registerModel: path => resources.registerModel(path), print,
    });
    const menus = options.menus.kind === "baseq3" ? null : new MissionHud(state, staticState, media, {
      ...options.menus, ...(options.weaponHud === undefined ? {} : { weaponHud: options.weaponHud }), modelPainter: new EngineUiModelPainter(resources, commands),
      assets, fontRegistry: options.fontRegistry, icons, configuration, cvars: session.cvars,
      commands: { append: sendConsoleCommand }, commandContext: options.commandContext, clients, random, configString, resetPlayerEntity: entity => players.resetPlayerEntity(entity),
      print, milliseconds: () => options.clock.milliseconds(),
    });
    const status = new ClientDrawStatus(state, staticState, tools, menus === null ? { kind: "baseq3" } : { kind: "missionpack", fonts: menus.fonts },
      { commands: session.commands, readVmCvar: readVm });
    const frameAudio = new ClientFrameAudio(state, media.sounds, { startSound, startLocalSound });
    const console = new ClientConsoleRuntime(state, staticState, { cvars: session.cvars, view, weapons: new ClientWeaponSelection(state), clients, serverCommands,
      hud: menus === null ? { kind: "unavailable", reason: "Base cgame has no mission menu console commands" } : menus,
      teamOrders: menus === null ? { kind: "unavailable", reason: "Base cgame has no mission team-order console commands" } : menus,
      readVmCvar: readVm, resetPlayerEntity: entity => players.resetPlayerEntity(entity), addCommand: name => session.registerCgameCommand(name),
      sendClientCommand, sendConsoleCommand, print, centerPrint: (text, y, width) => status.centerPrint(text, y, width),
      sound: name => media.sounds[name], addBufferedSound: sound => frameAudio.addBufferedSound(sound),
    });

    await registerClientLoadingGraphics(media);
    configuration.registerCvars();
    for (const name of clientConsoleCommandNames(session.product)) session.registerCgameCommand(name);
    state.weaponSelect = Weapon.WP_MACHINEGUN;
    staticState.redflag = -1; staticState.blueflag = -1; staticState.flagStatus = -1;
    strings = session.getGameState();
    if (configString(20) !== "baseq3-1") throw new CommonError("drop", `Client/Server game mismatch: baseq3-1/${configString(20)}`);
    staticState.levelStartTime = gameAtoi(configString(21));
    serverCommands.parseServerInfo();
    await loading.loadingString("collision map");
    const collision = options.collision;
    context.loading = true;
    const mediaHost: ClientMediaHost = { state, staticState, clients, commands: serverCommands, configString,
      settings: () => ({ buildScript: enabled("cg_buildScript") }), loadingString: text => loading.loadingString(text),
      loadingItem: index => loading.loadingItem(index), loadingClient: index => loading.loadingClient(index), clearScene: () => resources.clearScene() };
    await loading.loadingString("sounds"); await registerClientSounds(media, mediaHost);
    await loading.loadingString("graphics"); const { particleAnimations } = await registerClientGraphics(media, mediaHost);
    await loading.loadingString("clients"); await registerClients(media, mediaHost);

    // Registered scalar media projections are captured only after their source registration phase.
    const pool = new LocalEntityPool(session.product);
    const prediction: PredictionRuntime = new PredictionRuntime(state, collision, { commandTiming: options.movement.commandTiming,
      movePlayer: (state, command, settings) => options.movement.movePlayer(state, command, settings),
      updateViewAngles: (state, command) => options.movement.updateViewAngles(state, command), commands: session.commands, predictItem: (entity, source) => options.predictItem(entity, source),
      ...(options.sourceDebug ? { eventDebug: { kind: "source-debug", module: "cgame",
        showEvents: () => session.cvars.get("showevents")?.value ?? "", print } } : {}),
      settings: () => ({ gameType: staticState.gameType, dmFlags: staticState.dmFlags, demoPlayback: context.demoPlayback,
        noPredict: enabled("cg_nopredict"), synchronousClients: enabled("cg_synchronousClients"), predictItems: enabled("cg_predictItems"),
        pmoveFixed: enabled("pmove_fixed"), pmoveMsec: integer("pmove_msec"), errorDecayInteger: integer("cg_errorDecay"),
        errorDecayValue: numeric("cg_errorDecay"), showMiss: integer("cg_showmiss") }),
      setPmoveMsec: value => setCvar("pmove_msec", String(value)), transitionPlayerState: (current, previous) => playerState.transitionPlayerState(current, previous), warn: print });
    const effects = new ClientEffects(state, pool, media.effects, {
      get noProjectileTrail() { return enabled("cg_noProjectileTrail"); }, get blood() { return enabled("cg_blood"); },
      get gibs() { return enabled("cg_gibs"); }, get scorePlum() { return enabled("cg_scorePlum"); }, hardware: options.hardware,
    }, { randomInteger: () => random.rand(), startSound });
    const marks = new ImpactMarkSystem(worldMarkProjector(options.world), {
      clock: () => state.time, enabled: () => enabled("cg_addMarks"), energyShader: () => media.graphics.energyMarkShader });
    const particles = new ParticleSystem(state, { animations: particleAnimations, media: media.particles, prediction, random,
      hardwareType: options.hardware === "ragepro" ? "rage-pro" : "generic", configString, print });
    const localEntities = new LocalEntitySystem(effects, { ...media.localEntities, prediction, collision, audio: { startSound: (pcm, settings) => sound.startSourceSound(pcm, settings) },
      clientNum: state.clientNum, random, marks });
    const weapons: ClientWeaponRuntime = new ClientWeaponRuntime(state, media.weaponRegistry, { prediction, random, localEntities: pool, effects, marks, particles,
      media: media.weapons, startSound, addLoopSound, addRefEntity: entity => resources.addRefEntity(entity), addLight: light => resources.addLight(light), addPoly: poly => resources.addPoly(poly),
      clientInfo: number => clients.clientInfo(number), sound: (path, compressed) => soundBank.sound(path, compressed),
      drawing: { fadeColor: (start, duration) => fadeColor(state.time, start, duration), setColor: color => draw.setColor(color),
        drawPic: (x, y, width, height, shader) => tools.drawPic({ x, y, width, height }, shader), drawStringLength: drawStrlen,
        drawBigStringColor: (x, y, text, color) => tools.drawBigStringColor(x, y, text, color) },
      settings: () => ({ brassTime: integer("cg_brassTime"), railTrailTime: numeric("cg_railTrailTime"), oldRail: enabled("cg_oldRail"),
        noProjectileTrail: enabled("cg_noProjectileTrail"), oldPlasma: enabled("cg_oldPlasma"), oldRocket: enabled("cg_oldRocket"), trueLightning: numeric("cg_trueLightning"),
        drawGun: enabled("cg_drawGun"), fov: integer("cg_fov"), gunX: numeric("cg_gun_x"), gunY: numeric("cg_gun_y"), gunZ: numeric("cg_gun_z"), gunFrame: 0,
        tracerLength: numeric("cg_tracerLength"), tracerWidth: numeric("cg_tracerWidth"), tracerChance: numeric("cg_tracerChance"), hardware: options.hardware }),
    });
    const players = new PlayerPresenter({ state, media: media.players, clients, collision, effects, random, marks,
      ...(session.product === "baseq3" ? { product: "baseq3" } satisfies { product: "baseq3" }
        : { product: "missionpack", missionMedia: media.missionPlayers } satisfies { product: "missionpack"; missionMedia: typeof media.missionPlayers }),
      trace: (start, end, bounds, skip, mask) => prediction.trace(start, end, bounds, skip, mask),
      addEntity: entity => resources.addRefEntity(entity), addLight: light => resources.addLight(light), addPoly: poly => resources.addPoly(poly),
      lightForPoint: point => options.lightForPoint(point),
      addLoopingSound: (entity, origin, velocity, sound) => addLoopSound(entity, origin, velocity, sound, false),
      addPlayerWeapon: (parent, ps, entity, team) => options.playerWeapon(parent, ps, entity, team, () => weapons.addPlayerWeapon(parent, ps, entity, team)), print,
      settings: () => ({ gameType: staticState.gameType, cameraMode: enabled("cg_cameraMode"), noPlayerAnimations: enabled("cg_noPlayerAnims"),
        animationSpeed: numeric("cg_animSpeed"), swingSpeed: numeric("cg_swingSpeed"), drawFriend: enabled("cg_drawFriend"), shadows: integer("cg_shadows"),
        enableBreath: missionEnabled("cg_enableBreath"), enableDust: missionEnabled("cg_enableDust"), debugPosition: enabled("cg_debugPosition"), debugAnimation: enabled("cg_debugAnim") }),
    });
    const packet = new PacketEntityPresenter(state, media.packet, {
      addRefEntity: entity => resources.addRefEntity(entity), addLight: light => resources.addLight(light),
      updateSoundPosition: (number, position) => sound.updateSoundPosition(number, position), addLoopSound, startSound,
      randomInteger: () => random.rand(), player: entity => options.character(entity, () => players.player(entity)),
      missileTrail: (kind, entity, weapon) => weapons.missileTrail(kind, entity, weapon), grappleTrail: (entity, weapon) => weapons.grappleTrail(entity, weapon),
      addEntityWithPowerups: (entity, state, team) => players.addRefEntityWithPowerups(entity, state, team),
    });
    const eventServices = {
      presentEvent: (entity: ClientEntity, position: Vec3, source: () => Promise<void>) => options.event(entity, position, source),
      media: media.events, get options() { return { gameType: staticState.gameType, debugEvents: enabled("cg_debugEvents"),
        footsteps: enabled("cg_footsteps"), autoswitch: enabled("cg_autoswitch"), demoPlayback: context.demoPlayback, noPredict: enabled("cg_nopredict"),
        synchronousClients: enabled("cg_synchronousClients"), singlePlayerActive: missionEnabled("cg_singlePlayerActive"), cameraOrbit: enabled("cg_cameraOrbit") }; },
      random, entities: packet, weapons, effects,
      clientInfo: (number: number) => clients.clientInfo(number),
      playerName: (number: number) => infoValueForKey(configString(544 + number), "n"),
      soundConfigString: (index: number) => configString(288 + index), customSound: (number: number, name: string) => clients.customSound(number, name),
      registerSound: (path: string | null, compressed: boolean) => soundBank.sound(path, compressed), startSound,
      stopLoopingSound: (number: number) => sound.stopLoopingSound(number), addBufferedSound: (sound: PcmSound | null) => frameAudio.addBufferedSound(sound), print,
      centerPrint: (text: string, y: number, width: number) => status.centerPrint(text, y, width),
    };
    const events: ClientEventRuntime = new ClientEventRuntime(state, session.product === "baseq3" ? { ...eventServices, get options() { return eventServices.options; }, product: "baseq3" }
      : { ...eventServices, get options() { return eventServices.options; }, product: "missionpack", missionSounds: media.sounds, missionEffects: effects, startLocalSound,
        voiceChatLocal: (mode, voiceOnly, clientNum, color, command) => serverCommands.voiceChatLocal(mode, voiceOnly, clientNum, color, command) });
    const transitionServices = { ...(options.weaponHud === undefined ? {} : { weaponHud: options.weaponHud }), staticState, events, sounds: media.sounds, medals: media.graphics,
      get showMiss() { return enabled("cg_showmiss"); }, startLocalSound, addBufferedSound: (sound: PcmSound | null) => frameAudio.addBufferedSound(sound), print };
    const playerState: PlayerStateRuntime = new PlayerStateRuntime(state, session.product === "baseq3" ? { ...transitionServices, get showMiss() { return enabled("cg_showmiss"); }, product: "baseq3" }
      : { ...transitionServices, get showMiss() { return enabled("cg_showmiss"); }, product: "missionpack", missionSounds: media.sounds });
    if (menus !== null) { await menus.assetCache(); await menus.loadHudMenu(); }
    const corners = new ClientHudCorners(state, staticState, icons, { readVmCvar: readVm, configString, milliseconds: () => options.clock.milliseconds() });
    const hud = new ClientHud(state, staticState, { ...(options.weaponHud === undefined ? {} : { weaponHud: options.weaponHud }), icons, status, corners, prediction, weapons, random, readVmCvar: readVm, startLocalSound },
      menus === null ? { kind: "baseq3", scoreboard: new BaseScoreboard(state, staticState, { icons, clients, players, readVmCvar: readVm, configString, sendClientCommand, print }) }
        : { kind: "missionpack", fonts: menus.fonts, menus });

    context.loading = false; pool.initialize(); marks.reset(); state.infoScreenText = "";
    serverCommands.setConfigValues(); await serverCommands.startMusic(); await loading.loadingString("");
    if (menus !== null) menus.initTeamChat();
    await serverCommands.shaderStateChanged(); sound.clearLoopingSounds(true);
    const frames = new Q3PresentationFrameRuntime(state, {
      configuration, media, snapshots, prediction, view, packet, marks, particles, localEntities, weapons, frameAudio,
      serverCommands, hud, status, tools, scene: options.scene, hardware: options.hardware,
      presentViewWeapon: (state, source) => options.viewWeapon(state, source),
      packetOptions: () => ({ gameType: staticState.gameType, smoothClients: enabled("cg_smoothClients"), simpleItems: enabled("cg_simpleItems"), obeliskRespawnDelay: session.product === "missionpack" ? integer("cg_obeliskRespawnDelay") : 0 }),
      enterFrame: frame => { session.assertCurrent(); context.demoPlayback = frame.demoPlayback; context.engineFrameNumber = frame.engineFrameNumber; },
      setUserCommandValue: (weapon, sensitivity) => session.setUserCommandValue(weapon, sensitivity),
      clearLoopingSounds: killAll => sound.clearLoopingSounds(killAll), setListener: (client, origin, axis) => sound.setListener(client, origin, axis),
      loadingFrame: () => loading.drawInformation(draw), setTimescale: value => setCvar("timescale", gameFormat("%f", [value])), print,
    });
    session.assertCurrent();
    return { state, staticState, configuration, media, clients, prediction, view, snapshots, packet, effects, localEntities, particles, marks, weapons, serverCommands, console, frameAudio, loading, hud, status, tools, menus, frames,
      close: () => { frames.close(); menus?.dispose(); console.dispose(); serverCommands.dispose(); pool.initialize(); marks.reset(); particles.clear(resources); sound.clearLoopingSounds(true); options.scene.clearScene(); },
      keyEvent: async (key: number, down: boolean) => { session.assertCurrent(); await menus?.keyEvent(key, down); },
      mouseEvent: async (x: number, y: number) => { session.assertCurrent(); await menus?.mouseEvent(x, y); },
      eventHandling: async (type: number) => { session.assertCurrent(); await menus?.eventHandling(type); },
    };
}
export type Q3ClientPresentation = Awaited<ReturnType<typeof createQ3ClientPresentation>>;
