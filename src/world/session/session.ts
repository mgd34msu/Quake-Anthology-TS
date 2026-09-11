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

  bindSeat(seat: SessionSeat): undefined {
    this.resources.assertOpen();
    if (seat.client !== this) throw new RangeError("Seat belongs to another client");
    if (this.seats.has(seat)) throw new Error("Seat is already bound");
    this.seats.add(seat);
    seat.resources.defer(() => { this.seats.delete(seat); return undefined; });
    this.resources.own(seat);
    return undefined;
  }

  connect(kind: SessionConnection["kind"]): SessionConnection {
    this.resources.assertOpen();
    this.disconnect();
    this.resources.assertOpen();
    const connection = new SessionConnection(this.id, kind);
    this.activeConnection = connection;
    return connection;
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
    this.resources.assertOpen();
    const previous = this.activeResources;
    this.activeResources = new ResourceScope("Client world resources");
    return closeAll([{ close: () => this.clearSeatPresentations() }, previous], "Client world shutdown failed");
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
    this.resources.assertOpen();
    if (this.client.isClosed) throw new Error("Seat client is closed");
    if (!presentation.state.seat.equals(this.id) || !presentation.state.client.equals(this.client.id)) {
      throw new RangeError("Presentation belongs to another seat or client");
    }
    this.clearPresentation();
    this.resources.assertOpen();
    const resources = new ResourceScope(`Seat ${this.id.index} presentation`);
    resources.defer(cleanup);
    this.presentationLifetime = { presentation, resources };
    return resources;
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
  private readonly seats = new Map<number, SessionSeat>();
  private readonly generations = new Map<number, number>();
  private currentWorld: WorldLifetime | null = null;
  private published: WorldSnapshot | null = null;
  private stepping = false;

  constructor(private readonly identity: IdentityOwner, readonly mode: SessionMode) {
    this.session = identity.session;
    this.resources.defer(() => closeAll([...this.clients.values()].reverse(), "Client shutdown failed"));
    this.resources.defer(() => closeAll([...this.seats.values()].reverse(), "Seat shutdown failed"));
    this.resources.defer(() => this.closeWorld());
  }

  get isClosed(): boolean { return this.resources.isClosed; }
  get world(): WorldLifetime | null { return this.currentWorld; }
  get snapshot(): WorldSnapshot | null { return this.published; }

  attachWorld(simulation: Simulation): WorldLifetime {
    this.resources.assertOpen();
    if (this.stepping) throw new Error("Cannot replace a world during simulation.step");
    if (simulation.session !== this.session) throw new RangeError("Simulation belongs to another session");
    if (this.currentWorld?.simulation === simulation) throw new Error("Simulation is already attached");
    this.closeWorld();
    this.resources.assertOpen();
    const world = new WorldLifetime(simulation);
    this.currentWorld = world;
    return world;
  }

  closeWorld(): undefined {
    const world = this.currentWorld;
    this.currentWorld = null;
    this.published = null;
    const errors: unknown[] = [];
    try { world?.close(); } catch (error) { errors.push(error); }
    for (const seat of this.seats.values()) {
      try { seat.clearPresentation(); } catch (error) { errors.push(error); }
    }
    for (const client of this.clients.values()) {
      if (!client.isClosed) { try { client.clearWorld(); } catch (error) { errors.push(error); } }
    }
    if (errors.length > 0) throw new AggregateError(errors, "World replacement failed");
    return undefined;
  }

  createClient(slot: number): SessionClient {
    this.resources.assertOpen();
    const existing = this.clients.get(slot);
    if (existing !== undefined && !existing.isClosed) throw new Error(`Client slot ${slot} is occupied`);
    const generation = (this.generations.get(slot) ?? -1) + 1;
    const id = this.identity.client(slot, generation);
    const client = new SessionClient(id);
    this.generations.set(slot, generation);
    this.clients.set(slot, client);
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
    this.resources.assertOpen();
    if (this.mode.kind === "headless") throw new Error("Headless sessions do not have local seats");
    if (this.clients.get(client.id.slot) !== client || client.isClosed) throw new RangeError("Client is not owned by this session");
    const previous = this.seats.get(index);
    if (previous !== undefined && !previous.isClosed) throw new Error(`Seat ${index} is occupied`);
    const seat = new SessionSeat(this.identity.seat(index), client);
    client.bindSeat(seat);
    this.seats.set(index, seat);
    return seat;
  }

  closeSeat(id: SeatId): undefined {
    const seat = this.seats.get(id.index);
    if (seat === undefined || !seat.id.equals(id)) return undefined;
    this.seats.delete(id.index);
    return seat.close();
  }

  step(input: InputBatch): SimulationOutput {
    this.resources.assertOpen();
    if (this.stepping) throw new Error("Simulation step is already running");
    const world = this.currentWorld;
    if (world === null || world.isClosed) throw new Error("Session has no active simulation");
    this.stepping = true;
    try {
      const output = world.simulation.step(input);
      if (this.isClosed || this.currentWorld !== world || world.isClosed) throw new Error("Simulation closed during its step");
      this.publish(output);
      return output;
    } finally { this.stepping = false; }
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
    finally { this.clients.clear(); this.seats.clear(); this.published = null; }
  }
}
