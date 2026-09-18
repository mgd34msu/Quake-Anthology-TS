// q2repro server/mvd.c and server/mvd/client.c: GTV over a reliable byte stream.
import { createDeflate, createInflate, constants } from 'node:zlib';
import { GTV_PROTOCOL_VERSION, GTF_DEFLATE, GTF_STRINGCMDS, GtvClientOpT, GtvServerOpT, MAX_GTC_MSGLEN } from './codecs/mvd.ts';
import { createMessage, loadMessage, checkMessageRead, messageBytes, MSG_ReadByte, MSG_ReadWord, MSG_ReadLong, MSG_ReadString, MSG_WriteShort, MSG_WriteLong, MSG_WriteString } from './message.ts';
import { MvdMessageFramer, frameMvdMessage, mvdMagic, MVD_MAX_MESSAGE } from './mvd-recording.ts';
export interface GtvIdentity { readonly username: string; readonly password: string; readonly version: string; }
export type GtvEvent = { readonly kind: 'hello'; readonly flags: number } | { readonly kind: 'data'; readonly bytes: Uint8Array } | { readonly kind: 'pong' | 'started' | 'stopped' | 'suspended' | 'resumed' } | { readonly kind: 'closed'; readonly reason: string };
function packet(op: number, body: Uint8Array = new Uint8Array(0)): Uint8Array {
    const message = new Uint8Array(body.length + 1); message[0] = op; message.set(body, 1);
    return frameMvdMessage(message);
}
function checkedText(text: string): void {
    if (text.includes('\0') || [...text].some(character => character.charCodeAt(0) > 255)) throw new Error('GTV strings must be non-NUL single-byte text');
}
/** A single zlib stream survives every GTV packet and sync flush. */
class GtvCompression {
    private readonly stream: ReturnType<typeof createDeflate> | ReturnType<typeof createInflate>;
    private readonly chunks: Uint8Array[] = [];
    private failure: Error | null = null;
    private size = 0;
    constructor(private readonly encode: boolean) {
        this.stream = encode ? createDeflate() : createInflate();
        this.stream.on('data', (bytes: unknown) => {
            if (!(bytes instanceof Uint8Array)) { this.failure = new Error('Invalid zlib output'); return; }
            this.size += bytes.length;
            if (this.size > MVD_MAX_MESSAGE * 64) { this.failure = new Error('GTV decompression output limit exceeded'); this.stream.destroy(this.failure); return; }
            this.chunks.push(bytes.slice());
        });
        this.stream.on('error', (error: Error) => { this.failure = error; });
    }
    async push(bytes: Uint8Array): Promise<Uint8Array> {
        if (this.failure !== null) throw this.failure;
        await new Promise<void>((resolve, reject) => { this.stream.write(bytes, error => { if (error) reject(error); else resolve(); }); });
        if (this.encode) await new Promise<void>((resolve, reject) => {
            this.stream.flush(constants.Z_SYNC_FLUSH, () => { if (this.failure !== null) reject(this.failure); else resolve(); });
        });
        if (this.failure !== null) throw this.failure;
        const result = new Uint8Array(this.size); let offset = 0;
        for (const chunk of this.chunks) { result.set(chunk, offset); offset += chunk.length; }
        this.chunks.length = 0; this.size = 0;
        return result;
    }
    close(): void { this.stream.destroy(); }
}
export class GtvClient {
    private phase: 'magic' | 'hello' | 'connected' | 'starting' | 'reading' | 'waiting' | 'stopping' | 'closed' = 'magic';
    private magic = new Uint8Array(0);
    private readonly frames = new MvdMessageFramer(false);
    private compression: GtvCompression | null = null;
    private flags = 0;
    private busy = false;
    private started = false;
    constructor(private readonly send: (bytes: Uint8Array) => void, private readonly identity: GtvIdentity, private readonly requestedFlags = GTF_DEFLATE | GTF_STRINGCMDS) {
        for (const value of [identity.username, identity.password, identity.version]) checkedText(value);
    }
    start(): void { if (this.started || this.phase !== 'magic') throw new Error('GTV already started'); this.started = true; this.send(mvdMagic()); }
    requestStart(maxBufferedPackets = 10): void {
        if (this.phase !== 'connected') throw new Error('GTV is not ready to start');
        if (!Number.isInteger(maxBufferedPackets) || maxBufferedPackets < 0 || maxBufferedPackets > 65535) throw new RangeError('Invalid GTV buffering request');
        const body = new Uint8Array(2); new DataView(body.buffer).setUint16(0, maxBufferedPackets, true);
        this.send(packet(GtvClientOpT.GTC_STREAM_START, body)); this.phase = 'starting';
    }
    requestStop(): void {
        if (this.phase !== 'reading' && this.phase !== 'waiting') throw new Error('GTV is not streaming');
        this.send(packet(GtvClientOpT.GTC_STREAM_STOP)); this.phase = 'stopping';
    }
    ping(): void { this.connected(); this.send(packet(GtvClientOpT.GTC_PING)); }
    command(text: string): void {
        this.connected(); checkedText(text);
        if (!(this.flags & GTF_STRINGCMDS)) throw new Error('GTV command forwarding was not negotiated');
        const message = createMessage(MAX_GTC_MSGLEN); MSG_WriteString(message, text.slice(0, 150));
        this.send(packet(GtvClientOpT.GTC_STRINGCMD, messageBytes(message)));
    }
    private connected(): void { if (this.phase === 'magic' || this.phase === 'hello' || this.phase === 'closed') throw new Error('GTV is not connected'); }
    async receive(input: Uint8Array): Promise<readonly GtvEvent[]> {
        if (!this.started) throw new Error('GTV was not started');
        if (this.busy) throw new Error('Concurrent GTV receive');
        if (this.phase === 'closed') throw new Error('GTV connection is closed');
        this.busy = true;
        try {
            let bytes = input;
            const events: GtvEvent[] = [];
            if (this.phase === 'magic') {
                const count = Math.min(4 - this.magic.length, bytes.length), combined = new Uint8Array(this.magic.length + count);
                combined.set(this.magic); combined.set(bytes.subarray(0, count), this.magic.length); this.magic = combined; bytes = bytes.subarray(count);
                if (combined.length !== 4) return events;
                if (!combined.every((byte, index) => byte === mvdMagic()[index])) throw new Error('Not a GTV server');
                const message = createMessage(MAX_GTC_MSGLEN);
                MSG_WriteShort(message, GTV_PROTOCOL_VERSION); MSG_WriteLong(message, this.requestedFlags); MSG_WriteLong(message, 0);
                MSG_WriteString(message, this.identity.username); MSG_WriteString(message, this.identity.password); MSG_WriteString(message, this.identity.version);
                const hello = packet(GtvClientOpT.GTC_HELLO, messageBytes(message));
                if (hello.length - 2 > MAX_GTC_MSGLEN) throw new Error('GTV identity exceeds message limit');
                this.phase = 'hello'; this.send(hello);
            }
            if (this.compression !== null) bytes = await this.compression.push(bytes);
            let switched = false;
            this.frames.push(bytes, message => {
                const before = this.compression;
                this.consume(message, events);
                switched = before !== this.compression;
                return !switched;
            });
            // Hello itself is plain; even a shared TCP read may switch immediately to zlib.
            if (switched && this.compression !== null) {
                const pending = this.frames.takePending();
                if (pending.length !== 0) this.frames.push(await this.compression.push(pending), message => { this.consume(message, events); });
            }
            if (this.frames.finished) { this.close(); events.push({ kind: 'closed', reason: 'end of stream' }); }
            return events;
        } catch (error) { this.close(); throw error; }
        finally { this.busy = false; }
    }
    private consume(bytes: Uint8Array, events: GtvEvent[]): void {
        const message = createMessage(bytes.length); loadMessage(message, bytes);
        const opcode = MSG_ReadByte(message);
        switch (opcode) {
            case GtvServerOpT.GTS_HELLO:
                if (this.phase !== 'hello') throw new Error('Unexpected GTV hello');
                this.flags = MSG_ReadLong(message);
                if (this.flags & ~this.requestedFlags) throw new Error('Unrequested GTV flags');
                if (this.flags & GTF_DEFLATE) this.compression = new GtvCompression(false);
                this.phase = 'connected'; events.push({ kind: 'hello', flags: this.flags }); break;
            case GtvServerOpT.GTS_STREAM_START:
                if (this.phase !== 'starting') throw new Error('Unexpected GTV start acknowledgement');
                this.phase = 'reading'; events.push({ kind: 'started' }); break;
            case GtvServerOpT.GTS_STREAM_STOP:
                if (this.phase !== 'stopping') throw new Error('Unexpected GTV stop acknowledgement');
                this.phase = 'connected'; events.push({ kind: 'stopped' }); break;
            case GtvServerOpT.GTS_STREAM_DATA:
                if (this.phase === 'stopping') return;
                if (this.phase !== 'reading' && this.phase !== 'waiting') throw new Error('Unexpected GTV stream data');
                if (bytes.length === 1) { this.phase = 'waiting'; events.push({ kind: 'suspended' }); }
                else {
                    if (this.phase === 'waiting') events.push({ kind: 'resumed' });
                    this.phase = 'reading'; events.push({ kind: 'data', bytes: bytes.slice(1) });
                }
                return;
            case GtvServerOpT.GTS_PONG: this.connected(); events.push({ kind: 'pong' }); break;
            case GtvServerOpT.GTS_ERROR: case GtvServerOpT.GTS_BADREQUEST: case GtvServerOpT.GTS_NOACCESS:
            case GtvServerOpT.GTS_DISCONNECT: case GtvServerOpT.GTS_RECONNECT:
                this.close(); events.push({ kind: 'closed', reason: GtvServerOpT[opcode] ?? 'GTV closed' }); break;
            default: throw new Error(`Unknown GTV server opcode ${opcode}`);
        }
        checkMessageRead(message);
        if (message.readcount !== message.cursize) throw new Error('Trailing GTV control bytes');
    }
    close(): void { this.phase = 'closed'; this.compression?.close(); this.compression = null; }
}
export interface GtvClientHello extends GtvIdentity { readonly flags: number; }
export type GtvRequest = { readonly kind: 'hello'; readonly hello: GtvClientHello } | { readonly kind: 'start'; readonly maxBufferedPackets: number } | { readonly kind: 'ping' | 'stop' } | { readonly kind: 'command'; readonly text: string };
/** Server ingress after the mandatory magic echo; client traffic is never compressed. */
export function readGtvRequest(bytes: Uint8Array): GtvRequest {
    if (bytes.length < 1 || bytes.length > MAX_GTC_MSGLEN) throw new RangeError('Invalid GTV client message length');
    const message = createMessage(bytes.length); loadMessage(message, bytes);
    let request: GtvRequest;
    switch (MSG_ReadByte(message)) {
        case GtvClientOpT.GTC_HELLO: {
            if (MSG_ReadWord(message) !== GTV_PROTOCOL_VERSION) throw new Error('Unsupported GTV protocol');
            const flags = MSG_ReadLong(message); MSG_ReadLong(message);
            const username = MSG_ReadString(message), password = MSG_ReadString(message), version = MSG_ReadString(message);
            request = { kind: 'hello', hello: { flags, username, password, version } }; break;
        }
        case GtvClientOpT.GTC_PING: request = { kind: 'ping' }; break;
        case GtvClientOpT.GTC_STREAM_START: request = { kind: 'start', maxBufferedPackets: MSG_ReadWord(message) }; break;
        case GtvClientOpT.GTC_STREAM_STOP: request = { kind: 'stop' }; break;
        case GtvClientOpT.GTC_STRINGCMD: request = { kind: 'command', text: MSG_ReadString(message) }; break;
        default: throw new Error('Unknown GTV client opcode');
    }
    checkMessageRead(message);
    if (message.readcount !== message.cursize) throw new Error('Trailing GTV request bytes');
    return request;
}
/** Authorization and TCP lifetime belong to the shared server; this owns its wire stream. */
export class GtvServerStream {
    private compression: GtvCompression | null = null;
    private greeted = false;
    private closed = false;
    private busy = false;
    hello(flags: number): Uint8Array {
        if (this.greeted || this.closed) throw new Error('GTV server hello already sent');
        if (flags & ~(GTF_DEFLATE | GTF_STRINGCMDS)) throw new Error('Unknown GTV negotiated flags');
        this.greeted = true;
        const body = new Uint8Array(4); new DataView(body.buffer).setInt32(0, flags, true);
        if (flags & GTF_DEFLATE) this.compression = new GtvCompression(true);
        return packet(GtvServerOpT.GTS_HELLO, body);
    }
    async message(opcode: GtvServerOpT, body: Uint8Array = new Uint8Array(0)): Promise<Uint8Array> {
        if (!this.greeted || this.closed || this.busy || opcode === GtvServerOpT.GTS_HELLO) throw new Error('Invalid GTV server stream state');
        this.busy = true;
        try { const bytes = packet(opcode, body); return this.compression === null ? bytes : await this.compression.push(bytes); }
        finally { this.busy = false; }
    }
    close(): void { this.closed = true; this.compression?.close(); this.compression = null; }
}
