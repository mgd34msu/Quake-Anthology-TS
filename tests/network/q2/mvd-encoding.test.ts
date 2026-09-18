import { test, expect } from 'bun:test';
import { MvdEncoder } from '../../../src/network/q2/mvd-encoding.ts';
import type { MvdCapture } from '../../../src/network/q2/mvd-encoding.ts';
import { MvdPlayback } from '../../../src/network/q2/mvd-playback.ts';
import { PlayerStateT, EntityStateT } from '../../../src/network/q2/state.ts';
import { mvdProfile } from '../../../src/network/q2/mvd-profile.ts';
import { MvdBroadcast } from '../../../src/network/q2/mvd-broadcast.ts';
import { GtvConnection } from '../../../src/network/q2/gtv-transport.ts';
import { readMvdRecording } from '../../../src/network/q2/mvd-recording.ts';
export function capture(revision: number, x = 100): MvdCapture {
    const flags = revision === 2011 ? 4 : revision === 2012 || revision === 2013 ? 12 : 0, profile = mvdProfile(revision, flags);
    const player = new PlayerStateT(); player.pmove.origin[0] = x * 8; player.pmove.originF[0] = x + 0.5; player.fov = 95; player.gunindex = profile.extended ? 500 : 5; player.stats[profile.extended ? 1 : 0] = 88;
    if (profile.fog) player.q2proFog.density = 1234;
    const other = new PlayerStateT(); other.fov = 90;
    const entity = new EntityStateT(); entity.number = 10; entity.origin[0] = x + 0.5; entity.modelindex = profile.extended ? 300 : 3; entity.solid = profile.extended ? 0x12345678 : 123;
    return { revision, flags, servercount: 1, gamedir: 'baseq2', dummy: -1, configStrings: new Map([[profile.maxClientsIndex, '2'], [0, 'fixture']]), portalBits: Uint8Array.of(1), players: new Map([[0, player], [1, other]]), entities: [entity], messages: [] };
}
function playback(): MvdPlayback {
    return new MvdPlayback({ entities: entities => entities, visible: leaf => leaf === 1, areaBits: () => Uint8Array.of(1), soundOrigin: entity => [entity.origin[0] ?? 0, 0, 0], soundAudible: () => true });
}
test('native MVD producer encodes all-player baseline/deltas/removal for every supported profile', () => {
    for (const revision of [2010, 2011, 2012, 2013, 3038]) {
        const encoder = new MvdEncoder(), reader = playback();
        for (const packet of encoder.capture(capture(revision))) reader.read(packet);
        expect(reader.players.size).toBe(2); expect(reader.projection.frame.entities[0]?.modelindex).toBe(revision === 2010 ? 3 : 300);
        const next = capture(revision, 125), players = new Map(next.players); players.delete(1);
        for (const packet of encoder.capture({ ...next, players })) reader.read(packet);
        expect(reader.players.size).toBe(1); expect(reader.projection.frame.entities[0]?.origin[0]).toBe(125.5);
        expect(reader.projection.frame.entities[0]?.solid).toBe(revision === 2010 ? 123 : 0x12345678);
        if (revision === 3038) expect(reader.projection.frame.player.pmove.originF[0]).toBe(125.5);
        else expect(reader.projection.frame.player.pmove.origin[0]).toBe(1000);
        if (revision === 2013) expect(reader.projection.frame.player.q2proFog.density).toBe(1234);
    }
});
test('MVD recipient policy preserves PHS/PVS and selected player, including eleven-bit payload lengths', () => {
    const encoder = new MvdEncoder(), reader = playback();
    for (const packet of encoder.capture(capture(2010))) reader.read(packet);
    const print = (text: string): Uint8Array => Uint8Array.of(10, 2, ...new TextEncoder().encode(text), 0);
    const routed = encoder.capture({ ...capture(2010), messages: [
        { recipient: { kind: 'phs', leaf: 2 }, reliable: false, bytes: print('hidden') },
        { recipient: { kind: 'pvs', leaf: 1 }, reliable: true, bytes: print('visible'.repeat(50)) },
        { recipient: { kind: 'player', number: 1 }, reliable: true, bytes: print('other player') },
        { recipient: { kind: 'player', number: 0 }, reliable: true, bytes: print('self') }
    ] });
    const texts = routed.flatMap(packet => reader.read(packet)).flatMap(record => record.event.kind === 'print' ? [record.event.text] : []);
    expect(texts).toEqual(['visible'.repeat(50), 'self']);
});
test('authoritative captures feed real TCP GTV playback and reusable MVD recording sink', async () => {
    const chunks: Uint8Array[] = [], producer = new MvdBroadcast({ authorize: hello => hello.password === 'fixture', record: bytes => { chunks.push(bytes); } });
    const reader = playback(); let frames = 0;
    let resolveFrame: (() => void) | null = null;
    let frameReady = new Promise<void>(resolve => { resolveFrame = resolve; });
    let connection: GtvConnection | null = null;
    try {
        producer.observe(capture(2013));
        const port = await producer.listen('127.0.0.1', 0);
        await expect(GtvConnection.connect({ host: '127.0.0.1', port, identity: { username: 'bad', password: 'wrong', version: 'test' }, timeoutMilliseconds: 1000, event: () => {} })).rejects.toThrow();
        connection = await GtvConnection.connect({ host: '127.0.0.1', port, identity: { username: 'viewer', password: 'fixture', version: 'test' }, timeoutMilliseconds: 1000, event: event => {
            if (event.kind === 'data') { for (const record of reader.read(event.bytes)) if (record.event.kind === 'frame') { frames++; resolveFrame?.(); } }
        } });
        connection.start(); await frameReady;
        frameReady = new Promise<void>(resolve => { resolveFrame = resolve; }); producer.observe(capture(2013, 222)); await frameReady;
        expect(frames).toBe(2); expect(reader.projection.frame.player.pmove.origin[0]).toBe(1776);
    } finally { connection?.close(); await producer.close(); }
    const replay = playback();
    for (const packet of readMvdRecording(Uint8Array.from(chunks.flatMap(chunk => [...chunk])))) replay.read(packet);
    expect(replay.projection.frame.player.pmove.origin[0]).toBe(1776);
}, 3000);
