import { prepareDebugShapes } from "../../render/scene/debug-shapes.ts";
import type { DebugShapePresentationAccess } from "./simulation/types.ts";
import { createSourceSceneOrder } from "../../render/scene/submissions.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import { Q1MessageLocalization } from "./q1-localization.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { WorldText } from "../../text/world.ts";
import { prepareWorldText } from "../../render/scene/world-text.ts";
import { loadMenuFont } from "./menu-font.ts";
import { weaponViewCamera } from "./weapon-view.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { ApplicationWorldScene } from "./presentation-scene.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Rect, RendererBackend, RenderFrame, SceneCamera } from "../../contracts/render.ts";
import type { SeatClientState, SeatPresentation, SimulationEvent, WorldSnapshot } from "../../contracts/session.ts";
import type { Q3CharacterAssets, Q3CharacterView } from "../../content/q3/foundation/index.ts";
import { anglesToAxis } from "../../core/math.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import { consoleMetrics } from "../../console/metrics.ts";
import { drawConsole } from "../../console/draw.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { prepareMaterialText } from "../../render/commands/material2d.ts";
import { perspectiveProjection } from "../../render/scene/view.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import { SeatTextPresentation } from "../../text/layout.ts";
import { Draw2D, TextCommandSink } from "../../text/draw2d.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { ApplicationAssets, PreparedApplicationImages, PreparedApplicationImageBinding } from "./assets.ts";
import type { ApplicationEffects } from "./effects.ts";
import { SourceFinale } from "./finale.ts";
import type { LocalInput } from "./input.ts";
import type { NativeRenderer } from "./renderer.ts";
import type { PlayerView, SimulationPresentation, SimulationPresentationAccess, SimulationPresentationEvent } from "./simulation/types.ts";
import type { ApplicationSeatUi } from "./ui.ts";
import type { ApplicationQ3Client } from "./q3-client.ts";
import type { ApplicationRereleasePresentation } from "./rerelease-presentation.ts";

/** Viewport ownership is independent of the simulation actor and renderer. */
export function seatViewport(index: number, count: number, width: number, height: number): Rect {
  if (!Number.isInteger(index) || index < 0 || index >= count || count < 1 || count > 4) throw new RangeError("Invalid local seat layout");
  if (count === 1) return { x: 0, y: 0, width, height };
  const columns = count === 2 ? 1 : 2, rows = 2;
  const column = index % columns, row = Math.trunc(index / columns);
  const x = Math.trunc(column * width / columns), y = Math.trunc(row * height / rows);
  return { x, y, width: Math.trunc((column + 1) * width / columns) - x, height: Math.trunc((row + 1) * height / rows) - y };
}

export function cameraWithKick(camera: SceneCamera, kick: Vec3): SceneCamera {
  if (kick.x === 0 && kick.y === 0 && kick.z === 0) return camera;
  const local = anglesToAxis(kick), axis = camera.axis;
  const rotate = (v: Vec3): Vec3 => ({ x: axis[0].x * v.x + axis[1].x * v.y + axis[2].x * v.z,
    y: axis[0].y * v.x + axis[1].y * v.y + axis[2].y * v.z, z: axis[0].z * v.x + axis[1].z * v.y + axis[2].z * v.z });
  return { ...camera, axis: [rotate(local[0]), rotate(local[1]), rotate(local[2])] };
}

export function cameraWithCharacterDeath(camera: SceneCamera, player: PlayerView): SceneCamera {
  return player.foreignCharacterDeath === true && camera.clip.kind === "none" ? { ...camera,
    origin: { ...player.origin, z: player.origin.z + player.viewHeight }, axis: anglesToAxis(player.angles) } : camera;
}

