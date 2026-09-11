import type { ActorCommand } from "../../contracts/session.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { CommandContext } from "../../contracts/common.ts";
import type { DrawBatch, Rect, RenderCommand, RenderFrame, RenderState, SceneCamera } from "../../contracts/render.ts";
import type { SceneQueries } from "../../contracts/scene.ts";
import type { Bounds, Vec3 } from "../../contracts/math.ts";
import { freemem } from "node:os";
import { anglesToAxis } from "../../core/math.ts";
import type { SharedSceneQueries } from "../../world/collision/index.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import type { CvarSnapshot } from "../../core/cvars/index.ts";
import { createQ3ClientPresentation } from "../../content/q3/presentation/client.ts";
import { cvarTable } from "../../content/q3/presentation/config.ts";
import type { Q3ClientPresentation, Q3ClientPresentationOptions, Q3ClientSound } from "../../content/q3/presentation/client.ts";
import { Q3SceneRecorder } from "../../content/q3/presentation/scene.ts";
import type { Q3PresentedScene, PresentedModel } from "../../content/q3/presentation/scene.ts";
import { Q3RendererResources } from "../../content/q3/presentation/resources.ts";
import { Q3PresentationAudio } from "../../content/q3/presentation/audio.ts";
import type { PresentationMovementHost } from "../../content/q3/presentation/movement-host.ts";
import type { UserCommand } from "../../content/q3/base/shared/player-state.ts";
import { RDF_NOWORLDMODEL } from "../../content/q3/presentation/refdef.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { prepareMaterialText } from "../../render/commands/material2d.ts";
import { SceneModelRenderer } from "../../render/scene/models/renderer.ts";
import { ModelLightSampler } from "../../render/scene/models/light-sampler.ts";
import { lightForPoint } from "../../materials/q3-lighting.ts";
import { prepareMaterialBatches } from "../../materials/evaluate.ts";
import { DEFAULT_RAIL_SETTINGS, beamBatch, defaultModelBatch, railGeometry, spriteGeometry } from "../../render/scene/particles/primitives.ts";
import { visibleWorld } from "../../render/scene/visibility.ts";
import { portalCamera, portalSurfaceOffscreen } from "../../render/scene/portal.ts";
import { createViewProjector, perspectiveProjection } from "../../render/scene/view.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import { Draw2D, TextCommandSink } from "../../text/draw2d.ts";
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
import { q3ClientCollision } from "./q3-client/collision.ts";
import { ApplicationQ3Cinematics } from "./q3-client/cinematics.ts";
import { selectApplicationQ3Snapshot } from "./q3-client/visibility.ts";
import { ApplicationQ3ForeignModels } from "./q3-client/foreign.ts";
import { q3WeaponCamera } from "./q3-client/view.ts";

export interface ApplicationQ3ClientOptions {
  readonly assets: ApplicationAssets;
  readonly queries: SceneQueries & Pick<SharedSceneQueries, "pointLeaf" | "leafCluster" | "leafArea" | "areaBits">;
  readonly initial: Q3SourcePresentationState;
  readonly local: LocalInput; readonly audio: ApplicationAudio; readonly movement: PresentationMovementHost;
  readonly settings?: readonly CvarSnapshot[];
  readonly splitScreen?: boolean;
  linkBounds(number: number): Bounds | null;
  sourceActor(number: number): ActorId | null;
  serverSettings?(): readonly CvarSnapshot[];
  predictionCommand?(command: ActorCommand, sourceTimeMilliseconds: number): UserCommand;
  viewport(): Rect;
  now(): number;
  readonly commands: { reliable(text: string): void; console(text: string): void; print(text: string): void };
  readonly hooks?: Pick<Q3ClientPresentationOptions, "character" | "event" | "predictItem" | "viewWeapon" | "playerWeapon">;
}
type Submission = { readonly kind: "scene"; readonly scene: Q3PresentedScene }
  | { readonly kind: "text"; readonly draw: MaterialTextDraw }
  | { readonly kind: "command"; readonly command: Exclude<RenderCommand, { readonly kind: "swap-buffers" }> };
