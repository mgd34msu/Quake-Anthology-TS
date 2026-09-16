import { expect, test } from 'bun:test';
import { openArchive } from '../../../src/content/archive/index.ts';
import { existsSync } from 'node:fs';
import { Q2WireCodec, PlayerStateT, encodeQ2ServerEvent, encodeQ2Frame } from '../../../src/network/q2/index.ts';
import type { Q2WireFrame, EntityStateT } from '../../../src/network/q2/index.ts';
import { writeQ2DemoRecord, finishQ2Demo } from '../../../src/network/q2/demo.ts';
import { Q2ClientReceiver, type Q2ClientReceiverHost } from '../../../src/app/bootstrap/network/q2-client-receiver.ts';
import { Q2DemoPlayback } from '../../../src/app/bootstrap/network/q2-demo.ts';
const wire = new Q2WireCodec({ kind: 'q2-classic', version: 34 });
function join(parts: readonly Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; }
function command(text: string): Uint8Array { return encodeQ2ServerEvent(wire, { kind: 'command-text', text }); }
function preamble(): Uint8Array { return join([
    encodeQ2ServerEvent(wire, { kind: 'server-data', data: { servercount: 42, attractloop: true, gamedir: 'baseq2', clientnum: 0, levelname: 'base1', serverState: 2 } }),
    encodeQ2ServerEvent(wire, { kind: 'config-string', index: 33, value: 'maps/base1.bsp' }),
]); }
function frame(n: number, old: Q2WireFrame | null = null): Uint8Array {
    const value: Q2WireFrame = { serverFrame: n, deltaFrame: old?.serverFrame ?? -1, suppressedCount: 0, areaBits: new Uint8Array(), player: new PlayerStateT(), entities: [] };
    return encodeQ2Frame(wire, value, old, new Map<number, EntityStateT>(), 1);
}
function host(overrides: Partial<Q2ClientReceiverHost> = {}): Q2ClientReceiverHost {
    return { protocol: { kind: 'q2-classic', version: 34 }, messageOptions: { maxConfigStrings: 2080, inventorySlots: 256 },
        gameState: async () => {}, frame: () => {}, records: () => {}, disconnected: () => {}, print: () => {}, ...overrides };
}
function demo(blocks: readonly Uint8Array[]): Uint8Array { return join([...blocks.map(writeQ2DemoRecord), finishQ2Demo()]); }

test('bare precache prepares map; pacing spans blocks and exposes final frame before EOF', async () => {
    const events: string[] = [], times: number[] = [];
    const playback = new Q2DemoPlayback(demo([preamble(), command('precache\n'), command('echo recorded\n'), frame(100), frame(101), frame(102)]), host({
        gameState: async state => { expect(state.configStrings.get(33)).toBe('maps/base1.bsp'); events.push('ready'); },
        frame: (_frame, _records, time) => { events.push('frame'); times.push(time); }, records: () => { events.push('records'); },
    }));
    expect(await playback.advance(10000)).toEqual({ kind: 'frame', timeMilliseconds: 10100 });
    expect(times).toEqual([10000, 10100]); expect(events.indexOf('ready')).toBeLessThan(events.indexOf('frame'));
    expect(events.slice(-2)).toEqual(['frame', 'records']); expect(playback.receiver.phase).toBe('active');
    expect(await playback.advance(99999)).toEqual({ kind: 'frame', timeMilliseconds: 10200 });
    expect(await playback.advance(99999)).toEqual({ kind: 'eof' });
    playback.close(); expect(await playback.nextFrame()).toEqual({ kind: 'closed' });
});

test('live precache retains count validation, download preparation, paging replies and begin', async () => {
    const commands: string[] = []; let ready = 0, resets = 0, downloading = true;
    const receiver = new Q2ClientReceiver(host({ gameState: async () => { ready++; } }), { kind: 'network', closed: () => false,
        command: text => { commands.push(text); }, resetCommands: () => { resets++; },
        downloads: { setHttpServer: () => {}, prepare: async () => downloading ? 'waiting' : 'ready', receive: () => { downloading = false; return 'complete'; }, close: () => {} },
    });
    await receiver.receive(preamble(), 1); expect(resets).toBe(1);
    await expect(receiver.receive(command('precache\n'), 1)).rejects.toThrow('signon number');
    await expect(receiver.receive(command('precache 41\n'), 1)).rejects.toThrow('another server generation');
    await receiver.receive(command('cmd configstrings 42 0\ncmd baselines 42 0\nprecache 42\n'), 2);
    expect(ready).toBe(0); expect(receiver.phase).toBe('loading');
    await receiver.receive(encodeQ2ServerEvent(wire, { kind: 'download', percent: 100, bytes: new Uint8Array() }), 3);
    expect(ready).toBe(1); expect(commands).toEqual(['configstrings 42 0', 'baselines 42 0', 'begin 42']);
    expect(receiver.phase).toBe('active'); receiver.close();
});

