import { remoteContentSelection } from "../../../content/catalog/index.ts";
import { clientDownloadCategory } from './client-download-policy.ts';
import type { ClientDownloadPermission } from './client-download-policy.ts';
import { readQ2DownloadServer } from "../../../network/q2/handshake.ts";
import { basename, dirname, resolve } from 'node:path';
import { mkdir } from "node:fs/promises";
import { HttpDownloadQueue, fetchHttpDownloadMetadata } from '../../../network/services/http-downloads.ts';
import { openArchive } from '../../../content/archive/index.ts';
/* Quake II server/sv_user.c SV_BeginDownload_f/SV_NextDownload_f. GPL-2.0-or-later. */
import { canDownloadResource } from '../../../content/mounts/index.ts';
import type { MountedContent } from '../../../content/mounts/index.ts';
import { Q2CvarFlag } from '../../../core/cvars/index.ts';
import type { CvarRegistry } from '../../../core/cvars/index.ts';
import { nativeAtoi } from '../../../core/numeric.ts';
import { Q2DownloadSender } from '../../../network/q2/server-write.ts';
import { downloadPath, DownloadSink } from '../../../network/services/downloads.ts';
import type { DownloadSource } from '../../../network/services/downloads.ts';
import type { Q2ServerEvent } from '../../../network/q2/server-messages.ts';
import { parseMd2 } from '../../../formats/q12-model/md2.ts';
import { parseSp2 } from '../../../formats/q12-model/sprite.ts';
import { readQ2Bsp } from '../../../formats/q2-map/index.ts';
import { blockChecksum } from '../../../core/md4.ts';
import { SKY_FACE_SUFFIXES } from '../../../materials/sky.ts';
import type { RemoteContentMounts } from '../content.ts';
import type { Q2ApplicationGameState } from './types.ts';
import { q2ApplicationLayout } from './q2-layout.ts';

export interface Q2ApplicationDownloads {
    httpServer?(): URL | null;
    allowed(name: string): boolean;
    open(name: string): Promise<DownloadSource | null>;
}

/** FS_LoadFile retains selected mounted bytes for the lifetime of one native transfer. */
export function createQ2ApplicationDownloads(mounts: MountedContent, cvars: CvarRegistry, edition: 'classic' | 'rerelease'): Q2ApplicationDownloads {
    cvars.register('sv_downloadserver', '', 0);
    cvars.register('allow_download', edition === 'classic' ? '0' : '1', Q2CvarFlag.Archive);
    cvars.register('allow_download_players', edition === 'classic' ? '0' : '1', Q2CvarFlag.Archive);
    for (const name of ['models', 'sounds', 'maps']) cvars.register(`allow_download_${name}`, '1', Q2CvarFlag.Archive);
    return {
        httpServer: () => readQ2DownloadServer([`dlserver=${cvars.variableString('sv_downloadserver')}`]),
        allowed: name => {
            if (name.includes('..') || name.startsWith('.') || !name.includes('/') || cvars.variableValue('allow_download') === 0) return false;
            try { downloadPath(name); } catch { return false; }
            // Match complete categories so the original six-byte maps/ comparison cannot bypass policy.
            const path = name.toLowerCase();
            for (const category of [{ prefix: 'players/', setting: 'players' }, { prefix: 'models/', setting: 'models' },
                { prefix: 'sound/', setting: 'sounds' }, { prefix: 'maps/', setting: 'maps' }]) {
                if (path.startsWith(category.prefix) && cvars.variableValue(`allow_download_${category.setting}`) === 0) return false;
            }
            return true;
        },
        open: async name => {
            const opened = await mounts.open(name);
            if (opened === null || opened.bytes.length > 0x7fffffff) return null;
            const provenance = opened.reference.provenance;
            if (!canDownloadResource(opened.reference) || provenance.kind === 'archive' && provenance.memberPath.toLowerCase().startsWith('maps/')) return null;
            let bytes: Uint8Array | null = opened.bytes;
            return { byteLength: bytes.length, read: (offset, maxBytes) => {
                if (bytes === null) throw new Error('Q2 mounted download is closed');
                return bytes.slice(offset, offset + maxBytes);
            }, close: () => { bytes = null; } };
        },
    };
}

