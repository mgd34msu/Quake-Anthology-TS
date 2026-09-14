import { CommonError } from "../../core/common-error.ts";
import { q3ProceduralFog } from "../../content/q3/presentation/scene.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import { KEY_CHAR_FLAG, KeyCode } from "../../input/key-codes.ts";
import type { SeatInputEvent } from "../../contracts/ui.ts";
import { infoValueForKey } from "../../core/info-string.ts";
import { ApplicationQvmClient } from "./q3-client/qvm.ts";
import { QvmApplicationScalars } from "./q3-client/qvm-scalars.ts";
import type { QvmApplicationScalarOptions } from "./q3-client/qvm-scalars.ts";
import type { Q3ClientConnection } from "../../network/q3/client.ts";
import type { CommandBuffer } from "../../core/commands/index.ts";
import type { NativeRenderer } from "./renderer.ts";
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
import type { Rect, RenderCommand, RenderFrame, RenderState, SceneCamera } from "../../contracts/render.ts";
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
import type { Q3PresentedScene, PresentedModel } from "../../content/q3/presentation/scene.ts";
import type { PresentationMovementHost } from "../../content/q3/presentation/movement-host.ts";
import type { UserCommand } from "../../content/q3/base/shared/player-state.ts";
import { RDF_NOWORLDMODEL } from "../../content/q3/presentation/refdef.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { prepareMaterialText } from "../../render/commands/material2d.ts";
import { SceneModelRenderer } from "../../render/scene/models/renderer.ts";
import { ModelLightSampler } from "../../render/scene/models/light-sampler.ts";
import { lightForPoint } from "../../materials/q3-lighting.ts";
import { createSourceSceneOrder, reserveSourceEntityRange, sourceDrawGroup, finishSceneOperations, type SourceSceneOrder, type SceneOperation } from "../../render/scene/submissions.ts";
import { prepareMaterialBatches } from "../../materials/evaluate.ts";
import { DEFAULT_RAIL_SETTINGS, beamBatch, defaultModelBatch, polyGeometry, railGeometry, spriteGeometry } from "../../render/scene/particles/primitives.ts";
import { visibleWorld } from "../../render/scene/visibility.ts";
import { portalCamera, portalSurfaceOffscreen } from "../../render/scene/portal.ts";
import { createViewProjector, perspectiveProjection } from "../../render/scene/view.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import type { MaterialTextDraw } from "../../text/draw2d.ts";
import type { LocalInput } from "./input.ts";
import type { ApplicationAssets, ProviderSceneAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { ApplicationEffectFrame } from "./effects.ts";
import type { Q3SeatAudioOperation } from "./audio/q3.ts";
import type { Q3SourcePresentationState } from "./simulation/q3/presentation.ts";
import type { SimulationPresentation, SimulationPresentationEvent } from "./simulation/types.ts";
import { ApplicationQ3Source } from "./q3-client/source.ts";
import { ApplicationQ3Assets } from "./q3-client/assets.ts";
import { createApplicationQ3Services } from "./q3-client/services.ts";
import type { ApplicationQ3Services } from "./q3-client/services.ts";
import { ApplicationQ3Cinematics } from "./q3-client/cinematics.ts";
import { selectApplicationQ3Snapshot } from "./q3-client/visibility.ts";
import { ApplicationQ3ForeignModels } from "./q3-client/foreign.ts";
import { q3WeaponCamera } from "./q3-client/view.ts";

export interface ApplicationQ3ClientSource extends SnapshotSource {
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
  readonly cvars?: CvarRegistry;
  readonly weaponHud?: WeaponHudReader;
  assertCurrent?(): void;
  readonly assets: ApplicationAssets;
  readonly queries: SceneQueries & Pick<SharedSceneQueries, "pointLeaf" | "leafCluster" | "leafArea" | "areaBits">;
  readonly local: LocalInput; readonly audio: ApplicationAudio;
  readonly settings?: readonly CvarSnapshot[];
  readonly splitScreen?: boolean;
  serverSettings?(): readonly CvarSnapshot[];
  viewport(): Rect;
  now(): number;
  readonly commands: { reliable(text: string): void; console(text: string): void; print(text: string): void };
  readonly hooks?: Pick<Q3ClientPresentationOptions, "character" | "event" | "predictItem" | "viewWeapon" | "playerWeapon">;
}
export type ApplicationQ3ClientOptions = ApplicationQ3ClientCommonOptions & (
  { readonly kind?: "local"; readonly movement: PresentationMovementHost; readonly initial: Q3SourcePresentationState;
    linkBounds(number: number): Bounds | null; sourceActor(number: number): ActorId | null;
    predictionCommand?(command: ActorCommand, sourceTimeMilliseconds: number): UserCommand; }
  | { readonly kind: "remote"; readonly movement: PresentationMovementHost; readonly source: ApplicationQ3ClientSource; readonly initialPlayer: Snapshot["playerState"] }
  | { readonly kind: "qvm"; readonly source: ApplicationQ3ClientSource; readonly connection: Q3ClientConnection;
      readonly browser: Q3BrowserView;
      readonly queries: SharedSceneQueries; readonly commandBuffer: CommandBuffer; readonly renderer: NativeRenderer;
      readonly clientState: QvmApplicationScalarOptions["clientState"] }
);
type Submission = { readonly kind: "scene"; readonly scene: Q3PresentedScene }
  | { readonly kind: "text"; readonly draw: MaterialTextDraw }
  | { readonly kind: "command"; readonly command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }> };
