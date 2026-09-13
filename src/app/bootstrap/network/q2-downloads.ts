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
import type { LoadedApplicationContent } from '../content.ts';
import type { Q2ApplicationGameState } from './types.ts';
import { q2ApplicationLayout } from './q2-layout.ts';

export interface Q2ApplicationDownloads {
    allowed(name: string): boolean;
    open(name: string): Promise<DownloadSource | null>;
}

/** FS_LoadFile retains selected mounted bytes for the lifetime of one native transfer. */
export function createQ2ApplicationDownloads(mounts: MountedContent, cvars: CvarRegistry, edition: 'classic' | 'rerelease'): Q2ApplicationDownloads {
    cvars.register('allow_download', edition === 'classic' ? '0' : '1', Q2CvarFlag.Archive);
    cvars.register('allow_download_players', edition === 'classic' ? '0' : '1', Q2CvarFlag.Archive);
    for (const name of ['models', 'sounds', 'maps']) cvars.register(`allow_download_${name}`, '1', Q2CvarFlag.Archive);
    return {
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

type Q2DownloadBlock = Extract<Q2ServerEvent, { readonly kind: 'download' }>;
export type Q2DownloadPreparation = 'ready' | 'waiting' | 'canceled';
export interface Q2ApplicationClientDownloads {
    prepare(state: Q2ApplicationGameState): Promise<Q2DownloadPreparation>;
    receive(block: Q2DownloadBlock): 'complete' | 'waiting' | 'unsolicited';
    close(): void;
}

/** Protocol 34 has a completion percent, but advertises neither a size nor a digest. */
export class Q2DownloadReceiver implements Q2ApplicationClientDownloads {
    private generation = 0;
    private state: Q2ApplicationGameState | null = null;
    private paths: AsyncGenerator<string, void, unknown> | null = null;
    private pending: { readonly path: string; readonly sink: DownloadSink; percent: number } | null = null;
    private readonly refused = new Set<string>();
    constructor(private readonly content: () => LoadedApplicationContent,
        private readonly command: (text: string) => void, private readonly print: (text: string) => void) {}
    get revision(): number { return this.generation; }

    private validate(path: string): void {
        downloadPath(path);
        if (!/^[a-zA-Z0-9_+./-]+$/.test(path)
            || !/^(?:maps\/.*\.bsp|(?:models|players)\/.*\.(?:md2|sp2|pcx|wav)|sound\/.*\.wav|pics\/.*\.pcx|env\/.*\.(?:tga|pcx)|textures\/.*\.wal)$/i.test(path))
            throw new Error(`Q2 server requested a non-asset download: ${path}`);
    }

    private async *resources(state: Q2ApplicationGameState, content: LoadedApplicationContent): AsyncGenerator<string, void, unknown> {
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
        if (this.state !== state) { this.close(); this.state = state; this.paths = this.resources(state, this.content()); }
        if (this.pending !== null) return 'waiting';
        const generation = this.generation, paths = this.paths, content = this.content();
        if (paths === null) return 'canceled';
        const game = content.catalog.product(content.recipe.map.entities.content).expectation.contentDirectory.split('/').at(-1);
        if ((state.data.gamedir || 'baseq2') !== game)
            throw new Error(`Q2 server game ${state.data.gamedir} differs from selected installed game ${game}`);
        for (;;) {
            const next = await paths.next();
            if (generation !== this.generation) return 'canceled';
            if (next.done) return 'ready';
            const path = next.value;
            this.validate(path);
            const installed = await content.mounts.resolve(path);
            if (generation !== this.generation) return 'canceled';
            if (installed !== null || this.refused.has(path)) continue;
            const selected = content.recipe.map.entities.content;
            const mount = content.mounts.plan.defaultOrder.map(id => content.mounts.plan.mounts.find(candidate => candidate.identity.id === id))
                .find(candidate => candidate?.kind === 'loose' && candidate.identity.content === selected);
            if (mount?.kind !== 'loose') throw new Error('Q2 downloads require a selected installed loose content root');
            const sink = DownloadSink.create(mount.rootPath, path, { kind: 'protocol-completion', maximumBytes: 0x7fffffff });
            this.pending = { path, sink, percent: 0 };
            try { this.command(`download ${path}`); }
            catch (error) { this.close(); throw error; }
            return 'waiting';
        }
    }

    receive(block: Q2DownloadBlock): 'complete' | 'waiting' | 'unsolicited' {
        const pending = this.pending;
        if (pending === null) return 'unsolicited';
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
        this.generation++; this.pending?.sink.close(); this.pending = null;
        this.paths = null; this.state = null; this.refused.clear();
    }
}
