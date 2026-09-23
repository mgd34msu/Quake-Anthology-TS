import { freemem } from "node:os";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { Rect } from "../../contracts/render.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { QvmCgameImport } from "../../compat/qvm/abi.ts";
import { QvmModPresentation, type QvmSceneContext } from "../../compat/qvm/mod-presentation.ts";
import { qvmCommonSyscall } from "../../compat/qvm/common-syscalls.ts";
import type { QvmCommonServices } from "../../compat/qvm/common-syscalls.ts";
import { QvmFiles, qvmFileSyscall } from "../../compat/qvm/file-syscalls.ts";
import { qvmClientAudioSyscall } from "../../compat/qvm/client-audio-syscalls.ts";
import { qvmClientRenderSyscall } from "../../compat/qvm/client-render-syscalls.ts";
import { qvmClientCollisionSyscall } from "../../compat/qvm/client-collision-syscalls.ts";
import type { QvmClientClipModels } from "../../compat/qvm/client-collision-syscalls.ts";
import { qvmClientMarkSyscall } from "../../compat/qvm/client-mark-syscalls.ts";
import { QvmClientScripts, qvmClientScriptSyscall } from "../../compat/qvm/client-script-syscalls.ts";
import { QVM_GAME_STATE_BYTES, writeSourceQvmGameState } from "../../compat/qvm/client-state-record.ts";
import { rejectQvmSyscall } from "../../compat/qvm/syscalls.ts";
import type { QvmHostCall, QvmHostResult } from "../../compat/qvm/syscalls.ts";
import { worldMarkProjector } from "../../content/q3/presentation/mark-projector.ts";
import type { Q3SceneContent } from "../../content/q3/presentation/scene.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { ScriptGlobalDefines } from "../../ui/common/legacy/script/preprocessor.ts";
import { CollisionMapSettings } from "../../world/collision/q3/settings.ts";
import type { SharedSceneQueries } from "../../world/collision/index.ts";
import type { ActiveModPresentation, QvmModScenePublication } from "../../world/session/mod-presentations.ts";
import { selectApplicationQ3Snapshot } from "./q3-client/visibility.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationAudio } from "./audio.ts";
import type { Q3SeatAudioOperation } from "./audio/q3.ts";
import { ApplicationQ3Assets } from "./q3-client/assets.ts";
import { SharedQvmClientClipModels } from "./q3-client/guest-collision.ts";
import { ApplicationQ3SceneRenderer } from "./q3-client/scene.ts";
import { createApplicationQ3Services } from "./q3-client/services.ts";
import type { ApplicationQ3ServiceOptions, ApplicationQ3Services } from "./q3-client/services.ts";
import type { Q3SourcePlayerEvent } from "./simulation/q3/types.ts";

export interface ApplicationModPresentationOptions {
  readonly assets: ApplicationAssets;
  readonly audio: ApplicationAudio;
  readonly queries: SharedSceneQueries;
  readonly seat: SeatId;
  readonly viewer: ActorId;
  readonly viewport: Rect;
  readonly source: ActiveModPresentation;
  readonly clock: ApplicationQ3ServiceOptions["clock"];
  readonly output: Omit<ApplicationQ3ServiceOptions["output"], "audio">;
  readonly commands?: Extract<QvmCommonServices, { readonly role: "cgame" }>["commands"];
  print(text: string): void;
  viewOrigin(): Vec3;
  nextFrame(): Promise<void>;
  scalar?(call: QvmHostCall, owner: ApplicationModPresentation): QvmHostResult | null;
}

/** One original component cgame instance for one live source generation and viewing seat. */
export class ApplicationModPresentation {
  readonly cvars: CvarRegistry;
  private readonly generation: number;
  private readonly globals = new ScriptGlobalDefines();
  private readonly audioOperations: Q3SeatAudioOperation[] = [];
  private mediaValue: ApplicationQ3Assets | null = null;
  private servicesValue: ApplicationQ3Services | null = null;
  private core: QvmModPresentation | null = null;
  private rendererValue: ApplicationQ3SceneRenderer | null = null;
  private captured: Q3SceneContent | null = null;
  private frameSequence = -1;
  private previousFrameTime: number | null = null;
  private files: QvmFiles | null = null;
  private scripts: QvmClientScripts | null = null;
  private collision: QvmClientClipModels | null = null;
  private marks: ReturnType<typeof worldMarkProjector> | null = null;
  private closed = false;
  private sceneContext: QvmSceneContext | null = null;
  private sceneBaseline: QvmSceneContext | undefined;
  private sceneTimeOffset: number | null = null;

