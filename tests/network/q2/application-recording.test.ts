import { Q2GameCallbackError, q2GameCallback } from '../../../src/app/bootstrap/network/types.ts';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import { expandCommandMacros } from '../../../src/core/commands/text.ts';
import { expect, test } from 'bun:test';
import { LoopbackHub } from '../../../src/network/common/loopback.ts';
import { Q2ClientNetwork, Q2ServerNetwork } from '../../../src/app/bootstrap/network/q2.ts';
import { Q2ClientReceiver } from '../../../src/app/bootstrap/network/q2-client-receiver.ts';
import type { Q2ApplicationServerHost, Q2ApplicationClientHost } from '../../../src/app/bootstrap/network/types.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { ActorCommand, SimulationOutput } from '../../../src/contracts/session.ts';
import { EntityStateT, PlayerStateT, UsercmdT, toQ2Command, Q2WireCodec, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { Q2WireFrame } from '../../../src/network/q2/index.ts';

test('Q2 recording preserves reliable messages while waiting for a requested full frame', async () => {
    const identity = createIdentityOwner('q2-recording-wire'), hub = new LoopbackHub(), transport = hub.bind('server'), endpoint = hub.bind('client');
    const player = { client: identity.client(0, 0), actor: identity.actor(1, 0), sourceEntity: 1 };
    const command: ActorCommand = { actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence: 1, command: toQ2Command(new UsercmdT()) };
    const cvars = new CvarRegistry({ dialect: 'q2-classic', context: { session: identity.session, origin: { kind: 'server-console' } } });
    cvars.register('fixture_command', 'say "two words"');
    const clientCommands: string[] = [], guestFailure = new Error('Controlled guest callback failure');
    let frameNumber = 1, reliable = '', begun = 0;
    let raw: readonly { readonly bytes: Uint8Array; readonly reliable: boolean }[] = [];
    const frame = (): Q2WireFrame => ({ serverFrame: frameNumber, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array(), player: new PlayerStateT(), entities: [] });
    const host: Q2ApplicationServerHost = {
        protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 1,
        downloads: { allowed: () => false, open: async () => null }, supportsSourceWire: () => ({ kind: 'supported' }), observe: () => undefined,
        admit: () => ({ kind: 'accepted', player }), disconnect: () => undefined, carriedPlayer: () => player,
        gameState: () => ({ data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'recording', serverState: 2 }, configStrings: new Map<number, string>(), baselines: new Map<number, EntityStateT>() }),
        begin: () => { begun++; }, rawMessages: () => raw,
        frame, events: () => { const text = reliable; reliable = ''; return text === '' ? [] : [{ kind: 'print', level: 2, text }]; },
        expandClientCommand: text => expandCommandMacros(text, name => cvars.variableString(name), () => undefined),
        commandText: (_player, text) => q2GameCallback(() => { if (text === 'fail') throw guestFailure; clientCommands.push(text); }),
        input: () => command, command: () => undefined, userinfo: () => undefined, print: () => undefined,
    };
    const received: Q2WireFrame[] = [];
    const clientHost: Q2ApplicationClientHost = { protocol: host.protocol, messageOptions: host.messageOptions, userinfo: () => '\\name\\Recorder',
        gameState: async () => undefined, frame: value => { received.push(value); }, records: () => undefined,
        command: () => new UsercmdT(), disconnected: () => undefined, print: () => undefined };
    const server = new Q2ServerNetwork({ transport, host, random: () => 0.5 });
    const client = new Q2ClientNetwork({ transport: endpoint, remote: transport.address, host: clientHost, qport: 1200 });
    const output: SimulationOutput = { events: [], snapshot: { session: identity.session,
        frame: { frame: 1, time: { kind: 'seconds', value: 0.1 }, elapsed: { kind: 'seconds', value: 0.1 }, phase: 'frame-exit' },
        actors: [], bodies: [], inventories: [], configurations: [], scene: { session: identity.session, time: { kind: 'seconds', value: 0.1 }, world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } } };
    let now = 0;
    const poll = async (): Promise<void> => { now += 100; await client.poll(now); await server.poll(now); await client.poll(now); };
    try {
        for (let turn = 0; turn < 40 && client.phase !== 'active'; turn++) await poll();
        expect(client.phase).toBe('active'); await server.poll(now); expect(begun).toBe(1);
        server.publish(output, [], now); await client.poll(now);
        expect(received.at(-1)?.serverFrame).toBe(1);
        client.submit([command], now); await poll(); // The server has acknowledged frame 1 before recording begins.
        const seed = client.recording.seed(), packets: Uint8Array[] = [];
        const detach = client.recording.attach({ append: async packet => { if (packet.kind !== 'q2') throw new Error('Wrong family'); packets.push(packet.message); } });
        frameNumber = 2; reliable = 'during pending full frame\n';
        raw = [{ reliable: true, bytes: encodeQ2ServerEvent(new Q2WireCodec(host.protocol), { kind: 'print', level: 2, text: 'opaque guest message\n' }) }];
        server.publish(output, [], now); await client.poll(now);
        expect(received.at(-1)?.deltaFrame).toBe(1);
        expect(client.acknowledgedFrame).toBe(-1);
        client.submit([command], now); await poll();
        raw = []; frameNumber = 3; server.publish(output, [], now); await client.poll(now);
        expect(received.at(-1)?.deltaFrame).toBe(-1);
        detach();
        const playbackFrames: Q2WireFrame[] = [], prints: string[] = [];
        const playback = new Q2ClientReceiver({ ...clientHost, frame: value => { playbackFrames.push(value); }, print: text => { prints.push(text); } }, { kind: 'demo' });
        for (const packet of seed.packets) { if (packet.kind !== 'q2') throw new Error('Wrong family'); await playback.receive(packet.message, 0); }
        for (const packet of packets) await playback.receive(packet, 0);
        expect(playbackFrames.map(value => value.serverFrame)).toEqual([1, 3]);
        expect(playbackFrames.every(value => value.valid !== false)).toBe(true);
        expect(prints).toContain('during pending full frame\n');
        expect(prints.filter(text => text === 'opaque guest message\n')).toHaveLength(1);
        expect(begun).toBe(1);
        playback.close();
        client.command('$fixture_command'); await poll();
        expect(clientCommands).toEqual(['say "two words"']);
        server.publish(output, [], now); await client.poll(now);
        client.command('$fixture_command "unterminated'); await poll();
        expect(clientCommands).toHaveLength(1);
        server.publish(output, [], now); await client.poll(now);
        client.command('fail');
        let failure: unknown;
        try { await poll(); } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(Q2GameCallbackError);
        if (!(failure instanceof Q2GameCallbackError)) throw new Error('Guest failure was swallowed as a packet error');
        expect(failure.cause).toBe(guestFailure);
    } finally { client.close(); server.close(); hub.close(); }
});
