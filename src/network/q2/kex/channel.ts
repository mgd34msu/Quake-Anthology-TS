import { deflateSync, inflateSync } from 'node:zlib';
import { KEX_DATAGRAM_BYTES, KEX_MESSAGE_BYTES, readKexPacket, writeKexPacket } from './packet.ts';
export interface KexMessage { readonly kind: number; readonly payload: Uint8Array; }
interface Pending { readonly reliable: number; readonly bytes: Uint8Array; }
export class KexChannel {
    private sequence = 0;
    private reliable = 0;
    private incomingSequence = 0;
    private incomingReliable = 0;
    private readonly pending: Pending[] = [];
    private pendingBytes = 0;
    private retryAt = 0;
    private retries = 0;
    private receivedAt = 0;
    private acknowledgment = 0;
    private fragments: { kind: number; sequence: number; bytes: Uint8Array } | null = null;
    constructor(private readonly emit: (bytes: Uint8Array) => boolean) {}
    send(kind: number, payload: Uint8Array, mode: 0 | 2 | 3, now: number): boolean {
        if (payload.length > KEX_MESSAGE_BYTES || !Number.isInteger(kind) || kind < 0 || kind > 255) throw new Error('Invalid KEX message');
        let data = payload, messageKind = kind;
        if (kind < 127 && payload.length >= 128) {
            const compressed = deflateSync(payload);
            if (compressed.length + 1 < payload.length) { data = new Uint8Array(compressed.length + 1); data[0] = kind; data.set(compressed, 1); messageKind = 127; }
        }
        const fragmented = data.length + (mode === 0 ? 3 : 7) > KEX_DATAGRAM_BYTES;
        if (fragmented && mode === 0) throw new Error('Unsequenced KEX message cannot be fragmented');
        if (mode === 3 && this.pendingBytes + data.length + Math.ceil(data.length / 1393) * 7 > KEX_MESSAGE_BYTES * 2) throw new Error('KEX reliable queue is full');
        let position = 0, first = true, accepted = true;
        do {
            const capacity = KEX_DATAGRAM_BYTES - (mode === 0 ? 2 : 6) - (first ? 1 : 0);
            const end = Math.min(data.length, position + capacity), final = end === data.length;
            const fragmentFlags = !fragmented ? 0 : first ? 4 : final ? 12 : 8;
            if (mode !== 0) this.sequence = (this.sequence + 1) & 65535;
            if (mode === 3) this.reliable = (this.reliable + 1) & 65535;
            const bytes = writeKexPacket({ flags: mode | fragmentFlags, sequence: this.sequence, reliable: this.reliable,
                kind: first ? messageKind : null, payload: data.subarray(position, end) });
            if (mode === 3) {
                if (this.pending.length === 0) { this.retryAt = now; this.retries = 0; }
                this.pending.push({ reliable: this.reliable, bytes }); this.pendingBytes += bytes.length;
            }
            accepted = this.emit(bytes) && accepted;
            position = end; first = false;
        } while (position < data.length);
        return accepted;
    }
    receive(bytes: Uint8Array, now: number): KexMessage | null {
        const packet = readKexPacket(bytes), reliable = (packet.flags & 1) !== 0, sequential = (packet.flags & 2) !== 0;
        if (packet.kind === 130 && packet.flags === 0) {
            if (packet.payload.length !== 3) throw new Error('Invalid KEX acknowledgment');
            const acknowledgment = new DataView(packet.payload.buffer, packet.payload.byteOffset, 3).getUint16(1);
            // Native sender uses an unsigned ordinary comparison, including at wrap.
            while (this.pending[0] !== undefined && this.pending[0].reliable <= acknowledgment) {
                const removed = this.pending.shift(); if (removed !== undefined) this.pendingBytes -= removed.bytes.length;
                this.retryAt = now; this.retries = 0;
            }
            this.receivedAt = now; return null;
        }
        if (reliable) {
            this.acknowledgment |= 4;
            if (packet.reliable !== ((this.incomingReliable + 1) & 65535)) { this.acknowledgment |= 2; return null; }
            this.incomingReliable = packet.reliable; this.acknowledgment &= ~2;
        } else if (sequential) {
            if (packet.sequence === this.incomingSequence) return null;
            let comparison = this.incomingSequence;
            if (((packet.sequence ^ comparison) & 32768) !== 0 && (packet.sequence & 32768) !== 0) comparison = (comparison << 16) >>> 0;
            else if (packet.sequence >= comparison) comparison = packet.sequence + 16384;
            if (((comparison - packet.sequence) >>> 0) < 16384 || packet.reliable !== this.incomingReliable) return null;
        }
        if (sequential) this.incomingSequence = packet.sequence;
        this.receivedAt = now;
        const fragment = packet.flags & 12;
        if (fragment === 0) { if (packet.kind === null) throw new Error('Missing KEX kind'); return this.expand(packet.kind, packet.payload); }
        if (fragment === 4) {
            if (packet.kind === null) throw new Error('Missing KEX fragment kind');
            this.fragments = { kind: packet.kind, sequence: packet.sequence, bytes: packet.payload.slice() }; return null;
        }
        const previous = this.fragments;
        if (previous === null || packet.sequence !== ((previous.sequence + 1) & 65535)) { this.fragments = null; return null; }
        const length = previous.bytes.length + packet.payload.length;
        if (length > KEX_MESSAGE_BYTES) { this.fragments = null; throw new Error('KEX fragmented message exceeds limit'); }
        const joined = new Uint8Array(length); joined.set(previous.bytes); joined.set(packet.payload, previous.bytes.length);
        if (fragment === 8) { this.fragments = { kind: previous.kind, sequence: packet.sequence, bytes: joined }; return null; }
        this.fragments = null; return this.expand(previous.kind, joined);
    }
    private expand(kind: number, bytes: Uint8Array): KexMessage {
        if (kind !== 127) return { kind, payload: bytes };
        const original = bytes[0];
        if (original === undefined || original >= 127) throw new Error('Invalid compressed KEX game kind');
        return { kind: original, payload: inflateSync(bytes.subarray(1), { maxOutputLength: KEX_MESSAGE_BYTES }) };
    }
    tick(now: number): void {
        if (this.acknowledgment !== 0) {
            const bytes = new Uint8Array(3); bytes[0] = (this.acknowledgment & 2) !== 0 ? 1 : 0;
            new DataView(bytes.buffer).setUint16(1, this.incomingReliable);
            this.emit(writeKexPacket({ flags: 0, sequence: 0, reliable: 0, kind: 130, payload: bytes })); this.acknowledgment = 0;
        }
        const first = this.pending[0];
        if (first !== undefined && now - this.retryAt >= 500) {
            if (++this.retries >= 40) throw new Error('KEX LAN peer timed out');
            this.retryAt = now; this.emit(first.bytes);
        }
        if (now - this.receivedAt >= 5000 && first === undefined) { this.send(129, new Uint8Array(), 3, now); this.receivedAt = now; }
    }
}
