import { test, expect } from 'bun:test';
import { Q2DemoPlayback } from '../../../src/app/bootstrap/network/q2-demo.ts';
import { Q2WireCodec, PlayerStateT, EntityStateT, encodeQ2Frame, encodeQ2ServerEvent } from '../../../src/network/q2/index.ts';
import { writeQ2DemoRecord, finishQ2Demo } from '../../../src/network/q2/demo.ts';
test('KEX recorded viewpoints preserve source identities and both playerstates', async () => {
    const protocol = { kind: 'q2-kex-demo', version: 2022 } satisfies import('../../../src/contracts/protocol.ts').Q2ProtocolIdentity;
    const wire = new Q2WireCodec(protocol), primary = new PlayerStateT(), second = new PlayerStateT();
    primary.fov = 90; second.fov = 110;
    const packets = [encodeQ2ServerEvent(wire, { kind: 'server-data', data: { servercount: 1, attractloop: true, gamedir: 'baseq2', clientnum: 2, clientnums: [2, 7], levelname: 'test', serverState: 0, serverFps: 40 } }), encodeQ2ServerEvent(wire, { kind: 'command-text', text: 'precache\n' })];
    for (let frame = 1; frame <= 3; frame++) packets.push(encodeQ2Frame(wire, { serverFrame: frame, deltaFrame: -1, suppressedCount: 0, areaBits: Uint8Array.of(1), player: primary, splitPlayers: [{ areaBits: Uint8Array.of(2), player: second }], entities: [] }, null, new Map<number, EntityStateT>(), 8));
    const bytes = Uint8Array.from([...packets.flatMap(packet => [...writeQ2DemoRecord(packet)]), ...finishQ2Demo()]);
    const views: { player: number; fov: number; area: number | undefined }[] = []; let selected = -1;
    const playback = new Q2DemoPlayback(bytes, { protocol, messageOptions: { maxConfigStrings: 12448, inventorySlots: 256 }, gameState: async () => {}, frame: frame => { views.push({ player: selected, fov: frame.player.fov, area: frame.areaBits[0] }); }, records: () => {}, disconnected: () => {}, print: () => {} }, undefined, player => { selected = player; });
    try {
      await playback.nextFrame(); playback.selectPlayer(7); await playback.nextFrame();
      expect(() => playback.selectPlayer(5)).toThrow('no viewpoint');
      playback.selectPlayer(2); await playback.nextFrame();
      expect(views).toEqual([{ player: 2, fov: 90, area: 1 }, { player: 7, fov: 110, area: 2 }, { player: 2, fov: 90, area: 1 }]);
    } finally { playback.close(); }
});