const state: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true,
  alphaTest: "none", cull: "back", depthRange: [0, 1], polygonOffset: null };

/** A seat owns cgame state; source authority, resource mounts and audio output remain shared. */
export class ApplicationQ3Client {
  readonly source: ApplicationQ3ClientSource;
  private readonly localSource: ApplicationQ3Source | null;
  private readonly product: Q3SourcePresentationState["product"];
  readonly cvars: CvarRegistry;
  readonly commandNames = new Set<string>();
  private backend: { readonly kind: "typescript"; readonly game: Q3ClientPresentation } | { readonly kind: "qvm"; readonly game: ApplicationQvmClient } | null = null;
  private readonly submissions: Submission[] = [];
  private readonly audioOperations: Q3SeatAudioOperation[] = [];
  private readonly renderers = new Map<ProviderSceneAssets, SceneModelRenderer>();
  private readonly frames: SceneFrameBuilder;
  private readonly viewportValue: { x: number; y: number; width: number; height: number };
  private readonly lightSampler: ModelLightSampler;
  private latestCamera: SceneCamera;
  private frameNumber = 0;
  private closed = false;
  private keyCatcher = 0;
  private selection = { weapon: 2, sensitivity: 1 };
  private cinematics: ApplicationQ3Cinematics | null = null;
  private eventCount = 0;
  private services: ApplicationQ3Services | null = null;
  private readonly sharedCvarNames: ReadonlySet<string>;
  private readonly foreign: ApplicationQ3ForeignModels;
  private constructor(readonly options: ApplicationQ3ClientOptions, readonly media: ApplicationQ3Assets) {
    this.product = (options.kind === "remote" || options.kind === "qvm") ? "baseq3" : options.initial.product;
    this.localSource = (options.kind === "remote" || options.kind === "qvm") ? null : new ApplicationQ3Source(options.local.player.actor, options.initial,
      (player, source) => selectApplicationQ3Snapshot(player, source, options.queries, options.linkBounds, options.assets.world.map.leaves.length, options.commands.print),
      options.sourceActor, options.predictionCommand);
    const source = (options.kind === "remote" || options.kind === "qvm") ? options.source : this.localSource;
    if (source === null) throw new Error("Local Q3 client has no snapshot source");
    this.source = source;
    this.foreign = new ApplicationQ3ForeignModels(options.assets, options.local.player.actor, number => this.source.actorAt(number));
    this.viewportValue = { ...options.viewport() };
    const player = options.kind === "qvm" ? null : options.kind === "remote" ? options.initialPlayer : options.initial.clients.find(client => client.actor.equals(options.local.player.actor))?.state;
    if (player === undefined) throw new Error("Q3 cgame seat lacks a source player");
    this.latestCamera = { origin: player === null ? { x: 0, y: 0, z: 0 } : { ...player.origin, z: player.origin.z + player.viewheight },
      axis: anglesToAxis(player?.viewangles ?? { x: 0, y: 0, z: 0 }), viewport: this.viewportValue,
      projection: perspectiveProjection(90, 73.739795, 16384), clip: { kind: "none" } };
    this.cvars = options.cvars ?? new CvarRegistry({ dialect: "q3", context: this.commandContext(), print: options.commands.print,
      cheatsAllowed: () => {
        const source = options.serverSettings?.().find(setting => setting.name.toLowerCase() === "sv_cheats");
        return source === undefined ? this.source.systemInfo === undefined ? undefined : infoValueForKey(this.source.systemInfo(), "sv_cheats") === "1" : source.integerValue !== 0;
      } });
    for (const setting of options.settings ?? []) this.cvars.set(setting.name, setting.value, true);
    this.sharedCvarNames = new Set(cvarTable(this.product).map(definition => definition.name.toLowerCase()));
    for (const setting of options.serverSettings?.() ?? []) if (this.sharedCvarNames.has(setting.name.toLowerCase())) this.cvars.set(setting.name, setting.value, true);
    this.applySystemInfo();
    this.cvars.set("sv_running", (options.kind === "remote" || options.kind === "qvm") ? "0" : "1", true);
    this.frames = new SceneFrameBuilder(options.assets.images); this.lightSampler = new ModelLightSampler(options.assets.world);
  }
  private applySystemInfo(): void {
    const info = this.source.systemInfo?.(); if (info === undefined) return;
    const fields = info.split("\\");
    for (let index = fields[0] === "" ? 1 : 0; index + 1 < fields.length; index += 2) {
      const name = fields[index], value = fields[index + 1];
      if (name !== undefined && name.length > 0 && value !== undefined && name.toLowerCase() !== "cl_allowdownload") this.cvars.set(name, value, true);
    }
  }
  static async create(options: ApplicationQ3ClientOptions): Promise<ApplicationQ3Client> {
    options.assertCurrent?.();
    const media = await ApplicationQ3Assets.create(options.assets, options.assets.content.recipe.engineBehavior.content, options.commands.print, options.kind === "qvm" ? "guest-async" : "source-sync");
    const client = new ApplicationQ3Client(options, media);
    try { options.assertCurrent?.(); await client.initialize(); options.assertCurrent?.(); return client; } catch (error) { client.close(); throw error; }
  }
  private commandContext(): CommandContext { const player = this.options.local.player; return { session: player.actor.session,
    origin: { kind: "local-seat", seat: player.seat.id, client: player.seat.client.id } }; }
  private requireServices(): ApplicationQ3Services { if (this.closed || this.services === null) throw new Error("Q3 presentation services are closed or uninitialized"); return this.services; }
  private requireBackend() { if (this.closed || this.backend === null) throw new Error("Q3 cgame seat is closed or uninitialized"); return this.backend; }
  private requireGame(): Q3ClientPresentation { const backend = this.requireBackend(); if (backend.kind !== "typescript") throw new Error("This seat runs native guest cgame"); return backend.game; }
  private async initialize(): Promise<void> {
    const o = this.options, seat = o.local.player.seat.id, source = this.source, media = this.media;
    const services = await createApplicationQ3Services({ media, audio: o.audio, seat, viewport: this.viewportValue, queries: o.queries,
      actorAt: number => source.actorAt(number), clock: { now: o.now, frameNumber: () => this.frameNumber }, output: {
        scene: scene => { this.submissions.push({ kind: "scene", scene }); if ((scene.source.renderFlags & RDF_NOWORLDMODEL) === 0) this.latestCamera = scene.camera; },
        command: command => { this.submissions.push({ kind: "command", command }); }, text: draw => { this.submissions.push({ kind: "text", draw }); },
        audio: operation => { this.audioOperations.push(operation); }, listener: (origin, axis) => { this.latestCamera = { ...this.latestCamera, origin, axis }; },
      } });
    this.services = services;
    const { scene: recorder, resources, sound, draw, cinematics } = services;
    this.cinematics = cinematics;
    const session: Q3PresentationSession = { product: this.product, clientNumber: source.clientNumber, serverMessageSequence: source.serverMessageSequence ?? 0, lastExecutedServerCommand: source.lastExecutedServerCommand ?? 0,
        mode: { kind: "live" }, commands: source.commands, snapshots: source, cvars: this.cvars,
        getGameState: () => source.getGameState(), getServerCommand: sequence => source.getServerCommand(sequence), snapshotPing: number => source.snapshotPing?.(number) ?? 0,
        addReliableCommand: o.commands.reliable, appendConsoleCommand: o.commands.console, registerCgameCommand: name => { this.commandNames.add(name); },
        setUserCommandValue: (weapon, sensitivity) => { this.selection = { weapon, sensitivity }; },
        assertCurrent: () => { o.assertCurrent?.(); if (this.closed) throw new Error("Q3 cgame belongs to a retired world"); }, print: o.commands.print };
    if (o.kind === "qvm") {
      const scalar = new QvmApplicationScalars({ renderer: o.renderer, local: o.local, media, services, now: o.now,
        keyCatcher: { get: () => this.keyCatcher, set: value => { this.keyCatcher = value; } }, clientState: o.clientState,
        lightForPoint: point => this.light(point), assertCurrent: session.assertCurrent });
      const game = await ApplicationQvmClient.create({ seat, services, media, session, connection: o.connection, queries: o.queries,
        commands: o.commandBuffer, browser: o.browser, map: o.assets.content.recipe.map.geometry.requestedPath, now: o.now, keyCatcher: () => this.keyCatcher,
        removeCommand: name => { this.commandNames.delete(name); o.commandBuffer.unregister(name); },
        scalar: (call, owner) => scalar.dispatch(call, () => owner.updateScreen(call)) });
      this.backend = { kind: "qvm", game };
      this.submissions.length = 0;
      return;
    }
    const game = await createQ3ClientPresentation({ ...(o.weaponHud === undefined ? {} : { weaponHud: o.weaponHud }), assets: media, resources, scene: recorder, sound, draw, fontRegistry: media.fontRegistry,
      world: o.assets.world, collision: services.collision, movement: o.movement, target: this.viewportValue, hardware: "generic", commandContext: this.commandContext(),
      session,
      clock: { milliseconds: o.now, serverTime: () => source.time, frameNumber: () => this.frameNumber },
      menus: this.product === "baseq3" ? { kind: "baseq3" } : { kind: "missionpack", cinematics,
        setKeyCatcher: mask => { this.keyCatcher = mask; }, audio: { playLocal: pcm => {
          sound.startLocalSound(typeof pcm === "number" ? media.bank.soundAtIndex(pcm) : pcm ?? null, 6);
        }, startBackground: path => sound.startBackgroundTrack(path ?? "", path ?? ""), stopBackground: () => { void sound.startBackgroundTrack("", ""); } } },
      memoryRemaining: () => Math.min(0x7fffffff, freemem()), updateLoadingScreen: paint => paint(),
      lightForPoint: point => this.light(point),
      character: (entity, render) => {
        if (o.hooks !== undefined) o.hooks.character(entity, render);
        else if (o.assets.content.recipe.character.appearance.provider.startsWith("q3:")) render();
        else this.foreign.character(entity);
      },
      event: async (entity, position, render) => { this.eventCount++; if (o.hooks === undefined) await render(); else await o.hooks.event(entity, position, render); },
      predictItem: (entity, predict) => o.hooks === undefined ? predict() : o.hooks.predictItem(entity, predict),
      viewWeapon: (state, render) => {
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
  get userCommandSelection(): { readonly weapon: number; readonly sensitivity: number } { return this.selection; }
  get presentedEvents(): number { return this.eventCount; }
  weaponHudView(): { readonly visible: boolean; readonly aggregateWarning: boolean } {
    if (this.requireBackend().kind === "qvm") return { visible: false, aggregateWarning: false };
    const state = this.requireGame().state, ps = state.snap?.playerState;
    return { visible: ps !== undefined && !state.levelShot && !state.showScores && ps.health > 0
      && ps.pmType !== MoveType.PM_INTERMISSION && ps.persistant.get(PersistentIndex.PERS_TEAM) !== Team.TEAM_SPECTATOR
      && (this.cvars.get("cg_draw2D")?.integerValue ?? 1) !== 0 && (this.cvars.get("cg_drawStatus")?.integerValue ?? 1) !== 0,
      aggregateWarning: (this.cvars.get("cg_drawAmmoWarning")?.integerValue ?? 1) !== 0 };
  }
  camera(): SceneCamera { return this.latestCamera; }
  receive(state: Q3SourcePresentationState, events: readonly SimulationPresentationEvent[], commands: readonly ActorCommand[]): void { this.requireGame(); if (this.localSource === null) throw new Error("Remote Q3 cgame receives snapshots through its network connection"); this.localSource.receive(state, events, commands); }
  async prepare(frameNumber: number, viewport = this.options.viewport(), presentations: readonly SimulationPresentation[] = []): Promise<void> {
    this.applySystemInfo();
    const backend = this.requireBackend(); this.frameNumber = frameNumber; Object.assign(this.viewportValue, viewport); this.submissions.length = 0;
    for (const setting of this.options.serverSettings?.() ?? []) {
      if (this.sharedCvarNames.has(setting.name.toLowerCase())) this.cvars.set(setting.name, setting.value, true);
    }
    if (backend.kind === "typescript") {
      await this.foreign.prepare(presentations);
      await backend.game.frames.drawActiveFrame({ serverTime: this.source.time, stereo: "center", demoPlayback: false, engineFrameNumber: frameNumber });
    } else await backend.game.draw(this.source.time);
    for (const submission of this.submissions) if (submission.kind === "scene") {
      for (const [provider, models] of this.models(submission.scene)) await this.renderer(provider).preload(models.map(model => model.entity), entity => models.find(model => model.entity === entity)?.options ?? {});
    }
    await Promise.all([...this.renderers.values()].map(renderer => renderer.refreshShaderRemaps()));
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
        case "mouse-button": await this.keyEvent(KeyCode.Mouse1 + event.button - 1, event.down); break;
        case "mouse-motion": await this.mouseEvent(event.delta.x, event.delta.y); break;
        case "mouse-wheel": for (let count = 0; count < Math.abs(event.delta.y); count++) {
          const key = event.delta.y > 0 ? KeyCode.MouseWheelUp : KeyCode.MouseWheelDown;
          await this.keyEvent(key, true); await this.keyEvent(key, false);
        } break;
        case "controller-button": if (event.button >= 0 && event.button < 32) await this.keyEvent(KeyCode.Joy1 + event.button, event.down); break;
        case "controller-axis": case "focus": break;
      }
  }
  get capturesInput(): boolean { return this.keyCatcher !== 0; }
  private renderer(provider: ProviderSceneAssets): SceneModelRenderer { let renderer = this.renderers.get(provider); if (renderer === undefined) { renderer = new SceneModelRenderer(provider, this.options.assets.world); this.renderers.set(provider, renderer); } return renderer; }
  private models(scene: Q3PresentedScene): ReadonlyMap<ProviderSceneAssets, readonly PresentedModel[]> {
    const groups = new Map<ProviderSceneAssets, PresentedModel[]>();
    for (const model of scene.models) {
      if (model.entity.model.kind === "brush-model") continue;
      const provider = this.media.modelProviders.get(model.source.model);
      if (provider === undefined) throw new Error("Cgame model lost its selected asset provider");
      const group = groups.get(provider); if (group === undefined) groups.set(provider, [model]); else group.push(model);
    }
    return groups;
  }
  private light(point: Vec3) {
    const source = lightForPoint(this.lightSampler.grid, point, { ambientScale: 1, directedScale: 1 }); if (source !== null) return source;
    const sample = this.lightSampler.sample(point, { camera: this.latestCamera, time: { kind: "milliseconds", value: this.source.time }, target: { kind: "seat", seat: this.options.local.player.seat.id } });
    return { ambientLight: { x: sample.color.x * 255, y: sample.color.y * 255, z: sample.color.z * 255 }, directedLight: { x: 0, y: 0, z: 0 }, lightDir: { x: 0, y: 0, z: 1 } };
  }
  private operations(scene: Q3PresentedScene, input: WorldViewInput, firstEntity: number, additions: readonly SceneOperation[] = []): readonly SceneOperation[] {
    const source = input.source;
    if (source === undefined) throw new Error("Q3 view has no source admission");
    const operations: SceneOperation[] = [], world = this.options.assets.world;
    const noWorldModel = (scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0;
    const weaponInput = { ...input, camera: q3WeaponCamera(input.camera, this.options.splitScreen === true && !noWorldModel) };
    for (const [index, poly] of scene.admission.polygons.entries()) {
      const compiled = this.options.assets.materialRegistrations.requireMaterial(this.requireServices().resources.picture(poly.shader).material.compiled);
      operations.push(sourceDrawGroup(compiled, { view: source.view, entity: { kind: "world" }, surface: index, fog: poly.fog === null ? 0 : poly.fog.index + 1, dlight: 0 },
        prepareMaterialBatches(compiled, polyGeometry(poly), world.materialContext(input, undefined, poly.fog?.volume ?? null))));
    }
    const polygon = (operation: SceneOperation): boolean => operation.kind === "scene-group" && operation.order.kind === "source" && operation.order.source.entity.kind === "world";
    operations.push(...additions.filter(polygon));
    const models = new Map(scene.models.map(model => [model.entityIndex, model]));
    const project = createViewProjector(input.camera), white = this.media.provider.textures.white.image;
    for (const [index, entity] of scene.admission.entities.entries()) {
      const entityOrder = { kind: "refentity", index: firstEntity + index } satisfies import("../../render/scene/submissions.ts").SourceEntityOrder;
      if (input.camera.clip.kind === "portal" && (entity.renderFlags & 4) !== 0) continue;
      if (entity.kind === "poly") throw new CommonError("drop", "R_AddEntitySurfaces: Bad reType");
      if (entity.kind === "portal-surface") continue;
      if (entity.kind === "model") {
        if (entity.model.kind === "default") {
          if (input.camera.clip.kind === "none" && (entity.renderFlags & 2) !== 0) continue;
          operations.push(sourceDrawGroup(this.media.provider.shaders.sourceMaterials.default,
            { view: source.view, entity: entityOrder, surface: 0, fog: 0, dlight: 0 },
            [defaultModelBatch({ origin: entity.origin, axis: entity.axis, scale: { x: 1, y: 1, z: 1 } }, project, state, white)]));
          continue;
        }
        const model = models.get(index);
        if (model === undefined) throw new Error("Admitted Q3 model lost its prepared descriptor");
        const selected = (entity.renderFlags & 4) !== 0 ? weaponInput : input;
        if (model.entity.model.kind === "brush-model") {
          operations.push(...world.prepareModel(model.entity.model.model, { origin: entity.origin, axis: entity.axis },
            { ...selected, animationFrame: entity.frame, materialContext: { ...selected.materialContext, entityRGBA: entity.shaderRGBA } }, entityOrder));
        } else {
          const provider = this.media.modelProviders.get(entity.model);
          if (provider === undefined) throw new Error("Cgame model lost its selected asset provider");
          operations.push(...this.renderer(provider).prepare([model.entity], selected,
            () => ({ ...model.options, noWorldModel, shaderTexCoord: entity.shaderTexCoord, source: { view: source.view, entity: entityOrder } })));
        }
        continue;
      }
      if (input.camera.clip.kind === "none" && (entity.renderFlags & 2) !== 0) continue;
      const compiled = entity.customShader === null ? this.media.provider.shaders.sourceMaterials.default
        : this.options.assets.materialRegistrations.requireMaterial(this.requireServices().resources.picture(entity.customShader).material.compiled);
      const fog = noWorldModel ? null : q3ProceduralFog(entity.origin, entity.radius, world.fogSelections);
      const order = { view: source.view, entity: entityOrder, surface: 0, fog: fog === null ? 0 : fog.index + 1, dlight: 0 };
      if (entity.kind === "beam") operations.push(sourceDrawGroup(compiled, order, [beamBatch(entity, project, state, white)]));
      else {
        const geometry = entity.kind === "sprite" ? spriteGeometry(entity, input.camera.axis, input.camera.clip.kind === "portal" && input.camera.clip.mirror)
          : railGeometry(entity, input.camera.origin, DEFAULT_RAIL_SETTINGS);
        operations.push(sourceDrawGroup(compiled, order, prepareMaterialBatches(compiled, geometry,
          { ...world.materialContext(input, undefined, fog?.volume ?? null), entityRGBA: entity.shaderRGBA, shaderTexCoord: entity.shaderTexCoord, timeOffset: entity.shaderTime })));
      }
    }
    if (this.requireBackend().kind === "typescript" && !noWorldModel) operations.push(...this.foreign.draw(input, this.requireGame().state.renderingThirdPerson,
      (this.cvars.get("cg_drawGun")?.integerValue ?? 1) !== 0, weaponViewCamera(weaponInput.camera,
        this.submissions.flatMap(submission => submission.kind === "scene" && (submission.scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0 ? [submission.scene.viewport] : []))));
    operations.push(...additions.filter(operation => !polygon(operation)));
    return operations;
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
  frame(additionalEffects?: (camera: SceneCamera, source: SourceSceneOrder) => ApplicationEffectFrame, transformCamera?: (camera: SceneCamera) => SceneCamera): RenderFrame {
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
        clear: (scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0 ? { depth: 1, color: null, stencil: false } : { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false },
        };
      if ((scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0) {
        const source = createSourceSceneOrder(this.options.assets.materialRegistrations), selected = { ...input, source: createWorldSurfaceAdmission(source) };
        const firstEntity = reserveSourceEntityRange(source, scene.admission.entities.length);
        this.frames.view({ target: input.target, time, viewport: scene.viewport,
          clear: input.clear ?? null, clipPlane: null, beforeView: [], operations: finishSceneOperations(this.operations(scene, selected, firstEntity)) });
      } else {
        const publish = (view: WorldViewInput): void => {
          const source = createSourceSceneOrder(this.options.assets.materialRegistrations);
          const firstEntity = reserveSourceEntityRange(source, scene.admission.entities.length);
          const effects = additionalEffects?.(view.camera, source);
          const combined: WorldViewInput = { ...view, source: createWorldSurfaceAdmission(source), ...(effects === undefined ? {} : { lights: effects.lights,
            q3Lights: [...view.q3Lights ?? [], ...effects.q3Lights].slice(0, 32) }) };
          world.prepareWorldOperations(combined);
          this.frames.world(world.prepareView({ ...combined, operations: this.operations(scene, combined, firstEntity, effects?.operations) }));
        };
        const child = this.portal(scene, input);
        if (child !== null) publish(child);
        publish(input);
      }
    }
    return this.frames.finish(false);
  }
  async shutdown(): Promise<void> { if (this.backend?.kind === "qvm") await this.backend.game.shutdown(); this.close(); }
  close(): void {
    if (this.closed) return;
    this.backend?.game.close(); this.audioOperations.push({ kind: "clear-loops", killAll: true });
    this.options.audio.receiveCgameFrame({ content: this.media.content, seat: this.options.local.player.seat.id, operations: this.audioOperations.splice(0) });
    this.closed = true; this.cinematics?.close(); this.media.close(); this.foreign.close(); this.renderers.clear(); this.submissions.length = 0;
  }
}
