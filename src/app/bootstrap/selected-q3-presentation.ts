import { freemem } from "node:os";
import type { ActorId } from "../../contracts/identity.ts";
import type { ContentId } from "../../contracts/content.ts";
import type { Q3ScenePresentation } from "../../content/q3/presentation/client.ts";
import { createQ3ScenePresentation } from "../../content/q3/presentation/client.ts";
import type { Q3SceneContent } from "../../content/q3/presentation/scene.ts";
import { ClientEntity } from "../../content/q3/presentation/state.ts";
import { EntityType } from "../../content/q3/base/shared/definitions.ts";
import { CvarRegistry } from "../../core/cvars/index.ts";
import { lightForPoint } from "../../materials/q3-lighting.ts";
import { ModelLightSampler } from "../../render/scene/models/light-sampler.ts";
import { reserveSourceEntityRange } from "../../render/scene/submissions.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import { CollisionMapSettings } from "../../world/collision/q3/settings.ts";
import type { Q3SeatAudioOperation } from "./audio/q3.ts";
import type { ApplicationEffectFrame } from "./effects.ts";
import type { ApplicationModPresentationsOptions } from "./mod-presentations.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import { ApplicationQ3Assets } from "./q3-client/assets.ts";
import { ApplicationQ3SceneRenderer } from "./q3-client/scene.ts";
import { createApplicationQ3Services } from "./q3-client/services.ts";
import type { ApplicationQ3Services } from "./q3-client/services.ts";
import { ApplicationQ3Source } from "./q3-client/source.ts";
import { selectApplicationQ3Snapshot } from "./q3-client/visibility.ts";
import type { Q3SelectedSource } from "./simulation/arsenal/q3-source.ts";
import type { Q3SourcePresentationState } from "./simulation/q3/presentation.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

export interface SelectedQ3Presentation {
  readonly content: ContentId;
  readonly source: Q3SelectedSource;
  readonly state: Q3SourcePresentationState;
}
export interface SelectedQ3PresentationOptions extends ApplicationModPresentationsOptions {
  hardware(): "generic" | "ragepro";
}
const empty: ApplicationEffectFrame = { q3Admissions: [], operations: [], lights: [], q3Lights: [] };

/** One original selected-source cgame scene, without primary view, body, weapon, input or HUD ownership. */
export class ApplicationSelectedQ3Presentation {
  private closed = false;
  private readonly actor: ActorId;
  private readonly generation: number;
  private readonly transport: ApplicationQ3Source;
  private readonly generations = new Map<number, ActorId>();
  private readonly audio: Q3SeatAudioOperation[] = [];
  private readonly light: ModelLightSampler;
  private media: ApplicationQ3Assets | null = null;
  private services: ApplicationQ3Services | null = null;
  private game: Q3ScenePresentation | null = null;
  private renderer: ApplicationQ3SceneRenderer | null = null;
  private scene: Q3SceneContent | null = null;
  private frame = -1;
  private busy = false;
  private readonly unbind: () => void;

