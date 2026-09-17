import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { Q3ClientConnection, type Q3ClientBindings } from '../../../src/network/q3/client.ts';
import { q3DemoGamestate } from '../../../src/network/q3/recording.ts';
import { encodeServerMessage } from '../../../src/network/q3/server-message.ts';
import type { Gamestate } from '../../../src/network/q3/server-message.ts';

test('Q3 recording seed preserves gamestate, reliable sequence, client slot and checksum without resetting the live owner', async () => {
  const identity = createIdentityOwner('recording'), states: Gamestate[] = [];
  const bindings: Q3ClientBindings = { assertCurrent() {}, print() {}, clearActive() {}, systemInfo: async () => {},
    gamestate: async state => { states.push(state); }, snapshot() {}, downloadSize: size => size, download: async () => {}, mapRestart() {}, levelShot() {}, localServerRunning: () => false };
  const source = new Q3ClientConnection({ client: identity.client(2, 0), seat: identity.seat(2) }, 'missionpack', { kind: 'network', challenge: 9, qport: 195 }, bindings);
  const initial: Gamestate = { kind: 'gamestate', commandSequence: 8, clientNumber: 2, checksumFeed: 123, entries: [{ kind: 'configstring', index: 0, value: '\\mapname\\mpteam1' }] };
  await source.receiveMessage(20, encodeServerMessage(0, [initial], { product: 'missionpack', messageNumber: 20, reliableSequence: 0, serverCommandSequence: 8, parseEntitiesNumber: 0, baseline: () => null, history: () => null }), 500);
  source.demoWaiting = false;
  const seed = q3DemoGamestate(source);
  expect(seed.sequence).toBe(19); expect(source.serverMessageSequence).toBe(20); expect(source.demoWaiting).toBe(false);
  const replay = new Q3ClientConnection(source.identity, source.product, { kind: 'network', challenge: 9, qport: 195 }, bindings);
  await replay.receiveMessage(seed.sequence, seed.message, 0);
  expect(replay.copyGamestate()).toEqual(source.copyGamestate());
  expect(replay.clientNumber).toBe(2); expect(replay.serverCommandSequence).toBe(8); expect(replay.checksumFeed).toBe(123);
  expect(states).toHaveLength(2);
});
