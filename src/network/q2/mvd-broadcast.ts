import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { MvdEncoder } from './mvd-encoding.ts';
import type { MvdCapture } from './mvd-encoding.ts';
import { MvdRecording, MvdMessageFramer, mvdMagic, frameMvdMessage } from './mvd-recording.ts';
import { GtvServerStream, readGtvRequest } from './gtv.ts';
import type { GtvClientHello } from './gtv.ts';
import { GtvServerOpT } from './codecs/mvd.ts';
export interface MvdBroadcastOptions {
    authorize(hello: GtvClientHello): boolean;
    command?(text: string): void;
    readonly record?: (bytes: Uint8Array) => void;
    readonly maxViewers?: number;
}
interface Viewer {
    readonly socket: Socket; readonly stream: GtvServerStream; readonly frames: MvdMessageFramer;
    queue: Promise<void>; queuedBytes: number; identified: boolean; authorized: boolean; active: boolean; needsGamestate: boolean; flags: number; closed: boolean; sequence: number;
}
/** Shared authoritative captures feed one recording and every authorized GTV viewer. */
export class MvdBroadcast {
    private readonly encoder = new MvdEncoder();
    private readonly recording: MvdRecording | null;
    private latest: MvdCapture | null = null;
    private sequence = 0;
    private readonly viewers = new Set<Viewer>();
    private listener: Server | null = null;
    private closed = false;
    constructor(private readonly options: MvdBroadcastOptions) {
        if (!Number.isInteger(options.maxViewers ?? 16) || (options.maxViewers ?? 16) < 1) throw new RangeError('Invalid GTV viewer limit');
        this.recording = options.record === undefined ? null : new MvdRecording(options.record);
    }
    observe(capture: MvdCapture): void {
        if (this.closed) throw new Error('MVD producer is closed');
        const packets = this.encoder.capture(capture); this.latest = capture;
        const sequence = ++this.sequence;
        for (const packet of packets) this.recording?.append(packet);
        for (const viewer of this.viewers) {
            if (!viewer.active) continue;
            this.enqueue(viewer, packets.reduce((length, packet) => length + packet.length, 0), async () => {
                if (!viewer.active || sequence <= viewer.sequence) return;
                const messages = viewer.needsGamestate || viewer.sequence + 1 !== sequence ? new MvdEncoder().capture({ ...capture, messages: [] }) : packets;
                for (const bytes of messages) await this.send(viewer, await viewer.stream.message(GtvServerOpT.GTS_STREAM_DATA, bytes));
                viewer.needsGamestate = false; viewer.sequence = sequence;
            });
        }
    }
    async listen(host: string, port: number): Promise<number> {
        if (this.closed || this.listener !== null) throw new Error('GTV listener already owned or closed');
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid GTV port');
        const listener = createServer(socket => { this.attach(socket); }); this.listener = listener;
        await new Promise<void>((resolve, reject) => {
            const error = (failure: Error): void => { listener.removeListener('listening', ready); reject(failure); };
            const ready = (): void => { listener.removeListener('error', error); resolve(); };
            listener.once('error', error); listener.once('listening', ready); listener.listen(port, host);
        });
        const address = listener.address(); if (address === null || typeof address === 'string') throw new Error('GTV listener has no TCP address');
        return address.port;
    }
    private attach(socket: Socket): void {
        if (this.closed || this.viewers.size >= (this.options.maxViewers ?? 16)) { socket.destroy(); return; }
        const viewer: Viewer = { socket, stream: new GtvServerStream(), frames: new MvdMessageFramer(true, 256), queue: Promise.resolve(), queuedBytes: 0, identified: false, authorized: false, active: false, needsGamestate: true, flags: 0, closed: false, sequence: 0 };
        this.viewers.add(viewer); socket.setTimeout(90000); socket.setNoDelay(true);
        socket.on('error', () => { this.retire(viewer); }); socket.on('timeout', () => { this.retire(viewer); }); socket.on('close', () => { this.retire(viewer); });
        socket.on('data', (bytes: Uint8Array) => {
            try {
                viewer.frames.push(bytes, payload => {
                    this.enqueue(viewer, payload.length, async () => {
                        const request = readGtvRequest(payload);
                        if (request.kind === 'hello') {
                            if (viewer.authorized) throw new Error('Duplicate GTV hello');
                            if (!this.options.authorize(request.hello)) { await this.send(viewer, frameMvdMessage(Uint8Array.of(GtvServerOpT.GTS_NOACCESS))); this.retire(viewer); return; }
                            viewer.flags = request.hello.flags & (this.options.command === undefined ? 1 : 3);
                            await this.send(viewer, viewer.stream.hello(viewer.flags)); viewer.authorized = true;
                        } else {
                            if (!viewer.authorized) throw new Error('GTV request before authorization');
                            switch (request.kind) {
                                case 'ping': await this.send(viewer, await viewer.stream.message(GtvServerOpT.GTS_PONG)); break;
                                case 'start':
                                    if (viewer.active) throw new Error('GTV already streaming');
                                    viewer.active = true; viewer.needsGamestate = true;
                                    await this.send(viewer, await viewer.stream.message(GtvServerOpT.GTS_STREAM_START));
                                    if (this.latest !== null) {
                                        const initial = this.latest, sequence = this.sequence;
                                        for (const packet of new MvdEncoder().capture({ ...initial, messages: [] })) await this.send(viewer, await viewer.stream.message(GtvServerOpT.GTS_STREAM_DATA, packet));
                                        viewer.needsGamestate = false; viewer.sequence = sequence;
                                    } else await this.send(viewer, await viewer.stream.message(GtvServerOpT.GTS_STREAM_DATA));
                                    break;
                                case 'stop':
                                    if (!viewer.active) throw new Error('GTV is not streaming');
                                    viewer.active = false; await this.send(viewer, await viewer.stream.message(GtvServerOpT.GTS_STREAM_STOP)); break;
                                case 'command': if (viewer.flags & 2) this.options.command?.(request.text); break;
                            }
                        }
                    });
                });
                if (!viewer.identified && viewer.frames.identified) { viewer.identified = true; socket.write(mvdMagic()); }
                if (viewer.frames.finished) this.retire(viewer);
            } catch { this.retire(viewer); }
        });
    }
    private enqueue(viewer: Viewer, bytes: number, action: () => Promise<void>): void {
        viewer.queuedBytes += bytes;
        if (viewer.queuedBytes > 1024 * 1024) { this.retire(viewer); return; }
        viewer.queue = viewer.queue.then(async () => { if (!viewer.closed) await action(); }).catch(() => { this.retire(viewer); }).finally(() => { viewer.queuedBytes -= bytes; });
    }
    private send(viewer: Viewer, bytes: Uint8Array): Promise<void> {
        if (viewer.closed) return Promise.reject(new Error('GTV viewer retired'));
        return new Promise<void>((resolve, reject) => { viewer.socket.write(bytes, error => { if (error) reject(error); else resolve(); }); });
    }
    private retire(viewer: Viewer): void {
        if (viewer.closed) return;
        viewer.closed = true; viewer.stream.close(); viewer.socket.destroy(); this.viewers.delete(viewer);
    }
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true; this.recording?.close();
        const viewers = [...this.viewers];
        for (const viewer of viewers) this.retire(viewer);
        await Promise.all(viewers.map(viewer => viewer.queue));
        const listener = this.listener; this.listener = null;
        if (listener !== null) await new Promise<void>((resolve, reject) => { listener.close(error => { if (error && listener.listening) reject(error); else resolve(); }); });
    }
}
