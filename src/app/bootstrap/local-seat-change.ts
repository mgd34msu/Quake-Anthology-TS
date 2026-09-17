import type { SeatId } from '../../contracts/identity.ts';
import type { EngineSession, SessionClient, SessionSeat, SessionResource } from '../../world/session/index.ts';

export interface LocalSeatIdentity { readonly client: SessionClient; readonly seat: SessionSeat; }
export type LocalSeatRequest = { readonly kind: 'join' } | { readonly kind: 'drop'; readonly seat: SeatId };
export interface PreparedLocalSeatChange {
 readonly added: LocalSeatIdentity | null;
 readonly removed: LocalSeatIdentity | null;
 readonly next: readonly LocalSeatIdentity[];
 readonly published: boolean;
 validate(presentations?: NonNullable<Parameters<EngineSession['publishLocalSeats']>[0]>): void;
 publish(presentations?: NonNullable<Parameters<EngineSession['publishLocalSeats']>[0]>): SessionResource;
 discard(): void;
}

/** Reserve identities before preparing input/assets. Source admission belongs to the caller's commit boundary. */
export function prepareLocalSeatChange(session: EngineSession, current: readonly LocalSeatIdentity[], request: LocalSeatRequest,
 capacity: { readonly localSeats: number; readonly clients: number }): PreparedLocalSeatChange {
 const world = session.world;
 if (world === null || world.isClosed) throw new Error("Local player changes require an active world");
 let added: LocalSeatIdentity | null = null, removed: LocalSeatIdentity | null = null;
 if (request.kind === 'join') {
  let index = 0; while (current.some(local => local.seat.id.index === index)) index++;
  if (index >= capacity.localSeats) throw new Error('All local player slots are occupied');
  let slot = 0; while (slot < capacity.clients && session.clientAt(slot) !== null) slot++;
  if (slot >= capacity.clients) throw new Error('The server has no free player slots');
  const client = session.prepareClient(slot);
  try { added = { client, seat: session.prepareSeat(index, client) }; }
  catch (error) { try { client.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Local player preparation and cleanup failed"); } throw error; }
 } else {
  removed = current.find(local => local.seat.id.equals(request.seat)) ?? null;
  if (removed === null) throw new Error('Local player is no longer active');
 }
 const clients = { added: added === null ? [] : [added.client], removed: removed === null ? [] : [removed.client] };
 const seats = { added: added === null ? [] : [added.seat], removed: removed === null ? [] : [removed.seat] };
 const next = current.filter(local => local !== removed).concat(added === null ? [] : [added]).sort((a,b) => a.seat.id.index-b.seat.id.index);
 let phase: 'prepared' | 'published' | 'discarded' = 'prepared';
 const validate = (presentations: NonNullable<Parameters<EngineSession['publishLocalSeats']>[0]> = []): void => {
  if (phase !== 'prepared') throw new Error(`Local seat change is ${phase}`);
  if (session.world !== world || world.isClosed) throw new Error("Local player world changed during preparation");
  session.validateLocalSeats(presentations, clients, seats);
 };
 return { added, removed, next, get published() { return phase === 'published'; }, validate,
  publish(presentations = []) { validate(presentations); const retired = session.publishLocalSeats(presentations, clients, seats); phase = 'published'; return retired; },
  discard() { if (phase !== 'prepared') return; phase = 'discarded'; added?.client.close(); },
 };
}
