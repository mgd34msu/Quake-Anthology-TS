import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import { expect, test } from 'bun:test';
import { Q2RemotePresentation } from '../../../src/app/bootstrap/network/remote.ts';
import { Q1RemotePresentation } from '../../../src/app/bootstrap/network/remote-q1.ts';
import { QwRemotePresentation } from '../../../src/app/bootstrap/network/remote-qw.ts';
import { Q3RemotePresentation } from '../../../src/app/bootstrap/network/remote-q3.ts';
import { SessionActorRegistry } from '../../../src/world/actors/registry.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import type { Q2ServerRecord } from '../../../src/network/q2/index.ts';

test('Q2 connecting records retain server metadata and prints before any world is admitted', () => {
    const identity = createIdentityOwner('Q2 preworld records'), session = new EngineSession(identity, { kind: 'headless' });
    const prints: string[] = [];
    const remote = new Q2RemotePresentation({ identity, session, client: session.createClient(0), nextGeneration: slot => nextActorGeneration(session.session, slot), content: null, protocol: { kind: 'q2-classic', version: 34 },
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

test('remote presenters retain the supplied client and seat across peer replacement', async () => {
    const identity = createIdentityOwner('persistent remote client'), session = new EngineSession(identity, { kind: 'local' });
    const client = session.createClient(0), seat = session.createSeat(0, client);
    const local = new SessionActorRegistry(identity);
    const oldLocal = local.allocate('q1:local', 'q1:player').id;
    const checkpoint = local.checkpoint();
    local.close();
    const rejected = new SessionActorRegistry(identity);
    const rejectedActor = rejected.allocate('q1:local', 'q1:player').id;
    rejected.close();
    const options = { identity, session, client, content: null,
        nextGeneration: (slot: number): number => nextActorGeneration(session.session, slot),
        loadContent: async () => { throw new Error('Admission must not load content in this lifecycle test'); },
        userinfo: () => '', print() {}, sendCommand() {}, publish: (output: import('../../../src/contracts/session.ts').SimulationOutput) => session.publish(output), disconnected: () => { disconnects++; } };
    let disconnects = 0;
    try {
        const first = new Q3RemotePresentation({ ...options, disconnected: () => { client.disconnect(); } });
        client.connect('remote');
        expect(first.client).toBe(client);
        const firstActor = first.actorAt(0);
        expect(firstActor.equals(oldLocal)).toBe(false);
        expect(firstActor.generation).toBeGreaterThan(oldLocal.generation);
        expect(firstActor.generation).toBeGreaterThan(rejectedActor.generation);
        let retired = 0;
        client.worldResources.defer(() => { retired++; return undefined; });
        const connection = client.connection;
        first.disconnected('replace');
        expect(connection?.isClosed).toBe(true);
        expect(retired).toBe(1);
        expect(client.isClosed).toBe(false);
        expect(seat.isClosed).toBe(false);

        const retained = client.connect('demo');
        const q1 = new Q1RemotePresentation(options);
        expect(client.connection).toBe(retained);
        expect(retained.isClosed).toBe(false);
        await q1.receive([{ kind: 'set-view', entity: 1 }], 0);
        const q1Actor = q1.player?.actor;
        expect(q1.client).toBe(client);
        expect(q1Actor?.slot).toBe(firstActor.slot);
        expect(q1Actor?.generation).toBeGreaterThan(firstActor.generation);
        q1.disconnected('replace');
        expect(disconnects).toBe(1);
        expect(client.connection).toBe(retained);
        expect(retained.isClosed).toBe(false);

        const qw = new QwRemotePresentation({ ...options,
            skinOptions: { read: async () => null, noskins: () => 0, baseskin: () => 'base', allskins: () => '' },
            prepareServerData: async () => {}, mapChecksum: async () => 0 });
        expect(qw.client).toBe(client);
        await qw.shared.receive([{ kind: 'set-view', entity: 1 }], 0);
        expect(qw.player?.actor.generation).toBeGreaterThan(q1Actor?.generation ?? -1);
        qw.disconnected('replace');
        expect(disconnects).toBe(2);
        expect(client.connection).toBe(retained);
        expect(retained.isClosed).toBe(false);
        client.disconnect();
        expect(retained.isClosed).toBe(true);

        const q2 = new Q2RemotePresentation({ ...options, protocol: { kind: 'q2-classic', version: 34 },
            prepareServerData: async () => { throw new Error('No server data'); } });
        expect(q2.client).toBe(client);
        q2.disconnected('replace');

        const second = new Q3RemotePresentation({ ...options, disconnected: () => { client.disconnect(); } });
        client.connect('remote');
        const secondActor = second.actorAt(0);
        expect(secondActor.equals(firstActor)).toBe(false);
        expect(secondActor.generation).toBeGreaterThan(firstActor.generation);
        await second.clearActive(() => session.resources.assertOpen());
        const afterWorldReset = second.actorAt(0);
        expect(afterWorldReset.slot).toBe(secondActor.slot);
        expect(afterWorldReset.generation).toBeGreaterThan(secondActor.generation);
        session.closeWorld();
        expect(seat.client).toBe(client);
        expect(seat.isClosed).toBe(false);
        expect(client.isClosed).toBe(false);
        const replacementLocal = new SessionActorRegistry(identity);
        try {
            expect(replacementLocal.allocate('q1:local', 'q1:player').id.generation).toBeGreaterThan(afterWorldReset.generation);
        } finally { replacementLocal.close(); }
        const restored = SessionActorRegistry.restore(identity, checkpoint, []);
        try {
            const saved = { slot: oldLocal.slot, generation: oldLocal.generation };
            const restoredActor = restored.resolveSaved(saved);
            if (restoredActor === null) throw new Error('Saved actor did not restore');
            expect(restoredActor.id.generation).toBeGreaterThan(afterWorldReset.generation);
            expect(restored.referenceSaved(saved)).toBe(restoredActor.id);
            expect(restored.isLive(firstActor)).toBe(false);
            expect(restored.isLive(secondActor)).toBe(false);
        } finally { restored.close(); }
    } finally { session.close(); }
    expect(seat.isClosed).toBe(true);
    expect(client.isClosed).toBe(true);
});
