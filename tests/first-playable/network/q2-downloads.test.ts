import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { remoteContentSelection } from "../../../src/content/catalog/index.ts";
import type { RemoteContentMounts } from "../../../src/app/bootstrap/content.ts";
import { defaultUserContentRoot, userProductDirectory } from "../../../src/content/user-data.ts";
import { createClientDownloadPermission } from '../../../src/app/bootstrap/network/client-download-policy.ts';
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQ2ApplicationDownloads, Q2PeerDownload, Q2DownloadReceiver } from '../../../src/app/bootstrap/network/q2-downloads.ts';
import { createMountIdentity } from '../../../src/contracts/content.ts';
import type { LooseMount } from '../../../src/contracts/content.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { openMountPlan } from '../../../src/content/mounts/index.ts';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import { Q2WireCodec, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { EntityStateT } from '../../../src/network/q2/index.ts';
import type { DownloadSource } from '../../../src/network/services/downloads.ts';
import { DownloadSink } from '../../../src/network/services/downloads.ts';
import { LoadedApplicationContent, loadApplicationContent, openRemoteContent } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q2ClientNetwork, Q2ServerNetwork } from '../../../src/app/bootstrap/network/q2.ts';
import { Q2RemotePresentation } from '../../../src/app/bootstrap/network/remote.ts';
import type { Q2ApplicationGameState, Q2ApplicationServerHost } from '../../../src/app/bootstrap/network/types.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import { blockChecksum } from '../../../src/core/md4.ts';
import { readQ2Bsp, toQ2WorldGeometry } from '../../../src/formats/q2-map/index.ts';
import { encodePng } from '../../../src/formats/images/png.ts';
import { parseMd2 } from '../../../src/formats/q12-model/md2.ts';

function downloadOwner(content: LoadedApplicationContent): RemoteContentMounts {
    const product = content.catalog.product(content.recipe.map.entities.content);
    const userRoot = content.catalog.userContentRoot ?? defaultUserContentRoot();
    const base = content.catalog.require('q2-classic-baseq2');
    return { selection: remoteContentSelection('q2-classic-baseq2', product.expectation.contentDirectory.split('/').at(-1) ?? 'baseq2'),
        catalog: content.catalog, product, mounts: content.mounts, q3Product: content.q3Product,
        writeRoot: product.userContent?.root ?? userProductDirectory(userRoot, product.expectation.contentDirectory),
        baseWriteRoot: base.userContent?.root ?? userProductDirectory(userRoot, base.expectation.contentDirectory) };
}

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

