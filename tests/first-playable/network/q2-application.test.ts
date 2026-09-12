import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createQ2ApplicationServerHost } from "../../../src/app/bootstrap/simulation/network.ts";
import { Q2WireCodec, Q2ServerMessageReader, PlayerStateT, EntityStateT, encodeQ2Frame } from "../../../src/network/q2/index.ts";
import type { Q2ServerRecord } from "../../../src/network/q2/index.ts";
import { expect, test } from 'bun:test';
import { Application } from '../../../src/app/bootstrap/application.ts';
import { loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q2ClientNetwork, Q2RemotePresentation } from '../../../src/app/bootstrap/network/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
test('native Q2 UDP signon admits and moves the actual Application player', async () => {
    const parsed = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'coop', '--listen-q2', '0', '--bind', '127.0.0.1']);
    if (parsed.kind !== 'run')
        throw new Error('No application launch');
    const prints: string[] = [], server = await Application.open(parsed.options, { print: text => { prints.push(text); return undefined; } });
    let content = await loadApplicationContent(parsed.options);
    const identity = createIdentityOwner('Q2 UDP remote application'), session = new EngineSession(identity, { kind: 'headless' });
    const otherIdentity = createIdentityOwner('Q2 UDP second peer'), otherSession = new EngineSession(otherIdentity, { kind: 'headless' });
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const address = server.networkAddress;
    if (address === null)
        throw new Error('Server did not bind UDP');
    let client: Q2ClientNetwork<typeof address> | null = null;
    let otherClient: Q2ClientNetwork<typeof address> | null = null;
    let releaseDownload: () => void = () => undefined;
    const downloads: Extract<Q2ServerRecord['event'], { kind: 'download' }>[] = [];
    let requestedPrecacheDownload = false;
    const remote = new Q2RemotePresentation({ identity, session, content, protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\Network Player\\skin\\male/grunt', print: text => { prints.push(text); }, sendCommand: text => { if (client === null)
            throw new Error('Client transport unavailable'); client.command(text); }, loadContent: async (state) => {
            const map = state.configStrings.get(33);
            if (map === undefined)
                throw new Error('Server has no world model');
            if (map !== content.recipe.map.geometry.requestedPath) {
                const previous = content;
                content = await loadApplicationContent({ ...parsed.options, map });
                await previous.close();
            }
            if (!requestedPrecacheDownload) {
                requestedPrecacheDownload = true;
                client?.command('download models/weapons/v_blast/tris.md2');
            }
            return content;
        } });
    const receiveRecords = remote.records.bind(remote);
    remote.records = records => {
        for (const record of records) if (record.event.kind === 'download') downloads.push(record.event);
        receiveRecords(records);
    };
    client = new Q2ClientNetwork({ transport, remote: address, host: remote, qport: 4218 });
    let now = 0;
    const exchange = async (milliseconds = 100): Promise<void> => {
        now += milliseconds;
        await client?.poll(now);
        await otherClient?.poll(now);
        await Bun.sleep(1);
        await server.step(milliseconds);
        await Bun.sleep(1);
        await client?.poll(now);
        await otherClient?.poll(now);
    };
    try {
        for (let count = 0; count < 80 && remote.output === null; count++)
            await exchange();
        expect(client.phase).toBe('active');
        expect(remote.output).not.toBeNull();
        expect(session.world).toBeNull();
        expect(downloads).toEqual([{ kind: 'download', bytes: null, percent: 0 }]);
        const cvars = server.simulation.q2ServerCvars();
        if (cvars === null) throw new Error('Server has no source download cvars');
        expect(cvars.variableString('allow_download')).toBe('0');
        process.stdin.emit('data', 'allow_download 1\n');
        await exchange();
        expect(cvars.variableString('allow_download')).toBe('1');
        const requestDownload = async (command: string) => {
            const count = downloads.length;
            client?.command(command);
            for (let step = 0; step < 8 && downloads.length === count; step++) await exchange(10);
            const event = downloads[count];
            if (event === undefined) throw new Error(`No native download response for ${command}`);
            expect(downloads.length).toBe(count + 1);
            return event;
        };
        expect(await requestDownload('download maps/base1.bsp')).toEqual({ kind: 'download', bytes: null, percent: 0 });
        const downloadPath = 'models/weapons/v_blast/tris.md2';
        const mounted = await server.content.forContent(server.content.recipe.map.entities.content), asset = await mounted.read(downloadPath);
        const openMounted = mounted.open.bind(mounted);
        let downloadGate: Promise<void> | null = null;
        mounted.open = async name => {
            const gate = downloadGate, opened = await openMounted(name);
            if (name === downloadPath && gate !== null) await gate;
            return opened;
        };
        const offset = asset.length - 2051;
        const firstBlock = await requestDownload(`download ${downloadPath} ${offset}`);
        expect(firstBlock.bytes).toEqual(asset.slice(offset, offset + 1024));
        expect(firstBlock.percent).toBe(Math.floor((offset + 1024) * 100 / asset.length));
        expect(await requestDownload('download ../config.cfg')).toEqual({ kind: 'download', bytes: null, percent: 0 });
        expect((await requestDownload('nextdl')).bytes).toEqual(asset.slice(offset + 1024, offset + 2048));
        expect(await requestDownload('nextdl')).toEqual({ kind: 'download', bytes: asset.slice(-3), percent: 100 });
        const completed = downloads.length;
        client.command('nextdl'); await exchange(); await exchange();
        expect(downloads.length).toBe(completed);
        expect(await requestDownload(`download ${downloadPath} ${asset.length + 500}`)).toEqual({ kind: 'download', bytes: new Uint8Array(0), percent: 100 });
        await requestDownload(`download ${downloadPath}`);
        expect(await requestDownload('download models/no-such-source-model.md2')).toEqual({ kind: 'download', bytes: null, percent: 0 });
        const refusedReplacement = downloads.length;
        client.command('nextdl'); await exchange(); await exchange();
        expect(downloads.length).toBe(refusedReplacement);
        const player = remote.player, admitted = server.networkClients[0];
        if (player === null || admitted === undefined)
            throw new Error(`No actual network player: ${prints.join('')}`);
        expect(server.simulation.players().some(actor => actor.equals(admitted.actor))).toBe(true);
        expect(admitted.actor.equals(player.actor)).toBe(false);
        expect(remote.isPlayer(player.actor)).toBe(true);
        const otherRemote = new Q2RemotePresentation({ identity: otherIdentity, session: otherSession, content,
            protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\Second Peer\\skin\\male/grunt', print: () => undefined,
            sendCommand: text => otherClient?.command(text), loadContent: async () => content });
        otherClient = new Q2ClientNetwork({ transport: await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), remote: address, host: otherRemote, qport: 4219 });
        for (let step = 0; step < 80 && otherRemote.output === null; step++) await exchange();
        const second = server.networkClients.find(candidate => !candidate.client.equals(admitted.client)), otherPlayer = otherRemote.player;
        if (second === undefined || otherPlayer === null) throw new Error('Second native UDP peer did not join');
        const secondOwner = server.simulation.movementPlayer(second.actor), secondBody = server.simulation.bodies.read(second.actor), firstBody = server.simulation.bodies.read(admitted.actor);
        if (secondOwner === null || secondBody === null || firstBody === null) throw new Error('Second admitted native player has no shared body');
        server.simulation.bodies.write(secondOwner.actor, { ...secondBody, origin: { ...firstBody.origin, x: firstBody.origin.x + 48 } });
        server.simulation.bodies.link(secondOwner.actor);
        await exchange(); await exchange();
        const remoteOther = remote.output?.snapshot.actors.find(actor => !actor.id.equals(player.actor) && remote.isPlayer(actor.id));
        if (remoteOther === undefined) throw new Error('Remote observation lost the other admitted native player');
        expect(remote.isPlayer(remoteOther.id)).toBe(true);
        expect(remote.output?.snapshot.actors.some(actor => !remote.isPlayer(actor.id))).toBe(true);
        downloadGate = new Promise<void>(resolve => { releaseDownload = resolve; });
        const beforeDeferred = downloads.length, otherAngles = server.simulation.playerView(second.actor).angles;
        client.command(`download ${downloadPath}`);
        otherClient.submit([{ actor: otherPlayer.actor, source: { kind: 'remote-client', client: otherPlayer.client }, sequence: 0,
            command: { kind: 'q2-classic', milliseconds: 100, angleShorts: [8192, 0, 0], forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 128 } }], now);
        now += 100; await client.poll(now); await otherClient.poll(now); await Bun.sleep(1);
        const stepping = server.step(100);
        const advancedWhilePending = await Promise.race([stepping.then(() => true), Bun.sleep(250).then(() => false)]);
        const anglesWhilePending = server.simulation.playerView(second.actor).angles;
        releaseDownload(); downloadGate = null;
        await stepping;
        expect(advancedWhilePending).toBe(true);
        expect(anglesWhilePending).not.toEqual(otherAngles);
        expect(downloads.length).toBe(beforeDeferred);
        for (let step = 0; step < 8 && downloads.length === beforeDeferred; step++) await exchange();
        expect(downloads[beforeDeferred]).toEqual({ kind: 'download', bytes: asset.slice(0, 1024), percent: Math.floor(102400 / asset.length) });
        otherClient.close(); otherClient = null;
        await exchange(); await exchange();
        expect(remote.isPlayer(remoteOther.id)).toBe(false);

        const before = server.simulation.bodies.read(admitted.actor)?.origin;
        if (before === undefined)
            throw new Error('Admitted source actor has no body');
        for (let sequence = 0; sequence < 6; sequence++) {
            client.submit([{ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command: { kind: 'q2-classic', milliseconds: 100, angleShorts: [0, 0, 0], forwardMove: 200, sideMove: 0, upMove: 0, buttons: 0, impulse: 0, lightLevel: 128 } }], now);
            await exchange();
        }
        const after = server.simulation.bodies.read(admitted.actor)?.origin;
        if (after === undefined)
            throw new Error('Source actor lost its body');
        expect(after).not.toEqual(before);
        expect(remote.playerView(player.actor).origin).toEqual(after);
        expect(remote.playerUi(player.actor).health).toBe(server.simulation.playerUi(admitted.actor).health);
        client.command('say actual-source-chat');
        await exchange(10);
        await exchange(10);
        expect(prints.some(text => text.includes('Network Player: actual-source-chat'))).toBe(true);
        downloadGate = new Promise<void>(resolve => { releaseDownload = resolve; });
        const beforeTravelDownload = downloads.length;
        client.command(`download ${downloadPath}`);
        await exchange();
        expect(downloads.length).toBe(beforeTravelDownload);
        server.queueCommand('map', ['base2'], null);
        for (let count = 0; count < 80 && (content.recipe.map.geometry.requestedPath !== 'maps/base2.bsp' || remote.output === null || remote.player?.actor.equals(player.actor)); count++)
            await exchange();
        expect(content.recipe.map.geometry.requestedPath).toBe('maps/base2.bsp');
        expect(remote.output).not.toBeNull();
        expect(server.networkClients[0]?.client.equals(admitted.client)).toBe(true);
        expect(remote.player?.client.equals(player.client)).toBe(true);
        expect(remote.player?.actor.equals(player.actor)).toBe(false);
        expect(remote.isPlayer(player.actor)).toBe(false);
        releaseDownload(); downloadGate = null;
        await exchange(); await exchange();
        expect(downloads.length).toBe(beforeTravelDownload);
        const beforeNextMap = downloads.length;
        client.command('nextdl'); await exchange(); await exchange();
        expect(downloads.length).toBe(beforeNextMap);
        expect(server.simulation.q2ServerCvars()?.variableString('allow_download')).toBe('1');
        client.close();
        await Bun.sleep(1);
        await server.step(100);
        expect(server.networkClients).toHaveLength(0);
        expect(server.simulation.players()).toHaveLength(0);
    }
    finally {
        releaseDownload();
        otherClient?.close();
        client.close();
        await server.close();
        session.close();
        otherSession.close();
        await content.close();
    }
}, 30000);

