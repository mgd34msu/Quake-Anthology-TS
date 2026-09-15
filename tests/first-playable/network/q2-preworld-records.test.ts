import { expect, test } from 'bun:test';
import { Q2RemotePresentation } from '../../../src/app/bootstrap/network/remote.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import type { Q2ServerRecord } from '../../../src/network/q2/index.ts';

test('Q2 connecting records retain server metadata and prints before any world is admitted', () => {
    const identity = createIdentityOwner('Q2 preworld records'), session = new EngineSession(identity, { kind: 'headless' });
    const prints: string[] = [];
    const remote = new Q2RemotePresentation({ identity, session, content: null, protocol: { kind: 'q2-classic', version: 34 },
        userinfo: () => '', print: text => { prints.push(text); }, sendCommand() {},
        prepareServerData: async () => { throw new Error('This record projection must not prepare content'); },
        loadContent: async () => { throw new Error('This record projection must not load a map'); } });
    const events: readonly Q2ServerRecord["event"][] = [
        { kind: 'server-data', data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'Server map', serverState: 2 } },
        { kind: 'config-string', index: 33, value: 'maps/server-owned.bsp' },
        { kind: 'config-string', index: 289, value: 'weapons/blastf1a.wav' },
        { kind: 'print', level: 0, text: 'Connecting\n' },
        { kind: 'print', level: 3, text: 'Welcome from chat\n' },
        { kind: 'inventory', counts: [1, 2] },
        { kind: 'layout', text: 'xv 0 string connecting' },
    ];
    const records: readonly Q2ServerRecord[] = events.map(event => ({ seat: 0, opcode: 0, raw: new Uint8Array(), event }));
    try {
        // The network prints messages before forwarding its record batch.
        for (const { event } of records) if (event.kind === 'print') remote.print(event.text);
        remote.records(records);
        expect(remote.sourceRecords).toBe(records);
        expect(prints).toEqual(['Connecting\n', 'Welcome from chat\n']);
        expect(remote.player).toBeNull();
        expect(remote.output).toBeNull();
        expect(remote.drainPresentationEvents()).toEqual([]);
        expect(() => remote.scene).toThrow('Remote server has not supplied a world');
        const sound = { kind: 'sound', sound: { flags: 0, index: 1, entity: 0, channel: 0, position: null, volume: 1, attenuation: 1, delaySeconds: 0 } } satisfies Q2ServerRecord['event'];
        expect(() => remote.records([{ seat: 0, opcode: 0, raw: new Uint8Array(), event: sound }])).toThrow('Remote server has not supplied a world');
        expect(() => remote.records([{ seat: 0, opcode: 0, raw: new Uint8Array(), event: { ...sound, sound: { ...sound.sound, index: 2 } } }])).toThrow('Q2 sound 2 has no configstring');
    } finally { session.close(); }
});
