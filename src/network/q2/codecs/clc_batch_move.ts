// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import { MSG_ReadByte, MSG_WriteByte } from "../message.ts";
import { CM_ANGLE1, CM_ANGLE2, CM_ANGLE3, CM_FORWARD, CM_SIDE, CM_UP, CM_BUTTONS, CM_IMPULSE } from "../constants.ts";
import { UsercmdT } from "../state.ts";
export const MAX_CLC_BATCH_MOVE_FRAMES = 4;
export const MAX_CLC_BATCH_MOVE_CMDS = 32;
export { CM_ANGLE1, CM_ANGLE2, CM_ANGLE3, CM_FORWARD, CM_SIDE, CM_UP, CM_BUTTONS, CM_IMPULSE };
export class ClcBatchMoveError extends Error {
}
export class BitReader {
    private buf = 0;
    private left = 0;
    constructor(private readonly msg: SizeBuf) { }
    private fill(bits: number): void {
        while (this.left < bits) {
            const byte = MSG_ReadByte(this.msg);
            if (byte < 0) {
                throw new ClcBatchMoveError("clc batch move: truncated message (bitreader ran past end of buffer)");
            }
            this.buf |= byte << this.left;
            this.left += 8;
        }
    }
    readUnsigned(bits: number): number {
        this.fill(bits);
        const value = this.buf & ((1 << bits) - 1);
        this.buf >>>= bits;
        this.left -= bits;
        return value;
    }
    readSigned(bits: number): number {
        const value = this.readUnsigned(bits);
        const signBit = 1 << (bits - 1);
        return (value ^ signBit) - signBit;
    }
}
export function readBatchMoveAngleComponent(br: BitReader, prevAngle: number): number {
    const deltaFlag = br.readUnsigned(1);
    if (deltaFlag) {
        const delta = br.readSigned(8);
        return prevAngle + delta;
    }
    return br.readSigned(16);
}
export interface ClcBatchMoveFrameT {
    cmds: UsercmdT[];
}
export function readBatchMoveFrames(br: BitReader, numDups: number, decodeCmd: (br: BitReader, prev: UsercmdT | null) => UsercmdT): ClcBatchMoveFrameT[] {
    const frames: ClcBatchMoveFrameT[] = [];
    let prev: UsercmdT | null = null;
    for (let i = 0; i <= numDups; i++) {
        const numCmds = br.readUnsigned(5);
        const cmds: UsercmdT[] = [];
        for (let j = 0; j < numCmds; j++) {
            const cmd = decodeCmd(br, prev);
            cmds.push(cmd);
            prev = cmd;
        }
        frames.push({ cmds });
    }
    return frames;
}
export function seedFromPrev(prev: UsercmdT | null): UsercmdT {
    const cmd = new UsercmdT();
    if (prev) {
        cmd.angles.set(prev.angles);
        cmd.forwardmove = prev.forwardmove;
        cmd.sidemove = prev.sidemove;
        cmd.upmove = prev.upmove;
        cmd.buttons = prev.buttons;
        cmd.impulse = prev.impulse;
        cmd.msec = prev.msec;
        cmd.lightlevel = prev.lightlevel;
    }
    return cmd;
}
export const CLC_Q2PRO_MOVE_NODELTA = 10;
export const CLC_Q2PRO_MOVE_BATCHED = 11;
export class BitWriter {
    private buf = 0;
    private left = 0;
    constructor(private readonly msg: SizeBuf) { }
    writeUnsigned(value: number, bits: number): void {
        this.buf |= (value & ((1 << bits) - 1)) << this.left;
        this.left += bits;
        while (this.left >= 8) {
            MSG_WriteByte(this.msg, this.buf & 0xff);
            this.buf >>>= 8;
            this.left -= 8;
        }
    }
    writeSigned(value: number, bits: number): void {
        this.writeUnsigned(value & ((1 << bits) - 1), bits);
    }
    flush(): void {
        if (this.left > 0) {
            MSG_WriteByte(this.msg, this.buf & 0xff);
            this.buf = 0;
            this.left = 0;
        }
    }
}
export function writeBatchMoveFrames(bw: BitWriter, frames: ClcBatchMoveFrameT[], encodeCmd: (bw: BitWriter, cmd: UsercmdT, prev: UsercmdT | null) => void): void {
    let prev: UsercmdT | null = null;
    for (const frame of frames) {
        bw.writeUnsigned(frame.cmds.length, 5);
        for (const cmd of frame.cmds) {
            encodeCmd(bw, cmd, prev);
            prev = cmd;
        }
    }
    bw.flush();
}
