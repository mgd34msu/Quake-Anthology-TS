import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { LoopbackHub } from '../../../src/network/common/loopback.ts';
import { UsercmdT, type EntityStateT } from '../../../src/network/q2/index.ts';
import { Q2ClientNetwork, Q2ServerNetwork } from '../../../src/app/bootstrap/network/q2.ts';
import type { Q2ApplicationServerHost } from '../../../src/app/bootstrap/network/types.ts';

test('Q2 shutdown retires every admitted peer and transport while preserving disconnect failures', async () => {
  const identity = createIdentityOwner('q2-close'), hub = new LoopbackHub(), transport = hub.bind('server');
  const players = [0, 1].map(slot => ({ client: identity.client(slot, 0), actor: identity.actor(slot + 1, 0), sourceEntity: slot + 1 }));
  const failures = [new Error('first disconnect failure'), new Error('second disconnect failure')], disconnected: number[] = [];
  let admitted = 0;
  const host: Q2ApplicationServerHost = {
    protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 2,
    downloads: { allowed: () => false, open: async () => null }, supportsSourceWire: () => ({ kind: 'supported' }), observe: () => {}, print: () => {},
    admit: () => { const player = players[admitted++]; if (player === undefined) throw new Error('Unexpected admission'); return { kind: 'accepted', player }; },
    disconnect: player => { disconnected.push(player.client.slot); throw failures[player.client.slot]; },
    carriedPlayer: client => { const player = players.find(value => value.client.equals(client)); if (player === undefined) throw new Error('Unknown client'); return player; },
    gameState: player => ({ data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: player.client.slot, levelname: 'fixture', serverState: 2 }, configStrings: new Map<number, string>(), baselines: new Map<number, EntityStateT>() }),
    frame: () => { throw new Error('No frames in shutdown fixture'); }, events: () => [], input: () => null, command: () => {}, userinfo: () => {},
  };
  const server = new Q2ServerNetwork({ transport, host, random: () => 0.5 });
  const clients = players.map(player => new Q2ClientNetwork({ transport: hub.bind(`client${player.client.slot}`), remote: transport.address, qport: 100 + player.client.slot,
    host: { protocol: host.protocol, messageOptions: host.messageOptions, userinfo: () => '\\name\\fixture',
      gameState: async () => {}, frame: () => {}, records: () => {}, command: () => new UsercmdT(), disconnected: () => {}, print: () => {} } }));
  try {
    for (let turn = 0; turn < 40 && clients.some(client => client.phase !== 'active'); turn++) {
      for (const client of clients) await client.poll(turn * 100);
      await server.poll(turn * 100);
    }
    expect(clients.map(client => client.phase)).toEqual(['active', 'active']);
    let failure: unknown;
    try { await server.close(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error('Missing aggregate shutdown failure');
    const errors: unknown = failure.errors;
    expect(errors).toEqual(failures);
    expect(disconnected).toEqual([0, 1]); expect(transport.closed).toBe(true);
    await server.close(); expect(disconnected).toHaveLength(2);
  } finally { for (const client of clients) client.close(); try { await server.close(); } finally { hub.close(); } }
});