const state: RenderState = { blend: { source: "one", destination: "zero" }, depthTest: "less-equal", depthWrite: true,
  alphaTest: "none", cull: "back", depthRange: [0, 1], polygonOffset: null };

/** A seat owns cgame state; source authority, resource mounts and audio output remain shared. */
export class ApplicationQ3Client {
  readonly source: ApplicationQ3Source;
  readonly cvars: CvarRegistry;
  readonly commandNames = new Set<string>();
  private game: Q3ClientPresentation | null = null;
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
  private readonly sharedCvarNames: ReadonlySet<string>;
  private readonly foreign: ApplicationQ3ForeignModels;
  private constructor(readonly options: ApplicationQ3ClientOptions, readonly media: ApplicationQ3Assets) {
    this.source = new ApplicationQ3Source(options.local.player.actor, options.initial,
      (player, source) => selectApplicationQ3Snapshot(player, source, options.queries, options.linkBounds, options.assets.world.map.leaves.length, options.commands.print),
      options.sourceActor, options.predictionCommand);
    this.foreign = new ApplicationQ3ForeignModels(options.assets, options.local.player.actor, number => this.source.actorAt(number));
    this.viewportValue = { ...options.viewport() };
    const player = options.initial.clients.find(client => client.actor.equals(options.local.player.actor));
    if (player === undefined) throw new Error("Q3 cgame seat lacks a source player");
    this.latestCamera = { origin: { ...player.state.origin, z: player.state.origin.z + player.state.viewheight },
      axis: anglesToAxis(player.state.viewangles), viewport: this.viewportValue,
      projection: perspectiveProjection(90, 73.739795, 16384), clip: { kind: "none" } };
    this.cvars = new CvarRegistry({ dialect: "q3", context: this.commandContext(), print: options.commands.print,
      cheatsAllowed: () => {
        const source = options.serverSettings?.().find(setting => setting.name.toLowerCase() === "sv_cheats");
        return source === undefined ? undefined : source.integerValue !== 0;
      } });
    for (const setting of options.settings ?? []) this.cvars.set(setting.name, setting.value, true);
    this.sharedCvarNames = new Set(cvarTable(options.initial.product).map(definition => definition.name.toLowerCase()));
    for (const setting of options.serverSettings?.() ?? []) if (this.sharedCvarNames.has(setting.name.toLowerCase())) this.cvars.set(setting.name, setting.value, true);
    this.cvars.set("sv_running", "1", true);
    this.frames = new SceneFrameBuilder(options.assets.images); this.lightSampler = new ModelLightSampler(options.assets.world);
  }
  static async create(options: ApplicationQ3ClientOptions): Promise<ApplicationQ3Client> {
    const media = await ApplicationQ3Assets.create(options.assets, options.assets.content.recipe.engineBehavior.content, options.commands.print);
    const client = new ApplicationQ3Client(options, media);
    try { await client.initialize(); return client; } catch (error) { client.close(); throw error; }
  }
  private commandContext(): CommandContext { const player = this.options.local.player; return { session: player.actor.session,
    origin: { kind: "local-seat", seat: player.seat.id, client: player.seat.client.id } }; }
  private requireGame(): Q3ClientPresentation { if (this.closed || this.game === null) throw new Error("Q3 cgame seat is closed or uninitialized"); return this.game; }
  private async initialize(): Promise<void> {
    const o = this.options, seat = o.local.player.seat.id, source = this.source, media = this.media;
    const recorder = new Q3SceneRecorder({ seat, viewport: this.viewportValue, farClip: 16384, nearClip: 4, rail: DEFAULT_RAIL_SETTINGS,
      actor: () => null, publish: scene => { this.submissions.push({ kind: "scene", scene }); if ((scene.source.renderFlags & RDF_NOWORLDMODEL) === 0) this.latestCamera = scene.camera; } });
    const resources = new Q3RendererResources(await media.resourceHost(recorder));
    const soundTarget = new Q3PresentationAudio({ seat, sounds: media.bank, actor: number => source.actorAt(number), frameNumber: () => this.frameNumber,
      play: sound => { this.audioOperations.push({ kind: "play", sound }); }, loop: sound => { this.audioOperations.push({ kind: "loop", sound }); },
      updateActor: (actor, origin) => { this.audioOperations.push({ kind: "position", actor, origin }); },
      stopLoop: (_seat, actor) => { this.audioOperations.push({ kind: "stop-loop", actor }); } });
    const sound: Q3ClientSound = { bank: media.bank,
      startSound: (origin, entity, channel, pcm) => soundTarget.startSound(origin, entity, channel, pcm),
      startSourceSound: (pcm, settings) => soundTarget.startSourceSound(pcm, settings), startLocalSound: (pcm, channel) => soundTarget.startLocalSound(pcm, channel),
      addLoopSound: (entity, origin, velocity, pcm, real) => soundTarget.addLoopSound(entity, origin, velocity, pcm, real),
      updateSoundPosition: (entity, position) => soundTarget.updateSoundPosition(entity, position), stopLoopingSound: entity => soundTarget.stopLoopingSound(entity),
      clearLoopingSounds: killAll => { this.audioOperations.push({ kind: "clear-loops", killAll }); },
      setListener: (_client, origin, axis) => { this.latestCamera = { ...this.latestCamera, origin, axis }; },
      startBackgroundTrack: (intro, loop) => o.audio.playMusic(media.content, `${intro} ${loop}`) };
    const draw = new Draw2D(new TextCommandSink(seat, this.viewportValue, command => {
      if (command.kind === "swap-buffers") throw new Error("Cgame cannot present the shared framebuffer");
      this.submissions.push({ kind: "command", command });
    }, draw => { this.submissions.push({ kind: "text", draw }); }), "stretch-640");
    const cinematics = new ApplicationQ3Cinematics(media, o.audio, seat, o.now); this.cinematics = cinematics;
    this.game = await createQ3ClientPresentation({ assets: media, resources, scene: recorder, sound, draw, fontRegistry: media.fontRegistry,
      world: o.assets.world, collision: q3ClientCollision(o.queries), movement: o.movement, target: this.viewportValue, hardware: "generic", commandContext: this.commandContext(),
      session: { product: o.initial.product, clientNumber: source.clientNumber, serverMessageSequence: 0, lastExecutedServerCommand: 0,
        mode: { kind: "live" }, commands: source.commands, snapshots: source, cvars: this.cvars,
        getGameState: () => source.getGameState(), getServerCommand: sequence => source.getServerCommand(sequence), snapshotPing: () => 0,
        addReliableCommand: o.commands.reliable, appendConsoleCommand: o.commands.console, registerCgameCommand: name => { this.commandNames.add(name); },
        setUserCommandValue: (weapon, sensitivity) => { this.selection = { weapon, sensitivity }; },
        assertCurrent: () => { if (this.closed) throw new Error("Q3 cgame belongs to a retired world"); }, print: o.commands.print },
      clock: { milliseconds: o.now, serverTime: () => source.time, frameNumber: () => this.frameNumber },
      menus: o.initial.product === "baseq3" ? { kind: "baseq3" } : { kind: "missionpack", cinematics,
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
    this.submissions.length = 0;
  }
  get cgame(): Q3ClientPresentation { return this.requireGame(); }
  get userCommandSelection(): { readonly weapon: number; readonly sensitivity: number } { return this.selection; }
  get presentedEvents(): number { return this.eventCount; }
  camera(): SceneCamera { return this.latestCamera; }
  receive(state: Q3SourcePresentationState, events: readonly SimulationPresentationEvent[], commands: readonly ActorCommand[]): void { this.requireGame(); this.source.receive(state, events, commands); }
  async prepare(frameNumber: number, viewport = this.options.viewport(), presentations: readonly SimulationPresentation[] = []): Promise<void> {
    const game = this.requireGame(); this.frameNumber = frameNumber; Object.assign(this.viewportValue, viewport); this.submissions.length = 0;
    for (const setting of this.options.serverSettings?.() ?? []) {
      if (this.sharedCvarNames.has(setting.name.toLowerCase())) this.cvars.set(setting.name, setting.value, true);
    }
    await this.foreign.prepare(presentations);
    await game.frames.drawActiveFrame({ serverTime: this.source.time, stereo: "center", demoPlayback: false, engineFrameNumber: frameNumber });
    for (const submission of this.submissions) if (submission.kind === "scene") {
      for (const [provider, models] of this.models(submission.scene)) await this.renderer(provider).preload(models.map(model => model.entity), entity => models.find(model => model.entity === entity)?.options ?? {});
    }
    await Promise.all([...this.renderers.values()].map(renderer => renderer.refreshShaderRemaps()));
    this.options.audio.receiveCgameFrame({ seat: this.options.local.player.seat.id, operations: this.audioOperations.splice(0) });
  }
  command(argv: readonly string[]): Promise<boolean> { return this.requireGame().console.execute(argv); }
  handlesCommand(name: string): boolean { return this.requireGame().console.handles(name); }
  keyEvent(key: number, down: boolean): Promise<void> { return this.requireGame().keyEvent(key, down); }
  mouseEvent(x: number, y: number): Promise<void> { return this.requireGame().mouseEvent(x, y); }
  eventHandling(type: number): Promise<void> { return this.requireGame().eventHandling(type); }
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
  private batches(scene: Q3PresentedScene, input: WorldViewInput): readonly DrawBatch[] {
    const batches: DrawBatch[] = [], noWorldModel = (scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0;
    const weaponInput = { ...input, camera: q3WeaponCamera(input.camera, this.options.splitScreen === true && !noWorldModel) };
    for (const [provider, models] of this.models(scene)) for (const model of models) {
      const selected = (model.source.renderFlags & 4) !== 0 ? weaponInput : input;
      batches.push(...this.renderer(provider).prepare([model.entity], selected,
        () => ({ ...model.options, noWorldModel, shaderTexCoord: model.source.shaderTexCoord })));
    }
    if ((scene.source.renderFlags & RDF_NOWORLDMODEL) === 0) batches.push(...this.foreign.draw(input, this.requireGame().state.renderingThirdPerson,
      (this.cvars.get("cg_drawGun")?.integerValue ?? 1) !== 0, weaponInput.camera));
    const context = this.options.assets.world.materialContext(input);
    for (const effect of scene.effects) {
      const picture = this.requireGame().media.resources.picture(effect.shader), source = effect.source;
      const geometry = "kind" in source ? source.kind === "sprite"
        ? spriteGeometry(source, input.camera.axis, input.camera.clip.kind === "portal" && input.camera.clip.mirror)
        : source.kind === "beam" ? effect.geometry : railGeometry(source, input.camera.origin, DEFAULT_RAIL_SETTINGS) : effect.geometry;
      batches.push(...prepareMaterialBatches(picture.material.compiled, geometry, "shaderRGBA" in source
        ? { ...context, entityRGBA: source.shaderRGBA, shaderTexCoord: source.shaderTexCoord, timeOffset: source.shaderTime } : context));
    }
    const project = createViewProjector(input.camera), white = this.media.provider.textures.white.image;
    for (const entity of scene.specialEntities) batches.push(entity.kind === "beam" ? beamBatch(entity, project, state, white)
      : defaultModelBatch({ origin: entity.origin, axis: entity.axis, scale: { x: 1, y: 1, z: 1 } }, project, state, white));
    return batches;
  }
  private portal(scene: Q3PresentedScene, input: WorldViewInput): WorldViewInput | null {
    if (scene.portals.length === 0 || input.camera.clip.kind !== "none") return null;
    const world = this.options.assets.world, visible = visibleWorld(world.map, input.camera, input);
    for (const index of visible.surfaces) {
      const surface = world.surfaces[index];
      if (surface?.kind !== "q3" || surface.shader.finished.sort !== 1 || surface.plane === null) continue;
      const child = portalCamera(surface.plane, scene.portals, input.camera, this.source.time);
      if (child === null || portalSurfaceOffscreen(surface.geometry, input.camera, surface.shader.material.portalRange, child.mirror)) continue;
      return { ...input, camera: child.camera, pvsOrigin: child.pvsOrigin };
    }
    return null;
  }
  frame(additionalEffects?: (camera: SceneCamera) => ApplicationEffectFrame): RenderFrame {
    this.requireGame(); this.frames.begin();
    const seat = this.options.local.player.seat.id, world = this.options.assets.world, time = { kind: "milliseconds", value: this.source.time } satisfies WorldViewInput["time"];
    for (const submission of this.submissions) {
      if (submission.kind === "command") { this.frames.command(submission.command); continue; }
      if (submission.kind === "text") {
        const input: WorldViewInput = { camera: this.latestCamera, time, target: { kind: "seat", seat } };
        this.frames.view({ target: input.target, time, viewport: this.viewportValue, clear: null, clipPlane: null, beforeView: [],
          operations: [{ kind: "draw", batches: prepareMaterialText(submission.draw, this.viewportValue, world.materialContext(input)) }] });
        continue;
      }
      const scene = submission.scene, input: WorldViewInput = { camera: scene.camera, time, target: { kind: "seat", seat },
        q3Lights: scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: light.additive })).slice(0, 32),
        renderText: scene.source.text, visibleAreas: new Set(Array.from({ length: scene.source.areaMask.length * 8 }, (_, area) => area)
          .filter(area => ((scene.source.areaMask[area >> 3] ?? 0) & (1 << (area & 7))) === 0)),
        clear: (scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0 ? { depth: 1, color: null, stencil: false } : { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false },
        inlineModels: scene.models.flatMap(model => model.entity.model.kind === "brush-model" ? [{ model: model.entity.model.model,
          transform: { origin: model.entity.transform.origin, axis: model.entity.transform.axis }, animationFrame: model.entity.pose.kind === "frame" ? model.entity.pose.frame : 0 }] : []) };
      if ((scene.source.renderFlags & RDF_NOWORLDMODEL) !== 0) this.frames.view({ target: input.target, time, viewport: scene.viewport,
        clear: input.clear ?? null, clipPlane: null, beforeView: [], operations: [{ kind: "draw", batches: this.batches(scene, input) }] });
      else {
        const publish = (view: WorldViewInput): void => {
          const effects = additionalEffects?.(view.camera);
          const combined = effects === undefined ? view : { ...view, lights: effects.lights,
            q3Lights: [...view.q3Lights ?? [], ...effects.q3Lights].slice(0, 32) };
          this.frames.world(world.prepareView({ ...combined, operations: [{ kind: "draw", batches: this.batches(scene, combined) }, ...effects?.operations ?? []] }));
        };
        const child = this.portal(scene, input);
        if (child !== null) publish(child);
        publish(input);
      }
    }
    return this.frames.finish(false);
  }
  close(): void {
    if (this.closed) return;
    this.game?.close(); this.audioOperations.push({ kind: "clear-loops", killAll: true });
    this.options.audio.receiveCgameFrame({ seat: this.options.local.player.seat.id, operations: this.audioOperations.splice(0) });
    this.closed = true; this.cinematics?.close(); this.media.close(); this.foreign.close(); this.renderers.clear(); this.submissions.length = 0;
  }
}