export class WorldSeatPresentation implements SeatPresentation {
  private readonly q1Messages: Q1MessageLocalization;
  private readonly pendingMessages: { readonly text: string; readonly sourcePresentationSequence: number | undefined }[] = [];
  private readonly pendingQ1Messages: Extract<SimulationPresentationEvent, { readonly kind: "q1" }>[] = [];
  private readonly pendingQ2Messages: Extract<SimulationPresentationEvent, { readonly kind: "q2" | "q2-player" }>[] = [];
  private readonly frames: SceneFrameBuilder;
  private readonly text: SeatTextPresentation;
  private readonly finale: SourceFinale;
  private preparedTime = 0;
  private worldText: readonly WorldText[] = [];
  private readonly worldFonts = new Map<ContentId, Awaited<ReturnType<typeof loadMenuFont>>>();
  private readonly scene: ApplicationWorldScene;

  constructor(readonly local: LocalInput, readonly assets: ApplicationAssets, private readonly native: NativeRenderer,
    private readonly simulation: Pick<SimulationPresentationAccess, "playerView" | "worldText">, private readonly seatCount: number,
    font: TextFontSelection, characterAssets: Q3CharacterAssets | null, readonly ui: ApplicationSeatUi,
    private readonly effects: ApplicationEffects, readonly q3Client: ApplicationQ3Client | null = null,
    private readonly rerelease: ApplicationRereleasePresentation | null = null,
    private readonly worldTextCullFactor: (() => number) | null = null,
    private readonly fieldOfView: () => number = () => 90,
    private readonly debugShapes: DebugShapePresentationAccess | null = null,
    private readonly consoleScale: () => number = () => 0) {
    this.q1Messages = new Q1MessageLocalization(local.player.seat.id, assets, () => this.rerelease?.selectedLanguage(local.player.seat.id) ?? "english");
    this.scene = new ApplicationWorldScene(assets, characterAssets);
    this.frames = new SceneFrameBuilder(assets.images);
    this.text = new SeatTextPresentation(local.player.seat.id, font);
    this.finale = new SourceFinale(assets, this.text, this.q1Messages);
  }

  get viewport(): Rect { const size = this.native.window.drawableSize; return seatViewport(this.local.player.seat.id.index, this.seatCount, size.width, size.height); }

  async prepareImageRefresh(images: PreparedApplicationImages): Promise<PreparedApplicationImageBinding> {
    const { font, typography } = images;
    const replacements = new Map<ContentId, Awaited<ReturnType<typeof loadMenuFont>>>();
    try {
      for (const content of this.worldFonts.keys()) {
        const provider = await images.provider(content);
        replacements.set(content, await loadMenuFont({ catalog: this.assets.content.catalog, mounts: provider.mounts, family: provider.family,
          rerelease: this.assets.content.catalog.product(content).expectation.edition === "rerelease", images: this.assets.images,
          imagePolicy: images.policy }));
      }
      const hud = await this.ui.prepareImageRefresh(images);
      return { commit: () => {
        this.text.font = font; this.ui.refreshImages(font, typography); hud();
        for (const font of this.worldFonts.values()) font.close();
        this.worldFonts.clear(); for (const [content, font] of replacements) this.worldFonts.set(content, font);
      }, discard: () => { for (const font of replacements.values()) font.close(); } };
    } catch (error) { for (const font of replacements.values()) font.close(); throw error; }
  }

  get state(): SeatClientState {
    const seat = this.local.player.seat.id, client = this.local.player.seat.client.id, viewport = this.viewport;
    return { seat, client, actor: { kind: "player", actor: this.local.player.actor },
      ui: { ...this.ui.controller.state(), focus: this.local.input.focus, ...this.ui.messages.active(this.preparedTime * 1000), showScores: this.local.input.button("scores").active },
      presentation: { seat, client, viewport, safeArea: viewport, hudScale: 1, presentation: this.assets.content.recipe.presentation } };
  }

