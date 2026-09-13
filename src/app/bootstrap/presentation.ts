import { weaponViewCamera } from "./weapon-view.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { ApplicationWorldScene } from "./presentation-scene.ts";
import type { ActorId } from "../../contracts/identity.ts";
import type { Rect, RendererBackend, RenderFrame, SceneCamera } from "../../contracts/render.ts";
import type { SeatClientState, SeatPresentation, SimulationEvent, WorldSnapshot } from "../../contracts/session.ts";
import type { Q3CharacterAssets, Q3CharacterView } from "../../content/q3/foundation/index.ts";
import { anglesToAxis } from "../../core/math.ts";
import { tokenizeCommand } from "../../core/commands/index.ts";
import { drawConsole } from "../../console/draw.ts";
import { SceneFrameBuilder } from "../../render/commands/frame.ts";
import { prepareMaterialText } from "../../render/commands/material2d.ts";
import { perspectiveProjection } from "../../render/scene/view.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
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

export class WorldSeatPresentation implements SeatPresentation {
  private readonly frames: SceneFrameBuilder;
  private readonly text: SeatTextPresentation;
  private readonly finale: SourceFinale;
  private preparedTime = 0;
  private readonly scene: ApplicationWorldScene;

  constructor(readonly local: LocalInput, readonly assets: ApplicationAssets, private readonly native: NativeRenderer,
    private readonly simulation: Pick<SimulationPresentationAccess, "playerView">, private readonly seatCount: number,
    font: TextFontSelection, characterAssets: Q3CharacterAssets | null, readonly ui: ApplicationSeatUi,
    private readonly effects: ApplicationEffects, readonly q3Client: ApplicationQ3Client | null = null,
    private readonly rerelease: ApplicationRereleasePresentation | null = null) {
    this.scene = new ApplicationWorldScene(assets, characterAssets);
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
    const player = this.simulation.playerView(this.local.player.actor), viewport = this.viewport;
    if (this.q3Client !== null) return cameraWithKick(this.q3Client.camera(), player.kickAngles ?? { x: 0, y: 0, z: 0 });
    const fovX = 90, fovY = Math.atan(viewport.height / viewport.width * Math.tan(fovX * Math.PI / 360)) * 360 / Math.PI;
    const camera: SceneCamera = { origin: { ...player.origin, z: player.origin.z + player.viewHeight }, axis: anglesToAxis(player.angles), viewport,
      projection: perspectiveProjection(fovX, fovY, 16384), clip: { kind: "none" } };
    return this.effects.playerView(this.local.player.actor, cameraWithKick(camera, player.kickAngles ?? { x: 0, y: 0, z: 0 })).camera;
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
    this.scene.receive(events);
    this.ui.receive(events);
    this.finale.receive(events);
    const owns = (actor: ActorId): boolean => actor.equals(this.local.player.actor);
    for (const source of events) {
      if (source.kind === "view-reset") {
        if (owns(source.actor)) this.local.builder.setViewAngles(source.angles);
      } else if (source.kind === "q1") {
        const event = source.event;
        if (event.kind === "teleport-player" && owns(event.player)) this.local.builder.setViewAngles(event.angles);
        if (event.kind === "message" && owns(event.player)) {
          if (!event.center) this.local.console.print(`${event.text}\n`);
        }
      } else if (source.kind === "q2") {
        const event = source.event;
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
    await this.ui.prepare(this.assets);
    this.preparedTime = snapshot.frame.time.kind === "seconds" ? snapshot.frame.time.value : snapshot.frame.time.value / 1000;
    if (this.q3Client !== null) { await this.q3Client.prepare(snapshot.frame.frame, this.viewport, presentations); return; }
    await this.finale.prepare();
    await this.scene.prepare(this.local.player.actor, snapshot, presentations, characters);
  }

  frame(snapshot: WorldSnapshot): RenderFrame {
    const time = snapshot.frame.time, camera = this.camera(), effects = this.effects.frame(camera, this.local.player.actor);
    const playerView = this.effects.playerView(this.local.player.actor, camera);
    const style = (index: number, absent: number): number => this.scene.style(index, absent);
    const input: WorldViewInput = { camera, target: { kind: "seat", seat: this.local.player.seat.id }, time,
      ...this.rerelease?.view(this.local.player.actor, this.preparedTime),
      clear: { depth: 1, color: { x: 0, y: 0, z: 0, w: 1 }, stencil: false },
      lights: effects.lights, q3Lights: effects.q3Lights,
      ...this.scene.styles() };
    const nativeFrame = this.q3Client?.frame(camera => this.effects.frame(camera, this.local.player.actor), camera => cameraWithKick(camera, this.simulation.playerView(this.local.player.actor).kickAngles ?? { x: 0, y: 0, z: 0 }));
    this.frames.begin();
    if (nativeFrame === undefined) {
      this.frames.world(this.scene.view(input, effects.operations,
        this.effects.shadowSceneLights(camera, index => style(index, 12) / 12), playerView.infrared,
        weaponViewCamera(camera, this.ui.weaponOcclusion({ binding: this.state.presentation, timeMilliseconds: this.preparedTime * 1000 }, !this.finale.active))));
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
      !this.finale.active && (this.q3Client?.weaponHudView().visible ?? true), !(this.rerelease?.storyActive(this.local.player.actor) ?? false),
      this.q3Client !== null, this.q3Client?.weaponHudView().aggregateWarning ?? true);
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

  close(): undefined { this.q3Client?.close(); this.ui.close(); this.scene.close(); return undefined; }
}
