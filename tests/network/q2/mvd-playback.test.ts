import { Q2DemoPlayback, readQ2PlaybackHeader } from '../../../src/app/bootstrap/network/q2-demo.ts';
import { MvdRecording } from '../../../src/network/q2/mvd-recording.ts';
import { test, expect } from 'bun:test';
import { MvdPlayback } from '../../../src/network/q2/mvd-playback.ts';
import { createMessage, messageBytes, MSG_WriteByte, MSG_WriteShort, MSG_WriteLong, MSG_WriteString } from '../../../src/network/q2/message.ts';
import { PlayerStateT } from '../../../src/network/q2/state.ts';
import { MSG_WriteDeltaMvdPlayerstate, PPS_MOREBITS } from '../../../src/network/q2/codecs/mvd.ts';
function gamestate(): Uint8Array {
    const message = createMessage();
    MSG_WriteByte(message, 4); MSG_WriteLong(message, 37); MSG_WriteShort(message, 2010); MSG_WriteLong(message, 12); MSG_WriteString(message, 'baseq2'); MSG_WriteShort(message, -1);
    for (const [index, text] of [[0, 'Arena'], [30, '2'], [33, 'maps/q2dm1.bsp']] satisfies readonly (readonly [number, string])[]) { MSG_WriteShort(message, index); MSG_WriteString(message, text); }
    MSG_WriteShort(message, 2080); MSG_WriteByte(message, 1); MSG_WriteByte(message, 0x55);
    const first = new PlayerStateT(); first.fov = 90; first.pmove.origin[0] = 800; first.viewangles[1] = 90;
    const second = new PlayerStateT(); second.fov = 100; second.pmove.origin[0] = -1600;
    MSG_WriteDeltaMvdPlayerstate(message, null, first, 0, true); MSG_WriteDeltaMvdPlayerstate(message, null, second, 1, true); MSG_WriteByte(message, 255);
    // Native first-person MVD entities omit position; it is reconstructed from player state.
    MSG_WriteByte(message, 0); MSG_WriteByte(message, 1); MSG_WriteByte(message, 0); MSG_WriteByte(message, 2); MSG_WriteShort(message, 0);
    return messageBytes(message);
}
function playback(): MvdPlayback {
    return new MvdPlayback({ entities: entities => entities, soundAudible: () => true, visible: (_leaf, _channel, _player, portals) => portals[0] === 0x55, areaBits: (_player, portals) => Uint8Array.of(portals[0] === 0x55 ? 7 : 0), soundOrigin: entity => [entity.origin[0] ?? 0, entity.origin[1] ?? 0, entity.origin[2] ?? 0] });
}
test('native2010 gamestate publishes shared records, all players and BSP-derived area bits', () => {
    const reader = playback(), records = reader.read(gamestate());
    expect(records.map(record => record.event.kind)).toEqual(['server-data', 'config-string', 'config-string', 'config-string', 'command-text', 'frame']);
    const frame = records.find(record => record.event.kind === 'frame')?.event;
    if (frame?.kind !== 'frame') throw new Error('Missing frame');
    expect(frame.frame.areaBits).toEqual(Uint8Array.of(7)); expect(frame.frame.player.fov).toBe(90);
    expect(frame.frame.entities.map(entity => entity.origin[0])).toEqual([100, -200]);
    expect(frame.frame.entities[0]?.angles[1]).toBe(90);
    expect(reader.players.size).toBe(2);
    reader.selectPlayer(1);
    // Empty delta retains both player states and entity geometry.
    const next = reader.read(Uint8Array.of(6, 1, 0x55, 255, 0, 0));
    const current = next[0]?.event;
    if (current?.kind !== 'frame') throw new Error('Missing selected frame');
    expect(current.frame.player.fov).toBe(100); expect(current.frame.serverFrame).toBe(2);
    expect(current.frame.entities.map(entity => entity.origin[0])).toEqual([100, -200]);
    const remove = createMessage(); MSG_WriteByte(remove, 6); MSG_WriteByte(remove, 0); MSG_WriteByte(remove, 1); MSG_WriteShort(remove, PPS_MOREBITS); MSG_WriteByte(remove, 255); MSG_WriteShort(remove, 0);
    reader.read(messageBytes(remove)); expect(reader.players.has(1)).toBe(false);
    expect(() => reader.selectPlayer(1)).toThrow('not active');
});
test('MVD rejects truncation, frames before gamestate and unsupported revisions explicitly', () => {
    expect(() => playback().read(Uint8Array.of(6, 0, 255, 0, 0))).toThrow('before serverdata');
    expect(() => playback().read(gamestate().slice(0, -1))).toThrow();
    const extended = gamestate(); new DataView(extended.buffer).setUint16(5, 9999, true);
    expect(() => playback().read(extended)).toThrow('Unsupported MVD revision');
});

