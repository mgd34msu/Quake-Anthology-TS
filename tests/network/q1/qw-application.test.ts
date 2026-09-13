import { expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { QwRemotePresentation } from '../../../src/app/bootstrap/network/remote-qw.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { addressKey } from '../../../src/network/common/endpoint.ts';
import { QuakeWorldChannel } from '../../../src/network/q1/channels.ts';
import { quakeWorldOutOfBand, readQuakeWorldOutOfBand, quakeWorldCommandArguments } from '../../../src/network/q1/handshake.ts';
import { decodeQuakeWorldClient } from '../../../src/network/q1/commands.ts';
import { writeQuakeWorldMessage, writeQuakeWorldEntities } from '../../../src/network/q1/quakeworld.ts';
import type { QuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import { QwEntityStateT } from '../../../src/network/q1/qw-constants.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import { userProductDirectory } from '../../../src/content/user-data.ts';
import type { QwServerData } from '../../../src/app/bootstrap/network/qw-types.ts';
import type { QwUserCommand } from '../../../src/contracts/protocol.ts';
const profile = { kind: 'q1-quakeworld', version: 28 } satisfies QwServerData['protocol'];
for (const gameDirectory of ['qw', 'id1']) test(`hidden QW ${gameDirectory} application downloads a sound, binds shared scene and sends source movement`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'qw-application-')), server = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    let app: RemoteApplication | null = null;
    const prints: string[] = [];
    try {
        const launch = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--connect-qw', addressKey(server.address), '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden', '--user-content-root', root]);
        if (launch.kind !== 'run') throw new Error('Expected QW run');
        app = await RemoteApplication.open(launch.options, { print: text => { prints.push(text); return undefined; } });
        const remote = app;
        const sound = await remote.content.mounts.read('sound/misc/menu1.wav');
        let channel: QuakeWorldChannel | null = null, downloadOffset = 0, begun = false;
        const commands: string[] = [], moves: QwUserCommand[] = [];
        const send = (records: readonly Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>[], entities = false): void => {
            if (channel === null) throw new Error('No QW channel');
            const bytes = new SizeBuf(1450); for (const record of records) writeQuakeWorldMessage(bytes, profile, record);
            if (entities) { const door = new QwEntityStateT(); door.number = 40; door.modelindex = 3; writeQuakeWorldEntities(bytes, profile, [door], new Map<number, QwEntityStateT>(), null); }
            server.send(remote.networkAddress, channel.transmit(bytes.bytes(), performance.now()));
        };
        const chunk = (): void => { const bytes = sound.subarray(downloadOffset, downloadOffset + 768); downloadOffset += bytes.length; send([{ kind: 'download', result: { kind: 'data', percent: Math.floor(downloadOffset * 100 / sound.length), bytes } }]); };
        const snapshot = (): void => send([
            { kind: 'stat', index: 0, value: 100 }, { kind: 'stat', index: 15, value: 4097 }, { kind: 'stat', index: 10, value: 1 },
            { kind: 'player', state: { number: 3, flags: 0, origin: { x: 480, y: -352, z: 88 }, velocity: { x: 0, y: 0, z: 0 }, modelIndex: 2, frame: 0, skin: 0, effects: 0, weaponFrame: 0, milliseconds: 0, command: { kind: 'q1-quakeworld', milliseconds: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } } },
        ], true);
        const exchange = async (): Promise<void> => {
            await remote.step(50); await Bun.sleep(1);
            for (;;) {
                const packet = server.poll(); if (packet === null) break; if (packet.kind !== 'packet') continue;
                if (new DataView(packet.payload.buffer, packet.payload.byteOffset).getInt32(0, true) === -1) {
                    const text = readQuakeWorldOutOfBand(packet.payload);
                    if (text.startsWith('getchallenge')) server.send(remote.networkAddress, quakeWorldOutOfBand('c42'));
                    else { const args = quakeWorldCommandArguments(text); channel = new QuakeWorldChannel('server', Number(args[2])); server.send(remote.networkAddress, quakeWorldOutOfBand('j')); }
                    continue;
                }
                const delivery = channel?.receive(packet.payload, performance.now()); if (delivery === null || delivery === undefined) continue;
                for (const record of decodeQuakeWorldClient(delivery.payload, profile, delivery.sequence)) {
                    if (record.kind === 'move') { moves.push(record.bundle.current); continue; }
                    if (record.kind !== 'string-command') continue;
                    commands.push(record.text);
                    if (record.text === 'new') send([{ kind: 'server-data', protocol: profile, serverCount: 3, gameDirectory, playerSlot: 3, spectator: false, level: 'e1m1', moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } }]);
                    else if (record.text === 'soundlist 3 0') send([{ kind: 'sound-list', first: 0, names: ['misc/qw-join-test.wav', 'misc/qw-missing.wav'], next: 0 }]);
                    else if (record.text === 'download sound/misc/qw-join-test.wav' || record.text === 'nextdl') chunk();
                    else if (record.text === 'download sound/misc/qw-missing.wav') send([{ kind: 'download', result: { kind: 'missing' } }]);
                    else if (record.text === 'modellist 3 0') send([{ kind: 'model-list', first: 0, names: ['maps/e1m1.bsp', 'progs/player.mdl', '*1'], next: 0 }]);
                    else if (record.text.startsWith('prespawn 3 0 ')) { expect(Number(record.text.split(' ')[3])).not.toBe(0); send([{ kind: 'stufftext', text: 'cmd spawn 3 0\n' }]); }
                    else if (record.text === 'spawn 3 0') send([{ kind: 'stufftext', text: 'skins\n' }]);
                    else if (record.text === 'begin 3') { begun = true; snapshot(); }
                }
                if (begun && delivery.payload.length === 0) snapshot();
            }
            await Bun.sleep(1);
        };
        for (let i = 0; i < 200 && remote.localPlayers.length === 0; i++) await exchange();
        expect(remote.options.product).toBe('q1-quakeworld');
        expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull(); expect(remote.remote).toBeInstanceOf(QwRemotePresentation);
        if (!(remote.remote instanceof QwRemotePresentation)) throw new Error('Expected QW presentation');
        const player = remote.localPlayers[0]; if (player === undefined) throw new Error(`QW seat missing: ${prints.join('')}`);
        expect(remote.remote.player?.sourceEntity).toBe(4); expect(remote.remote.playerUi(player.actor).health).toBe(100);
        expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
        expect(new Uint8Array(await readFile(join(userProductDirectory(root, 'q1/qw'), 'sound/misc/qw-join-test.wav')))).toEqual(new Uint8Array(sound));
        const beforeMovement = remote.remote.playerView(player.actor).origin;
        expect(remote.remote.scene.queryActors({ min: { x: -10000, y: -10000, z: -10000 }, max: { x: 10000, y: 10000, z: 10000 } }).some(actor => actor.collision.shape.kind === 'model')).toBe(true);
        remote.input({ seat: player.seat.id, kind: 'key', code: 119, down: true, repeat: false, timeMilliseconds: performance.now() });
        for (let i = 0; i < 3; i++) await exchange();
        expect(moves.some(move => move.forwardMove > 0 && move.milliseconds > 0)).toBe(true);
        expect(remote.remote.playerView(player.actor).origin).not.toEqual(beforeMovement);
        remote.queueCommand('use', ['q1:weapon/axe'], player.seat.id); await exchange(); await exchange();
        expect(moves.some(move => move.impulse === 1)).toBe(true);
        send([{ kind: 'sound', entity: 4, channel: 1, index: 1, origin: { x: 480, y: -352, z: 88 }, volume: 255, attenuation: 1 }]); await Bun.sleep(1); await remote.step(50);
        expect(remote.presentationEvents.some(event => event.kind === 'q1' && event.event.kind === 'sound')).toBe(true);
        send([{ kind: 'intermission', origin: { x: 100, y: 200, z: 300 }, angles: { x: 0, y: 90, z: 0 } }]); await Bun.sleep(1); await remote.step(50);
        expect(remote.remote.playerView(player.actor).origin).toEqual({ x: 100, y: 200, z: 300 });
        expect(commands).toContain('begin 3');
        expect(commands).toContain('download sound/misc/qw-missing.wav');
    } finally { await app?.close(); server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