for (const boundary of ['serverData', 'gameState']) test(`closing during ${boundary} rejects stale delivery`, async () => {
    let release: (() => void) | undefined, entered: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let records = 0, frames = 0;
    const wait = async (): Promise<void> => { entered?.(); await gate; };
    const playback = new Q2DemoPlayback(demo([preamble(), command('precache\n'), frame(1)]), host({
        ...(boundary === 'serverData' ? { serverData: wait } : { gameState: wait }),
        records: () => { records++; }, frame: () => { frames++; },
    }));
    const task = playback.nextFrame(); await started; const before = records; playback.close(); release?.();
    await expect(task).rejects.toThrow('retired'); expect(records).toBe(before); expect(frames).toBe(0);
});

test('live external transport closure cancels asynchronous directory selection', async () => {
    let closed = false;
    const receiver = new Q2ClientReceiver(host({ serverData: async (_data, assertCurrent) => { closed = true; assertCurrent(); } }),
        { kind: 'network', command: () => {}, resetCommands: () => {}, closed: () => closed });
    await expect(receiver.receive(preamble(), 0)).rejects.toThrow('retired');
});

test('invalid delta does not advance time; nextFrame skips metadata', async () => {
    const missing: Q2WireFrame = { serverFrame: 99, deltaFrame: -1, suppressedCount: 0, areaBits: new Uint8Array(), player: new PlayerStateT(), entities: [] };
    const times: number[] = [];
    const playback = new Q2DemoPlayback(demo([preamble(), command('precache\n'), frame(100, missing), command('echo gap\n'), frame(101), frame(102)]), host({ frame: value => { times.push(value.serverFrame); } }));
    expect(await playback.nextFrame()).toEqual({ kind: 'frame', timeMilliseconds: 10100 });
    expect(times).toEqual([101]); expect(await playback.nextFrame()).toEqual({ kind: 'frame', timeMilliseconds: 10200 }); playback.close();
});

test('truncated headers, payloads and invalid codec bytes reject rather than report EOF', async () => {
    for (const bytes of [new Uint8Array([1]), new Uint8Array([5, 0, 0, 0, 1]), demo([new Uint8Array([254])])]) {
        const playback = new Q2DemoPlayback(bytes, host()); await expect(playback.nextFrame()).rejects.toThrow(); playback.close();
    }
});

const recording = '/home/buzzkill/Projects/qfiles/q2/ctf/demos/2014-01-07-2001-lfctf1.dm2';
(existsSync(recording) ? test : test.skip)('installed protocol34 recording prepares bare precache and advances through its actual EOF', async () => {
    const frameTimes: number[] = [];
    const bytes = await Bun.file(recording).bytes(); let maps = 0, frames = 0, last = -1, bare = 0;
    const playback = new Q2DemoPlayback(bytes, host({
        gameState: async state => { expect(state.configStrings.get(33)).toBe('maps/lfctf1.bsp'); maps++; },
        frame: (_frame, _records, time) => { expect(time).toBeGreaterThanOrEqual(last); frameTimes.push(time); last = time; frames++; },
        records: records => { for (const record of records) if (record.event.kind === 'command-text' && record.event.text.trim() === 'precache') bare++; },
    }));
    while ((await playback.nextFrame()).kind === 'frame') {}
    expect(maps).toBe(1); expect(bare).toBe(1); expect(frames).toBe(95); expect(frameTimes[0]).toBe(44400); expect(last).toBe(53800);
    expect(playback.consumedBytes).toBe(bytes.length); playback.close();
});

test('recorded disconnect is distinct from EOF and preserves its final frame without live failure callbacks', async () => {
    let failures = 0; const frames: number[] = [], prints: string[] = [], records: string[] = [];
    const finalBlock = join([frame(5), encodeQ2ServerEvent(wire, { kind: 'disconnect' }), encodeQ2ServerEvent(wire, { kind: 'print', level: 0, text: 'after-disconnect' })]);
    const blocks = [preamble(), command('precache\n'), finalBlock];
    const bytes = join([...blocks.map(writeQ2DemoRecord), new Uint8Array([5, 0, 0, 0, 1])]);
    const playback = new Q2DemoPlayback(bytes, host({ disconnected: () => { failures++; }, frame: value => { frames.push(value.serverFrame); },
        print: text => { prints.push(text); }, records: values => { records.push(...values.map(value => value.event.kind)); },
    }));
    expect(await playback.advance(10000)).toEqual({ kind: 'frame', timeMilliseconds: 500 });
    expect(await playback.nextFrame()).toEqual({ kind: 'disconnected' });
    expect(await playback.advance(10000)).toEqual({ kind: 'disconnected' });
    expect(failures).toBe(0); expect(frames).toEqual([5]); expect(prints).toEqual([]);
    expect(records.at(-1)).toBe('disconnect'); expect(playback.consumedBytes).toBe(bytes.length - 5);
    playback.close();
});

