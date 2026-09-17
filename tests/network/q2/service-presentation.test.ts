import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { Q2ServerMessageReader, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { Q2ServerWriteEvent } from '../../../src/network/q2/index.ts';
import type { SimulationPresentationEvent } from '../../../src/app/bootstrap/simulation/types.ts';
import { translateQ2ServiceRecords, type Q2ServicePresentationHost } from '../../../src/app/bootstrap/network/q2-service-presentation.ts';

test('decoded Q2 svc presentation shares state order and retains controls and unresolved actors', () => {
  const identity = createIdentityOwner('q2-service-presentation'), actor = identity.actor(1, 0);
  const reader = new Q2ServerMessageReader({ kind: 'q2-classic', version: 34 }, { maxConfigStrings: 2080, inventorySlots: 256 });
  const configs = new Map<number, string>(), events: SimulationPresentationEvent[] = [];
  let sequence = 9, layout = '', inventory: readonly number[] = [];
  const host: Q2ServicePresentationHost = {
    content: () => 'q2:classic:baseq2:test', seconds: 2, nextSequence: () => sequence++, player: () => ({ actor, sourceEntity: 1 }),
    actor: number => number === 1 ? actor : null, entity: () => null, soundConfigOffset: 288, playerSkinConfigOffset: 1312,
    configString: index => configs.get(index), setConfigString: (index, value) => { configs.set(index, value); },
    setInventory: counts => { inventory = counts; }, setLayout: text => { layout = text; }, emit: event => { events.push(event); },
  };
  const inputs: readonly Q2ServerWriteEvent[] = [
    { kind: 'config-string', index: 1312, value: 'Player\\male/grunt' },
    { kind: 'print', level: 3, text: 'chat' }, { kind: 'center-print', text: 'center' },
    { kind: 'layout', text: 'xv 0 string test' }, { kind: 'inventory', counts: Array.from({ length: 256 }, (_, index) => index === 2 ? 7 : 0) },
    { kind: 'muzzle-flash', entity: 1, flash: 0, monster: false, silenced: false },
    { kind: 'muzzle-flash', entity: 2, flash: 0, monster: false, silenced: false },
    { kind: 'print', level: 2, text: 'console' }, { kind: 'command-text', text: 'echo test\n' }, { kind: 'disconnect' },
  ];
  const records = inputs.flatMap(event => reader.read(encodeQ2ServerEvent(reader.wire, event)));
  const remaining = translateQ2ServiceRecords(records, host);
  expect(configs.get(1312)).toBe('Player\\male/grunt');
  expect(layout).toBe('xv 0 string test'); expect(inventory[2]).toBe(7);
  expect(events.map(event => event.kind)).toEqual(['q2-player', 'q2-player', 'q2', 'q2-weapon']);
  expect(events.map(event => event.sequence)).toEqual([9, 10, 11, 12]);
  expect(remaining.map(record => record.event.kind)).toEqual(['muzzle-flash', 'print', 'command-text', 'disconnect']);
  expect(remaining[0]).toBe(records[6]);
  const clear = reader.read(encodeQ2ServerEvent(reader.wire, { kind: 'config-string', index: 1313, value: '' }));
  expect(translateQ2ServiceRecords(clear, host)).toEqual([]);
  expect(configs.get(1313)).toBe('');
  expect(events).toHaveLength(4);
});
