import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QwServerNetwork } from '../../../src/app/bootstrap/network/qw-server.ts';
import { QwClientNetwork } from '../../../src/app/bootstrap/network/qw-client.ts';
import type { QwApplicationServerHost, QwServerMessage } from '../../../src/app/bootstrap/network/qw-server-types.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { QwUserCommand } from '../../../src/contracts/protocol.ts';
import type { ActorCommand, SimulationOutput } from '../../../src/contracts/session.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import type { DatagramTransport } from '../../../src/network/common/transport.ts';
import type { IpAddress } from '../../../src/network/common/endpoint.ts';
import { DownloadFile } from '../../../src/network/services/downloads.ts';
import type { DownloadSource } from '../../../src/network/services/downloads.ts';
import { qwEntity, writeQuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import type { QuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import { QwEntityStateT, U_SOLID } from '../../../src/network/q1/qw-constants.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import { QuakeWorldConnectClient } from '../../../src/network/q1/handshake.ts';
import { QuakeWorldChannel } from '../../../src/network/q1/channels.ts';
import { writeClientStringCommand } from '../../../src/network/q1/session.ts';
import { decodeQuakeWorldClient, writeQuakeWorldMove } from '../../../src/network/q1/commands.ts';
import { SZ_Write } from '../../../src/network/q1/message.ts';

test('native QW transport signs on, recovers command groups, sends deltas, downloads and travels over owned UDP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qw-host-transport-'));
    let server: QwServerNetwork | null = null, client: QwClientNetwork | null = null, secondSocket: UdpTransport | null = null;
    try {
        await mkdir(join(root, 'skins')); const download = Uint8Array.from({ length: 1700 }, (_, index) => index % 251);
        await writeFile(join(root, 'skins/test.pcx'), download);
        const identity = createIdentityOwner('qw-transport'), clientId = identity.client(0, 0), actor = identity.actor(1, 0);
        const wireEntity = new QwEntityStateT(); wireEntity.number = 33; wireEntity.modelindex = 2; wireEntity.flags = U_SOLID;
        const baseline = qwEntity(wireEntity);
        let serverCount = 1, begun = 0, spawned = 0, drop = false, admittedCount = 0, paused = false, overflow = false;
        const pendingReliable: QwServerMessage[] = [];
        const userInfo = new Map<string, string>();
        const spawnStarts: number[] = [];
        const delayed: { resolve: ((source: DownloadSource | null) => void) | null; closed: number } = { resolve: null, closed: 0 };
        let failedReadCloses = 0;
        const groups: { sequence: number; commands: readonly QwUserCommand[] }[] = [], disconnected: string[] = [], prints: string[] = [];
        const records: QuakeWorldMessage[] = [], deliveries: (readonly QuakeWorldMessage[])[] = [], serverCounts: number[] = [], downloaded: number[] = [];
        const host: QwApplicationServerHost = {
            clientInfo: () => userInfo,
            commandPhase: (_player, action) => action(),
            maxClients: 32, get paused() { return paused; }, supportsSourceWire: () => ({ kind: 'supported' }),
            admit: () => { const slot = admittedCount++; return { kind: 'accepted', player: { client: identity.client(slot, 0), actor: identity.actor(slot + 1, 0), slot } }; },
            carriedPlayer: client => ({ client, slot: client.slot, actor: identity.actor(client.slot + 1, serverCount - 1) }),
            disconnect: (_player, reason) => { disconnected.push(reason); }, baselines: () => [baseline],
            prepareDownload: async (_player, path) => {
                if (path === 'skins/read-failure.pcx') return { byteLength: 1, read: () => { throw new Error('Fixture download read failed'); }, close: () => { failedReadCloses++; } };
                if (path === 'skins/delayed.pcx') return new Promise<DownloadSource | null>(resolve => { delayed.resolve = resolve; });
                if (path === 'skins/failure.pcx') throw new Error('Fixture download preparation failed');
                if (path !== 'skins/test.pcx') return null;
                return DownloadFile.open(root, path);
            },
            signon: admitted => ({
                serverData: () => ({ kind: 'server-data', protocol: { kind: 'q1-quakeworld', version: 28 }, serverCount,
                    gameDirectory: 'qw', playerSlot: admitted.slot, spectator: false, level: 'Transport source fixture',
                    moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10,
                        airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } }),
                models: () => ['maps/test.bsp', 'progs/player.mdl'], sounds: () => ['misc/test.wav'],
                signonBuffers: () => { const bytes = new SizeBuf(1450); writeQuakeWorldMessage(bytes, { kind: 'q1-quakeworld', version: 28 }, { kind: 'baseline', state: baseline }); return [bytes.bytes()]; },
                acceptsMapChecksum: checksum => checksum === 0xf0000001,
                spawn: start => { spawnStarts.push(start); spawned++; const bytes = new SizeBuf(1450); writeQuakeWorldMessage(bytes, { kind: 'q1-quakeworld', version: 28 }, { kind: 'stat', index: 0, value: 100 + spawned }); return [bytes.bytes()]; },
                begin: () => { begun++; }, disconnect: reason => { disconnected.push(reason); },
                openDownload: path => DownloadFile.open(root, path)
            }),
            // Native sv_ents.c sets MOREBITS before SOLID; skin change supplies the required low-bit byte.
            frame: () => ({ entities: [{ ...baseline, frame: 4, skin: 1, origin: { x: serverCount * 16, y: 8, z: 24 } }],
                messages: overflow ? [{ kind: 'print', level: 2, text: 'x'.repeat(1600) }] : [], reliable: pendingReliable.splice(0) }),
            commandGroup: (_player, commands, sequence) => { groups.push({ commands, sequence }); }, command: (_player, name, args) => {
                const key = args[0], value = args[1]; if (name === 'setinfo' && key !== undefined && value !== undefined) userInfo.set(key, value);
            },
            observe: () => undefined, print: text => { prints.push(text); }
        };
        const serverSocket = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
        server = new QwServerNetwork({ transport: serverSocket, host, random: () => 123 });
        const clientSocket = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
        const transport: DatagramTransport<IpAddress> = {
            address: clientSocket.address, get closed() { return clientSocket.closed; },
            send: (to, bytes) => {
                if (drop) { drop = false; return true; }
                if (bytes.length > 10 && bytes[10] === 3) {
                    const sequence = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) & 0x7fffffff;
                    const commands = decodeQuakeWorldClient(bytes.subarray(10), { kind: 'q1-quakeworld', version: 28 }, sequence);
                    const body = new SizeBuf(1450);
                    for (const command of commands) {
                        if (command.kind === 'move') writeQuakeWorldMove(body, { kind: 'q1-quakeworld', version: 28 }, { ...command.bundle, lossPercent: 37 }, sequence);
                        else if (command.kind === 'delta') SZ_Write(body, new Uint8Array([5, command.sequence]));
                        else if (command.kind === 'string-command') writeClientStringCommand(body, command.text);
                    }
                    const packet = new Uint8Array(10 + body.cursize); packet.set(bytes.subarray(0, 10)); packet.set(body.bytes(), 10);
                    return clientSocket.send(to, packet);
                }
                return clientSocket.send(to, bytes);
            },
            poll: () => clientSocket.poll(), subscribeReadable: listener => clientSocket.subscribeReadable(listener), close: () => clientSocket.close()
        };
        const native = new QwClientNetwork({ transport, remote: server.address, qport: 27001, userinfo: () => '\\name\\Transport peer\\rate\\10000', host: {
            serverData: async data => { serverCounts.push(data.serverCount); },
            gameState: async (_data, models, sounds) => { expect(models).toEqual(['maps/test.bsp', 'progs/player.mdl']); expect(sounds).toEqual(['misc/test.wav']); return 0xf0000001; },
            receive: async messages => { records.push(...messages); deliveries.push(messages); },
            command: input => { if (input.command.kind !== 'q1-quakeworld') throw new Error('Expected native QW command'); return input.command; },
            disconnected: reason => { disconnected.push(reason); }, print: text => { prints.push(text); },
            downloads: { request: async () => 'available', close: () => undefined,
                receive: async result => { if (result.kind === 'missing') return 'missing'; downloaded.push(...result.bytes); if (result.percent < 100) { native.command('nextdl'); return 'waiting'; } return 'complete'; } }
        } }); client = native;
        const output: SimulationOutput = { events: [], snapshot: { session: identity.session,
            frame: { frame: 1, time: { kind: 'seconds', value: 1 }, elapsed: { kind: 'seconds', value: 0.05 }, phase: 'frame-exit' },
            actors: [], bodies: [], inventories: [], configurations: [], scene: { session: identity.session, time: { kind: 'seconds', value: 1 },
                world: null, entities: [], lights: [], particles: [], lightStyles: [], areaBits: null } } };
        let now = 0;
        const exchange = async (elapsed = 100): Promise<void> => {
            now += elapsed; await native.poll(now); await Bun.sleep(1); await server?.poll(now); server?.publish(output, [], now); await Bun.sleep(1); await native.poll(now);
        };
        for (let i = 0; i < 100 && native.phase !== 'active'; i++) await exchange();
        expect(native.phase).toBe('active'); expect([spawned, begun]).toEqual([1, 1]); expect(server.clients[0]?.client.equals(clientId)).toBe(true);
        expect(records.some(record => record.kind === 'baseline' && record.state.number === 33)).toBe(true);
        expect(records.some(record => record.kind === 'packet-entities' && record.entities[0]?.origin.x === 16 && ((record.entities[0]?.quakeWorldFlags ?? 0) & U_SOLID) !== 0)).toBe(true);
        const move = (impulse: number): ActorCommand => ({ actor, source: { kind: 'remote-client', client: clientId }, sequence: impulse,
            command: { kind: 'q1-quakeworld', milliseconds: 80, angles: { x: 0, y: 90, z: 0 }, forwardMove: 320, sideMove: 0, upMove: 0, buttons: 1, impulse } });
        native.submit([move(1)], now); await exchange();
        drop = true; native.submit([move(2)], now); native.submit([move(3)], now); await exchange();
        expect(groups.at(-1)?.commands.map(command => command.impulse)).toEqual([2, 3]);
        expect(groups.at(-1)?.commands.map(command => command.milliseconds)).toEqual([80, 80]); // Source owner, not transport, splits command time.
        for (let i = 0; i < 5; i++) { native.submit([move(0)], now); await exchange(); }
        expect(records.some(record => record.kind === 'packet-entities' && record.deltaSequence !== null)).toBe(true);
        pendingReliable.push({ kind: 'print', level: 2, text: 'reliable and snapshot' });
        native.submit([move(0)], now); await exchange();
        expect(deliveries.some(messages => messages.some(message => message.kind === 'print' && message.text === 'reliable and snapshot')
            && messages.some(message => message.kind === 'packet-entities'))).toBe(true);
        overflow = true; pendingReliable.push({ kind: 'print', level: 2, text: 'survives overflow' });
        native.submit([move(0)], now); await exchange(); overflow = false;
        expect(server.clients).toHaveLength(1); expect(prints.some(text => text.includes('datagram overflow'))).toBe(true);
        expect(deliveries.some(messages => messages.some(message => message.kind === 'print' && message.text === 'survives overflow')
            && !messages.some(message => message.kind === 'packet-entities'))).toBe(true);
        for (const command of ['rate', 'rate 0', 'rate 99999', 'setinfo rate 600', 'rate']) {
            native.command(command); native.submit([move(0)], now); await exchange();
        }
        for (const text of ['Current rate is 10000\n', 'Net rate set to 500\n', 'Net rate set to 10000\n', 'Current rate is 600\n'])
            expect(records.some(record => record.kind === 'print' && record.text === text)).toBe(true);
        // Exhaust the same source rate budget without advancing host time.
        for (let i = 0; i < 30; i++) { native.submit([move(0)], now); await exchange(0); }
        const choked = deliveries.length;
        native.submit([move(0)], now); await exchange(0); expect(deliveries).toHaveLength(choked);
        paused = true; native.submit([move(0)], now); await exchange(0); expect(deliveries.length).toBeGreaterThan(choked); paused = false;
        native.command('rate 10000'); native.submit([move(0)], now); await exchange(1000);
        native.command('download skins/test.pcx');
        for (let i = 0; i < 70 && downloaded.length < download.length; i++) await exchange();
        expect(new Uint8Array(downloaded)).toEqual(download);
        native.command('download ../outside.pcx');
        for (let i = 0; i < 20 && !records.some(record => record.kind === 'download' && record.result.kind === 'missing'); i++) await exchange();
        expect(records.some(record => record.kind === 'download' && record.result.kind === 'missing')).toBe(true);
        const failedBefore = records.filter(record => record.kind === 'download' && record.result.kind === 'missing').length;
        native.command('download skins/failure.pcx');
        for (let i = 0; i < 20 && records.filter(record => record.kind === 'download' && record.result.kind === 'missing').length === failedBefore; i++) await exchange();
        expect(records.filter(record => record.kind === 'download' && record.result.kind === 'missing').length).toBe(failedBefore + 1);
        expect(server.clients).toHaveLength(1);
        native.submit([move(0)], now); await exchange(); native.command('pings'); native.submit([move(0)], now); await exchange();
        expect(records.some(record => record.kind === 'packet-loss' && record.slot === 0 && record.value === 37)).toBe(true);
        expect(records.some(record => record.kind === 'ping' && record.slot === 0 && record.value > 0 && record.value !== 9999)).toBe(true);
        // A second connected slot makes failed travel validate every peer before mutation.
        secondSocket = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
        const second = new QuakeWorldConnectClient(27002, '\\name\\Second');
        for (let i = 0; i < 30 && second.state.kind !== 'connected'; i++) {
            now += 100; const bytes = second.next(now); if (bytes !== null) secondSocket.send(server.address, bytes);
            await Bun.sleep(1); await server.poll(now); await Bun.sleep(1);
            for (;;) { const packet = secondSocket.poll(); if (packet === null) break; if (packet.kind === 'packet') second.receive(packet.payload); }
        }
        expect(server.clients).toHaveLength(2); const oldPlayers = server.clients;
        const secondChannel = new QuakeWorldChannel('client', 27002);
        secondSocket.send(server.address, secondChannel.transmit(new Uint8Array(0), now));
        for (const start of [0, 5]) {
            const bytes = new SizeBuf(128); writeClientStringCommand(bytes, `spawn ${serverCount} ${start}`);
            secondSocket.send(server.address, secondChannel.transmit(bytes.bytes(), now)); await Bun.sleep(1); await server.poll(now += 100);
        }
        expect(spawnStarts.slice(-2)).toEqual([0, 5]); expect(begun).toBe(1);
        const invalid: QwApplicationServerHost = { ...host, signon: admitted => {
            const source = host.signon(admitted); return { ...source, serverData: () => ({ ...source.serverData(), playerSlot: admitted.slot === 1 ? 99 : admitted.slot }) };
        } };
        expect(() => server?.changeWorld(invalid)).toThrow('admitted native QW player'); expect(server.clients).toEqual(oldPlayers);
        server.disconnectClient(identity.client(1, 0), 'Fixture second peer complete');
        native.command('download skins/delayed.pcx'); native.submit([move(0)], now); await Bun.sleep(1);
        const pendingPoll = server.poll(now += 100); await Bun.sleep(1);
        if (delayed.resolve === null) throw new Error('Delayed mounted open did not start');
        serverCount++; server.changeWorld(host);
        delayed.resolve({ byteLength: 1, read: () => new Uint8Array([42]), close: () => { delayed.closed++; } });
        await pendingPoll; expect(delayed.closed).toBe(1);
        for (let i = 0; i < 100 && begun < 2; i++) await exchange();
        expect(serverCounts).toEqual([1, 2]); expect([spawned, begun]).toEqual([4, 2]);
        expect(server.clients[0]?.client.equals(clientId)).toBe(true); expect(server.clients[0]?.actor.equals(actor)).toBe(false);
        native.command('download skins/read-failure.pcx');
        for (let i = 0; i < 20 && failedReadCloses === 0; i++) await exchange();
        expect(failedReadCloses).toBe(1); expect(server.clients).toHaveLength(0);
        native.close(); await Bun.sleep(1); await server.poll(now + 100); expect(failedReadCloses).toBe(1);
        expect(prints.filter(text => !text.includes('changing') && !text.includes('datagram overflow') && !text.includes('preparation failed') && !text.includes('read failed'))).toEqual([]);
    } finally { client?.close(); secondSocket?.close(); server?.close(); await rm(root, { recursive: true, force: true }); }
}, 10000);
