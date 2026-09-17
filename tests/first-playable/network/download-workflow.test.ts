import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteApplication } from '../../../src/app/bootstrap/remote-application.ts';
import { loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { Q2ServerNetwork } from '../../../src/app/bootstrap/network/q2.ts';
import type { Q2ApplicationServerHost } from '../../../src/app/bootstrap/network/types.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { blockChecksum } from '../../../src/core/md4.ts';
import { UdpTransport } from '../../../src/network/common/transport.ts';
import type { EntityStateT } from '../../../src/network/q2/index.ts';

const nativeTest = Bun.env['QUAKE_DOWNLOAD_WORKFLOW_TEST'] === '1' ? test : test.skip;

nativeTest('public download controls survive native cancellation and HTTP package remount with fallback on travel', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'q2-public-download-'));
    for (const directory of ["ctf", "+arena"]) {
        const profile = join(temporary, "q2", directory);
        await mkdir(profile, { recursive: true });
        await writeFile(join(profile, "autoexec.cfg"), "set allow_download 1\nset allow_download_maps 1\nset allow_download_models 1\nset allow_download_sounds 1\nset allow_download_players 1\nset cl_http_downloads 1\n");
    }
    const transport = await UdpTransport.bind({ host: '127.0.0.1', port: 0 });
    const parsed = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2',
        '--connect-q2', `127.0.0.1:${transport.address.port}`, '--user-content-root', temporary,
        '--hidden', '--renderer', 'cpu', '--width', '320', '--height', '240']);
    if (parsed.kind !== 'run') throw new Error('No remote launch');
    const installed = await loadApplicationContent(parsed.options);
    const mapName = installed.recipe.map.geometry.requestedPath;
    const map = await installed.mounts.read(installed.recipe.map.geometry);
    const sound = await installed.mounts.read('sound/weapons/blastf1a.wav');
    expect(sound.length).toBeGreaterThan(2048);
    const soundPath = 'sound/public-download.wav', fallbackPath = 'sound/public-fallback.wav';
    const packed = new Uint8Array(12 + sound.length + 64), view = new DataView(packed.buffer);
    packed.set(new TextEncoder().encode('PACK'));
    view.setInt32(4, 12 + sound.length, true); view.setInt32(8, 64, true);
    packed.set(sound, 12); packed.set(new TextEncoder().encode(soundPath), 12 + sound.length);
    view.setInt32(12 + sound.length + 56, 12, true); view.setInt32(12 + sound.length + 60, sound.length, true);
    const httpPaths: string[] = [], requests: string[] = [], messages: string[] = [];
    let directory = "ctf", useHttp = false;
    const http = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
        const path = decodeURIComponent(new URL(request.url).pathname).toLowerCase(); httpPaths.push(path);
        if (!useHttp) return new Response(null, { status: 404 });
        if (path.endsWith('.filelist')) return new Response('pak99.pak\n');
        if (path === '/+arena/pak99.pak') return new Response(packed);
        return new Response(null, { status: 404 });
    } });
    const identity = createIdentityOwner('Q2 public download peer');
    const player = { client: identity.client(1, 0), actor: identity.actor(1, 0), sourceEntity: 1 };
    const host: Q2ApplicationServerHost = {
        protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 }, maxClients: 1,
        supportsSourceWire: () => ({ kind: 'supported' }), observe() {}, admit: () => ({ kind: 'accepted', player }), disconnect() {}, carriedPlayer: () => player,
        gameState: () => ({ data: { servercount: 1, attractloop: false, gamedir: directory, clientnum: 0, levelname: 'Public downloads', serverState: 2 },
            configStrings: new Map([[30, '1'], [31, String(blockChecksum(map))], [33, mapName], [289, 'public-download.wav'],
                ...(useHttp ? [[290, 'public-fallback.wav']] satisfies [number, string][] : [])]), baselines: new Map<number, EntityStateT>() }),
        frame: () => { throw new Error('Signon peer does not publish frames'); }, events: () => [],
        input() { throw new Error('Signon peer does not execute movement'); }, command() {}, userinfo() {}, print() {},
        downloads: { httpServer: () => new URL(`http://127.0.0.1:${http.port}/`),
            allowed: name => name === soundPath || name === fallbackPath,
            open: async name => {
                requests.push(`${directory}/${name}`);
                return name === soundPath || name === fallbackPath
                    ? { byteLength: sound.length, read: (offset, count) => sound.slice(offset, offset + count), close() {} } : null;
            } },
    };
    const server = new Q2ServerNetwork({ transport, host, random: () => 12345 });
    let app: RemoteApplication | null = null;
    let stage = "opening";
    try {
        app = await RemoteApplication.open(parsed.options, { print: text => { messages.push(text); } });
        const client = app;
        let now = 0;
        const tick = async (): Promise<void> => {
            now += 50; await server.poll(now); await Bun.sleep(1); await client.step(50); await Bun.sleep(1);
        };
        stage = "awaiting-native-partial";
        let partial = false;
        for (let count = 0; count < 1000; count++) {
            await tick();
            partial = client.downloadProgress.some(item => item.transport === 'native' && item.path === soundPath && item.received > 0);
            if (partial) break;
        }
        expect(partial).toBe(true); expect(client.networkPhase).not.toBe('active');
        stage = "canceling";
        client.cancelDownloads(); client.cancelDownloads();
        for (let count = 0; count < 4; count++) await tick();
        expect(client.networkPhase).not.toBe('active');
        expect(await Bun.file(join(temporary, 'q2/ctf', soundPath)).exists()).toBe(false);
        stage = "retrying";
        await client.retryDownloads();
        for (let count = 0; count < 1000 && client.networkPhase !== 'active'; count++) await tick();
        expect(client.networkPhase).toBe('active');
        expect(await Bun.file(join(temporary, 'q2/ctf', soundPath)).bytes()).toEqual(new Uint8Array(sound));
        expect(requests.filter(path => path === `ctf/${soundPath}`)).toHaveLength(2);
        const previous = client.content;
        stage = "travel-http-remount";
        directory = '+Arena'; useHttp = true; server.changeWorld(host);
        for (let count = 0; count < 1500; count++) {
            await tick();
            if (client.networkPhase === 'active' && client.content !== previous && client.options.remoteContent?.directory === '+arena') break;
        }
        expect(client.networkPhase).toBe('active'); expect(client.content).not.toBe(previous);
        expect(client.options.remoteContent?.directory).toBe('+arena');
        expect(client.content.recipe.map.geometry.requestedPath).toBe(mapName);
        expect((await client.content.mounts.open(soundPath))?.bytes).toEqual(sound);
        expect(await Bun.file(join(temporary, 'q2/+arena/pak99.pak')).bytes()).toEqual(packed);
        expect(await Bun.file(join(temporary, 'q2/+arena', soundPath)).exists()).toBe(false);
        expect(await Bun.file(join(temporary, 'q2/+arena', fallbackPath)).bytes()).toEqual(new Uint8Array(sound));
        expect(httpPaths).toContain('/+arena/pak99.pak'); expect(httpPaths).toContain(`/+arena/${fallbackPath}`);
        expect(requests).toContain(`+Arena/${fallbackPath}`); expect(requests).not.toContain(`+Arena/${soundPath}`);
    } catch (error) {
        console.error(JSON.stringify({ stage, directory, requests, httpPaths, messages, phase: app?.networkPhase, progress: app?.downloadProgress,
            selected: app?.options.remoteContent, looseSound: await Bun.file(join(temporary, 'q2', directory.toLowerCase(), soundPath)).exists(),
            packageExists: await Bun.file(join(temporary, 'q2', directory.toLowerCase(), 'pak99.pak')).exists() }));
        throw error;
    } finally {
        await app?.close(); server.close(); await http.stop(true); await installed.close();
        await rm(temporary, { recursive: true, force: true });
    }
}, 90000);