  camera(): SceneCamera {
    if (this.q3Client?.options.kind === "qvm") return this.q3Client.camera();
    const player = this.simulation.playerView(this.local.player.actor), viewport = this.viewport;
    if (this.q3Client !== null) return cameraWithKick((this.q3Client.cvars.get("cg_thirdPerson")?.integerValue ?? 0) !== 0 ? this.q3Client.camera()
      : cameraWithCharacterDeath(this.q3Client.camera(), player), player.kickAngles ?? { x: 0, y: 0, z: 0 });
    const fovX = player.fieldOfView ?? this.fieldOfView(), fovY = Math.atan(viewport.height / viewport.width * Math.tan(fovX * Math.PI / 360)) * 360 / Math.PI;
    const camera: SceneCamera = { origin: { ...player.origin, z: player.origin.z + player.viewHeight }, axis: anglesToAxis(player.angles), viewport,
      projection: perspectiveProjection(fovX, fovY, 16384), clip: { kind: "none" } };
    return this.effects.playerView(this.local.player.actor, cameraWithKick(camera, player.kickAngles ?? { x: 0, y: 0, z: 0 })).camera;
  }

  receive(events: readonly SimulationEvent[]): undefined {
    for (const event of events) if (event.payload.kind === "message") {
      const message = event.payload.event;
      if ("text" in message && typeof message.text === "string") this.pendingMessages.push({ text: message.text, sourcePresentationSequence: event.payload.sourcePresentationSequence });
    }
    return undefined;
  }

  sourceEvents(events: readonly SimulationPresentationEvent[]): void {
    for (const source of events) if (source.kind === "q1" && source.event.kind === "message" && source.event.player.equals(this.local.player.actor)) this.pendingQ1Messages.push(source);
    if (this.q3Client !== null) {
      for (const source of events) if (source.kind === "view-reset" && source.actor.equals(this.local.player.actor)) this.local.builder.setViewAngles(source.angles);
      return;
    }
    this.scene.receive(events);
    this.ui.receive(events.filter(source => source.kind !== "q1" || source.event.kind !== "message")
      .filter(source => source.kind !== "q2" || !["help", "pickup", "print", "centerprint"].includes(source.event.kind))
      .filter(source => source.kind !== "q2-player" || source.event.kind !== "print"));
    this.finale.receive(events);
    const owns = (actor: ActorId): boolean => actor.equals(this.local.player.actor);
    for (const source of events) {
      if (source.kind === "view-reset") {
        if (owns(source.actor)) this.local.builder.setViewAngles(source.angles);
      } else if (source.kind === "q1") {
        const event = source.event;
        if (event.kind === "teleport-player" && owns(event.player)) this.local.builder.setViewAngles(event.angles);
      } else if (source.kind === "q2") {
        if (["help", "pickup", "print", "centerprint"].includes(source.event.kind)) this.pendingQ2Messages.push(source);
      } else if (source.kind === "q2-player") {
        if (source.event.kind === "print") this.pendingQ2Messages.push(source);
      } else if (source.kind === "q3-source" && source.event.kind === "server-command"
        && (source.event.client < 0 || source.event.client === this.local.player.seat.client.id.slot)) {
        const [command, text] = tokenizeCommand(source.event.text, "q3").argv;
        if ((command === "print" || command === "chat" || command === "tchat") && text !== undefined) this.local.console.print(text);
      }
    }
  }

