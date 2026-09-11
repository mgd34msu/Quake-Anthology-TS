import type { ContentId } from "../../contracts/content.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Rect, RendererBackend, RenderFrame, SceneCamera } from "../../contracts/render.ts";
import type { SceneEntity } from "../../contracts/scene.ts";
import type { SeatClientState, SeatPresentation, SimulationEvent, WorldSnapshot } from "../../contracts/session.ts";
import type { Q3CharacterAssets, Q3CharacterView } from "../../content/q3/foundation/index.ts";
import { Q3CharacterPresenter } from "../../content/q3/foundation/index.ts";
import { anglesToAxis } from "../../core/math.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import { drawConsole } from "../../console/draw.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { prepareMaterialText } from "../../render/commands/material2d.ts";
import { perspectiveProjection } from "../../render/scene/view.ts";
import type { WorldScene, WorldViewInput } from "../../render/scene/world.ts";
import type { ModelTransform } from "../../render/scene/view.ts";
import { SceneModelRenderer } from "../../render/scene/models/index.ts";
import type { ModelSourceOptions } from "../../render/scene/models/types.ts";
import { SeatTextPresentation } from "../../text/layout.ts";
import { Draw2D, TextCommandSink } from "../../text/draw2d.ts";
import type { TextFontSelection } from "../../text/atlas.ts";
import type { ApplicationAssets } from "./assets.ts";
import type { ApplicationEffects } from "./effects.ts";
import { SourceFinale } from "./finale.ts";
import type { LocalInput } from "./input.ts";
import type { NativeRenderer } from "./renderer.ts";
import type { SimulationPresentation, SimulationPresentationAccess, SimulationPresentationEvent } from "./simulation/types.ts";
import type { ApplicationSeatUi } from "./ui.ts";
import type { ApplicationQ3Client } from "./q3-client.ts";
import type { ApplicationRereleasePresentation } from "./rerelease-presentation.ts";

interface ModelGroup {
  readonly renderer: SceneModelRenderer;
  readonly entities: SceneEntity[];
  readonly options: Map<SceneEntity, ModelSourceOptions>;
}

interface BrushPresentation {
  readonly scene: WorldScene;
  readonly model: number;
  readonly transform: ModelTransform;
  readonly frame: number;
}

/** Viewport ownership is independent of the simulation actor and renderer. */
export function seatViewport(index: number, count: number, width: number, height: number): Rect {
  if (!Number.isInteger(index) || index < 0 || index >= count || count < 1 || count > 4) throw new RangeError("Invalid local seat layout");
  if (count === 1) return { x: 0, y: 0, width, height };
  const columns = count === 2 ? 1 : 2, rows = 2;
  const column = index % columns, row = Math.trunc(index / columns);
  const x = Math.trunc(column * width / columns), y = Math.trunc(row * height / rows);
  return { x, y, width: Math.trunc((column + 1) * width / columns) - x, height: Math.trunc((row + 1) * height / rows) - y };
}

export class WorldSeatPresentation implements SeatPresentation {
  private readonly frames: SceneFrameBuilder;
  private readonly text: SeatTextPresentation;
  private readonly finale: SourceFinale;
  private readonly groups = new Map<ContentId, ModelGroup>();
  private readonly characters = new Map<string, Q3CharacterPresenter>();
  private readonly lightStyles = new Map<number, string>();
  private inlineModels: NonNullable<WorldViewInput["inlineModels"]> = [];
  private brushModels: readonly BrushPresentation[] = [];
  private preparedTime = 0;
  private previousTime = 0;

