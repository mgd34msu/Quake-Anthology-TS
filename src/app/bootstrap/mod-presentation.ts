import { SaveReader, encodeCheckpointValue } from "../../persistence/value.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import { captureSceneContext, readSceneContext } from "../../compat/qvm/mod-presentation-checkpoint.ts";
import { qvmClientCinematicSyscall } from "../../compat/qvm/client-cinematic-syscalls.ts";
import { SourceClipModels } from "../../world/collision/q3/clip-models.ts";
export type { ComponentPresentationMediaRequest } from "../../contracts/presentation.ts";
import type { ComponentPresentationMediaRequest } from "../../contracts/presentation.ts";
import { samePresentationOwner } from "../../contracts/presentation.ts";
import { RDF_NOWORLDMODEL } from "../../content/q3/presentation/refdef.ts";
import { qvmDisplaySyscall, type QvmDisplayOptions } from "./q3-client/qvm-display.ts";
import type { Q3OverlaySubmission } from "./q3-client/overlay.ts";
import { freemem } from "node:os";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { Rect } from "../../contracts/render.ts";
import type { Axis, Vec3 } from "../../contracts/math.ts";
import { QvmCgameImport } from "../../compat/qvm/abi.ts";
import { QvmModPresentation, type QvmSceneContext } from "../../compat/qvm/mod-presentation.ts";
import { qvmCommonSyscall } from "../../compat/qvm/common-syscalls.ts";
import type { QvmCommonServices } from "../../compat/qvm/common-syscalls.ts";
import { QvmFiles, qvmFileSyscall } from "../../compat/qvm/file-syscalls.ts";
import { qvmClientAudioSyscall } from "../../compat/qvm/client-audio-syscalls.ts";
import { qvmClientRenderSyscall } from "../../compat/qvm/client-render-syscalls.ts";
import { qvmClientCollisionSyscall } from "../../compat/qvm/client-collision-syscalls.ts";
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
import type { ActiveModPresentation } from "../../world/session/mod-presentations.ts";
import { selectComponentScene } from "./component-scene.ts";
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
  readonly renderer?: QvmDisplayOptions["renderer"];
  readonly source: ActiveModPresentation;
  readonly clock: ApplicationQ3ServiceOptions["clock"];
  readonly output: Omit<ApplicationQ3ServiceOptions["output"], "audio">;
  readonly systemCinematics?: NonNullable<ApplicationQ3ServiceOptions["systemCinematics"]>
    | ((owner: Pick<ApplicationModPresentation, "cvars" | "fileMounts">) => NonNullable<ApplicationQ3ServiceOptions["systemCinematics"]>);
  readonly commands?: Extract<QvmCommonServices, { readonly role: "cgame" }>["commands"];
  presentationMedia?(request: ComponentPresentationMediaRequest, initializing: boolean, current: () => boolean): Promise<void>;
  print(text: string): void;
  viewOrigin(): Vec3;
  viewAxis?(): Axis;
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
  private pendingHud: Q3OverlaySubmission[] = [];
  private hudColor = { x: 1, y: 1, z: 1, w: 1 };
  private capturedHud: readonly Q3OverlaySubmission[] = [];
  get hud(): readonly Q3OverlaySubmission[] { this.assertCurrent(); return this.capturedHud; }
  private published = true;
  private operations = 0;
  private commandsPublished = true;
  private frameSequence = -1;
  private frameOffset = 0;
  private millisecondsOffset = 0;
  private readonly registeredCommands = new Set<string>();
  private previousFrameTime: number | null = null;
  private files: QvmFiles | null = null;
  private scripts: QvmClientScripts | null = null;
  private collision: SourceClipModels | SharedQvmClientClipModels | null = null;
  private marks: ReturnType<typeof worldMarkProjector> | null = null;
  private closed = false;
  private initializing = true;
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
  get fileMounts() { this.assertCurrent(); return this.options.source.source.files?.()?.mounts ?? this.media.provider.mounts; }
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
      && samePresentationOwner(source.owner, this.options.source.owner)
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
      const publication = context.scene === undefined ? this.options.source.source.scene?.() : undefined;
      if (context.scene === undefined && publication === undefined) throw new Error("Scene cgame requires an admitted gameplay entity snapshot source");
      if (context.scene !== undefined) this.sceneContext = context.scene;
      else if (publication !== undefined && this.sceneContext?.revision !== publication.current.revision) {
        if (this.sceneBaseline === undefined && publication.baseline !== null) this.sceneBaseline = selectComponentScene(publication.baseline, this.options.viewer, this.options.queries, this.options.assets.world.map.leaves.length, this.options.print);
        this.sceneContext = { ...selectComponentScene(publication.current, this.options.viewer, this.options.queries, this.options.assets.world.map.leaves.length, this.options.print), ...(this.sceneBaseline === undefined ? {} : { baseline: this.sceneBaseline }) };
      }
      if (this.sceneContext === null) throw new Error("Component scene context is unavailable");
      const serverTime = this.sceneContext.snapshot.serverTime;
      this.sceneTimeOffset ??= serverTime - this.options.clock.now();
      const timeMilliseconds = Math.trunc(Math.max(serverTime, this.previousFrameTime ?? serverTime,
        this.options.clock.now() + this.sceneTimeOffset));
      return { ...context, timeMilliseconds, frameTimeMilliseconds: this.previousFrameTime === null ? 0 : timeMilliseconds - this.previousFrameTime,
        viewOrigin: this.options.viewOrigin(), ...(this.options.viewAxis === undefined ? {} : { viewAxis: this.options.viewAxis() }), scene: this.sceneContext };
    }
    return { ...context, frameTimeMilliseconds, viewOrigin: this.options.viewOrigin(), ...(this.options.viewAxis === undefined ? {} : { viewAxis: this.options.viewAxis() }) };
  }
  captureCheckpoint() {
    this.assertCurrent();
    if (this.initializing || this.operations !== 0 || this.core === null || this.files === null || this.scripts === null || this.collision === null
      || this.audioOperations.length !== 0 || this.pendingHud.length !== 0) throw new Error("Component checkpoint requires an idle completed frame");
    const profile = this.options.source.prepared.declaration.cgame.abiProfile;
    return { version: 1, declaration: this.options.source.prepared.declaration, core: this.core.captureCheckpoint(),
      cvars: this.cvars.captureSaveState(), files: this.files.captureCheckpoint(), scripts: this.scripts.captureCheckpoint(),
      resources: this.services.resources.captureCheckpoint(), sounds: this.media.bank.captureCheckpoint(), fonts: this.media.fonts.captureCheckpoint(),
      collision: this.collision.captureTemporaryCheckpoint(), cinematics: this.services.cinematics.captureCheckpoint(),
      commands: [...this.registeredCommands], frameSequence: this.frameSequence, frameOrdinal: this.options.clock.frameNumber() + this.frameOffset, previousFrameTime: this.previousFrameTime,
      milliseconds: this.options.clock.now() + this.millisecondsOffset, sceneTime: this.sceneTimeOffset === null ? null : this.options.clock.now() + this.sceneTimeOffset,
      hudColor: { ...this.hudColor }, sceneContext: this.sceneContext === null ? null : captureSceneContext(this.sceneContext, profile),
      sceneBaseline: this.sceneBaseline === undefined ? null : captureSceneContext(this.sceneBaseline, profile) };
  }
  static restore(options: ApplicationModPresentationOptions, value: unknown, resolveActor: (saved: SavedActorId) => ActorId): Promise<ApplicationModPresentation> {
    return ApplicationModPresentation.createOwner(options, -1, { value, resolveActor });
  }
  static create(options: ApplicationModPresentationOptions, baselineSequence = -1): Promise<ApplicationModPresentation> {
    return ApplicationModPresentation.createOwner(options, baselineSequence);
  }
  private static async createOwner(options: ApplicationModPresentationOptions, baselineSequence: number,
    checkpoint?: { readonly value: unknown; resolveActor(saved: SavedActorId): ActorId }): Promise<ApplicationModPresentation> {
    const owner = new ApplicationModPresentation(options);
    if (checkpoint !== undefined) owner.published = false;
    try {
      if (options.source.prepared.declaration.runtime === "qvm-scene") for (const variable of options.source.prepared.declaration.cvars)
        owner.cvars.set(variable.name, variable.value);
      owner.mediaValue = await ApplicationQ3Assets.create(options.assets, options.source.identity.source.content, options.print, () => false, "guest-async", "source");
      owner.assertCurrent();
      const collisionSettings = new CollisionMapSettings(owner.cvars); collisionSettings.registerMap();
      const nativeCollision = options.queries.nativeQ3ClipModels();
      owner.collision = nativeCollision === null ? new SharedQvmClientClipModels(options.queries, owner.cvars) : new SourceClipModels(nativeCollision.world, "private");
      owner.marks = worldMarkProjector(options.assets.world);
      owner.servicesValue = await createApplicationQ3Services({ collisionSettings, media: owner.media, audio: options.audio,
        owner: options.source.prepared.source.id, resourceHandles: "client",
        ...(options.systemCinematics === undefined ? {} : { systemCinematics: typeof options.systemCinematics === "function" ? options.systemCinematics(owner) : options.systemCinematics }), seat: options.seat, viewport: options.viewport, queries: options.queries,
        actorAt: slot => {
          owner.assertCurrent(); const actor = options.source.source.actor(slot);
          if (actor === null) throw new Error(`Component sound source slot ${slot} has no live actor`);
          return actor;
        }, clock: { now: () => options.clock.now() + owner.millisecondsOffset, frameNumber: options.clock.frameNumber }, output: {
          scene: scene => {
            owner.assertCurrent();
            if (options.source.prepared.declaration.hud === undefined) { options.output.scene(scene); return; }
            if ((scene.source.renderFlags & RDF_NOWORLDMODEL) === 0) throw new Error("Component HUD cannot replace the world view");
            owner.pendingHud.push({ kind: "scene", scene });
          },
          command: command => {
            owner.assertCurrent();
            if (options.source.prepared.declaration.hud === undefined) { options.output.command(command); return; }
            if (command.kind !== "set-color" && command.kind !== "stretch-pic") throw new Error("Component HUD cannot control the framebuffer");
            if (command.kind === "set-color") owner.hudColor = command.color;
            else owner.pendingHud.push({ kind: "command", command: { kind: "set-color", color: owner.hudColor } });
            owner.pendingHud.push({ kind: "command", command });
          },
          text: draw => {
            owner.assertCurrent();
            if (options.source.prepared.declaration.hud === undefined) { options.output.text(draw); return; }
            owner.pendingHud.push({ kind: "text", draw });
          },
          listener: (origin, axis) => { owner.assertCurrent(); options.output.listener(origin, axis); },
          audio: operation => { owner.assertCurrent(); owner.audioOperations.push(operation); },
        } });
      owner.assertCurrent();
      owner.rendererValue = new ApplicationQ3SceneRenderer(owner.media, owner.services.resources);
      const sourceFiles = options.source.source.files?.();
      const fileOptions = { mounts: sourceFiles?.mounts ?? owner.media.provider.mounts, writable: sourceFiles?.writable ?? null,
        print: options.print, assertCurrent: () => owner.assertCurrent() };
      owner.files = new QvmFiles(fileOptions);
      owner.scripts = new QvmClientScripts({ ...fileOptions, globals: owner.globals });
      owner.core = new QvmModPresentation({ ...options.source.prepared, host: call => owner.host(call), context: () => owner.context(),
        actor: slot => options.source.source.actor(slot), live: actor => options.source.source.live(actor), assertCurrent: () => owner.assertCurrent() });
      if (checkpoint === undefined) await owner.core.initialize(baselineSequence);
      else await owner.restoreOwned(checkpoint.value, checkpoint.resolveActor);
      owner.assertCurrent(); owner.initializing = false; owner.services.scene.clearScene(); owner.pendingHud = []; owner.flushAudio(); return owner;
    } catch (error) {
      try { owner.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation initialization and cleanup failed"); }
      throw error;
    }
  }
  private async restoreOwned(value: unknown, resolveActor: (saved: SavedActorId) => ActorId): Promise<void> {
    if (this.core === null || this.files === null || this.scripts === null || this.collision === null) throw new Error("Component host is not allocated");
    this.commandsPublished = false;
    const r = new SaveReader(value, "component-presentation"); r.field("version").literal(1);
    if (!Buffer.from(encodeCheckpointValue(r.field("declaration").value)).equals(Buffer.from(encodeCheckpointValue(this.options.source.prepared.declaration))))
      r.fail("component declaration changed");
    const profile = this.options.source.prepared.declaration.cgame.abiProfile;
    this.frameSequence = r.field("frameSequence").integer(-1);
    this.frameOffset = r.field("frameOrdinal").integer(0) - this.options.clock.frameNumber();
    this.previousFrameTime = r.field("previousFrameTime").nullable(v => v.integer(0));
    this.millisecondsOffset = r.field("milliseconds").finite() - this.options.clock.now();
    this.sceneTimeOffset = r.field("sceneTime").nullable(v => v.finite() - this.options.clock.now());
    const color = r.field("hudColor");
    this.hudColor = { x: color.field("x").number(), y: color.field("y").number(), z: color.field("z").number(), w: color.field("w").number() };
    this.sceneContext = r.field("sceneContext").nullable(v => readSceneContext(v, profile, resolveActor));
    this.sceneBaseline = r.field("sceneBaseline").nullable(v => readSceneContext(v, profile, resolveActor)) ?? undefined;
    this.cvars.restoreSaveState(r.field("cvars").value);
    await this.media.fonts.restoreCheckpoint(r.field("fonts").value); this.assertCurrent();
    await this.services.resources.restoreCheckpoint(r.field("resources").value); this.assertCurrent();
    await this.media.bank.restoreCheckpoint(r.field("sounds").value); this.assertCurrent();
    this.files.restoreCheckpoint(r.field("files").value);
    this.scripts.restoreCheckpoint(r.field("scripts").value);
    this.collision.restoreTemporaryCheckpoint(r.field("collision").value);
    await this.services.cinematics.restoreCheckpoint(r.field("cinematics").value); this.assertCurrent();
    this.core.restoreCheckpoint(r.field("core").value, resolveActor);
    const commands = r.field("commands").list(v => v.string());
    if (commands.length !== new Set(commands).size) r.fail("duplicate component command registration");
    for (const name of commands) this.registeredCommands.add(name);
  }
  /** Bind saved command registrations only when the prepared consumer is published. */
  publishCommands(): void {
    this.assertCurrent();
    if (this.initializing) throw new Error("Cannot publish an initializing component");
    if (this.commandsPublished) return;
    if (this.options.commands === undefined && this.registeredCommands.size !== 0) throw new Error("Restored component commands have no destination registry");
    for (const name of this.registeredCommands) this.options.commands?.register(name);
    this.commandsPublished = true; this.published = true;
    this.services.cinematics.publishRestored();
  }
  private host(call: QvmHostCall): QvmHostResult {
    this.assertCurrent();
    if (call.role !== "cgame" || this.files === null || this.scripts === null || this.collision === null || this.marks === null) return rejectQvmSyscall(call);
    if (call.kind === "engine") switch (call.code) {
      case QvmCgameImport.CG_S_STARTBACKGROUNDTRACK:
      case QvmCgameImport.CG_S_STOPBACKGROUNDTRACK: {
        const deliver = this.options.presentationMedia;
        if (deliver === undefined) return rejectQvmSyscall(call);
        const path = (offset: number): string => { const pointer = call.words.getInt32(offset, true); return pointer === 0 ? "" : call.guest.readString(pointer); };
        const request: ComponentPresentationMediaRequest = call.code === QvmCgameImport.CG_S_STOPBACKGROUNDTRACK
          ? { kind: "music-stop" } : { kind: "music", intro: path(4), loop: path(8) };
        return deliver(request, this.initializing, () => this.owns(this.options.source, this.options.viewer)).then(() => { this.assertCurrent(); return 0; });
      }
      case QvmCgameImport.CG_R_REMAP_SHADER: {
        const deliver = this.options.presentationMedia;
        if (deliver === undefined) return rejectQvmSyscall(call);
        const read = (offset: number): string => call.guest.readString(call.words.getInt32(offset, true));
        const offset = Number.parseFloat(read(12));
        return deliver({ kind: "shader-remap", original: read(4), replacement: read(8), timeOffset: Number.isNaN(offset) ? 0 : offset }, this.initializing, () => this.owns(this.options.source, this.options.viewer))
          .then(() => { this.assertCurrent(); return 0; });
      }
    }
    const options = this.options, services = this.services;
    const commandHost = options.commands ?? {
      append: () => rejectQvmSyscall(call), register: () => rejectQvmSyscall(call), remove: () => rejectQvmSyscall(call), reliable: () => rejectQvmSyscall(call),
    };
    const commands = { append: commandHost.append, reliable: commandHost.reliable,
      register: (name: string) => { commandHost.register(name); this.registeredCommands.add(name); },
      remove: (name: string) => { commandHost.remove(name); this.registeredCommands.delete(name); } };
    if (call.kind === "engine" && call.code === QvmCgameImport.CG_UPDATESCREEN)
      return options.nextFrame().then(() => { this.assertCurrent(); return 0; });
    if (call.kind === "engine" && call.code === QvmCgameImport.CG_GETGAMESTATE) {
      writeSourceQvmGameState(call.guest, call.guest.view(call.words.getInt32(4, true), QVM_GAME_STATE_BYTES), this.context().gameState); return 0;
    }
    return qvmCommonSyscall(call, { role: "cgame", cvars: this.cvars, print: options.print, milliseconds: () => options.clock.now() + this.millisecondsOffset, arguments: () => this.core?.arguments ?? [], commands })
      ?? (options.renderer === undefined ? null : qvmDisplaySyscall(call, { renderer: options.renderer, media: this.media, services,
        viewport: () => options.viewport, assertCurrent: () => this.assertCurrent() }))
      ?? qvmClientCinematicSyscall(call, { cinematics: services.cinematics, draw: services.draw,
        developerPrint: text => { if ((this.cvars.get("developer")?.integerValue ?? 0) !== 0) options.print(text); } })
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
  async command(arguments_: readonly string[]): Promise<boolean> {
    if (!this.published) throw new Error("Component presentation has not been published");
    this.assertCurrent();
    if (this.core === null) throw new Error("Component presentation has not initialized");
    this.operations++;
    try {
      const result = await this.core.consoleCommand(arguments_);
      this.assertCurrent(); this.flushAudio(); return result;
    } catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component command and cleanup failed"); }
      throw error;
    } finally { this.operations--; }
  }
  async consume(event: Q3SourcePlayerEvent, sequence: number): Promise<void> {
    if (!this.published) throw new Error("Component presentation has not been published");
    this.assertCurrent(); if (this.core === null) throw new Error("Component presentation has not initialized");
    this.operations++;
    try {
      await this.core.consume(event, sequence);
      this.assertCurrent();
      if (this.options.source.source.live(event.actor)) this.flushAudio(); else this.audioOperations.length = 0;
    } catch (error) {
      this.audioOperations.length = 0;
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation execution and cleanup failed"); }
      throw error;
    } finally { this.operations--; }
  }
  async frame(sequence: number): Promise<Q3SceneContent> {
    if (!this.published) throw new Error("Component presentation has not been published");
    this.assertCurrent();
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid component presentation frame sequence");
    sequence += this.frameOffset;
    if (sequence <= this.frameSequence && this.captured !== null) return this.captured;
    if (this.core === null) throw new Error("Component presentation has not initialized");
    this.operations++;
    try {
      const context = this.context(), time = context.timeMilliseconds ?? context.snapshot.serverTime;
      await this.core.advance(sequence);
      this.assertCurrent();
      const scene = this.services.scene.capture();
      this.services.scene.clearScene();
      if (this.options.source.prepared.declaration.hud !== undefined) await this.core.drawHud(sequence);
      this.assertCurrent();
      const hud = this.pendingHud.splice(0);
      this.services.scene.clearScene();
      await this.renderer.preload([scene, ...hud.flatMap(submission => submission.kind === "scene" ? [submission.scene] : [])]);
      this.assertCurrent(); this.flushAudio();
      this.previousFrameTime = time; this.frameSequence = sequence; this.captured = scene; this.capturedHud = hud;
      return scene;
    } catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation frame and cleanup failed"); }
      throw error;
    } finally { this.operations--; }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.audioOperations.length = 0; this.pendingHud = []; this.capturedHud = [];
    const failures: unknown[] = [];
    for (const cleanup of [() => this.core?.close(), () => this.files?.closeAll(), () => this.scripts?.closeAll(), () => this.globals.clear(),
      () => this.servicesValue?.cinematics.close(), () => this.rendererValue?.close(), () => this.mediaValue?.bank.bank.clear(), () => this.mediaValue?.close(),
      () => { if (this.published) this.options.audio.receiveCgameFrame({ content: this.options.source.identity.source.content, seat: this.options.seat,
        owner: this.options.source.prepared.source.id, operations: [{ kind: "release-owner" }] }); }]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    this.core = null; this.files = null; this.scripts = null; this.servicesValue = null; this.mediaValue = null; this.collision = null; this.marks = null;
    this.rendererValue = null; this.captured = null;
    if (failures.length !== 0) throw new AggregateError(failures, "Component presentation cleanup failed");
  }
}