test('disconnect after an already presented frame does not present it twice; live disconnect still notifies host', async () => {
    const bytes = demo([preamble(), command('precache\n'), frame(7), encodeQ2ServerEvent(wire, { kind: 'disconnect' })]);
    const playback = new Q2DemoPlayback(bytes, host());
    expect(await playback.nextFrame()).toEqual({ kind: 'frame', timeMilliseconds: 700 });
    expect(await playback.nextFrame()).toEqual({ kind: 'disconnected' }); playback.close();
    let reason = '';
    const receiver = new Q2ClientReceiver(host({ disconnected: value => { reason = value; } }), { kind: 'network', closed: () => false, command: () => {}, resetCommands: () => {} });
    await receiver.receive(encodeQ2ServerEvent(wire, { kind: 'disconnect' }), 0);
    expect(receiver.phase).toBe('closed'); expect(reason).toBe('Server disconnected'); expect(receiver.disconnectedDemo).toBe(false);
});

test('EOF byte offset includes only a consumed sentinel and excludes trailing bytes', async () => {
    const body = join([writeQ2DemoRecord(preamble()), writeQ2DemoRecord(command('precache\n')), writeQ2DemoRecord(frame(1))]);
    for (const suffix of [new Uint8Array(), finishQ2Demo(), join([finishQ2Demo(), new Uint8Array([99, 98, 97])])]) {
        const playback = new Q2DemoPlayback(join([body, suffix]), host());
        expect(await playback.advance(10000)).toEqual({ kind: 'frame', timeMilliseconds: 100 });
        expect(await playback.nextFrame()).toEqual({ kind: 'eof' });
        expect(playback.consumedBytes).toBe(body.length + (suffix.length === 0 ? 0 : 4)); playback.close();
    }
});

test('corrupt records inside a disconnect block remain decoder errors', async () => {
    const playback = new Q2DemoPlayback(demo([join([encodeQ2ServerEvent(wire, { kind: 'disconnect' }), new Uint8Array([254])])]), host());
    await expect(playback.nextFrame()).rejects.toThrow();
    await expect(playback.nextFrame()).rejects.toThrow(); playback.close();
});

test('receiver source overrides host readMode for both network and demo', async () => {
    const bytes = preamble(); new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(1, 26, true);
    const network = new Q2ClientReceiver(host({ messageOptions: { readMode: 'demo', maxConfigStrings: 2080, inventorySlots: 256 } }),
        { kind: 'network', closed: () => false, command: () => {}, resetCommands: () => {} });
    await expect(network.receive(bytes, 0)).rejects.toThrow('protocol 26 differs from negotiated 34'); network.close();
    const recorded = new Q2ClientReceiver(host({ messageOptions: { readMode: 'network', maxConfigStrings: 2080, inventorySlots: 256 } }), { kind: 'demo' });
    await recorded.receive(bytes, 0); await recorded.receive(command('precache\n'), 0);
    expect(recorded.phase).toBe('active'); recorded.close();
});

const retailPak = '/home/buzzkill/Projects/qfiles/q2/baseq2/pak0.pak';
test.skipIf(!existsSync(retailPak))('bundled protocol26 demo reaches world preparation and every recorded frame before EOF', async () => {
    const archive = await openArchive(retailPak);
    try {
        const entry = archive.findEntries('demos/demo1.dm2')[0]; if (entry === undefined) throw new Error('Retail Q2 demo1 missing');
        const frameTimes: number[] = [];
        const bytes = await archive.readEntry(entry); let worlds = 0, frames = 0, last = -1, bare = 0, disconnects = 0;
        const order: string[] = [];
        const playback = new Q2DemoPlayback(bytes, host({
            gameState: async state => { expect(state.configStrings.get(33)).toBe('maps/base2.bsp'); expect(state.configStrings.size).toBe(331); worlds++; order.push('world'); },
            frame: (_frame, _records, time) => { expect(time).toBeGreaterThan(last); frameTimes.push(time); last = time; frames++; order.push('frame'); },
            records: records => { for (const record of records) if (record.event.kind === 'command-text' && record.event.text.trim() === 'precache') bare++; },
            disconnected: () => { disconnects++; },
        }));
        let result = await playback.nextFrame();
        while (result.kind === 'frame') result = await playback.nextFrame();
        expect(result).toEqual({ kind: 'eof' }); expect(worlds).toBe(1); expect(bare).toBe(1); expect(frames).toBe(688);
        expect(frameTimes[0]).toBe(19500); expect(last).toBe(88200); expect(order[0]).toBe('world'); expect(disconnects).toBe(0);
        expect(playback.receiver.phase).toBe('active'); expect(playback.consumedBytes).toBe(bytes.length);
        playback.close(); expect(await playback.nextFrame()).toEqual({ kind: 'closed' });
    } finally { await archive.close(); }
});

test('recorded new world resets its clock before consuming the next map tail', async () => {
 const playback=new Q2DemoPlayback(demo([preamble(),command('precache\n'),frame(100),preamble(),command('precache\n'),frame(1),frame(2)]),host());
 try {
  expect(await playback.nextFrame()).toEqual({kind:'frame',timeMilliseconds:10000});
  expect(await playback.advance(10050)).toEqual({kind:'frame',timeMilliseconds:100});
  expect(await playback.advance(150)).toEqual({kind:'frame',timeMilliseconds:200});
 } finally {playback.close();}
});