  async prepare(snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[]): Promise<void> {
    const q1Messages = this.pendingQ1Messages.splice(0);
    const q2Messages = this.pendingQ2Messages.splice(0);
    const mirrored = new Set([...q1Messages.map(source => source.sequence), ...q2Messages.filter(source => source.kind === "q2"
      && (source.event.kind === "help" || source.event.kind === "centerprint" && source.event.actor.equals(this.local.player.actor))).map(source => source.sequence)]);
    for (const message of this.pendingMessages.splice(0)) {
      if (message.sourcePresentationSequence === undefined || !mirrored.has(message.sourcePresentationSequence)) this.local.console.print(`${message.text}\n`);
    }
    for (const source of q1Messages) {
      const event = source.event;
      if (event.kind !== "message") continue;
      const text = await this.q1Messages.resolve(source.content, event.text, event.args ?? [], event.parts);
      if (!event.center) this.local.console.print(`${text}\n`);
      this.ui.receive([{ ...source, event: { ...event, text } }]);
    }
    for (const source of q2Messages) {
      const resolve = (text: string): Promise<string> => this.rerelease?.localizeMessage(this.local.player.seat.id, source.content, text) ?? Promise.resolve(text);
      const owns = (actor: ActorId): boolean => actor.equals(this.local.player.actor);
      if (source.kind === "q2") {
        const event = source.event;
        if (event.kind === "pickup" && owns(event.player)) this.local.console.print(`${await resolve(event.name)}\n`);
        else if (event.kind === "help" || event.kind === "print" && (event.actor === null || owns(event.actor)) || event.kind === "centerprint" && owns(event.actor)) {
          const text = await resolve(event.text);
          if (event.kind !== "centerprint") this.local.console.print(event.kind === "help" ? `${text}\n` : text);
          this.ui.receive([{ ...source, event: { ...event, text } }]);
        }
      } else if (source.event.kind === "print" && (source.event.target === null || owns(source.event.target))) {
        const text = await resolve(source.event.text);
        this.local.console.print(text);
        this.ui.receive([{ ...source, event: { ...source.event, text } }]);
      }
    }
    await this.ui.prepare(this.assets);
    this.worldText = this.simulation.worldText();
    for (const text of this.worldText) if (!this.worldFonts.has(text.content)) {
      const provider = await this.assets.provider(text.content);
      this.worldFonts.set(text.content, await loadMenuFont({ catalog: this.assets.content.catalog, mounts: provider.mounts, family: provider.family,
        rerelease: this.assets.content.catalog.product(text.content).expectation.edition === "rerelease", images: this.assets.images,
        ...(this.assets.imagePolicy === undefined ? {} : { imagePolicy: this.assets.imagePolicy }) }));
    }
    this.preparedTime = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    if (this.q3Client !== null) { await this.q3Client.prepare(snapshot.frame.frame, this.viewport, presentations); return; }
    await this.finale.prepare();
    await this.scene.prepare(this.local.player.actor, snapshot, presentations, characters);
  }

