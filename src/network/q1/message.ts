// Scalar wire rules from WinQuake/common.c, QW/common.c and Ironwail. GPL-2.0-or-later.
import { PRFL_FLOATANGLE, PRFL_FLOATCOORD, PRFL_INT32COORD, PRFL_24BITCOORD, PRFL_SHORTANGLE, Q_rint } from './constants.ts';
export class PacketError extends Error {
    constructor(message: string, readonly offset: number) { super(`${message} at byte ${offset}`); this.name = 'PacketError'; }
}
export class SizeBuf {
    readonly data: Uint8Array;
    cursize = 0;
    overflowed = false;
    constructor(readonly maxsize = 64000, readonly allowoverflow = false) { this.data = new Uint8Array(maxsize); }
    reserve(length: number): number {
        if (!Number.isSafeInteger(length) || length < 0 || length > this.maxsize)
            throw new RangeError('Invalid message write size');
        if (this.cursize + length > this.maxsize) {
            if (!this.allowoverflow)
                throw new RangeError('Quake message overflow');
            this.cursize = 0;
            this.overflowed = true;
        }
        const offset = this.cursize;
        this.cursize += length;
        return offset;
    }
    clear(): void { this.cursize = 0; this.overflowed = false; }
    bytes(): Uint8Array { return this.data.slice(0, this.cursize); }
}
export function SZ_Write(sb: SizeBuf, data: Uint8Array, length = data.length): void {
    if (length > data.length)
        throw new RangeError('Message source too short');
    sb.data.set(data.subarray(0, length), sb.reserve(length));
}
export function MSG_WriteByte(sb: SizeBuf, n: number): void { sb.data[sb.reserve(1)] = n & 255; }
export const MSG_WriteChar = MSG_WriteByte;
export function MSG_WriteShort(sb: SizeBuf, n: number): void { new DataView(sb.data.buffer).setInt16(sb.reserve(2), n, true); }
export function MSG_WriteLong(sb: SizeBuf, n: number): void { new DataView(sb.data.buffer).setInt32(sb.reserve(4), n, true); }
export function MSG_WriteFloat(sb: SizeBuf, n: number): void { new DataView(sb.data.buffer).setFloat32(sb.reserve(4), n, true); }
export function MSG_WriteString(sb: SizeBuf, s: string | null): void {
    if (s !== null) {
        for (let i = 0; i < s.length; i++)
            MSG_WriteByte(sb, s.charCodeAt(i));
    }
    MSG_WriteByte(sb, 0);
}
export function MSG_WriteCoord(sb: SizeBuf, n: number): void { MSG_WriteShort(sb, Math.trunc(n * 8)); }
export function MSG_WriteAngle(sb: SizeBuf, n: number): void { MSG_WriteByte(sb, Math.trunc(Math.trunc(n) * 256 / 360)); }
export function MSG_WriteCoordFlags(sb: SizeBuf, n: number, flags: number): void {
    if (flags & PRFL_FLOATCOORD)
        MSG_WriteFloat(sb, n);
    else if (flags & PRFL_INT32COORD)
        MSG_WriteLong(sb, Q_rint(n * 16));
    else if (flags & PRFL_24BITCOORD) {
        MSG_WriteShort(sb, n);
        MSG_WriteByte(sb, Math.trunc(n * 255) % 255);
    }
    else
        MSG_WriteShort(sb, Q_rint(n * 8));
}
export function MSG_WriteAngleFlags(sb: SizeBuf, n: number, flags: number): void {
    if (flags & PRFL_FLOATANGLE)
        MSG_WriteFloat(sb, n);
    else if (flags & PRFL_SHORTANGLE)
        MSG_WriteShort(sb, Q_rint(n * 65536 / 360));
    else
        MSG_WriteByte(sb, Q_rint(n * 256 / 360));
}
export class MessageReader {
    readonly view: DataView;
    offset = 0;
    badread = false;
    constructor(readonly data: Uint8Array) { this.view = new DataView(data.buffer, data.byteOffset, data.byteLength); }
    get remaining(): number { return Math.max(0, this.data.length - this.offset); }
    private take(length: number): number | null {
        if (this.offset + length > this.data.length) {
            this.badread = true;
            return null;
        }
        const offset = this.offset;
        this.offset += length;
        return offset;
    }
    Byte(): number { const i = this.take(1); return i === null ? -1 : this.view.getUint8(i); }
    Char(): number { const i = this.take(1); return i === null ? -1 : this.view.getInt8(i); }
    Short(): number { const i = this.take(2); return i === null ? -1 : this.view.getInt16(i, true); }
    Long(): number { const i = this.take(4); return i === null ? -1 : this.view.getInt32(i, true); }
    Float(): number { const i = this.take(4); return i === null ? -1 : this.view.getFloat32(i, true); }
    String(limit = 2047, quakeworld = false): string {
        let s = '';
        while (s.length < limit) {
            const c = this.Char();
            if (c === -1 || c === 0)
                break;
            if (quakeworld && c === 10)
                continue;
            s += String.fromCharCode(c & 255);
        }
        return s;
    }
    Coord(): number { return this.Short() / 8; }
    Angle(): number { return this.Char() * 360 / 256; }
    CoordFlags(flags: number): number {
        if (flags & PRFL_FLOATCOORD)
            return this.Float();
        if (flags & PRFL_INT32COORD)
            return this.Long() / 16;
        if (flags & PRFL_24BITCOORD)
            return this.Short() + this.Byte() / 255;
        return this.Coord();
    }
    AngleFlags(flags: number): number {
        if (flags & PRFL_FLOATANGLE)
            return this.Float();
        if (flags & PRFL_SHORTANGLE)
            return this.Short() * 360 / 65536;
        return this.Angle();
    }
    bytes(length: number): Uint8Array {
        if (!Number.isSafeInteger(length) || length < 0)
            throw new PacketError('Invalid byte count', this.offset);
        const i = this.take(length);
        if (i === null)
            throw new PacketError('Truncated message', this.offset);
        return this.data.slice(i, i + length);
    }
    finish(): void {
        if (this.badread)
            throw new PacketError('Truncated message', this.offset);
    }
}
/** Fitz/RMQ movement angles use shorts even when the server snapshot angles use bytes. */
export function MSG_WriteAngle16(sb: SizeBuf, value: number, flags: number): void {
    if (flags & PRFL_FLOATANGLE)
        MSG_WriteFloat(sb, value);
    else
        MSG_WriteShort(sb, Q_rint(value * 65536 / 360));
}
export function readMoveAngle16(reader: MessageReader, flags: number): number { return flags & PRFL_FLOATANGLE ? reader.Float() : reader.Short() * 360 / 65536; }
