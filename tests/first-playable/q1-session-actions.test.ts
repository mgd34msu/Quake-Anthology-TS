import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import { q1SessionDepartures, sourceLevelCompletion } from '../../src/app/bootstrap/q1-session-actions.ts';
import type { SimulationPresentationEvent } from '../../src/app/bootstrap/simulation/types.ts';

test('source session controls preserve recipients, duplicate delivery and actor generations', () => {
  const ids = createIdentityOwner('session-services'), first = ids.actor(1, 0), second = ids.actor(2, 0);
  const seats = [{ actor: first, seat: ids.seat(0) }, { actor: second, seat: ids.seat(1) }];
  const broadcast = { kind: 'q1-session', content: 'q1:classic:mod:installed', sequence: 1, seconds: 1,
    event: { kind: 'back-to-lobby' } } satisfies SimulationPresentationEvent;
  const targeted = { ...broadcast, recipient: second };
  expect(q1SessionDepartures([targeted, targeted], seats)).toEqual([ids.seat(1)]);
  expect(q1SessionDepartures([broadcast], seats)).toEqual(seats.map(local => local.seat));
  expect(q1SessionDepartures([{ ...broadcast, recipient: ids.actor(2, 1) }], seats)).toEqual([]);
  expect(q1SessionDepartures([broadcast], [])).toEqual([]);
  expect(sourceLevelCompletion({ ...broadcast, event: { kind: 'level-completed' } })).toBe('q1');
  expect(sourceLevelCompletion(broadcast)).toBeNull();
});
