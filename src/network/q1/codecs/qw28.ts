// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
import { AXES } from "../wire-types.ts";
import type { MessageReader } from "../message.ts";
import { MSG_WriteByte, MSG_WriteCoord, MSG_WriteLong, MSG_WriteShort, type SizeBuf, } from "../message.ts";
import type { Vec3 } from "../wire-types.ts";
import type { EntityStateT } from "../wire-types.ts";
import { Sys_Error } from "../wire-types.ts";
import { CM_ANGLE1, CM_ANGLE2, CM_ANGLE3, CM_BUTTONS, CM_FORWARD, CM_IMPULSE, CM_SIDE, CM_UP, DEFAULT_SOUND_PACKET_ATTENUATION, DEFAULT_SOUND_PACKET_VOLUME, MAX_PACKET_ENTITIES, PROTOCOL_VERSION, type QwEntityStateT, type QwUsercmdT, SND_ATTENUATION, SND_VOLUME, SvcOpsT, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_COLORMAP, U_EFFECTS, U_FRAME, U_MODEL, U_MOREBITS, U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_REMOVE, U_SKIN, U_SOLID, } from "../qw-constants.ts";
import { MAX_DATAGRAM, MAX_MSGLEN } from "../wire-types.ts";
import type { QwEntityWordT, QwProtocolCodec, SoundMessageT, } from "./codec.ts";
export const QW28_MAX_ENTITY_NUMBER = 512;
export const QW28_MAX_PRECACHE = 256;
export function qwNoNetQuakeOp(protocol: number, op: string): never {
    return Sys_Error(`protocol ${protocol} (QuakeWorld) has no ${op}`);
}
export function qwWriteAngle(sb: SizeBuf, f: number): void {
    MSG_WriteByte(sb, Math.trunc((f * 256) / 360) & 255);
}
export function qwWriteAngle16(sb: SizeBuf, f: number): void {
    MSG_WriteShort(sb, Math.trunc((f * 65536) / 360) & 65535);
}
export function qwReadAngle16(reader: MessageReader): number {
    return reader.Short() * (360.0 / 65536);
}
export function qwWriteDeltaUsercmd(buf: SizeBuf, from: QwUsercmdT, cmd: QwUsercmdT): void {
    let bits = 0;
    if (cmd.angles[0] !== from.angles[0])
        bits |= CM_ANGLE1;
    if (cmd.angles[1] !== from.angles[1])
        bits |= CM_ANGLE2;
    if (cmd.angles[2] !== from.angles[2])
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
        qwWriteAngle16(buf, cmd.angles[0]);
    if (bits & CM_ANGLE2)
        qwWriteAngle16(buf, cmd.angles[1]);
    if (bits & CM_ANGLE3)
        qwWriteAngle16(buf, cmd.angles[2]);
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
}
export function qwReadDeltaUsercmd(reader: MessageReader, from: QwUsercmdT, move: QwUsercmdT): void {
    move.msec = from.msec;
    move.angles[0] = from.angles[0];
    move.angles[1] = from.angles[1];
    move.angles[2] = from.angles[2];
    move.forwardmove = from.forwardmove;
    move.sidemove = from.sidemove;
    move.upmove = from.upmove;
    move.buttons = from.buttons;
    move.impulse = from.impulse;
    const bits = reader.Byte();
    if (bits & CM_ANGLE1)
        move.angles[0] = qwReadAngle16(reader);
    if (bits & CM_ANGLE2)
        move.angles[1] = qwReadAngle16(reader);
    if (bits & CM_ANGLE3)
        move.angles[2] = qwReadAngle16(reader);
    if (bits & CM_FORWARD)
        move.forwardmove = reader.Short();
    if (bits & CM_SIDE)
        move.sidemove = reader.Short();
    if (bits & CM_UP)
        move.upmove = reader.Short();
    if (bits & CM_BUTTONS)
        move.buttons = reader.Byte();
    if (bits & CM_IMPULSE)
        move.impulse = reader.Byte();
    move.msec = reader.Byte();
}
export function createQw28Codec(reader: MessageReader): QwProtocolCodec {
    return {
        protocol: PROTOCOL_VERSION,
        name: "QuakeWorld",
        maxMsglen: MAX_MSGLEN,
        maxDatagram: MAX_DATAGRAM,
        maxPrecache: QW28_MAX_PRECACHE,
        defaultFlags: 0,
        maxEntityNumber: QW28_MAX_ENTITY_NUMBER,
        maxPacketEntities: MAX_PACKET_ENTITIES,
        writeCoord(sb: SizeBuf, f: number): void {
            MSG_WriteCoord(sb, f);
        },
        writeAngle(sb: SizeBuf, f: number): void {
            qwWriteAngle(sb, f);
        },
        readCoord(): number {
            return reader.Coord();
        },
        readAngle(): number {
            return reader.Angle();
        },
        writeProtocol(sb: SizeBuf): void {
            MSG_WriteLong(sb, PROTOCOL_VERSION);
        },
        writeStatic(sb: SizeBuf, state: EntityStateT): boolean {
            if (state.modelindex >= QW28_MAX_PRECACHE || state.frame & 0xff00)
                return false;
            MSG_WriteByte(sb, SvcOpsT.svc_spawnstatic);
            MSG_WriteByte(sb, state.modelindex);
            MSG_WriteByte(sb, state.frame);
            MSG_WriteByte(sb, state.colormap);
            MSG_WriteByte(sb, state.skin);
            for (const i of AXES) {
                MSG_WriteCoord(sb, state.origin[i]);
                qwWriteAngle(sb, state.angles[i]);
            }
            return true;
        },
        writeStaticSound(sb: SizeBuf, org: Vec3, soundNum: number, vol: number, atten: number): boolean {
            if (soundNum >= QW28_MAX_PRECACHE)
                return false;
            MSG_WriteByte(sb, SvcOpsT.svc_spawnstaticsound);
            for (const i of AXES)
                MSG_WriteCoord(sb, org[i]);
            MSG_WriteByte(sb, soundNum);
            MSG_WriteByte(sb, vol * 255);
            MSG_WriteByte(sb, atten * 64);
            return true;
        },
        writeSound(sb: SizeBuf, s: SoundMessageT): boolean {
            if (s.ent >= 1024 || s.channel >= 8)
                return false;
            if (s.soundNum >= QW28_MAX_PRECACHE)
                return false;
            let chan = (s.ent << 3) | s.channel;
            if (s.volume !== DEFAULT_SOUND_PACKET_VOLUME)
                chan |= SND_VOLUME;
            if (s.attenuation !== DEFAULT_SOUND_PACKET_ATTENUATION)
                chan |= SND_ATTENUATION;
            MSG_WriteByte(sb, SvcOpsT.svc_sound);
            MSG_WriteShort(sb, chan);
            if (chan & SND_VOLUME)
                MSG_WriteByte(sb, s.volume);
            if (chan & SND_ATTENUATION)
                MSG_WriteByte(sb, s.attenuation * 64);
            MSG_WriteByte(sb, s.soundNum);
            for (const i of AXES)
                MSG_WriteCoord(sb, s.origin[i]);
            return true;
        },
        writeEntityUpdate(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "svc_update (use writeDeltaEntity)");
        },
        writeBaseline(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "a NetQuake svc_spawnbaseline (use writeQwBaseline)");
        },
        writeClientdata(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "svc_clientdata (use svc_playerinfo)");
        },
        readProtocolFlags(): number {
            return 0;
        },
        readEntityBits(): number {
            return qwNoNetQuakeOp(PROTOCOL_VERSION, "svc_update (use readDeltaEntityHeader)");
        },
        readEntityUpdateTail(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "svc_update (use readDeltaEntity)");
        },
        readBaseline(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "a NetQuake svc_spawnbaseline (use readQwBaseline)");
        },
        readClientdataBits(): number {
            return qwNoNetQuakeOp(PROTOCOL_VERSION, "svc_clientdata");
        },
        readClientdataTail(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "svc_clientdata");
        },
        readSoundHeader(): void {
            qwNoNetQuakeOp(PROTOCOL_VERSION, "NetQuake's svc_sound layout");
        },
        readStaticSoundIndex(): number {
            return reader.Byte();
        },
        writeDeltaUsercmd(sb: SizeBuf, from: QwUsercmdT, cmd: QwUsercmdT): void {
            qwWriteDeltaUsercmd(sb, from, cmd);
        },
        readDeltaUsercmd(from: QwUsercmdT, move: QwUsercmdT): void {
            qwReadDeltaUsercmd(reader, from, move);
        },
        writeDeltaEntity(sb: SizeBuf, from: QwEntityStateT, to: QwEntityStateT, force: boolean): boolean {
            let bits = 0;
            for (const i of AXES) {
                const miss = to.origin[i] - from.origin[i];
                if (miss < -0.1 || miss > 0.1)
                    bits |= U_ORIGIN1 << i;
            }
            if (to.angles[0] !== from.angles[0])
                bits |= U_ANGLE1;
            if (to.angles[1] !== from.angles[1])
                bits |= U_ANGLE2;
            if (to.angles[2] !== from.angles[2])
                bits |= U_ANGLE3;
            if (to.colormap !== from.colormap)
                bits |= U_COLORMAP;
            if (to.skinnum !== from.skinnum)
                bits |= U_SKIN;
            if (to.frame !== from.frame)
                bits |= U_FRAME;
            if (to.effects !== from.effects)
                bits |= U_EFFECTS;
            if (to.modelindex !== from.modelindex)
                bits |= U_MODEL;
            if (bits & 511)
                bits |= U_MOREBITS;
            if (to.flags & U_SOLID)
                bits |= U_SOLID;
            if (to.number >= QW28_MAX_ENTITY_NUMBER)
                return false;
            if (!bits && !force)
                return true; // nothing to send!
            const i = to.number | (bits & ~511);
            if (i & U_REMOVE)
                Sys_Error("U_REMOVE");
            MSG_WriteShort(sb, i);
            if (bits & U_MOREBITS)
                MSG_WriteByte(sb, bits & 255);
            if (bits & U_MODEL)
                MSG_WriteByte(sb, to.modelindex);
            if (bits & U_FRAME)
                MSG_WriteByte(sb, to.frame);
            if (bits & U_COLORMAP)
                MSG_WriteByte(sb, to.colormap);
            if (bits & U_SKIN)
                MSG_WriteByte(sb, to.skinnum);
            if (bits & U_EFFECTS)
                MSG_WriteByte(sb, to.effects);
            if (bits & U_ORIGIN1)
                MSG_WriteCoord(sb, to.origin[0]);
            if (bits & U_ANGLE1)
                qwWriteAngle(sb, to.angles[0]);
            if (bits & U_ORIGIN2)
                MSG_WriteCoord(sb, to.origin[1]);
            if (bits & U_ANGLE2)
                qwWriteAngle(sb, to.angles[1]);
            if (bits & U_ORIGIN3)
                MSG_WriteCoord(sb, to.origin[2]);
            if (bits & U_ANGLE3)
                qwWriteAngle(sb, to.angles[2]);
            return true;
        },
        writeRemoveEntity(sb: SizeBuf, entnum: number): void {
            MSG_WriteShort(sb, entnum | U_REMOVE);
        },
        writePacketEntitiesEnd(sb: SizeBuf): void {
            MSG_WriteShort(sb, 0); // end of packetentities
        },
        readDeltaEntityHeader(word: number, out: QwEntityWordT): void {
            out.clear();
            out.number = word & 511;
            let bits = word & ~511;
            if (bits & U_MOREBITS) {
                const i = reader.Byte();
                bits |= i;
            }
            out.bits = bits;
            out.remove = (bits & U_REMOVE) !== 0;
        },
        readDeltaEntity(from: QwEntityStateT, to: QwEntityStateT, hdr: QwEntityWordT): void {
            to.copyFrom(from);
            to.number = hdr.number;
            const bits = hdr.bits;
            to.flags = bits;
            if (bits & U_MODEL)
                to.modelindex = reader.Byte();
            if (bits & U_FRAME)
                to.frame = reader.Byte();
            if (bits & U_COLORMAP)
                to.colormap = reader.Byte();
            if (bits & U_SKIN)
                to.skinnum = reader.Byte();
            if (bits & U_EFFECTS)
                to.effects = reader.Byte();
            if (bits & U_ORIGIN1)
                to.origin[0] = reader.Coord();
            if (bits & U_ANGLE1)
                to.angles[0] = reader.Angle();
            if (bits & U_ORIGIN2)
                to.origin[1] = reader.Coord();
            if (bits & U_ANGLE2)
                to.angles[1] = reader.Angle();
            if (bits & U_ORIGIN3)
                to.origin[2] = reader.Coord();
            if (bits & U_ANGLE3)
                to.angles[2] = reader.Angle();
        },
        writeQwBaseline(sb: SizeBuf, es: QwEntityStateT): void {
            MSG_WriteByte(sb, es.modelindex);
            MSG_WriteByte(sb, es.frame);
            MSG_WriteByte(sb, es.colormap);
            MSG_WriteByte(sb, es.skinnum);
            for (const i of AXES) {
                MSG_WriteCoord(sb, es.origin[i]);
                qwWriteAngle(sb, es.angles[i]);
            }
        },
        readQwBaseline(es: QwEntityStateT): void {
            es.modelindex = reader.Byte();
            es.frame = reader.Byte();
            es.colormap = reader.Byte();
            es.skinnum = reader.Byte();
            for (const i of AXES) {
                es.origin[i] = reader.Coord();
                es.angles[i] = reader.Angle();
            }
        },
        writeModelIndex(sb: SizeBuf, n: number): void {
            MSG_WriteByte(sb, n);
        },
        readModelIndex(): number {
            return reader.Byte();
        },
        writeSoundIndex(sb: SizeBuf, n: number): void {
            MSG_WriteByte(sb, n);
        },
        readSoundIndex(): number {
            return reader.Byte();
        },
        writePrecacheCount(sb: SizeBuf, n: number): void {
            MSG_WriteByte(sb, n);
        },
        readPrecacheCount(): number {
            return reader.Byte();
        },
    };
}