  private constructor(readonly options: ApplicationModPresentationOptions) {
    this.generation = options.source.source.generation;
    this.cvars = new CvarRegistry({ dialect: "q3", context: { session: options.viewer.session,
      origin: { kind: "script", name: options.source.prepared.artifact.module.artifactPath, caller: { kind: "server-console" } } }, print: options.print });
    const { source, prepared } = options.source, module = source.module, expected = prepared.source;
    if (module.id !== expected.id || module.artifactPath !== expected.artifactPath || module.digest !== expected.digest
      || module.revision !== expected.revision || source.abiProfile !== prepared.declaration.gameplay.abiProfile)
      throw new Error("Component presentation source differs from its prepared gameplay module");
    this.assertCurrent();
  }
  get media(): ApplicationQ3Assets {
    this.assertCurrent(); if (this.mediaValue === null) throw new Error("Component presentation media are not initialized"); return this.mediaValue;
  }
  get services(): ApplicationQ3Services {
    this.assertCurrent(); if (this.servicesValue === null) throw new Error("Component presentation services are not initialized"); return this.servicesValue;
  }
  get renderer(): ApplicationQ3SceneRenderer {
    this.assertCurrent(); if (this.rendererValue === null) throw new Error("Component scene renderer is not initialized"); return this.rendererValue;
  }
  get time(): number { return this.previousFrameTime ?? this.context().snapshot.serverTime; }
  owns(source: ActiveModPresentation, viewer: ActorId): boolean {
    return !this.closed && source.source === this.options.source.source && source.prepared === this.options.source.prepared
      && source.source.generation === this.generation && viewer.equals(this.options.viewer) && source.source.live(viewer);
  }
  private assertCurrent(): void {
    const source = this.options.source.source;
    if (this.closed || source.generation !== this.generation || !source.live(this.options.viewer))
      throw new Error("Component presentation belongs to a retired source or viewer");
    source.assertCurrent();
  }
  private context() {
    this.assertCurrent();
    const context = this.options.source.source.context(this.options.viewer);
    if (context === null) throw new Error("Component presentation viewer has no original source context");
    const frameTimeMilliseconds = this.previousFrameTime === null ? 0 : context.snapshot.serverTime - this.previousFrameTime;
    if (frameTimeMilliseconds < 0 && this.options.source.prepared.declaration.runtime === "qvm-player-events") throw new Error("Component presentation source time moved backward");
    if (this.options.source.prepared.declaration.runtime === "qvm-scene") {
      const publication = this.options.source.source.scene?.();
      if (publication === undefined) throw new Error("Scene cgame requires an admitted gameplay entity snapshot source");
      if (this.sceneContext?.revision !== publication.current.revision) {
        if (this.sceneBaseline === undefined && publication.baseline !== null) this.sceneBaseline = this.selectScene(publication.baseline);
        this.sceneContext = { ...this.selectScene(publication.current), ...(this.sceneBaseline === undefined ? {} : { baseline: this.sceneBaseline }) };
      }
      this.sceneTimeOffset ??= publication.current.serverTime - this.options.clock.now();
      const timeMilliseconds = Math.trunc(Math.max(publication.current.serverTime, this.previousFrameTime ?? publication.current.serverTime,
        this.options.clock.now() + this.sceneTimeOffset));
      return { ...context, timeMilliseconds, frameTimeMilliseconds: this.previousFrameTime === null ? 0 : timeMilliseconds - this.previousFrameTime,
        viewOrigin: this.options.viewOrigin(), scene: this.sceneContext };
    }
    return { ...context, frameTimeMilliseconds, viewOrigin: this.options.viewOrigin() };
  }
  private selectScene(source: QvmModScenePublication): QvmSceneContext {
    const player = source.clients.find(row => row.actor.equals(this.options.viewer));
    if (player === undefined) throw new Error("Component snapshot has no admitted viewing player");
    const bounds = new Map(source.entities.map(row => [row.state.number, row.bounds]));
    const visible = selectApplicationQ3Snapshot({ clientNum: player.slot, origin: player.state.origin, viewheight: player.state.viewHeight }, source,
      this.options.queries, slot => bounds.get(slot) ?? null, this.options.assets.world.map.leaves.length, this.options.print);
    const areaMask = new Uint8Array(32); areaMask.set(visible.areaMask);
    return { revision: source.revision, gameState: source.gameState, gameStateRevision: source.gameStateRevision,
      snapshot: { serverTime: source.serverTime, flags: 0, areaMask, playerState: player.state,
      entities: visible.entities, serverCommandSequence: source.commands.at(-1)?.sequence ?? 0 },
      actors: source.entities.map(row => ({ actor: row.actor, slot: row.state.number, owned: row.owned })),
      commands: source.commands.map(command => ({ sequence: command.sequence,
        arguments: command.recipient === null || command.recipient.equals(this.options.viewer) ? tokenizeCommand(command.text, "q3").argv : [] })) };
  }
  static async create(options: ApplicationModPresentationOptions, baselineSequence = -1): Promise<ApplicationModPresentation> {
    const owner = new ApplicationModPresentation(options);
    try {
      if (options.source.prepared.declaration.runtime === "qvm-scene") for (const variable of options.source.prepared.declaration.cvars)
        owner.cvars.set(variable.name, variable.value);
      owner.mediaValue = await ApplicationQ3Assets.create(options.assets, options.source.identity.source.content, options.print, () => false, "guest-async", "source");
      owner.assertCurrent();
      const collisionSettings = new CollisionMapSettings(owner.cvars); collisionSettings.registerMap();
      owner.collision = options.queries.nativeQ3ClipModels() ?? new SharedQvmClientClipModels(options.queries, owner.cvars);
      owner.marks = worldMarkProjector(options.assets.world);
      owner.servicesValue = await createApplicationQ3Services({ collisionSettings, media: owner.media, audio: options.audio,
        owner: options.source.prepared.source.id, seat: options.seat, viewport: options.viewport, queries: options.queries,
        actorAt: slot => {
          owner.assertCurrent(); const actor = options.source.source.actor(slot);
          if (actor === null) throw new Error(`Component sound source slot ${slot} has no live actor`);
          return actor;
        }, clock: options.clock, output: {
          scene: scene => { owner.assertCurrent(); options.output.scene(scene); },
          command: command => { owner.assertCurrent(); options.output.command(command); },
          text: draw => { owner.assertCurrent(); options.output.text(draw); },
          listener: (origin, axis) => { owner.assertCurrent(); options.output.listener(origin, axis); },
          audio: operation => { owner.assertCurrent(); owner.audioOperations.push(operation); },
        } });
      owner.assertCurrent();
      owner.rendererValue = new ApplicationQ3SceneRenderer(owner.media, owner.services.resources);
      const fileOptions = { mounts: owner.media.provider.mounts, writable: null, print: options.print, assertCurrent: () => owner.assertCurrent() };
      owner.files = new QvmFiles(fileOptions);
      owner.scripts = new QvmClientScripts({ ...fileOptions, globals: owner.globals });
      owner.core = new QvmModPresentation({ ...options.source.prepared, host: call => owner.host(call), context: () => owner.context(),
        actor: slot => options.source.source.actor(slot), live: actor => options.source.source.live(actor), assertCurrent: () => owner.assertCurrent() });
      await owner.core.initialize(baselineSequence);
      owner.assertCurrent(); owner.services.scene.clearScene(); owner.flushAudio(); return owner;
    } catch (error) {
      try { owner.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation initialization and cleanup failed"); }
      throw error;
    }
  }
  private host(call: QvmHostCall): QvmHostResult {
    this.assertCurrent();
    if (call.role !== "cgame" || this.files === null || this.scripts === null || this.collision === null || this.marks === null) return rejectQvmSyscall(call);
    if (call.kind === "engine") switch (call.code) {
      case QvmCgameImport.CG_S_STARTBACKGROUNDTRACK:
      case QvmCgameImport.CG_S_STOPBACKGROUNDTRACK:
      case QvmCgameImport.CG_R_REMAP_SHADER:
      case QvmCgameImport.CG_CIN_PLAYCINEMATIC:
      case QvmCgameImport.CG_CIN_STOPCINEMATIC:
      case QvmCgameImport.CG_CIN_RUNCINEMATIC:
      case QvmCgameImport.CG_CIN_DRAWCINEMATIC:
      case QvmCgameImport.CG_CIN_SETEXTENTS:
        return rejectQvmSyscall(call);
    }
    const options = this.options, services = this.services;
    const commands = options.commands ?? {
      append: () => rejectQvmSyscall(call), register: () => rejectQvmSyscall(call), remove: () => rejectQvmSyscall(call), reliable: () => rejectQvmSyscall(call),
    };
    if (call.kind === "engine" && call.code === QvmCgameImport.CG_UPDATESCREEN)
      return options.nextFrame().then(() => { this.assertCurrent(); return 0; });
    if (call.kind === "engine" && call.code === QvmCgameImport.CG_GETGAMESTATE) {
      writeSourceQvmGameState(call.guest, call.guest.view(call.words.getInt32(4, true), QVM_GAME_STATE_BYTES), this.context().gameState); return 0;
    }
    return qvmCommonSyscall(call, { role: "cgame", cvars: this.cvars, print: options.print, milliseconds: options.clock.now, arguments: () => this.core?.arguments ?? [], commands })
      ?? qvmFileSyscall(call, this.files)
      ?? qvmClientScriptSyscall(call, this.scripts)
      ?? qvmClientRenderSyscall(call, services.resources, services.draw)
      ?? qvmClientAudioSyscall(call, { role: "cgame", sound: services.sound, print: options.print })
      ?? qvmClientCollisionSyscall(call, { models: () => {
        if (this.collision === null) throw new Error("Component collision owner is closed"); return this.collision;
      }, loadMap: path => {
        this.assertCurrent(); if (path !== options.assets.content.recipe.map.geometry.requestedPath) throw new Error(`Component requested a different collision map: ${path}`);
      } })
      ?? qvmClientMarkSyscall(call, this.marks)
      ?? options.scalar?.(call, this)
      ?? (call.kind === "engine" && call.code === QvmCgameImport.CG_MEMORY_REMAINING ? Math.min(0x7fffffff, freemem()) : rejectQvmSyscall(call));
  }
  private flushAudio(): void {
    if (this.audioOperations.length === 0) return;
    this.assertCurrent();
    this.options.audio.receiveCgameFrame({ content: this.options.source.identity.source.content, seat: this.options.seat,
      owner: this.options.source.prepared.source.id, operations: this.audioOperations.splice(0) });
  }
  async consume(event: Q3SourcePlayerEvent, sequence: number): Promise<void> {
    this.assertCurrent(); if (this.core === null) throw new Error("Component presentation has not initialized");
    try {
      await this.core.consume(event, sequence);
      this.assertCurrent();
      if (this.options.source.source.live(event.actor)) this.flushAudio(); else this.audioOperations.length = 0;
    } catch (error) {
      this.audioOperations.length = 0;
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation execution and cleanup failed"); }
      throw error;
    }
  }
  async frame(sequence: number): Promise<Q3SceneContent> {
    this.assertCurrent();
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid component presentation frame sequence");
    if (sequence <= this.frameSequence && this.captured !== null) return this.captured;
    if (this.core === null) throw new Error("Component presentation has not initialized");
    try {
      const context = this.context(), time = context.timeMilliseconds ?? context.snapshot.serverTime;
      await this.core.advance(sequence);
      this.assertCurrent();
      const scene = this.services.scene.capture();
      this.services.scene.clearScene();
      await this.renderer.preload([scene]);
      this.assertCurrent(); this.flushAudio();
      this.previousFrameTime = time; this.frameSequence = sequence; this.captured = scene;
      return scene;
    } catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation frame and cleanup failed"); }
      throw error;
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.audioOperations.length = 0;
    const failures: unknown[] = [];
    for (const cleanup of [() => this.core?.close(), () => this.files?.closeAll(), () => this.scripts?.closeAll(), () => this.globals.clear(),
      () => this.servicesValue?.cinematics.close(), () => this.rendererValue?.close(), () => this.mediaValue?.bank.bank.clear(), () => this.mediaValue?.close(),
      () => this.options.audio.receiveCgameFrame({ content: this.options.source.identity.source.content, seat: this.options.seat,
        owner: this.options.source.prepared.source.id, operations: [{ kind: "release-owner" }] })]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    this.core = null; this.files = null; this.scripts = null; this.servicesValue = null; this.mediaValue = null; this.collision = null; this.marks = null;
    this.rendererValue = null; this.captured = null;
    if (failures.length !== 0) throw new AggregateError(failures, "Component presentation cleanup failed");
  }
}
