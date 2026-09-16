import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openRemoteApplicationContent } from '../../../src/app/bootstrap/content.ts';
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
for (const gameDirectory of ['qw', 'id1', 'mod-alpha']) test(`hidden QW ${gameDirectory} application downloads a sound, binds shared scene and sends source movement`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'qw-application-')), server = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    let app: RemoteApplication | null = null;
    const prints: string[] = [];
    try {
        if (gameDirectory === 'mod-alpha') await mkdir(join(root, 'q1/Mod-Alpha'), { recursive: true });
        const launch = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--connect-qw', addressKey(server.address), '--renderer', 'cpu', '--width', '160', '--height', '120', '--hidden', '--user-content-root', root]);
        if (launch.kind !== 'run') throw new Error('Expected QW run');
        app = await RemoteApplication.open(launch.options, { print: text => { prints.push(text); return undefined; } });
        let remote = app;
        const session = remote.session;
        expect(session.world).toBeNull(); expect(remote.localPlayers).toHaveLength(0);
        expect(() => remote.content).toThrow('Remote server has not supplied a world');
        if (!(remote.remote instanceof QwRemotePresentation)) throw new Error('Expected mapless QW presentation');
        const suppliedClient = remote.remote.shared.client;
        const fixtureContent = await openRemoteApplicationContent(launch.options);
        let sound: Uint8Array;
        try { sound = await fixtureContent.mounts.read('sound/misc/menu1.wav'); } finally { await fixtureContent.close(); }
        let channel: QuakeWorldChannel | null = null, downloadOffset = 0, begun = false;
        let servedDirectory = gameDirectory, servedMap = 'e1m1', serverCount = 3;
        const commands: string[] = [], moves: QwUserCommand[] = [];
        const send = (records: readonly Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>[], entities = false): void => {
            if (channel === null) throw new Error('No QW channel');
            const bytes = new SizeBuf(1450); for (const record of records) writeQuakeWorldMessage(bytes, profile, record);
            if (entities) { const door = new QwEntityStateT(); door.number = 40; door.modelindex = 3; writeQuakeWorldEntities(bytes, profile, [door], new Map<number, QwEntityStateT>(), null); }
            server.send(remote.networkAddress, channel.transmit(bytes.bytes(), performance.now()));
        };
        const serverData = (): QwServerData => ({ kind: 'server-data', protocol: profile, serverCount, gameDirectory: servedDirectory, playerSlot: 3, spectator: false, level: servedMap,
          moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } });
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
                    if (record.text === 'new') send([serverData()]);
                    else if (record.text === `soundlist ${serverCount} 0`) send([{ kind: 'sound-list', first: 0, names: ['misc/qw-join-test.wav', 'misc/qw-missing.wav'], next: 0 }]);
                    else if (record.text === 'download sound/misc/qw-join-test.wav' || record.text === 'nextdl') chunk();
                    else if (record.text === 'download sound/misc/qw-missing.wav') send([{ kind: 'download', result: { kind: 'missing' } }]);
                    else if (record.text === `modellist ${serverCount} 0`) send([{ kind: 'model-list', first: 0, names: [`maps/${servedMap}.bsp`, 'progs/player.mdl', '*1'], next: 0 }]);
                    else if (record.text.startsWith(`prespawn ${serverCount} 0 `)) { expect(Number(record.text.split(' ')[3])).not.toBe(0); send([{ kind: 'stufftext', text: `cmd spawn ${serverCount} 0\n` }]); }
                    else if (record.text === `spawn ${serverCount} 0`) send([{ kind: 'stufftext', text: 'skins\n' }]);
                    else if (record.text === `begin ${serverCount}`) { begun = true; snapshot(); }
                }
                if (begun && delivery.payload.length === 0) snapshot();
            }
            await Bun.sleep(1);
        };
        for (let i = 0; i < 200 && remote.localPlayers.length === 0; i++) await exchange();
        expect(remote.options.product).toBe(gameDirectory === 'mod-alpha' ? 'q1-quakeworld-mod-mod-alpha' : 'q1-quakeworld');
        expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull(); expect(remote.remote).toBeInstanceOf(QwRemotePresentation);
        if (!(remote.remote instanceof QwRemotePresentation)) throw new Error('Expected QW presentation');
        expect(remote.session).toBe(session); expect(remote.remote.shared.client).toBe(suppliedClient);
        expect(remote.content.recipe.map.geometry.requestedPath).toBe('maps/e1m1.bsp');
        const player = remote.localPlayers[0]; if (player === undefined) throw new Error(`QW seat missing: ${prints.join('')}`);
        expect(remote.remote.player?.sourceEntity).toBe(4); expect(remote.remote.playerUi(player.actor).health).toBe(100);
        expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
        expect(new Uint8Array(await readFile(join(userProductDirectory(root, gameDirectory === 'mod-alpha' ? 'q1/Mod-Alpha' : 'q1/qw'), 'sound/misc/qw-join-test.wav')))).toEqual(new Uint8Array(sound));
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
        expect(commands).toContain(`begin ${serverCount}`);
        expect(commands).toContain('download sound/misc/qw-missing.wav');
        if (gameDirectory === 'mod-alpha') {
            for (const directory of ['mod-beta', 'qw', 'mod-alpha']) {
                servedDirectory = directory; servedMap = directory === 'mod-alpha' ? 'dm2' : 'e1m1';
                serverCount++; downloadOffset = 0; begun = false;
                send([serverData()]);
                for (let tick = 0; tick < 200 && (!begun || remote.networkPhase !== 'active'); tick++) await exchange();
                expect(remote.session).toBe(session); expect(remote.remote.shared.client).toBe(suppliedClient);
                expect(begun).toBe(true); expect(remote.networkPhase).toBe('active');
                expect(remote.options.product).toBe(directory === 'qw' ? 'q1-quakeworld' : `q1-quakeworld-mod-${directory}`);
                expect(remote.content.recipe.map.geometry.requestedPath).toBe(`maps/${servedMap}.bsp`);
                expect(new Uint8Array(await readFile(join(userProductDirectory(root, directory === 'mod-alpha' ? 'q1/Mod-Alpha' : `q1/${directory}`), 'sound/misc/qw-join-test.wav')))).toEqual(new Uint8Array(sound));
                const downloaded = await remote.content.mounts.open('sound/misc/qw-join-test.wav');
                expect(downloaded?.reference.provenance.mount.identity.content).toBe(remote.content.catalog.require(remote.options.product).id);
                expect(downloaded?.bytes).toEqual(new Uint8Array(sound));
                expect(new Set(remote.readPixels()).size).toBeGreaterThan(16);
            }
            const reconnectOptions = remote.options;
            const staleLookup = remote.remote.downloads?.request('maps/retired-owner.bsp', 'model');
            const retired = remote.remote.serverData({ ...serverData(), serverCount: ++serverCount, gameDirectory: 'retired-mod' });
            const replacement = remote.remote.serverData({ ...serverData(), serverCount: ++serverCount, gameDirectory: 'current-mod' });
            const results = await Promise.allSettled([retired, replacement]);
            expect(results[0]?.status).toBe('rejected'); expect(results[1]?.status).toBe('fulfilled');
            expect(remote.options.product).toBe('q1-quakeworld-mod-current-mod');
            expect(await staleLookup).toBe('skipped');
            expect(await remote.remote.downloads?.request('sound/current-owner.bin', 'sound')).toBe('waiting');
            expect(await remote.remote.downloads?.receive({ kind: 'data', percent: 100, bytes: new Uint8Array([1, 2, 3]) })).toBe('complete');
            expect(new Uint8Array(await readFile(join(root, 'q1/current-mod/sound/current-owner.bin')))).toEqual(new Uint8Array([1, 2, 3]));
            await exchange();
            expect(commands).not.toContain('download maps/retired-owner.bsp');
            expect(commands).toContain('download sound/current-owner.bin');
            const closing = remote.remote.serverData({ ...serverData(), serverCount: ++serverCount, gameDirectory: 'closing-mod' });
            const closed = remote.close();
            await expect(closing).rejects.toThrow('cancelled');
            await closed;
            expect(remote.options.product).toBe('q1-quakeworld-mod-current-mod');
            const reopened = await RemoteApplication.open(reconnectOptions, { print: text => { prints.push(text); } });
            try {
                expect(reopened.session.world).toBeNull(); expect(reopened.localPlayers).toHaveLength(0);
                expect(() => reopened.content).toThrow('Remote server has not supplied a world');
                if (!(reopened.remote instanceof QwRemotePresentation)) throw new Error('Expected reopened mapless QW presentation');
                const reopenedSession = reopened.session, reopenedClient = reopened.remote.shared.client;
                remote = reopened; channel = null; begun = false; downloadOffset = 0; servedDirectory = 'mod-alpha'; servedMap = 'dm2'; serverCount++;
                for (let tick = 0; tick < 200 && remote.localPlayers.length === 0; tick++) await exchange();
                expect(reopened.networkPhase).toBe('active'); expect(reopened.session).toBe(reopenedSession);
                expect(reopened.remote.shared.client).toBe(reopenedClient);
                expect(reopened.options.remoteContent).toEqual({ base: 'q1-quakeworld', directory: 'mod-alpha' });
                expect(reopened.content.recipe.map.geometry.requestedPath).toBe('maps/dm2.bsp');
                const retained = await reopened.content.mounts.open('sound/misc/qw-join-test.wav');
                expect(retained?.bytes).toEqual(new Uint8Array(sound));
                expect(retained?.reference.provenance.mount.identity.content).toBe(reopened.content.catalog.require(reopened.options.product).id);
                const connection = reopened.remote.shared.client.connection;
                if (connection === null) throw new Error('Missing reopened QW connection');
                const reason = 'QW reopened owner disconnect reason';
                reopened.remote.disconnected(reason);
                expect(prints.filter(text => text === `${reason}\n`)).toHaveLength(1);
                expect(connection.isClosed).toBe(true); expect(reopened.remote.shared.client.connection).toBeNull();
            } finally { await reopened.close(); }
        } else {
            const connection = remote.remote.shared.client.connection;
            if (connection === null) throw new Error('Missing published QW connection');
            const reason = 'QW owner disconnect reason';
            remote.remote.disconnected(reason);
            expect(prints.filter(text => text === `${reason}\n`)).toHaveLength(1);
            expect(connection.isClosed).toBe(true); expect(remote.remote.shared.client.connection).toBeNull();
        }
    } finally { await app?.close(); server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
