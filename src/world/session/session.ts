// Session ownership separates Q3 connection/active state and Q1/Q2 disconnect/resource teardown.
import type { ClientId, IdentityOwner, SeatId, SessionId } from "../../contracts/identity.ts";
import type { RendererBackend, RenderFrame } from "../../contracts/render.ts";
import type { InputBatch, SeatPresentation, Simulation, SimulationEvent, SimulationOutput, WorldSnapshot } from "../../contracts/session.ts";
import { ProviderRuntimeState } from "./clocks.ts";
import { ResourceScope } from "./resources.ts";
import type { SessionResource } from "./resources.ts";

function closeAll(resources: readonly SessionResource[], message: string): undefined {
  const errors: unknown[] = [];
  for (const resource of resources) {
    try { resource.close(); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, message);
  return undefined;
}

export class WorldLifetime implements SessionResource {
  readonly resources = new ResourceScope("World resources");
  readonly providers = new ProviderRuntimeState();
  private closed = false;

  constructor(readonly simulation: Simulation) {}

  get isClosed(): boolean { return this.closed; }

  close(): undefined {
    if (this.closed) return undefined;
    this.closed = true;
    return closeAll([this.simulation, this.resources, this.providers], "World shutdown failed");
  }
}

/** A connection's reliable channel/download handles survive replacement of its active world. */
export class SessionConnection extends ResourceScope {
  constructor(readonly client: ClientId, readonly kind: "loopback" | "remote" | "demo") {
    super(`Client ${client.slot} ${kind} connection`);
  }
}

export class SessionClient implements SessionResource {
  readonly resources = new ResourceScope("Client resources");
  private readonly seats = new Set<SessionSeat>();
  private activeResources = new ResourceScope("Client world resources");
  private activeConnection: SessionConnection | null = null;

  constructor(readonly id: ClientId) {
    this.resources.defer(() => this.activeResources.close());
    this.resources.defer(() => this.disconnect());
  }

  get isClosed(): boolean { return this.resources.isClosed; }
  get worldResources(): ResourceScope { this.resources.assertOpen(); return this.activeResources; }
  get connection(): SessionConnection | null { return this.activeConnection; }

  validateSeatBinding(seat: SessionSeat): void {
    this.resources.assertOpen();
    seat.resources.assertOpen();
    if (seat.client !== this) throw new RangeError("Seat belongs to another client");
    if (this.seats.has(seat)) throw new Error("Seat is already bound");
  }

  bindSeat(seat: SessionSeat): undefined {
    this.validateSeatBinding(seat);
    this.seats.add(seat);
    seat.resources.defer(() => { this.seats.delete(seat); return undefined; });
    this.resources.own(seat);
    return undefined;
  }

  connect(kind: SessionConnection["kind"]): SessionConnection {
    this.resources.assertOpen();
    this.disconnect();
    return this.replaceConnection(kind).connection;
  }

  replaceConnection(kind: SessionConnection["kind"]): { readonly connection: SessionConnection; readonly retired: SessionConnection | null } {
    this.resources.assertOpen();
    const retired = this.activeConnection;
    const connection = new SessionConnection(this.id, kind);
    this.activeConnection = connection;
    return { connection, retired };
  }

  disconnect(): undefined {
    const connection = this.activeConnection;
    this.activeConnection = null;
    const active = this.activeResources;
    if (!this.isClosed) this.activeResources = new ResourceScope("Client world resources");
    const clearSeats: SessionResource = { close: () => this.clearSeatPresentations() };
    return closeAll(connection === null ? [clearSeats, active] : [clearSeats, active, connection], "Client disconnect failed");
  }

  clearWorld(): undefined {
    const previous = this.replaceWorldResources();
    return closeAll([{ close: () => this.clearSeatPresentations() }, previous], "Client world shutdown failed");
  }

  replaceWorldResources(): ResourceScope {
    this.resources.assertOpen();
    const previous = this.activeResources;
    this.activeResources = new ResourceScope("Client world resources");
    return previous;
  }

  close(): undefined { return this.resources.close(); }

  private clearSeatPresentations(): undefined {
    return closeAll(Array.from(this.seats, seat => ({ close: () => seat.clearPresentation() })), "Seat presentation shutdown failed");
  }
}

interface PresentationLifetime { readonly presentation: SeatPresentation; readonly resources: ResourceScope; }

/** A seat may replace its renderer and UI without closing the server or another seat. */
export class SessionSeat implements SessionResource {
  readonly resources = new ResourceScope("Seat resources");
  private presentationLifetime: PresentationLifetime | null = null;

  constructor(readonly id: SeatId, readonly client: SessionClient) {
    this.resources.defer(() => this.clearPresentation());
  }

  get isClosed(): boolean { return this.resources.isClosed; }
  get presentation(): SeatPresentation | null { return this.presentationLifetime?.presentation ?? null; }

  attachPresentation(presentation: SeatPresentation, cleanup: () => undefined): ResourceScope {
    this.validatePresentation(presentation);
    const resources = new ResourceScope(`Seat ${this.id.index} presentation`);
    resources.defer(cleanup);
    this.replacePresentation({ presentation, resources })?.close();
    return resources;
  }

  validatePresentation(presentation: SeatPresentation): void {
    this.resources.assertOpen();
    if (this.client.isClosed) throw new Error("Seat client is closed");
    if (!presentation.state.seat.equals(this.id) || !presentation.state.client.equals(this.client.id)) {
      throw new RangeError("Presentation belongs to another seat or client");
    }
  }

  replacePresentation(lifetime: PresentationLifetime | null): ResourceScope | null {
    const previous = this.presentationLifetime;
    this.presentationLifetime = lifetime;
    return previous?.resources ?? null;
  }

  clearPresentation(): undefined {
    const lifetime = this.presentationLifetime;
    this.presentationLifetime = null;
    return lifetime?.resources.close();
  }

  receive(events: readonly SimulationEvent[]): undefined {
    this.resources.assertOpen();
    this.presentationLifetime?.presentation.receive(events.filter(event => eventTargetsSeat(event, this.id, this.client.id)));
    return undefined;
  }

  present(snapshot: WorldSnapshot, backend: RendererBackend): RenderFrame {
    this.resources.assertOpen();
    if (snapshot.session !== this.id.session) throw new RangeError("Snapshot belongs to another session");
    const presentation = this.presentationLifetime?.presentation;
    if (presentation === undefined) throw new Error("Seat has no presentation");
    const frame = presentation.frame(snapshot);
    presentation.render(frame, backend);
    return frame;
  }

  close(): undefined { return this.resources.close(); }
}

export function eventTargetsSeat(event: SimulationEvent, seat: SeatId, client: ClientId): boolean {
  switch (event.audience.kind) {
    case "world": return true;
    case "seat": return event.audience.seat.equals(seat);
    case "client": return event.audience.client.equals(client);
    default: { const exhaustive: never = event.audience; return exhaustive; }
  }
}

export type SessionMode = { readonly kind: "headless" } | { readonly kind: "local" };

/** One session calls one simulation. Presentation never advances the simulation. */
export class EngineSession implements SessionResource {
  readonly resources = new ResourceScope("Session resources");
  readonly session: SessionId;
  private readonly clients = new Map<number, SessionClient>();
  private readonly preparedClients = new Map<SessionClient, SessionClient | null>();
  private readonly seats = new Map<number, SessionSeat>();
  private readonly preparedSeats = new Map<SessionSeat, SessionSeat | null>();
  private readonly generations = new Map<number, number>();
  private currentWorld: WorldLifetime | null = null;
  private published: WorldSnapshot | null = null;
  private stepping = false;

  constructor(private readonly identity: IdentityOwner, readonly mode: SessionMode) {
    this.session = identity.session;
    this.resources.defer(() => closeAll([...this.clients.values()].reverse(), "Client shutdown failed"));
    this.resources.defer(() => closeAll([...this.preparedClients.keys()].reverse(), "Prepared client shutdown failed"));
    this.resources.defer(() => closeAll([...this.preparedSeats.keys()].reverse(), "Prepared seat shutdown failed"));
    this.resources.defer(() => closeAll([...this.seats.values()].reverse(), "Seat shutdown failed"));
    this.resources.defer(() => this.closeWorld());
  }

  get isClosed(): boolean { return this.resources.isClosed; }
  get world(): WorldLifetime | null { return this.currentWorld; }
  get snapshot(): WorldSnapshot | null { return this.published; }

  clientAt(slot: number): SessionClient | null {
    const client = this.clients.get(slot);
    return client === undefined || client.isClosed ? null : client;
  }

  attachWorld(simulation: Simulation): WorldLifetime {
    const replacement = this.replaceWorld(simulation);
    replacement.retired.close();
    return replacement.world;
  }

  validateWorldReplacement(simulation: Simulation, presentations: Parameters<EngineSession["replaceWorld"]>[1] = [],
    clients: Parameters<EngineSession["replaceWorld"]>[2] = { added: [], removed: [] },
    seats: Parameters<EngineSession["replaceWorld"]>[3] = { added: [], removed: [] }): void {
    this.resources.assertOpen();
    if (this.stepping) throw new Error("Cannot replace a world during simulation.step");
    if (simulation.session !== this.session) throw new RangeError("Simulation belongs to another session");
    if (this.currentWorld?.simulation === simulation) throw new Error("Simulation is already attached");
    this.validateOwnershipChange(presentations, clients, seats);
  }

  private validateOwnershipChange(presentations: NonNullable<Parameters<EngineSession["replaceWorld"]>[1]>,
    clients: NonNullable<Parameters<EngineSession["replaceWorld"]>[2]>, seats: NonNullable<Parameters<EngineSession["replaceWorld"]>[3]>): void {
    const additions = new Map<number, SessionClient>();
    const removals = new Set<SessionClient>();
    const seatAdditions = new Map<number, SessionSeat>();
    const seatRemovals = new Set<SessionSeat>();
    for (const seat of seats.removed) {
      if (seatRemovals.has(seat)) throw new Error("Duplicate retired seat");
      if (seat.isClosed || this.seats.get(seat.id.index) !== seat) throw new Error("Retired seat is not owned by this session");
      seatRemovals.add(seat);
    }
    for (const client of clients.removed) {
      if (removals.has(client)) throw new Error("Duplicate retired client");
      if (client.isClosed || this.clients.get(client.id.slot) !== client) throw new Error("Retired client is not owned by this session");
      if ([...this.seats.values()].some(seat => seat.client === client && !seat.isClosed && !seatRemovals.has(seat))) throw new Error("Cannot retire a client with a local seat during world replacement");
      removals.add(client);
    }
    for (const client of clients.added) {
      const incumbent = this.preparedClients.get(client);
      if (client.isClosed || incumbent === undefined) throw new Error("Replacement client was not prepared by this session");
      if (additions.has(client.id.slot)) throw new Error("Duplicate prepared client slot");
      const existing = this.clients.get(client.id.slot);
      if (incumbent !== null && (existing !== incumbent || !removals.has(incumbent))) throw new Error("Prepared client incumbent changed or is not retired");
      if (incumbent === null && existing !== undefined && !existing.isClosed) throw new Error(`Client slot ${client.id.slot} is occupied`);
      additions.set(client.id.slot, client);
    }
    for (const seat of seats.added) {
      const incumbent = this.preparedSeats.get(seat);
      if (seat.isClosed || incumbent === undefined) throw new Error("Replacement seat was not prepared by this session");
      if (seatAdditions.has(seat.id.index)) throw new Error("Duplicate prepared seat slot");
      if (seat.client.isClosed || removals.has(seat.client)
        || (this.clients.get(seat.client.id.slot) !== seat.client && additions.get(seat.client.id.slot) !== seat.client)) throw new Error("Replacement seat client is not published by this transition");
      seat.client.validateSeatBinding(seat);
      const existing = this.seats.get(seat.id.index);
      if (incumbent !== null && (existing !== incumbent || !seatRemovals.has(incumbent))) throw new Error("Prepared seat incumbent changed or is not retired");
      if (incumbent === null && existing !== undefined && !existing.isClosed) throw new Error(`Seat ${seat.id.index} is occupied`);
      seatAdditions.set(seat.id.index, seat);
    }
    const presented = new Set<SessionSeat>();
    for (const entry of presentations) {
      if (seatRemovals.has(entry.seat) || (this.seats.get(entry.seat.id.index) !== entry.seat && seatAdditions.get(entry.seat.id.index) !== entry.seat)) throw new Error("Presentation seat is not owned by this session");
      if (presented.has(entry.seat)) throw new Error("Duplicate replacement presentation");
      entry.seat.validatePresentation(entry.presentation);
      presented.add(entry.seat);
    }
  }

  replaceWorld(simulation: Simulation, presentations: readonly {
    readonly seat: SessionSeat;
    readonly presentation: SeatPresentation;
    readonly cleanup: () => undefined;
  }[] = [], clients: { readonly added: readonly SessionClient[]; readonly removed: readonly SessionClient[] } = { added: [], removed: [] },
    seats: { readonly added: readonly SessionSeat[]; readonly removed: readonly SessionSeat[] } = { added: [], removed: [] }): {
    readonly world: WorldLifetime; readonly retired: SessionResource;
  } {
    this.validateWorldReplacement(simulation, presentations, clients, seats);
    const additions = new Map(clients.added.map(client => [client.id.slot, client]));
    const removals = new Set(clients.removed);
    const nextPresentations = new Map<SessionSeat, PresentationLifetime>();
    for (const entry of presentations) {
      const resources = new ResourceScope(`Seat ${entry.seat.id.index} presentation`);
      resources.defer(entry.cleanup);
      nextPresentations.set(entry.seat, { presentation: entry.presentation, resources });
    }
    const world = new WorldLifetime(simulation);
    const retired: SessionResource[] = [];
    if (this.currentWorld !== null) retired.push(this.currentWorld);
    for (const seat of seats.removed) { this.seats.delete(seat.id.index); retired.push(seat); }
    for (const seat of seats.added) { seat.client.bindSeat(seat); this.seats.set(seat.id.index, seat); this.preparedSeats.delete(seat); }
    for (const seat of this.seats.values()) {
      const previous = seat.replacePresentation(nextPresentations.get(seat) ?? null);
      if (previous !== null) retired.push(previous);
    }
    for (const client of this.clients.values()) {
      if (!client.isClosed && !removals.has(client)) retired.push(client.replaceWorldResources());
    }
    for (const client of removals) { this.clients.delete(client.id.slot); retired.push(client); }
    for (const [slot, client] of additions) { this.clients.set(slot, client); this.preparedClients.delete(client); }
    this.currentWorld = world;
    this.published = null;
    return { world, retired: { close: () => closeAll(retired, "Retired world shutdown failed") } };
  }

  validateLocalSeats(presentations: NonNullable<Parameters<EngineSession["replaceWorld"]>[1]>,
    clients: NonNullable<Parameters<EngineSession["replaceWorld"]>[2]>, seats: NonNullable<Parameters<EngineSession["replaceWorld"]>[3]>): void {
    this.resources.assertOpen();
    if (this.stepping) throw new Error("Cannot change local seats during simulation.step");
    if (this.currentWorld?.isClosed) throw new Error("Local seat publication cannot use a retired world");
    this.validateOwnershipChange(presentations, clients, seats);
  }

  /** Publish only changed seats; the current simulation, snapshot and retained client scopes survive. */
  publishLocalSeats(presentations: NonNullable<Parameters<EngineSession["replaceWorld"]>[1]>,
    clients: NonNullable<Parameters<EngineSession["replaceWorld"]>[2]>, seats: NonNullable<Parameters<EngineSession["replaceWorld"]>[3]>): SessionResource {
    this.validateLocalSeats(presentations, clients, seats);
    const retired: SessionResource[] = [];
    for (const seat of seats.removed) { this.seats.delete(seat.id.index); retired.push(seat); }
    for (const client of clients.removed) { this.clients.delete(client.id.slot); retired.push(client); }
    for (const client of clients.added) { this.clients.set(client.id.slot, client); this.preparedClients.delete(client); }
    for (const seat of seats.added) { seat.client.bindSeat(seat); this.seats.set(seat.id.index, seat); this.preparedSeats.delete(seat); }
    for (const entry of presentations) {
      const resources = new ResourceScope(`Seat ${entry.seat.id.index} presentation`); resources.defer(entry.cleanup);
      const previous = entry.seat.replacePresentation({ presentation: entry.presentation, resources });
      if (previous !== null) retired.push(previous);
    }
    let closed = false;
    return { close: () => { if (closed) return undefined; closed = true; return closeAll(retired, "Retired local seats shutdown failed"); } };
  }

  detachWorld(): SessionResource {
    const retired: SessionResource[] = [];
    if (this.currentWorld !== null) retired.push(this.currentWorld);
    this.currentWorld = null;
    this.published = null;
    for (const seat of this.seats.values()) {
      const previous = seat.replacePresentation(null);
      if (previous !== null) retired.push(previous);
    }
    for (const client of this.clients.values()) {
      if (!client.isClosed) retired.push(client.replaceWorldResources());
    }
    return { close: () => closeAll(retired, "World replacement failed") };
  }

  closeWorld(): undefined {
    return this.detachWorld().close();
  }

  prepareClient(slot: number, retiring?: SessionClient): SessionClient {
    this.resources.assertOpen();
    const existing = this.clients.get(slot);
    if (retiring !== undefined && (existing !== retiring || retiring.isClosed)) throw new Error("Retiring client is not the current slot owner");
    if (retiring === undefined && existing !== undefined && !existing.isClosed) throw new Error(`Client slot ${slot} is occupied`);
    const generation = (this.generations.get(slot) ?? -1) + 1;
    const id = this.identity.client(slot, generation);
    const client = new SessionClient(id);
    this.generations.set(slot, generation);
    this.preparedClients.set(client, retiring ?? null);
    client.resources.defer(() => {
      this.preparedClients.delete(client);
      return closeAll([...this.preparedSeats.keys()].filter(seat => seat.client === client), "Prepared client seats shutdown failed");
    });
    return client;
  }

  createClient(slot: number): SessionClient {
    const client = this.prepareClient(slot);
    this.clients.set(slot, client);
    this.preparedClients.delete(client);
    return client;
  }

  closeClient(id: ClientId): undefined {
    const client = this.clients.get(id.slot);
    if (client === undefined || !client.id.equals(id)) return undefined;
    const bound: SessionResource[] = [];
    for (const [index, seat] of this.seats) {
      if (seat.client === client) { this.seats.delete(index); bound.push(seat); }
    }
    this.clients.delete(id.slot);
    return closeAll([...bound.reverse(), client], "Client shutdown failed");
  }

  createSeat(index: number, client: SessionClient): SessionSeat {
    if (this.clients.get(client.id.slot) !== client || client.isClosed) throw new RangeError("Client is not owned by this session");
    const seat = this.prepareSeat(index, client);
    client.bindSeat(seat);
    this.seats.set(index, seat);
    this.preparedSeats.delete(seat);
    return seat;
  }

  prepareSeat(index: number, client: SessionClient, retiring?: SessionSeat): SessionSeat {
    this.resources.assertOpen();
    if (this.mode.kind === "headless") throw new Error("Headless sessions do not have local seats");
    if ((this.clients.get(client.id.slot) !== client && !this.preparedClients.has(client)) || client.isClosed) throw new RangeError("Client is not owned by this session");
    const previous = this.seats.get(index);
    if (retiring !== undefined && (previous !== retiring || retiring.isClosed)) throw new Error("Retiring seat is not the current index owner");
    if (retiring === undefined && previous !== undefined && !previous.isClosed) throw new Error(`Seat ${index} is occupied`);
    const seat = new SessionSeat(this.identity.seat(index), client);
    this.preparedSeats.set(seat, retiring ?? null);
    seat.resources.defer(() => { this.preparedSeats.delete(seat); return undefined; });
    return seat;
  }

  closeSeat(id: SeatId): undefined {
    const seat = this.seats.get(id.index);
    if (seat === undefined || !seat.id.equals(id)) return undefined;
    this.seats.delete(id.index);
    return seat.close();
  }

  step(input: InputBatch): SimulationOutput {
    const world = this.beginStep();
    try { return this.completeStep(world, world.simulation.step(input)); }
    finally { this.stepping = false; }
  }

  async stepAsync(input: InputBatch): Promise<SimulationOutput> {
    const world = this.beginStep();
    try {
      const output = await (world.simulation.stepAsync?.(input) ?? world.simulation.step(input));
      return this.completeStep(world, output);
    } finally { this.stepping = false; }
  }

  private beginStep(): WorldLifetime {
    this.resources.assertOpen();
    if (this.stepping) throw new Error("Simulation step is already running");
    const world = this.currentWorld;
    if (world === null || world.isClosed) throw new Error("Session has no active simulation");
    this.stepping = true;
    return world;
  }

  private completeStep(world: WorldLifetime, output: SimulationOutput): SimulationOutput {
    if (this.isClosed || this.currentWorld !== world || world.isClosed) throw new Error("Simulation closed during its step");
    this.publish(output);
    return output;
  }

  /** Remote clients publish decoded snapshots through this path without a local server loop. */
  publish(output: SimulationOutput): undefined {
    this.resources.assertOpen();
    if (output.snapshot.session !== this.session) throw new RangeError("Snapshot belongs to another session");
    this.published = output.snapshot;
    for (const seat of [...this.seats.values()]) {
      if (this.isClosed) break;
      if (!seat.isClosed && !seat.client.isClosed) seat.receive(output.events);
    }
    return undefined;
  }

  close(): undefined {
    if (this.isClosed) return undefined;
    try { return this.resources.close(); }
    finally { this.clients.clear(); this.preparedClients.clear(); this.preparedSeats.clear(); this.seats.clear(); this.published = null; }
  }
}
