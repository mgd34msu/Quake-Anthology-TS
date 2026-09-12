/* Quake II server/sv_user.c SV_BeginDownload_f/SV_NextDownload_f. GPL-2.0-or-later. */
import { canDownloadResource } from '../../../content/mounts/index.ts';
import type { MountedContent } from '../../../content/mounts/index.ts';
import { Q2CvarFlag } from '../../../core/cvars/index.ts';
import type { CvarRegistry } from '../../../core/cvars/index.ts';
import { nativeAtoi } from '../../../core/numeric.ts';
import { Q2DownloadSender } from '../../../network/q2/server-write.ts';
import { downloadPath } from '../../../network/services/downloads.ts';
import type { DownloadSource } from '../../../network/services/downloads.ts';

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
