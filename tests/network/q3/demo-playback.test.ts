import { expect, spyOn, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { Q3DemoPlayback } from '../../../src/app/bootstrap/network/q3-demo.ts';
import type { Q3ApplicationClientHost } from '../../../src/app/bootstrap/network/q3-client.ts';
import { Q3ClientClock } from '../../../src/network/q3/clock.ts';
import { DemoReader, encodeDemo, type DemoEnd } from '../../../src/network/q3/demo.ts';
import { encodeServerMessage } from '../../../src/network/q3/server-message.ts';
import type { ServerOperation, Snapshot } from '../../../src/network/q3/server-message.ts';
import { PlayerStateRecord } from '../../../src/network/q3/state/player.ts';

const frameOptions = { paused: false, timeNudge: 0, timescale: 1, freezeDemo: false, timedemo: false };
const gamestate: ServerOperation = { kind: 'gamestate', commandSequence: 0, clientNumber: 0, checksumFeed: 12,
  entries: [{ kind: 'configstring', index: 0, value: '\\protocol\\68\\mapname\\q3dm1\\g_gametype\\0' }] };
function snapshot(time: number): ServerOperation {
  return { kind: 'snapshot', validity: { kind: 'valid' }, snapshot: { messageNumber: 0, serverTime: time,
    deltaNumber: -1, flags: 0, serverCommandNumber: 0, parseEntitiesNumber: 0, areaMask: new Uint8Array(32),
    playerState: new PlayerStateRecord('baseq3', 0, 0, 0), entities: [] } };
}
function recording(operations: readonly (readonly ServerOperation[])[]): Uint8Array {
  return encodeDemo(operations.map((operations, index) => ({ kind: 'message', sequence: index + 1,
    payload: encodeServerMessage(0, operations.map(operation => operation.kind === 'snapshot'
      ? { ...operation, snapshot: { ...operation.snapshot, messageNumber: index + 1 } } : operation), { product: 'baseq3', messageNumber: index + 1, reliableSequence: 0,
      serverCommandSequence: 0, parseEntitiesNumber: 0, baseline: () => null, history: () => null }) })));
}
function fixture(bytes: Uint8Array, initialize: () => Promise<void> = async () => {}) {
  const identities = createIdentityOwner('Q3 recorded client'), clock = new Q3ClientClock(), snapshots: Snapshot[] = [];
  const host: Q3ApplicationClientHost = {
    identity: { client: identities.client(0, 0), seat: identities.seat(0) }, downloading: false,
    userinfo: () => '', attach() {}, clearActive: () => { clock.clear(); }, systemInfo: async () => {},
    gamestate: initialize, snapshot: value => { snapshots.push(value); clock.publish(value); },
    print() {}, mapRestart() {}, command: () => { throw new Error('Demo must not sample physical input'); },
    disconnected: () => { throw new Error('Demo completion is not a network disconnect'); },
    downloadSize: () => { throw new Error('Unexpected download'); }, download: async () => { throw new Error('Unexpected download'); },
  };
  const reader = new DemoReader(bytes), playback = new Q3DemoPlayback({ host, clock, reader });
  return { playback, reader, snapshots, clock };
}

test('Q3 demo primes gamestate without a channel and brackets one clock target across multiple records', async () => {
  const { playback, snapshots, clock } = fixture(recording([[gamestate], [snapshot(1000)], [{ kind: 'nop' }], [snapshot(1025)], [snapshot(1075)], [snapshot(1150)]]));
  const advance = spyOn(clock, 'advance');
  try {
    expect(await playback.prime(5000)).toBeNull(); expect(playback.phase).toBe('primed');
    expect(playback.connection.channel).toBeNull(); expect(playback.connection.mode.kind).toBe('demo');
    expect(snapshots).toHaveLength(0);
    expect(await playback.advanceFrame(5000, { ...frameOptions, timedemo: true })).toEqual({ kind: 'pending' });
    expect(advance).not.toHaveBeenCalled();
    expect(await playback.advanceFrame(5010, { ...frameOptions, timedemo: true })).toEqual({ kind: 'frame', serverTime: 1050 });
    expect(snapshots.map(value => value.serverTime)).toEqual([1000, 1025, 1075]);
    expect(advance).toHaveBeenCalledTimes(1); expect(clock.demoTiming(5020)).toEqual({ frames: 1, elapsedMilliseconds: 10 });
    expect(await playback.advanceFrame(5020, { ...frameOptions, timedemo: true })).toEqual({ kind: 'frame', serverTime: 1100 });
    expect(advance).toHaveBeenCalledTimes(2); expect(snapshots.at(-1)?.serverTime).toBe(1150);
    const end = await playback.advanceFrame(5030, { ...frameOptions, timedemo: true });
    expect(end.kind).toBe('end'); if (end.kind !== 'end') throw new Error('Missing demo end');
    expect(end.end.reason).toBe('terminator'); expect(end.timing).toEqual({ frames: 3, elapsedMilliseconds: 20 });
    expect(playback.phase).toBe('ended'); expect(playback.connection.commands.currentNumber).toBe(0);
  } finally { advance.mockRestore(); playback.close(); }
});

test('combined initial gamestate and snapshot skip then read before establishing the demo clock', async () => {
  for (const timedemo of [false, true]) {
  const { playback, clock } = fixture(recording([[gamestate, snapshot(1000)], [snapshot(1100)], [snapshot(1200)]]));
  await playback.prime(100);
  expect(playback.phase).toBe('primed');
  const advance = spyOn(clock, 'advance');
  try {
    expect(await playback.advanceFrame(100, { ...frameOptions, timedemo })).toEqual({ kind: 'pending' });
    expect(advance).not.toHaveBeenCalled();
    expect(await playback.advanceFrame(150, { ...frameOptions, timedemo })).toEqual({ kind: 'frame', serverTime: timedemo ? 1150 : 1100 });
    expect(advance).toHaveBeenCalledTimes(1);
    expect(playback.connection.history.latest?.serverTime).toBe(1200);
  } finally { advance.mockRestore(); playback.close(); }
  }
});

test('a later gamestate resets activation and bases the next clock after its primed read', async () => {
  const { playback, clock } = fixture(recording([[gamestate], [snapshot(1000)], [snapshot(1100)],
    [gamestate, snapshot(2000)], [snapshot(2100)], [snapshot(2200)]]));
  await playback.prime(100); await playback.advanceFrame(100, frameOptions);
  const advance = spyOn(clock, 'advance');
  try {
    expect(await playback.advanceFrame(150, frameOptions)).toEqual({ kind: 'frame', serverTime: 1000 });
    expect(await playback.advanceFrame(250, frameOptions)).toEqual({ kind: 'pending' });
    expect(playback.phase).toBe('primed'); expect(advance).toHaveBeenCalledTimes(2);
    expect(await playback.advanceFrame(300, frameOptions)).toEqual({ kind: 'frame', serverTime: 2100 });
    expect(advance).toHaveBeenCalledTimes(3); expect(playback.connection.history.latest?.serverTime).toBe(2200);
  } finally { advance.mockRestore(); playback.close(); }
});

test('normal and frozen demo frames retain target time without reading ahead', async () => {
  const { playback, reader } = fixture(recording([[gamestate], [snapshot(1000)], [snapshot(1100)], [snapshot(1200)]]));
  await playback.prime(100); await playback.advanceFrame(100, frameOptions);
  expect(await playback.advanceFrame(150, frameOptions)).toEqual({ kind: 'frame', serverTime: 1000 });
  const offset = reader.offset;
  expect(await playback.advanceFrame(250, { ...frameOptions, freezeDemo: true })).toEqual({ kind: 'frame', serverTime: 1000 });
  expect(reader.offset).toBe(offset);
  expect(await playback.advanceFrame(250, frameOptions)).toEqual({ kind: 'frame', serverTime: 1100 });
  expect(reader.offset).toBeGreaterThan(offset); playback.close();
});

test('EOF and truncated framing preserve distinct completion reasons and sequence publication', async () => {
  for (const [bytes, reason, sequence] of [[new Uint8Array(), 'eof', 0], [new Uint8Array([7, 0, 0, 0]), 'truncated-header', 7],
    [new Uint8Array([8, 0, 0, 0, 4, 0, 0, 0, 1]), 'truncated-payload', 8]] satisfies readonly (readonly [Uint8Array, DemoEnd['reason'], number])[]) {
    const { playback } = fixture(bytes);
    expect(await playback.prime(0)).toEqual({ kind: 'end', reason, offset: 0 });
    expect(playback.connection.serverMessageSequence).toBe(sequence); playback.close();
    await expect(playback.advanceFrame(0, frameOptions)).rejects.toThrow('retired');
  }
});

test('retirement during gamestate preparation blocks continuation and overlapping readers', async () => {
  const started = Promise.withResolvers<void>(), loaded = Promise.withResolvers<void>();
  const { playback } = fixture(recording([[gamestate], [snapshot(1000)]]), async () => { started.resolve(); await loaded.promise; });
  const priming = playback.prime(0); await started.promise;
  await expect(playback.advanceFrame(0, frameOptions)).rejects.toThrow('already in progress');
  playback.close(); loaded.resolve(); await expect(priming).rejects.toThrow('retired');
  expect(playback.phase).toBe('closed');
});

test('recorded disconnect remains a server command error, not successful EOF', async () => {
  const { playback } = fixture(recording([[gamestate, { kind: 'command', sequence: 1, text: 'disconnect "recorded reason"' }]]));
  await playback.prime(0);
  await expect(playback.connection.getServerCommand(1)).rejects.toThrow('recorded reason');
  expect(playback.phase).toBe('primed'); playback.close();
});
