import type { ComponentBody, PreparedPrimaryBody } from "./component-bodies.ts";
import type { QvmBodyPart } from "../../contracts/qvm-mod-presentation.ts";
import { copyRefEntity, type RefModelEntity } from "../../content/q3/presentation/ref-entity.ts";
import { prepareQ3Model } from "../../content/q3/presentation/scene.ts";
import type { ApplicationKeyProfile } from "./keys.ts";
import { SharedCvarMirror } from "../../core/cvars/mirror.ts";
import { CollisionMapSettings, collisionMapCvarDefinitions } from "../../world/collision/q3/settings.ts";
import { quakeMouseButton } from "../../input/mouse-buttons.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import { KEY_CHAR_FLAG, KeyCode } from "../../input/key-codes.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { infoValueForKey } from "../../core/info-string.ts";
import type { QvmPresentationArtifacts } from "./q3-client/qvm.ts";
import { ApplicationQvmClient } from "./q3-client/qvm.ts";
import type { QvmCvarServices } from "../../compat/qvm/cvar-syscalls.ts";
import { QvmApplicationScalars } from "./q3-client/qvm-scalars.ts";
import type { QvmApplicationScalarOptions } from "./q3-client/qvm-scalars.ts";
import type { Q3ClientState } from "../../compat/qvm/client-state.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import type { ClientCommandRegistration } from "../../input/client-commands.ts";
import type { Q3PresentationSession } from "../../content/q3/presentation/client.ts";
import type { SnapshotSource } from "../../content/q3/presentation/snapshots.ts";
import type { CommandSource } from "../../content/q3/presentation/prediction.ts";
import type { Snapshot } from "../../network/q3/server-message.ts";
import { MoveType, PersistentIndex, Team } from "../../content/q3/base/shared/definitions.ts";
import { weaponViewCamera } from "./weapon-view.ts";
import type { WeaponHudReader } from "../../content/q3/presentation/player-state.ts";
import type { ActorCommand } from "../../contracts/session.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { CommandContext } from "../../contracts/common.ts";
import type { Rect, RenderCommand, RenderFrame, SceneCamera } from "../../contracts/render.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import { freemem } from "node:os";
import { anglesToAxis } from "../../core/math.ts";
import type { SharedSceneQueries } from "../../world/collision/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import type { Q3BrowserView } from "../../network/q3/browser-view.ts";
import type { CvarSnapshot } from "../../core/cvars/index.ts";
import { createQ3ClientPresentation } from "../../content/q3/presentation/client.ts";
import { cvarTable } from "../../content/q3/presentation/config.ts";
import type { Q3ClientPresentation, Q3ClientPresentationOptions } from "../../content/q3/presentation/client.ts";
import type { Q3PresentedScene } from "../../content/q3/presentation/scene.ts";
import type { PresentationMovementHost } from "../../content/q3/presentation/movement-host.ts";
import type { UserCommand } from "../../content/q3/base/shared/player-state.ts";
import { RDF_NOWORLDMODEL } from "../../content/q3/presentation/refdef.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { prepareMaterialText } from "../../render/commands/material2d.ts";
import { ModelLightSampler } from "../../render/scene/models/light-sampler.ts";
import { lightForPoint } from "../../materials/q3-lighting.ts";
import { createSourceSceneOrder, reserveSourceEntityRange, finishSceneOperations, type SourceSceneOrder } from "../../render/scene/submissions.ts";
import { visibleWorld } from "../../render/scene/visibility.ts";
import { portalCamera, portalSurfaceOffscreen } from "../../render/scene/portal.ts";
import { perspectiveProjection } from "../../render/scene/view.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import type { LocalInput } from "./input.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { ApplicationEffectFrame } from "./effects.ts";
import { q3Hardware } from "../../render/q3-hardware.ts";
import type { Q3SeatAudioOperation } from "./audio/q3.ts";
import type { Q3SourcePresentationState } from "./simulation/q3/presentation.ts";
import type { SimulationPresentation, SimulationPresentationEvent } from "./simulation/types.ts";
import { ApplicationQ3Source } from "./q3-client/source.ts";
import { ApplicationQ3Assets } from "./q3-client/assets.ts";
import { ApplicationQ3SceneRenderer } from "./q3-client/scene.ts";
import { createApplicationQ3Services } from "./q3-client/services.ts";
import type { ApplicationQ3Services } from "./q3-client/services.ts";
import { ApplicationQ3Cinematics, type SystemCinematicHost } from "./q3-client/cinematics.ts";
import { frameTimeCvarNames, refreshFrameTimeCvars } from "./frame-time.ts";
import { selectApplicationQ3Snapshot } from "./q3-client/visibility.ts";
import { q3WeaponCamera } from "./q3-client/view.ts";
import type { Q3EquipmentPresentation } from "./q3-client/equipment.ts";