test('lower-level Q2 host preserves a synthetic unsupported RR model-beam endpoint through protocol 34', async () => {
    const parsed = parseApplicationCommand(['--game', 'q2-rerelease-baseq2', '--map', 'base1', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'singleplayer']);
    if (parsed.kind !== 'run') throw new Error('No RR launch');
    const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner('Q2 model-beam wire');
    const session = new EngineSession(identity, { kind: 'headless' });
    const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: 'singleplayer', seed: 1, maxClients: 1, playerIdentity: client => ({ seat: client.slot, socialId: '' }) });
    try {
        const client = session.createClient(0), admitted = simulation.admitPlayer(client.id), source = simulation.q2Source();
        if (source === null) throw new Error('No native RR source');
        const host = await createQ2ApplicationServerHost({ session, simulation, content, protocol: { kind: 'q2-classic', version: 34 }, print: () => undefined });
        expect(host.supportsSourceWire().kind).toBe('unsupported');
        const player = host.carriedPlayer(client.id), body = simulation.bodies.read(admitted.actor);
        if (body === null) throw new Error('No admitted body');
        const segment = source.game.create('wire_model_beam_probe');
        segment.model = 'models/monsters/parasite/segment/tris.md2'; segment.renderFlags = 128; segment.frame = 30;
        const origin = { x: 16, y: 32, z: 48 }, endpoint = { x: 88.125, y: -24.5, z: 64.75 };
        source.game.move(segment, { origin }); segment.pos2 = endpoint;
        const presentation = simulation.presentations().find(value => value.actor.equals(segment.actor.id));
        expect(presentation?.modelBeam).toEqual({ segmentLength: 30 });
        expect(presentation?.previousOrigin).toEqual(endpoint);
        const ordinary = source.game.create('wire_ordinary_probe'); ordinary.model = segment.model; ordinary.pos2 = endpoint;
        source.game.move(ordinary, { origin });
        const ordinaryAddress = simulation.actors.sourceOf(ordinary.actor.id);
        if (ordinaryAddress === null) throw new Error('No ordinary source address');
        const ordinaryWire = host.gameState(player).baselines.get(ordinaryAddress.slot);
        if (ordinaryWire === undefined) throw new Error('No ordinary network model');
        expect(Array.from(ordinaryWire.old_origin)).toEqual([16, 32, 48]);
        const address = simulation.actors.sourceOf(segment.actor.id);
        if (address === null) throw new Error('No source address');
        const wire = host.gameState(player).baselines.get(address.slot);
        if (wire === undefined) throw new Error('No network segment');
        expect(Array.from(wire.origin)).toEqual([16, 32, 48]);
        expect(Array.from(wire.old_origin)).toEqual([88.125, -24.5, 64.75]);
        const codec = new Q2WireCodec({ kind: 'q2-classic', version: 34 });
        const reader = new Q2ServerMessageReader({ kind: 'q2-classic', version: 34 }, host.messageOptions);
        const frame = { serverFrame: 1, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array(), player: new PlayerStateT(), entities: [wire] };
        const decoded = reader.read(encodeQ2Frame(codec, frame, null, new Map<number, EntityStateT>(), 4)).find(record => record.event.kind === 'frame')?.event;
        if (decoded?.kind !== 'frame') throw new Error('No decoded frame');
        const received = decoded.frame.entities.find(entity => entity.number === address.slot);
        if (received === undefined) throw new Error('No decoded segment');
        expect(Array.from(received.old_origin)).toEqual([88.125, -24.5, 64.75]);
        expect(received.renderfx).toBe(128); expect(received.frame).toBe(30); expect(received.modelindex).toBe(wire.modelindex);
    } finally { simulation.close(); session.close(); await content.close(); }
}, 30000);
