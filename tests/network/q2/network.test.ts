import { test, expect } from 'bun:test';
import type { Q2ProtocolIdentity } from '../../../src/contracts/protocol.ts';
import { LoopbackHub } from '../../../src/network/common/loopback.ts';
import { Q2WireCodec, Q2Channel, EntityStateT, PlayerStateT, UsercmdT, createMessage, messageBytes, encodeQ2Frame, Q2ServerMessageReader, encodeQ2Move, readQ2ClientMessages, encodeQ2BatchMove, Q2ClientHandshake, Q2ChallengeTable, readQ2OutOfBand, readQ2Connect, q2OutOfBand, Q2CommandReplay, encodeQ2ServerEvent, toQ2RereleasePlayer } from '../../../src/network/q2/index.ts';
import type { Q2WireFrame } from '../../../src/network/q2/index.ts';
const protocols: readonly Q2ProtocolIdentity[] = [{ kind: 'q2-classic', version: 34 }, { kind: 'q2-r1q2', version: 35, revision: 1905 }, { kind: 'q2-q2pro', version: 36, revision: 1019 }, { kind: 'q2-rerelease', version: 1038 }, { kind: 'q2-private-classic', version: 4038 }, { kind: 'q2-kex', version: 2023 }, { kind: 'q2-kex-demo', version: 2022 }];
function packetFrame(player: PlayerStateT, entities: readonly EntityStateT[], serverFrame = 1): Q2WireFrame { return { serverFrame, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array([7, 0]), player, entities }; }
function decodedFrame(reader: Q2ServerMessageReader, bytes: Uint8Array): Q2WireFrame {
    const event = reader.read(bytes).find(record => record.event.kind === 'frame')?.event;
    if (event?.kind !== 'frame')
        throw new Error('frame missing');
    return event.frame;
}
test('classic packet matches the source scalar and MOREBITS layout', () => {
    const wire = new Q2WireCodec({ kind: 'q2-classic', version: 34 }), m = createMessage(), from = new EntityStateT(), to = new EntityStateT();
    from.number = 10;
    to.number = 10;
    to.origin.set([16, -8, 0]);
    to.angles[1] = 45;
    wire.codec.writeDeltaEntity(m, from, to, false, false);
    expect(Array.from(messageBytes(m))).toEqual([7, 10, 128, 0, 192, 255, 32]);
});
test('native frame envelopes carry deltas, removals, and transient event reset across seven wire profiles', () => {
    for (const protocol of protocols) {
        const wire = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: 32767, inventorySlots: 256 });
        const player = new PlayerStateT();
        player.pmove.origin.set([16, -8, 24]);
        player.pmove.originF.set([2, -1, 3]);
        player.fov = 90;
        player.stats[2] = 100;
        const entity = new EntityStateT();
        entity.number = 42;
        entity.origin.set([32, -16, 8]);
        entity.modelindex = 5;
        entity.event = 3;
        entity.solid = 31;
        const first = packetFrame(player, [entity]), firstDecoded = decodedFrame(reader, encodeQ2Frame(wire, first, null, new Map<number, EntityStateT>(), 4));
        expect(firstDecoded.areaBits).toEqual(new Uint8Array([7, 0]));
        expect(firstDecoded.entities[0]?.origin[0]).toBe(32);
        expect(firstDecoded.player.stats[2]).toBe(100);
        const nextEntity = new EntityStateT();
        nextEntity.number = 42;
        nextEntity.origin.set(entity.origin);
        nextEntity.modelindex = 5;
        nextEntity.solid = 31;
        const next = packetFrame(player, [nextEntity], 2), nextDecoded = decodedFrame(reader, encodeQ2Frame(wire, next, first, new Map<number, EntityStateT>(), 4));
        expect(nextDecoded.entities[0]?.event).toBe(0);
        const empty = packetFrame(player, [], 3), emptyDecoded = decodedFrame(reader, encodeQ2Frame(wire, empty, next, new Map<number, EntityStateT>(), 4));
        expect(emptyDecoded.entities).toHaveLength(0);
    }
});
test('rerelease gunskin-only changes and KEX float delta angles survive the wire', () => {
    const protocol: Q2ProtocolIdentity = { kind: 'q2-rerelease', version: 1038 }, wire = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: 32767, inventorySlots: 256 });
    const player = new PlayerStateT();
    player.gunindex = 4;
    const first = packetFrame(player, []);
    decodedFrame(reader, encodeQ2Frame(wire, first, null, new Map<number, EntityStateT>(), 4));
    const changed = new PlayerStateT();
    changed.gunindex = 4;
    changed.gunskin = 5;
    expect(decodedFrame(reader, encodeQ2Frame(wire, packetFrame(changed, [], 2), first, new Map<number, EntityStateT>(), 4)).player.gunskin).toBe(5);
    const kexProtocol: Q2ProtocolIdentity = { kind: 'q2-kex', version: 2023 }, kex = new Q2WireCodec(kexProtocol), kexReader = new Q2ServerMessageReader(kexProtocol, { maxConfigStrings: 32767, inventorySlots: 256 });
    const kexPlayer = new PlayerStateT();
    kexPlayer.pmove.deltaAngleEncoding = 'float';
    kexPlayer.pmove.delta_anglesF[1] = 1.9;
    kexPlayer.gunrate = 12;
    kexPlayer.team_id = 2;
    const entity = new EntityStateT();
    entity.number = 9;
    entity.scale = 2;
    entity.instance_bits = 12;
    entity.owner = 4;
    entity.old_frame = 77;
    entity.morefx = 0x80000000;
    const decoded = decodedFrame(kexReader, encodeQ2Frame(kex, packetFrame(kexPlayer, [entity]), null, new Map<number, EntityStateT>(), 4));
    expect(toQ2RereleasePlayer(decoded.player).movement.deltaAngles.y).toBe(Math.fround(1.9));
    expect(decoded.player.team_id).toBe(2);
    expect(decoded.entities[0]?.owner).toBe(4);
    expect(decoded.entities[0]?.old_frame).toBe(77);
    expect(decoded.entities[0]?.morefx).toBe(0x80000000);
});
test('client moves keep checksum and Q2PRO batch vertical intent', () => {
    const wire = new Q2WireCodec({ kind: 'q2-classic', version: 34 }), command = new UsercmdT();
    command.msec = 16;
    command.forwardmove = 200;
    command.upmove = 200;
    command.angles[1] = 100;
    const packet = encodeQ2Move(wire, 10, 7, [new UsercmdT(), new UsercmdT(), command]);
    const records = readQ2ClientMessages(wire, packet, 10);
    const move = records[0]?.event;
    if (move?.kind !== 'move')
        throw new Error('move missing');
    expect(move.commands[2].upmove).toBe(200);
    expect(() => readQ2ClientMessages(wire, packet, 11)).toThrow('checksum');
    const pro = new Q2WireCodec({ kind: 'q2-q2pro', version: 36, revision: 1019 });
    const batch = encodeQ2BatchMove(pro, 7, [{ cmds: [command] }]);
    const decoded = readQ2ClientMessages(pro, batch, 10)[0]?.event;
    if (decoded?.kind !== 'batch-move')
        throw new Error('batch missing');
    expect(decoded.batch.frames[0]?.cmds[0]?.upmove).toBe(200);
    const replay = new Q2CommandReplay(), steps: number[] = [];
    replay.execute(decoded, 0, cmd => steps.push(cmd.upmove));
    expect(steps).toEqual([200]);
});
test('two channel peers exchange reliable fragmented messages through shared loopback transport', () => {
    const hub = new LoopbackHub(), left = hub.bind('q2-client'), right = hub.bind('q2-server');
    try {
        const protocol: Q2ProtocolIdentity = { kind: 'q2-rerelease', version: 1038 };
        const client = new Q2Channel({ protocol, side: 'client', channel: 'new', qport: 17, payloadBytes: 512 }), server = new Q2Channel({ protocol, side: 'server', channel: 'new', qport: 17, payloadBytes: 512 });
        const bytes = new Uint8Array(1500);
        bytes.fill(45);
        client.queueReliable(bytes);
        let received: Uint8Array | null = null;
        do {
            expect(client.send(left, right.address, new Uint8Array(0), 100)).toBe(true);
            const packet = right.poll();
            if (packet?.kind !== 'packet')
                throw new Error('packet missing');
            const result = server.receive(packet.payload, 100);
            if (result.kind === 'message')
                received = result.bytes;
        } while (client.fragmentPending);
        expect(received).toEqual(bytes);
        server.send(right, left.address, new Uint8Array(0), 101);
        const ack = left.poll();
        if (ack?.kind !== 'packet')
            throw new Error('ack missing');
        client.receive(ack.payload, 101);
        expect(client.reliablePending).toBe(false);
    }
    finally {
        hub.close();
    }
});
test('challenge negotiation keeps qport width and native connect-tail fields', () => {
    const remote = { kind: 'loopback', id: 'q2-server' } satisfies Parameters<typeof Q2ChallengeTable.prototype.issue>[0];
    const protocol: Q2ProtocolIdentity = { kind: 'q2-rerelease', version: 1038 }, client = new Q2ClientHandshake(remote, [protocol], 0x1234, () => String.raw `\name\player`, 4086), table = new Q2ChallengeTable(() => 123);
    expect(readQ2OutOfBand(client.poll(0) ?? new Uint8Array())?.command).toBe('getchallenge');
    const reply = readQ2OutOfBand(table.reply(remote, 1, [protocol]));
    if (reply === null)
        throw new Error('challenge missing');
    client.receive(remote, reply);
    const connect = readQ2OutOfBand(client.poll(1) ?? new Uint8Array());
    if (connect === null)
        throw new Error('connect missing');
    const request = readQ2Connect(connect);
    expect(request.qport).toBe(0x34);
    expect(request.payloadBytes).toBe(4086);
    expect(request.channel).toBe('new');
    expect(request.userinfo).toBe(String.raw `\name\player`);
    const accepted = readQ2OutOfBand(q2OutOfBand('client_connect'));
    if (accepted === null)
        throw new Error('accept missing');
    client.receive(remote, accepted);
    expect(client.state.kind).toBe('connected');
});
test('KEX seats retain independent frame history and positioned sounds', () => {
    const protocol: Q2ProtocolIdentity = { kind: 'q2-kex', version: 2023 }, writer = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: 32767, inventorySlots: 256 });
    const zero = new PlayerStateT(), one = new PlayerStateT();
    zero.stats[0] = 100;
    one.stats[0] = 75;
    decodedFrame(reader, encodeQ2Frame(writer, packetFrame(zero, []), null, new Map<number, EntityStateT>(), 4));
    reader.read(encodeQ2ServerEvent(writer, { kind: 'seat', seat: 1 }));
    decodedFrame(reader, encodeQ2Frame(writer, packetFrame(one, []), null, new Map<number, EntityStateT>(), 4));
    expect(reader.history(0).get(1)?.player.stats[0]).toBe(100);
    expect(reader.history(1).get(1)?.player.stats[0]).toBe(75);
    const record = reader.read(encodeQ2ServerEvent(writer, { kind: 'sound', sound: { flags: 0, index: 300, entity: 0, channel: 0, position: { x: 1.9, y: -12, z: 3 }, volume: 1, attenuation: 1, delaySeconds: 0 } }))[0];
    expect(record?.seat).toBe(1);
    if (record?.event.kind !== 'sound')
        throw new Error('sound missing');
    expect(record.event.sound.position?.x).toBe(Math.fround(1.9));
});
test('Q2PRO 1026 negotiated fields preserve extended coordinates, fog, stats, and client identity', () => {
    const protocol: Q2ProtocolIdentity = { kind: 'q2-q2pro', version: 36, revision: 1026 }, wire = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: 13630, inventorySlots: 256 });
    reader.read(encodeQ2ServerEvent(wire, { kind: 'server-data', data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'unit1', serverState: 2, wireFlags: 24 } }));
    const player = new PlayerStateT();
    player.pmove.origin.set([400000, -400000, 80]);
    player.pmove.velocity[2] = 40000;
    player.pmove.pm_time = 1000;
    player.pmove.pm_flags = 512;
    player.gunindex = 2000;
    player.gunskin = 5;
    player.clientnum = 300;
    player.stats[63] = 77;
    player.damage_blend[0] = 1;
    player.q2proFog = { color: [2, 3, 4], density: 1234, skyFactor: 60000, heightDensity: 50000, heightFalloff: 456, heightStartColor: [9, 8, 7], heightEndColor: [6, 5, 4], heightStartDistance: -400000, heightEndDistance: 400000 };
    const entity = new EntityStateT();
    entity.number = 2000;
    entity.modelindex = 1500;
    entity.origin.set([50000, -50000, 10]);
    entity.angles[1] = 22.5;
    entity.morefx = 0x80000000;
    entity.sound = 1000;
    entity.loop_volume = 0.5;
    entity.loop_attenuation = -1;
    entity.scale = 2;
    const first = packetFrame(player, [entity]), decoded = decodedFrame(reader, encodeQ2Frame(wire, first, null, new Map<number, EntityStateT>(), 4));
    expect(decoded.player.pmove.origin).toEqual(player.pmove.origin);
    expect(decoded.player.pmove.pm_time).toBe(1000);
    expect(decoded.player.pmove.pm_flags).toBe(512);
    expect(decoded.player.clientnum).toBe(300);
    expect(decoded.player.stats[63]).toBe(77);
    expect(decoded.player.q2proFog).toEqual(player.q2proFog);
    expect(decoded.player.gunskin).toBe(5);
    expect(decoded.entities[0]?.origin[0]).toBe(50000);
    expect(decoded.entities[0]?.morefx).toBe(0x80000000);
    expect(decoded.entities[0]?.loop_attenuation).toBe(-1);
    const nextPlayer = new PlayerStateT();
    nextPlayer.pmove.origin.set([400008, -400008, 88]);
    nextPlayer.clientnum = 300;
    const second = decodedFrame(reader, encodeQ2Frame(wire, packetFrame(nextPlayer, [], 2), first, new Map<number, EntityStateT>(), 4));
    expect(second.player.pmove.origin).toEqual(nextPlayer.pmove.origin);
    expect(second.player.stats[63]).toBe(0);
    expect(second.player.damage_blend[0]).toBe(0);
    const sound = reader.read(encodeQ2ServerEvent(wire, { kind: 'sound', sound: { flags: 0, index: 1000, entity: 2000, channel: 1, position: { x: 50000, y: -50000, z: 10 }, volume: 1, attenuation: 1, delaySeconds: 0 } }))[0]?.event;
    if (sound?.kind !== 'sound')
        throw new Error('sound missing');
    expect(sound.sound.position?.x).toBe(50000);
});
test('rerelease compression uses its opcode and a lost delta frame is consumed without publishing it as valid', () => {
    const protocol: Q2ProtocolIdentity = { kind: 'q2-rerelease', version: 1038 }, wire = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, { maxConfigStrings: 32767, inventorySlots: 256 });
    const server = new Q2Channel({ protocol, side: 'server', channel: 'new', qport: 1, compress: true }), client = new Q2Channel({ protocol, side: 'client', channel: 'new', qport: 1 });
    server.queueReliable(encodeQ2ServerEvent(wire, { kind: 'print', level: 1, text: 'quake '.repeat(100) }));
    const received = client.receive(server.transmit(new Uint8Array(), 0), 0);
    if (received.kind !== 'message')
        throw new Error('message missing');
    expect(received.bytes[0]).toBe(34);
    expect(reader.read(received.bytes)[0]?.event.kind).toBe('print');
    const first = packetFrame(new PlayerStateT(), [], 1), next = packetFrame(new PlayerStateT(), [], 2);
    expect(decodedFrame(reader, encodeQ2Frame(wire, next, first, new Map<number, EntityStateT>(), 4)).valid).toBe(false);
    expect(decodedFrame(reader, encodeQ2Frame(wire, packetFrame(new PlayerStateT(), [], 3), null, new Map<number, EntityStateT>(), 4)).valid).toBe(true);
});
test('native connectionless exchange dispatches admission and status through the source host', async () => {
    const { Q2ConnectionlessServer, readQ2Status } = await import('../../../src/network/q2/index.ts');
    const protocol: Q2ProtocolIdentity = { kind: 'q2-classic', version: 34 }, remote = { kind: 'loopback', id: 'q2-browser' } satisfies Parameters<typeof Q2ChallengeTable.prototype.issue>[0], replies: Uint8Array[] = [];
    let connected = false;
    const server = new Q2ConnectionlessServer({ profile: 'classic', protocols: [protocol], status: () => ({ serverInfo: String.raw `\hostname\Quake\mapname\base1\maxclients\4`, players: [{ name: 'player', score: 3, ping: 20 }] }), info: () => ({ name: 'Quake', map: 'base1', players: 1, maxPlayers: 4 }), connect: () => { connected = true; return { kind: 'accepted' }; }, reply: (_to, bytes) => { replies.push(bytes); }, rconPassword: () => '', limitedRcon: () => null, rconRateAllowed: () => true, rechargeRconRate: () => { }, executeRcon: async () => { } }, new Q2ChallengeTable(() => 42));
    await server.receive(remote, q2OutOfBand('status'), 0);
    const status = readQ2OutOfBand(replies[0] ?? new Uint8Array());
    if (status === null)
        throw new Error('status missing');
    expect(readQ2Status(status, protocol)?.playerDetails[0]?.score).toBe(3);
    await server.receive(remote, q2OutOfBand('connect 34 7 42 "\\name\\player"'), 0);
    expect(connected).toBe(true);
    expect(readQ2OutOfBand(replies[1] ?? new Uint8Array())?.command).toBe('client_connect');
});
