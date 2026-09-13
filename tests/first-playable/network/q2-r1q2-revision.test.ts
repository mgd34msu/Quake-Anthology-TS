import { expect, test } from 'bun:test';
import { Q2ServerMessageReader } from '../../../src/network/q2/server-messages.ts';
import { Q2RemotePresentation, q2RemoteEntityBounds } from '../../../src/app/bootstrap/network/remote.ts';
import { parseApplicationCommand } from '../../../src/app/bootstrap/options.ts';
import { pmoveClassic } from '../../../src/movement/q2/classic.ts';
import type { ClassicPmove, TraceT } from '../../../src/movement/q2/types.ts';
import { loadApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { blockChecksum } from '../../../src/core/md4.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import { EntityStateT, PlayerStateT } from '../../../src/network/q2/state.ts';
import { createNumericOperations } from '../../../src/core/numeric.ts';

// q2proto_proto_r1q2.c serverdata followed by U_MOREBITS1/2/3 | U_SOLID baseline.
// Written independently of the engine encoder: bbox [-17,-17,-25]..[17,17,33].
function sourceBytes(revision: 1904 | 1905, strafejump: boolean): Uint8Array {
    return new Uint8Array([12, 35, 0, 0, 0, 1, 0, 0, 0, 0, 98, 97, 115, 101, 113, 50, 0, 0, 0, 0, 0,
        revision & 255, revision >>> 8, 0, Number(strafejump), 14, 128, 128, 128, 8, 2,
        ...(revision === 1905 ? [17, 25, 33, 128] : [98, 32])]);
}

test('explicit R1Q2 1905 selection retains older launch defaults', () => {
    const selections: readonly { selector: string; revision: 1904 | 1905 }[] = [{ selector: '35', revision: 1904 }, { selector: '35:1905', revision: 1905 }];
    for (const { selector, revision } of selections) {
        const parsed = parseApplicationCommand(['--connect-q2', '127.0.0.1', '--q2-protocol', selector]);
        if (parsed.kind !== 'run') throw new Error('Missing launch');
        expect(parsed.options.q2Protocol).toEqual({ kind: 'q2-r1q2', version: 35, revision });
    }
});

test('source bytes choose negotiated solid width before the next baseline', () => {
    const reader = new Q2ServerMessageReader({ kind: 'q2-r1q2', version: 35, revision: 1905 }, { maxConfigStrings: 2080, inventorySlots: 256 });
    for (const revision of [1905, 1904, 1905]) {
        if (revision !== 1904 && revision !== 1905) throw new Error('Unexpected test revision');
        const records = reader.read(sourceBytes(revision, true));
        const server = records[0]?.event, baseline = records[1]?.event;
        if (server?.kind !== 'server-data' || baseline?.kind !== 'baseline') throw new Error('Missing source records');
        expect(server.data.r1q2StrafejumpHack).toBe(true);
        expect(reader.wire.protocol).toEqual({ kind: 'q2-r1q2', version: 35, revision });
        expect(q2RemoteEntityBounds(baseline.entity.solid, revision === 1905)).toEqual(revision === 1905
            ? { min: { x: -17, y: -17, z: -25 }, max: { x: 17, y: 17, z: 33 } }
            : { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } });
    }
    const older = new Q2ServerMessageReader({ kind: 'q2-r1q2', version: 35, revision: 1904 }, { maxConfigStrings: 2080, inventorySlots: 256 });
    const highestReport = sourceBytes(1904, false); highestReport[21] = 1905 & 255;
    expect(older.read(highestReport)[1]?.event.kind).toBe('baseline');
    expect(older.wire.protocol).toEqual({ kind: 'q2-r1q2', version: 35, revision: 1904 });
    expect(q2RemoteEntityBounds(0xffff00ff, true)).toEqual({ min: { x: -255, y: -255, z: -0 }, max: { x: 255, y: 255, z: 32767 } });
    expect(q2RemoteEntityBounds(0x0000ff01, true)).toEqual({ min: { x: -1, y: -1, z: -255 }, max: { x: 1, y: 1, z: -32768 } });
});

