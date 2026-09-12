import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQ2ApplicationDownloads, Q2PeerDownload } from '../../../src/app/bootstrap/network/q2-downloads.ts';
import { createMountIdentity } from '../../../src/contracts/content.ts';
import type { LooseMount } from '../../../src/contracts/content.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { openMountPlan } from '../../../src/content/mounts/index.ts';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import { Q2WireCodec, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import type { DownloadSource } from '../../../src/network/services/downloads.ts';

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