export interface ApplicationQ3ClientSource extends SnapshotSource {
  readonly sourceMode: 'live' | 'demo';
  readonly commands: CommandSource;
  readonly clientNumber: number;
  readonly time: number;
  readonly serverMessageSequence?: number;
  readonly lastExecutedServerCommand?: number;
  getGameState(): readonly string[];
  systemInfo?(): string;
  getServerCommand(sequence: number): readonly string[] | null | Promise<readonly string[] | null>;
  actorAt(number: number): ActorId;
  snapshotPing?(number: number): number | null;
}
interface ApplicationQ3ClientCommonOptions {
  readonly systemCinematics?: SystemCinematicHost;
  remapShader?(original: string, replacement: string, offset: string, initializing: boolean, current: () => boolean): Promise<void>;
  saveFontData(): boolean;
  readonly cvars?: CvarRegistry;
  readonly timeCvars?: CvarRegistry;
  readonly weaponHud?: WeaponHudReader;
  assertCurrent?(): void;
  readonly assets: ApplicationAssets;
  readonly renderer: QvmApplicationScalarOptions["renderer"];
  readonly queries: SceneQueries & Pick<SharedSceneQueries, "pointLeaf" | "leafCluster" | "leafArea" | "areaBits">;
  readonly local: LocalInput; readonly audio: ApplicationAudio;
  readonly settings?: readonly CvarSnapshot[];
  readonly splitScreen?: boolean;
  serverSettings?(): readonly CvarSnapshot[];
  viewport(): Rect;
  now(): number;
  readonly commands: { reliable(text: string): void; console(text: string): void; print(text: string): void };
  readonly commandRegistration: ClientCommandRegistration;
  readonly hooks?: Pick<Q3ClientPresentationOptions, "character" | "event" | "predictItem" | "viewWeapon" | "playerWeapon">;
}
export type ApplicationQ3ClientOptions = ApplicationQ3ClientCommonOptions & (
  { readonly kind?: "local"; readonly movement: PresentationMovementHost; readonly initial: Q3SourcePresentationState;
    linkBounds(number: number): Bounds | null; sourceActor(number: number): ActorId | null;
    predictionCommand?(command: ActorCommand, sourceTimeMilliseconds: number): UserCommand; }
  | { readonly kind: "remote"; readonly movement: PresentationMovementHost; readonly source: ApplicationQ3ClientSource; readonly initialPlayer: Snapshot["playerState"] }
  | { readonly kind: "qvm"; readonly localServer?: boolean; readonly source: ApplicationQ3ClientSource; readonly connection: Q3ClientState;
      readonly equipmentWeapon?: () => Q3EquipmentPresentation | null;
      readonly browser: Q3BrowserView;
      readonly keys: ApplicationKeyProfile;
      readonly guestCvars: QvmCvarServices;
      readonly guestInput: QvmApplicationScalarOptions["input"];
      readonly queries: SharedSceneQueries; readonly commandBuffer: Pick<CommandBuffer, 'executeNow' | 'insert' | 'append'>;
      readonly clientState: QvmApplicationScalarOptions["clientState"] }
);
export type QvmVideoReopenOptions = Pick<Extract<ApplicationQ3ClientOptions, { readonly kind: "qvm" }>,
  "renderer" | "viewport" | "commandRegistration">;

export interface ApplicationQ3LocalRound {
  readonly actor: ActorId;
  readonly initial: Q3SourcePresentationState;
  readonly movement: PresentationMovementHost;
  linkBounds(number: number): Bounds | null;
  sourceActor(number: number): ActorId | null;
  predictionCommand?(command: ActorCommand, sourceTimeMilliseconds: number): UserCommand;
  serverSettings?(): readonly CvarSnapshot[];
}

type Submission = { readonly kind: "scene"; readonly scene: Q3PresentedScene }
  | { readonly kind: "text"; readonly draw: MaterialTextDraw }
  | { readonly kind: "command"; readonly command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }> };

