import { test, expect } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { GtvClient, GtvServerStream, readGtvRequest } from '../../../src/network/q2/gtv.ts';
import type { GtvEvent } from '../../../src/network/q2/gtv.ts';
import { GtvServerOpT } from '../../../src/network/q2/codecs/mvd.ts';
import { mvdMagic, MvdMessageFramer } from '../../../src/network/q2/mvd-recording.ts';
function join(...chunks: readonly Uint8Array[]): Uint8Array {
    const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0)); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
test('GTV magic, hello transition and persistent compression across fragmented packets', async () => {
    const sent: Uint8Array[] = [], client = new GtvClient(bytes => { sent.push(bytes); }, { username: 'viewer', password: 'secret', version: 'test' });
    const server = new GtvServerStream();
    try {
        client.start(); expect(sent.shift()).toEqual(mvdMagic());
        for (const byte of mvdMagic()) await client.receive(Uint8Array.of(byte));
        const requests: ReturnType<typeof readGtvRequest>[] = [], framer = new MvdMessageFramer(false, 256);
        framer.push(sent.shift() ?? new Uint8Array(), bytes => { requests.push(readGtvRequest(bytes)); });
        expect(requests).toEqual([{ kind: 'hello', hello: { username: 'viewer', password: 'secret', version: 'test', flags: 3 } }]);
        const hello = server.hello(3), pong = await server.message(GtvServerOpT.GTS_PONG);
        expect(await client.receive(join(hello, pong))).toEqual([{ kind: 'hello', flags: 3 }, { kind: 'pong' }]);
        client.requestStart();
        const started = await server.message(GtvServerOpT.GTS_STREAM_START);
        const payload = new TextEncoder().encode('repeated native dictionary payload '.repeat(100));
        const first = await server.message(GtvServerOpT.GTS_STREAM_DATA, payload), second = await server.message(GtvServerOpT.GTS_STREAM_DATA, payload);
        expect(second.length).toBeLessThan(first.length);
        expect(() => inflateSync(second)).toThrow();
        const events: GtvEvent[] = [];
        for (const byte of join(started, first, second)) events.push(...await client.receive(Uint8Array.of(byte)));
        expect(events).toEqual([{ kind: 'started' }, { kind: 'data', bytes: payload }, { kind: 'data', bytes: payload }]);
        expect(await client.receive(await server.message(GtvServerOpT.GTS_STREAM_DATA))).toEqual([{ kind: 'suspended' }]);
        expect(await client.receive(await server.message(GtvServerOpT.GTS_STREAM_DATA, payload))).toEqual([{ kind: 'resumed' }, { kind: 'data', bytes: payload }]);
        client.requestStop();
        expect(await client.receive(await server.message(GtvServerOpT.GTS_STREAM_DATA, payload))).toEqual([]);
        expect(await client.receive(await server.message(GtvServerOpT.GTS_STREAM_STOP))).toEqual([{ kind: 'stopped' }]);
        client.command('status');
    } finally { client.close(); server.close(); }
});
test('GTV refuses unnegotiated commands, malformed lengths and premature data', async () => {
    const client = new GtvClient(() => {}, { username: '', password: '', version: '' }, 0), server = new GtvServerStream();
    try {
        client.start(); await client.receive(mvdMagic()); await client.receive(server.hello(0));
        expect(() => client.command('status')).toThrow('not negotiated');
        await expect(client.receive(await server.message(GtvServerOpT.GTS_STREAM_DATA, Uint8Array.of(1)))).rejects.toThrow('Unexpected');
        expect(() => readGtvRequest(new Uint8Array(257))).toThrow('length');
    } finally { client.close(); server.close(); }
});
