import { test, expect } from 'bun:test';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { GtvConnection } from '../../../src/network/q2/gtv-transport.ts';
import { GtvServerStream, readGtvRequest } from '../../../src/network/q2/gtv.ts';
import { MvdMessageFramer, mvdMagic } from '../../../src/network/q2/mvd-recording.ts';
import { GtvServerOpT } from '../../../src/network/q2/codecs/mvd.ts';
test('contained TCP GTV handshake authenticates, streams compressed payload and retires socket', async () => {
    const peers = new Set<Socket>(), streams: GtvServerStream[] = [];
    let authenticated = false, resolveData: ((bytes: Uint8Array) => void) | null = null, rejectData: ((error: Error) => void) | null = null;
    const data = new Promise<Uint8Array>((resolve, reject) => { resolveData = resolve; rejectData = reject; });
    const server = createServer(socket => {
        peers.add(socket); socket.on('close', () => { peers.delete(socket); }); socket.on('error', () => {});
        const frames = new MvdMessageFramer(true, 256), stream = new GtvServerStream(); streams.push(stream);
        let processing = Promise.resolve();
        socket.on('data', (bytes: Uint8Array) => {
            const before = frames.identified;
            frames.push(bytes, payload => {
                const request = readGtvRequest(payload);
                processing = processing.then(async () => {
                    if (request.kind === 'hello') { authenticated = request.hello.username === 'viewer' && request.hello.password === 'test-local'; if (!authenticated) throw new Error('Rejected GTV identity'); socket.write(stream.hello(request.hello.flags & 3)); }
                    else if (request.kind === 'start') {
                        if (!authenticated) throw new Error('Unauthenticated start');
                        socket.write(await stream.message(GtvServerOpT.GTS_STREAM_START));
                        socket.write(await stream.message(GtvServerOpT.GTS_STREAM_DATA, Uint8Array.of(6, 0, 255, 0, 0)));
                    }
                }).catch((error: unknown) => { rejectData?.(error instanceof Error ? error : new Error('Server failed')); });
            });
            if (!before && frames.identified) socket.write(mvdMagic());
        });
    });
    let connection: GtvConnection | null = null;
    try {
        await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
        const address = server.address(); if (address === null || typeof address === 'string') throw new Error('Missing loopback address');
        connection = await GtvConnection.connect({ host: '127.0.0.1', port: address.port, identity: { username: 'viewer', password: 'test-local', version: 'fixture' }, timeoutMilliseconds: 1000, event: event => { if (event.kind === 'data') resolveData?.(event.bytes); else if (event.kind === 'closed') rejectData?.(new Error(event.reason)); } });
        connection.start(); expect(await data).toEqual(Uint8Array.of(6, 0, 255, 0, 0)); expect(authenticated).toBe(true);
    } finally {
        connection?.close();
        await Promise.all([...peers].map(peer => new Promise<void>(resolve => { peer.once('close', () => resolve()); peer.destroy(); })));
        for (const stream of streams) stream.close();
        await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); });
    }
    expect(peers.size).toBe(0);
}, 3000);
