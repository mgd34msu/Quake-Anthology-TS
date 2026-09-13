import type { QwEntityStateT } from "../../../src/network/q1/qw-constants.ts";
import { expect, test } from 'bun:test';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { QuakeWorldChannel } from '../../../src/network/q1/channels.ts';
import { quakeWorldOutOfBand, readQuakeWorldOutOfBand } from '../../../src/network/q1/handshake.ts';
import { decodeQuakeWorldClient } from '../../../src/network/q1/commands.ts';
import { writeQuakeWorldMessage, writeQuakeWorldEntities } from '../../../src/network/q1/quakeworld.ts';
import type { QuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import { QwClientNetwork } from '../../../src/app/bootstrap/network/qw-client.ts';
import { quakeWorldMapChecksum2 } from '../../../src/app/bootstrap/network/remote-qw.ts';
import type { QwServerData } from '../../../src/app/bootstrap/network/qw-types.ts';
const profile = { kind: 'q1-quakeworld', version: 28 } satisfies QwServerData['protocol'];
const data: QwServerData = { kind: 'server-data', protocol: profile, serverCount: 7, gameDirectory: 'id1', playerSlot: 3, spectator: false, level: 'Loopback', moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } };
test('QW UDP joins through lists, downloads, checksum prespawn, spawn and begin', async () => {
    const server = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const channel = new QuakeWorldChannel('server', 241), commands: string[] = [], downloads: string[] = [], messages: QuakeWorldMessage[] = [];
    const client = new QwClientNetwork({ transport, remote: server.address, qport: 241, userinfo: () => '\\name\\Loopback', host: {
        downloads: { request: async path => { downloads.push(path); return 'available'; }, receive: async () => 'complete', close() {} },
        serverData: async () => {},
        gameState: async (received, models, sounds) => { expect(received.playerSlot).toBe(3); expect(received.moveVariables.airAccelerate).toBeCloseTo(0.7); expect(models).toEqual(['maps/test.bsp', 'progs/player.mdl']); expect(sounds).toEqual(['misc/menu1.wav']); return -123; },
        receive: async records => { messages.push(...records); }, command: () => { throw new Error('No input during signon'); }, disconnected: reason => { throw new Error(reason); }, print() {},
    } });
    let now = 0;
    const send = (records: readonly Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>[]): void => {
        const bytes = new SizeBuf(1450); for (const record of records) writeQuakeWorldMessage(bytes, profile, record); channel.queueReliable(bytes.bytes()); server.send(transport.address, channel.transmit(new Uint8Array(0), now));
    };
    try {
        for (let tick = 0; tick < 60 && client.phase !== 'active'; tick++) {
            now += 100; await client.poll(now); await Bun.sleep(1);
            for (;;) {
                const packet = server.poll(); if (packet === null) break; if (packet.kind !== 'packet') continue;
                if (new DataView(packet.payload.buffer, packet.payload.byteOffset).getInt32(0, true) === -1) {
                    const text = readQuakeWorldOutOfBand(packet.payload);
                    server.send(transport.address, quakeWorldOutOfBand(text.startsWith('getchallenge') ? 'c42' : 'j')); continue;
                }
                const delivery = channel.receive(packet.payload, now); if (delivery === null) continue;
                for (const record of decodeQuakeWorldClient(delivery.payload, profile, delivery.sequence)) {
                    if (record.kind !== 'string-command') continue;
                    commands.push(record.text);
                    if (record.text === 'new') send([data]);
                    else if (record.text === 'soundlist 7 0') send([{ kind: 'sound-list', first: 0, names: ['misc/menu1.wav'], next: 0 }]);
                    else if (record.text === 'modellist 7 0') send([{ kind: 'model-list', first: 0, names: ['maps/test.bsp'], next: 1 }]);
                    else if (record.text === 'modellist 7 1') send([{ kind: 'model-list', first: 1, names: ['progs/player.mdl'], next: 0 }]);
                    else if (record.text === 'prespawn 7 0 -123') send([{ kind: 'stufftext', text: 'cmd spawn 7 0\n' }]);
                    else if (record.text === 'spawn 7 0') send([{ kind: 'stufftext', text: 'skins\n' }]);
                    else if (record.text === 'begin 7') { const bytes = new SizeBuf(64); writeQuakeWorldEntities(bytes, profile, [], new Map<number, QwEntityStateT>(), null); server.send(transport.address, channel.transmit(bytes.bytes(), now)); }
                }
            }
            await Bun.sleep(1);
        }
        expect(commands).toContain('new'); expect(commands).toContain('begin 7'); expect(client.phase).toBe('active');
        expect(commands).toEqual(['new', 'soundlist 7 0', 'modellist 7 0', 'modellist 7 1', 'prespawn 7 0 -123', 'spawn 7 0', 'begin 7']);
        expect(downloads).toEqual(['sound/misc/menu1.wav', 'maps/test.bsp', 'progs/player.mdl']);
        expect(messages.some(message => message.kind === 'packet-entities')).toBe(true);
    } finally { client.close(); server.close(); }
});
test('QW checksum2 ignores only source entities, visibility, nodes and leaves lumps', () => {
    const bytes = new Uint8Array(139), view = new DataView(bytes.buffer); view.setInt32(0, 29, true);
    for (let i = 0; i < 15; i++) { view.setInt32(4 + i * 8, 124 + i, true); view.setInt32(8 + i * 8, 1, true); bytes[124 + i] = i; }
    const original = quakeWorldMapChecksum2(bytes);
    for (const lump of [0, 4, 5, 10]) bytes[124 + lump] = 100;
    expect(quakeWorldMapChecksum2(bytes)).toBe(original);
    bytes[125] = 100; expect(quakeWorldMapChecksum2(bytes)).not.toBe(original);
});