  frame(snapshot: WorldSnapshot): RenderFrame {
    const time = snapshot.frame.time, camera = this.camera(), source = this.q3Client === null ? createSourceSceneOrder(this.assets.materialRegistrations) : null,
      effects = source === null ? null : this.effects.frame(camera, source, this.local.player.actor);
    const playerView = this.effects.playerView(this.local.player.actor, camera);
    const style = (index: number, absent: number): number => this.scene.style(index, absent);
    const input: WorldViewInput = { ...(source === null ? {} : { source: createWorldSurfaceAdmission(source) }), camera, target: { kind: "seat", seat: this.local.player.seat.id }, time,
      ...this.rerelease?.view(this.local.player.actor, this.preparedTime),
      clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false },
      lights: effects?.lights ?? [], q3Lights: effects?.q3Lights ?? [],
      ...this.scene.styles() };
    const nativeFrame = this.q3Client?.frame((camera, source) => this.effects.frame(camera, source, this.local.player.actor), camera => {
      if (this.q3Client?.options.kind === "qvm") return camera;
      const player = this.simulation.playerView(this.local.player.actor);
      return cameraWithKick((this.q3Client?.cvars.get("cg_thirdPerson")?.integerValue ?? 0) !== 0 ? camera : cameraWithCharacterDeath(camera, player), player.kickAngles ?? { x: 0, y: 0, z: 0 });
    });
    this.frames.begin();
    if (nativeFrame === undefined) {
      if (effects === null) throw new Error("Shared view lost its prepared effects");
      this.frames.world(this.scene.view(input, effects.operations,
        this.effects.shadowSceneLights(camera, index => style(index, 12) / 12), playerView.infrared,
        weaponViewCamera(camera, this.ui.weaponOcclusion({ binding: this.state.presentation, timeMilliseconds: this.preparedTime * 1000 }, !this.finale.active))));
    } else for (const command of nativeFrame.commands) {
      if (command.kind === "swap-buffers") throw new Error("Cgame cannot present the shared framebuffer");
      this.frames.command(command);
    }
    const debugLines = this.debugShapes?.lines();
    if (debugLines !== undefined && debugLines.length > 0) this.frames.view({ target: input.target, time, viewport: camera.viewport, clear: null, clipPlane: null,
      beforeView: [], operations: [{ kind: "draw", batches: prepareDebugShapes(debugLines, camera, this.assets.world.shaders.textures.white.image, this.debugShapes?.lineWidth()) }] });
    if (this.worldText.length > 0) this.frames.view({ target: input.target, time, viewport: camera.viewport, clear: null, clipPlane: null,
      beforeView: [], operations: [{ kind: "draw", batches: prepareWorldText(this.worldText, camera, text => {
        const font = this.worldFonts.get(text.content);
        if (font === undefined) throw new Error("World text font was not prepared");
        return font.font;
      }, this.worldTextCullFactor?.()) }] });
    const material = (draw: Parameters<typeof prepareMaterialText>[0]): void => {
      this.frames.view({ target: { kind: "seat", seat: this.local.player.seat.id }, time, viewport: camera.viewport, clear: null, clipPlane: null,
        beforeView: [], operations: [{ kind: "draw", batches: prepareMaterialText(draw, camera.viewport, this.assets.world.materialContext(input)) }] });
    };
    const draw = new Draw2D(new TextCommandSink(this.local.player.seat.id, camera.viewport, command => {
      if (command.kind === "swap-buffers") throw new Error("Text cannot present a frame");
      this.frames.command(command);
    }, material), "pixels");
    if (this.q3Client === null && playerView.blend !== null) draw.fillRect({ x: 0, y: 0, width: camera.viewport.width, height: camera.viewport.height },
      playerView.blend, { kind: "image", name: "white", image: this.assets.world.shaders.textures.white.image });
    this.finale.draw(draw, this.preparedTime);
    this.rerelease?.drawStory(this.local.player.actor, draw, this.text, Math.max(1, camera.viewport.height / 480));
    this.ui.draw({ binding: this.state.presentation, timeMilliseconds: this.preparedTime * 1000 }, camera, command => this.frames.command(command), material,
      !this.finale.active && (this.q3Client?.weaponHudView().visible ?? true), !(this.rerelease?.storyActive(this.local.player.actor) ?? false),
      this.q3Client !== null, this.q3Client?.weaponHudView().aggregateWarning ?? true);
    if (this.local.input.focus.kind === "console") {
      const height = Math.trunc(camera.viewport.height * 0.5);
      const logical = this.native.window.logicalSize, drawable = this.native.window.drawableSize;
      const metrics = consoleMetrics({ width: camera.viewport.width, height: camera.viewport.height,
        pixelRatio: Math.max(drawable.width / logical.width, drawable.height / logical.height),
        requestedScale: this.consoleScale(), font: this.text.font });
      const { scale, columns } = metrics;
      const white = this.assets.world.shaders.textures.white.image;
      draw.fillRect({ x: 0, y: 0, width: camera.viewport.width, height }, { x: 0, y: 0, z: 0, w: 0.85 }, { kind: "image", name: "white", image: white });
      if (this.local.console.buffer.width !== columns) this.local.console.buffer.resize(columns);
      drawConsole({ draw, text: this.text, rows: this.local.console.buffer.visible(Math.max(1, Math.trunc(height / metrics.lineHeight))),
        field: this.local.console.field, selectedEntry: this.local.console.selectedCompletionEntry,
        height, scale, cellWidth: metrics.cellWidth, nowMilliseconds: this.preparedTime * 1000, background: null });
    }
    return this.frames.finish(false);
  }

  render(frame: RenderFrame, backend: RendererBackend): undefined {
    if (backend !== this.native.backend) throw new Error("Seat presentation uses another renderer");
    return this.native.execute(frame);
  }

  close(): undefined { for (const font of this.worldFonts.values()) font.close(); this.worldFonts.clear(); this.worldText = []; this.q3Client?.close(); this.ui.close(); this.scene.close(); return undefined; }
}
