import { isDeepStrictEqual } from "node:util";
import type { SystemCinematicHost } from "./q3-client/cinematics.ts";
import { SaveReader } from "../../persistence/value.ts";
import { savedActorId, readSavedActor } from "../../persistence/save-image.ts";
import type { SavedActorId } from "../../contracts/session.ts";
import { componentEngineCommands } from "./component-commands.ts";
import type { CommandContext } from "../../contracts/common.ts";
import type { ActorId, SeatId } from "../../contracts/identity.ts";
import type { ComponentPresentationMediaRequest, PresentationOwner } from "../../contracts/presentation.ts";
import type { CommandInvocation } from "../../core/commands/index.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import type { ClientCommandRegistration } from "../../input/client-commands.ts";
import { tokenizeCommand } from "../../core/commands/text.ts";
import type { ApplicationInput } from "./input.ts";
import { drawQ3Overlay } from "./q3-client/overlay.ts";
import type { ProviderId } from "../../contracts/identity.ts";
import type { Q3SceneContent } from "../../content/q3/presentation/scene.ts";
import { reserveSourceEntityRange } from "../../render/scene/submissions.ts";
import { createWorldSurfaceAdmission } from "../../render/scene/world.ts";
import type { WorldViewInput } from "../../render/scene/world.ts";
import type { ActiveModPresentation } from "../../world/session/mod-presentations.ts";
import type { ApplicationEffectFrame } from "./effects.ts";
import { ApplicationModPresentation } from "./mod-presentation.ts";
import type { ApplicationModPresentationOptions } from "./mod-presentation.ts";
import type { WorldSeatPresentation } from "./presentation.ts";
import type { SimulationPresentationEvent } from "./simulation/types.ts";

export interface ComponentClientCommandTarget {
  readonly owner: PresentationOwner;
  readonly instance: symbol;
  readonly seat: SeatId;
  readonly viewer: ActorId;
}
export interface ComponentClientCommandRequest {
  readonly target: "component-client";
  readonly consumer: ComponentClientCommandTarget;
  readonly mode: "console" | "reliable";
  readonly name: string;
  readonly arguments_: readonly string[];
  readonly seat: SeatId;
  readonly source: CommandContext;
}
export type ApplicationModPresentationsOptions = Pick<ApplicationModPresentationOptions,
  "assets" | "audio" | "queries" | "print" | "nextFrame" | "clock" | "renderer"> & {
    readonly input?: Pick<ApplicationInput, "commands" | "clientCommandRegistration">;
    presentationMedia?(source: ActiveModPresentation, request: ComponentPresentationMediaRequest, initializing: boolean, current: () => boolean): Promise<void>;
    queueCommand?(request: ComponentClientCommandRequest): void;
    systemCinematics?(source: ActiveModPresentation, presentation: ViewingSeat,
      scope: { readonly cvars: CvarRegistry; readonly mounts: ApplicationModPresentation["fileMounts"]; append(text: string): void }): SystemCinematicHost;
  };
type ViewingSeat = Pick<WorldSeatPresentation, "camera" | "bindComponentEffects" | "viewport" | "splitScreen"> & {
  readonly local: { readonly player: { readonly actor: ActorId; readonly seat: { readonly id: SeatId; readonly client: { readonly id: WorldSeatPresentation["local"]["player"]["seat"]["client"]["id"] } } } };
};
interface Entry {
  readonly consumer: ApplicationModPresentation;
  readonly target: ComponentClientCommandTarget;
  commandSource: CommandContext;
  closeCommands(): void;
  unbind: () => void;
  publish(): void;
  scene: Q3SceneContent | null;
  time: number;
}
const empty: ApplicationEffectFrame = { q3Admissions: [], operations: [], lights: [], q3Lights: [] };

