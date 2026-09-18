// q2repro server/mvd/client.c demo_load_message and server/mvd.c recording.
import { MVD_MAGIC } from './codecs/mvd.ts';
export const MVD_MAX_MESSAGE = 0x8000;
export function mvdMagic(): Uint8Array {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, MVD_MAGIC, true);
    return bytes;
}
export function frameMvdMessage(bytes: Uint8Array): Uint8Array {
    if (bytes.length < 1 || bytes.length > MVD_MAX_MESSAGE) throw new RangeError('MVD message length outside 1..32768');
    const result = new Uint8Array(bytes.length + 2);
    new DataView(result.buffer).setUint16(0, bytes.length, true);
    result.set(bytes, 2);
    return result;
}
export class MvdRecording {
    private started = false;
    private closed = false;
    constructor(private readonly write: (bytes: Uint8Array) => void) {}
    append(message: Uint8Array): void {
        if (this.closed) throw new Error('MVD recording is closed');
        const framed = frameMvdMessage(message);
        if (!this.started) { this.write(mvdMagic()); this.started = true; }
        this.write(framed);
    }
    close(): void {
        if (this.closed) return;
        if (!this.started) { this.write(mvdMagic()); this.started = true; }
        this.write(new Uint8Array(2));
        this.closed = true;
    }
}
/** Incremental framing shared by files and GTV, with a bounded incomplete message. */
export class MvdMessageFramer {
    private pending = new Uint8Array(0);
    private magicRead: boolean;
    private ended = false;
    constructor(magic = true, private readonly limit = MVD_MAX_MESSAGE) {
        if (!Number.isInteger(limit) || limit < 1 || limit > MVD_MAX_MESSAGE) throw new RangeError('Invalid MVD/GTV frame limit');
        this.magicRead = !magic;
    }
    get identified(): boolean { return this.magicRead; }
    get finished(): boolean { return this.ended; }
    takePending(): Uint8Array { const bytes = this.pending; this.pending = new Uint8Array(0); return bytes; }
    push(bytes: Uint8Array, message: (bytes: Uint8Array) => boolean | void): void {
        if (this.ended && bytes.length !== 0) throw new Error('Data after MVD terminator');
        let offset = 0;
        while (offset < bytes.length) {
            const need = !this.magicRead ? 4 : this.pending.length < 2 ? 2 : new DataView(this.pending.buffer, this.pending.byteOffset, this.pending.byteLength).getUint16(0, true) + 2;
            const count = Math.min(need - this.pending.length, bytes.length - offset);
            const joined = new Uint8Array(this.pending.length + count);
            joined.set(this.pending); joined.set(bytes.subarray(offset, offset + count), this.pending.length);
            this.pending = joined; offset += count;
            if (joined.length < need) break;
            if (!this.magicRead) {
                if (new DataView(joined.buffer).getUint32(0, true) !== MVD_MAGIC) throw new Error('Not an MVD/GTV stream');
                this.magicRead = true; this.pending = new Uint8Array(0);
                continue;
            }
            const length = new DataView(joined.buffer).getUint16(0, true);
            if (length > this.limit) throw new RangeError('Oversize MVD/GTV message');
            if (length === 0) {
                this.ended = true; this.pending = new Uint8Array(0);
                if (offset !== bytes.length) throw new Error('Data after MVD terminator');
                break;
            }
            if (joined.length < length + 2) continue;
            this.pending = new Uint8Array(0);
            if (message(joined.slice(2)) === false) { this.pending = bytes.slice(offset); return; }
        }
    }
    finish(requireTerminator = true): void {
        if (!this.magicRead || this.pending.length !== 0 || requireTerminator && !this.ended) throw new Error('Truncated MVD/GTV stream');
    }
}
export function* readMvdRecording(bytes: Uint8Array): Generator<Uint8Array, void, unknown> {
    const framer = new MvdMessageFramer(), messages: Uint8Array[] = [];
    framer.push(bytes, message => { messages.push(message); });
    framer.finish();
    yield* messages;
}
