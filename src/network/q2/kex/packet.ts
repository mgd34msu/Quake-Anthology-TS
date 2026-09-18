// KEX LAN wire layout recovered from quake2ex_steam.exe; addresses in t07-kex-static/lifecycle.md.
export const KEX_DATAGRAM_BYTES = 1400;
export const KEX_MESSAGE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export class KexReader {
    private position = 0;
    constructor(readonly bytes: Uint8Array) {}
    get remaining(): number { return this.bytes.length - this.position; }
    byte(): number {
        const value = this.bytes[this.position++];
        if (value === undefined) throw new Error('Truncated KEX message');
        return value;
    }
    integer(): bigint {
        let value = 0n;
        for (let shift = 0n; shift < 70n; shift += 7n) {
            const byte = this.byte();
            if (shift === 63n && byte > 1) throw new Error('Invalid KEX integer');
            value |= BigInt(byte & 127) << shift;
            if ((byte & 128) === 0) return value;
        }
        throw new Error('Invalid KEX integer');
    }
    string(): string {
        const length = this.integer();
        if (length > BigInt(this.remaining)) throw new Error('Truncated KEX string');
        const start = this.position; this.position += Number(length);
        return decoder.decode(this.bytes.subarray(start, this.position));
    }
    end(): void { if (this.remaining !== 0) throw new Error('Trailing KEX data'); }
}
export class KexWriter {
    private readonly bytes: number[] = [];
    byte(value: number): this {
        if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid KEX byte');
        this.bytes.push(value); return this;
    }
    integer(value: bigint): this {
        if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError('Invalid KEX integer');
        do { const byte = Number(value & 127n); value >>= 7n; this.bytes.push(byte | (value === 0n ? 0 : 128)); } while (value !== 0n);
        return this;
    }
    string(value: string): this { const bytes = encoder.encode(value); this.integer(BigInt(bytes.length)); for (const byte of bytes) this.bytes.push(byte); return this; }
    finish(): Uint8Array { return Uint8Array.from(this.bytes); }
}
export interface KexPacket {
    readonly flags: number;
    readonly sequence: number;
    readonly reliable: number;
    readonly kind: number | null;
    readonly payload: Uint8Array;
}
export function readKexPacket(bytes: Uint8Array): KexPacket {
    if (bytes.length < 3 || bytes.length > KEX_DATAGRAM_BYTES) throw new Error('Invalid KEX datagram size');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), header = view.getUint16(0);
    if ((header >>> 4) !== bytes.length) throw new Error('Invalid KEX datagram length');
    const flags = header & 15, sequential = (flags & 2) !== 0, continued = (flags & 8) !== 0;
    const offset = sequential ? 6 : 2;
    if ((flags & 1) !== 0 && !sequential || bytes.length < offset + (continued ? 0 : 1)) throw new Error('Invalid KEX datagram flags');
    return { flags, sequence: sequential ? view.getUint16(2) : 0, reliable: sequential ? view.getUint16(4) : 0,
        kind: continued ? null : bytes[offset] ?? null, payload: bytes.subarray(offset + (continued ? 0 : 1)) };
}
export function writeKexPacket(packet: KexPacket): Uint8Array {
    const sequential = (packet.flags & 2) !== 0, continued = (packet.flags & 8) !== 0;
    const offset = sequential ? 6 : 2, bytes = new Uint8Array(offset + (continued ? 0 : 1) + packet.payload.length);
    if (bytes.length > KEX_DATAGRAM_BYTES || packet.flags < 0 || packet.flags > 15 || continued !== (packet.kind === null)) throw new Error('Invalid KEX packet');
    const view = new DataView(bytes.buffer); view.setUint16(0, (bytes.length << 4) | packet.flags);
    if (sequential) { view.setUint16(2, packet.sequence); view.setUint16(4, packet.reliable); }
    if (!continued && packet.kind !== null) bytes[offset] = packet.kind;
    bytes.set(packet.payload, offset + (continued ? 0 : 1)); return bytes;
}
export function kexText(value: string): Uint8Array { return encoder.encode(value); }
export function readKexText(value: Uint8Array): string { return decoder.decode(value); }
