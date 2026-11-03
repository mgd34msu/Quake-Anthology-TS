import { expect, test } from 'bun:test';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { RecordedRemoteSource } from '../../../src/app/bootstrap/network/recorded-source.ts';
import { Q1RemotePresentation } from '../../../src/app/bootstrap/network/remote-q1.ts';
import type { DemoCompletion } from '../../../src/app/bootstrap/demo-commands.ts';

test('a NetQuake demo cut inside its last record ends as truncated instead of throwing', async () => {
  const cvars = new CvarRegistry({ dialect: 'q3', context: { session: createIdentityOwner('truncated-demo').session, origin: { kind: 'server-console' } } });
  const bytes = new Uint8Array([0x2d, 0x31, 0x0a, 0x40, 0x00, 0x00, 0x00, 1, 2, 3]);
  const reasons: DemoCompletion[] = [];
  const prototype: object = Q1RemotePresentation.prototype, created: unknown = Object.create(prototype);
  if (!(created instanceof Q1RemotePresentation)) throw new Error('Expected a Q1RemotePresentation instance');
  const remote = created;
  const source = new RecordedRemoteSource({ kind: 'q1', path: 'cut.dem', bytes }, remote, false, cvars, reason => { reasons.push(reason); });
  await source.advance(16, 1, 16);
  expect(reasons).toEqual(['truncated']);
  expect(source.phase).toBe('closed');
});