test('native2011/2012/2013/3038 headers and player field encodings retain source layout', () => {
    for (const revision of [2011, 2012, 2013, 3038]) {
        const bytes: number[] = [], byte = (v: number): void => { bytes.push(v & 255); }, word = (v: number): void => { byte(v); byte(v >>> 8); }, long = (v: number): void => { word(v); word(v >>> 16); };
        const text = (v: string): void => { for (const c of v) byte(c.charCodeAt(0)); byte(0); };
        byte(revision === 2011 ? 4 | 4 << 5 : 4); long(37); word(revision);
        if (revision === 2012 || revision === 2013) word(12);
        long(12); text('baseq2'); word(-1); word(60); text('2'); word(revision === 3038 ? 12448 : 13630);
        byte(0); byte(1);
        // origin x/y, FOV, stats;2013 also carries native high fog bit.
        word(2 | 256 | 16384 | (revision === 2013 ? 32768 : 0));
        if (revision === 2013) byte(2);
        if (revision === 3038) {
            const floats = new Uint8Array(8), view = new DataView(floats.buffer); view.setFloat32(0, 1234.5, true); view.setFloat32(4, -6.25, true); bytes.push(...floats);
        } else if (revision >= 2012) { word(800 << 1); word(-1600 << 1); }
        else { word(800); word(-1600); }
        if (revision === 2013) { byte(2); word(32768); word(65535); }
        byte(105);
        if (revision === 3038) { long(0); long(1); word(99); }
        else if (revision >= 2012) { byte(128); byte(128); byte(128); byte(128); byte(16); word(99); }
        else { long(1); word(99); }
        byte(255); word(0);
        const reader = playback(), records = reader.read(Uint8Array.from(bytes)), projection = reader.projection;
        expect(records[0]?.event.kind).toBe('server-data'); expect(projection.clientnum).toBe(1); expect(projection.frame.player.clientnum).toBe(1);
        expect(projection.frame.player.fov).toBe(105);
        expect(projection.frame.player.stats[revision === 2011 ? 0 : 32]).toBe(99);
        if (revision === 3038) expect([...projection.frame.player.pmove.originF]).toEqual([1234.5, -6.25, 0]);
        else expect([...projection.frame.player.pmove.origin]).toEqual([800, -1600, 0]);
        if (revision === 2013) expect(projection.frame.player.q2proFog.density).toBe(32768);
    }
});


test('shared demo receiver loads the recorded world before MVD visibility and rebinds the selected source view', async () => {
    const parts: Uint8Array[] = [], writer = new MvdRecording(bytes => parts.push(bytes));
    writer.append(gamestate()); writer.append(Uint8Array.of(6, 1, 0x55, 255, 0, 0)); writer.close();
    const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const header = readQ2PlaybackHeader(bytes); expect(header.kind).toBe('mvd');
    let loaded = false, selected = -1; const views: number[] = [];
    const demo = new Q2DemoPlayback(bytes, {
        protocol: header.protocol, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 },
        gameState: async state => { expect(state.configStrings.get(33)).toBe('maps/q2dm1.bsp'); await Promise.resolve(); loaded = true; },
        frame: frame => { expect(loaded).toBe(true); expect(frame.player.clientnum).toBe(selected); views.push(selected); },
        records: () => {}, disconnected: () => {}, print: () => {},
    }, { selectView: clientnum => { selected = clientnum; }, visibility: {
        entities: entities => { if (!loaded) throw new Error('Entities before world admission'); return entities; },
        visible: () => { if (!loaded) throw new Error('Visibility before world admission'); return true; },
        areaBits: () => { if (!loaded) throw new Error('Area bits before world admission'); return Uint8Array.of(7); },
        soundAudible: () => true, soundOrigin: entity => [entity.origin[0] ?? 0, entity.origin[1] ?? 0, entity.origin[2] ?? 0],
    } });
    try {
        expect(await demo.nextFrame()).toEqual({ kind: 'frame', timeMilliseconds: 100 });
        demo.selectPlayer(1);
        expect(await demo.nextFrame()).toEqual({ kind: 'frame', timeMilliseconds: 200 });
        expect(views).toEqual([0, 1]); expect(await demo.nextFrame()).toEqual({ kind: 'eof' }); expect(demo.consumedBytes).toBe(bytes.length);
    } finally { demo.close(); }
});


test('selected frame projection does not remove other players from the recorded world', () => {
    const reader = new MvdPlayback({
        entities: (entities, player) => entities.filter(entity => entity.number === player.clientnum + 1),
        areaBits: () => Uint8Array.of(1), visible: () => true, soundAudible: () => true,
        soundOrigin: entity => [entity.origin[0] ?? 0, entity.origin[1] ?? 0, entity.origin[2] ?? 0],
    });
    reader.read(gamestate()); expect(reader.projection.frame.entities.map(entity => entity.number)).toEqual([1]);
    reader.selectPlayer(1); expect(reader.projection.frame.entities.map(entity => entity.number)).toEqual([2]);
    expect(reader.players.size).toBe(2);
});
