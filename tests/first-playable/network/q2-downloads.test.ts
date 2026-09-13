import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQ2ApplicationDownloads, Q2PeerDownload } from '../../../src/app/bootstrap/network/q2-downloads.ts';
import { createMountIdentity } from '../../../src/contracts/content.ts';
import type { LooseMount } from '../../../src/contracts/content.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { openMountPlan } from '../../../src/content/mounts/index.ts';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import { Q2WireCodec, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { EntityStateT } from '../../../src/network/q2/index.ts';
import type { DownloadSource } from '../../../src/network/services/downloads.ts';
import { DownloadSink } from '../../../src/network/services/downloads.ts';
import { LoadedApplicationContent, loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q2ClientNetwork, Q2ServerNetwork } from '../../../src/app/bootstrap/network/q2.ts';
import { Q2RemotePresentation } from '../../../src/app/bootstrap/network/remote.ts';
import type { Q2ApplicationGameState, Q2ApplicationServerHost } from '../../../src/app/bootstrap/network/types.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { blockChecksum } from '../../../src/core/md4.ts';
import { readQ2Bsp, toQ2WorldGeometry } from '../../../src/formats/q2-map/index.ts';
import { parseMd2 } from '../../../src/formats/q12-model/md2.ts';

test('Q2 mounted downloads retain native empty EOF and close canceled source reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'q2-source-download-'));
    try {
        await mkdir(join(root, 'maps')); await mkdir(join(root, 'sound'));
        await Bun.write(join(root, 'maps/custom.bsp'), new Uint8Array(2051));
        await Bun.write(join(root, 'sound/empty.wav'), new Uint8Array(0));
        const mount: LooseMount = { kind: 'loose', identity: createMountIdentity('mount:download:loose', 'q2:classic:baseq2:installed', 0), rootPath: root };
        using mounts = await openMountPlan({ id: 'mount-plan:download:test', mounts: [mount], defaultOrder: [mount.identity.id], prefixOrders: [] });
        const cvars = new CvarRegistry({ dialect: 'q2-classic', context: { session: createIdentityOwner('Q2 source download').session, origin: { kind: 'server-console' } } });
        const downloads = createQ2ApplicationDownloads(mounts, cvars, 'classic'), peer = new Q2PeerDownload();
        cvars.set('allow_download', '1');
        expect(downloads.allowed('players/male/grunt.pcx')).toBe(false);
        for (const [name, value] of [['allow_download_maps', 'maps/custom.bsp'], ['allow_download_models', 'models/custom.md2'], ['allow_download_sounds', 'sound/empty.wav']] satisfies readonly (readonly [string, string])[]) {
            cvars.set(name, '0'); expect(downloads.allowed(value.toUpperCase())).toBe(false); cvars.set(name, '1');
        }
        for (const name of ['../secret.cfg', '/sound/empty.wav', 'sound\\empty.wav', '.private/file', 'config.cfg', 'sound/../empty.wav']) expect(downloads.allowed(name)).toBe(false);
        const first = await peer.begin(downloads, 'maps/custom.bsp', undefined);
        expect(first?.bytes?.length).toBe(1024); expect(first?.percent).toBe(49);
        expect(await peer.begin(downloads, 'maps/custom.bsp', '-1')).toEqual({ kind: 'download', bytes: null, percent: 0 });
        expect(peer.next()?.percent).toBe(99);
        peer.close(); expect(peer.next()).toBeNull();
        const empty = await peer.begin(downloads, 'sound/empty.wav', undefined);
        if (empty === null) throw new Error('Missing native empty download record');
        expect(encodeQ2ServerEvent(new Q2WireCodec({ kind: 'q2-classic', version: 34 }), empty)).toEqual(new Uint8Array([16, 0, 0, 0]));
        expect(peer.next()).toBeNull();
        const opened: DownloadSource[] = [];
        const pending = peer.begin({ allowed: name => downloads.allowed(name), open: async name => {
            const source = await downloads.open(name); if (source !== null) opened.push(source); return source;
        } }, 'maps/custom.bsp', undefined);
        peer.close();
        expect(await pending).toBeNull();
        const canceled = opened[0]; if (canceled === undefined) throw new Error('Canceled transfer never opened its mounted source');
        expect(() => canceled.read(0, 1)).toThrow('closed');
        const rereleaseCvars = new CvarRegistry({ dialect: 'q2-rerelease', context: { session: cvars.context.session, origin: { kind: 'server-console' } } });
        createQ2ApplicationDownloads(mounts, rereleaseCvars, 'rerelease');
        expect(rereleaseCvars.variableString('allow_download')).toBe('1');
        expect(rereleaseCvars.variableString('allow_download_players')).toBe('1');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('protocol-completion staging stays bounded and cannot overwrite installed files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'q2-client-sink-'));
    try {
        const sink = DownloadSink.create(root, 'sound/test.wav', { kind: 'protocol-completion', maximumBytes: 3 });
        sink.append(new Uint8Array([1, 2, 3]));
        expect(() => sink.append(new Uint8Array([4]))).toThrow('expected size');
        expect(sink.finish().startsWith('sha256:')).toBe(true);
        const duplicate = DownloadSink.create(root, 'sound/test.wav', { kind: 'protocol-completion', maximumBytes: 3 });
        duplicate.append(new Uint8Array([4]));
        expect(() => duplicate.finish()).toThrow();
        expect(new Uint8Array(await Bun.file(join(root, 'sound/test.wav')).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('native Q2 client receives missing map and dependencies before loading its remote world', async () => {
    const command = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated']);
    if (command.kind !== 'run') throw new Error('Missing Q2 launch');
    const installed = await loadApplicationContent(command.options), root = await mkdtemp(join(tmpdir(), 'q2-client-assets-'));
    const identity = createIdentityOwner('Q2 client download'), session = new EngineSession(identity, { kind: 'headless' });
    const serverTransport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), clientTransport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    let server: Q2ServerNetwork<typeof serverTransport.address> | null = null, client: Q2ClientNetwork<typeof serverTransport.address> | null = null;
    let content: LoadedApplicationContent | null = null;
    const files = new Map<string, Uint8Array>(), requests: string[] = [];
    try {
        const selected = installed.recipe.map.entities.content;
        const mounts = await openMountPlan({ ...installed.mounts.plan, mounts: installed.mounts.plan.mounts.map(mount =>
            mount.kind === 'loose' && mount.identity.content === selected ? { ...mount, rootPath: root } : mount) });
        content = new LoadedApplicationContent(installed.catalog, installed.recipe, installed.world, mounts);
        const mapName = 'maps/download-fixture.bsp', modelName = 'models/download-fixture/tris.md2', skinName = 'models/download-fixture/skin.pcx';
        const map = (await installed.mounts.read(installed.recipe.map.geometry)).slice(), view = new DataView(map.buffer, map.byteOffset, map.byteLength);
        const textureOffset = view.getInt32(8 + 5 * 8, true), originalMap = readQ2Bsp(map);
        const originalTexture = originalMap.textureInfo[0];
        if (originalTexture === undefined) throw new Error('Fixture map has no texture');
        map.fill(0, textureOffset + 40, textureOffset + 72);
        map.set(new TextEncoder().encode('download-fixture'), textureOffset + 40);
        files.set(mapName, map);
        files.set('textures/download-fixture.wal', await installed.mounts.read(`textures/${originalTexture.name}.wal`));
        const model = (await installed.mounts.read('models/weapons/v_blast/tris.md2')).slice(), modelView = new DataView(model.buffer, model.byteOffset, model.byteLength);
        const originalSkin = parseMd2(model).skins[0];
        if (originalSkin === undefined) throw new Error('Fixture model has no skin');
        const skinOffset = modelView.getInt32(44, true);
        model.fill(0, skinOffset, skinOffset + 64); model.set(new TextEncoder().encode(skinName), skinOffset);
        files.set(modelName, model); files.set(skinName, await installed.mounts.read(originalSkin));
        files.set('sound/download-fixture.wav', await installed.mounts.read('sound/weapons/blastf1a.wav'));
        const state: Q2ApplicationGameState = { data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'Download fixture', serverState: 2 },
            configStrings: new Map([[30, '1'], [31, String(blockChecksum(map))], [33, mapName], [34, modelName], [289, 'download-fixture.wav']]), baselines: new Map<number, EntityStateT>() };
        const player = { client: identity.client(1, 0), actor: identity.actor(1, 0), sourceEntity: 1 };
        const host: Q2ApplicationServerHost = { protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 1,
            supportsSourceWire: () => ({ kind: 'supported' }), observe() {}, admit: () => ({ kind: 'accepted', player }), disconnect() {}, carriedPlayer: () => player,
            gameState: () => state, frame: () => { throw new Error('Signon fixture does not publish frames'); }, events: () => [],
            input: () => { throw new Error('Signon fixture does not submit movement'); }, command() {}, userinfo() {}, print() {},
            downloads: { allowed: name => files.has(name), open: async name => {
                requests.push(name); const bytes = files.get(name);
                return bytes === undefined ? null : { byteLength: bytes.length, read: (offset, count) => bytes.slice(offset, offset + count), close() {} };
            } } };
        server = new Q2ServerNetwork({ transport: serverTransport, host, random: () => 12345 });
        let loaded = false;
        const remote = new Q2RemotePresentation({ identity, session, content, protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\download-client', print() {},
            sendCommand: text => { if (client === null) throw new Error('No client'); client.command(text); }, loadContent: async () => {
                if (content === null) throw new Error('No client content');
                for (const [path, bytes] of files) expect((await content.mounts.open(path))?.bytes).toEqual(bytes);
                const resource = await content.mounts.resolve(mapName);
                if (resource === null) throw new Error('Downloaded map did not resolve');
                content = new LoadedApplicationContent(installed.catalog, { ...installed.recipe, map: { ...installed.recipe.map, geometry: resource } }, toQ2WorldGeometry(readQ2Bsp(map)), content.mounts);
                loaded = true; return content;
            } });
        client = new Q2ClientNetwork({ transport: clientTransport, remote: serverTransport.address, host: remote, qport: 3011 });
        for (let step = 0; step < 6000 && client.phase !== 'active'; step++) {
            await client.poll(step * 10); await Bun.sleep(1); await server.poll(step * 10); await Bun.sleep(1);
        }
        expect(client.phase).toBe('active'); expect(loaded).toBe(true); expect(session.world).toBeNull();
        expect(requests).toEqual([mapName, modelName, skinName, 'sound/download-fixture.wav', 'textures/download-fixture.wal']);
        const nextState = (sound: string): Q2ApplicationGameState => ({ ...state,
            configStrings: new Map([[31, String(blockChecksum(map))], [33, mapName], [289, sound]]) });
        expect(await remote.downloads.prepare(nextState('cancel.wav'))).toBe('waiting');
        expect((await readdir(join(root, 'sound'))).filter(name => name.startsWith('.download-'))).toHaveLength(1);
        remote.downloads.close();
        expect((await readdir(join(root, 'sound'))).filter(name => name.startsWith('.download-'))).toHaveLength(0);
        expect(await Bun.file(join(root, 'sound/cancel.wav')).exists()).toBe(false);
        const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
        const resolve = mounts.resolve.bind(mounts);
        mounts.resolve = async path => { if (path === 'sound/late.wav') { entered.resolve(); await release.promise; } return resolve(path); };
        const late = remote.downloads.prepare(nextState('late.wav'));
        await entered.promise; remote.downloads.close(); release.resolve();
        expect(await late).toBe('canceled');
        expect((await readdir(join(root, 'sound'))).filter(name => name.startsWith('.download-'))).toHaveLength(0);
        expect(await Bun.file(join(root, 'sound/late.wav')).exists()).toBe(false);
        const unsafe = { ...state, configStrings: new Map([[31, String(blockChecksum(map))], [33, mapName], [34, '../escape.md2']]) };
        await expect(remote.downloads.prepare(unsafe)).rejects.toThrow('contained relative path');
        remote.downloads.close();
        const checksumEntered = Promise.withResolvers<void>(), checksumRelease = Promise.withResolvers<void>();
        const read = mounts.read.bind(mounts), playerBeforeCancel = remote.player, sceneBeforeCancel = remote.scene;
        mounts.read = async resource => {
            const bytes = await read(resource);
            if (typeof resource !== 'string' && resource.requestedPath === mapName) { checksumEntered.resolve(); await checksumRelease.promise; }
            return bytes;
        };
        const canceledLoad = remote.gameState(state);
        await checksumEntered.promise; remote.downloads.close(); checksumRelease.resolve();
        await canceledLoad;
        expect(remote.player).toBe(playerBeforeCancel); expect(remote.scene).toBe(sceneBeforeCancel);
        expect(await mounts.resolve(mapName)).not.toBeNull();
    } finally {
        client?.close(); server?.close(); clientTransport.close(); serverTransport.close(); session.close();
        await content?.close(); await installed.close(); await rm(root, { recursive: true, force: true });
    }
}, 30000);