type DownloadEvent = NonNullable<ReturnType<Q2DownloadSender['next']>>;
const refused: DownloadEvent = { kind: 'download', bytes: null, percent: 0 };

/** One peer owns its source file; reconnect and world replacement cancel pending opens too. */
export class Q2PeerDownload {
    private sender: Q2DownloadSender | null = null;
    private generation = 0;
    get revision(): number { return this.generation; }

    async begin(downloads: Q2ApplicationDownloads, name: string, offsetText: string | undefined): Promise<DownloadEvent | null> {
        let offset: number;
        try { offset = nativeAtoi(offsetText ?? '0'); } catch { return refused; }
        if (offset < 0 || !downloads.allowed(name)) return refused;
        this.close();
        const generation = this.generation;
        let source: DownloadSource | null;
        try { source = await downloads.open(name); } catch { source = null; }
        if (generation !== this.generation) { source?.close(); return null; }
        if (source === null) return refused;
        this.sender = new Q2DownloadSender(source, Math.min(offset, source.byteLength));
        return this.next();
    }

    next(): DownloadEvent | null { return this.sender?.next() ?? null; }
    close(): void { this.generation++; this.sender?.close(); this.sender = null; }
}

type HttpAssetScope = 'search-path' | 'game-local';

type Q2DownloadBlock = Extract<Q2ServerEvent, { readonly kind: 'download' }>;
export type Q2DownloadPreparation = 'ready' | 'waiting' | 'canceled';
export interface Q2ApplicationClientDownloads {
    setHttpServer(server: URL | null): void;
    prepare(state: Q2ApplicationGameState): Promise<Q2DownloadPreparation>;
    receive(block: Q2DownloadBlock): 'complete' | 'waiting' | 'unsolicited';
    close(): void;
}

/** Protocol 34 has a completion percent, but advertises neither a size nor a digest. */
export class Q2DownloadReceiver implements Q2ApplicationClientDownloads {
    private server: URL | null = null;
    private http: HttpDownloadQueue | null = null;
    private metadata = new AbortController();
    private httpTask: Promise<void> | null = null;
    private httpError: Error | null = null;
    private readonly attempted = new Set<string>();
    private readonly httpPaths = new Map<string, string>();
    private retryPath: string | null = null;
    private generation = 0;
    private state: Q2ApplicationGameState | null = null;
    private paths: AsyncGenerator<string, void, unknown> | null = null;
    private pending: { readonly path: string; readonly sink: DownloadSink; percent: number } | null = null;
    private readonly refused = new Set<string>();
    constructor(private readonly content: () => RemoteContentMounts,
        private readonly command: (text: string) => void, private readonly print: (text: string) => void,
        private readonly refreshPackages?: () => Promise<void>,
        private readonly permission: ClientDownloadPermission = () => true) {}
    get revision(): number { return this.generation; }

