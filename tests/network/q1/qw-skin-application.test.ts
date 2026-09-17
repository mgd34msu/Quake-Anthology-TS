import { encodePng } from "../../../src/formats/images/png.ts";
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePcx } from '../../../src/formats/images/indexed.ts';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { QwRemotePresentation } from '../../../src/app/bootstrap/network/remote-qw.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { addressKey } from '../../../src/network/common/endpoint.ts';
import { QuakeWorldChannel } from '../../../src/network/q1/channels.ts';
import { quakeWorldOutOfBand, readQuakeWorldOutOfBand, quakeWorldCommandArguments, quakeWorldInfo } from '../../../src/network/q1/handshake.ts';
import { decodeQuakeWorldClient } from '../../../src/network/q1/commands.ts';
import { writeQuakeWorldMessage, writeQuakeWorldEntities } from '../../../src/network/q1/quakeworld.ts';
import type { QuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import { QwEntityStateT } from '../../../src/network/q1/qw-constants.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import type { QwServerData } from '../../../src/app/bootstrap/network/qw-types.ts';
import type { QwPlayerState } from '../../../src/contracts/protocol.ts';
const profile = { kind: 'q1-quakeworld', version: 28 } satisfies QwServerData['protocol'];
const pcx = (index: number): Uint8Array => encodePcx({ width: 320, height: 200, indices: Uint8Array.from({ length: 320 * 200 }, (_, offset) => offset === 0 ? 0 : index) }, new Uint8Array(768));
for (const renderer of ['cpu', 'gl']) test(`hidden ${renderer} QW player skins follow live userinfo, controls and contained downloads`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'qw-skin-application-')), server = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    let app: RemoteApplication | null = null;
    const commands: string[] = [], prints: string[] = [];
    try {
        const gameRoot = join(root, 'q1/qw');
        await mkdir(join(gameRoot, 'settings'), { recursive: true }); await mkdir(join(gameRoot, 'skins'), { recursive: true });
        await writeFile(join(gameRoot, 'settings/client.cfg'), 'name "Configured"\nnoskins "2"\nbaseskin "fallback"\n');
        await writeFile(join(gameRoot, 'skins/fallback.pcx'), pcx(20)); await writeFile(join(gameRoot, 'skins/paint.pcx'), pcx(100));
        const launch = parseApplicationCommand(['--game', 'q1-classic-id1', '--map', 'e1m1', '--movement', 'q1', '--character', 'q1', '--connect-qw', addressKey(server.address), '--renderer', renderer, '--width', '160', '--height', '120', '--hidden', '--user-content-root', root]);
        if (launch.kind !== 'run') throw new Error('Expected QW run');
        app = await RemoteApplication.open(launch.options, { print: text => { prints.push(text); return undefined; } });
        const remote = app, cvars = remote.clientCommands?.cvars;
        if (cvars === undefined || !(remote.remote instanceof QwRemotePresentation)) throw new Error('No QW client controls');
        const remoteAddress = () => { const address = remote.networkAddress; if (address.kind === "ipx") throw new Error("Expected UDP client address"); return address; };
        const presentation = remote.remote;
        let channel: QuakeWorldChannel | null = null, begun = false, downloadOffset = 0;
        const download = pcx(36);
        const player = (slot: number): QwPlayerState => ({ number: slot, flags: 0, origin: { x: 480, y: slot === 3 ? -352 : -304, z: 88 }, velocity: { x: 0, y: 0, z: 0 }, modelIndex: 2, frame: 0, skin: 0, effects: 0, weaponFrame: 0, milliseconds: 0, command: { kind: 'q1-quakeworld', milliseconds: 0, angles: { x: 0, y: 0, z: 0 }, forwardMove: 0, sideMove: 0, upMove: 0, buttons: 0, impulse: 0 } });
        const send = (records: readonly Exclude<QuakeWorldMessage, { kind: 'packet-entities' | 'invalid-delta' }>[], snapshot = false): void => {
            if (channel === null) throw new Error('No QW channel');
            const bytes = new SizeBuf(1450); for (const record of records) writeQuakeWorldMessage(bytes, profile, record);
            if (snapshot) { const entity = new QwEntityStateT(); entity.number = 40; entity.modelindex = 2; entity.origin[0] = 800; entity.origin[1] = -304; entity.origin[2] = 88; writeQuakeWorldEntities(bytes, profile, [entity], new Map<number, QwEntityStateT>(), null); }
            server.send(remoteAddress(), channel.transmit(bytes.bytes(), performance.now()));
        };
        const snapshot = (): void => send([{ kind: 'stat', index: 0, value: 100 }, { kind: 'player', state: player(3) }, { kind: 'player', state: player(7) }], true);
        const chunk = (): void => { const bytes = download.subarray(downloadOffset, downloadOffset + 768); downloadOffset += bytes.length; send([{ kind: 'download', result: { kind: 'data', percent: Math.floor(downloadOffset * 100 / download.length), bytes } }]); };
        const exchange = async (): Promise<void> => {
            await remote.step(50); await Bun.sleep(1);
            for (;;) {
                const packet = server.poll(); if (packet === null) break; if (packet.kind !== 'packet') continue;
                if (new DataView(packet.payload.buffer, packet.payload.byteOffset).getInt32(0, true) === -1) {
                    const text = readQuakeWorldOutOfBand(packet.payload);
                    if (text.startsWith('getchallenge')) server.send(remoteAddress(), quakeWorldOutOfBand('c42'));
                    else { const args = quakeWorldCommandArguments(text); expect(quakeWorldInfo(args[4] ?? '').get('name')).toBe('Configured'); channel = new QuakeWorldChannel('server', Number(args[2])); server.send(remoteAddress(), quakeWorldOutOfBand('j')); }
                    continue;
                }
                const delivery = channel?.receive(packet.payload, performance.now()); if (delivery === null || delivery === undefined) continue;
                for (const record of decodeQuakeWorldClient(delivery.payload, profile, delivery.sequence)) {
                    if (record.kind !== 'string-command') continue; commands.push(record.text);
                    if (record.text === 'new') send([{ kind: 'server-data', protocol: profile, serverCount: 3, gameDirectory: 'qw', playerSlot: 3, spectator: false, level: 'e1m1', moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } }]);
                    else if (record.text === 'soundlist 3 0') send([{ kind: 'sound-list', first: 0, names: [], next: 0 }]);
                    else if (record.text === 'modellist 3 0') send([{ kind: 'model-list', first: 0, names: ['maps/e1m1.bsp', 'progs/player.mdl'], next: 0 }]);
                    else if (record.text.startsWith('prespawn 3 0 ')) send([{ kind: 'stufftext', text: 'cmd spawn 3 0\n' }]);
                    else if (record.text === 'spawn 3 0') send([{ kind: 'userinfo', slot: 7, userId: 8, value: '\\name\\Other\\skin\\missing.pcx\\topcolor\\2\\bottomcolor\\3' }, { kind: 'set-angle', angles: { x: 0, y: 90, z: 0 } }, { kind: 'stufftext', text: 'skins\n' }]);
                    else if (record.text === 'begin 3') { begun = true; snapshot(); }
                    else if (record.text === 'download skins/missing.pcx') { downloadOffset = 0; chunk(); }
                    else if (record.text === 'nextdl') chunk();
                }
                if (begun && delivery.payload.length === 0) snapshot();
            }
            await Bun.sleep(1);
        };
        for (let i = 0; i < 150 && remote.localPlayers.length === 0; i++) await exchange();
        expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull();
        const model = () => presentation.presentations().find(model => presentation.shared.playerSlot(model.actor) === 7);
        const selected = model(); if (selected === undefined) throw new Error(`No remote QW player: ${prints.join('')}`);
        expect(selected.indexedSkin?.pixels[1]).toBe(20); expect(selected.playerColors).toEqual({ top: 2, bottom: 3 });
        expect(presentation.shared.playerSlot(selected.actor)).toBe(7);
        const plain = presentation.presentations().find(model => model.path === 'progs/player.mdl' && presentation.shared.playerSlot(model.actor) === null);
        expect(plain?.playerColors).toBeUndefined(); expect(plain?.indexedSkin).toBeUndefined(); expect(plain).toBeDefined();
        expect(commands.some(command => command.startsWith('download skins/'))).toBe(false);
        const capture = async (): Promise<Uint8Array> => { const pending = remote.captureNextFrame(); await remote.step(50); return pending; };
        const beforeColors = await capture();
        await Bun.write(`/tmp/qw-skin-application-${renderer}-before.png`, encodePng(160, 120, beforeColors));
        send([{ kind: 'set-info', slot: 7, key: 'topcolor', value: '99' }, { kind: 'set-info', slot: 7, key: 'bottomcolor', value: '-1' }]); await Bun.sleep(1); await remote.step(50);
        expect(model()?.playerColors).toEqual({ top: 13, bottom: 13 }); const afterColors = await capture(); await Bun.write(`/tmp/qw-skin-application-${renderer}-after.png`, encodePng(160, 120, afterColors)); expect(afterColors.some((value, index) => value !== beforeColors[index])).toBe(true);
        send([{ kind: 'set-info', slot: 7, key: 'skin', value: 'paint.pcx' }]); await Bun.sleep(1); await remote.step(50);
        expect(model()?.indexedSkin?.pixels[1]).toBe(100); expect(commands.some(command => command.startsWith('download skins/'))).toBe(false);
        cvars.set('noskins', '1'); await remote.step(50); expect(model()?.indexedSkin).toBeUndefined();
        cvars.set('noskins', '2'); await remote.step(50); expect(model()?.indexedSkin?.pixels[1]).toBe(100);
        send([{ kind: 'set-info', slot: 7, key: 'skin', value: 'missing.pcx' }]); await Bun.sleep(1); await remote.step(50); expect(model()?.indexedSkin?.pixels[1]).toBe(20);
        remote.queueCommand('skins', [], null); await exchange(); expect(commands.some(command => command.startsWith('download skins/'))).toBe(false);
        cvars.set('noskins', '0'); remote.queueCommand('skins', [], null); await exchange(); expect(model()?.indexedSkin).toBeUndefined();
        for (let i = 0; i < 100 && model()?.indexedSkin?.pixels[1] !== 36; i++) await exchange();
        expect(model()?.indexedSkin?.pixels[1]).toBe(36); expect(commands).toContain('download skins/missing.pcx');
        expect(new Uint8Array(await readFile(join(gameRoot, 'skins/missing.pcx')))).toEqual(new Uint8Array(download));
        expect(commands.filter(command => command === 'begin 3')).toHaveLength(1);
        remote.queueCommand('allskins', ['paint.pcx'], null); await exchange(); expect(model()?.indexedSkin?.pixels[1]).toBe(100);
        remote.queueCommand('allskins', [], null); await exchange(); expect(model()?.indexedSkin?.pixels[1]).toBe(36);
        cvars.set('name', 'Changed'); await exchange(); expect(commands).toContain('setinfo "name" "Changed"');
        expect(remote.networkPhase).toBe('active'); expect(remote.session.world).toBeNull();
        cvars.set('noskins', '2'); await remote.close(); app = null;
        const saved = await readFile(join(gameRoot, 'settings/client.cfg'), 'utf8'); expect(saved).toContain('noskins "2"'); expect(saved).toContain('baseskin "fallback"');
    } finally { await app?.close(); server.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);
