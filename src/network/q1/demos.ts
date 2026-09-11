// WinQuake .dem and x86 QuakeWorld .qwd record layout. GPL-2.0-or-later.
import type { Vec3 } from '../../contracts/math.ts';
import type { QwUserCommand } from '../../contracts/protocol.ts';
import { MessageReader, PacketError, SizeBuf, MSG_WriteByte, MSG_WriteFloat, MSG_WriteLong, SZ_Write } from './message.ts';
export interface NetQuakeDemoRecord {
    readonly viewAngles: Vec3;
    readonly message: Uint8Array;
}
export class NetQuakeDemoReader {
    private readonly reader: MessageReader;
    readonly forcedTrack: number;
    constructor(bytes: Uint8Array, readonly maxMessageBytes = 64000) {
        const end = bytes.indexOf(10);
        if (end < 0 || end > 31)
            throw new PacketError('Missing demo track line', 0);
        let track = '';
        for (const n of bytes.subarray(0, end))
            track += String.fromCharCode(n);
        if (!/^-?\d+$/.test(track))
            throw new PacketError('Invalid demo track', 0);
        this.forcedTrack = Number(track);
        this.reader = new MessageReader(bytes.subarray(end + 1));
    }
    next(): NetQuakeDemoRecord | null {
        const r = this.reader;
        if (!r.remaining)
            return null;
        const size = r.Long();
        if (size < 0 || size > this.maxMessageBytes)
            throw new PacketError('Invalid demo message size', r.offset);
        const viewAngles = { x: r.Float(), y: r.Float(), z: r.Float() }, message = r.bytes(size);
        r.finish();
        return { viewAngles, message };
    }
}
export function writeNetQuakeDemoHeader(track = -1): Uint8Array { return new TextEncoder().encode(`${Math.trunc(track)}\n`); }
export function writeNetQuakeDemoRecord(record: NetQuakeDemoRecord): Uint8Array {
    const s = new SizeBuf(record.message.length + 16);
    MSG_WriteLong(s, record.message.length);
    for (const n of [record.viewAngles.x, record.viewAngles.y, record.viewAngles.z])
        MSG_WriteFloat(s, n);
    SZ_Write(s, record.message);
    return s.bytes();
}
export type QuakeWorldDemoRecord = {
    readonly kind: 'command';
    readonly seconds: number;
    readonly command: QwUserCommand;
    readonly viewAngles: Vec3;
} | {
    readonly kind: 'packet';
    readonly seconds: number;
    readonly message: Uint8Array;
} | {
    readonly kind: 'sequences';
    readonly seconds: number;
    readonly outgoing: number;
    readonly incoming: number;
};
export class QuakeWorldDemoReader {
    private readonly reader: MessageReader;
    constructor(bytes: Uint8Array, readonly maxMessageBytes = 1450) { this.reader = new MessageReader(bytes); }
    next(): QuakeWorldDemoRecord | null {
        const r = this.reader;
        if (!r.remaining)
            return null;
        const seconds = r.Float(), type = r.Byte();
        let record: QuakeWorldDemoRecord;
        switch (type) {
            case 0: {
                const raw = r.bytes(24), v = new DataView(raw.buffer), command: QwUserCommand = { kind: 'q1-quakeworld', milliseconds: v.getUint8(0), angles: { x: v.getFloat32(4, true), y: v.getFloat32(8, true), z: v.getFloat32(12, true) }, forwardMove: v.getInt16(16, true), sideMove: v.getInt16(18, true), upMove: v.getInt16(20, true), buttons: v.getUint8(22), impulse: v.getUint8(23) };
                record = { kind: 'command', seconds, command, viewAngles: { x: r.Float(), y: r.Float(), z: r.Float() } };
                break;
            }
            case 1: {
                const size = r.Long();
                if (size < 0 || size > this.maxMessageBytes)
                    throw new PacketError('Invalid QWD packet size', r.offset);
                record = { kind: 'packet', seconds, message: r.bytes(size) };
                break;
            }
            case 2:
                record = { kind: 'sequences', seconds, outgoing: r.Long(), incoming: r.Long() };
                break;
            default: throw new PacketError(`Unknown QWD record ${type}`, r.offset - 1);
        }
        r.finish();
        return record;
    }
}
export function writeQuakeWorldDemoRecord(record: QuakeWorldDemoRecord): Uint8Array {
    const s = new SizeBuf(record.kind === 'packet' ? record.message.length + 9 : 41);
    MSG_WriteFloat(s, record.seconds);
    switch (record.kind) {
        case 'command': {
            MSG_WriteByte(s, 0);
            const bytes = new Uint8Array(24), v = new DataView(bytes.buffer), c = record.command;
            v.setUint8(0, c.milliseconds);
            v.setFloat32(4, c.angles.x, true);
            v.setFloat32(8, c.angles.y, true);
            v.setFloat32(12, c.angles.z, true);
            v.setInt16(16, c.forwardMove, true);
            v.setInt16(18, c.sideMove, true);
            v.setInt16(20, c.upMove, true);
            v.setUint8(22, c.buttons);
            v.setUint8(23, c.impulse);
            SZ_Write(s, bytes);
            for (const n of [record.viewAngles.x, record.viewAngles.y, record.viewAngles.z])
                MSG_WriteFloat(s, n);
            break;
        }
        case 'packet':
            MSG_WriteByte(s, 1);
            MSG_WriteLong(s, record.message.length);
            SZ_Write(s, record.message);
            break;
        case 'sequences':
            MSG_WriteByte(s, 2);
            MSG_WriteLong(s, record.outgoing);
            MSG_WriteLong(s, record.incoming);
            break;
    }
    return s.bytes();
}
/** Timing is supplied by the engine clock; reading a demo never opens a socket. */
export class QuakeWorldDemoPlayback {
    private pending: QuakeWorldDemoRecord | null;
    constructor(readonly reader: QuakeWorldDemoReader) { this.pending = reader.next(); }
    drain(seconds: number, force = false): readonly QuakeWorldDemoRecord[] {
        const records: QuakeWorldDemoRecord[] = [];
        while (this.pending !== null && (force || this.pending.seconds <= seconds)) {
            records.push(this.pending);
            this.pending = this.reader.next();
        }
        return records;
    }
    get ended(): boolean { return this.pending === null; }
}
