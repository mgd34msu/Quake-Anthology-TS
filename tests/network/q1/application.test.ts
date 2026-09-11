import { expect, test } from 'bun:test';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { NetQuakeChannel } from '../../../src/network/q1/channels.ts';
import { NetQuakeConnectClient } from '../../../src/network/q1/handshake.ts';
import { NetQuakeDecoder, writeNetQuakeMove } from '../../../src/network/q1/netquake.ts';
import type { NetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { NetQuakeSignon, writeClientStringCommand } from '../../../src/network/q1/session.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
interface NativeClient {
    readonly transport: UdpTransport;
    readonly handshake: NetQuakeConnectClient;
    readonly channel: NetQuakeChannel;
    readonly decoder: NetQuakeDecoder;
    readonly signon: NetQuakeSignon;
    readonly queued: Uint8Array[];
    readonly messages: NetQuakeMessage[];
    readonly deliveries: {
        readonly message: NetQuakeMessage;
        readonly kind: 'reliable' | 'unreliable';
    }[];
    sounds: readonly string[];
}
async function client(name: string): Promise<NativeClient> {
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    return { transport, handshake: new NetQuakeConnectClient(), channel: new NetQuakeChannel(), decoder: new NetQuakeDecoder(),
        signon: new NetQuakeSignon({ name, color: 0, spawnParameters: '', extensionFlags: null }), queued: [], messages: [], deliveries: [], sounds: [] };
}
test('retail NetQuake UDP shares actors, sound precaches, scoreboard, effects and travel', async () => {
    const launch = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--mode', 'coop', '--dedicated', '--listen', '0', '--bind', '127.0.0.1']);
    if (launch.kind !== 'run')
        throw new Error('Launch options missing');
    const prints: string[] = [], app = await Application.open(launch.options, { print: text => { prints.push(text); return undefined; } });
    const first = await client('First UDP'), second = await client('Second UDP'), peers = [first, second];
    const address = app.networkAddress;
    if (address === null)
        throw new Error('No server address');
    let now = 0;
    const command = (peer: Awaited<ReturnType<typeof client>>, text: string): void => { const bytes = new SizeBuf(256); writeClientStringCommand(bytes, text); peer.queued.push(bytes.bytes()); };
    const exchange = async (): Promise<void> => {
        now += 50;
        for (const peer of peers) {
            if (peer.handshake.state.kind === 'waiting') {
                const connect = peer.handshake.next(now);
                if (connect !== null)
                    peer.transport.send(address, connect);
            }
            if (peer.channel.canSendReliable) {
                const bytes = peer.queued.shift();
                if (bytes !== undefined)
                    peer.channel.queueReliable(bytes);
            }
            const bytes = peer.channel.next(now);
            if (bytes !== null)
                peer.transport.send(address, bytes);
        }
        await Bun.sleep(1);
        await app.step(50);
        await Bun.sleep(1);
        for (const peer of peers)
            for (;;) {
                const packet = peer.transport.poll();
                if (packet === null)
                    break;
                if (packet.kind !== 'packet')
                    continue;
                if (new DataView(packet.payload.buffer, packet.payload.byteOffset).getUint32(0) >>> 16 === 0x8000) {
                    peer.handshake.receive(packet.payload);
                    continue;
                }
                const result = peer.channel.receive(packet.payload, now);
                for (const reply of result.replies)
                    peer.transport.send(address, reply);
                if (result.delivery !== null)
                    for (const message of peer.decoder.decode(result.delivery.payload)) {
                        peer.messages.push(message);
                        peer.deliveries.push({ message, kind: result.delivery.kind });
                        if (message.kind === 'server-info') {
                            peer.signon.stage = 0;
                            peer.sounds = message.sounds;
                        }
                        if (message.kind === 'signon')
                            peer.queued.push(peer.signon.receive(message.stage));
                        if (message.kind === 'entity')
                            peer.signon.firstEntity();
                    }
            }
    };
    try {
        for (let i = 0; i < 100 && peers.some(peer => !peer.signon.active); i++)
            await exchange();
        for (const peer of peers) {
            expect(peer.signon.active).toBe(true);
            expect(peer.handshake.state.kind).toBe('connected');
        }
        expect(app.networkClients.length).toBe(2);
        const player = app.networkClients[0], other = app.networkClients[1];
        if (player === undefined || other === undefined)
            throw new Error(prints.join('\n'));
        const before = app.simulation.bodies.read(player.actor)?.origin;
        expect(before).toBeDefined();
        for (let i = 0; i < 6; i++) {
            const move = new SizeBuf(128);
            writeNetQuakeMove(move, { kind: 'q1-netquake', acknowledgedServerTimeSeconds: first.decoder.timeSeconds, viewAngles: { x: 0, y: 0, z: 0 }, forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 }, { kind: 'q1-netquake', version: 15 });
            first.transport.send(address, first.channel.unreliable(move.bytes()));
            await exchange();
        }
        const after = app.simulation.bodies.read(player.actor)?.origin;
        expect(after).not.toEqual(before);
        const entity = [...first.messages].reverse().find(message => message.kind === 'entity' && message.state.number === player.sourceEntity);
        if (entity?.kind !== 'entity' || after === undefined)
            throw new Error('No native shared-actor snapshot');
        expect(Math.abs(entity.state.origin.x - after.x)).toBeLessThan(0.126);
        expect(app.simulation.players().filter(actor => actor.equals(player.actor)).length).toBe(1);
        const source = app.simulation.q1Source(), owner = app.simulation.actors.resolveOwned(player.actor), body = app.simulation.bodies.read(player.actor);
        if (source === null || owner === null || body === null)
            throw new Error('Source player missing');
        const soundOrigin = { x: body.origin.x + (body.bounds.min.x + body.bounds.max.x) * 0.5, y: body.origin.y + (body.bounds.min.y + body.bounds.max.y) * 0.5, z: body.origin.z + (body.bounds.min.z + body.bounds.max.z) * 0.5 };
        for (const peer of peers) {
            peer.messages.length = 0;
            peer.deliveries.length = 0;
        }
        const projectile = source.game.create('network_sound_projectile');
        source.game.setOrigin(projectile, soundOrigin);
        const projectileNumber = app.simulation.actors.sourceOf(projectile.actor.id)?.slot;
        source.game.sound(projectile, 'weapons/r_exp3.wav', 'voice');
        source.game.remove(projectile);
        source.game.sound(owner, 'weapons/shotgn2.wav', 'weapon');
        source.game.effect('explosion', soundOrigin);
        source.game.effect('blood', soundOrigin, null, 4);
        source.game.message(other.actor, 'Only the second player', true);
        source.game.host.emit({ kind: 'lightstyle', style: 32, pattern: 'az' });
        source.composition.clients.addScore(player.actor, 7);
        command(first, 'name "Renamed"');
        command(first, 'color 4 13');
        for (let i = 0; i < 12; i++)
            await exchange();
        for (const peer of peers) {
            const sound = peer.deliveries.find(value => value.message.kind === 'sound' && value.message.entity === player.sourceEntity && value.message.channel === 1);
            if (sound?.message.kind !== 'sound')
                throw new Error(`No source sound: ${prints.join('\n')}`);
            expect(sound.kind).toBe('unreliable');
            expect(sound.message.volume).toBe(255);
            expect(sound.message.attenuation).toBe(1);
            const removed = peer.messages.find(message => message.kind === 'sound' && message.entity === projectileNumber && peer.sounds[message.index - 1] === 'weapons/r_exp3.wav');
            if (removed?.kind !== 'sound')
                throw new Error('Removed projectile lost its sound');
            expect(Math.abs(removed.origin.x - soundOrigin.x)).toBeLessThan(0.126);
            const state = app.simulation.events.capture();
            expect(state.styles.some(style => style.style === 32 && style.pattern === 'az')).toBe(true);
            expect(peer.sounds[sound.message.index - 1]).toBe('weapons/shotgn2.wav');
            expect(Math.abs(sound.message.origin.x - soundOrigin.x)).toBeLessThan(0.126);
            expect(Math.abs(sound.message.origin.z - soundOrigin.z)).toBeLessThan(0.126);
            expect(peer.deliveries.some(value => value.kind === 'unreliable' && value.message.kind === 'temporary-entity' && value.message.effect.type === 3)).toBe(true);
            expect(peer.deliveries.some(value => value.kind === 'unreliable' && value.message.kind === 'particle' && value.message.color === 73 && value.message.count === 8)).toBe(true);
            for (const kind of ['name', 'colors', 'frags'])
                expect(peer.deliveries.some(value => value.kind === 'reliable' && value.message.kind === kind && 'slot' in value.message && value.message.slot === player.client.slot && 'value' in value.message && value.message.value === (kind === 'name' ? 'Renamed' : kind === 'colors' ? 77 : 7))).toBe(true);
            expect(peer.deliveries.some(value => value.kind === 'reliable' && value.message.kind === 'light-style' && value.message.index === 32 && value.message.value === 'az')).toBe(true);
        }
        expect(first.messages.some(message => message.kind === 'center-print' && message.text === 'Only the second player')).toBe(false);
        expect(second.deliveries.some(value => value.kind === 'reliable' && value.message.kind === 'center-print' && value.message.text === 'Only the second player')).toBe(true);
        source.game.sound(owner, 'unprecached/native-test.wav', 'weapon');
        await exchange();
        expect(prints.some(text => text.includes('not precached'))).toBe(true);
        app.queueCommand('map', ['e1m2'], null);
        await exchange();
        for (let i = 0; i < 100 && (peers.some(peer => !peer.signon.active || !peer.messages.some(message => message.kind === 'server-info' && message.models[0] === 'maps/e1m2.bsp')) || app.networkClients[0]?.actor.equals(player.actor)); i++)
            await exchange();
        const carried = app.networkClients[0];
        if (carried === undefined)
            throw new Error('Travel lost native client');
        if (carried.actor.equals(player.actor))
            throw new Error(prints.join('\n'));
        expect(carried.client.equals(player.client)).toBe(true);
        expect(carried.actor.equals(player.actor)).toBe(false);
        for (const peer of peers) {
            expect(peer.signon.active).toBe(true);
            expect(peer.messages.some(message => message.kind === 'server-info' && message.models[0] === 'maps/e1m2.bsp')).toBe(true);
        }
        first.transport.send(address, first.channel.unreliable(new Uint8Array([2])));
        await exchange();
        expect(app.networkClients.length).toBe(1);
        expect(app.simulation.bodies.read(carried.actor)).toBeNull();
        for (let i = 0; i < 4; i++)
            await exchange();
        expect(second.deliveries.some(value => value.kind === 'reliable' && value.message.kind === 'name' && value.message.slot === carried.client.slot && value.message.value === '')).toBe(true);
    }
    finally {
        for (const peer of peers)
            peer.transport.close();
        await app.close();
    }
}, 30000);