for (const mode of ['native', 'http', 'http-off']) { const httpEnabled = mode === 'http'; test(`native Q2 client receives missing map and dependencies before loading its remote world (${mode})`, async () => {
    const command = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated']);
    if (command.kind !== 'run') throw new Error('Missing Q2 launch');
    const temporary = await mkdtemp(join(tmpdir(), 'q2-client-assets-')), root = join(temporary, 'q2/baseq2');
    await mkdir(root, { recursive: true });
    const installed = await loadApplicationContent({ ...command.options, userContentRoot: temporary });
    const identity = createIdentityOwner('Q2 client download'), session = new EngineSession(identity, { kind: 'headless' });
    const serverTransport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 }), clientTransport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    let server: Q2ServerNetwork<typeof serverTransport.address> | null = null, client: Q2ClientNetwork<typeof serverTransport.address> | null = null;
    let content: LoadedApplicationContent | null = null;
    const files = new Map<string, Uint8Array>(), requests: string[] = [];
    let stopHttp = async (): Promise<void> => {};
    const refreshed: LoadedApplicationContent[] = [];
    let activeHttp = 0, peakHttp = 0; const httpPaths: string[] = [];
    try {
        const selected = installed.recipe.map.entities.content;
        const inheritedRoot = join(temporary, 'inherited-base');
        await mkdir(inheritedRoot);
        const inherited: LooseMount = { kind: 'loose', identity: createMountIdentity('mount:scope:inherited', selected, 0), rootPath: inheritedRoot };
        const mounts = await openMountPlan({ ...installed.mounts.plan,
            defaultOrder: [...installed.mounts.plan.defaultOrder, inherited.identity.id],
            mounts: [...installed.mounts.plan.mounts.map(mount =>
                mount.kind === 'loose' && mount.identity.content === selected ? { ...mount, rootPath: root } : mount), inherited] });
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
        const imagePaths = [originalSkin.replace(/\.pcx$/i, '.png'), originalSkin.replace(/\.pcx$/i, '.bmp')];
        const invalidList = ['pics/blocked.cfg', 'pics/blocked.exe', '../escape.png', '/absolute.png', '@pak98.pak', '@pak98.pkz', 'pics/../escape.png'];
        if (httpEnabled) {
            expect(await installed.mounts.resolve(originalSkin)).not.toBeNull();
            const bitmap = new Uint8Array(58), header = new DataView(bitmap.buffer);
            bitmap.set([66, 77]); header.setUint32(2, 58, true); header.setUint32(10, 54, true); header.setUint32(14, 40, true);
            header.setInt32(18, 1, true); header.setInt32(22, 1, true); header.setUint16(26, 1, true); header.setUint16(28, 24, true);
            for (const imagePath of imagePaths) {
                files.set(imagePath, imagePath.endsWith('.png') ? encodePng(1, 1, new Uint8Array([255, 0, 0, 255])) : bitmap);
                await Bun.write(join(inheritedRoot, imagePath), new Uint8Array([1, 2, 3]));
                expect((await mounts.open(imagePath))?.bytes).toEqual(new Uint8Array([1, 2, 3]));
            }
            await Bun.write(join(inheritedRoot, 'pics/inherited-only.png'), bitmap);
        }
        files.set('sound/download-fixture.wav', await installed.mounts.read('sound/weapons/blastf1a.wav'));
        const state: Q2ApplicationGameState = { data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'Download fixture', serverState: 2 },
            configStrings: new Map([[30, '1'], [31, String(blockChecksum(map))], [33, mapName], [34, modelName], [289, 'download-fixture.wav']]), baselines: new Map<number, EntityStateT>() };
        const player = { client: identity.client(1, 0), actor: identity.actor(1, 0), sourceEntity: 1 };
        const packedPath = 'sound/download-fixture.wav', packedSound = files.get(packedPath);
        if (packedSound === undefined) throw new Error('Missing packaged sound');
        const packageBytes = new Uint8Array(12 + packedSound.length + 64), packageView = new DataView(packageBytes.buffer);
        packageBytes.set(new TextEncoder().encode('PACK')); packageView.setInt32(4, 12 + packedSound.length, true); packageView.setInt32(8, 64, true);
        packageBytes.set(packedSound, 12); packageBytes.set(new TextEncoder().encode(packedPath), 12 + packedSound.length);
        packageView.setInt32(12 + packedSound.length + 56, 12, true); packageView.setInt32(12 + packedSound.length + 60, packedSound.length, true);
        const httpServer = mode !== 'native' ? Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: async request => {
            const path = decodeURIComponent(new URL(request.url).pathname); httpPaths.push(path);
            if (path.endsWith('.filelist')) return new Response(['pak99.pak', ...files.keys(), ...imagePaths.map(path => `@${path}`), ...imagePaths, '@sound/download-fixture.wav', 'pics/inherited-only.png', ...invalidList].join('\n'));
            const asset = path.slice('/baseq2/'.length), bytes = asset === 'pak99.pak' ? packageBytes : files.get(asset);
            if (bytes === undefined || asset.endsWith('.wal')) return new Response(null, { status: 404 });
            activeHttp++; peakHttp = Math.max(peakHttp, activeHttp);
            try { await Bun.sleep(20); return new Response(bytes); } finally { activeHttp--; }
        } }) : null;
        if (httpServer !== null) stopHttp = async () => { await httpServer.stop(true); };
        const host: Q2ApplicationServerHost = { protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 1,
            supportsSourceWire: () => ({ kind: 'supported' }), observe() {}, admit: () => ({ kind: 'accepted', player }), disconnect() {}, carriedPlayer: () => player,
            gameState: () => state, frame: () => { throw new Error('Signon fixture does not publish frames'); }, events: () => [],
            input: () => { throw new Error('Signon fixture does not submit movement'); }, command() {}, userinfo() {}, print() {},
            downloads: { httpServer: () => httpServer === null ? null : new URL(`http://127.0.0.1:${httpServer.port}/`), allowed: name => files.has(name), open: async name => {
                requests.push(name); const bytes = files.get(name);
                return bytes === undefined ? null : { byteLength: bytes.length, read: (offset, count) => bytes.slice(offset, offset + count), close() {} };
            } } };
        server = new Q2ServerNetwork({ transport: serverTransport, host, random: () => 12345 });
        let loaded = false;
        const clientCvars = new CvarRegistry({ dialect: 'q2-classic', context: { session: identity.session, origin: { kind: 'local-console' } } });
        const downloadPermission = createClientDownloadPermission(clientCvars, 'q2');
        if (mode === 'http-off') clientCvars.set('cl_http_downloads', '0');
        const remote = new Q2RemotePresentation({ identity, session, seat: identity.seat(0), publish: output => session.publish(output), disconnected: () => { session.clientAt(0)?.disconnect(); }, client: session.createClient(0), nextGeneration: slot => nextActorGeneration(session.session, slot), content, prepareServerData: async () => { if (content === null) throw new Error('Missing fixture content'); return downloadOwner(content); }, downloadPermission, protocol: { kind: 'q2-classic', version: 34 }, userinfo: () => '\\name\\download-client', print() {},
            sendCommand: text => { if (client === null) throw new Error('No client'); client.command(text); },
            refreshDownloads: async assertCurrent => { const fresh = await loadApplicationContent({ ...command.options, userContentRoot: temporary }); refreshed.push(fresh); assertCurrent();
                const remounted = await openMountPlan({ ...fresh.mounts.plan, mounts: [...fresh.mounts.plan.mounts, inherited], defaultOrder: [...fresh.mounts.plan.defaultOrder, inherited.identity.id] });
                const scoped = new LoadedApplicationContent(fresh.catalog, fresh.recipe, fresh.world, remounted);
                refreshed.push(scoped); content = scoped; return downloadOwner(scoped); }, loadContent: async () => {
                if (content === null) throw new Error('No client content');
                for (const [path, bytes] of files) expect((await content.mounts.open(path))?.bytes).toEqual(bytes);
                const resource = await content.mounts.resolve(mapName);
                if (resource === null) throw new Error('Downloaded map did not resolve');
                content = new LoadedApplicationContent(content.catalog, { ...installed.recipe, map: { ...installed.recipe.map, geometry: resource } }, toQ2WorldGeometry(readQ2Bsp(map)), content.mounts);
                loaded = true; return content;
            } });
        remote.client.connect("remote");
        client = new Q2ClientNetwork({ transport: clientTransport, remote: serverTransport.address, host: remote, qport: 3011 });
        for (let step = 0; step < 6000 && client.phase !== 'active'; step++) {
            await client.poll(step * 10); await Bun.sleep(1); await server.poll(step * 10); await Bun.sleep(1);
        }
        expect(client.phase).toBe('active'); expect(loaded).toBe(true); expect(session.world).toBeNull();
        const beforeMismatch = httpPaths.length;
        await expect(remote.downloads.prepare({ ...state, data: { ...state.data, gamedir: 'wrongmod' } })).rejects.toThrow('differs from prepared content');
        expect(httpPaths).toHaveLength(beforeMismatch);
        if (mode === 'http-off') expect(httpPaths).toEqual([]);
        expect(requests).toEqual(httpEnabled ? ['textures/download-fixture.wal'] : [mapName, modelName, skinName, 'sound/download-fixture.wav', 'textures/download-fixture.wal']);
        if (httpEnabled) { for (const path of imagePaths) { expect(httpPaths).toContain(`/baseq2/${path}`); const expected = files.get(path); if (expected === undefined) throw new Error(path); expect(new Uint8Array(await Bun.file(join(root, path)).arrayBuffer())).toEqual(new Uint8Array(expected)); } expect(httpPaths).not.toContain('/baseq2/pics/inherited-only.png'); for (const path of invalidList) expect(httpPaths).not.toContain(`/baseq2/${path}`); expect(httpPaths).not.toContain('/baseq2/pak98.pak'); expect(httpPaths).not.toContain('/baseq2/pak98.pkz'); expect(peakHttp).toBe(2); expect(refreshed).toHaveLength(2); expect(httpPaths).not.toContain('/baseq2/sound/download-fixture.wav'); expect(httpPaths).toContain('/baseq2/pak99.pak'); expect(httpPaths).toContain('/baseq2.filelist'); expect(httpPaths).toContain(`/baseq2/${mapName.slice(0, -4)}.filelist`); }
        if (!httpEnabled) {
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
        }
    } finally {
        await stopHttp(); client?.close(); server?.close(); clientTransport.close(); serverTransport.close(); session.close();
        await content?.close(); for (const fresh of refreshed) await fresh.close(); await installed.close(); await rm(temporary, { recursive: true, force: true });
    }
}, 30000); }

 test('Q2 local permission skips requests and writes but validates installed maps', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'q2-client-policy-'));
    const command = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated']);
    if (command.kind !== 'run') throw new Error('launch');
    const content = await loadApplicationContent({ ...command.options, userContentRoot: temporary });
    const requests: string[] = [], httpPaths: string[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => { httpPaths.push(request.url); return new URL(request.url).pathname.endsWith('.filelist') ? new Response('sound/forbidden.wav\npak98.pak\n') : new Response(new Uint8Array([1,2,3])); } });
    const cvars = new CvarRegistry({ dialect: 'q2-classic', context: { session: createIdentityOwner('permission').session, origin: { kind: 'local-console' } } });
    const permission = createClientDownloadPermission(cvars, 'q2');
    const receiver = new Q2DownloadReceiver(() => downloadOwner(content), text => requests.push(text), () => undefined, async () => { throw new Error('Forbidden package remount'); }, permission);
    try {
        const map = await content.mounts.read(content.recipe.map.geometry), mapName = content.recipe.map.geometry.requestedPath;
        const state: Q2ApplicationGameState = { data: { servercount: 1, attractloop: false, gamedir: 'baseq2', clientnum: 0, levelname: 'Policy', serverState: 2 },
            configStrings: new Map([[31, String(blockChecksum(map))], [33, mapName], [289, 'forbidden.wav']]), baselines: new Map<number, EntityStateT>() };
        for (const value of ['0', '-1']) {
            cvars.set('allow_download', value); receiver.setHttpServer(new URL('http://127.0.0.1:'+server.port+'/'));
            while (await receiver.prepare(state) === 'waiting') await Bun.sleep(1);
            expect(requests).toEqual([]); expect(httpPaths).toEqual([]);
            expect(await Bun.file(join(temporary, 'q2/baseq2/sound/forbidden.wav')).exists()).toBe(false);
        }
        cvars.set('allow_download', '1'); cvars.set('allow_download_sounds', '0'); receiver.setHttpServer(new URL('http://127.0.0.1:'+server.port+'/'));
        while (await receiver.prepare(state) === 'waiting') await Bun.sleep(1);
        expect(requests).toEqual([]); expect(httpPaths.length).toBeGreaterThan(0); expect(httpPaths.every(path => path.endsWith('.filelist'))).toBe(true);
        expect(await Bun.file(join(temporary, 'q2/baseq2/sound/forbidden.wav')).exists()).toBe(false);
        expect(await Bun.file(join(temporary, 'q2/baseq2/pak98.pak')).exists()).toBe(false);
        expect(permission({transport:'http',category:'package'})).toBe(false);
        expect(permission({transport:'native',category:'map'})).toBe(true);
        cvars.set('allow_download_maps','0'); expect(permission({transport:'http',category:'map'})).toBe(false);
        receiver.setHttpServer(null); await expect(receiver.prepare({...state, configStrings:new Map([[31,'0'],[33,mapName]])})).rejects.toThrow('checksum');
    } finally { receiver.close(); await server.stop(true); await content.close(); await rm(temporary,{recursive:true,force:true}); }
 });