/** The local seats share source events; each cgame keeps its own viewer, media and transient state. */
export class ApplicationModPresentations {
  private readonly entries = new Map<ViewingSeat, Map<ProviderId, Entry>>();
  private closed = false;
  private busy = false;
  private unpublished = false;
  constructor(private readonly options: ApplicationModPresentationsOptions) {}
  private assertOpen(): void { if (this.closed) throw new Error("Component presentation collection is closed"); }
  private remove(entries: Map<ProviderId, Entry>, id: ProviderId, entry: Entry): void {
    entries.delete(id);
    const failures: unknown[] = [];
    try { entry.unbind(); } catch (error) { failures.push(error); }
    try { entry.closeCommands(); } catch (error) { failures.push(error); }
    try { entry.consumer.close(); } catch (error) { failures.push(error); }
    if (failures.length !== 0) throw new AggregateError(failures, "Component presentation removal failed");
  }
  private async create(presentation: ViewingSeat, source: ActiveModPresentation,
    checkpoint?: { readonly value: unknown; resolveActor(saved: SavedActorId): ActorId }): Promise<Entry> {
    const reject = (): never => { throw new Error("Component cgame requires an unsupported destination view or overlay takeover"); };
    const target: ComponentClientCommandTarget = { owner: source.owner, instance: Symbol(source.prepared.source.id),
      seat: presentation.local.player.seat.id, viewer: presentation.local.player.actor };
    const producer = { kind: "client-module", module: source.prepared.artifact.module, instance: target.instance } satisfies NonNullable<CommandContext["producer"]>;
    const context: CommandContext = { session: target.seat.session,
      origin: { kind: "local-seat", seat: target.seat, client: presentation.local.player.seat.client.id }, producer };
    const generation = source.source.generation;
    let releaseProducer: (() => void) | null = null;
    let registration: ClientCommandRegistration | null = null, currentEntry: Entry | null = null, commandsClosed = false;
    const current = (): void => {
      this.assertOpen(); source.source.assertCurrent();
      if (commandsClosed || source.source.generation !== generation || !source.source.live(target.viewer)
        || !presentation.local.player.actor.equals(target.viewer)) throw new Error("Component client command owner is retired");
    };
    const input = (): NonNullable<ApplicationModPresentationsOptions["input"]> => {
      current(); if (this.options.input === undefined || this.options.queueCommand === undefined)
        throw new Error("Component cgame requires actual client command services");
      return this.options.input;
    };
    const queue = (mode: ComponentClientCommandRequest["mode"], arguments_: readonly string[], caller: CommandContext): void => {
      input(); const name = arguments_[0]; if (name === undefined) return;
      this.options.queueCommand?.({ target: "component-client", consumer: target, mode, name, arguments_: arguments_.slice(1),
        seat: target.seat, source: { ...caller, producer } });
    };
    const closeCommands = (): void => {
      if (commandsClosed) return; commandsClosed = true;
      const failures: unknown[] = [];
      try { releaseProducer?.(); releaseProducer = null; } catch (error) { failures.push(error); }
      try { registration?.close(); } catch (error) { failures.push(error); }
      try { this.options.input?.commands.discardProducer(target.instance); } catch (error) { failures.push(error); }
      if (failures.length !== 0) throw new AggregateError(failures, "Component client command cleanup failed");
    };
    const { presentationMedia, systemCinematics, ...consumerOptions } = this.options;
    const append = (text: string): void => {
      const host = input(), caller = currentEntry?.commandSource ?? context;
      host.commands.append(text, { ...context, origin: { kind: "script", name: producer.module.artifactPath, caller: caller.origin } }, "q3");
    };
    let consumer: ApplicationModPresentation;
    try {
      const ownerOptions: ApplicationModPresentationOptions = { ...consumerOptions, source, viewer: target.viewer,
        seat: target.seat, viewport: presentation.viewport, viewOrigin: () => presentation.camera().origin,
        viewAxis: () => presentation.camera().axis,
        ...(systemCinematics === undefined ? {} : { systemCinematics: owner => systemCinematics(source, presentation,
          { cvars: owner.cvars, mounts: owner.fileMounts, append }) }),
        ...(presentationMedia === undefined ? {} : { presentationMedia: async (request: ComponentPresentationMediaRequest, initializing: boolean, consumerCurrent: () => boolean) => {
          current(); await presentationMedia(source, request, initializing, () => !this.closed && !commandsClosed
            && presentation.local.player.actor.equals(target.viewer) && consumerCurrent()); current();
        } }),
        commands: {
          register: name => { const host = input(); registration ??= host.clientCommandRegistration(target.seat,
            { instance: target.instance, label: source.prepared.source.id, execute: command => queue("console", command.argv, command.source) });
            registration.register(name); },
          remove: name => { current(); registration?.remove(name); },
          append,
          reliable: text => queue("reliable", tokenizeCommand(text, "q3").argv, currentEntry?.commandSource ?? context),
        },
        output: { scene: reject, command: reject, text: reject, listener: reject } };
      consumer = checkpoint === undefined ? await ApplicationModPresentation.create(ownerOptions)
        : await ApplicationModPresentation.restore(ownerOptions, checkpoint.value, checkpoint.resolveActor);
    } catch (error) {
      try { closeCommands(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component cgame initialization and command cleanup failed"); }
      throw error;
    }
    try {
      this.assertOpen();
      let published = false;
      const entry: Entry = { consumer, target, commandSource: context, closeCommands, scene: null, time: 0, unbind: () => {},
        publish: () => {
          if (published) return;
          current();
          entry.unbind = presentation.bindComponentEffects((camera, order, q1Fog) => {
            if (entry.scene === null || !consumer.owns(source, presentation.local.player.actor)) return empty;
            const scene = entry.scene, firstEntity = reserveSourceEntityRange(order, scene.admission.entities.length);
            const lights = scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, minimum: 0 }));
            const q3Lights = scene.lights.map(light => ({ origin: light.origin, radius: light.radius, color: light.color, additive: light.additive })).slice(0, 32);
            const input: WorldViewInput = { source: createWorldSurfaceAdmission(order), camera, time: { kind: "milliseconds", value: entry.time },
              target: { kind: "seat", seat: presentation.local.player.seat.id }, lights, q3Lights, ...(q1Fog === undefined ? {} : { q1Fog }) };
            return { q3Admissions: [scene.admission], operations: consumer.renderer.operations(scene, input, firstEntity,
              { noWorldModel: false, splitScreen: presentation.splitScreen, supplementalViewWeapon: false }), lights, q3Lights };
          }, { owner: source.owner, draw: (frames, camera) => {
            if (!consumer.owns(source, presentation.local.player.actor)) return;
            drawQ3Overlay({ submissions: consumer.hud, renderer: consumer.renderer, assets: this.options.assets, frames, camera,
              viewport: presentation.viewport, seat: presentation.local.player.seat.id, time: entry.time });
          } });
          if (this.options.input !== undefined) {
            const engineCommands = componentEngineCommands(this.options.input.commands.dialect, this.options.assets.content);
            releaseProducer = this.options.input.commands.bindProducer(target.instance, {
              cvars: caller => {
                current();
                const actual = caller.producer?.module;
                if (actual?.id !== producer.module.id || actual.digest !== producer.module.digest || actual.revision !== producer.module.revision || actual.artifactPath !== producer.module.artifactPath)
                  throw new Error("Component command producer differs from its original client module");
                return consumer.cvars;
              },
              readScript: async (name, caller) => {
                current(); const resource = await consumer.fileMounts.open(name); current();
                if (caller.producer?.instance !== target.instance) throw new Error("Component script changed its producer");
                return resource === null ? undefined : new TextDecoder().decode(resource.bytes);
              },
              command: command => { command.assertActive(); queue("console", command.argv, command.source); },
              engineCommand: name => engineCommands.has(name.toLowerCase()),
            });
          }
          consumer.publishCommands(); published = true;
        } };
      currentEntry = entry;
      if (checkpoint === undefined) entry.publish();
      return entry;
    } catch (error) {
      const failures = [error];
      try { currentEntry?.unbind(); } catch (cleanup) { failures.push(cleanup); }
      try { closeCommands(); } catch (cleanup) { failures.push(cleanup); }
      try { consumer.close(); } catch (cleanup) { failures.push(cleanup); }
      if (failures.length > 1) throw new AggregateError(failures, "Component presentation creation and cleanup failed");
      throw error;
    }
  }
  captureCheckpoint(presentations: readonly ViewingSeat[], sources: readonly ActiveModPresentation[]) {
    this.assertOpen();
    if (this.busy || this.unpublished || this.pendingCommands) throw new Error("Component client checkpoint requires an idle published collection without queued commands");
    const available = new Map(sources.map(source => [source.prepared.source.id, source]));
    if (available.size !== sources.length) throw new Error("Duplicate component presentation source identity");
    for (const [presentation, entries] of this.entries) {
      if (!presentations.includes(presentation)) throw new Error("Component checkpoint contains a retired seat");
      for (const [id, entry] of entries) {
        const source = available.get(id);
        if (source === undefined || !entry.consumer.owns(source, presentation.local.player.actor))
          throw new Error("Component checkpoint contains a retired source consumer");
      }
    }
    return { version: 1, seats: presentations.map(presentation => {
      const player = presentation.local.player;
      return { seat: player.seat.id.index, client: { slot: player.seat.client.id.slot, generation: player.seat.client.id.generation },
        viewer: savedActorId(player.actor), sources: sources.map(source => {
          const entry = this.entries.get(presentation)?.get(source.prepared.source.id);
          return { owner: source.owner, identity: source.identity, module: source.prepared.artifact.module,
            declaration: source.prepared.declaration, state: entry === undefined ? { kind: "lazy" }
              : { kind: "initialized", checkpoint: entry.consumer.captureCheckpoint() } };
        }) };
    }) };
  }
  async restoreCheckpoint(value: unknown, presentations: readonly ViewingSeat[], sources: readonly ActiveModPresentation[],
    resolveActor: (saved: SavedActorId) => ActorId): Promise<void> {
    this.assertOpen();
    if (this.busy || this.unpublished || this.entries.size !== 0) throw new Error("Component client restore requires an unpublished empty collection");
    const r = new SaveReader(value, "component-clients"); r.field("version").literal(1);
    const seats = new Set<number>();
    const equal = isDeepStrictEqual;
    const rows = r.field("seats").list(row => {
      const seat = row.field("seat").integer(0), presentation = presentations.find(p => p.local.player.seat.id.index === seat);
      if (seats.has(seat) || presentation === undefined) return row.fail("duplicate or missing component seat"); seats.add(seat);
      const player = presentation.local.player, client = row.field("client");
      if (client.field("slot").integer(0) !== player.seat.client.id.slot || client.field("generation").integer(0) !== player.seat.client.id.generation
        || !resolveActor(readSavedActor(row.field("viewer"))).equals(player.actor)) row.fail("component viewing client changed");
      const owners = new Set<string>();
      const clients = row.field("sources").list(saved => {
        const provider = saved.field("owner").field("provider").string();
        const source = sources.find(source => source.owner.provider === provider);
        if (source === undefined || owners.has(provider)) return saved.fail("duplicate or missing component source"); owners.add(provider);
        if (!equal(saved.field("owner").value, source.owner) || !equal(saved.field("identity").value, source.identity)
          || !equal(saved.field("module").value, source.prepared.artifact.module) || !equal(saved.field("declaration").value, source.prepared.declaration))
          saved.fail("component activation or original module identity changed");
        const state = saved.field("state"), kind = state.field("kind").choice("lazy", "initialized");
        return { source, kind, checkpoint: kind === "lazy" ? undefined : state.field("checkpoint").value };
      });
      if (clients.length !== sources.length) row.fail("required component client state is missing");
      return { presentation, clients };
    });
    if (rows.length !== presentations.length) r.fail("required viewing seat state is missing");
    this.busy = true; this.unpublished = true;
    try {
      for (const row of rows) for (const client of row.clients) {
        if (client.kind === "lazy") continue;
        const entry = await this.create(row.presentation, client.source, { value: client.checkpoint, resolveActor });
        this.assertOpen();
        let entries = this.entries.get(row.presentation);
        if (entries === undefined) { entries = new Map<ProviderId, Entry>(); this.entries.set(row.presentation, entries); }
        entries.set(client.source.prepared.source.id, entry);
      }
    } catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Component client restore and cleanup failed"); }
      throw error;
    } finally { this.busy = false; }
  }
  publishRestored(): void {
    this.assertOpen();
    if (this.busy) throw new Error("Component client restore is still running");
    if (!this.unpublished) return;
    for (const entries of this.entries.values()) for (const entry of entries.values()) entry.publish();
    this.unpublished = false;
  }
  get pendingCommands(): boolean {
    return [...this.entries.values()].some(entries => [...entries.values()].some(entry =>
      this.options.input?.commands.producerPending(entry.target.instance) === true));
  }
  private commandEntry(source: CommandContext): Entry | null {
    const producer = source.producer;
    if (producer?.kind !== "client-module") return null;
    this.assertOpen();
    for (const entries of this.entries.values()) for (const entry of entries.values()) if (entry.target.instance === producer.instance) {
      const expected = entry.consumer.options.source.prepared.artifact.module;
      if (producer.module.id !== expected.id || producer.module.digest !== expected.digest || producer.module.revision !== expected.revision
        || producer.module.artifactPath !== expected.artifactPath || !entry.consumer.owns(entry.consumer.options.source, entry.target.viewer))
        throw new Error("Component client command producer is retired or differs from its source");
      return entry;
    }
    throw new Error("Component client command producer is retired");
  }
  commandCvars(source: CommandContext): CvarRegistry | null { return this.commandEntry(source)?.consumer.cvars ?? null; }
  async readCommandScript(name: string, source: CommandContext): Promise<string | undefined> {
    const entry = this.commandEntry(source); if (entry === null) return undefined;
    const resource = await entry.consumer.fileMounts.open(name);
    if (this.commandEntry(source) !== entry) throw new Error("Component script owner changed while reading");
    return resource === null ? undefined : new TextDecoder().decode(resource.bytes);
  }
  queueConsole(command: CommandInvocation): boolean {
    const entry = this.commandEntry(command.source); if (entry === null) return false;
    command.assertActive();
    const name = command.argv[0]; if (name === undefined) return true;
    if (this.options.queueCommand === undefined) throw new Error("Component command queue is unavailable");
    this.options.queueCommand({ target: "component-client", consumer: entry.target, mode: "console", name,
      arguments_: command.argv.slice(1), source: command.source, seat: entry.target.seat }); return true;
  }
  async dispatchCommand(request: ComponentClientCommandRequest): Promise<"handled" | "retired"> {
    this.assertOpen();
    const entries = [...this.entries.values()], entry = entries.flatMap(entries => [...entries.values()]).find(entry => entry.target === request.consumer);
    if (entry === undefined || !entry.consumer.owns(entry.consumer.options.source, request.consumer.viewer)) return "retired";
    const previous = entry.commandSource; entry.commandSource = request.source;
    try {
      const arguments_ = [request.name, ...request.arguments_];
      if (request.mode === "console" && await entry.consumer.command(arguments_)) return "handled";
      if (!entry.consumer.owns(entry.consumer.options.source, request.consumer.viewer)) return "retired";
      const receive = entry.consumer.options.source.source.clientCommand;
      if (receive === undefined) throw new Error("Component source has no admitted client command receiver");
      receive(request.consumer.viewer, arguments_); return "handled";
    } finally { entry.commandSource = previous; }
  }
  retainPresentations(presentations: readonly ViewingSeat[]): void {
    this.assertOpen();
    const failures: unknown[] = [];
    for (const [presentation, entries] of this.entries) if (!presentations.includes(presentation)) {
      for (const [id, entry] of entries) { try { this.remove(entries, id, entry); } catch (error) { failures.push(error); } }
      this.entries.delete(presentation);
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Component seat retirement failed");
  }
  async prepare(presentations: readonly ViewingSeat[], sources: readonly ActiveModPresentation[],
    events: readonly SimulationPresentationEvent[], frameSequence: number): Promise<void> {
    this.assertOpen();
    if (this.unpublished) throw new Error("Restored component presentations are not published");
    if (this.busy) throw new Error("Component presentation preparation is already running");
    this.busy = true;
    try {
      this.retainPresentations(presentations);
      const available = new Map(sources.map(source => [source.prepared.source.id, source]));
      if (available.size !== sources.length) throw new Error("Duplicate component presentation source identity");
      for (const [presentation, entries] of this.entries) {
        for (const [id, entry] of entries) {
          const source = available.get(id);
          if (source === undefined || !entry.consumer.owns(source, presentation.local.player.actor))
            this.remove(entries, id, entry);
        }
        if (entries.size === 0) this.entries.delete(presentation);
      }
      for (const presentation of presentations) for (const source of sources) {
        this.assertOpen();
        const viewer = presentation.local.player.actor, context = source.source.context(viewer);
        const id = source.prepared.source.id;
        let entries = this.entries.get(presentation), entry = entries?.get(id);
        if (context === null) {
          if (entries !== undefined && entry !== undefined) this.remove(entries, id, entry);
          continue;
        }
        if (entry === undefined) {
          entry = await this.create(presentation, source);
          if (entries === undefined) { entries = new Map<ProviderId, Entry>(); this.entries.set(presentation, entries); }
          entries.set(id, entry);
        }
        try {
          if (source.prepared.declaration.runtime === "qvm-player-events") for (const event of events) {
            if (event.kind !== "q3-source" || event.event.kind !== "player-event" || event.recipient !== undefined && !event.recipient.equals(viewer)) continue;
            const actual = event.event.source, expected = source.prepared.source;
            if (actual.module.id !== expected.id || actual.module.artifactPath !== expected.artifactPath || actual.module.digest !== expected.digest
              || actual.module.revision !== expected.revision || actual.abiProfile !== source.source.abiProfile) continue;
            await entry.consumer.consume(event.event, event.sequence); this.assertOpen();
          }
          entry.scene = await entry.consumer.frame(frameSequence); this.assertOpen(); entry.time = entry.consumer.time;
        } catch (error) {
          try { if (entries !== undefined) this.remove(entries, id, entry); }
          catch (cleanup) { throw new AggregateError([error, cleanup], "Component presentation preparation and cleanup failed"); }
          throw error;
        }
      }
    } finally { this.busy = false; }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const entries of this.entries.values()) for (const [id, entry] of entries) {
      try { this.remove(entries, id, entry); } catch (error) { failures.push(error); }
    }
    this.entries.clear();
    if (failures.length !== 0) throw new AggregateError(failures, "Component presentation collection cleanup failed");
  }
}