  private constructor(private readonly options: SelectedQ3PresentationOptions, readonly source: SelectedQ3Presentation,
    readonly presentation: WorldSeatPresentation) {
    this.actor = presentation.local.player.actor;
    this.generation = source.source.generation;
    this.light = new ModelLightSampler(options.assets.world);
    this.transport = new ApplicationQ3Source(this.actor, source.source.presentationBaseline ?? source.state,
      (player, state) => selectApplicationQ3Snapshot(player, state, options.queries,
        number => source.source.world.linkState(number)?.absbounds ?? null, options.assets.world.map.leaves.length, options.print),
      number => source.source.actor(number));
    this.unbind = presentation.bindComponentEffects((camera, order, q1Fog) => {
      if (this.closed || !this.owns(source, presentation) || this.scene === null || this.renderer === null) return empty;
      const scene = this.scene, first = reserveSourceEntityRange(order, scene.admission.entities.length);
      const lights = scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, minimum: 0 }));
      const q3Lights = scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: light.additive })).slice(0, 32);
      return { q3Admissions: [scene.admission], lights, q3Lights,
        operations: this.renderer.operations(scene, { camera, source: createWorldSurfaceAdmission(order),
          target: { kind: "seat", seat: presentation.local.player.seat.id }, time: { kind: "milliseconds", value: this.transport.time }, lights, q3Lights,
          ...(q1Fog === undefined ? {} : { q1Fog }) }, first, { noWorldModel: false, splitScreen: presentation.splitScreen, supplementalViewWeapon: false }) };
    });
  }
  owns(source: SelectedQ3Presentation, presentation: WorldSeatPresentation): boolean {
    return !this.closed && source.source === this.source.source && source.content === this.source.content
      && source.source.generation === this.generation && presentation === this.presentation
      && this.actor.equals(presentation.local.player.actor) && source.source.active && source.source.live(this.actor);
  }
  private assertCurrent(): void { if (!this.owns(this.source, this.presentation)) throw new Error("Selected Q3 presentation belongs to a retired source or viewer"); }
  static async create(options: SelectedQ3PresentationOptions, source: SelectedQ3Presentation, presentation: WorldSeatPresentation): Promise<ApplicationSelectedQ3Presentation> {
    const owner = new ApplicationSelectedQ3Presentation(options, source, presentation);
    try { await owner.initialize(); owner.assertCurrent(); return owner; }
    catch (error) { try { owner.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Selected Q3 presentation initialization and cleanup failed"); } throw error; }
  }
  private async initialize(): Promise<void> {
    const o = this.options, source = this.source, presentation = this.presentation, seat = presentation.local.player.seat.id;
    const cvars = new CvarRegistry({ dialect: "q3", context: { session: this.actor.session,
      origin: { kind: "script", name: "selected-q3-cgame", caller: { kind: "local-seat", seat, client: presentation.local.player.seat.client.id } } }, print: o.print });
    this.media = await ApplicationQ3Assets.create(o.assets, source.content, o.print, () => false, "source-sync", "source");
    this.assertCurrent();
    const settings = new CollisionMapSettings(cvars); settings.registerMap();
    const reject = (): never => { throw new Error("Supplemental Q3 scene attempted to take over the primary view or UI"); };
    this.services = await createApplicationQ3Services({ collisionSettings: settings, media: this.media, audio: o.audio,
      owner: source.source.host.provider, seat, viewport: presentation.viewport, queries: o.queries, clock: o.clock,
      actorAt: number => {
        this.assertCurrent();
        const actor = source.source.actor(number);
        if (actor === null) throw new Error(`Selected Q3 sound slot ${number} has no source actor`);
        return actor;
      }, output: { scene: reject, command: reject, text: reject, listener: reject, audio: operation => {
        if (this.closed && operation.kind === "clear-loops") return;
        this.assertCurrent(); this.audio.push(operation);
      } } });
    this.assertCurrent();
    const media = this.media, services = this.services, transport = this.transport;
    this.renderer = new ApplicationQ3SceneRenderer(media, services.resources);
    this.game = await createQ3ScenePresentation({ scope: "scene", assets: media, resources: services.resources, scene: services.scene,
      world: o.assets.world, collision: services.collision, sound: services.sound, draw: services.draw, fontRegistry: media.fontRegistry,
      target: presentation.viewport, hardware: o.hardware(), clock: { milliseconds: o.clock.now, serverTime: () => transport.time, frameNumber: o.clock.frameNumber },
      bodyHidden: number => this.source.source.pool.at(number).client !== null,
      centerPrint: (text, time, duration) => presentation.ui.centerPrint(text, time, duration),
      lightForPoint: point => {
        const light = lightForPoint(this.light.grid, point, { ambientScale: 1, directedScale: 1 }); if (light !== null) return light;
        const sample = this.light.sample(point, { camera: presentation.camera(), time: { kind: "milliseconds", value: transport.time }, target: { kind: "seat", seat } });
        return { ambientLight: { x: sample.color.x * 255, y: sample.color.y * 255, z: sample.color.z * 255 }, directedLight: { x: 0, y: 0, z: 0 }, lightDir: { x: 0, y: 0, z: 1 } };
      }, memoryRemaining: () => Math.min(0x7fffffff, freemem()),
      session: { product: source.state.product, clientNumber: transport.clientNumber, serverMessageSequence: 0, lastExecutedServerCommand: 0,
        mode: { kind: "live" }, commands: transport.commands, snapshots: transport, cvars,
        getGameState: () => transport.getGameState(), getServerCommand: sequence => transport.getServerCommand(sequence), snapshotPing: () => 0,
        assertCurrent: () => this.assertCurrent(), print: o.print } });
    this.assertCurrent();
    const baseline = source.source.presentationBaseline;
    if (baseline !== null) {
      const state = this.game.state; state.time = baseline.time;
      for (const row of baseline.entities) {
        const entity = state.entityAt(row.state.number);
        entity.previousEvent = row.state.eType > EntityType.ET_EVENTS ? 1 : row.state.event;
        entity.snapshotTime = baseline.time; this.generations.set(row.state.number, row.actor);
      }
      await this.game.snapshots.processSnapshots(); this.assertCurrent();
    }
    services.scene.clearScene(); this.flushAudio();
  }
  private flushAudio(): void {
    this.assertCurrent();
    if (this.audio.length !== 0) this.options.audio.receiveCgameFrame({ content: this.source.content,
      owner: this.source.source.host.provider, seat: this.presentation.local.player.seat.id, operations: this.audio.splice(0) });
  }
  async prepare(source: SelectedQ3Presentation, events: readonly SimulationPresentationEvent[], frame: number): Promise<void> {
    this.assertCurrent(); if (!this.owns(source, this.presentation) || this.busy) throw new Error("Selected Q3 scene source changed or is already preparing");
    if (frame <= this.frame) return;
    this.busy = true;
    try {
      const game = this.game, services = this.services, renderer = this.renderer;
      if (game === null || services === null || renderer === null) throw new Error("Selected Q3 presentation has not initialized");
      const current = new Map(source.state.entities.map(row => [row.state.number, row.actor]));
      for (const [number, actor] of current) {
        const previous = this.generations.get(number);
        if (previous !== undefined && !previous.equals(actor)) {
          Object.assign(game.state.entityAt(number), new ClientEntity());
          if (number < source.source.pool.maxClients) {
            const info = source.state.configstrings.find(row => row.index === 544 + number)?.value ?? "";
            await game.clients.newClientInfo(number, info); this.assertCurrent();
          }
        }
      }
      for (const [number, actor] of current) this.generations.set(number, actor);
      this.transport.receive(source.state, events.filter(event => event.content === source.content), []);
      await game.frames.drawSceneFrame({ serverTime: source.state.time, stereo: "center", demoPlayback: false, engineFrameNumber: frame }, this.presentation.camera());
      this.assertCurrent(); const scene = services.scene.capture(); services.scene.clearScene();
      await renderer.preload([scene]); this.assertCurrent(); this.flushAudio(); this.scene = scene; this.frame = frame;
    } catch (error) { try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Selected Q3 frame and cleanup failed"); } throw error; }
    finally { this.busy = false; }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; this.audio.length = 0; this.scene = null;
    const failures: unknown[] = [];
    for (const cleanup of [this.unbind, () => this.game?.close(), () => this.renderer?.close(), () => this.services?.cinematics.close(), () => this.media?.close(),
      () => this.options.audio.receiveCgameFrame({ content: this.source.content, owner: this.source.source.host.provider,
        seat: this.presentation.local.player.seat.id, operations: [{ kind: "release-owner" }] })]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    this.game = null; this.renderer = null; this.services = null; this.media = null;
    if (failures.length !== 0) throw new AggregateError(failures, "Selected Q3 presentation cleanup failed");
  }
}

export class ApplicationSelectedQ3Presentations {
  private readonly seats = new Map<WorldSeatPresentation, ApplicationSelectedQ3Presentation>();
  private closed = false;
  private busy = false;
  constructor(private readonly options: SelectedQ3PresentationOptions) {}
  retainPresentations(presentations: readonly WorldSeatPresentation[]): void {
    if (this.closed) throw new Error("Selected Q3 presentation collection is closed");
    const failures: unknown[] = [];
    for (const [seat, consumer] of this.seats) if (!presentations.includes(seat)) {
      this.seats.delete(seat); try { consumer.close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Selected Q3 seat retirement failed");
  }
  async prepare(presentations: readonly WorldSeatPresentation[], source: SelectedQ3Presentation | null,
    events: readonly SimulationPresentationEvent[], frame: number): Promise<void> {
    if (this.closed || this.busy) throw new Error("Selected Q3 presentation collection is closed or already preparing");
    this.busy = true;
    try {
      this.retainPresentations(presentations);
      for (const [seat, consumer] of this.seats) if (source === null || !consumer.owns(source, seat)) {
        this.seats.delete(seat); consumer.close();
      }
      if (source === null) return;
      for (const seat of presentations) {
        if (!source.state.clients.some(row => row.actor.equals(seat.local.player.actor))) continue;
        let consumer = this.seats.get(seat);
        if (consumer === undefined) {
          consumer = await ApplicationSelectedQ3Presentation.create(this.options, source, seat);
          if (this.closed) { consumer.close(); throw new Error("Selected Q3 presentation collection retired during initialization"); }
          this.seats.set(seat, consumer);
        }
        await consumer.prepare(source, events, frame);
      }
    } finally { this.busy = false; }
  }
  close(): void {
    if (this.closed) return; this.closed = true;
    const failures: unknown[] = [];
    for (const consumer of this.seats.values()) { try { consumer.close(); } catch (error) { failures.push(error); } }
    this.seats.clear(); if (failures.length !== 0) throw new AggregateError(failures, "Selected Q3 presentation collection cleanup failed");
  }
}