for (const transport of ['native', 'http']) test(`Q2 prepared mod content keeps ${transport} players in baseq2 and ordinary assets in the selected directory`, async () => {
    const command = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2', '--dedicated']);
    if (command.kind !== 'run') throw new Error('Missing Q2 launch');
    const temporary = await mkdtemp(join(tmpdir(), 'q2-mod-downloads-'));
    await mkdir(join(temporary, 'q2/+Arena'), { recursive: true });
    const installed = await loadApplicationContent({ ...command.options, userContentRoot: temporary });
    const roots = { corpusRoot: installed.catalog.corpusRoot, userContentRoot: temporary };
    const selection = remoteContentSelection('q2-classic-baseq2', '+Arena');
    let owner = await openRemoteContent(roots, selection, () => undefined);
    const requests: string[] = [], urls: string[] = [];
    let refreshed = 0;
    const mapName = 'maps/mod-download.bsp', playerName = 'Players/remote/tris.md2';
    const map = await installed.mounts.read(installed.recipe.map.geometry);
    const sound = await installed.mounts.read('sound/weapons/blastf1a.wav');
    const files = new Map<string, Uint8Array>([
        [mapName, map], [playerName, await installed.mounts.read('players/male/tris.md2')],
        ['players/male/tris.md2', await installed.mounts.read('players/male/tris.md2')], ['sound/mod-download.wav', sound],
    ]);
    const packedName = 'sound/mod-download.wav', packageBytes = new Uint8Array(12 + sound.length + 64), view = new DataView(packageBytes.buffer);
    packageBytes.set(new TextEncoder().encode('PACK')); view.setInt32(4, 12 + sound.length, true); view.setInt32(8, 64, true);
    packageBytes.set(sound, 12); packageBytes.set(new TextEncoder().encode(packedName), 12 + sound.length);
    view.setInt32(12 + sound.length + 56, 12, true); view.setInt32(12 + sound.length + 60, sound.length, true);
    const server = transport === 'http' ? Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
        const path = new URL(request.url).pathname; urls.push(path);
        if (path.endsWith('.filelist')) return new Response(`pak99.pak\n${mapName}\n${playerName}\n@players/male/tris.md2\n${packedName}\n`);
        const name = decodeURIComponent(path).slice('/+Arena/'.length);
        const bytes = name === 'pak99.pak' ? packageBytes : files.get(name);
        return bytes === undefined ? new Response(null, { status: 404 }) : new Response(bytes);
    } }) : null;
    const receiver = new Q2DownloadReceiver(() => owner, text => { requests.push(text); }, () => undefined, async () => {
        const old = owner; owner = await openRemoteContent(roots, selection, () => undefined); old.mounts.close(); refreshed++;
    });
    try {
        expect(owner.writeRoot).toBe(join(temporary, 'q2/+Arena'));
        expect(owner.baseWriteRoot).toBe(join(temporary, 'q2/baseq2'));
        if (server !== null) receiver.setHttpServer(new URL(`http://127.0.0.1:${server.port}/`));
        const state: Q2ApplicationGameState = { data: { servercount: 1, attractloop: false, gamedir: '+Arena', clientnum: 0, levelname: 'Mod assets', serverState: 2 },
            configStrings: new Map([[31, String(blockChecksum(map))], [33, mapName], [34, playerName], [289, 'mod-download.wav']]), baselines: new Map<number, EntityStateT>() };
        let handled = 0, ready = false, offset = 0;
        let active: Uint8Array | null = null;
        for (let tick = 0; tick < 2000 && !ready; tick++) {
            ready = await receiver.prepare(state) === 'ready';
            while (handled < requests.length) {
                const request = requests[handled++];
                if (request === undefined) throw new Error('Missing native download command');
                if (request.startsWith('download ')) { active = files.get(request.slice(9)) ?? null; offset = 0; }
                else if (request !== 'nextdl') throw new Error('Unexpected native download command');
                const bytes = active?.subarray(offset, offset + 1024) ?? null;
                offset += bytes?.length ?? 0;
                receiver.receive({ kind: 'download', bytes, percent: active === null ? 0 : Math.floor(offset * 100 / active.length) });
            }
            if (!ready) await Bun.sleep(1);
        }
        expect(ready).toBe(true);
        expect(await Bun.file(join(owner.writeRoot, mapName)).bytes()).toEqual(new Uint8Array(map));
        expect(await Bun.file(join(owner.baseWriteRoot, playerName)).bytes()).toEqual(new Uint8Array(await installed.mounts.read('players/male/tris.md2')));
        expect(await Bun.file(join(owner.writeRoot, playerName)).exists()).toBe(false);
        expect((await owner.mounts.open(packedName))?.bytes).toEqual(sound);
        if (transport === 'http') {
            expect(requests).toEqual([]); expect(refreshed).toBe(1);
            expect(urls).toContain('/%2BArena/pak99.pak'); expect(urls).toContain('/%2BArena/Players/remote/tris.md2');
            expect(urls).toContain('/%2BArena/players/male/tris.md2'); expect(urls).not.toContain('/%2BArena/sound/mod-download.wav');
            expect(await Bun.file(join(owner.baseWriteRoot, 'players/male/tris.md2')).bytes()).toEqual(new Uint8Array(await installed.mounts.read('players/male/tris.md2')));
            expect(await Bun.file(join(owner.writeRoot, 'pak99.pak')).exists()).toBe(true);
        } else {
            expect(requests).toContain(`download ${playerName}`); expect(refreshed).toBe(0);
            expect(await Bun.file(join(owner.writeRoot, packedName)).bytes()).toEqual(new Uint8Array(sound));
        }
    } finally { receiver.close(); await server?.stop(true); owner.mounts.close(); await installed.close(); await rm(temporary, { recursive: true, force: true }); }
}, 30000);