/** A seat owns cgame state; source authority, resource mounts and audio output remain shared. */
export class ApplicationQ3Client {
  readonly source: ApplicationQ3ClientSource;
  private round: ApplicationQ3LocalRound | null;
  private readonly localSource: ApplicationQ3Source | null;
  private readonly product: Q3SourcePresentationState["product"];
  private supplementalViewWeapon = false;
  private viewWeaponVisible = true;
  private readonly selectedHeldActors = new Map<number, ActorId>();
  private weaponSelection: number | null = null;
  private cvarOwner: CvarRegistry;
  get cvars(): CvarRegistry { return this.cvarOwner; }
  get timeCvars(): CvarRegistry | undefined { return this.options.timeCvars; }
  adoptCvars(cvars: CvarRegistry): void {
    if (cvars.dialect !== this.cvars.dialect || cvars.context.session !== this.cvars.context.session) throw new Error("Q3 client cvar owner changed identity");
    this.cvarOwner = cvars;
    this.bindFrameTime();
  }
  readonly commandNames = new Set<string>();
  private backend: { readonly kind: "typescript"; readonly game: Q3ClientPresentation } | { readonly kind: "qvm"; readonly game: ApplicationQvmClient } | null = null;
  private readonly submissions: Submission[] = [];
  private readonly audioOperations: Q3SeatAudioOperation[] = [];
  private readonly sceneRenderer: ApplicationQ3SceneRenderer;
  private readonly frames: SceneFrameBuilder;
  private readonly viewportValue: { x: number; y: number; width: number; height: number };
  private readonly lightSampler: ModelLightSampler;
  private latestCamera: SceneCamera;
  private frameNumber = 0;
  private closed = false;
  private initializing = true;
  private timeMirror: SharedCvarMirror | null = null;
  private appliedTimeSystemInfo: string | undefined;
  private keyCatcher = 0;
  private selection = { weapon: 2, sensitivity: 1 };
  private cinematics: ApplicationQ3Cinematics | null = null;
  private eventCount = 0;
  private services: ApplicationQ3Services | null = null;
  private readonly sharedCvarNames: ReadonlySet<string>;
  private readonly bodyPoses = new Map<ActorId, { readonly origin: Vec3; readonly angles: Vec3 }>();
  private readonly poseActors = new Map<number, ActorId>();
  private readonly hiddenBodies = new Map<number, ActorId>();
  private readonly selectedBodies = new Map<number, ActorId>();
  private readonly primaryBodies: PreparedPrimaryBody[] = [];
  get sharedBodies(): readonly PreparedPrimaryBody[] { return this.primaryBodies; }
  private constructor(readonly options: ApplicationQ3ClientOptions, readonly media: ApplicationQ3Assets, private readonly artifacts?: QvmPresentationArtifacts) {
    this.round = options.kind === "remote" || options.kind === "qvm" ? null : { ...options, actor: options.local.player.actor };
    this.product = (options.kind === "remote" || options.kind === "qvm") ? "baseq3" : options.initial.product;
    this.localSource = (options.kind === "remote" || options.kind === "qvm") ? null : new ApplicationQ3Source(options.local.player.actor, options.initial,
      (player, source) => selectApplicationQ3Snapshot(player, source, options.queries, number => this.localRound().linkBounds(number), options.assets.world.map.leaves.length, options.commands.print),
      number => this.localRound().sourceActor(number), (command, time) => {
        const prediction = this.localRound().predictionCommand;
        if (prediction !== undefined) return prediction(command, time);
        const input = command.command;
        if (input.kind !== "q3") throw new Error("Foreign movement requires prediction command binding");
        return { serverTime: input.serverTimeMilliseconds, angles: { x: input.angleWords[0], y: input.angleWords[1], z: input.angleWords[2] },
          buttons: input.buttons, weapon: input.weapon, forwardmove: input.forwardMove, rightmove: input.rightMove, upmove: input.upMove };
      }, () => {
        options.local.console.close();
        options.commands.console("wait; wait; wait; wait; screenshot levelshot\n");
      });
    const source = (options.kind === "remote" || options.kind === "qvm") ? options.source : this.localSource;
    if (source === null) throw new Error("Local Q3 client has no snapshot source");
    this.source = source;
    this.viewportValue = { ...options.viewport() };
    const player = options.kind === "qvm" ? null : options.kind === "remote" ? options.initialPlayer : options.initial.clients.find(client => client.actor.equals(options.local.player.actor))?.state;
    if (player === undefined) throw new Error("Q3 cgame seat lacks a source player");
    this.latestCamera = { origin: player === null ? { x: 0, y: 0, z: 0 } : { ...player.origin, z: player.origin.z + player.viewheight },
      axis: anglesToAxis(player?.viewangles ?? { x: 0, y: 0, z: 0 }), viewport: this.viewportValue,
      projection: perspectiveProjection(90, 73.739795, 16384), clip: { kind: "none" } };
    this.cvarOwner = options.cvars ?? new CvarRegistry({ dialect: "q3", context: this.commandContext(), print: options.commands.print,
      cheatsAllowed: () => {
        const source = this.serverSettings().find(setting => setting.name.toLowerCase() === "sv_cheats");
        return source === undefined ? this.source.systemInfo === undefined ? undefined : infoValueForKey(this.source.systemInfo(), "sv_cheats") === "1" : source.integerValue !== 0;
      } });
    for (const setting of options.settings ?? []) this.cvars.set(setting.name, setting.value, true);
    this.sharedCvarNames = new Set(cvarTable(this.product).map(definition => definition.name.toLowerCase()));
    for (const setting of options.serverSettings?.() ?? []) if (this.sharedCvarNames.has(setting.name.toLowerCase())) this.cvars.set(setting.name, setting.value, true);
    this.refreshSystemInfo();
    this.cvars.set("sv_running", options.kind === "remote" || options.kind === "qvm" && options.localServer !== true ? "0" : "1", true);
    this.frames = new SceneFrameBuilder(options.assets.images); this.lightSampler = new ModelLightSampler(options.assets.world);
    this.sceneRenderer = new ApplicationQ3SceneRenderer(media, { picture: shader => this.requireServices().resources.picture(shader) });
  }
  private localRound(): ApplicationQ3LocalRound {
    if (this.round === null) throw new Error("Q3 client has no native local round");
    return this.round;
  }
  private serverSettings(): readonly CvarSnapshot[] {
    return this.round === null ? this.options.serverSettings?.() ?? [] : this.round.serverSettings?.() ?? [];
  }
  assertCanRestartRound(): void {
    this.options.assertCurrent?.();
    if (this.closed || this.localSource === null || this.round === null || this.backend?.kind !== "typescript")
      throw new Error("Q3 fast restart requires an active native local cgame");
    this.localSource.assertCanRestartRound();
  }
  beginRoundRestart(bit: 0 | 4, source: Q3SourcePresentationState): void {
    this.assertCanRestartRound();
    if (this.localSource === null) throw new Error("Missing native local source");
    this.localSource.beginRoundRestart(bit, source);
    this.submissions.length = 0; this.audioOperations.length = 0;
  }
  rebindRound(binding: ApplicationQ3LocalRound): void {
    this.options.assertCurrent?.();
    if (this.closed || this.localSource === null || this.round === null || this.backend?.kind !== "typescript")
      throw new Error("Q3 fast restart requires an active native local cgame");
    this.localSource.validateRoundActor(binding.actor, binding.initial);
    if (binding.movement.commandTiming !== this.round.movement.commandTiming) throw new Error("Q3 restart changed movement timing");
    this.round = binding;
    this.localSource.rebindRound(binding.actor, binding.initial);
    this.bodyPoses.clear(); this.poseActors.clear(); this.weaponSelection = null;
  }
  refreshSystemInfo(): void {
    if (this.closed) throw new Error("Q3 presentation is closed");
    this.options.assertCurrent?.();
    const info = this.source.systemInfo?.();
    if (info !== undefined) {
      const fields = info.split("\\");
      for (let index = fields[0] === "" ? 1 : 0; index + 1 < fields.length; index += 2) {
        const name = fields[index], value = fields[index + 1];
        if (name !== undefined && this.options.timeCvars !== undefined && frameTimeCvarNames(this.options.timeCvars.dialect).includes(name.toLowerCase())) continue;
        if (name?.toLowerCase() === "timescale" && info === this.appliedTimeSystemInfo) continue;
        if (name !== undefined && name.length > 0 && value !== undefined && name.toLowerCase() !== "cl_allowdownload") this.cvars.set(name, value, true);
      }
      this.appliedTimeSystemInfo = info;
    }
    if (this.timeMirror !== null) this.timeMirror.refresh();
    else if (this.options.timeCvars !== undefined) refreshFrameTimeCvars(this.options.timeCvars, this.cvars);
  }
  static async create(options: ApplicationQ3ClientOptions, artifacts?: QvmPresentationArtifacts): Promise<ApplicationQ3Client> {
    options.assertCurrent?.();
    const media = await ApplicationQ3Assets.create(options.assets, options.assets.content.recipe.engineBehavior.content, options.commands.print, options.saveFontData, options.kind === "qvm" ? "guest-async" : "source-sync");
    const client = new ApplicationQ3Client(options, media, artifacts);
    try { options.assertCurrent?.(); await client.initialize(); options.assertCurrent?.(); client.initializing = false; client.bindFrameTime(); return client; } catch (error) { client.close(); throw error; }
  }
  captureVideoReopen(): (overrides: QvmVideoReopenOptions) => Promise<ApplicationQ3Client> {
    const options = this.options, backend = this.requireBackend();
    if (options.kind !== "qvm" || backend.kind !== "qvm") throw new Error("Video guest reopen requires QVM presentation");
    const artifacts = backend.game.presentationArtifacts(), cvars = this.cvars, timeCvars = this.timeCvars;
    const { settings: _settings, serverSettings: _serverSettings, timeCvars: _timeCvars, ...retained } = options;
    let opened = false;
    return async overrides => {
      if (!this.closed) throw new Error("Previous guest presentation must shut down before reopening");
      if (opened) throw new Error("Video guest reopen was already attempted");
      opened = true;
      return ApplicationQ3Client.create({ ...retained, ...overrides, cvars,
        ...(timeCvars === undefined ? {} : { timeCvars }) }, artifacts);
    };
  }
  private bindFrameTime(): void {
    this.timeMirror?.close(); this.timeMirror = null;
    const owner = this.options.timeCvars;
    if (owner === undefined || owner === this.cvars) return;
    this.refreshSystemInfo();
    this.timeMirror = new SharedCvarMirror(owner, this.cvars, [...frameTimeCvarNames(owner.dialect), ...collisionMapCvarDefinitions.map(definition => definition.name)].filter(name => owner.find(name) !== undefined), () => {
      if (this.closed) throw new Error("Q3 presentation is closed");
      this.options.assertCurrent?.();
    });
  }
  private commandContext(): CommandContext { const player = this.options.local.player; return { session: player.actor.session,
    origin: { kind: "local-seat", seat: player.seat.id, client: player.seat.client.id } }; }
  private requireServices(): ApplicationQ3Services { if (this.closed || this.services === null) throw new Error("Q3 presentation services are closed or uninitialized"); return this.services; }
  resourceDiagnostics() {
    const resources = this.requireServices().resources;
    return { models: resources.registeredModels(), skins: resources.registeredSkins() };
  }
  private requireBackend() { if (this.closed || this.backend === null) throw new Error("Q3 cgame seat is closed or uninitialized"); return this.backend; }
  private statusVisible = true;
  private requireGame(): Q3ClientPresentation { const backend = this.requireBackend(); if (backend.kind !== "typescript") throw new Error("This seat runs native guest cgame"); return backend.game; }
  private async initialize(): Promise<void> {
    const o = this.options, seat = o.local.player.seat.id, source = this.source, media = this.media;
    const remapShader = o.remapShader;
    const collisionSettings = new CollisionMapSettings({
      register: (...args) => (o.timeCvars ?? this.cvars).register(...args),
      get: name => (o.timeCvars ?? this.cvars).get(name),
    });
    collisionSettings.registerMap();
    const services = await createApplicationQ3Services({ collisionSettings, media, audio: o.audio, seat, viewport: this.viewportValue, queries: o.queries,
      ...(remapShader === undefined ? {} : { remapShader: async (original: string, replacement: string, offset: string) => {
        o.assertCurrent?.();
        await remapShader(original, replacement, offset, this.initializing, () => !this.closed);
        o.assertCurrent?.();
      } }),
      ...(o.systemCinematics === undefined ? {} : { systemCinematics: o.systemCinematics }),
      actorAt: number => source.actorAt(number), clock: { now: o.now, frameNumber: () => this.frameNumber }, output: {
        scene: scene => { this.submissions.push({ kind: "scene", scene }); if ((scene.source.renderFlags & RDF_NOWORLDMODEL) === 0) this.latestCamera = scene.camera; },
        command: command => { this.submissions.push({ kind: "command", command }); }, text: draw => { this.submissions.push({ kind: "text", draw }); },
        audio: operation => { this.audioOperations.push(operation); }, listener: (origin, axis) => { this.latestCamera = { ...this.latestCamera, origin, axis }; },
      } });
    this.services = services;
    const { scene: recorder, resources, sound, draw, cinematics } = services;
    this.cinematics = cinematics;
    const cvarClient = this;
    const session: Q3PresentationSession = { product: this.product, clientNumber: source.clientNumber, serverMessageSequence: source.serverMessageSequence ?? 0, lastExecutedServerCommand: source.lastExecutedServerCommand ?? 0,
        mode: { kind: "live" }, commands: source.commands, snapshots: source, get cvars() { return cvarClient.cvars; }, statusVisible: () => this.statusVisible,
        getGameState: () => source.getGameState(), getServerCommand: sequence => source.getServerCommand(sequence), snapshotPing: number => source.snapshotPing?.(number) ?? 0,
        addReliableCommand: o.commands.reliable, appendConsoleCommand: o.commands.console, registerCgameCommand: name => { this.commandNames.add(name); o.commandRegistration.register(name); },
        setUserCommandValue: (weapon, sensitivity) => { this.selection = { weapon, sensitivity }; },
        assertCurrent: () => { o.assertCurrent?.(); if (this.closed) throw new Error("Q3 cgame belongs to a retired world"); }, print: o.commands.print };
    if (o.kind === "qvm") {
      const scalar = new QvmApplicationScalars({ renderer: o.renderer, viewport: o.viewport, local: o.local, input: o.guestInput, media, services, now: o.now,
        keyCatcher: { get: () => this.keyCatcher, set: value => { this.keyCatcher = value; } }, clientState: o.clientState,
        lightForPoint: point => this.light(point), assertCurrent: session.assertCurrent });
      const game = await ApplicationQvmClient.create({ ...(this.artifacts === undefined ? {} : { artifacts: this.artifacts }), seat, commandContext: this.commandContext(), services, media, session, connection: o.connection, queries: o.queries,
        ...(o.equipmentWeapon === undefined ? {} : { equipmentWeapon: o.equipmentWeapon }), viewWeaponVisible: () => this.viewWeaponVisible,
        heldWeaponActor: number => { const actor = source.actorAt(number); return !this.bodyHidden(number) && this.selectedHeldActors.get(actor.slot)?.equals(actor) ? actor : null; },
        bodyCapture: { active: () => this.selectedBodies.size !== 0, selected: number => this.bodySelected(number),
          submit: (number, part, source, base) => this.submitBody(number, part, source, base) },
        bodyOverrides: { active: () => this.hiddenBodies.size !== 0, hidden: number => this.bodyHidden(number) },
        commands: o.commandBuffer, cvars: o.guestCvars, browser: o.browser, keys: o.keys, map: o.assets.content.recipe.map.geometry.requestedPath, now: o.now, keyCatcher: () => this.keyCatcher,
        removeCommand: name => { this.commandNames.delete(name); o.commandRegistration.remove(name); },
        scalar: (call, owner) => scalar.dispatch(call, () => owner.updateScreen(call)) });
      this.backend = { kind: "qvm", game };
      this.submissions.length = 0;
      return;
    }
    const client = this;
    const movement: PresentationMovementHost = this.round === null ? o.movement : {
      get commandTiming() { return client.localRound().movement.commandTiming; },
      movePlayer: (state, command, options) => this.localRound().movement.movePlayer(state, command, options),
      updateViewAngles: (state, command) => this.localRound().movement.updateViewAngles(state, command),
    };
    const game = await createQ3ClientPresentation({ ...(o.weaponHud === undefined ? {} : { weaponHud: o.weaponHud }), assets: media, resources, scene: recorder, sound, draw, fontRegistry: media.fontRegistry,
      world: o.assets.world, collision: services.collision, movement, target: this.viewportValue,
      get hardware() { return q3Hardware(o.renderer.driver?.renderer ?? "") === "ragepro" ? "ragepro" : "generic"; }, commandContext: this.commandContext(),
      session,
      clock: { milliseconds: o.now, serverTime: () => source.time, frameNumber: () => this.frameNumber },
      menus: this.product === "baseq3" ? { kind: "baseq3" } : { kind: "missionpack", cinematics,
        setKeyCatcher: mask => { this.keyCatcher = mask; }, audio: { playLocal: pcm => {
          sound.startLocalSound(typeof pcm === "number" ? media.bank.soundAtIndex(pcm) : pcm ?? null, 6);
        }, startBackground: path => sound.startBackgroundTrack(path ?? "", path ?? ""), stopBackground: () => { void sound.startBackgroundTrack("", ""); } } },
      memoryRemaining: () => Math.min(0x7fffffff, freemem()), updateLoadingScreen: paint => paint(),
      lightForPoint: point => this.light(point),
      bodyHidden: number => this.bodyHidden(number),
      bodySubmission: (number, part, source, base) => this.submitBody(number, part, source, base),
      weaponSelection: weapon => { this.weaponSelection = weapon; },
      bodyPose: entity => {
        if (this.poseActors.size === 0) return;
        const actor = this.source.actorAt(entity.currentState.number);
        if (this.poseActors.get(actor.slot)?.equals(actor)) this.bodyPoses.set(actor, { origin: entity.lerpOrigin, angles: entity.lerpAngles });
      },
      character: (entity, render) => {
        if (this.bodyHidden(entity.currentState.number)) render();
        else if (o.hooks !== undefined) o.hooks.character(entity, render);
        else if (o.assets.content.recipe.character.appearance.provider.startsWith("q3:")) render();
      },
      event: async (entity, position, render) => { this.eventCount++; if (o.hooks === undefined) await render(); else await o.hooks.event(entity, position, render); },
      predictItem: (entity, predict) => o.hooks === undefined ? predict() : o.hooks.predictItem(entity, predict),
      viewWeapon: (state, render) => {
        if (!this.viewWeaponVisible || this.supplementalViewWeapon) return;
        if (o.hooks !== undefined) o.hooks.viewWeapon(state, render);
        else if (o.assets.content.recipe.weapons.some(weapon => weapon.provider.startsWith("q3:"))) render();
      },
      playerWeapon: (parent, state, entity, team, render) => {
        if (o.hooks !== undefined) o.hooks.playerWeapon(parent, state, entity, team, render);
        else if (o.assets.content.recipe.weapons.some(weapon => weapon.provider.startsWith("q3:"))) render();
      },
    });
    this.backend = { kind: "typescript", game };
    this.submissions.length = 0;
  }
  get cgame(): Q3ClientPresentation { return this.requireGame(); }
  consumeWeaponSelection(): number | null {
    const selected = this.weaponSelection; this.weaponSelection = null; return selected;
  }
  get userCommandSelection(): { readonly weapon: number; readonly sensitivity: number } {
    const equipment = this.options.kind === "qvm" ? this.options.equipmentWeapon?.() ?? null : null;
    return equipment === null ? this.selection : { ...this.selection, weapon: equipment.primaryWeapon };
  }
  get presentedEvents(): number { return this.eventCount; }
  get sharedHeldWeapons(): readonly import("./q3-client/qvm.ts").QvmHeldWeapon[] { const backend = this.requireBackend(); return backend.kind === "qvm" ? backend.game.sharedHeldWeapons : []; }
  get sharedEquipmentViewVisible(): boolean | null {
    const backend = this.requireBackend();
    return backend.kind === "qvm" ? backend.game.sharedEquipmentViewVisible : null;
  }
  weaponHudView(): { readonly visible: boolean; readonly aggregateWarning: boolean } {
    const backend = this.requireBackend();
    if (backend.kind === "qvm") return { visible: backend.game.sharedEquipmentHud, aggregateWarning: false };
    const state = this.requireGame().state, ps = state.snap?.playerState;
    return { visible: ps !== undefined && !state.levelShot && !state.showScores && ps.health > 0
      && ps.pmType !== MoveType.PM_INTERMISSION && ps.persistant.get(PersistentIndex.PERS_TEAM) !== Team.TEAM_SPECTATOR
      && (this.cvars.get("cg_draw2D")?.integerValue ?? 1) !== 0 && (this.cvars.get("cg_drawStatus")?.integerValue ?? 1) !== 0,
      aggregateWarning: (this.cvars.get("cg_drawAmmoWarning")?.integerValue ?? 1) !== 0 };
  }
  camera(): SceneCamera { return this.latestCamera; }
  bodyPose(actor: ActorId): { readonly origin: Vec3; readonly angles: Vec3 } | null { return this.bodyPoses.get(actor) ?? null; }
  supplementalWeaponCamera(camera: SceneCamera): SceneCamera {
    return this.requireBackend().kind === "qvm" ? camera : weaponViewCamera(q3WeaponCamera(camera, this.options.splitScreen === true),
      this.submissions.flatMap(submission => submission.kind === "scene" && (submission.scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0 ? [submission.scene.viewport] : []));
  }
  private bodyHidden(number: number): boolean {
    if (this.hiddenBodies.size === 0) return false;
    const actor = this.source.actorAt(number);
    return this.hiddenBodies.get(actor.slot)?.equals(actor) ?? false;
  }
  private bodySelected(number: number): boolean {
    if (this.selectedBodies.size === 0 || this.bodyHidden(number)) return false;
    const actor = this.source.actorAt(number);
    return this.selectedBodies.get(actor.slot)?.equals(actor) === true;
  }
  private submitBody(number: number, part: QvmBodyPart, source: RefModelEntity, base: boolean): boolean {
    if (!this.bodySelected(number)) return false;
    const ref = copyRefEntity(source);
    if (ref.kind !== "model") throw new Error("Source body changed reference kind");
    const actor = this.source.actorAt(number), prepared = prepareQ3Model(ref, actor);
    if (prepared === null) return false;
    const content = this.media.modelContents.get(source.model);
    if (content === undefined) throw new Error("Source body lost its registered geometry owner");
    this.primaryBodies.push({ actor, part, content, entity: prepared.entity, base,
      options: { ...prepared.options, shaderTexCoord: ref.shaderTexCoord }, shaderContent: this.media.content, time: this.source.time });
    return true;
  }
  receiveEvents(events: readonly SimulationPresentationEvent[]): void {
    this.options.assertCurrent?.(); this.requireGame();
    if (this.localSource === null) throw new Error("Remote Q3 cgame receives events through its network connection");
    this.localSource.receiveEvents(events);
  }
  receive(state: Q3SourcePresentationState, events: readonly SimulationPresentationEvent[], commands: readonly ActorCommand[]): void { this.requireGame(); if (this.localSource === null) throw new Error("Remote Q3 cgame receives snapshots through its network connection"); this.localSource.receive(state, events, commands); }
  async prepare(frameNumber: number, viewport = this.options.viewport(), presentations: readonly SimulationPresentation[] = [], statusVisible = true, bodies: readonly ComponentBody[] = [], viewWeaponVisible = true, cameraControlled = false): Promise<void> {
    this.viewWeaponVisible = viewWeaponVisible;
    this.hiddenBodies.clear();
    if (cameraControlled) { const actor = this.options.local.player.actor; this.hiddenBodies.set(actor.slot, actor); }
    this.selectedBodies.clear(); this.primaryBodies.length = 0;
    for (const body of bodies) this.selectedBodies.set(body.actor.slot, body.actor);
    this.selectedHeldActors.clear();
    this.bodyPoses.clear();
    this.poseActors.clear();
    for (const model of presentations) {
      if (model.renderOwner !== "source-client" && model.viewWeapon && (model.path !== "" || model.heldWeapon !== undefined)) this.selectedHeldActors.set(model.actor.slot, model.actor);
      if (model.replacesBody) this.hiddenBodies.set(model.actor.slot, model.actor);
      if (model.renderOwner !== "source-client" && model.visible && !model.viewWeapon) this.poseActors.set(model.actor.slot, model.actor);
    }
    this.refreshSystemInfo();
    const backend = this.requireBackend(); this.frameNumber = frameNumber; Object.assign(this.viewportValue, viewport); this.submissions.length = 0;
    this.supplementalViewWeapon = presentations.some(source => source.renderOwner !== "source-client" && source.visible && source.viewWeapon && source.actor.equals(this.options.local.player.actor));
    for (const setting of this.serverSettings()) {
      if (this.sharedCvarNames.has(setting.name.toLowerCase())) this.cvars.set(setting.name, setting.value, true);
    }
    const previousStatus = this.statusVisible; this.statusVisible = statusVisible;
    let failure: { readonly error: unknown } | null = null;
    try {
      if (backend.kind === "typescript") {
        await backend.game.frames.drawActiveFrame({ serverTime: this.source.time, stereo: "center", demoPlayback: this.source.sourceMode === 'demo', engineFrameNumber: frameNumber });
      } else await backend.game.draw(this.source.time, this.source.sourceMode === 'demo');
    } catch (error) { failure = { error }; throw error; }
    finally {
      this.statusVisible = previousStatus;
      if (backend.kind === "qvm") try { backend.game.refreshStatus(); }
      catch (error) { if (failure !== null) throw new AggregateError([failure.error, error], "Cgame frame and status restoration failed"); throw error; }
    }
    await this.sceneRenderer.preload(this.submissions.flatMap(submission => submission.kind === "scene" ? [submission.scene] : []));
    this.options.audio.receiveCgameFrame({ content: this.media.content, seat: this.options.local.player.seat.id, operations: this.audioOperations.splice(0) });
  }
  command(argv: readonly string[]): Promise<boolean> { const backend = this.requireBackend(); return backend.kind === "typescript" ? backend.game.console.execute(argv) : backend.game.command(argv); }
  handlesCommand(name: string): boolean { const backend = this.requireBackend(); return backend.kind === "typescript" ? backend.game.console.handles(name) : this.commandNames.has(name); }
  keyEvent(key: number, down: boolean): Promise<void> { return this.requireBackend().game.keyEvent(key, down); }
  mouseEvent(x: number, y: number): Promise<void> { return this.requireBackend().game.mouseEvent(x, y); }
  eventHandling(type: number): Promise<void> { if (!Number.isInteger(type) || type < 0 || type > 3) throw new RangeError("Invalid Q3 event handling mode"); const backend = this.requireBackend(); return backend.kind === "typescript" ? backend.game.eventHandling(type) : backend.game.eventHandling(type === 0 ? "none" : type === 1 ? "team-menu" : type === 2 ? "scoreboard" : "edit-hud"); }
  async input(event: SeatInputEvent): Promise<void> {
    this.requireBackend();
    if (!event.seat.equals(this.options.local.player.seat.id)) throw new Error("Q3 input belongs to another seat");
      switch (event.kind) {
        case "key": await this.keyEvent(event.code, event.down); break;
        case "text": for (const character of event.text) { const code = character.codePointAt(0); if (code !== undefined) await this.keyEvent(code | KEY_CHAR_FLAG, true); } break;
        case "mouse-button": await this.keyEvent(KeyCode.Mouse1 + quakeMouseButton(event.button) - 1, event.down); break;
        case "mouse-motion": await this.mouseEvent(event.delta.x, event.delta.y); break;
        case "mouse-wheel": for (let count = 0; count < Math.abs(event.delta.y); count++) {
          const key = event.delta.y > 0 ? KeyCode.MouseWheelUp : KeyCode.MouseWheelDown;
          await this.keyEvent(key, true); await this.keyEvent(key, false);
        } break;
        case "controller-button": if (event.button >= 0 && event.button < 32) await this.keyEvent(KeyCode.Joy1 + event.button, event.down); break;
        case "controller-axis": case "focus": break;
      }
  }
  get capturesInput(): boolean { return this.backend?.kind === "qvm" ? this.backend.game.capturesInput : this.keyCatcher !== 0; }
  private light(point: Vec3) {
    const source = lightForPoint(this.lightSampler.grid, point, { ambientScale: 1, directedScale: 1 }); if (source !== null) return source;
    const sample = this.lightSampler.sample(point, { camera: this.latestCamera, time: { kind: "milliseconds", value: this.source.time }, target: { kind: "seat", seat: this.options.local.player.seat.id } });
    return { ambientLight: { x: sample.color.x * 255, y: sample.color.y * 255, z: sample.color.z * 255 }, directedLight: { x: 0, y: 0, z: 0 }, lightDir: { x: 0, y: 0, z: 1 } };
  }
  private portal(scene: Q3PresentedScene, input: WorldViewInput): WorldViewInput | null {
    if (scene.portals.length === 0 || input.camera.clip.kind !== "none") return null;
    const world = this.options.assets.world, visible = visibleWorld(world.map, input.camera, input);
    for (const index of visible.surfaces) {
      const surface = world.surfaces[index];
      if (surface?.kind !== "q3" || surface.shader.finished.sort !== 1 || surface.plane === null) continue;
      const child = portalCamera(surface.plane, scene.portals.map(portal => portal.source), input.camera, this.source.time);
      if (child === null || portalSurfaceOffscreen(surface.geometry, input.camera, surface.shader.material.portalRange, child.mirror)) continue;
      return { ...input, camera: child.camera, pvsOrigin: child.pvsOrigin };
    }
    return null;
  }
  frame(additionalEffects?: (camera: SceneCamera, source: SourceSceneOrder) => ApplicationEffectFrame, transformCamera?: (camera: SceneCamera) => SceneCamera,
    environment: Pick<WorldViewInput, "q1Fog" | "sourceSky" | "noWorldModel"> = {}): RenderFrame {
    this.requireBackend(); this.frames.begin();
    const seat = this.options.local.player.seat.id, world = this.options.assets.world, time = { kind: "milliseconds", value: this.source.time } satisfies WorldViewInput["time"];
    for (const submission of this.submissions) {
      if (submission.kind === "command") { this.frames.command(submission.command); continue; }
      if (submission.kind === "text") {
        const input: WorldViewInput = { camera: this.latestCamera, time, target: { kind: "seat", seat } };
        this.frames.view({ target: input.target, time, viewport: this.viewportValue, clear: null, clipPlane: null, beforeView: [],
          operations: [{ kind: "draw", batches: prepareMaterialText(submission.draw, this.viewportValue, world.materialContext(input)) }] });
        continue;
      }
      const scene = submission.scene, camera = (scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0 ? scene.camera : transformCamera?.(scene.camera) ?? scene.camera;
      const input: WorldViewInput = { camera, time, target: { kind: "seat", seat },
        q3Lights: scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: light.additive })).slice(0, 32),
        renderText: scene.source.text, visibleAreas: new Set(Array.from({ length: scene.source.areaMask.length * 8 }, (_, area) => area)
          .filter(area => ((scene.source.areaMask[area >> 3] ?? 0) & (1 << (area & 7))) === 0)),
        clear: (scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0 ? { depth: 1, color: null, stencil: false } : { depth: 1, color: environment.noWorldModel === true ? { x: 0.3, y: 0.3, z: 0.3, w: 1 } : { x: 0, y: 0, z: 0, w: 1 }, stencil: false },
        };
      if ((scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0) {
        const source = createSourceSceneOrder(this.options.assets.materialRegistrations), selected = { ...input, source: createWorldSurfaceAdmission(source) };
        const firstEntity = reserveSourceEntityRange(source, scene.admission.entities.length);
        this.frames.view({ target: input.target, time, viewport: scene.viewport,
          clear: input.clear ?? null, clipPlane: null, beforeView: [], operations: finishSceneOperations(this.sceneRenderer.operations(scene, selected, firstEntity, { noWorldModel: true, splitScreen: this.options.splitScreen === true, supplementalViewWeapon: this.supplementalViewWeapon })) });
      } else {
        const publish = (view: WorldViewInput): void => {
          const source = createSourceSceneOrder(this.options.assets.materialRegistrations);
          const firstEntity = reserveSourceEntityRange(source, scene.admission.entities.length);
          const effects = additionalEffects?.(view.camera, source);
          const combined: WorldViewInput = { ...view, source: createWorldSurfaceAdmission(source), ...(effects === undefined ? {} : { lights: effects.lights,
            q3Lights: [...view.q3Lights ?? [], ...effects.q3Lights].slice(0, 32) }) };
          world.prepareWorldOperations(combined);
          this.frames.world(world.prepareView({ ...combined, operations: this.sceneRenderer.operations(scene, combined, firstEntity, { noWorldModel: view.noWorldModel === true, splitScreen: this.options.splitScreen === true, supplementalViewWeapon: this.supplementalViewWeapon }, effects?.operations) }));
        };
        const worldInput = { ...input, ...environment };
        const child = worldInput.noWorldModel === true ? null : this.portal(scene, worldInput);
        if (child !== null) publish(child);
        publish(worldInput);
      }
    }
    return this.frames.finish(false);
  }
  async shutdown(): Promise<void> { if (this.backend?.kind === "qvm") await this.backend.game.shutdown(); this.close(); }
  close(): void {
    if (this.closed) return;
    this.options.commandRegistration.close();
    this.timeMirror?.close(); this.timeMirror = null;
    this.backend?.game.close(); this.audioOperations.push({ kind: "clear-loops", killAll: true });
    this.options.audio.receiveCgameFrame({ content: this.media.content, seat: this.options.local.player.seat.id, operations: this.audioOperations.splice(0) });
    this.closed = true; this.cinematics?.close(); this.media.close(); this.bodyPoses.clear(); this.poseActors.clear(); this.selectedBodies.clear(); this.primaryBodies.length = 0; this.sceneRenderer.close(); this.submissions.length = 0;
  }
}
