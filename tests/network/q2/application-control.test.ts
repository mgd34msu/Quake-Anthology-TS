import { expect, test } from 'bun:test';
import { LoopbackHub } from '../../../src/network/common/loopback.ts';
import { Q2ServerNetwork } from '../../../src/app/bootstrap/network/q2.ts';
import type { Q2ApplicationServerHost } from '../../../src/app/bootstrap/network/types.ts';
import { q2OutOfBand, readQ2OutOfBand } from '../../../src/network/q2/handshake.ts';

test('Q2 application awaits authenticated rcon and publishes native master status and shutdown', async () => {
    const hub = new LoopbackHub(), endpoint = hub.bind('server'), client = hub.bind('client'), master = hub.bind('master');
    let password = 'first';
    const executed: string[] = [];
    let finish: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const host: Q2ApplicationServerHost = {
        protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 1,
        downloads: { allowed: () => false, open: async () => null }, masters: () => [master.address],
        discovery: { status: () => ({ serverInfo: '\\hostname\\Control\\mapname\\base1', players: [] }), info: () => ({ name: 'Control', map: 'base1', players: 0, maxPlayers: 1 }) },
        administration: { profile: 'classic', rconPassword: () => password, limitedRcon: () => ({ password: '', prefixes: [] }),
            rconRateAllowed: () => true, rechargeRconRate: () => undefined,
            executeRcon: async (command, _limited, output) => { executed.push(command); await pending; output('finished\n'); } },
        supportsSourceWire: () => ({ kind: 'supported' }), observe: () => undefined, print: () => undefined,
        admit: () => ({ kind: 'rejected', reason: 'No game clients in this control test' }), disconnect: () => undefined,
        carriedPlayer: () => { throw new Error('No clients'); }, gameState: () => { throw new Error('No clients'); }, frame: () => { throw new Error('No clients'); },
        events: () => [], input: () => { throw new Error('No clients'); }, command: () => undefined, userinfo: () => undefined,
    };
    const server = new Q2ServerNetwork({ transport: endpoint, host, random: () => 0.5 });
    let pendingDrain: Promise<void> | null = null;
    try {
        client.send(endpoint.address, q2OutOfBand('rcon wrong status'));
        await server.poll(0);
        expect(executed).toEqual([]);
        const denied = client.poll(); if (denied?.kind !== 'packet') throw new Error('Missing refusal');
        expect(readQ2OutOfBand(denied.payload)?.body).toContain('Bad rcon_password');
        const heartbeat = master.poll(); if (heartbeat?.kind !== 'packet') throw new Error('Missing heartbeat');
        expect(readQ2OutOfBand(heartbeat.payload)?.command).toBe('heartbeat');
        expect(new TextDecoder().decode(heartbeat.payload)).toContain('\\hostname\\Control');
        password = 'second';
        client.send(endpoint.address, q2OutOfBand('rcon second status'));
        let completed = false;
        const drain = server.poll(100).then(() => { completed = true; }); pendingDrain = drain;
        await Promise.resolve(); await Promise.resolve();
        expect(executed).toEqual(['status ']); expect(completed).toBe(false);
        finish(); await drain;
        const accepted = client.poll(); if (accepted?.kind !== 'packet') throw new Error('Missing command output');
        expect(readQ2OutOfBand(accepted.payload)?.body).toBe('finished\n');
        expect(master.poll()).toBeNull();
        server.close();
        const shutdown = master.poll(); if (shutdown?.kind !== 'packet') throw new Error('Missing master shutdown');
        expect(readQ2OutOfBand(shutdown.payload)?.command).toBe('shutdown');
    } finally { finish(); try { await pendingDrain; } finally { server.close(); hub.close(); } }
});