test('RemoteApplication selects stock and unknown Q2 directories before precache and replaces same-map content', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'q2-remote-context-'));
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const parsed = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2',
        '--connect-q2', `127.0.0.1:${transport.address.port}`, '--user-content-root', temporary,
        '--hidden', '--renderer', 'cpu', '--width', '320', '--height', '240']);
    if (parsed.kind !== 'run') throw new Error('No remote launch');
    const installed = await loadApplicationContent(parsed.options);
    const mapName = installed.recipe.map.geometry.requestedPath, map = await installed.mounts.read(installed.recipe.map.geometry);
    const identity = createIdentityOwner('Q2 remote directory peer');
    const player = { client: identity.client(1, 0), actor: identity.actor(1, 0), sourceEntity: 1 };
    let directory = 'ctf';
    const requests: string[] = [];
    const sound = await installed.mounts.read('sound/weapons/blastf1a.wav');
    const host: Q2ApplicationServerHost = { protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 1,
        supportsSourceWire: () => ({ kind: 'supported' }), observe() {}, admit: () => ({ kind: 'accepted', player }), disconnect() {}, carriedPlayer: () => player,
        gameState: () => ({ data: { servercount: 1, attractloop: false, gamedir: directory, clientnum: 0, levelname: 'Directory fixture', serverState: 2 },
            configStrings: new Map([[30, '1'], [31, String(blockChecksum(map))], [33, mapName], [289, 'context-fixture.wav']]), baselines: new Map<number, EntityStateT>() }),
        frame: () => { throw new Error('Content signon peer does not publish frames'); }, events: () => [], input() { throw new Error('Content signon peer does not execute movement'); }, command() {}, userinfo() {}, print() {},
        downloads: { allowed: name => name === 'sound/context-fixture.wav', open: async name => {
            requests.push(`${directory}/${name}`);
            return name === 'sound/context-fixture.wav' ? { byteLength: sound.length, read: (offset, count) => sound.slice(offset, offset + count), close() {} } : null;
        } } };
    const server = new Q2ServerNetwork({ transport, host, random: () => 12345 });
    let app: RemoteApplication | null = null;
    try {
        app = await RemoteApplication.open(parsed.options, { print() {} });
        let now = 0;
        for (const next of ['ctf', '+Arena', 'baseq2']) {
            directory = next;
            const previous = app.content;
            if (next !== 'ctf') { await server.poll(now); server.changeWorld(host); }
            for (let tick = 0; tick < 1000; tick++) {
                now += 50; await server.poll(now); await Bun.sleep(1); await app.step(50); await Bun.sleep(1);
                if (app.networkPhase === 'active' && app.content !== previous && app.options.remoteContent?.directory === next.toLowerCase()) break;
            }
            expect(app.networkPhase).toBe('active');
            expect(app.options.remoteContent).toEqual(remoteContentSelection('q2-classic-baseq2', next));
            expect(app.content).not.toBe(previous);
            expect(app.content.recipe.map.geometry.requestedPath).toBe(mapName);
            expect(await Bun.file(join(temporary, 'q2', next.toLowerCase(), 'sound/context-fixture.wav')).bytes()).toEqual(new Uint8Array(sound));
            if (next === 'ctf') expect(app.content.catalog.product(app.content.recipe.map.entities.content).expectation.id).toBe('q2-classic-ctf');
        }
        expect(requests).toEqual(['ctf/sound/context-fixture.wav', '+Arena/sound/context-fixture.wav', 'baseq2/sound/context-fixture.wav']);
    } finally { await app?.close(); server.close(); await installed.close(); await rm(temporary, { recursive: true, force: true }); }
}, 40000);
