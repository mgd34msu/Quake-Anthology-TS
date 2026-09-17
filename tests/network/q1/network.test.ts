import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { openArchive } from '../../../src/content/archive/index.ts';
import { LoopbackHub } from '../../../src/network/common/loopback.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import type { Q1ExtendedEntityState, Q1ProtocolIdentity, QwUserCommand } from '../../../src/contracts/protocol.ts';
import { SizeBuf, MessageReader, createNetQuakeCodec, NetQuakeDecoder, NetQuakeChannel, QuakeWorldChannel, QuakePeer, NetQuakeDemoReader, QuakeWorldDecoder, QwEntityStateT, EntityStateT, writeQuakeWorldEntities, writeQuakeWorldMove, decodeQuakeWorldClient, QuakeWorldCommandReplay, encodeNetQuakeControl, decodeNetQuakeControl, QuakeWorldChallenges, QuakeWorldConnectionlessServer, QuakeWorldConnectClient, writeNetQuakeEntity, QuakeWorldDemoReader, writeQuakeWorldDemoRecord } from '../../../src/network/q1/index.ts';
const q1: Q1ProtocolIdentity = { kind: 'q1-netquake', version: 15 };
const zero = { x: 0, y: 0, z: 0 };
const baseline: Q1ExtendedEntityState = { number: 300, origin: zero, angles: zero, modelIndex: 1, frame: 0, colorMap: 0, skin: 0, effects: 0, alpha: 0, scale: 16, lerpFinishSeconds: 0, step: false };
const command: QwUserCommand = { kind: 'q1-quakeworld', milliseconds: 17, angles: { x: 0, y: 90, z: 0 }, forwardMove: 200, sideMove: -50, upMove: 0, buttons: 1, impulse: 7 };
test('NQ angle/coord bytes and RMQ extended entity payload retain source formats', () => {
    const s = new SizeBuf(), c = createNetQuakeCodec(q1, new MessageReader(new Uint8Array(0)));
    c.writeCoord(s, -1.2, 0);
    c.writeAngle(s, 1.9, 0);
    expect([...s.bytes()]).toEqual([247, 255, 0]);
    const wide: Q1ProtocolIdentity = { kind: 'q1-rmq', version: 999, flags: 130 }, out = new SizeBuf(), state: Q1ExtendedEntityState = { ...baseline, origin: { x: 5000.25, y: -8192, z: 12.5 }, angles: { x: 0, y: 90, z: 0 }, modelIndex: 1025, frame: 513, alpha: 128 };
    writeNetQuakeEntity(out, wide, state, baseline, 1);
    const decoder = new NetQuakeDecoder(wide);
    const wireBaseline = new EntityStateT();
    wireBaseline.modelindex = 1;
    decoder.baselines.set(300, wireBaseline);
    const decoded = decoder.decode(out.bytes())[0];
    if (decoded?.kind !== 'entity')
        throw new Error('Expected entity');
    expect(decoded.state.origin).toEqual(state.origin);
    expect(decoded.state.modelIndex).toBe(1025);
    expect(decoded.state.frame).toBe(513);
});
test('NetQuake fragments and duplicate acknowledgements cross shared transport', () => {
    const hub = new LoopbackHub(), a = hub.bind('a'), b = hub.bind('b'), sendChannel = new NetQuakeChannel(32, 3), receiveChannel = new NetQuakeChannel(32, 3), sender = new QuakePeer(a, b.address, sendChannel), receiver = new QuakePeer(b, a.address, receiveChannel);
    try {
        const payload = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
        sendChannel.queueReliable(payload);
        const first = sendChannel.next(0);
        if (first === null)
            throw new Error('No first fragment');
        sender.send(first);
        let delivered: Uint8Array | null = null;
        for (let i = 0; i < 10; i++) {
            const next = b.poll();
            if (next?.kind === 'packet') {
                const result = receiver.receive(next.from, next.payload, 0);
                if (result !== null)
                    delivered = result.payload;
            }
            const ack = a.poll();
            if (ack?.kind === 'packet')
                sender.receive(ack.from, ack.payload, 0);
        }
        expect(delivered).toEqual(payload);
        expect(sendChannel.canSendReliable).toBe(true);
    }
    finally {
        hub.close();
    }
});
test('QuakeWorld delta snapshots and movement checksum/replay', () => {
    const profile = { kind: 'q1-quakeworld', version: 28 } satisfies import('../../../src/network/q1/profile.ts').QuakeWorldProfile;
    const old = new QwEntityStateT();
    old.number = 1;
    old.modelindex = 2;
    const full = new SizeBuf();
    writeQuakeWorldEntities(full, profile, [old], new Map<number, QwEntityStateT>(), null);
    const d = new QuakeWorldDecoder();
    expect(d.decode(full.bytes(), 10)[0]?.kind).toBe('packet-entities');
    const changed = new QwEntityStateT();
    changed.copyFrom(old);
    changed.origin[0] = 64;
    const delta = new SizeBuf();
    writeQuakeWorldEntities(delta, profile, [changed], new Map<number, QwEntityStateT>(), { sequence: 10, states: [old] });
    d.recordDeltaRequest(11, 10);
    const result = d.decode(delta.bytes(), 11)[0];
    if (result?.kind !== 'packet-entities')
        throw new Error('Expected entities');
    expect(result.entities[0]?.origin.x).toBe(64);
    const move = new SizeBuf();
    writeQuakeWorldMove(move, profile, { oldest: command, previous: command, current: command, lossPercent: 3 }, 123);
    const decoded = decodeQuakeWorldClient(move.bytes(), profile, 123)[0];
    if (decoded?.kind !== 'move')
        throw new Error('Expected move');
    expect(decoded.bundle.current).toEqual(command);
    expect(() => decodeQuakeWorldClient(move.bytes(), profile, 124)).toThrow('checksum');
    const replay = new QuakeWorldCommandReplay(), commands: QwUserCommand[] = [];
    replay.run(decoded.bundle, 3, false, c => commands.push(c));
    expect(commands.length).toBe(4);
});
test('actual UDP carries NetQuake connect control and QW challenge negotiation', async () => {
    const a = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), b = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    try {
        const received = new Promise<Uint8Array>((resolve, reject) => {
            const timer = setTimeout(() => { unsubscribe(); reject(new Error('UDP timeout')); }, 2000), unsubscribe = b.subscribeReadable(() => {
                const event = b.poll();
                if (event?.kind === 'packet') {
                    clearTimeout(timer);
                    unsubscribe();
                    resolve(event.payload);
                }
            });
        });
        a.send(b.address, encodeNetQuakeControl({ kind: 'connect-request', game: 'QUAKE', version: 3 }));
        expect(decodeNetQuakeControl(await received)).toEqual({ kind: 'connect-request', game: 'QUAKE', version: 3 });
        const challenges = new QuakeWorldChallenges(() => 17);
        let admitted = false;
        const server = new QuakeWorldConnectionlessServer({ password: '', spectatorPassword: '', rconPassword: '', highCharacters: true, blocked: () => false, connect(request) { admitted = request.spectator; return { kind: 'accepted' }; }, status: () => '', log: () => null, executeAdmin() { throw new Error('Not part of connect'); } }, challenges), client = new QuakeWorldConnectClient(1337, '\\name\\player\\spectator\\1');
        const request = client.next(0);
        if (request === null)
            throw new Error('Missing challenge request');
        const challengeReply = (await server.receive(request, a.address, 0))[0];
        if (challengeReply === undefined)
            throw new Error('Missing challenge');
        client.receive(challengeReply);
        const connect = client.next(1);
        if (connect === null)
            throw new Error('Missing connect');
        const reply = (await server.receive(connect, a.address, 1))[0];
        if (reply === undefined)
            throw new Error('Missing acceptance');
        client.receive(reply);
        expect(client.state.kind).toBe('connected');
        expect(admitted).toBe(true);
    }
    finally {
        a.close();
        b.close();
    }
});
test('QuakeWorld channel and x86 QWD command record', () => {
    const client = new QuakeWorldChannel('client', 77), server = new QuakeWorldChannel('server', 77);
    server.receive(client.transmit(new Uint8Array(0), 0), 0);
    const bytes = client.transmit(new Uint8Array([1]), 1);
    expect(server.receive(bytes, 1)?.payload).toEqual(new Uint8Array([1]));
    expect(server.receive(bytes, 2)).toBeNull();
    client.transmit(new Uint8Array(0), 3);
    client.transmit(new Uint8Array(0), 4);
    server.receive(client.transmit(new Uint8Array(0), 5), 5);
    const response = server.transmit(new Uint8Array(0), 5);
    expect(new DataView(response.buffer).getUint32(0, true) & 0x7fffffff).toBe(4);
    const record = writeQuakeWorldDemoRecord({ kind: 'command', seconds: 1, command, viewAngles: zero });
    expect(record.length).toBe(41);
    const parsed = new QuakeWorldDemoReader(record).next();
    if (parsed?.kind !== 'command')
        throw new Error('Missing demo command');
    expect(parsed.command).toEqual(command);
});
const pak = '/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK';
(existsSync(pak) ? test : test.skip)('retail PAK demo1 decodes through the complete NetQuake stream', async () => {
    const archive = await openArchive(pak);
    try {
        const entry = archive.findEntries('demo1.dem')[0];
        if (entry === undefined)
            throw new Error('Retail demo1 missing');
        const demo = new NetQuakeDemoReader(await archive.readEntry(entry)), decoder = new NetQuakeDecoder();
        let records = 0, entities = 0;
        for (let record = demo.next(); record !== null; record = demo.next()) {
            for (const message of decoder.decode(record.message))
                if (message.kind === 'entity')
                    entities++;
            records++;
        }
        expect(records).toBeGreaterThan(100);
        expect(entities).toBeGreaterThan(100);
    }
    finally {
        archive.close();
    }
});
