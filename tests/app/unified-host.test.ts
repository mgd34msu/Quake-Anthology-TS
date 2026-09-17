import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import type { ContentId } from '../../src/contracts/content.ts';
import { unifiedPresentationFor } from '../../src/app/bootstrap/simulation/network-unified.ts';
import type { SimulationPresentationEvent } from '../../src/app/bootstrap/simulation/types.ts';

test('unified host filters private source UI while retaining public effects and server ownership', () => {
  const owner = createIdentityOwner('unified-audience'), actor = owner.actor(1, 0), other = owner.actor(2, 0), client = owner.client(0, 0);
  const content: ContentId = 'q2:classic:baseq2:fixture', base = { sequence: 0, content, seconds: 0 };
  const visible = (event: SimulationPresentationEvent): boolean => unifiedPresentationFor(actor, client, event);
  expect(visible({ ...base, kind: 'q2-player', event: { kind: 'inventory', actor: other, entries: [] } })).toBe(false);
  expect(visible({ ...base, kind: 'q2-player', event: { kind: 'inventory', actor, entries: [] } })).toBe(true);
  expect(visible({ ...base, kind: 'q2-composition', event: { kind: 'missionpack-player', event: { kind: 'ir', actor: other, until: 5 } } })).toBe(false);
  expect(visible({ ...base, kind: 'q2-composition', event: { kind: 'ctf', event: { kind: 'grapple-cable', actor: other, start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, offset: { x: 0, y: 0, z: 0 } } } })).toBe(true);
  expect(visible({ ...base, kind: 'q2-composition', event: { kind: 'kick', actor } })).toBe(false);
  expect(visible({ ...base, kind: 'q2-rerelease', event: { kind: 'autosave' } })).toBe(false);
  expect(visible({ ...base, kind: 'q1', event: { kind: 'server-command', text: 'map next' } })).toBe(false);
  expect(visible({ ...base, kind: 'q1-composition', event: { kind: 'addon', event: { kind: 'punch-angle', player: other, angles: { x: 1, y: 0, z: 0 } } } })).toBe(false);
  expect(visible({ ...base, kind: 'q3-source', event: { kind: 'console-command', execution: 'now', text: 'quit' } })).toBe(false);
  expect(visible({ ...base, kind: 'q3-source', event: { kind: 'server-command', client: 1, text: 'cp private' } })).toBe(false);
  expect(visible({ ...base, kind: 'q3-source', event: { kind: 'server-command', client: -1, text: 'cp public' } })).toBe(true);
});
