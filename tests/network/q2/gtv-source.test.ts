import { expect, test } from 'bun:test';
import { GtvRemoteSource } from '../../../src/app/bootstrap/network/gtv-source.ts';
import { MvdBroadcast } from '../../../src/network/q2/mvd-broadcast.ts';
import type { MvdCapture } from '../../../src/network/q2/mvd-encoding.ts';
import { PlayerStateT } from '../../../src/network/q2/state.ts';

function capture(servercount = 1): MvdCapture {
  const player = new PlayerStateT(); player.fov = 90;
  return { revision: 2010, flags: 0, servercount, gamedir: 'baseq2', dummy: -1,
    configStrings: new Map([[30, '1'], [33, 'maps/base1.bsp']]), portalBits: Uint8Array.of(1),
    players: new Map([[0, player]]), entities: [], messages: [] };
}

test('authenticated GTV prepares its real header, then the existing receiver admits worlds and source frames', async () => {
  const broadcast = new MvdBroadcast({ authorize: hello => hello.password === 'secret' });
  let source: GtvRemoteSource | null = null;
  try {
    broadcast.observe(capture());
    const port = await broadcast.listen('127.0.0.1', 0);
    await expect(GtvRemoteSource.prepare({ host: '127.0.0.1', port,
      identity: { username: 'viewer', password: 'bad', version: 'test' } })).rejects.toThrow();
    source = await GtvRemoteSource.prepare({ host: '127.0.0.1', port,
      identity: { username: 'viewer', password: 'secret', version: 'test' } });
    expect(source.header.revision).toBe(2010); expect(source.phase).toBe('loading'); expect(source.time).toBeNull();
    let loaded = false, worlds = 0, frames = 0, viewer = -1;
    source.bind({ protocol: source.header.protocol, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 },
      gameState: async state => { expect(state.configStrings.get(33)).toBe('maps/base1.bsp'); await Promise.resolve(); loaded = true; worlds++; },
      frame: () => { expect(loaded).toBe(true); expect(viewer).toBe(0); frames++; },
      records() {}, print() {}, disconnected() {},
    }, { selectView: value => { viewer = value; }, visibility: {
      entities: values => { expect(loaded).toBe(true); return values; }, areaBits: () => Uint8Array.of(1),
      visible: () => true, soundAudible: () => true, soundOrigin: () => [0, 0, 0],
    } });
    await source.poll(); expect(source.phase).toBe('active'); expect(source.time).toBe(100); expect(frames).toBe(1);
    broadcast.observe(capture(2));
    for (let attempt = 0; worlds < 2 && attempt < 100; attempt++) { await Bun.sleep(1); await source.poll(); }
    expect(worlds).toBe(2); expect(frames).toBe(2); expect(source.time).toBe(100);
    source.close(); source.close(); expect(source.phase).toBe('closed');
  } finally { source?.close(); await broadcast.close(); }
}, 3000);

test('discarding an unbound GTV candidate releases its paused DATA and socket owner', async () => {
  const broadcast = new MvdBroadcast({ authorize: () => true });
  try {
    broadcast.observe(capture());
    const port = await broadcast.listen('127.0.0.1', 0);
    const source = await GtvRemoteSource.prepare({ host: '127.0.0.1', port,
      identity: { username: 'viewer', password: '', version: 'test' } });
    source.close(); await source.poll(); expect(source.phase).toBe('closed');
  } finally { await broadcast.close(); }
}, 3000);
