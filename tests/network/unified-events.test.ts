import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../src/contracts/identity.ts';
import { createContentId } from '../../src/contracts/content.ts';
import type { SimulationPresentationEvent } from '../../src/app/bootstrap/simulation/types.ts';
import type { UnifiedIdentityDecoder } from '../../src/app/bootstrap/network/unified-types.ts';
import { unifiedPresentationFor } from '../../src/app/bootstrap/simulation/network-unified.ts';
import { EntityState } from '../../src/network/q3/state/entity.ts';
import { encodeUnifiedPresentationEvents, decodeUnifiedPresentationEvents, writeUnifiedSimulationEvent, readUnifiedSimulationEvent } from '../../src/app/bootstrap/network/unified-event-codec.ts';

test('unified event boundary preserves source payloads and rebuilds only local public identities', () => {
  const server = createIdentityOwner('event-server'), client = createIdentityOwner('event-client');
  const actor = server.actor(3, 7), local = client.actor(12, 9);
  const identity: UnifiedIdentityDecoder = { session: client.session,
    actor(slot, generation) { expect([slot, generation]).toEqual([3, 7]); return local; },
    client: (slot, generation) => client.client(slot, generation), seat: index => client.seat(index),
    resourceId: () => 'resource:local-sound',
  };
  const content = createContentId({ family: 'q3', edition: 'classic', package: 'baseq3', revision: 'test' });
  const common = { sequence: 17, content, seconds: 1.5, sourceEntity: null };
  const state = new EntityState(); state.event = 23; state.origin = { x: 1, y: 2, z: 3 }; state.pos = { ...state.pos, delta: { x: 4, y: 5, z: 6 } };
  const events: readonly SimulationPresentationEvent[] = [
    { ...common, recipient: actor, kind: 'q1', event: { kind: 'message', player: actor, text: 'score', center: true, args: ['name', 17], parts: [{ text: 'part', args: [2] }] } },
    { ...common, kind: 'q2', event: { kind: 'poi', origin: { x: 1, y: 2, z: 3 }, message: 'target', fields: new Map([['image', 'i_help']]) } },
    { ...common, kind: 'q2-player', event: { kind: 'inventory', actor, entries: [{ item: 'q2:cells', count: -2, capacity: 100, countPolicy: { kind: 'source-counter', arithmetic: 'int32' } }], selected: null, visible: false } },
    { ...common, kind: 'q2-rerelease', event: { kind: 'healthbar', actor, slot: 1, target: actor, name: 'boss', fraction: 0.5, visible: true } },
    { ...common, kind: 'q3-character', event: { actor, sequence: 2, timeMilliseconds: 1500, event: 7, parameter: 9 } },
    { ...common, kind: 'q3-source', event: { kind: 'entity-event', actor, state, origin: state.origin, time: 1500 } },
    { ...common, recipient: actor, kind: 'music', event: { kind: 'pause', paused: true } },
  ];
  const encoded = encodeUnifiedPresentationEvents(events), decoded = decodeUnifiedPresentationEvents(encoded, identity);
  expect(new TextDecoder().decode(encoded)).not.toContain('event-server');
  const q1 = decoded[0], poi = decoded[1], inventory = decoded[2], character = decoded[4], entity = decoded[5];
  if (q1?.kind !== 'q1' || q1.event.kind !== 'message' || poi?.kind !== 'q2' || poi.event.kind !== 'poi'
    || inventory?.kind !== 'q2-player' || inventory.event.kind !== 'inventory' || character?.kind !== 'q3-character'
    || entity?.kind !== 'q3-source' || entity.event.kind !== 'entity-event') throw new Error('Lost event variant');
  expect(q1.recipient).toBe(local);
  const pause = decoded[6];
  expect(pause?.recipient).toBe(local);
  expect(pause?.kind === 'music' && pause.event).toEqual({ kind: 'pause', paused: true });
  if (pause === undefined) throw new Error('Lost music pause');
  expect(unifiedPresentationFor(local, client.client(0, 0), pause)).toBe(true);
  expect(unifiedPresentationFor(client.actor(99, 0), client.client(0, 0), pause)).toBe(false);
  expect(q1.event.player).toBe(local); expect(q1.event.parts).toEqual([{ text: 'part', args: [2] }]);
  expect(poi.event.fields.get('image')).toBe('i_help'); expect(inventory.event.selected).toBeNull(); expect(inventory.event.entries[0]?.count).toBe(-2);
  expect(character.event.actor).toBe(local); expect(entity.event.state.copy().pos.delta).toEqual({ x: 4, y: 5, z: 6 });
  const sound = readUnifiedSimulationEvent(writeUnifiedSimulationEvent({ sequence: 3, time: { kind: 'milliseconds', value: 1500 }, audience: { kind: 'client', client: server.client(1, 2) },
    payload: { kind: 'sound', resource: `resource:unified:${'a'.repeat(64)}`, actor, origin: state.origin, channel: 1, volume: 0.7, attenuation: 1 } }), identity);
  expect(sound.audience.kind === 'client' && client.owns(sound.audience.client)).toBe(true);
  expect(sound.payload.kind === 'sound' && sound.payload.resource).toBe('resource:local-sound');
  expect(() => decodeUnifiedPresentationEvents(new TextEncoder().encode('[{"kind":"unknown"}]'), identity)).toThrow();
  expect(() => readUnifiedSimulationEvent({ sequence: 1, time: { kind: 'seconds', value: 0 }, audience: { kind: 'world' }, payload: { kind: 'sound', resource: 'resource:/private/server/pak0' } }, identity)).toThrow();
});