  constructor(readonly local: LocalInput, readonly assets: ApplicationAssets, private readonly native: NativeRenderer,
    private readonly simulation: Pick<SimulationPresentationAccess, "playerView">, private readonly seatCount: number,
    font: TextFontSelection, private readonly characterAssets: Q3CharacterAssets | null, readonly ui: ApplicationSeatUi,
    private readonly effects: ApplicationEffects, readonly q3Client: ApplicationQ3Client | null = null,
    private readonly rerelease: ApplicationRereleasePresentation | null = null) {
    this.frames = new SceneFrameBuilder(assets.images);
    this.text = new SeatTextPresentation(local.player.seat.id, font);
    this.finale = new SourceFinale(assets, this.text);
  }

  get viewport(): Rect { const size = this.native.window.drawableSize; return seatViewport(this.local.player.seat.id.index, this.seatCount, size.width, size.height); }

  get state(): SeatClientState {
    const seat = this.local.player.seat.id, client = this.local.player.seat.client.id, viewport = this.viewport;
    return { seat, client, actor: { kind: "player", actor: this.local.player.actor },
      ui: { ...this.ui.controller.state(), focus: this.local.input.focus, ...this.ui.messages.active(this.preparedTime * 1000), showScores: this.local.input.button("scores").active },
      presentation: { seat, client, viewport, safeArea: viewport, hudScale: 1, presentation: this.assets.content.recipe.presentation } };
  }

  camera(): SceneCamera {
    if (this.q3Client !== null) return this.q3Client.camera();
    const player = this.simulation.playerView(this.local.player.actor), viewport = this.viewport;
    const fovX = 90, fovY = Math.atan(viewport.height / viewport.width * Math.tan(fovX * Math.PI / 360)) * 360 / Math.PI;
    const camera: SceneCamera = { origin: { ...player.origin, z: player.origin.z + player.viewHeight }, axis: anglesToAxis(player.angles), viewport,
      projection: perspectiveProjection(fovX, fovY, 16384), clip: { kind: "none" } };
    return this.effects.playerView(this.local.player.actor, camera).camera;
  }

  receive(events: readonly SimulationEvent[]): undefined {
    for (const event of events) if (event.payload.kind === "message") {
      const message = event.payload.event;
      if ("text" in message && typeof message.text === "string") this.local.console.print(`${message.text}\n`);
    }
    return undefined;
  }

  sourceEvents(events: readonly SimulationPresentationEvent[]): void {
    if (this.q3Client !== null) {
      for (const source of events) if (source.kind === "view-reset" && source.actor.equals(this.local.player.actor)) this.local.builder.setViewAngles(source.angles);
      return;
    }
    this.ui.receive(events);
    this.finale.receive(events);
    const owns = (actor: ActorId): boolean => actor.equals(this.local.player.actor);
    for (const source of events) {
      if (source.kind === "view-reset") {
        if (owns(source.actor)) this.local.builder.setViewAngles(source.angles);
      } else if (source.kind === "q1") {
        const event = source.event;
        if (event.kind === "lightstyle") this.lightStyles.set(event.style, event.pattern);
        if (event.kind === "teleport-player" && owns(event.player)) this.local.builder.setViewAngles(event.angles);
        if (event.kind === "message" && owns(event.player)) {
          if (!event.center) this.local.console.print(`${event.text}\n`);
        }
      } else if (source.kind === "q2") {
        const event = source.event;
        if (event.kind === "lightstyle") this.lightStyles.set(event.style, event.pattern);
        if (event.kind === "help") this.local.console.print(`${event.text}\n`);
        if (event.kind === "pickup" && owns(event.player)) this.local.console.print(`${event.name}\n`);
        if (event.kind === "print" && (event.actor === null || owns(event.actor))) this.local.console.print(event.text);
      } else if (source.kind === "q2-player") {
        if (source.event.kind === "print" && (source.event.target === null || owns(source.event.target))) this.local.console.print(source.event.text);
      } else if (source.kind === "q3-source" && source.event.kind === "server-command"
        && (source.event.client < 0 || source.event.client === this.local.player.seat.client.id.slot)) {
        const [command, text] = tokenizeCommand(source.event.text, "q3").argv;
        if ((command === "print" || command === "chat" || command === "tchat") && text !== undefined) this.local.console.print(text);
      }
    }
  }

