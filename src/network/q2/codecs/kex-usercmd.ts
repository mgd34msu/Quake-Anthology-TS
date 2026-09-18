import { MSG_ReadByte, MSG_ReadFloat, MSG_ReadLong, MSG_WriteByte, MSG_WriteFloat, MSG_WriteLong } from '../message.ts';
import type { SizeBuf } from '../message.ts';
import { ANGLE2SHORT, SHORT2ANGLE } from '../state.ts';
import type { UsercmdT } from '../state.ts';
// Retail 2023 reader 0x140313080: float angles/movement, optional server frame, mandatory msec.
export function readKexUsercmd(message: SizeBuf, from: UsercmdT, to: UsercmdT): void {
    const bits = MSG_ReadByte(message);
    to.angles.set(from.angles); to.forwardmove = from.forwardmove; to.sidemove = from.sidemove;
    to.buttons = from.buttons; to.serverFrame = from.serverFrame; to.upmove = 0; to.impulse = 0;
    for (let axis = 0; axis < 3; axis++) if ((bits & (1 << axis)) !== 0) to.angles[axis] = ANGLE2SHORT(MSG_ReadFloat(message));
    if ((bits & 8) !== 0) to.forwardmove = MSG_ReadFloat(message);
    if ((bits & 16) !== 0) to.sidemove = MSG_ReadFloat(message);
    if ((bits & 64) !== 0) to.buttons = MSG_ReadByte(message);
    if ((bits & 128) !== 0) to.serverFrame = MSG_ReadLong(message);
    to.msec = MSG_ReadByte(message);
}
export function writeKexUsercmd(message: SizeBuf, from: UsercmdT, to: UsercmdT): void {
    let bits = 0;
    for (let axis = 0; axis < 3; axis++) if (from.angles[axis] !== to.angles[axis]) bits |= 1 << axis;
    if (from.forwardmove !== to.forwardmove) bits |= 8;
    if (from.sidemove !== to.sidemove) bits |= 16;
    if (from.buttons !== to.buttons) bits |= 64;
    if (from.serverFrame !== to.serverFrame) bits |= 128;
    MSG_WriteByte(message, bits);
    for (let axis = 0; axis < 3; axis++) if ((bits & (1 << axis)) !== 0) MSG_WriteFloat(message, SHORT2ANGLE(to.angles[axis] ?? 0));
    if ((bits & 8) !== 0) MSG_WriteFloat(message, to.forwardmove);
    if ((bits & 16) !== 0) MSG_WriteFloat(message, to.sidemove);
    if ((bits & 64) !== 0) MSG_WriteByte(message, to.buttons);
    if ((bits & 128) !== 0) MSG_WriteLong(message, to.serverFrame);
    MSG_WriteByte(message, to.msec);
}
