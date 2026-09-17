import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRemoteContent } from "../../../src/app/bootstrap/content.ts";
import type { RemoteContentMounts } from "../../../src/app/bootstrap/content.ts";
import { remoteContentSelection } from "../../../src/content/catalog/index.ts";
import { createSimulation } from "../../../src/app/bootstrap/simulation/index.ts";
import { createQ2ApplicationServerHost } from "../../../src/app/bootstrap/simulation/network.ts";
import { Q2WireCodec, Q2ServerMessageReader, PlayerStateT, EntityStateT, encodeQ2Frame, q2OutOfBand, readQ2OutOfBand, readQ2Status } from "../../../src/network/q2/index.ts";
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
    const userRoot = await mkdtemp(join(tmpdir(), 'q2-application-content-'));
    const parsed = parseApplicationCommand(['--user-content-root', userRoot, '--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'coop', '--listen-q2', '0', '--bind', '127.0.0.1', '+set', 'allow_download', '0']);
    if (parsed.kind !== 'run')
        throw new Error('No application launch');
    const prints: string[] = [], server = await Application.open(parsed.options, { print: text => { prints.push(text); return undefined; } });
    const initialDownloadCvars = server.simulation.q2ServerCvars();
    if (initialDownloadCvars === null) throw new Error('Server has no source download cvars');
    expect(initialDownloadCvars.variableString('allow_download')).toBe('0');
    let content = await loadApplicationContent(parsed.options);
    const identity = createIdentityOwner('Q2 UDP remote application'), session = new EngineSession(identity, { kind: 'headless' });
    const otherIdentity = createIdentityOwner('Q2 UDP second peer'), otherSession = new EngineSession(otherIdentity, { kind: 'headless' });
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const discovery = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const address = server.networkAddress;
    if (address === null || address.kind === "ipx")
        throw new Error('Server did not bind UDP');
    let client: Q2ClientNetwork<typeof address> | null = null;
    let otherClient: Q2ClientNetwork<typeof address> | null = null;
    let releaseDownload: () => void = () => undefined;
    const downloads: Extract<Q2ServerRecord['event'], { kind: 'download' }>[] = [];
    let requestedPrecacheDownload = false;
    const downloadOwners: RemoteContentMounts[] = [];
    const prepareServerData = async (data: { readonly gamedir: string }, assertCurrent: () => void): Promise<RemoteContentMounts> => {
        const owner = await openRemoteContent(parsed.options, remoteContentSelection('q2-classic-baseq2', data.gamedir), assertCurrent);
        downloadOwners.push(owner); return owner;
    };
    const remote = new Q2RemotePresentation({ identity, session, seat: identity.seat(0), publish: output => session.publish(output), disconnected: () => { session.clientAt(0)?.disconnect(); }, client: session.createClient(0), nextGeneration: slot => nextActorGeneration(session.session, slot), content, prepareServerData, protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\Network Player\\skin\\male/grunt', print: text => { prints.push(text); }, sendCommand: text => { if (client === null)
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
    remote.client.connect("remote");
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
    const query = async (text: string) => {
        discovery.send(address, q2OutOfBand(text));
        for (let step = 0; step < 8; step++) {
            await exchange(10);
            const packet = discovery.poll();
            if (packet?.kind === 'packet') return readQ2OutOfBand(packet.payload);
        }
        return null;
    };
    try {
        for (let count = 0; count < 80 && (remote.output === null || downloads.length === 0); count++)
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
        const nativePlayer = server.simulation.q2Source()?.players.states.get(admitted.actor);
        if (nativePlayer === undefined) throw new Error('Discovery has no native player state');
        const priorScore = nativePlayer.score, priorPing = nativePlayer.ping;
        nativePlayer.score = 17; nativePlayer.ping = 43;
        cvars.set('hostname', 'Local discovery fixture');
        const statusPacket = await query('status');
        if (statusPacket === null) throw new Error('Native Q2 application ignored status');
        const status = readQ2Status(statusPacket, { kind: 'q2-classic', version: 34 });
        expect(status?.name).toBe('Local discovery fixture'); expect(status?.map).toBe('base1');
        expect(status?.maxPlayers).toBe(server.simulation.options.maxClients);
        expect(status?.rules.get('protocol')).toBe('34');
        expect(status?.playerDetails).toEqual([{ name: nativePlayer.name, score: 17, ping: 43 }]);
        const info = await query('info 34');
        expect(info?.command).toBe('info'); expect(info?.body).toContain('Local discovery fixture');
        expect((await query('info 999'))?.body).toBe('Local discovery fixture: wrong version\n');
        expect(await query('rcon wrong hostname changed')).toBeNull();
        expect(cvars.variableString('hostname')).toBe('Local discovery fixture');
        nativePlayer.score = priorScore; nativePlayer.ping = priorPing;
        expect(server.simulation.players().some(actor => actor.equals(admitted.actor))).toBe(true);
        expect(admitted.actor.equals(player.actor)).toBe(false);
        expect(remote.isPlayer(player.actor)).toBe(true);
        const otherRemote = new Q2RemotePresentation({ identity: otherIdentity, session: otherSession, seat: otherIdentity.seat(0), publish: output => otherSession.publish(output), disconnected: () => { otherSession.clientAt(0)?.disconnect(); }, client: otherSession.createClient(0), nextGeneration: slot => nextActorGeneration(otherSession.session, slot), content, prepareServerData,
            protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\Second Peer\\skin\\male/grunt', print: () => undefined,
            sendCommand: text => otherClient?.command(text), loadContent: async () => content });
        otherRemote.client.connect("remote");
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
        const traveledStatus = await query('status');
        if (traveledStatus === null) throw new Error('Traveled Q2 application ignored status');
        expect(readQ2Status(traveledStatus, { kind: 'q2-classic', version: 34 })?.map).toBe('base2');
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
        for (const owner of downloadOwners) owner.mounts.close();
        releaseDownload();
        discovery.close();
        otherClient?.close();
        client.close();
        await server.close();
        session.close();
        otherSession.close();
        await content.close();
        await rm(userRoot, { recursive: true, force: true });
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

for (const protocol of [{ kind: 'q2-rerelease', version: 1038 }, { kind: 'q2-kex', version: 2023 }] satisfies readonly import('../../../src/contracts/protocol.ts').Q2ProtocolIdentity[]) {
    for (const scenario of ['gain', 'no-cull']) {
        test(`Q2 speaker wire ${protocol.kind} preserves source loop ${scenario}`, async () => {
            const parsed = parseApplicationCommand(['--game', 'q2-rerelease-baseq2', '--map', 'base1', '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'singleplayer']);
            if (parsed.kind !== 'run') throw new Error('No RR launch');
            const content = await loadApplicationContent(parsed.options), identity = createIdentityOwner('Q2 speaker wire');
            const session = new EngineSession(identity, { kind: 'headless' });
            const simulation = createSimulation({ identity, recipe: content.recipe, world: content.world, mounts: content.mounts, skill: 1, mode: 'singleplayer', seed: 1, maxClients: 1, playerIdentity: client => ({ seat: client.slot, socialId: '' }) });
            try {
                const client = session.createClient(0), admitted = simulation.admitPlayer(client.id), source = simulation.q2Source();
                if (source === null) throw new Error('No RR source');
                const host = await createQ2ApplicationServerHost({ session, simulation, content, protocol, print: () => undefined });
                const player = host.carriedPlayer(client.id), body = simulation.bodies.read(admitted.actor);
                if (body === null) throw new Error('No admitted body');
                const codec = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, host.messageOptions);
                const packet = () => {
                    const output = simulation.step({ elapsedMilliseconds: 25, commands: [] });
                    const frame = host.frame(player, output);
                    const decoded = reader.read(encodeQ2Frame(codec, frame, null, new Map<number, EntityStateT>(), 4)).find(record => record.event.kind === 'frame')?.event;
                    if (decoded?.kind !== 'frame') throw new Error('No decoded speaker frame');
                    return decoded.frame.entities;
                };
                const speakers = source.game.load([
                    '{ "classname" "target_speaker" "noise" "world/mach" "volume" "0.25" "spawnflags" "1" }',
                    '{ "classname" "target_speaker" "noise" "world/mach" "volume" "0.25" "spawnflags" "2" "attenuation" "2" }',
                    '{ "classname" "target_speaker" "noise" "world/mach" "volume" "0.25" "spawnflags" "1" "attenuation" "-1" }',
                ].join(' ')).spawned;
                const initial = speakers[0], toggled = speakers[1], global = speakers[2];
                if (initial === undefined || toggled === undefined || global === undefined) throw new Error('Missing source speakers');
                for (const speaker of speakers) source.game.move(speaker, { origin: body.origin });
                const numberOf = (actor: typeof admitted.actor) => {
                    const address = simulation.actors.sourceOf(actor);
                    if (address === null) throw new Error('Missing speaker source address');
                    return address.slot;
                };
                const initialNumber = numberOf(initial.actor.id), toggledNumber = numberOf(toggled.actor.id), globalNumber = numberOf(global.actor.id);
                if (scenario === 'gain') {
                    const ordinary = source.game.create('wire_other_loop_probe');
                    ordinary.sound = initial.sound; ordinary.volume = 0.25; ordinary.attenuation = 2;
                    source.game.move(ordinary, { origin: body.origin });
                    const baseline = host.gameState(player).baselines;
                    expect(baseline.get(numberOf(ordinary.actor.id))?.loop_volume).toBe(0.25);
                    expect(baseline.get(initialNumber)?.loop_volume).toBe(1);
                    const first = packet();
                    // Both wire formats encode gain 1 and attenuation 3 with the default zero sentinel.
                    expect(first.find(entity => entity.number === initialNumber)?.loop_volume).toBe(0);
                    expect(first.find(entity => entity.number === initialNumber)?.loop_attenuation).toBe(0);
                    expect(first.find(entity => entity.number === numberOf(ordinary.actor.id))?.loop_volume).toBeCloseTo(0.25, 2);
                    expect(first.find(entity => entity.number === globalNumber)?.loop_attenuation).toBe(-1);
                    expect(first.some(entity => entity.number === toggledNumber)).toBe(false);
                    source.game.host.callbacks.use(toggled.actor, admitted.actor, admitted.actor);
                    const started = packet().find(entity => entity.number === toggledNumber);
                    expect(started?.loop_volume).toBe(0); expect(started?.loop_attenuation).toBe(2); expect(started?.sound).toBeGreaterThan(0);
                    source.game.host.callbacks.use(toggled.actor, admitted.actor, admitted.actor);
                    expect(packet().some(entity => entity.number === toggledNumber)).toBe(false);
                    source.game.host.callbacks.use(toggled.actor, admitted.actor, admitted.actor);
                    const restarted = packet().find(entity => entity.number === toggledNumber);
                    expect(restarted?.loop_volume).toBe(0); expect(restarted?.loop_attenuation).toBe(2); expect(restarted?.sound).toBe(started?.sound);
                } else {
                    const far = { x: body.origin.x + 1000, y: body.origin.y, z: body.origin.z };
                    source.game.move(initial, { origin: far }); source.game.move(global, { origin: far });
                    simulation.scene.areasConnected = () => true;
                    simulation.scene.clusterVisible = () => true;
                    expect(packet().some(entity => entity.number === initialNumber)).toBe(false);
                    expect(packet().some(entity => entity.number === globalNumber)).toBe(true);
                    simulation.scene.clusterVisible = () => false;
                    expect(packet().some(entity => entity.number === globalNumber)).toBe(true);
                    simulation.scene.areasConnected = () => false;
                    expect(packet().some(entity => entity.number === globalNumber)).toBe(true);
                    global.serverFlags |= 1;
                    expect(packet().some(entity => entity.number === globalNumber)).toBe(false);
                    global.serverFlags &= ~1; global.visible = false;
                    expect(packet().some(entity => entity.number === globalNumber)).toBe(false);
                    global.visible = true;
                    source.game.host.callbacks.use(global.actor, admitted.actor, admitted.actor);
                    expect(packet().some(entity => entity.number === globalNumber)).toBe(false);
                    source.game.host.callbacks.use(global.actor, admitted.actor, admitted.actor);
                    expect(packet().find(entity => entity.number === globalNumber)?.loop_attenuation).toBe(-1);
                }
            } finally { simulation.close(); session.close(); await content.close(); }
        }, 30000);
    }
}

test('Q2 source movement settings follow Q64 travel and valid wire layouts', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { selectedMovementProfile } = await import('../../../src/app/bootstrap/simulation/player-movement.ts');
    const { q2ApplicationLayout } = await import('../../../src/app/bootstrap/network/q2-layout.ts');
    const { encodeQ2ServerEvent } = await import('../../../src/network/q2/index.ts');
    const { discoverInstalledContent } = await import('../../../src/content/catalog/index.ts');
    const { StartupSelectionModel } = await import('../../../src/app/bootstrap/startup-selection.ts');
    const userRoot = await mkdtemp(join(tmpdir(), 'q2-movement-config-'));
    try {
        const parsed = parseApplicationCommand(['--game', 'q2-rerelease-baseq2', '--map', 'q64/bio',
            '--movement', 'q2', '--character', 'q2', '--dedicated', '--mode', 'coop', '--user-content-root', userRoot]);
        if (parsed.kind !== 'run') throw new Error('No Q64 source launch');
        const catalog = await discoverInstalledContent({ corpusRoot: parsed.options.corpusRoot, userContentRoot: userRoot, discoverMods: false });
        const selection = new StartupSelectionModel(catalog, parsed.options);
        await selection.prepareMaps();
        selection.select('movement', 'q2-rerelease-baseq2');
        const selected = await selection.resolve();
        const app = await Application.open(selected.options, { print: () => undefined }, selected.recipe);
        try {
            const client = app.session.createClient(0);
            app.simulation.admitPlayer(client.id);
            for (const map of ['q64/bio', 'base1', 'q64/bio']) {
                if (app.simulation.q2Source()?.game.options.mapName !== map) await app.changeLevel(map);
                const actor = app.simulation.players()[0];
                if (actor === undefined) throw new Error('No carried source player');
                const player = app.simulation.movementPlayer(actor), cvars = app.simulation.q2ServerCvars();
                if (player === null || cvars === null) throw new Error('No source movement owner');
                cvars.set('sv_airaccelerate', '2.9');
                const profile = selectedMovementProfile(player);
                expect(profile.kind).toBe('q2-rerelease');
                if (profile.kind !== 'q2-rerelease') throw new Error('Wrong selected movement');
                expect(profile.airAccelerate).toBe(2);
                expect(profile.n64Physics).toBe(map.startsWith('q64/'));
                for (const protocol of [{ kind: 'q2-classic', version: 34 }, { kind: 'q2-private-classic', version: 4038 },
                    { kind: 'q2-rerelease', version: 1038 }, { kind: 'q2-kex', version: 2023 }] satisfies readonly import('../../../src/contracts/protocol.ts').Q2ProtocolIdentity[]) {
                    const host = await createQ2ApplicationServerHost({ session: app.session, simulation: app.simulation, content: app.content, protocol, print: () => undefined });
                    const peer = host.carriedPlayer(client.id), layout = q2ApplicationLayout(protocol), state = host.gameState(peer);
                    expect(state.configStrings.get(layout.airAccelerate)).toBe('2');
                    expect(state.configStrings.get(12103)).toBe(layout.n64Physics === null ? undefined : map.startsWith('q64/') ? '1' : '0');
                    const wire = new Q2WireCodec(protocol), reader = new Q2ServerMessageReader(protocol, host.messageOptions);
                    for (const index of [layout.airAccelerate, layout.n64Physics]) {
                        if (index === null) continue;
                        const value = state.configStrings.get(index);
                        if (value === undefined) throw new Error('Missing movement configstring');
                        expect(reader.read(encodeQ2ServerEvent(wire, { kind: 'config-string', index, value }))[0]?.event).toEqual({ kind: 'config-string', index, value });
                    }
                    cvars.set('sv_airaccelerate', '-3.8');
                    const output = await app.step(25);
                    const update = host.events(peer, output, []).find(event => event.kind === 'config-string' && event.index === layout.airAccelerate);
                    if (update?.kind !== 'config-string') throw new Error('Missing live air acceleration update');
                    expect(reader.read(encodeQ2ServerEvent(wire, update))[0]?.event).toEqual({ kind: 'config-string', index: layout.airAccelerate, value: '-3' });
                    cvars.set('sv_airaccelerate', '2.9');
                }
                for (let frame = 0; frame < 20; frame++) await app.step(25);
                const crouch = player.move({ actor, source: { kind: 'remote-client', client: client.id }, sequence: 1,
                    command: { kind: 'q2-rerelease', milliseconds: 25, angles: player.viewAngles, forwardMove: 0, sideMove: 0, buttons: 16, serverFrame: 1 } },
                    { frame: 1, time: { kind: 'milliseconds', value: app.simulation.timeSeconds * 1000 }, elapsed: { kind: 'milliseconds', value: 25 }, phase: 'client-command' });
                if (crouch.status !== 'active') throw new Error('Source crouch removed player');
                expect(crouch.bounds.max.z).toBe(map.startsWith('q64/') ? 32 : 4);
                if (map === 'base1' && player.state.kind === 'q2-rerelease') {
                    const airborne = { ...player.state, origin: { ...player.state.origin, z: player.state.origin.z + 48 },
                        velocity: { x: 0, y: 150, z: 0 }, flags: 0, timeMilliseconds: 0 };
                    const velocities: import("../../../src/contracts/math.ts").Vec3[] = [];
                    for (const air of ['0', '2.9']) {
                        cvars.set('sv_airaccelerate', air); player.commit(airborne, true, false);
                        const moved = player.move({ actor, source: { kind: 'remote-client', client: client.id }, sequence: 2,
                            command: { kind: 'q2-rerelease', milliseconds: 25, angles: { x: 0, y: 0, z: 0 }, forwardMove: 300, sideMove: 0, buttons: 0, serverFrame: 2 } },
                            { frame: 2, time: { kind: 'milliseconds', value: app.simulation.timeSeconds * 1000 }, elapsed: { kind: 'milliseconds', value: 25 }, phase: 'client-command' });
                        if (moved.status !== 'active' || moved.state.kind !== 'q2-rerelease') throw new Error('Lost RR air movement');
                        velocities.push(moved.state.velocity);
                    }
                    expect(velocities[0]).not.toEqual(velocities[1]);
                }
            }
            const deathmatch = createSimulation({ identity: createIdentityOwner('Q64 deathmatch movement'), recipe: app.content.recipe,
                world: app.content.world, mounts: app.content.mounts, skill: 1, mode: 'deathmatch', seed: 1, maxClients: 1,
                q2Cvars: [{ name: 'sv_airaccelerate', value: '4.9' }], playerIdentity: client => ({ seat: client.slot, socialId: '' }) });
            try { expect(deathmatch.q2MovementConfig()).toEqual({ airAccelerate: 4, n64Physics: false }); }
            finally { deathmatch.close(); }
        } finally { await app.close(); }
    } finally { await rm(userRoot, { recursive: true, force: true }); }
}, 30000);