  async prepare(snapshot: WorldSnapshot, presentations: readonly SimulationPresentation[], characters: readonly Q3CharacterView[]): Promise<void> {
    this.previousTime = this.preparedTime;
    this.preparedTime = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    if (this.q3Client !== null) { await this.q3Client.prepare(snapshot.frame.frame, this.viewport, presentations); return; }
    await this.finale.prepare();
    for (const group of this.groups.values()) { group.entities.length = 0; group.options.clear(); }
    const inlineModels: NonNullable<WorldViewInput["inlineModels"]>[number][] = [];
    const brushModels: BrushPresentation[] = [];
    const append = async (content: ContentId, entity: SceneEntity, options?: (entity: SceneEntity) => ModelSourceOptions): Promise<void> => {
      let group = this.groups.get(content);
      if (group === undefined) {
        group = { renderer: new SceneModelRenderer(await this.assets.provider(content), this.assets.world), entities: [], options: new Map<SceneEntity, ModelSourceOptions>() };
        this.groups.set(content, group);
      }
      const activeGroup = group;
      activeGroup.entities.push(entity);
      const addOptions = (current: SceneEntity): void => {
        if (options !== undefined) activeGroup.options.set(current, options(current));
        for (const child of current.attachments) addOptions(child.entity);
      };
      addOptions(entity);
    };
    for (const source of presentations) {
      if (!source.visible || source.path === "") continue;
      if (source.viewWeapon ? !source.actor.equals(this.local.player.actor) : source.actor.equals(this.local.player.actor)) continue;
      if (!source.viewWeapon && characters.some(character => character.actor.equals(source.actor))) continue;
      const asset = await this.assets.model(source.content, source.path);
      const axis = anglesToAxis(source.angles);
      if (asset.model.kind === "brush-model") {
        if (asset.brushScene === this.assets.world) inlineModels.push({ model: asset.model.model, transform: { origin: source.origin, axis }, animationFrame: source.frame });
        else {
          if (asset.brushScene === null) throw new Error(`Brush model ${source.path} has no prepared scene`);
          brushModels.push({ scene: asset.brushScene, model: asset.model.model, transform: { origin: source.origin, axis }, frame: source.frame });
        }
        continue;
      }
      const entity: SceneEntity = { actor: source.actor, resource: asset.resource, model: asset.model,
        transform: { origin: source.origin, axis, scale: { x: source.scale, y: source.scale, z: source.scale } }, previousOrigin: source.origin,
        pose: { kind: "frame", frame: source.frame, previousFrame: source.oldFrame, backLerp: source.backLerp ?? 0 }, skin: source.skin,
        color: { x: 1, y: 1, z: 1, w: source.alpha ?? 1 }, shaderTime: { kind: "seconds", value: 0 }, flags: { kind: source.family, bits: source.renderFlags },
        lightingOrigin: source.origin, shadowPlane: 0, attachments: [] };
      await append(source.content, entity, () => ({ viewModel: source.viewWeapon,
        player: source.family === "q2" && source.path.startsWith("players/"), customShader: source.skinPath ?? null }));
    }
    if (this.characterAssets !== null) for (const character of characters) {
      const key = `${character.actor.slot}:${character.actor.generation}`;
      let presenter = this.characters.get(key);
      if (presenter === undefined) {
        presenter = new Q3CharacterPresenter(this.characterAssets);
        presenter.reset(character, Math.trunc(this.preparedTime * 1000));
        this.characters.set(key, presenter);
      }
      const passes = presenter.frame(character, { timeMilliseconds: Math.trunc(this.preparedTime * 1000),
        frameMilliseconds: Math.max(0, Math.trunc(this.preparedTime * 1000) - Math.trunc(this.previousTime * 1000)), shaderTime: { kind: "seconds", value: 0 },
        swingSpeed: 0.3, noPlayerAnimations: false, personalModel: character.actor.equals(this.local.player.actor), shadowPlane: null, weapon: [] });
      for (const pass of passes) await append(this.assets.content.recipe.character.appearance.content, pass.entity, pass.options);
    }
    this.inlineModels = inlineModels;
    this.brushModels = brushModels;
    for (const group of this.groups.values()) await group.renderer.preload(group.entities, entity => group.options.get(entity) ?? {});
  }

