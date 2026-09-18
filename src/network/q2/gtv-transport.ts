import { Socket } from 'node:net';
import { GtvClient } from './gtv.ts';
import type { GtvEvent, GtvIdentity } from './gtv.ts';
export interface GtvConnectionOptions {
    readonly host: string; readonly port: number; readonly identity: GtvIdentity;
    readonly signal?: AbortSignal; readonly timeoutMilliseconds?: number;
    event(event: GtvEvent): Promise<void> | void;
}
/** Owns one TCP socket and one ordered GTV dictionary for its entire connection. */
export class GtvConnection {
    private readonly socket = new Socket();
    private readonly client: GtvClient;
    private closed = false;
    private opened = false;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private resolveReady: (() => void) | null = null;
    private rejectReady: ((error: Error) => void) | null = null;
    private processing: Promise<void> = Promise.resolve();
    private readonly abort = (): void => { this.fail(new Error('GTV connection cancelled')); };
    private constructor(private readonly options: GtvConnectionOptions) {
        this.client = new GtvClient(bytes => {
            if (this.closed) throw new Error('GTV connection closed');
            if (this.socket.writableLength + bytes.length > 65536) throw new Error('GTV send queue overflow');
            this.socket.write(bytes);
        }, options.identity);
        this.socket.on('connect', () => { this.client.start(); });
        this.socket.on('data', (bytes: Uint8Array) => {
            this.socket.pause();
            const owned = bytes.slice();
            this.processing = this.processing.then(async () => {
                if (this.closed) return;
                for (const event of await this.client.receive(owned)) {
                    if (event.kind === 'hello') { this.opened = true; this.pingTimer = setInterval(() => { if (!this.closed) { try { this.client.ping(); } catch { this.fail(new Error('GTV keepalive failed')); } } }, 60000); this.resolveReady?.(); this.resolveReady = null; this.rejectReady = null; }
                    await this.options.event(event);
                    if (event.kind === 'closed') { this.close(); break; }
                }
                if (!this.closed) this.socket.resume();
            }).catch((error: unknown) => { this.fail(error instanceof Error ? error : new Error('GTV receive failed')); });
        });
        this.socket.on('error', () => { this.fail(new Error('GTV transport failed')); });
        this.socket.on('end', () => { void this.processing.finally(() => { this.fail(new Error('GTV peer ended stream')); }); });
        this.socket.on('close', () => { if (!this.closed) this.fail(new Error('GTV transport closed')); });
        this.socket.on('timeout', () => { this.fail(new Error('GTV transport timed out')); });
    }
    static async connect(options: GtvConnectionOptions): Promise<GtvConnection> {
        const timeout = options.timeoutMilliseconds ?? 90000;
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535 || options.host.length === 0 || !Number.isSafeInteger(timeout) || timeout < 1) throw new RangeError('Invalid GTV endpoint or timeout');
        const connection = new GtvConnection(options);
        await new Promise<void>((resolve, reject) => {
            connection.resolveReady = resolve; connection.rejectReady = reject;
            options.signal?.addEventListener('abort', connection.abort, { once: true });
            if (options.signal?.aborted) { connection.abort(); return; }
            connection.socket.setTimeout(timeout); connection.socket.setNoDelay(true);
            try { connection.socket.connect(options.port, options.host); }
            catch { connection.fail(new Error('GTV connection failed')); }
        });
        return connection;
    }
    start(maxBufferedPackets = 10): void { this.client.requestStart(maxBufferedPackets); }
    stop(): void { this.client.requestStop(); }
    command(text: string): void { this.client.command(text); }
    ping(): void { this.client.ping(); }
    private fail(error: Error): void {
        if (this.closed) return;
        const opened = this.opened;
        this.rejectReady?.(error); this.rejectReady = null; this.resolveReady = null;
        this.close();
        if (opened) void Promise.resolve(this.options.event({ kind: 'closed', reason: error.message })).catch(() => {});
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.pingTimer !== null) clearInterval(this.pingTimer); this.pingTimer = null;
        this.client.close(); this.socket.destroy();
        this.options.signal?.removeEventListener('abort', this.abort);
        this.rejectReady?.(new Error('GTV connection closed')); this.rejectReady = null; this.resolveReady = null;
    }
}