    setHttpServer(server: URL | null): void { this.close(); this.server = server; }
    private root(path: string): string {
        const content = this.content();
        return path.toLowerCase().startsWith('players/') ? content.baseWriteRoot : content.writeRoot;
    }
    private httpDestination(path: string): string { return `${basename(this.root(path))}/${path}`; }
    private httpResource(destination: string): string {
        const path = this.httpPaths.get(destination);
        if (path === undefined) throw new Error('Unknown Q2 HTTP download destination');
        return path;
    }
    private start(task: Promise<void>): void {
        const generation = this.generation;
        this.httpTask = task.catch((cause: unknown) => {
            if (this.generation === generation) this.httpError = cause instanceof Error ? cause : new Error(String(cause));
        }).finally(() => { if (this.generation === generation) this.httpTask = null; });
    }
    private async httpAsset(path: string, kind: 'asset' | 'package' = 'asset'): Promise<void> {
        const http = this.http, server = this.server, state = this.state;
        if (http === null || server === null || state === null || this.attempted.has(path)
            || !this.permission({ transport: 'http', category: clientDownloadCategory(path) })) return;
        this.attempted.add(path);
        const game = state.data.gamedir || 'baseq2';
        const url = new URL(`${encodeURIComponent(game)}/${path.split('/').map(encodeURIComponent).join('/')}`, server);
        const destination = this.httpDestination(path); this.httpPaths.set(destination, path);
        const result = await http.enqueue({ path: destination, url, kind, expected: { kind: 'protocol-completion', maximumBytes: 0x7fffffff },
            validate: async (staged: string) => {
                if (!this.permission({ transport: 'http', category: clientDownloadCategory(path) })) throw new Error('Q2 HTTP download permission changed');
                if (kind === 'package') { const archive = await openArchive(staged, path.toLowerCase().endsWith('.pak') ? 'pak' : 'zip'); await archive.close(); }
            } });
        if (result.kind === 'failed') throw result.reason;
        if (result.kind === 'fallback') this.print(`HTTP unavailable: ${path}; ${kind === 'asset' ? 'using native download' : 'continuing with individual files'}\n`);
    }
    private async httpInitial(state: Q2ApplicationGameState): Promise<void> {
        const server = this.server;
        if (server === null || !this.permission({ transport: 'http', category: 'metadata' })) return;
        const generation = this.generation, signal = this.metadata.signal;
        const current = (): void => { if (generation !== this.generation || signal.aborted) throw new Error('Q2 download generation retired');
            if (!this.permission({ transport: 'http', category: 'metadata' })) throw new Error('Q2 HTTP download permission changed'); };
        const game = state.data.gamedir || 'baseq2', map = state.configStrings.get(33);
        const owner = this.content();
        await mkdir(dirname(owner.writeRoot), { recursive: true }); current();
        const assets = new Map<string, HttpAssetScope>(), packages = new Set<string>();
        const addAsset = (path: string, scope: HttpAssetScope = 'search-path'): void => {
            if (assets.get(path) !== 'game-local') assets.set(path, scope);
        };
        this.http = new HttpDownloadQueue({ root: dirname(owner.writeRoot), assertCurrent: current,
            resolved: async destination => {
                current();
                const path = this.httpResource(destination);
                if (!this.permission({ transport: 'http', category: clientDownloadCategory(path) })) return true;
                const content = this.content(), product = content.product;
                const directory = product.expectation.contentDirectory;
                const roots = new Set([resolve(content.catalog.corpusRoot, directory), resolve(content.writeRoot)]);
                if (product.looseRoot !== null) roots.add(resolve(product.looseRoot));
                const found = await content.mounts.open(path, mount => assets.get(path) !== 'game-local'
                    || roots.has(resolve(mount.kind === 'archive' ? dirname(mount.archivePath) : mount.rootPath)));
                current(); return found !== null;
            },
            refreshPackage: async destination => { this.httpResource(destination); if (this.refreshPackages === undefined) throw new Error('Q2 package refresh is unavailable'); await this.refreshPackages(); current(); },
            progress: () => undefined });
        const lists = [`${encodeURIComponent(game)}.filelist`];
        if (map !== undefined) { this.validate(map); lists.push(`${encodeURIComponent(game)}/${map.slice(0, -4).split('/').map(encodeURIComponent).join('/')}.filelist`); addAsset(map); }
        for (const list of lists) {
            if (!this.permission({ transport: 'http', category: 'metadata' })) return;
            const bytes = await fetchHttpDownloadMetadata(new URL(list, server), 1 << 20, signal); current();
            if (bytes === null) continue;
            for (const raw of new TextDecoder().decode(bytes).split('\n')) {
                const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
                if (line === '') continue;
                try {
                    if (/\.(?:pak|pkz)$/i.test(line)) {
                        downloadPath(line);
                        if (!/^[a-zA-Z0-9_+.-]+\.(?:pak|pkz)$/i.test(line)) throw new Error('Invalid package path');
                        if (this.refreshPackages !== undefined) packages.add(line);
                    } else { const path = line.startsWith('@') ? line.slice(1) : line; this.validateHttpFilelistAsset(path); addAsset(path, line.startsWith('@') ? 'game-local' : 'search-path'); }
                } catch { this.print(`Ignoring invalid Q2 filelist entry: ${line.slice(0, 128)}\n`); }
            }
        }
        // Native Q2 cannot download flat packages. Settle package publication/reload before assets.
        for (const path of packages) { await this.httpAsset(path, 'package'); current(); }
        const layout = q2ApplicationLayout({ kind: 'q2-classic', version: 34 });
        for (let index = 1; index < layout.maxModels; index++) {
            const path = state.configStrings.get(layout.models + index);
            if (path && !path.startsWith('*') && !path.startsWith('#')) { this.validate(path); addAsset(path); }
        }
        for (let index = 1; index < layout.maxSounds; index++) {
            const name = state.configStrings.get(layout.sounds + index);
            if (name && !name.startsWith('*')) { const path = name.startsWith('#') ? name.slice(1) : `sound/${name}`; this.validate(path); addAsset(path); }
        }
        await Promise.all([...assets.keys()].map(path => this.httpAsset(path))); current();
    }

