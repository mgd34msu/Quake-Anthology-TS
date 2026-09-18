// Quake II sv_user.c and q2repro server/user.c command ordering. GPL-2.0-or-later.
import type { Q2WireCodec } from './codec.ts';
import type { ClcBatchMoveT, ClcClientSettingT, ClcUserinfoDeltaT } from './codecs/codec.ts';
import type { ClcBatchMoveFrameT } from './codecs/clc_batch_move.ts';
import { checkMessageRead, createMessage, messageBytes, MSG_ReadByte, MSG_ReadLong, MSG_ReadString, MSG_WriteByte, MSG_WriteLong, MSG_WriteShort, MSG_WriteString } from './message.ts';
import { UsercmdT } from './state.ts';
import { blockSequenceChecksum } from './checksum.ts';
export type Q2ClientEvent = {
    readonly kind: 'nop';
} | {
    readonly kind: 'userinfo' | 'command';
    readonly text: string;
} | {
    readonly kind: 'userinfo-delta';
    readonly delta: ClcUserinfoDeltaT;
} | {
    readonly kind: 'setting';
    readonly setting: ClcClientSettingT;
} | {
    readonly kind: 'move';
    readonly lastFrame: number;
    readonly commands: readonly [
        UsercmdT,
        UsercmdT,
        UsercmdT
    ];
} | {
    readonly kind: 'batch-move';
    readonly batch: ClcBatchMoveT;
};
export interface Q2ClientRecord {
    readonly event: Q2ClientEvent;
    readonly raw: Uint8Array;
    readonly seat?: number;
}
export function readQ2ClientMessages(wire: Q2WireCodec, bytes: Uint8Array, sequence: number, seats = 1): Q2ClientRecord[] {
    wire.begin(bytes);
    const m = wire.message, records: Q2ClientRecord[] = [];
    let moved = false;
    while (m.readcount < m.cursize) {
        const start = m.readcount, raw = MSG_ReadByte(m), op = wire.protocol.kind === 'q2-q2pro' ? raw & 31 : raw;
        let event: Q2ClientEvent;
        let selectedSeat = 0;
        switch (op) {
            case 1:
                event = { kind: 'nop' };
                break;
            case 3:
                event = { kind: 'userinfo', text: wire.protocol.kind === 'q2-kex' ? readKexControlString(m) : MSG_ReadString(m) };
                break;
            case 4:
                if (wire.protocol.kind === 'q2-kex') { selectedSeat = MSG_ReadByte(m) - 1; if (selectedSeat < 0 || selectedSeat >= seats) throw new Error('Q2 connection does not own the selected split player'); }
                event = { kind: 'command', text: wire.protocol.kind === 'q2-kex' ? readKexControlString(m) : MSG_ReadString(m) };
                break;
            case 5: {
                const read = wire.codec.readClientSetting;
                if (read === undefined)
                    throw new Error('Client setting is not supported by selected Q2 wire');
                event = { kind: 'setting', setting: read(m) };
                break;
            }
            case 12: {
                const read = wire.codec.readUserinfoDelta;
                if (read === undefined)
                    throw new Error('Userinfo delta is not supported by selected Q2 wire');
                event = { kind: 'userinfo-delta', delta: read(m) };
                break;
            }
            case 2: {
                if (moved)
                    throw new Error('Multiple Q2 move commands in one packet');
                moved = true;
                const checksum = wire.codec.clcMoveHasChecksum === true ? MSG_ReadByte(m) : null, checksumStart = m.readcount;
                const readMove = wire.codec.readDeltaUsercmd;
                if (readMove === undefined)
                    throw new Error('Selected Q2 wire has no client move decoder');
                const lastFrame = MSG_ReadLong(m);
                for (let seat = 0; seat < (wire.protocol.kind === 'q2-kex' ? seats : 1); seat++) {
                const oldest = new UsercmdT(), old = new UsercmdT(), current = new UsercmdT();
                const lightlevel = wire.protocol.kind === 'q2-kex' ? MSG_ReadByte(m) : null;
                readMove(m, new UsercmdT(), oldest);
                readMove(m, oldest, old);
                readMove(m, old, current);
                if (lightlevel !== null) { oldest.lightlevel = lightlevel; old.lightlevel = lightlevel; current.lightlevel = lightlevel; }
                checkMessageRead(m);
                if (checksum !== null && blockSequenceChecksum(m.data.subarray(checksumStart, m.readcount), sequence) !== checksum)
                    throw new Error('Q2 command sequence checksum mismatch');
                records.push({ seat, event: { kind: 'move', lastFrame, commands: [oldest, old, current] }, raw: m.data.slice(start, m.readcount) });
                }
                continue;
            }
            case 10:
            case 11: {
                if (moved)
                    throw new Error('Multiple Q2 move commands in one packet');
                moved = true;
                const read = wire.codec.readBatchMove;
                if (read === undefined)
                    throw new Error('Batched movement is not supported by selected Q2 wire');
                event = { kind: 'batch-move', batch: read(m, op === 10, raw >>> 5) };
                break;
            }
            default: throw new Error(`Unknown Q2 client opcode ${op}`);
        }
        checkMessageRead(m);
        records.push({ seat: selectedSeat, event, raw: m.data.slice(start, m.readcount) });
    }
    return records;
}
export function encodeQ2Move(wire: Q2WireCodec, sequence: number, lastFrame: number, commands: readonly [
    UsercmdT,
    UsercmdT,
    UsercmdT
]): Uint8Array {
    const writeMove = wire.codec.writeDeltaUsercmd;
    if (writeMove === undefined)
        throw new Error('Selected Q2 wire has no client move encoder');
    const m = createMessage();
    MSG_WriteByte(m, 2);
    const checksum = wire.codec.clcMoveHasChecksum === true;
    if (checksum)
        MSG_WriteByte(m, 0);
    const checksumStart = m.cursize;
    MSG_WriteLong(m, lastFrame);
    if (wire.protocol.kind === 'q2-kex') MSG_WriteByte(m, commands[2].lightlevel);
    writeMove(m, new UsercmdT(), commands[0]);
    writeMove(m, commands[0], commands[1]);
    writeMove(m, commands[1], commands[2]);
    if (checksum)
        m.data[1] = blockSequenceChecksum(m.data.subarray(checksumStart, m.cursize), sequence);
    return messageBytes(m);
}
export function encodeQ2BatchMove(wire: Q2WireCodec, lastFrame: number | null, frames: ClcBatchMoveFrameT[]): Uint8Array {
    const write = wire.codec.writeBatchMove;
    if (write === undefined)
        throw new Error('Selected Q2 codec cannot write batched moves');
    const m = createMessage(), extra = wire.protocol.kind === 'q2-q2pro' ? (frames.length - 1) << 5 : 0;
    MSG_WriteByte(m, (lastFrame === null ? 10 : 11) | extra);
    write(m, lastFrame, frames);
    return messageBytes(m);
}
export function encodeQ2ClientControl(event: Exclude<Q2ClientEvent, {
    kind: 'move' | 'batch-move';
}>, kex = false): Uint8Array {
    const m = createMessage();
    switch (event.kind) {
        case 'nop':
            MSG_WriteByte(m, 1);
            break;
        case 'userinfo':
            MSG_WriteByte(m, 3);
            if (kex) { for (const byte of new TextEncoder().encode(event.text)) MSG_WriteByte(m, byte); MSG_WriteByte(m, 0); } else MSG_WriteString(m, event.text);
            break;
        case 'command':
            MSG_WriteByte(m, 4);
            if (kex) MSG_WriteByte(m, 1);
            if (kex) { for (const byte of new TextEncoder().encode(event.text)) MSG_WriteByte(m, byte); MSG_WriteByte(m, 0); } else MSG_WriteString(m, event.text);
            break;
        case 'setting':
            MSG_WriteByte(m, 5);
            MSG_WriteShort(m, event.setting.index);
            MSG_WriteShort(m, event.setting.value);
            break;
        case 'userinfo-delta':
            MSG_WriteByte(m, 12);
            MSG_WriteString(m, event.delta.name);
            MSG_WriteString(m, event.delta.value);
            break;
    }
    return messageBytes(m);
}
/** Synchronous callbacks preserve native dropped-command replay before the new command. */
export class Q2CommandReplay {
    private previous = new UsercmdT();
    lastFrame = -1;
    execute(event: Extract<Q2ClientEvent, {
        kind: 'move' | 'batch-move';
    }>, dropped: number, think: (command: UsercmdT) => void): void {
        if (!Number.isInteger(dropped) || dropped < 0)
            throw new RangeError('Invalid Q2 drop count');
        if (event.kind === 'move') {
            this.lastFrame = event.lastFrame;
            if (dropped < 20) {
                while (dropped > 2) {
                    think(this.previous);
                    dropped--;
                }
                if (dropped > 1)
                    think(event.commands[0]);
                if (dropped > 0)
                    think(event.commands[1]);
            }
            think(event.commands[2]);
            this.previous = event.commands[2];
            return;
        }
        const batch = event.batch;
        this.lastFrame = batch.lastframe;
        const last = batch.frames.flatMap(frame => frame.cmds).at(-1);
        if (last === undefined)
            return;
        if (dropped < 20) {
            while (dropped > batch.numDups) {
                think(this.previous);
                dropped--;
            }
            while (dropped > 0) {
                const frame = batch.frames[batch.numDups - dropped];
                if (frame === undefined)
                    throw new Error('Missing Q2 batch backup');
                for (const command of frame.cmds)
                    think(command);
                dropped--;
            }
        }
        const newest = batch.frames[batch.numDups];
        if (newest === undefined)
            throw new Error('Missing Q2 newest command batch');
        for (const command of newest.cmds)
            think(command);
        this.previous = last;
    }
}
/** Original ten-frame byte window. Cadence and loopback status come from the session. */
export class Q2RateWindow {
    private readonly sizes = new Uint32Array(10);
    suppressed = 0;
    drop(serverFrame: number, bytesPerSecond: number, loopback: boolean): boolean {
        if (loopback)
            return false;
        let total = 0;
        for (const size of this.sizes)
            total += size;
        if (total <= bytesPerSecond)
            return false;
        this.suppressed++;
        this.sizes[serverFrame % 10] = 0;
        return true;
    }
    sent(serverFrame: number, bytes: number): void { this.sizes[serverFrame % 10] = bytes; }
    takeSuppressed(): number { const value = this.suppressed; this.suppressed = 0; return value; }
}

function readKexControlString(message: Q2WireCodec['message']): string {
    const bytes: number[] = [];
    for (;;) { const byte = MSG_ReadByte(message); if (byte < 0) throw new Error('Truncated KEX control string'); if (byte === 0) break; bytes.push(byte); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
}
