import { readElement } from '../state.ts';
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import { MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteLong64, MSG_WriteFloat, MSG_WriteString, MSG_WriteDeltaUsercmd, SZ_Write } from "../message.ts";
import { MSG_ReadByte, MSG_ReadChar, MSG_ReadShort, MSG_ReadWord, MSG_ReadLong, MSG_ReadLong64, MSG_ReadFloat, MSG_ReadString, MSG_ReadDeltaUsercmd, MSG_ReadData } from "../message.ts";
import { U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_FRAME8, U_FRAME16, U_EVENT, U_MOREBITS1, U_NUMBER16, U_MODEL, U_RENDERFX8, U_RENDERFX16, U_EFFECTS8, U_EFFECTS16, U_MOREBITS2, U_SKIN8, U_SKIN16, U_MODEL2, U_MODEL3, U_MODEL4, U_MOREBITS3, U_OLDORIGIN, U_SOUND, U_SOLID, PS_M_TYPE, PS_M_ORIGIN, PS_M_VELOCITY, PS_M_TIME, PS_M_FLAGS, PS_M_GRAVITY, PS_M_DELTA_ANGLES, PS_VIEWOFFSET, PS_VIEWANGLES, PS_KICKANGLES, PS_BLEND, PS_FOV, PS_WEAPONINDEX, PS_WEAPONFRAME, PS_RDFLAGS, PS_RR_VIEWHEIGHT, CM_ANGLE1, CM_ANGLE2, CM_ANGLE3, CM_FORWARD, CM_SIDE, CM_UP, CM_BUTTONS, CM_IMPULSE, SvcOpsT, ComError, ERR_DROP, PROTOCOL_VERSION_RERELEASE, PROTOCOL_VERSION_RERELEASE_CLASSIC, } from "../constants.ts";
import { SvcFogDataBitsT, type SvcFogDataT } from "../fog.ts";
import { EntityStateT, PlayerStateT, type UsercmdT, ANGLE2SHORT, SHORT2ANGLE, RF_BEAM } from "../state.ts";
import type { ProtocolCodec, ServerDataParamsT, ServerDataReadResultT, FrameWriteParamsT, FrameHeaderT, ClcBatchMoveT, ClcUserinfoDeltaT, ClcClientSettingT } from "./codec.ts";
import { createVanillaContext } from "./vanilla.ts";
import { BitReader, BitWriter, readBatchMoveAngleComponent, readBatchMoveFrames, writeBatchMoveFrames, seedFromPrev, ClcBatchMoveError, MAX_CLC_BATCH_MOVE_FRAMES, type ClcBatchMoveFrameT } from "./clc_batch_move.ts";
interface PlayerStateDeltaEncodedT {
    flags: number;
    extraflags: number;
    writeFlags(msg: SizeBuf): void;
    writeBody(msg: SizeBuf): void;
}
export function createRereleaseContext(net_message: SizeBuf) {
    const { VANILLA_CODEC } = createVanillaContext(net_message);
    const U_ANGLE16 = 1 << 13;
    const U_MODEL16 = 1 << 28;
    const U_MOREFX8 = 1 << 29;
    const U_ALPHA = 1 << 30;
    const U_MOREBITS4 = 1 << 31;
    const HI_SCALE = 1;
    const HI_MOREFX16 = 2;
    function combineBits(lo: number, hi: number): number {
        return (lo >>> 0) + hi * 4294967296;
    }
    function bitsHasHi(bits: number, hiFlag: number): boolean {
        return (Math.floor(bits / 4294967296) & hiFlag) !== 0;
    }
    const SOUND_FLAG_VOLUME = 1 << 14;
    const SOUND_FLAG_ATTENUATION = 1 << 15;
    const EPS_GUNOFFSET = 1 << 0;
    const EPS_GUNANGLES = 1 << 1;
    const EPS_M_VELOCITY2 = 1 << 2;
    const EPS_M_ORIGIN2 = 1 << 3;
    const EPS_VIEWANGLE2 = 1 << 4;
    const EPS_STATS = 1 << 5;
    const EPS_GUNRATE = 1 << 7;
    const Q2PRO_GUNINDEX_BITS = 13;
    const Q2PRO_GUNINDEX_MASK = (1 << Q2PRO_GUNINDEX_BITS) - 1;
    const PROTOCOL_Q2REPRO = PROTOCOL_VERSION_RERELEASE;
    function encodeAlpha(x: number): number {
        if (x === 0)
            return 0;
        let v = Math.trunc(x * 255);
        if (v < 1)
            v = 1;
        if (v > 255)
            v = 255;
        return v;
    }
    function decodeAlpha(b: number): number {
        return b === 0 ? 0 : b / 255;
    }
    function encodeScale(x: number): number {
        if (x === 0)
            return 0;
        let v = Math.trunc(x * 16);
        if (v < 1)
            v = 1;
        if (v > 255)
            v = 255;
        return v;
    }
    function decodeScale(b: number): number {
        return b === 0 ? 0 : b / 16;
    }
    function encodeLoopVolume(x: number): number {
        if (x === 0)
            return 0;
        let v = Math.trunc(x * 255);
        if (v < 0)
            v = 0;
        if (v > 255)
            v = 255;
        if (v === 255)
            v = 0;
        return v;
    }
    function decodeLoopVolume(b: number): number {
        return b === 0 ? 0 : b / 255;
    }
    const ATTN_LOOP_NONE = -1;
    const ENCODE_LOOP_NONE = 192;
    function encodeLoopAttenuation(x: number): number {
        if (x === ATTN_LOOP_NONE)
            return ENCODE_LOOP_NONE;
        let v = Math.trunc(x * 64);
        if (v < 0)
            v = 0;
        if (v > 255)
            v = 255;
        if (v === ENCODE_LOOP_NONE)
            v = 0;
        return v;
    }
    function decodeLoopAttenuation(b: number): number {
        return b === ENCODE_LOOP_NONE ? ATTN_LOOP_NONE : b / 64;
    }
    function clampInt16(x: number): number {
        if (x < -32768)
            return -32768;
        if (x > 32767)
            return 32767;
        return x;
    }
    function encodeFixed16(x: number, scale: number): number {
        return clampInt16(Math.trunc(x * scale));
    }
    const VIEWOFFSET_SCALE = 16;
    const GUNOFFSET_SCALE = 512;
    const KICK_ANGLE_SCALE = 1024;
    const GUNANGLE_SCALE = 4096;
    function widthOf(value: number, uint16Safe: boolean): 0 | 1 | 2 {
        const v = value >>> 0;
        const mask32 = uint16Safe ? 0xffff0000 : 0xffff8000;
        if (v & mask32)
            return 2;
        if (v & 0xff00)
            return 1;
        return 0;
    }
    function pmFloatToShort(f: number): number {
        return clampInt16(Math.round(f * 8));
    }
    function writeEntityBitsWide(msg: SizeBuf, lo0: number, hi: number, entnum: number): void {
        let lo = lo0 >>> 0;
        if (entnum >= 256)
            lo |= U_NUMBER16;
        if (hi !== 0)
            lo |= U_MOREBITS4 | U_MOREBITS3 | U_MOREBITS2 | U_MOREBITS1;
        else if (lo & 0xff000000)
            lo |= U_MOREBITS3 | U_MOREBITS2 | U_MOREBITS1;
        else if (lo & 0x00ff0000)
            lo |= U_MOREBITS2 | U_MOREBITS1;
        else if (lo & 0x0000ff00)
            lo |= U_MOREBITS1;
        MSG_WriteByte(msg, lo & 0xff);
        if (lo & U_MOREBITS1)
            MSG_WriteByte(msg, (lo >>> 8) & 0xff);
        if (lo & U_MOREBITS2)
            MSG_WriteByte(msg, (lo >>> 16) & 0xff);
        if (lo & U_MOREBITS3)
            MSG_WriteByte(msg, (lo >>> 24) & 0xff);
        if (lo & U_MOREBITS4)
            MSG_WriteByte(msg, hi & 0xff);
        if (lo & U_NUMBER16)
            MSG_WriteShort(msg, entnum);
        else
            MSG_WriteByte(msg, entnum);
    }
    function readEntityBitsWide(): {
        number: number;
        bits: number;
    } {
        let lo = MSG_ReadByte(net_message);
        if (lo & U_MOREBITS1)
            lo |= MSG_ReadByte(net_message) << 8;
        if (lo & U_MOREBITS2)
            lo |= MSG_ReadByte(net_message) << 16;
        if (lo & U_MOREBITS3)
            lo |= MSG_ReadByte(net_message) << 24;
        let hi = 0;
        if (lo & U_MOREBITS4)
            hi = MSG_ReadByte(net_message);
        let number: number;
        if (lo & U_NUMBER16)
            number = MSG_ReadWord(net_message);
        else
            number = MSG_ReadByte(net_message);
        return { number, bits: combineBits(lo, hi) };
    }
    function writeServerData(msg: SizeBuf, params: ServerDataParamsT): void {
        writeServerDataAs(PROTOCOL_Q2REPRO, msg, params);
    }
    function writeServerDataClassic(msg: SizeBuf, params: ServerDataParamsT): void {
        writeServerDataAs(PROTOCOL_VERSION_RERELEASE_CLASSIC, msg, params);
    }
    function writeServerDataAs(protocol: number, msg: SizeBuf, params: ServerDataParamsT): void {
        MSG_WriteByte(msg, SvcOpsT.svc_serverdata);
        MSG_WriteLong(msg, protocol);
        MSG_WriteLong(msg, params.servercount);
        MSG_WriteByte(msg, params.attractloop ? 1 : 0);
        MSG_WriteString(msg, params.gamedir);
        MSG_WriteShort(msg, params.clientnum);
        MSG_WriteString(msg, params.levelname);
        MSG_WriteShort(msg, params.protocolRevision ?? 1024);
        MSG_WriteByte(msg, params.serverState & 0xff);
        MSG_WriteShort(msg, params.wireFlags ?? 0);
        MSG_WriteByte(msg, params.serverFps ?? 10);
    }
    function writeDeltaEntity(msg: SizeBuf, from: EntityStateT, to: EntityStateT, force: boolean, newentity: boolean): void {
        let lo = 0;
        let hi = 0;
        if (readElement(to.origin, 0) !== readElement(from.origin, 0))
            lo |= U_ORIGIN1;
        if (readElement(to.origin, 1) !== readElement(from.origin, 1))
            lo |= U_ORIGIN2;
        if (readElement(to.origin, 2) !== readElement(from.origin, 2))
            lo |= U_ORIGIN3;
        const toAngle: [
            number,
            number,
            number
        ] = [ANGLE2SHORT(readElement(to.angles, 0)), ANGLE2SHORT(readElement(to.angles, 1)), ANGLE2SHORT(readElement(to.angles, 2))];
        const fromAngle: [
            number,
            number,
            number
        ] = [ANGLE2SHORT(readElement(from.angles, 0)), ANGLE2SHORT(readElement(from.angles, 1)), ANGLE2SHORT(readElement(from.angles, 2))];
        if (readElement(toAngle, 0) !== readElement(fromAngle, 0))
            lo |= U_ANGLE1;
        if (readElement(toAngle, 1) !== readElement(fromAngle, 1))
            lo |= U_ANGLE2;
        if (readElement(toAngle, 2) !== readElement(fromAngle, 2))
            lo |= U_ANGLE3;
        if (lo & (U_ANGLE1 | U_ANGLE2 | U_ANGLE3))
            lo |= U_ANGLE16;
        if (to.skinnum !== from.skinnum) {
            const w = widthOf(to.skinnum, true);
            lo |= w === 2 ? U_SKIN8 | U_SKIN16 : w === 1 ? U_SKIN16 : U_SKIN8;
        }
        if (to.frame !== from.frame)
            lo |= to.frame >= 256 ? U_FRAME16 : U_FRAME8;
        const effectsChanged = to.effects !== from.effects;
        const morefxChanged = to.morefx !== from.morefx;
        if (effectsChanged) {
            const w = widthOf(to.effects, true);
            lo |= w === 2 ? U_EFFECTS8 | U_EFFECTS16 : w === 1 ? U_EFFECTS16 : U_EFFECTS8;
        }
        if (morefxChanged) {
            const w = widthOf(to.morefx, true);
            if (w === 0)
                lo |= U_MOREFX8;
            else if (w === 1)
                hi |= HI_MOREFX16;
            else {
                lo |= U_MOREFX8;
                hi |= HI_MOREFX16;
            }
        }
        if (to.renderfx !== from.renderfx) {
            const w = widthOf(to.renderfx, true);
            lo |= w === 2 ? U_RENDERFX8 | U_RENDERFX16 : w === 1 ? U_RENDERFX16 : U_RENDERFX8;
        }
        if (to.solid !== from.solid)
            lo |= U_SOLID;
        if (to.event)
            lo |= U_EVENT;
        if (to.modelindex !== from.modelindex)
            lo |= U_MODEL;
        if (to.modelindex2 !== from.modelindex2)
            lo |= U_MODEL2;
        if (to.modelindex3 !== from.modelindex3)
            lo |= U_MODEL3;
        if (to.modelindex4 !== from.modelindex4)
            lo |= U_MODEL4;
        if ((lo & U_MODEL && to.modelindex > 255) ||
            (lo & U_MODEL2 && to.modelindex2 > 255) ||
            (lo & U_MODEL3 && to.modelindex3 > 255) ||
            (lo & U_MODEL4 && to.modelindex4 > 255))
            lo |= U_MODEL16;
        const soundChanged = to.sound !== from.sound;
        if (soundChanged)
            lo |= U_SOUND;
        const loopVolumeChanged = to.loop_volume !== from.loop_volume;
        const loopAttenuationChanged = to.loop_attenuation !== from.loop_attenuation;
        if (newentity || to.renderfx & RF_BEAM)
            lo |= U_OLDORIGIN;
        const alphaChanged = to.alpha !== from.alpha;
        const scaleChanged = to.scale !== from.scale;
        if (alphaChanged)
            lo |= U_ALPHA;
        if (scaleChanged)
            hi |= HI_SCALE;
        if (!lo && !hi && !force)
            return;
        writeEntityBitsWide(msg, lo, hi, to.number);
        if (lo & U_MODEL16) {
            if (lo & U_MODEL)
                MSG_WriteShort(msg, to.modelindex);
            if (lo & U_MODEL2)
                MSG_WriteShort(msg, to.modelindex2);
            if (lo & U_MODEL3)
                MSG_WriteShort(msg, to.modelindex3);
            if (lo & U_MODEL4)
                MSG_WriteShort(msg, to.modelindex4);
        }
        else {
            if (lo & U_MODEL)
                MSG_WriteByte(msg, to.modelindex);
            if (lo & U_MODEL2)
                MSG_WriteByte(msg, to.modelindex2);
            if (lo & U_MODEL3)
                MSG_WriteByte(msg, to.modelindex3);
            if (lo & U_MODEL4)
                MSG_WriteByte(msg, to.modelindex4);
        }
        if (lo & U_FRAME16)
            MSG_WriteShort(msg, to.frame);
        else if (lo & U_FRAME8)
            MSG_WriteByte(msg, to.frame);
        if ((lo & (U_SKIN8 | U_SKIN16)) === (U_SKIN8 | U_SKIN16))
            MSG_WriteLong(msg, to.skinnum);
        else if (lo & U_SKIN16)
            MSG_WriteShort(msg, to.skinnum);
        else if (lo & U_SKIN8)
            MSG_WriteByte(msg, to.skinnum);
        if ((lo & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16))
            MSG_WriteLong(msg, to.effects);
        else if (lo & U_EFFECTS16)
            MSG_WriteShort(msg, to.effects);
        else if (lo & U_EFFECTS8)
            MSG_WriteByte(msg, to.effects);
        if ((lo & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16))
            MSG_WriteLong(msg, to.renderfx);
        else if (lo & U_RENDERFX16)
            MSG_WriteShort(msg, to.renderfx);
        else if (lo & U_RENDERFX8)
            MSG_WriteByte(msg, to.renderfx);
        if (lo & U_ORIGIN1)
            MSG_WriteFloat(msg, readElement(to.origin, 0));
        if (lo & U_ORIGIN2)
            MSG_WriteFloat(msg, readElement(to.origin, 1));
        if (lo & U_ORIGIN3)
            MSG_WriteFloat(msg, readElement(to.origin, 2));
        if (lo & U_ANGLE1)
            MSG_WriteShort(msg, readElement(toAngle, 0));
        if (lo & U_ANGLE2)
            MSG_WriteShort(msg, readElement(toAngle, 1));
        if (lo & U_ANGLE3)
            MSG_WriteShort(msg, readElement(toAngle, 2));
        if (lo & U_OLDORIGIN) {
            MSG_WriteFloat(msg, readElement(to.old_origin, 0));
            MSG_WriteFloat(msg, readElement(to.old_origin, 1));
            MSG_WriteFloat(msg, readElement(to.old_origin, 2));
        }
        if (lo & U_SOUND) {
            let soundWord = to.sound & 0x3fff;
            if (loopAttenuationChanged)
                soundWord |= SOUND_FLAG_ATTENUATION;
            if (loopVolumeChanged)
                soundWord |= SOUND_FLAG_VOLUME;
            MSG_WriteShort(msg, soundWord);
            if (soundWord & SOUND_FLAG_VOLUME)
                MSG_WriteByte(msg, encodeLoopVolume(to.loop_volume));
            if (soundWord & SOUND_FLAG_ATTENUATION)
                MSG_WriteByte(msg, encodeLoopAttenuation(to.loop_attenuation));
        }
        if (lo & U_EVENT)
            MSG_WriteByte(msg, to.event);
        if (lo & U_SOLID)
            MSG_WriteLong(msg, to.solid);
        if ((hi & HI_MOREFX16) !== 0 && (lo & U_MOREFX8) !== 0)
            MSG_WriteLong(msg, to.morefx);
        else if (hi & HI_MOREFX16)
            MSG_WriteShort(msg, to.morefx);
        else if (lo & U_MOREFX8)
            MSG_WriteByte(msg, to.morefx);
        if (lo & U_ALPHA)
            MSG_WriteByte(msg, encodeAlpha(to.alpha));
        if (hi & HI_SCALE)
            MSG_WriteByte(msg, encodeScale(to.scale));
    }
    const writeEntityRemove = VANILLA_CODEC.writeEntityRemove;
    const writePacketEntitiesEnd = VANILLA_CODEC.writePacketEntitiesEnd;
    const NULL_ENTITY_STATE = new EntityStateT();
    function writeSpawnBaseline(msg: SizeBuf, base: EntityStateT): void {
        MSG_WriteByte(msg, SvcOpsT.svc_spawnbaseline);
        writeDeltaEntity(msg, NULL_ENTITY_STATE, base, true, true);
    }
    function encodePlayerStateDelta(from: PlayerStateT, to: PlayerStateT): PlayerStateDeltaEncodedT {
        let flags = 0;
        let extraflags = 0;
        const toOriginF: [
            number,
            number,
            number
        ] = [readElement(to.pmove.originF, 0), readElement(to.pmove.originF, 1), readElement(to.pmove.originF, 2)];
        const fromOriginF: [
            number,
            number,
            number
        ] = [readElement(from.pmove.originF, 0), readElement(from.pmove.originF, 1), readElement(from.pmove.originF, 2)];
        const toVelF: [
            number,
            number,
            number
        ] = [readElement(to.pmove.velocityF, 0), readElement(to.pmove.velocityF, 1), readElement(to.pmove.velocityF, 2)];
        const fromVelF: [
            number,
            number,
            number
        ] = [readElement(from.pmove.velocityF, 0), readElement(from.pmove.velocityF, 1), readElement(from.pmove.velocityF, 2)];
        if (to.pmove.pm_type !== from.pmove.pm_type)
            flags |= PS_M_TYPE;
        const originXYChanged = readElement(toOriginF, 0) !== readElement(fromOriginF, 0) || readElement(toOriginF, 1) !== readElement(fromOriginF, 1);
        const originZChanged = readElement(toOriginF, 2) !== readElement(fromOriginF, 2);
        if (originXYChanged)
            flags |= PS_M_ORIGIN;
        if (originZChanged)
            extraflags |= EPS_M_ORIGIN2;
        const velXYChanged = readElement(toVelF, 0) !== readElement(fromVelF, 0) || readElement(toVelF, 1) !== readElement(fromVelF, 1);
        const velZChanged = readElement(toVelF, 2) !== readElement(fromVelF, 2);
        if (velXYChanged)
            flags |= PS_M_VELOCITY;
        if (velZChanged)
            extraflags |= EPS_M_VELOCITY2;
        if (to.pmove.pm_time !== from.pmove.pm_time)
            flags |= PS_M_TIME;
        if (to.pmove.pm_flags !== from.pmove.pm_flags)
            flags |= PS_M_FLAGS;
        if (to.pmove.gravity !== from.pmove.gravity)
            flags |= PS_M_GRAVITY;
        if (readElement(to.pmove.delta_angles, 0) !== readElement(from.pmove.delta_angles, 0) ||
            readElement(to.pmove.delta_angles, 1) !== readElement(from.pmove.delta_angles, 1) ||
            readElement(to.pmove.delta_angles, 2) !== readElement(from.pmove.delta_angles, 2))
            flags |= PS_M_DELTA_ANGLES;
        if (to.pmove.viewheight !== from.pmove.viewheight)
            flags |= PS_RR_VIEWHEIGHT;
        const toViewoffset = [encodeFixed16(readElement(to.viewoffset, 0), VIEWOFFSET_SCALE), encodeFixed16(readElement(to.viewoffset, 1), VIEWOFFSET_SCALE), encodeFixed16(readElement(to.viewoffset, 2), VIEWOFFSET_SCALE)];
        const fromViewoffset = [
            encodeFixed16(readElement(from.viewoffset, 0), VIEWOFFSET_SCALE),
            encodeFixed16(readElement(from.viewoffset, 1), VIEWOFFSET_SCALE),
            encodeFixed16(readElement(from.viewoffset, 2), VIEWOFFSET_SCALE),
        ];
        const viewoffsetChanged = readElement(toViewoffset, 0) !== readElement(fromViewoffset, 0) || readElement(toViewoffset, 1) !== readElement(fromViewoffset, 1) || readElement(toViewoffset, 2) !== readElement(fromViewoffset, 2);
        if (viewoffsetChanged)
            flags |= PS_VIEWOFFSET;
        const toViewangleShort = [ANGLE2SHORT(readElement(to.viewangles, 0)), ANGLE2SHORT(readElement(to.viewangles, 1)), ANGLE2SHORT(readElement(to.viewangles, 2))];
        const fromViewangleShort = [ANGLE2SHORT(readElement(from.viewangles, 0)), ANGLE2SHORT(readElement(from.viewangles, 1)), ANGLE2SHORT(readElement(from.viewangles, 2))];
        const viewangleXYChanged = readElement(toViewangleShort, 0) !== readElement(fromViewangleShort, 0) || readElement(toViewangleShort, 1) !== readElement(fromViewangleShort, 1);
        const viewangleZChanged = readElement(toViewangleShort, 2) !== readElement(fromViewangleShort, 2);
        if (viewangleXYChanged)
            flags |= PS_VIEWANGLES;
        if (viewangleZChanged)
            extraflags |= EPS_VIEWANGLE2;
        const toKick = [encodeFixed16(readElement(to.kick_angles, 0), KICK_ANGLE_SCALE), encodeFixed16(readElement(to.kick_angles, 1), KICK_ANGLE_SCALE), encodeFixed16(readElement(to.kick_angles, 2), KICK_ANGLE_SCALE)];
        const fromKick = [
            encodeFixed16(readElement(from.kick_angles, 0), KICK_ANGLE_SCALE),
            encodeFixed16(readElement(from.kick_angles, 1), KICK_ANGLE_SCALE),
            encodeFixed16(readElement(from.kick_angles, 2), KICK_ANGLE_SCALE),
        ];
        const kickChanged = readElement(toKick, 0) !== readElement(fromKick, 0) || readElement(toKick, 1) !== readElement(fromKick, 1) || readElement(toKick, 2) !== readElement(fromKick, 2);
        if (kickChanged)
            flags |= PS_KICKANGLES;
        function byteColor(x: number): number {
            return Math.trunc(x * 255) & 0xff;
        }
        let blendBits = 0;
        for (let i = 0; i < 4; i++)
            if (byteColor(readElement(to.blend, i)) !== byteColor(readElement(from.blend, i)))
                blendBits |= 1 << i;
        let damageBlendBits = 0;
        for (let i = 0; i < 4; i++)
            if (byteColor(readElement(to.damage_blend, i)) !== byteColor(readElement(from.damage_blend, i)))
                damageBlendBits |= 1 << i;
        if (blendBits !== 0 || damageBlendBits !== 0)
            flags |= PS_BLEND;
        if (to.fov !== from.fov)
            flags |= PS_FOV;
        if (to.rdflags !== from.rdflags)
            flags |= PS_RDFLAGS;
        const gunindexChanged = to.gunindex !== from.gunindex || to.gunskin !== from.gunskin;
        if (gunindexChanged)
            flags |= PS_WEAPONINDEX;
        if (to.gunframe !== from.gunframe)
            flags |= PS_WEAPONFRAME;
        const toGunoffset = [encodeFixed16(readElement(to.gunoffset, 0), GUNOFFSET_SCALE), encodeFixed16(readElement(to.gunoffset, 1), GUNOFFSET_SCALE), encodeFixed16(readElement(to.gunoffset, 2), GUNOFFSET_SCALE)];
        const fromGunoffset = [
            encodeFixed16(readElement(from.gunoffset, 0), GUNOFFSET_SCALE),
            encodeFixed16(readElement(from.gunoffset, 1), GUNOFFSET_SCALE),
            encodeFixed16(readElement(from.gunoffset, 2), GUNOFFSET_SCALE),
        ];
        if (readElement(toGunoffset, 0) !== readElement(fromGunoffset, 0) || readElement(toGunoffset, 1) !== readElement(fromGunoffset, 1) || readElement(toGunoffset, 2) !== readElement(fromGunoffset, 2))
            extraflags |= EPS_GUNOFFSET;
        const toGunangles = [encodeFixed16(readElement(to.gunangles, 0), GUNANGLE_SCALE), encodeFixed16(readElement(to.gunangles, 1), GUNANGLE_SCALE), encodeFixed16(readElement(to.gunangles, 2), GUNANGLE_SCALE)];
        const fromGunangles = [
            encodeFixed16(readElement(from.gunangles, 0), GUNANGLE_SCALE),
            encodeFixed16(readElement(from.gunangles, 1), GUNANGLE_SCALE),
            encodeFixed16(readElement(from.gunangles, 2), GUNANGLE_SCALE),
        ];
        if (readElement(toGunangles, 0) !== readElement(fromGunangles, 0) || readElement(toGunangles, 1) !== readElement(fromGunangles, 1) || readElement(toGunangles, 2) !== readElement(fromGunangles, 2))
            extraflags |= EPS_GUNANGLES;
        let statbits = 0n;
        for (let i = 0; i < to.stats.length; i++)
            if (readElement(to.stats, i) !== readElement(from.stats, i))
                statbits |= 1n << BigInt(i);
        if (statbits !== 0n)
            extraflags |= EPS_STATS;
        const gunrateChanged = to.gunrate !== from.gunrate;
        if (gunrateChanged)
            extraflags |= EPS_GUNRATE;
        return {
            flags,
            extraflags,
            writeFlags(msg: SizeBuf): void {
                MSG_WriteShort(msg, flags);
            },
            writeBody(msg: SizeBuf): void {
                if (flags & PS_M_TYPE)
                    MSG_WriteByte(msg, to.pmove.pm_type);
                if (flags & PS_M_ORIGIN) {
                    MSG_WriteFloat(msg, readElement(toOriginF, 0));
                    MSG_WriteFloat(msg, readElement(toOriginF, 1));
                }
                if (extraflags & EPS_M_ORIGIN2)
                    MSG_WriteFloat(msg, readElement(toOriginF, 2));
                if (flags & PS_M_VELOCITY) {
                    MSG_WriteFloat(msg, readElement(toVelF, 0));
                    MSG_WriteFloat(msg, readElement(toVelF, 1));
                }
                if (extraflags & EPS_M_VELOCITY2)
                    MSG_WriteFloat(msg, readElement(toVelF, 2));
                if (flags & PS_M_TIME)
                    MSG_WriteShort(msg, to.pmove.pm_time);
                if (flags & PS_M_FLAGS)
                    MSG_WriteShort(msg, to.pmove.pm_flags);
                if (flags & PS_M_GRAVITY)
                    MSG_WriteShort(msg, to.pmove.gravity);
                if (flags & PS_M_DELTA_ANGLES) {
                    MSG_WriteShort(msg, readElement(to.pmove.delta_angles, 0));
                    MSG_WriteShort(msg, readElement(to.pmove.delta_angles, 1));
                    MSG_WriteShort(msg, readElement(to.pmove.delta_angles, 2));
                }
                if (flags & PS_VIEWOFFSET) {
                    MSG_WriteShort(msg, readElement(toViewoffset, 0));
                    MSG_WriteShort(msg, readElement(toViewoffset, 1));
                    MSG_WriteShort(msg, readElement(toViewoffset, 2));
                }
                if (flags & PS_VIEWANGLES) {
                    MSG_WriteShort(msg, readElement(toViewangleShort, 0));
                    MSG_WriteShort(msg, readElement(toViewangleShort, 1));
                }
                if (extraflags & EPS_VIEWANGLE2)
                    MSG_WriteShort(msg, readElement(toViewangleShort, 2));
                if (flags & PS_KICKANGLES) {
                    MSG_WriteShort(msg, readElement(toKick, 0));
                    MSG_WriteShort(msg, readElement(toKick, 1));
                    MSG_WriteShort(msg, readElement(toKick, 2));
                }
                if (flags & PS_WEAPONINDEX) {
                    const gunIndexAndSkin = (to.gunindex & 0xffff) | ((to.gunskin << Q2PRO_GUNINDEX_BITS) & 0xffff);
                    MSG_WriteShort(msg, gunIndexAndSkin);
                }
                if (flags & PS_WEAPONFRAME)
                    MSG_WriteShort(msg, to.gunframe);
                if (extraflags & EPS_GUNOFFSET) {
                    MSG_WriteShort(msg, readElement(toGunoffset, 0));
                    MSG_WriteShort(msg, readElement(toGunoffset, 1));
                    MSG_WriteShort(msg, readElement(toGunoffset, 2));
                }
                if (extraflags & EPS_GUNANGLES) {
                    MSG_WriteShort(msg, readElement(toGunangles, 0));
                    MSG_WriteShort(msg, readElement(toGunangles, 1));
                    MSG_WriteShort(msg, readElement(toGunangles, 2));
                }
                if (flags & PS_BLEND) {
                    MSG_WriteByte(msg, (blendBits & 0xf) | ((damageBlendBits & 0xf) << 4));
                    for (let i = 0; i < 4; i++)
                        if (blendBits & (1 << i))
                            MSG_WriteByte(msg, byteColor(readElement(to.blend, i)));
                    for (let i = 0; i < 4; i++)
                        if (damageBlendBits & (1 << i))
                            MSG_WriteByte(msg, byteColor(readElement(to.damage_blend, i)));
                }
                if (flags & PS_FOV)
                    MSG_WriteByte(msg, to.fov);
                if (flags & PS_RDFLAGS)
                    MSG_WriteByte(msg, to.rdflags);
                if (extraflags & EPS_STATS) {
                    MSG_WriteLong64(msg, statbits);
                    for (let i = 0; i < to.stats.length; i++)
                        if (statbits & (1n << BigInt(i)))
                            MSG_WriteShort(msg, readElement(to.stats, i));
                }
                if (extraflags & EPS_GUNRATE)
                    MSG_WriteByte(msg, to.gunrate);
                if (flags & PS_RR_VIEWHEIGHT)
                    MSG_WriteChar(msg, to.pmove.viewheight);
            },
        };
    }
    function writePlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const enc = encodePlayerStateDelta(from, to);
        MSG_WriteByte(msg, SvcOpsT.svc_playerinfo);
        enc.writeFlags(msg);
        MSG_WriteByte(msg, enc.extraflags);
        enc.writeBody(msg);
    }
    function writeDeltaUsercmd(msg: SizeBuf, from: UsercmdT, cmd: UsercmdT): void {
        if (cmd.upmove !== from.upmove) {
            throw new ComError(ERR_DROP, "q2repro (1038) non-batched clc_move cannot encode upmove changes; use batched movement");
        }
        MSG_WriteDeltaUsercmd(msg, from, cmd);
    }
    function readDeltaUsercmd(msg: SizeBuf, from: UsercmdT, move: UsercmdT): void {
        const bits = msg.data[msg.readcount];
        if (bits !== undefined && (bits & CM_UP) !== 0)
            throw new Error('q2repro (1038) non-batched movement has reserved CM_UP bit');
        MSG_ReadDeltaUsercmd(msg, from, move);
    }
    function decodeQ2ReproBatchCmd(br: BitReader, prev: UsercmdT | null, classicFields = false): UsercmdT {
        const cmd = seedFromPrev(prev);
        const hasContents = br.readUnsigned(1);
        if (!hasContents)
            return cmd;
        const bits = br.readUnsigned(8);
        if (bits & CM_ANGLE1)
            cmd.angles[0] = readBatchMoveAngleComponent(br, prev ? readElement(prev.angles, 0) : 0);
        if (bits & CM_ANGLE2)
            cmd.angles[1] = readBatchMoveAngleComponent(br, prev ? readElement(prev.angles, 1) : 0);
        if (bits & CM_ANGLE3)
            cmd.angles[2] = br.readSigned(16);
        if (bits & CM_FORWARD)
            cmd.forwardmove = br.readSigned(10);
        if (bits & CM_SIDE)
            cmd.sidemove = br.readSigned(10);
        if (bits & CM_UP) {
            if (!classicFields) {
                throw new ClcBatchMoveError("clc_q2pro_move_batched (1038): CM_UP bit set -- q2repro's own decoder rejects this (Q2P_ERR_BAD_DATA, q2proto_proto_q2repro.c:2662-2663)");
            }
            cmd.upmove = br.readSigned(10);
        }
        if (bits & CM_BUTTONS)
            cmd.buttons = br.readUnsigned(8);
        if (bits & CM_IMPULSE)
            cmd.msec = br.readUnsigned(8);
        else
            cmd.msec = prev ? prev.msec : 0;
        return cmd;
    }
    function encodeQ2ReproBatchCmd(bw: BitWriter, cmd: UsercmdT, prev: UsercmdT | null, classicFields = false): void {
        bw.writeUnsigned(1, 1);
        let bits = CM_IMPULSE;
        const p0 = prev ? readElement(prev.angles, 0) : 0;
        const p1 = prev ? readElement(prev.angles, 1) : 0;
        const p2 = prev ? readElement(prev.angles, 2) : 0;
        if (readElement(cmd.angles, 0) !== p0)
            bits |= CM_ANGLE1;
        if (readElement(cmd.angles, 1) !== p1)
            bits |= CM_ANGLE2;
        if (readElement(cmd.angles, 2) !== p2)
            bits |= CM_ANGLE3;
        if (cmd.forwardmove !== (prev ? prev.forwardmove : 0))
            bits |= CM_FORWARD;
        if (cmd.sidemove !== (prev ? prev.sidemove : 0))
            bits |= CM_SIDE;
        if (classicFields && cmd.upmove !== (prev ? prev.upmove : 0))
            bits |= CM_UP;
        if (cmd.buttons !== (prev ? prev.buttons : 0))
            bits |= CM_BUTTONS;
        bw.writeUnsigned(bits, 8);
        if (bits & CM_ANGLE1) {
            bw.writeUnsigned(0, 1);
            bw.writeSigned(readElement(cmd.angles, 0), 16);
        }
        if (bits & CM_ANGLE2) {
            bw.writeUnsigned(0, 1);
            bw.writeSigned(readElement(cmd.angles, 1), 16);
        }
        if (bits & CM_ANGLE3)
            bw.writeSigned(readElement(cmd.angles, 2), 16);
        if (bits & CM_FORWARD)
            bw.writeSigned(Math.max(-512, Math.min(511, cmd.forwardmove)), 10);
        if (bits & CM_SIDE)
            bw.writeSigned(Math.max(-512, Math.min(511, cmd.sidemove)), 10);
        if (bits & CM_UP)
            bw.writeSigned(Math.max(-512, Math.min(511, Math.trunc(cmd.upmove))), 10);
        if (bits & CM_BUTTONS)
            bw.writeUnsigned(cmd.buttons, 8);
        bw.writeUnsigned(cmd.msec, 8);
    }
    function makeWriteBatchMove(classicFields: boolean) {
        return function writeBatchMove(msg: SizeBuf, lastframe: number | null, frames: ClcBatchMoveFrameT[]): void {
            if (lastframe !== null)
                MSG_WriteLong(msg, lastframe);
            MSG_WriteByte(msg, frames.length - 1);
            let lightlevel = 0;
            if (classicFields) {
                for (const frame of frames)
                    for (const cmd of frame.cmds)
                        lightlevel = cmd.lightlevel;
            }
            MSG_WriteByte(msg, lightlevel & 0xff);
            const bw = new BitWriter(msg);
            writeBatchMoveFrames(bw, frames, (bw2, cmd, prev) => encodeQ2ReproBatchCmd(bw2, cmd, prev, classicFields));
        };
    }
    function makeReadBatchMove(classicFields: boolean) {
        return function readBatchMove(msg: SizeBuf, nodelta: boolean, _opcodeExtra: number): ClcBatchMoveT {
            const lastframe = nodelta ? -1 : MSG_ReadLong(msg);
            const numDups = MSG_ReadByte(msg);
            if (numDups < 0)
                throw new ClcBatchMoveError("clc_q2pro_move_batched (1038): truncated message (num_dups)");
            if (numDups >= MAX_CLC_BATCH_MOVE_FRAMES - 1) {
                throw new ClcBatchMoveError("clc_q2pro_move_batched (1038): num_dups out of range (Q2P_ERR_BAD_DATA, q2proto_proto_q2repro.c:2687-2688)");
            }
            const lightlevel = MSG_ReadByte(msg);
            if (lightlevel < 0)
                throw new ClcBatchMoveError("clc_q2pro_move_batched (1038): truncated message (lightlevel)");
            const br = new BitReader(msg);
            const frames = readBatchMoveFrames(br, numDups, (br2, prev) => decodeQ2ReproBatchCmd(br2, prev, classicFields));
            if (classicFields) {
                for (const frame of frames)
                    for (const cmd of frame.cmds)
                        cmd.lightlevel = lightlevel;
            }
            return { lastframe, numDups, frames };
        };
    }
    const writeBatchMove = makeWriteBatchMove(false);
    const readBatchMove = makeReadBatchMove(false);
    function readUserinfoDelta(msg: SizeBuf): ClcUserinfoDeltaT {
        const name = MSG_ReadString(msg);
        const value = MSG_ReadString(msg);
        return { name, value };
    }
    function readClientSetting(msg: SizeBuf): ClcClientSettingT {
        const index = MSG_ReadShort(msg);
        const value = MSG_ReadShort(msg);
        return { index, value };
    }
    function readServerData(): ServerDataReadResultT {
        const servercount = MSG_ReadLong(net_message);
        const attractloop = MSG_ReadByte(net_message) !== 0;
        const gamedir = MSG_ReadString(net_message);
        const clientnum = MSG_ReadShort(net_message);
        const levelname = MSG_ReadString(net_message);
        const protocolRevision = MSG_ReadWord(net_message);
        const serverState = MSG_ReadByte(net_message);
        const wireFlags = MSG_ReadWord(net_message);
        const serverFps = MSG_ReadByte(net_message);
        return { servercount, attractloop, gamedir, clientnum, levelname, serverState, protocolRevision, wireFlags, serverFps };
    }
    function readEntityBits(): {
        number: number;
        bits: number;
    } {
        return readEntityBitsWide();
    }
    function copyEntityState(dst: EntityStateT, src: EntityStateT): void {
        dst.number = src.number;
        dst.origin.set(src.origin);
        dst.angles.set(src.angles);
        dst.old_origin.set(src.old_origin);
        dst.modelindex = src.modelindex;
        dst.modelindex2 = src.modelindex2;
        dst.modelindex3 = src.modelindex3;
        dst.modelindex4 = src.modelindex4;
        dst.frame = src.frame;
        dst.skinnum = src.skinnum;
        dst.effects = src.effects;
        dst.morefx = src.morefx;
        dst.renderfx = src.renderfx;
        dst.solid = src.solid;
        dst.sound = src.sound;
        dst.event = src.event;
        dst.alpha = src.alpha;
        dst.scale = src.scale;
        dst.loop_volume = src.loop_volume;
        dst.loop_attenuation = src.loop_attenuation;
    }
    function readDeltaEntity(from: EntityStateT, to: EntityStateT, number: number, bits: number): void {
        copyEntityState(to, from);
        to.old_origin.set(from.origin);
        to.number = number;
        const model16 = (bits & U_MODEL16) !== 0;
        if (bits & U_MODEL)
            to.modelindex = model16 ? MSG_ReadWord(net_message) : MSG_ReadByte(net_message);
        if (bits & U_MODEL2)
            to.modelindex2 = model16 ? MSG_ReadWord(net_message) : MSG_ReadByte(net_message);
        if (bits & U_MODEL3)
            to.modelindex3 = model16 ? MSG_ReadWord(net_message) : MSG_ReadByte(net_message);
        if (bits & U_MODEL4)
            to.modelindex4 = model16 ? MSG_ReadWord(net_message) : MSG_ReadByte(net_message);
        if (bits & U_FRAME16)
            to.frame = MSG_ReadWord(net_message);
        else if (bits & U_FRAME8)
            to.frame = MSG_ReadByte(net_message);
        if ((bits & (U_SKIN8 | U_SKIN16)) === (U_SKIN8 | U_SKIN16))
            to.skinnum = MSG_ReadLong(net_message);
        else if (bits & U_SKIN16)
            to.skinnum = MSG_ReadWord(net_message);
        else if (bits & U_SKIN8)
            to.skinnum = MSG_ReadByte(net_message);
        if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16))
            to.effects = MSG_ReadLong(net_message);
        else if (bits & U_EFFECTS16)
            to.effects = MSG_ReadWord(net_message);
        else if (bits & U_EFFECTS8)
            to.effects = MSG_ReadByte(net_message);
        if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16))
            to.renderfx = MSG_ReadLong(net_message);
        else if (bits & U_RENDERFX16)
            to.renderfx = MSG_ReadWord(net_message);
        else if (bits & U_RENDERFX8)
            to.renderfx = MSG_ReadByte(net_message);
        if (bits & U_ORIGIN1)
            to.origin[0] = MSG_ReadFloat(net_message);
        if (bits & U_ORIGIN2)
            to.origin[1] = MSG_ReadFloat(net_message);
        if (bits & U_ORIGIN3)
            to.origin[2] = MSG_ReadFloat(net_message);
        if (bits & U_ANGLE16) {
            if (bits & U_ANGLE1)
                to.angles[0] = SHORT2ANGLE(MSG_ReadShort(net_message));
            if (bits & U_ANGLE2)
                to.angles[1] = SHORT2ANGLE(MSG_ReadShort(net_message));
            if (bits & U_ANGLE3)
                to.angles[2] = SHORT2ANGLE(MSG_ReadShort(net_message));
        }
        else {
            if (bits & U_ANGLE1)
                to.angles[0] = MSG_ReadByte(net_message) * (360.0 / 256);
            if (bits & U_ANGLE2)
                to.angles[1] = MSG_ReadByte(net_message) * (360.0 / 256);
            if (bits & U_ANGLE3)
                to.angles[2] = MSG_ReadByte(net_message) * (360.0 / 256);
        }
        if (bits & U_OLDORIGIN) {
            to.old_origin[0] = MSG_ReadFloat(net_message);
            to.old_origin[1] = MSG_ReadFloat(net_message);
            to.old_origin[2] = MSG_ReadFloat(net_message);
        }
        if (bits & U_SOUND) {
            const soundWord = MSG_ReadWord(net_message);
            to.sound = soundWord & 0x3fff;
            if (soundWord & SOUND_FLAG_VOLUME)
                to.loop_volume = decodeLoopVolume(MSG_ReadByte(net_message));
            if (soundWord & SOUND_FLAG_ATTENUATION)
                to.loop_attenuation = decodeLoopAttenuation(MSG_ReadByte(net_message));
        }
        if (bits & U_EVENT)
            to.event = MSG_ReadByte(net_message);
        else
            to.event = 0;
        if (bits & U_SOLID)
            to.solid = MSG_ReadLong(net_message);
        if (bitsHasHi(bits, HI_MOREFX16) && bits & U_MOREFX8)
            to.morefx = MSG_ReadLong(net_message);
        else if (bitsHasHi(bits, HI_MOREFX16))
            to.morefx = MSG_ReadWord(net_message);
        else if (bits & U_MOREFX8)
            to.morefx = MSG_ReadByte(net_message);
        if (bits & U_ALPHA)
            to.alpha = decodeAlpha(MSG_ReadByte(net_message));
        if (bitsHasHi(bits, HI_SCALE))
            to.scale = decodeScale(MSG_ReadByte(net_message));
    }
    function readPlayerStateFields(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT, flags: number, extraflags: number): void {
        to.pmove.pm_type = from.pmove.pm_type;
        to.pmove.origin.set(from.pmove.origin);
        to.pmove.velocity.set(from.pmove.velocity);
        to.pmove.originF.set(from.pmove.originF);
        to.pmove.velocityF.set(from.pmove.velocityF);
        to.pmove.pm_flags = from.pmove.pm_flags;
        to.pmove.pm_time = from.pmove.pm_time;
        to.pmove.gravity = from.pmove.gravity;
        to.pmove.delta_angles.set(from.pmove.delta_angles);
        to.pmove.viewheight = from.pmove.viewheight;
        to.viewangles.set(from.viewangles);
        to.viewoffset.set(from.viewoffset);
        to.kick_angles.set(from.kick_angles);
        to.gunangles.set(from.gunangles);
        to.gunoffset.set(from.gunoffset);
        to.gunindex = from.gunindex;
        to.gunskin = from.gunskin;
        to.gunframe = from.gunframe;
        to.gunrate = from.gunrate;
        to.blend.set(from.blend);
        to.damage_blend.set(from.damage_blend);
        to.fov = from.fov;
        to.rdflags = from.rdflags;
        to.stats.set(from.stats);
        if (flags & PS_M_TYPE)
            to.pmove.pm_type = MSG_ReadByte(msg);
        let originX = readElement(to.pmove.originF, 0);
        let originY = readElement(to.pmove.originF, 1);
        let originZ = readElement(to.pmove.originF, 2);
        if (flags & PS_M_ORIGIN) {
            originX = MSG_ReadFloat(msg);
            originY = MSG_ReadFloat(msg);
        }
        if (extraflags & EPS_M_ORIGIN2)
            originZ = MSG_ReadFloat(msg);
        if (flags & PS_M_ORIGIN || extraflags & EPS_M_ORIGIN2) {
            to.pmove.originF[0] = originX;
            to.pmove.originF[1] = originY;
            to.pmove.originF[2] = originZ;
            to.pmove.origin[0] = pmFloatToShort(originX);
            to.pmove.origin[1] = pmFloatToShort(originY);
            to.pmove.origin[2] = pmFloatToShort(originZ);
        }
        let velX = readElement(to.pmove.velocityF, 0);
        let velY = readElement(to.pmove.velocityF, 1);
        let velZ = readElement(to.pmove.velocityF, 2);
        if (flags & PS_M_VELOCITY) {
            velX = MSG_ReadFloat(msg);
            velY = MSG_ReadFloat(msg);
        }
        if (extraflags & EPS_M_VELOCITY2)
            velZ = MSG_ReadFloat(msg);
        if (flags & PS_M_VELOCITY || extraflags & EPS_M_VELOCITY2) {
            to.pmove.velocityF[0] = velX;
            to.pmove.velocityF[1] = velY;
            to.pmove.velocityF[2] = velZ;
            to.pmove.velocity[0] = pmFloatToShort(velX);
            to.pmove.velocity[1] = pmFloatToShort(velY);
            to.pmove.velocity[2] = pmFloatToShort(velZ);
        }
        if (flags & PS_M_TIME)
            to.pmove.pm_time = MSG_ReadWord(msg);
        if (flags & PS_M_FLAGS)
            to.pmove.pm_flags = MSG_ReadWord(msg);
        if (flags & PS_M_GRAVITY)
            to.pmove.gravity = MSG_ReadShort(msg);
        if (flags & PS_M_DELTA_ANGLES) {
            to.pmove.delta_angles[0] = MSG_ReadShort(msg);
            to.pmove.delta_angles[1] = MSG_ReadShort(msg);
            to.pmove.delta_angles[2] = MSG_ReadShort(msg);
        }
        if (flags & PS_VIEWOFFSET) {
            to.viewoffset[0] = MSG_ReadShort(msg) / VIEWOFFSET_SCALE;
            to.viewoffset[1] = MSG_ReadShort(msg) / VIEWOFFSET_SCALE;
            to.viewoffset[2] = MSG_ReadShort(msg) / VIEWOFFSET_SCALE;
        }
        if (flags & PS_VIEWANGLES) {
            to.viewangles[0] = SHORT2ANGLE(MSG_ReadShort(msg));
            to.viewangles[1] = SHORT2ANGLE(MSG_ReadShort(msg));
        }
        if (extraflags & EPS_VIEWANGLE2)
            to.viewangles[2] = SHORT2ANGLE(MSG_ReadShort(msg));
        if (flags & PS_KICKANGLES) {
            to.kick_angles[0] = MSG_ReadShort(msg) / KICK_ANGLE_SCALE;
            to.kick_angles[1] = MSG_ReadShort(msg) / KICK_ANGLE_SCALE;
            to.kick_angles[2] = MSG_ReadShort(msg) / KICK_ANGLE_SCALE;
        }
        if (flags & PS_WEAPONINDEX) {
            const gunIndexAndSkin = MSG_ReadWord(msg);
            to.gunindex = gunIndexAndSkin & Q2PRO_GUNINDEX_MASK;
            to.gunskin = gunIndexAndSkin >>> Q2PRO_GUNINDEX_BITS;
        }
        if (flags & PS_WEAPONFRAME)
            to.gunframe = MSG_ReadWord(msg);
        if (extraflags & EPS_GUNOFFSET) {
            to.gunoffset[0] = MSG_ReadShort(msg) / GUNOFFSET_SCALE;
            to.gunoffset[1] = MSG_ReadShort(msg) / GUNOFFSET_SCALE;
            to.gunoffset[2] = MSG_ReadShort(msg) / GUNOFFSET_SCALE;
        }
        if (extraflags & EPS_GUNANGLES) {
            to.gunangles[0] = MSG_ReadShort(msg) / GUNANGLE_SCALE;
            to.gunangles[1] = MSG_ReadShort(msg) / GUNANGLE_SCALE;
            to.gunangles[2] = MSG_ReadShort(msg) / GUNANGLE_SCALE;
        }
        if (flags & PS_BLEND) {
            const blendBits = MSG_ReadByte(msg);
            for (let i = 0; i < 4; i++)
                if (blendBits & (1 << i))
                    to.blend[i] = MSG_ReadByte(msg) / 255;
            for (let i = 0; i < 4; i++)
                if (blendBits & (1 << (i + 4)))
                    to.damage_blend[i] = MSG_ReadByte(msg) / 255;
        }
        if (flags & PS_FOV)
            to.fov = MSG_ReadByte(msg);
        if (flags & PS_RDFLAGS)
            to.rdflags = MSG_ReadByte(msg);
        if (extraflags & EPS_STATS) {
            const statbits = MSG_ReadLong64(msg);
            for (let i = 0; i < to.stats.length; i++)
                if (statbits & (1n << BigInt(i)))
                    to.stats[i] = MSG_ReadShort(msg);
        }
        if (extraflags & EPS_GUNRATE)
            to.gunrate = MSG_ReadByte(msg);
        if (flags & PS_RR_VIEWHEIGHT)
            to.pmove.viewheight = MSG_ReadChar(msg);
    }
    function readPlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const flags = MSG_ReadWord(msg);
        const extraflags = MSG_ReadByte(msg);
        readPlayerStateFields(msg, from, to, flags, extraflags);
    }
    const FF_SUPPRESSED = 1 << 0;
    function encodeFrameFlags(surpressCount: number): number {
        return surpressCount !== 0 ? FF_SUPPRESSED : 0;
    }
    function decodeFrameFlags(frameFlags: number): number {
        return frameFlags & FF_SUPPRESSED ? 1 : 0;
    }
    function writePacketEntitiesBegin(_msg: SizeBuf): void {
    }
    function writeFrame(msg: SizeBuf, params: FrameWriteParamsT, writeEntities: (msg: SizeBuf) => void): void {
        MSG_WriteByte(msg, SvcOpsT.svc_frame);
        const deltaframe = params.lastframe;
        const offset = deltaframe === -1 ? 31 : params.framenum - deltaframe;
        const encodedFrame = (params.framenum & 0x07ffffff) | (offset << 27);
        MSG_WriteLong(msg, encodedFrame);
        MSG_WriteByte(msg, encodeFrameFlags(params.surpressCount));
        const enc = encodePlayerStateDelta(params.psFrom ?? new PlayerStateT(), params.psTo);
        MSG_WriteByte(msg, enc.extraflags);
        MSG_WriteByte(msg, params.areabytes);
        SZ_Write(msg, params.areabits, params.areabytes);
        enc.writeFlags(msg);
        enc.writeBody(msg);
        writeEntities(msg);
    }
    let pendingFrameExtraflags = 0;
    function readFrameHeader(areabits: Uint8Array, _readSuppressByte: boolean): FrameHeaderT {
        const encodedFrame = MSG_ReadLong(net_message);
        const offset = encodedFrame >>> 27;
        const serverframe = encodedFrame & 0x07ffffff;
        const deltaframe = offset === 31 ? -1 : serverframe - offset;
        const frameFlags = MSG_ReadByte(net_message) & 0x0f;
        pendingFrameExtraflags = MSG_ReadByte(net_message);
        const len = MSG_ReadByte(net_message);
        MSG_ReadData(net_message, areabits, len);
        return { serverframe, deltaframe, surpressCount: decodeFrameFlags(frameFlags), areabytes: len };
    }
    function readFramePlayerstate(from: PlayerStateT, to: PlayerStateT): void {
        const flags = MSG_ReadWord(net_message);
        readPlayerStateFields(net_message, from, to, flags, pendingFrameExtraflags);
    }
    function readPacketEntitiesBegin(): void {
    }
    function readFog(): SvcFogDataT {
        let bits = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_MORE_BITS) {
            bits |= MSG_ReadByte(net_message) << 8;
        }
        const fog: SvcFogDataT = {
            bits,
            density: 0,
            skyfactor: 0,
            red: 0,
            green: 0,
            blue: 0,
            time: 0,
            hf_falloff: 0,
            hf_density: 0,
            hf_start_r: 0,
            hf_start_g: 0,
            hf_start_b: 0,
            hf_start_dist: 0,
            hf_end_r: 0,
            hf_end_g: 0,
            hf_end_b: 0,
            hf_end_dist: 0,
        };
        if (bits & SvcFogDataBitsT.BIT_DENSITY) {
            fog.density = MSG_ReadFloat(net_message);
            fog.skyfactor = MSG_ReadByte(net_message);
        }
        if (bits & SvcFogDataBitsT.BIT_R)
            fog.red = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_G)
            fog.green = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_B)
            fog.blue = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_TIME)
            fog.time = MSG_ReadWord(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_FALLOFF)
            fog.hf_falloff = MSG_ReadFloat(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_DENSITY)
            fog.hf_density = MSG_ReadFloat(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_R)
            fog.hf_start_r = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_G)
            fog.hf_start_g = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_B)
            fog.hf_start_b = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_START_DIST)
            fog.hf_start_dist = MSG_ReadLong(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_R)
            fog.hf_end_r = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_G)
            fog.hf_end_g = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_B)
            fog.hf_end_b = MSG_ReadByte(net_message);
        if (bits & SvcFogDataBitsT.BIT_HEIGHTFOG_END_DIST)
            fog.hf_end_dist = MSG_ReadLong(net_message);
        return fog;
    }
    const Q2REPRO_CODEC: ProtocolCodec = {
        name: "q2repro",
        writeServerData,
        writeDeltaEntity,
        writeEntityRemove,
        writePacketEntitiesEnd,
        writeSpawnBaseline,
        writePlayerStateDelta,
        writePacketEntitiesBegin,
        writeFrame,
        writeDeltaUsercmd,
        readDeltaUsercmd,
        readServerData,
        readEntityBits,
        readDeltaEntity,
        readFrameHeader,
        readFramePlayerstate,
        readPacketEntitiesBegin,
        readPlayerStateDelta,
        readBatchMove,
        writeBatchMove,
        readUserinfoDelta,
        readClientSetting,
    };
    const Q2REPRO_CLASSIC_CODEC: ProtocolCodec = {
        ...Q2REPRO_CODEC,
        name: "q2repro-classic",
        readDeltaUsercmd: MSG_ReadDeltaUsercmd, writeDeltaUsercmd: MSG_WriteDeltaUsercmd,
        writeServerData: writeServerDataClassic,
        writeBatchMove: makeWriteBatchMove(true),
        readBatchMove: makeReadBatchMove(true),
    };
    return { writeEntityBitsWide, encodeAlpha, encodeScale, encodeLoopVolume, encodeLoopAttenuation, HI_SCALE, HI_MOREFX16, combineBits, bitsHasHi, SOUND_FLAG_VOLUME, SOUND_FLAG_ATTENUATION, Q2PRO_GUNINDEX_BITS, Q2PRO_GUNINDEX_MASK, decodeAlpha, decodeScale, decodeLoopVolume, decodeLoopAttenuation, VIEWOFFSET_SCALE, KICK_ANGLE_SCALE, pmFloatToShort, readEntityBitsWide, readFog, Q2REPRO_CODEC, Q2REPRO_CLASSIC_CODEC };
}