    private validateHttpFilelistAsset(path: string): void {
        downloadPath(path);
        // Donor HTTP whitelist plus JPEG/BMP/GIF supported by the shared image reader.
        if (!/^[a-zA-Z0-9_+./-]+$/.test(path) || !path.includes('/')
            || !/\.(?:bsp|dm2|ent|jpg|loc|md2|md3|ogg|pcx|png|sp2|tga|txt|wal|wav|jpeg|bmp|gif)$/i.test(path))
            throw new Error(`Q2 filelist requested a non-asset download: ${path}`);
    }

    private validate(path: string): void {
        downloadPath(path);
        if (!/^[a-zA-Z0-9_+./-]+$/.test(path)
            || !/^(?:maps\/.*\.bsp|(?:models|players)\/.*\.(?:md2|sp2|pcx|wav)|sound\/.*\.wav|pics\/.*\.pcx|env\/.*\.(?:tga|pcx)|textures\/.*\.wal)$/i.test(path))
            throw new Error(`Q2 server requested a non-asset download: ${path}`);
    }

    private async *resources(state: Q2ApplicationGameState, content: RemoteContentMounts): AsyncGenerator<string, void, unknown> {
        const layout = q2ApplicationLayout({ kind: 'q2-classic', version: 34 });
        const names = (first: number, count: number): string[] => Array.from({ length: count - 1 }, (_, index) => state.configStrings.get(first + index + 1) ?? '').filter(Boolean);
        const map = state.configStrings.get(layout.models + 1);
        if (map === undefined) throw new Error('Q2 server supplied no world model');
        yield map;
        const world = await content.mounts.open(map);
        if (world === null) throw new Error(`Q2 server map is unavailable: ${map}`);
        const checksum = state.configStrings.get(layout.mapChecksum);
        if (checksum === undefined || (Number(checksum) >>> 0) !== blockChecksum(world.bytes))
            throw new Error('Q2 server map checksum differs from mounted content');
        for (const model of names(layout.models, layout.maxModels)) {
            if (model === map || model.startsWith('*') || model.startsWith('#')) continue;
            yield model;
            const opened = await content.mounts.open(model);
            if (opened === null) continue;
            if (model.toLowerCase().endsWith('.md2')) {
                for (const skin of parseMd2(opened.bytes, model).skins) if (skin !== '') yield skin;
            } else if (model.toLowerCase().endsWith('.sp2')) {
                for (const frame of parseSp2(opened.bytes, model).frames) yield frame.image;
            }
        }
        for (const sound of names(layout.sounds, layout.maxSounds)) {
            if (!sound.startsWith('*')) yield sound.startsWith('#') ? sound.slice(1) : `sound/${sound}`;
        }
        for (const image of names(layout.images, layout.maxImages)) yield image.startsWith('/') ? image.slice(1) : `pics/${image}.pcx`;
        for (let slot = 0; slot < 256; slot++) {
            const value = state.configStrings.get(layout.playerSkins + slot);
            if (!value) continue;
            const skin = value.slice(value.indexOf('\\') + 1), slash = skin.indexOf('/');
            if (slash < 1) continue;
            const model = skin.slice(0, slash), name = skin.slice(slash + 1);
            for (const path of ['tris.md2', 'weapon.md2', 'weapon.pcx', `${name}.pcx`, `${name}_i.pcx`]) yield `players/${model}/${path}`;
        }
        const sky = state.configStrings.get(2);
        if (sky) for (const suffix of SKY_FACE_SUFFIXES) {
            const tga = `env/${sky}${suffix}.tga`, pcx = `env/${sky}${suffix}.pcx`;
            if (await content.mounts.resolve(tga) === null && await content.mounts.resolve(pcx) === null) {
                yield tga;
                if (await content.mounts.resolve(tga) === null) yield pcx;
            }
        }
        for (const texture of readQ2Bsp(world.bytes, map).textureInfo) yield `textures/${texture.name}.wal`;
    }