  frame(snapshot: WorldSnapshot): RenderFrame {
    const time = snapshot.frame.time, camera = this.camera(), effects = this.effects.frame(camera);
    const playerView = this.effects.playerView(this.local.player.actor, camera);
    const style = (index: number, absent: number): number => {
      const pattern = this.lightStyles.get(index);
      if (pattern === undefined || pattern.length === 0) return absent;
      return pattern.charCodeAt(Math.trunc(this.preparedTime * 10) % pattern.length) - 97;
    };
    const input: WorldViewInput = { camera, target: { kind: "seat", seat: this.local.player.seat.id }, time,
      ...this.rerelease?.view(this.local.player.actor, this.preparedTime),
      clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false }, inlineModels: this.inlineModels,
      lights: effects.lights, q3Lights: effects.q3Lights,
      q1Styles: Array.from({ length: 256 }, (_, index) => this.lightStyles.has(index) ? style(index, 12) * 22 : 256),
      q2Styles: Array.from({ length: 256 }, (_, index) => { const value = style(index, 12) / 12; return { rgb: { x: value, y: value, z: value }, white: value * 3 }; }) };
    const nativeFrame = this.q3Client?.frame(camera => this.effects.frame(camera));
    this.frames.begin();
    if (nativeFrame === undefined) {
      const batches = [...this.groups.values()].flatMap(group => group.renderer.prepare(group.entities, input,
        entity => ({ ...group.options.get(entity), infrared: playerView.infrared })));
      const brushes = this.brushModels.flatMap(brush => brush.scene.prepareModel(brush.model, brush.transform, { ...input, animationFrame: brush.frame }));
      this.frames.world(this.assets.world.prepareView({ ...input, operations: [...brushes, { kind: "draw", batches }, ...effects.operations] }));
    } else for (const command of nativeFrame.commands) {
      if (command.kind === "swap-buffers") throw new Error("Cgame cannot present the shared framebuffer");
      this.frames.command(command);
    }
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
      !this.finale.active && this.q3Client === null, !(this.rerelease?.storyActive(this.local.player.actor) ?? false));
    const scale = Math.max(1, Math.floor(camera.viewport.height / 300));
    if (this.local.input.focus.kind === "console") {
      const height = Math.trunc(camera.viewport.height * 0.5);
      const white = this.assets.world.shaders.textures.white.image;
      draw.fillRect({ x: 0, y: 0, width: camera.viewport.width, height }, { x: 0, y: 0, z: 0, w: 0.85 }, { kind: "image", name: "white", image: white });
      const columns = Math.max(1, Math.trunc(camera.viewport.width / (8 * scale)) - 2);
      if (this.local.console.buffer.width !== columns) this.local.console.buffer.resize(columns);
      drawConsole({ draw, text: this.text, rows: this.local.console.buffer.visible(Math.max(1, Math.trunc(height / (8 * scale)) - 2)),
        field: this.local.console.field, height, scale, nowMilliseconds: this.preparedTime * 1000, background: null });
    }
    return this.frames.finish(false);
  }

  render(frame: RenderFrame, backend: RendererBackend): undefined {
    if (backend !== this.native.backend) throw new Error("Seat presentation uses another renderer");
    return this.native.execute(frame);
  }

  close(): undefined { this.q3Client?.close(); this.ui.close(); this.groups.clear(); this.characters.clear(); return undefined; }
}