function falling(): ClassicPmove {
    return { s: { pm_type: 0, origin: [0, 0, 192], velocity: [0, 0, -2400], pm_flags: 0, pm_time: 0, gravity: 800, delta_angles: [0, 0, 0] },
        cmd: { msec: 8, angles: [0, 0, 0], forwardmove: 0, sidemove: 0, upmove: 200, buttons: 0, impulse: 0, lightlevel: 0 },
        snapinitial: false, numtouch: 0, touchents: [], touchtraces: [], viewangles: [0, 0, 0], viewheight: 22,
        mins: [-16, -16, -24], maxs: [16, 16, 32], groundentity: null, watertype: 0, waterlevel: 0,
        characterBounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, pointcontents: () => 0,
        trace(start, mins, _maxs, end): TraceT {
            const hit = end[2] + mins[2] < 0;
            const fraction = hit ? Math.max(0, (start[2] + mins[2]) / (start[2] - end[2])) : 1;
            const endpos: [number, number, number] = [end[0], end[1], hit ? -mins[2] : end[2]];
            return { allsolid: false, startsolid: false, fraction, endpos,
                plane: { normal: [0, 0, 1], dist: 0, type: 2, signbits: 0 }, plane2: { normal: [0, 0, 0], dist: 0, type: 0, signbits: 0 },
                surface: null, surface2: null, contents: hit ? 1 : 0, ent: hit ? { kind: 'world', model: 0 } : null,
                source: { kind: 'q2', fraction, end: { x: endpos[0], y: endpos[1], z: endpos[2] }, startSolid: false, allSolid: false,
                    hit: hit ? { kind: 'world', model: 0 } : { kind: 'none' }, contact: { kind: 'none' }, contents: hit ? 1 : 0,
                    surface: null, secondary: null, sourcePlane: { normal: { x: 0, y: 0, z: 1 }, distance: 0, type: 2, signbits: 0 } } };
        } };
}

test('negotiated R1Q2 strafejump flag suppresses native landing delay for both revisions', () => {
    const numeric = createNumericOperations({ id: 'q2:binary32', arithmetic: { kind: 'binary32', round: 'each-operation' }, scalarStorage: 'binary32', floatToInt: 'checked-c-truncation', integerOverflow: 'wrap32' });
    for (const revision of [1904, 1905]) {
        if (revision !== 1904 && revision !== 1905) throw new Error('Unexpected revision');
        for (const enabled of [false, true]) {
            const reader = new Q2ServerMessageReader({ kind: 'q2-r1q2', version: 35, revision }, { maxConfigStrings: 2080, inventorySlots: 256 });
            const event = reader.read(sourceBytes(revision, enabled))[0]?.event;
            if (event?.kind !== 'server-data') throw new Error('Missing serverdata');
            const pm = falling();
            pmoveClassic(pm, numeric, 0, event.data.r1q2StrafejumpHack);
            expect(pm.s.pm_time).toBe(enabled ? 0 : 17);
            expect(pm.s.velocity[2] > 0).toBe(enabled);
        }
    }
});


test('remote presentation admits negotiated flags and publishes matching native entity bounds', async () => {
    const corpusRoot = process.env['QUAKE_Q2_CORPUS_ROOT'];
    const launch = parseApplicationCommand(['--game', 'q2-classic-baseq2', '--movement', 'q2', '--character', 'q2',
        ...(corpusRoot === undefined ? [] : ['--content-root', corpusRoot])]);
    if (launch.kind !== 'run') throw new Error('Missing launch');
    const content = await loadApplicationContent(launch.options);
    const identity = createIdentityOwner('r1q2 source presentation'), session = new EngineSession(identity, { kind: 'headless' });
    const remote = new Q2RemotePresentation({ identity, session, content, protocol: { kind: 'q2-r1q2', version: 35, revision: 1905 },
        userinfo: () => '', print: () => undefined, sendCommand: () => undefined });
    try {
        const checksum = blockChecksum(await content.mounts.read(content.recipe.map.geometry));
        for (const revision of [1905, 1904]) {
            const reader = new Q2ServerMessageReader({ kind: 'q2-r1q2', version: 35, revision: 1905 }, { maxConfigStrings: 2080, inventorySlots: 256 });
            if (revision !== 1904 && revision !== 1905) throw new Error('Unexpected revision');
            const records = reader.read(sourceBytes(revision, true));
            const data = records[0]?.event, baseline = records[1]?.event;
            if (data?.kind !== 'server-data' || baseline?.kind !== 'baseline') throw new Error('Missing source records');
            await remote.gameState({ data: { ...data.data, serverState: 2 },
                configStrings: new Map([[33, content.recipe.map.geometry.requestedPath], [31, String(checksum)], [30, '1']]),
                baselines: new Map<number, EntityStateT>() });
            expect(remote.protocol).toEqual({ kind: 'q2-r1q2', version: 35, revision });
            const player = new PlayerStateT(); player.stats[1] = 100;
            remote.frame({ serverFrame: 1, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array(0), player, entities: [baseline.entity] }, [], 100);
            const bounds = remote.output?.snapshot.bodies.find(body => !remote.player?.actor.equals(body.actor))?.body.bounds;
            expect(bounds).toEqual(q2RemoteEntityBounds(baseline.entity.solid, revision === 1905));
        }
    } finally { session.close(); await content.close(); }
});
