import { expect, test } from 'bun:test';
import { NetQuakeRecordingState } from '../../../src/network/q1/recording.ts';
import { NetQuakeDecoder } from '../../../src/network/q1/netquake.ts';
import { QuakeWorldRecordingState } from '../../../src/network/q1/qw-recording.ts';
import { QuakeWorldDecoder } from '../../../src/network/q1/quakeworld.ts';
import type { Q1ProtocolIdentity } from '../../../src/contracts/protocol.ts';
import type { QwServerData } from '../../../src/app/bootstrap/network/qw-types.ts';

const protocols: readonly Q1ProtocolIdentity[] = [{ kind: 'q1-netquake', version: 15 }, { kind: 'q1-fitzquake', version: 666 }, { kind: 'q1-rmq', version: 999, flags: 0 }];
for (const protocol of protocols) test(`NetQuake recording retains current signon fields on protocol ${protocol.version}`, () => {
  const state = new NetQuakeRecordingState();
  expect(() => state.seed(protocol)).toThrow('server info');
  state.observe([{ kind: 'server-info', protocol, maxClients: 1, gameType: 0, level: 'start', models: ['maps/start.bsp'], sounds: [] },
    { kind: 'name', slot: 0, value: 'first' }, { kind: 'stat', index: 0, value: 100 }, { kind: 'set-view', entity: 1 }]);
  state.observe([{ kind: 'name', slot: 0, value: 'current' }, { kind: 'stat', index: 0, value: 75 }]);
  const decoder = new NetQuakeDecoder(), messages = state.seed(protocol).flatMap(bytes => decoder.decode(bytes));
  expect(decoder.protocol).toEqual(protocol);
  expect(messages.filter(message => message.kind === 'name')).toEqual([{ kind: 'name', slot: 0, value: 'current' }]);
  expect(messages.filter(message => message.kind === 'stat')).toEqual([{ kind: 'stat', index: 0, value: 75 }]);
  expect(messages.filter(message => message.kind === 'signon')).toEqual([{ kind: 'signon', stage: 1 }, { kind: 'signon', stage: 2 }, { kind: 'signon', stage: 3 }]);
  state.observe([{ kind: 'server-info', protocol, maxClients: 1, gameType: 0, level: 'e1m1', models: ['maps/e1m1.bsp'], sounds: [] }]);
  expect(state.seed(protocol).flatMap(bytes => decoder.decode(bytes)).some(message => message.kind === 'name')).toBe(false);
});

test('QuakeWorld recording seed carries spectator identity, complete paged lists and current info', () => {
  const data: QwServerData = { kind: 'server-data', protocol: { kind: 'q1-quakeworld', version: 28 }, serverCount: 7, gameDirectory: 'id1', playerSlot: 3, spectator: true, level: 'start',
    moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } };
  const state = new QuakeWorldRecordingState();
  state.observe([data, { kind: 'userinfo', slot: 3, userId: 6, value: '\\name\\old' }, { kind: 'set-info', slot: 3, key: 'name', value: 'stale' }]);
  state.observe([{ kind: 'userinfo', slot: 3, userId: 6, value: '\\name\\new' }]);
  const records = state.seed(data, ['maps/start.bsp', 'progs/player.mdl'], [], 4, 20, 40), decoder = new QuakeWorldDecoder();
  const messages = records.flatMap(record => record.kind === 'packet' ? decoder.decode(record.message.subarray(8), new DataView(record.message.buffer).getInt32(0, true)) : []);
  expect(messages[0]).toMatchObject({ kind: 'server-data', spectator: true, playerSlot: 3 });
  expect(messages.filter(message => message.kind === 'model-list')).toEqual([{ kind: 'model-list', first: 0, names: ['maps/start.bsp'], next: 1 }, { kind: 'model-list', first: 1, names: ['progs/player.mdl'], next: 0 }]);
  expect(messages.some(message => message.kind === 'set-info')).toBe(false);
  expect(records.at(-1)).toEqual({ kind: 'sequences', seconds: 4, outgoing: 20, incoming: 40 });
});
