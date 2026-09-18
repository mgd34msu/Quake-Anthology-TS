import type { ActorId, SeatId } from '../../contracts/identity.ts';
import type { SimulationPresentationEvent } from './simulation/types.ts';

export function sourceLevelCompletion(source: SimulationPresentationEvent): 'q1' | 'q2' | null {
  if (source.kind === 'q1' && source.event.kind === 'intermission'
    || source.kind === 'q1-session' && source.event.kind === 'level-completed') return 'q1';
  return source.kind === 'q2-rerelease' && source.event.kind === 'end-of-unit' ? 'q2' : null;
}

export function q1SessionDepartures(events: readonly SimulationPresentationEvent[],
  seats: readonly { readonly actor: ActorId; readonly seat: SeatId }[]): readonly SeatId[] {
  return seats.filter(local => events.some(source => source.kind === 'q1-session' && source.event.kind === 'back-to-lobby'
    && (source.recipient === undefined || source.recipient.equals(local.actor)))).map(local => local.seat);
}