    async prepare(state: Q2ApplicationGameState): Promise<Q2DownloadPreparation> {
        const selected = remoteContentSelection('q2-classic-baseq2', state.data.gamedir), owner = this.content();
        if (owner.selection.base !== selected.base || owner.selection.directory !== selected.directory)
            throw new Error('Q2 server game differs from prepared content');
        if (this.state !== state) { this.close(); this.state = state; if (this.server !== null && this.permission({ transport: 'http', category: 'metadata' })) this.start(this.httpInitial(state)); }
        if (this.httpTask !== null) return 'waiting';
        if (this.httpError !== null) throw this.httpError;
        if (this.paths === null) this.paths = this.resources(state, this.content());
        if (this.pending !== null) return 'waiting';
        const generation = this.generation, paths = this.paths, content = this.content();
        if (paths === null) return 'canceled';
        try {
            for (;;) {
                const next = this.retryPath === null ? await paths.next() : { done: false, value: this.retryPath };
                this.retryPath = null;
                if (generation !== this.generation) return 'canceled';
                if (next.done) return 'ready';
                const path = next.value;
                this.validate(path);
                const installed = await content.mounts.resolve(path);
                if (generation !== this.generation) return 'canceled';
                if (installed !== null || this.refused.has(path)) continue;
                if (this.http !== null && !this.attempted.has(path) && this.permission({ transport: 'http', category: clientDownloadCategory(path) })) {
                    this.retryPath = path; this.start(this.httpAsset(path)); return 'waiting';
                }
                if (!this.permission({ transport: 'native', category: clientDownloadCategory(path) })) continue;
                await mkdir(this.root(path), { recursive: true });
                if (generation !== this.generation) return 'canceled';
                if (!this.permission({ transport: 'native', category: clientDownloadCategory(path) })) continue;
                const sink = DownloadSink.create(this.root(path), path, { kind: 'protocol-completion', maximumBytes: 0x7fffffff });
                this.pending = { path, sink, percent: 0 };
                this.command(`download ${path}`);
                return 'waiting';
            }
        } catch (error) {
            if (generation !== this.generation) return 'canceled';
            this.close(); throw error;
        }
    }

    receive(block: Q2DownloadBlock): 'complete' | 'waiting' | 'unsolicited' {
        const pending = this.pending;
        if (pending === null) return 'unsolicited';
        if (!this.permission({ transport: 'native', category: clientDownloadCategory(pending.path) })) { pending.sink.close(); this.pending = null; return 'complete'; }
        try {
            if (block.bytes === null) {
                this.refused.add(pending.path);
                this.print(`Server download unavailable: ${pending.path}\n`);
                pending.sink.close(); this.pending = null;
                return 'complete';
            }
            if (block.percent < pending.percent || block.percent > 100) throw new Error('Invalid Q2 download progress');
            pending.sink.append(block.bytes);
            pending.percent = block.percent;
            // Native zero-length files end with size=0, percent=0.
            if (block.percent === 100 || block.bytes.length === 0 && pending.sink.byteLength === 0) {
                pending.sink.finish(); this.pending = null;
                return 'complete';
            }
            if (block.bytes.length === 0) throw new Error('Q2 download made no progress');
            this.command('nextdl');
            return 'waiting';
        } catch (error) { this.close(); throw error; }
    }

    close(): void {
        this.generation++; this.http?.cancel(); this.http = null; this.metadata.abort(); this.metadata = new AbortController();
        this.httpTask = null; this.httpError = null; this.attempted.clear(); this.httpPaths.clear(); this.retryPath = null;
        this.pending?.sink.close(); this.pending = null;
        this.paths = null; this.state = null; this.refused.clear();
    }
}
