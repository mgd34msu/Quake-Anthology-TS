import { UnifiedClientNetwork } from './network/unified-client.ts';
import type { ActorCommand, SimulationOutput } from "../../contracts/session.ts";
import type { CvarRegistry } from "../../core/cvars/index.ts";
import { eventTargetsSeat, type SessionConnection, type SessionSeat } from "../../world/session/session.ts";
import { PresentationTime } from "./frame-clock.ts";
import { readFrameTimeControls, sourceFrameMilliseconds } from "./frame-time.ts";
import type { RemoteSeatNetwork, RemoteSeatPresentation } from "./remote-seat-source.ts";

export interface RemoteSeatServices {
  readonly network: RemoteSeatNetwork;
  readonly remote: RemoteSeatPresentation;
  readonly cvars: CvarRegistry;
}

/** One native channel per admitted local player; no authority or platform input owner. */
export class RemoteSeatChannel {
  private closed = false;
  private connection: SessionConnection | null = null;
  private sourceElapsed = 0;
  private sourceFrameElapsed = 0;
  private frameNumber = 0;
  private sourceCvars:CvarRegistry;
  constructor(readonly seat: SessionSeat, readonly clock: PresentationTime, readonly services: RemoteSeatServices) {
    this.sourceCvars=services.cvars;
    if (services.remote.client !== seat.client) throw new Error("Remote channel belongs to another session client");
  }
  adoptCvars(cvars:CvarRegistry):void {if(cvars.context.session!==this.seat.id.session)throw new Error("Remote clock registry belongs to another session");this.sourceCvars=cvars;}
  get elapsedMilliseconds(): number { return this.sourceElapsed; }
  get frameMilliseconds(): number { return this.sourceFrameElapsed; }
  get frames(): number { return this.frameNumber; }
  get active(): boolean { return !this.closed && !this.seat.isClosed && this.services.network.phase === "active"; }
  publishConnection(): SessionConnection | null {
    if (this.closed || this.seat.isClosed || this.seat.client.isClosed) throw new Error("Remote seat has retired");
    if (this.connection !== null) throw new Error("Remote seat connection is already published");
    const replacement = this.seat.client.replaceConnection("remote");
    this.connection = replacement.connection;
    return replacement.retired;
  }
  beginFrame(wallNow: number, wallElapsed: number): void {
    if (this.closed) throw new Error("Remote channel is closed");
    const cvars = this.sourceCvars;
    this.sourceFrameElapsed = sourceFrameMilliseconds(cvars.dialect, wallElapsed, readFrameTimeControls(cvars), { dedicated: false, localServer: false });
    this.sourceElapsed += this.sourceFrameElapsed;
    this.clock.advance(wallNow, wallElapsed, this.sourceFrameElapsed);
    this.frameNumber++;
  }
  async poll(wallNow: number): Promise<void> {
    if (this.closed) return;
    await this.services.network.poll(wallNow);
  }
  submit(command: ActorCommand, wallNow: number): void {
    const source = command.source;
    if (source.kind !== "local-seat" || !source.seat.equals(this.seat.id) || !source.client.equals(this.seat.client.id)) throw new Error("Remote command belongs to another seat");
    const player = this.services.remote.player;
    if (player === null || !player.actor.equals(command.actor)) throw new Error("Remote command belongs to another admitted actor");
    if (!this.active) throw new Error("Remote command has no active connection");
    if(this.services.network instanceof UnifiedClientNetwork)this.services.network.submitTimed([command],wallNow,this.sourceFrameElapsed);
    else this.services.network.submit([command], wallNow);
  }
  receive(output: SimulationOutput): SimulationOutput {
    if (output.snapshot.session !== this.seat.id.session) throw new Error("Remote snapshot belongs to another session");
    const events = output.events.filter(event => eventTargetsSeat(event, this.seat.id, this.seat.client.id))
      .map(event => ({ ...event, audience: { kind: "seat", seat: this.seat.id } satisfies import("../../contracts/session.ts").EventAudience }));
    this.seat.receive(events);
    return { snapshot: output.snapshot, events };
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    try { await this.services.network.close(); } catch (error) { errors.push(error); }
    try { if (this.connection !== null && this.seat.client.connection === this.connection) this.seat.client.disconnect(); } catch (error) { errors.push(error); }
    this.connection = null;
    if (errors.length !== 0) throw new AggregateError(errors, "Remote seat channel cleanup failed");
  }
}

/** Candidate network resources retire without closing retained frontend seats. */
export async function prepareRemoteSeatChannels(seats: readonly SessionSeat[],
  create: (seat: SessionSeat, clock: PresentationTime) => Promise<RemoteSeatServices>): Promise<readonly RemoteSeatChannel[]> {
  if (seats.length < 1 || seats.length > 4) throw new Error("Remote play requires one to four local seats");
  for (const [index, seat] of seats.entries()) {
    if (seat.isClosed || seat.client.isClosed || seats.slice(0,index).some(previous => previous.id.equals(seat.id) || previous.client.id.equals(seat.client.id)))
      throw new Error("Remote channels require distinct live seats and clients");
  }
  const channels: RemoteSeatChannel[] = [];
  try {
    for (const seat of seats) {
      const clock = new PresentationTime(), services = await create(seat, clock);
      try { channels.push(new RemoteSeatChannel(seat, clock, services)); }
      catch (error) { try { await services.network.close(); } catch (cleanup) { throw new AggregateError([error,cleanup], "Remote seat construction cleanup failed"); } throw error; }
    }
    return channels;
  } catch (error) {
    const errors: unknown[] = [error];
    for (const channel of channels.reverse()) try { await channel.close(); } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, "Remote channel preparation failed");
    throw error;
  }
}
