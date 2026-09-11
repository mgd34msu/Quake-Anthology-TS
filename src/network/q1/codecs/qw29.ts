// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
import { AXES } from "../wire-types.ts";
import type { MessageReader } from "../message.ts";
import { MSG_WriteByte, MSG_WriteCoordFlags, MSG_WriteAngleFlags, MSG_WriteLong, MSG_WriteShort, type SizeBuf, } from "../message.ts";
import type { Vec3 } from "../wire-types.ts";
import type { EntityStateT } from "../wire-types.ts";
import { Sys_Error } from "../wire-types.ts";
import { PRFL_INT32COORD, PRFL_SHORTANGLE } from "../constants.ts";
import { DEFAULT_SOUND_PACKET_ATTENUATION, DEFAULT_SOUND_PACKET_VOLUME, type QwEntityStateT, SND_ATTENUATION, SND_VOLUME, SvcOpsT, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_COLORMAP, U_EFFECTS, U_FRAME, U_MODEL, U_MOREBITS, U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_REMOVE, U_SKIN, U_SOLID, } from "../qw-constants.ts";
import { MAX_MODELS } from "../wire-types.ts";
import type { QwEntityWordT, QwProtocolCodec, SoundMessageT } from "./codec.ts";
import { createQw28Codec, qwNoNetQuakeOp } from "./qw28.ts";
export const PROTOCOL_QW_WIDE = 29;
export const QW29_DEFAULT_FLAGS = PRFL_INT32COORD | PRFL_SHORTANGLE;
export const U_EXTEND = 1 << 7;
export const U_ENTITY2 = 1 << 0; // a high byte of entity number follows
export const U_MODEL2 = 1 << 1; // a high byte of modelindex follows
export const U_FRAME2 = 1 << 2; // a high byte of frame follows
export const U_ALPHA = 1 << 3;
export const U_SCALE = 1 << 4;
export const QW29_MAX_ENTITY_NUMBER = 65536;
function writeEntityHeader(sb: SizeBuf, entnum: number, bitsIn: number, ext: number): void {
    let bits = bitsIn;
    if (ext)
        bits |= U_EXTEND;
    if (bits & 511)
        bits |= U_MOREBITS;
    MSG_WriteShort(sb, (entnum & 511) | (bits & ~511));
    if (bits & U_MOREBITS)
        MSG_WriteByte(sb, bits & 255);
    if (bits & U_EXTEND)
        MSG_WriteByte(sb, ext);
    if (ext & U_ENTITY2)
        MSG_WriteByte(sb, (entnum >> 9) & 255);
}
export function createQw29Codec(reader: MessageReader): QwProtocolCodec {
    return {
        ...createQw28Codec(reader),
        protocol: PROTOCOL_QW_WIDE,
        name: "QuakeWorld wide",
        maxPrecache: MAX_MODELS,
        defaultFlags: QW29_DEFAULT_FLAGS,
        maxEntityNumber: QW29_MAX_ENTITY_NUMBER,
        writeCoord(sb: SizeBuf, f: number, flags: number): void {
            MSG_WriteCoordFlags(sb, f, flags);
        },
        writeAngle(sb: SizeBuf, f: number, flags: number): void {
            MSG_WriteAngleFlags(sb, f, flags);
        },
        readCoord(flags: number): number {
            return reader.CoordFlags(flags);
        },
        readAngle(flags: number): number {
            return reader.AngleFlags(flags);
        },
        writeProtocol(sb: SizeBuf, flags: number): void {
            MSG_WriteLong(sb, PROTOCOL_QW_WIDE);
            MSG_WriteLong(sb, flags);
        },
        writeStatic(sb: SizeBuf, state: EntityStateT, flags: number): boolean {
            if (state.modelindex >= MAX_MODELS || state.frame & 0xffff0000)
                return false;
            MSG_WriteByte(sb, SvcOpsT.svc_spawnstatic);
            MSG_WriteShort(sb, state.modelindex);
            MSG_WriteShort(sb, state.frame);
            MSG_WriteByte(sb, state.colormap);
            MSG_WriteByte(sb, state.skin);
            MSG_WriteByte(sb, state.alpha);
            MSG_WriteByte(sb, state.scale);
            for (const i of AXES) {
                MSG_WriteCoordFlags(sb, state.origin[i], flags);
                MSG_WriteAngleFlags(sb, state.angles[i], flags);
            }
            return true;
        },
        writeStaticSound(sb: SizeBuf, org: Vec3, soundNum: number, vol: number, atten: number, flags: number): boolean {
            if (soundNum > 65535)
                return false;
            MSG_WriteByte(sb, SvcOpsT.svc_spawnstaticsound);
            for (const i of AXES)
                MSG_WriteCoordFlags(sb, org[i], flags);
            MSG_WriteShort(sb, soundNum);
            MSG_WriteByte(sb, vol * 255);
            MSG_WriteByte(sb, atten * 64);
            return true;
        },
        writeSound(sb: SizeBuf, s: SoundMessageT, flags: number): boolean {
            if (s.ent >= 1024 || s.channel >= 8)
                return false;
            if (s.soundNum > 65535)
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
            MSG_WriteShort(sb, s.soundNum);
            for (const i of AXES)
                MSG_WriteCoordFlags(sb, s.origin[i], flags);
            return true;
        },
        readProtocolFlags(): number {
            return reader.Long();
        },
        readStaticSoundIndex(): number {
            return reader.Short() & 0xffff;
        },
        writeDeltaEntity(sb: SizeBuf, from: QwEntityStateT, to: QwEntityStateT, force: boolean, flags: number): boolean {
            let bits = 0;
            let ext = 0;
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
            if (bits & U_MODEL && (to.modelindex & 0xff00) !== 0)
                ext |= U_MODEL2;
            if (bits & U_FRAME && (to.frame & 0xff00) !== 0)
                ext |= U_FRAME2;
            if (to.alpha !== from.alpha)
                ext |= U_ALPHA;
            if (to.scale !== from.scale)
                ext |= U_SCALE;
            if (to.flags & U_SOLID)
                bits |= U_SOLID;
            if (to.number >= QW29_MAX_ENTITY_NUMBER)
                return false;
            if (!bits && !ext && !force)
                return true; // nothing to send!
            if (to.number >= 512)
                ext |= U_ENTITY2;
            if (bits & U_REMOVE)
                Sys_Error("U_REMOVE");
            writeEntityHeader(sb, to.number, bits, ext);
            if (bits & U_MODEL)
                MSG_WriteByte(sb, to.modelindex & 255);
            if (bits & U_FRAME)
                MSG_WriteByte(sb, to.frame & 255);
            if (bits & U_COLORMAP)
                MSG_WriteByte(sb, to.colormap);
            if (bits & U_SKIN)
                MSG_WriteByte(sb, to.skinnum);
            if (bits & U_EFFECTS)
                MSG_WriteByte(sb, to.effects);
            if (bits & U_ORIGIN1)
                MSG_WriteCoordFlags(sb, to.origin[0], flags);
            if (bits & U_ANGLE1)
                MSG_WriteAngleFlags(sb, to.angles[0], flags);
            if (bits & U_ORIGIN2)
                MSG_WriteCoordFlags(sb, to.origin[1], flags);
            if (bits & U_ANGLE2)
                MSG_WriteAngleFlags(sb, to.angles[1], flags);
            if (bits & U_ORIGIN3)
                MSG_WriteCoordFlags(sb, to.origin[2], flags);
            if (bits & U_ANGLE3)
                MSG_WriteAngleFlags(sb, to.angles[2], flags);
            if (ext & U_MODEL2)
                MSG_WriteByte(sb, (to.modelindex >> 8) & 255);
            if (ext & U_FRAME2)
                MSG_WriteByte(sb, (to.frame >> 8) & 255);
            if (ext & U_ALPHA)
                MSG_WriteByte(sb, to.alpha);
            if (ext & U_SCALE)
                MSG_WriteByte(sb, to.scale);
            return true;
        },
        writeRemoveEntity(sb: SizeBuf, entnum: number): void {
            writeEntityHeader(sb, entnum, U_REMOVE, entnum >= 512 ? U_ENTITY2 : 0);
        },
        writePacketEntitiesEnd(sb: SizeBuf): void {
            MSG_WriteShort(sb, 0); // end of packetentities
        },
        readDeltaEntityHeader(word: number, out: QwEntityWordT): void {
            out.clear();
            let number = word & 511;
            let bits = word & ~511;
            if (bits & U_MOREBITS)
                bits |= reader.Byte();
            let ext = 0;
            if (bits & U_EXTEND) {
                ext = reader.Byte();
                if (ext & U_ENTITY2)
                    number |= reader.Byte() << 9;
            }
            out.bits = bits;
            out.ext = ext;
            out.number = number;
            out.remove = (bits & U_REMOVE) !== 0;
        },
        readDeltaEntity(from: QwEntityStateT, to: QwEntityStateT, hdr: QwEntityWordT, flags: number): void {
            to.copyFrom(from);
            to.number = hdr.number;
            const bits = hdr.bits;
            const ext = hdr.ext;
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
                to.origin[0] = reader.CoordFlags(flags);
            if (bits & U_ANGLE1)
                to.angles[0] = reader.AngleFlags(flags);
            if (bits & U_ORIGIN2)
                to.origin[1] = reader.CoordFlags(flags);
            if (bits & U_ANGLE2)
                to.angles[1] = reader.AngleFlags(flags);
            if (bits & U_ORIGIN3)
                to.origin[2] = reader.CoordFlags(flags);
            if (bits & U_ANGLE3)
                to.angles[2] = reader.AngleFlags(flags);
            if (ext & U_MODEL2)
                to.modelindex |= reader.Byte() << 8;
            if (ext & U_FRAME2)
                to.frame |= reader.Byte() << 8;
            if (ext & U_ALPHA)
                to.alpha = reader.Byte();
            if (ext & U_SCALE)
                to.scale = reader.Byte();
        },
        writeQwBaseline(sb: SizeBuf, es: QwEntityStateT, flags: number): void {
            MSG_WriteShort(sb, es.modelindex);
            MSG_WriteShort(sb, es.frame);
            MSG_WriteByte(sb, es.colormap);
            MSG_WriteByte(sb, es.skinnum);
            MSG_WriteByte(sb, es.alpha);
            MSG_WriteByte(sb, es.scale);
            for (const i of AXES) {
                MSG_WriteCoordFlags(sb, es.origin[i], flags);
                MSG_WriteAngleFlags(sb, es.angles[i], flags);
            }
        },
        readQwBaseline(es: QwEntityStateT, flags: number): void {
            es.modelindex = reader.Short() & 0xffff;
            es.frame = reader.Short() & 0xffff;
            es.colormap = reader.Byte();
            es.skinnum = reader.Byte();
            es.alpha = reader.Byte();
            es.scale = reader.Byte();
            for (const i of AXES) {
                es.origin[i] = reader.CoordFlags(flags);
                es.angles[i] = reader.AngleFlags(flags);
            }
        },
        writeModelIndex(sb: SizeBuf, n: number): void {
            MSG_WriteShort(sb, n);
        },
        readModelIndex(): number {
            return reader.Short() & 0xffff;
        },
        writeSoundIndex(sb: SizeBuf, n: number): void {
            MSG_WriteShort(sb, n);
        },
        readSoundIndex(): number {
            return reader.Short() & 0xffff;
        },
        writePrecacheCount(sb: SizeBuf, n: number): void {
            MSG_WriteShort(sb, n);
        },
        readPrecacheCount(): number {
            return reader.Short() & 0xffff;
        },
        writeEntityUpdate(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "svc_update (use writeDeltaEntity)");
        },
        writeBaseline(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "a NetQuake svc_spawnbaseline (use writeQwBaseline)");
        },
        writeClientdata(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "svc_clientdata (use svc_playerinfo)");
        },
        readEntityBits(): number {
            return qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "svc_update (use readDeltaEntityHeader)");
        },
        readEntityUpdateTail(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "svc_update (use readDeltaEntity)");
        },
        readBaseline(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "a NetQuake svc_spawnbaseline (use readQwBaseline)");
        },
        readClientdataBits(): number {
            return qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "svc_clientdata");
        },
        readClientdataTail(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "svc_clientdata");
        },
        readSoundHeader(): void {
            qwNoNetQuakeOp(PROTOCOL_QW_WIDE, "NetQuake's svc_sound layout");
        },
    };
}
