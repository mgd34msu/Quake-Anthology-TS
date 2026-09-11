import { readElement } from './state.ts';
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import { ComError } from "./constants.ts";
import { ERR_FATAL, ERR_DROP, CM_ANGLE1, CM_ANGLE2, CM_ANGLE3, CM_FORWARD, CM_SIDE, CM_UP, CM_BUTTONS, CM_IMPULSE } from "./constants.ts";
import { U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_SKIN8, U_SKIN16, U_FRAME8, U_FRAME16, U_EFFECTS8, U_EFFECTS16, U_RENDERFX8, U_RENDERFX16, U_SOLID, U_EVENT, U_MODEL, U_MODEL2, U_MODEL3, U_MODEL4, U_SOUND, U_OLDORIGIN, U_NUMBER16, U_MOREBITS1, U_MOREBITS2, U_MOREBITS3, } from "./constants.ts";
import { bytedirs, NUMVERTEXNORMALS } from "./anorms.ts";
import { type Vec3, DotProduct, VectorCopy } from "./state.ts";
import { type EntityStateT, type UsercmdT, MAX_EDICTS, RF_BEAM, ANGLE2SHORT, SHORT2ANGLE } from "./state.ts";
export type SizeBufObserver = (buf: SizeBuf, offset: number, length: number) => void;
export class SizeBuf {
    allowoverflow = false;
    overflowed = false;
    observer: SizeBufObserver | null = null;
    data: Uint8Array = new Uint8Array(0);
    view: DataView = new DataView(new ArrayBuffer(0));
    maxsize = 0;
    cursize = 0;
    readcount = 0;
}
export function SZ_Init(buf: SizeBuf, data: Uint8Array, length: number): void {
    buf.allowoverflow = false;
    buf.overflowed = false;
    buf.cursize = 0;
    buf.readcount = 0;
    buf.data = data;
    buf.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    buf.maxsize = length;
}
export function SZ_Clear(buf: SizeBuf): void {
    buf.cursize = 0;
    buf.overflowed = false;
}
export function SZ_GetSpace(buf: SizeBuf, length: number): number {
    if (buf.observer)
        buf.observer(buf, buf.cursize, length);
    if (buf.cursize + length > buf.maxsize) {
        if (!buf.allowoverflow) {
            throw new ComError(ERR_FATAL, "SZ_GetSpace: overflow without allowoverflow set");
        }
        if (length > buf.maxsize) {
            throw new ComError(ERR_FATAL, `SZ_GetSpace: ${length} is > full buffer size`);
        }
        SZ_Clear(buf);
        buf.overflowed = true;
    }
    const offset = buf.cursize;
    buf.cursize += length;
    return offset;
}
export function SZ_Write(buf: SizeBuf, data: Uint8Array, length: number): void {
    const offset = SZ_GetSpace(buf, length);
    buf.data.set(data.subarray(0, length), offset);
}
export function SZ_Print(buf: SizeBuf, text: string): void {
    const bytes = stringToBytesNulTerminated(text);
    const len = bytes.length;
    if (buf.cursize) {
        if (readElement(buf.data, buf.cursize - 1) !== 0) {
            const offset = SZ_GetSpace(buf, len);
            buf.data.set(bytes, offset);
        }
        else {
            const offset = SZ_GetSpace(buf, len - 1) - 1;
            buf.data.set(bytes, offset);
        }
    }
    else {
        const offset = SZ_GetSpace(buf, len);
        buf.data.set(bytes, offset);
    }
}
function stringToBytes(s: string): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++)
        out[i] = s.charCodeAt(i) & 0xff;
    return out;
}
function stringToBytesNulTerminated(s: string): Uint8Array {
    const out = new Uint8Array(s.length + 1);
    for (let i = 0; i < s.length; i++)
        out[i] = s.charCodeAt(i) & 0xff;
    out[s.length] = 0;
    return out;
}
export function MSG_WriteChar(sb: SizeBuf, c: number): void {
    const offset = SZ_GetSpace(sb, 1);
    sb.data[offset] = c & 0xff;
}
export function MSG_WriteByte(sb: SizeBuf, c: number): void {
    const offset = SZ_GetSpace(sb, 1);
    sb.data[offset] = c & 0xff;
}
export function MSG_WriteShort(sb: SizeBuf, c: number): void {
    const offset = SZ_GetSpace(sb, 2);
    sb.data[offset] = c & 0xff;
    sb.data[offset + 1] = (c >> 8) & 0xff;
}
export function MSG_WriteLong(sb: SizeBuf, c: number): void {
    const offset = SZ_GetSpace(sb, 4);
    sb.data[offset] = c & 0xff;
    sb.data[offset + 1] = (c >> 8) & 0xff;
    sb.data[offset + 2] = (c >> 16) & 0xff;
    sb.data[offset + 3] = (c >> 24) & 0xff;
}
export function MSG_WriteFloat(sb: SizeBuf, f: number): void {
    const offset = SZ_GetSpace(sb, 4);
    sb.view.setFloat32(offset, f, true);
}
export function MSG_WriteLong64(sb: SizeBuf, c: bigint): void {
    const offset = SZ_GetSpace(sb, 8);
    sb.view.setBigInt64(offset, c, true);
}
export function MSG_WriteString(sb: SizeBuf, s: string | null): void {
    if (s === null) {
        SZ_Write(sb, new Uint8Array([0]), 1);
    }
    else {
        const bytes = stringToBytesNulTerminated(s);
        SZ_Write(sb, bytes, bytes.length);
    }
}
export function MSG_WriteCoord(sb: SizeBuf, f: number): void {
    MSG_WriteShort(sb, Math.trunc(f * 8));
}
export function MSG_WritePos(sb: SizeBuf, pos: Vec3): void {
    MSG_WriteShort(sb, Math.trunc(readElement(pos, 0) * 8));
    MSG_WriteShort(sb, Math.trunc(readElement(pos, 1) * 8));
    MSG_WriteShort(sb, Math.trunc(readElement(pos, 2) * 8));
}
export function MSG_WriteAngle(sb: SizeBuf, f: number): void {
    MSG_WriteByte(sb, Math.trunc((f * 256) / 360) & 255);
}
export function MSG_WriteAngle16(sb: SizeBuf, f: number): void {
    MSG_WriteShort(sb, ANGLE2SHORT(f));
}
export function MSG_WriteDeltaUsercmd(buf: SizeBuf, from: UsercmdT, cmd: UsercmdT): void {
    let bits = 0;
    if (readElement(cmd.angles, 0) !== readElement(from.angles, 0))
        bits |= CM_ANGLE1;
    if (readElement(cmd.angles, 1) !== readElement(from.angles, 1))
        bits |= CM_ANGLE2;
    if (readElement(cmd.angles, 2) !== readElement(from.angles, 2))
        bits |= CM_ANGLE3;
    if (cmd.forwardmove !== from.forwardmove)
        bits |= CM_FORWARD;
    if (cmd.sidemove !== from.sidemove)
        bits |= CM_SIDE;
    if (cmd.upmove !== from.upmove)
        bits |= CM_UP;
    if (cmd.buttons !== from.buttons)
        bits |= CM_BUTTONS;
    if (cmd.impulse !== from.impulse)
        bits |= CM_IMPULSE;
    MSG_WriteByte(buf, bits);
    if (bits & CM_ANGLE1)
        MSG_WriteShort(buf, readElement(cmd.angles, 0));
    if (bits & CM_ANGLE2)
        MSG_WriteShort(buf, readElement(cmd.angles, 1));
    if (bits & CM_ANGLE3)
        MSG_WriteShort(buf, readElement(cmd.angles, 2));
    if (bits & CM_FORWARD)
        MSG_WriteShort(buf, cmd.forwardmove);
    if (bits & CM_SIDE)
        MSG_WriteShort(buf, cmd.sidemove);
    if (bits & CM_UP)
        MSG_WriteShort(buf, cmd.upmove);
    if (bits & CM_BUTTONS)
        MSG_WriteByte(buf, cmd.buttons);
    if (bits & CM_IMPULSE)
        MSG_WriteByte(buf, cmd.impulse);
    MSG_WriteByte(buf, cmd.msec);
    MSG_WriteByte(buf, cmd.lightlevel);
}
export function MSG_WriteDir(sb: SizeBuf, dir: Vec3 | null): void {
    if (!dir) {
        MSG_WriteByte(sb, 0);
        return;
    }
    let bestd = 0;
    let best = 0;
    for (let i = 0; i < NUMVERTEXNORMALS; i++) {
        const d = DotProduct(dir, readElement(bytedirs, i));
        if (d > bestd) {
            bestd = d;
            best = i;
        }
    }
    MSG_WriteByte(sb, best);
}
export function MSG_ReadDir(sb: SizeBuf, dir: Vec3): void {
    const b = MSG_ReadByte(sb);
    if (b >= NUMVERTEXNORMALS) {
        throw new ComError(ERR_DROP, "MSF_ReadDir: out of range");
    }
    VectorCopy(readElement(bytedirs, b), dir);
}
export function MSG_WriteDeltaEntity(from: EntityStateT, to: EntityStateT, msg: SizeBuf, force: boolean, newentity: boolean): void {
    if (!to.number) {
        throw new ComError(ERR_FATAL, "Unset entity number");
    }
    if (to.number >= MAX_EDICTS) {
        throw new ComError(ERR_FATAL, "Entity number >= MAX_EDICTS");
    }
    let bits = 0;
    if (to.number >= 256)
        bits |= U_NUMBER16;
    if (readElement(to.origin, 0) !== readElement(from.origin, 0))
        bits |= U_ORIGIN1;
    if (readElement(to.origin, 1) !== readElement(from.origin, 1))
        bits |= U_ORIGIN2;
    if (readElement(to.origin, 2) !== readElement(from.origin, 2))
        bits |= U_ORIGIN3;
    if (readElement(to.angles, 0) !== readElement(from.angles, 0))
        bits |= U_ANGLE1;
    if (readElement(to.angles, 1) !== readElement(from.angles, 1))
        bits |= U_ANGLE2;
    if (readElement(to.angles, 2) !== readElement(from.angles, 2))
        bits |= U_ANGLE3;
    if (to.skinnum !== from.skinnum) {
        if ((to.skinnum >>> 0) < 256)
            bits |= U_SKIN8;
        else if ((to.skinnum >>> 0) < 0x10000)
            bits |= U_SKIN16;
        else
            bits |= U_SKIN8 | U_SKIN16;
    }
    if (to.frame !== from.frame) {
        if (to.frame < 256)
            bits |= U_FRAME8;
        else
            bits |= U_FRAME16;
    }
    if (to.effects !== from.effects) {
        if (to.effects < 256)
            bits |= U_EFFECTS8;
        else if (to.effects < 0x8000)
            bits |= U_EFFECTS16;
        else
            bits |= U_EFFECTS8 | U_EFFECTS16;
    }
    if (to.renderfx !== from.renderfx) {
        if (to.renderfx < 256)
            bits |= U_RENDERFX8;
        else if (to.renderfx < 0x8000)
            bits |= U_RENDERFX16;
        else
            bits |= U_RENDERFX8 | U_RENDERFX16;
    }
    if (to.solid !== from.solid)
        bits |= U_SOLID;
    if (to.event)
        bits |= U_EVENT;
    if (to.modelindex !== from.modelindex)
        bits |= U_MODEL;
    if (to.modelindex2 !== from.modelindex2)
        bits |= U_MODEL2;
    if (to.modelindex3 !== from.modelindex3)
        bits |= U_MODEL3;
    if (to.modelindex4 !== from.modelindex4)
        bits |= U_MODEL4;
    if (to.sound !== from.sound)
        bits |= U_SOUND;
    if (newentity || to.renderfx & RF_BEAM)
        bits |= U_OLDORIGIN;
    if (!bits && !force)
        return;
    if (bits & 0xff000000)
        bits |= U_MOREBITS3 | U_MOREBITS2 | U_MOREBITS1;
    else if (bits & 0x00ff0000)
        bits |= U_MOREBITS2 | U_MOREBITS1;
    else if (bits & 0x0000ff00)
        bits |= U_MOREBITS1;
    MSG_WriteByte(msg, bits & 255);
    if (bits & 0xff000000) {
        MSG_WriteByte(msg, (bits >> 8) & 255);
        MSG_WriteByte(msg, (bits >> 16) & 255);
        MSG_WriteByte(msg, (bits >> 24) & 255);
    }
    else if (bits & 0x00ff0000) {
        MSG_WriteByte(msg, (bits >> 8) & 255);
        MSG_WriteByte(msg, (bits >> 16) & 255);
    }
    else if (bits & 0x0000ff00) {
        MSG_WriteByte(msg, (bits >> 8) & 255);
    }
    if (bits & U_NUMBER16)
        MSG_WriteShort(msg, to.number);
    else
        MSG_WriteByte(msg, to.number);
    if (bits & U_MODEL)
        MSG_WriteByte(msg, to.modelindex);
    if (bits & U_MODEL2)
        MSG_WriteByte(msg, to.modelindex2);
    if (bits & U_MODEL3)
        MSG_WriteByte(msg, to.modelindex3);
    if (bits & U_MODEL4)
        MSG_WriteByte(msg, to.modelindex4);
    if (bits & U_FRAME8)
        MSG_WriteByte(msg, to.frame);
    if (bits & U_FRAME16)
        MSG_WriteShort(msg, to.frame);
    if (bits & U_SKIN8 && bits & U_SKIN16)
        MSG_WriteLong(msg, to.skinnum);
    else if (bits & U_SKIN8)
        MSG_WriteByte(msg, to.skinnum);
    else if (bits & U_SKIN16)
        MSG_WriteShort(msg, to.skinnum);
    if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16))
        MSG_WriteLong(msg, to.effects);
    else if (bits & U_EFFECTS8)
        MSG_WriteByte(msg, to.effects);
    else if (bits & U_EFFECTS16)
        MSG_WriteShort(msg, to.effects);
    if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16))
        MSG_WriteLong(msg, to.renderfx);
    else if (bits & U_RENDERFX8)
        MSG_WriteByte(msg, to.renderfx);
    else if (bits & U_RENDERFX16)
        MSG_WriteShort(msg, to.renderfx);
    if (bits & U_ORIGIN1)
        MSG_WriteCoord(msg, readElement(to.origin, 0));
    if (bits & U_ORIGIN2)
        MSG_WriteCoord(msg, readElement(to.origin, 1));
    if (bits & U_ORIGIN3)
        MSG_WriteCoord(msg, readElement(to.origin, 2));
    if (bits & U_ANGLE1)
        MSG_WriteAngle(msg, readElement(to.angles, 0));
    if (bits & U_ANGLE2)
        MSG_WriteAngle(msg, readElement(to.angles, 1));
    if (bits & U_ANGLE3)
        MSG_WriteAngle(msg, readElement(to.angles, 2));
    if (bits & U_OLDORIGIN) {
        MSG_WriteCoord(msg, readElement(to.old_origin, 0));
        MSG_WriteCoord(msg, readElement(to.old_origin, 1));
        MSG_WriteCoord(msg, readElement(to.old_origin, 2));
    }
    if (bits & U_SOUND)
        MSG_WriteByte(msg, to.sound);
    if (bits & U_EVENT)
        MSG_WriteByte(msg, to.event);
    if (bits & U_SOLID)
        MSG_WriteShort(msg, to.solid);
}
export function MSG_BeginReading(msg: SizeBuf): void {
    msg.readcount = 0;
}
export function MSG_ReadChar(msgRead: SizeBuf): number {
    let c: number;
    if (msgRead.readcount + 1 > msgRead.cursize) {
        c = -1;
    }
    else {
        const b = readElement(msgRead.data, msgRead.readcount);
        c = (b << 24) >> 24;
    }
    msgRead.readcount++;
    return c;
}
export function MSG_ReadByte(msgRead: SizeBuf): number {
    let c: number;
    if (msgRead.readcount + 1 > msgRead.cursize) {
        c = -1;
    }
    else {
        c = readElement(msgRead.data, msgRead.readcount);
    }
    msgRead.readcount++;
    return c;
}
export function MSG_ReadShort(msgRead: SizeBuf): number {
    let c: number;
    if (msgRead.readcount + 2 > msgRead.cursize) {
        c = -1;
    }
    else {
        const b0 = readElement(msgRead.data, msgRead.readcount);
        const b1 = readElement(msgRead.data, msgRead.readcount + 1);
        c = (((b0 | (b1 << 8)) << 16) >> 16);
    }
    msgRead.readcount += 2;
    return c;
}
export function MSG_ReadWord(msgRead: SizeBuf): number {
    let c: number;
    if (msgRead.readcount + 2 > msgRead.cursize) {
        c = -1;
    }
    else {
        const b0 = readElement(msgRead.data, msgRead.readcount);
        const b1 = readElement(msgRead.data, msgRead.readcount + 1);
        c = (b0 | (b1 << 8)) >>> 0;
    }
    msgRead.readcount += 2;
    return c;
}
export function MSG_ReadLong(msgRead: SizeBuf): number {
    let c: number;
    if (msgRead.readcount + 4 > msgRead.cursize) {
        c = -1;
    }
    else {
        const b0 = readElement(msgRead.data, msgRead.readcount);
        const b1 = readElement(msgRead.data, msgRead.readcount + 1);
        const b2 = readElement(msgRead.data, msgRead.readcount + 2);
        const b3 = readElement(msgRead.data, msgRead.readcount + 3);
        c = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }
    msgRead.readcount += 4;
    return c;
}
export function MSG_ReadFloat(msgRead: SizeBuf): number {
    let f: number;
    if (msgRead.readcount + 4 > msgRead.cursize) {
        f = -1;
    }
    else {
        f = msgRead.view.getFloat32(msgRead.readcount, true);
    }
    msgRead.readcount += 4;
    return f;
}
export function MSG_ReadLong64(msgRead: SizeBuf): bigint {
    let c: bigint;
    if (msgRead.readcount + 8 > msgRead.cursize) {
        c = -1n;
    }
    else {
        c = msgRead.view.getBigInt64(msgRead.readcount, true);
    }
    msgRead.readcount += 8;
    return c;
}
export function MSG_ReadString(msgRead: SizeBuf): string {
    let s = "";
    let l = 0;
    do {
        const c = MSG_ReadChar(msgRead);
        if (c === -1 || c === 0)
            break;
        s += String.fromCharCode(c & 0xff);
        l++;
    } while (l < 2048 - 1);
    return s;
}
export function MSG_ReadStringLine(msgRead: SizeBuf): string {
    let s = "";
    let l = 0;
    do {
        const c = MSG_ReadChar(msgRead);
        if (c === -1 || c === 0 || c === 10)
            break;
        s += String.fromCharCode(c & 0xff);
        l++;
    } while (l < 2048 - 1);
    return s;
}
export function MSG_ReadCoord(msgRead: SizeBuf): number {
    return MSG_ReadShort(msgRead) * (1.0 / 8);
}
export function MSG_ReadPos(msgRead: SizeBuf, pos: Vec3): void {
    pos[0] = MSG_ReadShort(msgRead) * (1.0 / 8);
    pos[1] = MSG_ReadShort(msgRead) * (1.0 / 8);
    pos[2] = MSG_ReadShort(msgRead) * (1.0 / 8);
}
export function MSG_ReadAngle(msgRead: SizeBuf): number {
    return MSG_ReadChar(msgRead) * (360.0 / 256);
}
export function MSG_ReadAngle16(msgRead: SizeBuf): number {
    return SHORT2ANGLE(MSG_ReadShort(msgRead));
}
export function MSG_ReadDeltaUsercmd(msgRead: SizeBuf, from: UsercmdT, move: UsercmdT): void {
    move.msec = from.msec;
    move.buttons = from.buttons;
    move.angles[0] = readElement(from.angles, 0);
    move.angles[1] = readElement(from.angles, 1);
    move.angles[2] = readElement(from.angles, 2);
    move.forwardmove = from.forwardmove;
    move.sidemove = from.sidemove;
    move.upmove = from.upmove;
    move.impulse = from.impulse;
    move.lightlevel = from.lightlevel;
    const bits = MSG_ReadByte(msgRead);
    if (bits & CM_ANGLE1)
        move.angles[0] = MSG_ReadShort(msgRead);
    if (bits & CM_ANGLE2)
        move.angles[1] = MSG_ReadShort(msgRead);
    if (bits & CM_ANGLE3)
        move.angles[2] = MSG_ReadShort(msgRead);
    if (bits & CM_FORWARD)
        move.forwardmove = MSG_ReadShort(msgRead);
    if (bits & CM_SIDE)
        move.sidemove = MSG_ReadShort(msgRead);
    if (bits & CM_UP)
        move.upmove = MSG_ReadShort(msgRead);
    if (bits & CM_BUTTONS)
        move.buttons = MSG_ReadByte(msgRead);
    if (bits & CM_IMPULSE)
        move.impulse = MSG_ReadByte(msgRead);
    move.msec = MSG_ReadByte(msgRead);
    move.lightlevel = MSG_ReadByte(msgRead);
}
export function MSG_ReadData(msgRead: SizeBuf, data: Uint8Array, len: number): void {
    for (let i = 0; i < len; i++) {
        data[i] = MSG_ReadByte(msgRead) & 0xff;
    }
}
export { stringToBytes };
export function createMessage(capacity = 32768): SizeBuf {
    if (!Number.isSafeInteger(capacity) || capacity < 0)
        throw new RangeError("Invalid Q2 message capacity");
    const message = new SizeBuf();
    SZ_Init(message, new Uint8Array(capacity), capacity);
    return message;
}
export function loadMessage(message: SizeBuf, bytes: Uint8Array): void {
    SZ_Init(message, bytes, bytes.length);
    message.cursize = bytes.length;
}
export function messageBytes(message: SizeBuf): Uint8Array { return message.data.slice(0, message.cursize); }
export function checkMessageRead(message: SizeBuf): void {
    if (message.readcount > message.cursize)
        throw new ComError(ERR_DROP, "Truncated Quake II message");
}
