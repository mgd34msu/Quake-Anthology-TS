import { readElement } from '../state.ts';
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import { MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteString, MSG_WriteAngle16, MSG_WriteCoord, MSG_WriteAngle, MSG_ReadByte, MSG_ReadShort, MSG_ReadWord, MSG_ReadLong, MSG_ReadString, MSG_ReadChar, MSG_ReadAngle16, MSG_ReadCoord, MSG_ReadAngle, MSG_ReadPos, MSG_ReadData, SZ_Write, } from "../message.ts";
import { PROTOCOL_VERSION_R1Q2, PROTOCOL_VERSION_R1Q2_UCMD, PROTOCOL_VERSION_R1Q2_LONG_SOLID, PROTOCOL_VERSION_R1Q2_CURRENT, EPS_GUNOFFSET, EPS_GUNANGLES, EPS_M_VELOCITY2, EPS_M_ORIGIN2, EPS_VIEWANGLE2, EPS_STATS, U_NUMBER16, U_MOREBITS1, U_MOREBITS2, U_MOREBITS3, U_MODEL, U_MODEL2, U_MODEL3, U_MODEL4, U_FRAME8, U_FRAME16, U_SKIN8, U_SKIN16, U_EFFECTS8, U_EFFECTS16, U_RENDERFX8, U_RENDERFX16, U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_OLDORIGIN, U_SOUND, U_EVENT, U_SOLID, SvcOpsT, PS_M_TYPE, PS_M_ORIGIN, PS_M_VELOCITY, PS_M_TIME, PS_M_FLAGS, PS_M_GRAVITY, PS_M_DELTA_ANGLES, PS_VIEWOFFSET, PS_VIEWANGLES, PS_KICKANGLES, PS_BLEND, PS_FOV, PS_WEAPONINDEX, PS_WEAPONFRAME, PS_RDFLAGS, } from "../constants.ts";
import { EntityStateT, PlayerStateT, type UsercmdT, MAX_STATS, MAX_EDICTS, RF_BEAM } from "../state.ts";
import { VectorCopy } from "../state.ts";
import { ComError, ERR_FATAL } from "../constants.ts";
import type { ProtocolCodec, ServerDataParamsT, ServerDataReadResultT, FrameWriteParamsT, FrameHeaderT, ClcClientSettingT } from "./codec.ts";
import { createVanillaContext } from "./vanilla.ts";
interface PlayerStateDeltaEncodedT {
    flags: number;
    extraflags: number;
    writeBody(msg: SizeBuf): void;
}
export function createR1Context(net_message: SizeBuf) {
    const { VANILLA_CODEC } = createVanillaContext(net_message);
    function writeServerData(msg: SizeBuf, params: ServerDataParamsT): void {
        MSG_WriteByte(msg, SvcOpsT.svc_serverdata);
        MSG_WriteLong(msg, PROTOCOL_VERSION_R1Q2);
        MSG_WriteLong(msg, params.servercount);
        MSG_WriteByte(msg, params.attractloop ? 1 : 0);
        MSG_WriteString(msg, params.gamedir);
        MSG_WriteShort(msg, params.clientnum);
        MSG_WriteString(msg, params.levelname);
        MSG_WriteByte(msg, 0);
        MSG_WriteShort(msg, params.r1q2Version ?? PROTOCOL_VERSION_R1Q2_CURRENT);
        MSG_WriteByte(msg, 0);
        MSG_WriteByte(msg, params.r1q2StrafejumpHack ? 1 : 0);
    }
    function readServerData(): ServerDataReadResultT {
        const servercount = MSG_ReadLong(net_message);
        const attractloop = MSG_ReadByte(net_message) !== 0;
        const gamedir = MSG_ReadString(net_message);
        const clientnum = MSG_ReadShort(net_message);
        const levelname = MSG_ReadString(net_message);
        MSG_ReadByte(net_message);
        const r1q2Version = MSG_ReadShort(net_message);
        MSG_ReadByte(net_message);
        const r1q2StrafejumpHack = MSG_ReadByte(net_message) !== 0;
        return { servercount, attractloop, gamedir, clientnum, levelname, serverState: 0, r1q2Version, r1q2StrafejumpHack };
    }
    function makeEntityDeltaCodec(minorVersion: number) {
        const longSolid = minorVersion >= PROTOCOL_VERSION_R1Q2_LONG_SOLID;
        function writeDeltaEntity(msg: SizeBuf, from: EntityStateT, to: EntityStateT, force: boolean, newentity: boolean): void {
            if (!to.number)
                throw new ComError(ERR_FATAL, "Unset entity number");
            if (to.number >= MAX_EDICTS)
                throw new ComError(ERR_FATAL, "Entity number >= MAX_EDICTS");
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
                else if ((to.skinnum >>> 0) < 0x8000)
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
            if (bits & U_SOLID) {
                if (longSolid)
                    MSG_WriteLong(msg, to.solid);
                else
                    MSG_WriteShort(msg, to.solid);
            }
        }
        function copyEntityState(dst: EntityStateT, src: EntityStateT): void {
            dst.number = src.number;
            VectorCopy(src.origin, dst.origin);
            VectorCopy(src.angles, dst.angles);
            VectorCopy(src.old_origin, dst.old_origin);
            dst.modelindex = src.modelindex;
            dst.modelindex2 = src.modelindex2;
            dst.modelindex3 = src.modelindex3;
            dst.modelindex4 = src.modelindex4;
            dst.frame = src.frame;
            dst.skinnum = src.skinnum;
            dst.effects = src.effects;
            dst.renderfx = src.renderfx;
            dst.solid = src.solid;
            dst.sound = src.sound;
            dst.event = src.event;
        }
        function readDeltaEntity(from: EntityStateT, to: EntityStateT, number: number, bits: number): void {
            copyEntityState(to, from);
            VectorCopy(from.origin, to.old_origin);
            to.number = number;
            if (bits & U_MODEL)
                to.modelindex = MSG_ReadByte(net_message);
            if (bits & U_MODEL2)
                to.modelindex2 = MSG_ReadByte(net_message);
            if (bits & U_MODEL3)
                to.modelindex3 = MSG_ReadByte(net_message);
            if (bits & U_MODEL4)
                to.modelindex4 = MSG_ReadByte(net_message);
            if (bits & U_FRAME8)
                to.frame = MSG_ReadByte(net_message);
            if (bits & U_FRAME16)
                to.frame = MSG_ReadWord(net_message);
            if (bits & U_SKIN8 && bits & U_SKIN16)
                to.skinnum = MSG_ReadLong(net_message);
            else if (bits & U_SKIN8)
                to.skinnum = MSG_ReadByte(net_message);
            else if (bits & U_SKIN16)
                to.skinnum = MSG_ReadWord(net_message);
            if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16))
                to.effects = MSG_ReadLong(net_message);
            else if (bits & U_EFFECTS8)
                to.effects = MSG_ReadByte(net_message);
            else if (bits & U_EFFECTS16)
                to.effects = MSG_ReadWord(net_message);
            if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16))
                to.renderfx = MSG_ReadLong(net_message);
            else if (bits & U_RENDERFX8)
                to.renderfx = MSG_ReadByte(net_message);
            else if (bits & U_RENDERFX16)
                to.renderfx = MSG_ReadWord(net_message);
            if (bits & U_ORIGIN1)
                to.origin[0] = MSG_ReadCoord(net_message);
            if (bits & U_ORIGIN2)
                to.origin[1] = MSG_ReadCoord(net_message);
            if (bits & U_ORIGIN3)
                to.origin[2] = MSG_ReadCoord(net_message);
            if (bits & U_ANGLE1)
                to.angles[0] = MSG_ReadAngle(net_message);
            if (bits & U_ANGLE2)
                to.angles[1] = MSG_ReadAngle(net_message);
            if (bits & U_ANGLE3)
                to.angles[2] = MSG_ReadAngle(net_message);
            if (bits & U_OLDORIGIN)
                MSG_ReadPos(net_message, to.old_origin);
            if (bits & U_SOUND)
                to.sound = MSG_ReadByte(net_message);
            if (bits & U_EVENT)
                to.event = MSG_ReadByte(net_message);
            else
                to.event = 0;
            if (bits & U_SOLID)
                to.solid = longSolid ? MSG_ReadLong(net_message) : MSG_ReadShort(net_message);
        }
        return { writeDeltaEntity, readDeltaEntity };
    }
    const writeEntityRemove = VANILLA_CODEC.writeEntityRemove;
    const writePacketEntitiesEnd = VANILLA_CODEC.writePacketEntitiesEnd;
    function writePacketEntitiesBegin(_msg: SizeBuf): void { }
    function readPacketEntitiesBegin(): void { }
    const NULL_ENTITY_STATE = new EntityStateT();
    function encodePlayerStateDelta(from: PlayerStateT, to: PlayerStateT): PlayerStateDeltaEncodedT {
        const ps = to;
        const ops = from;
        let flags = 0;
        let extraflags = 0;
        if (ps.pmove.pm_type !== ops.pmove.pm_type)
            flags |= PS_M_TYPE;
        const originXYChanged = readElement(ps.pmove.origin, 0) !== readElement(ops.pmove.origin, 0) || readElement(ps.pmove.origin, 1) !== readElement(ops.pmove.origin, 1);
        const originZChanged = readElement(ps.pmove.origin, 2) !== readElement(ops.pmove.origin, 2);
        if (originXYChanged)
            flags |= PS_M_ORIGIN;
        if (originZChanged)
            extraflags |= EPS_M_ORIGIN2;
        const velXYChanged = readElement(ps.pmove.velocity, 0) !== readElement(ops.pmove.velocity, 0) || readElement(ps.pmove.velocity, 1) !== readElement(ops.pmove.velocity, 1);
        const velZChanged = readElement(ps.pmove.velocity, 2) !== readElement(ops.pmove.velocity, 2);
        if (velXYChanged)
            flags |= PS_M_VELOCITY;
        if (velZChanged)
            extraflags |= EPS_M_VELOCITY2;
        if (ps.pmove.pm_time !== ops.pmove.pm_time)
            flags |= PS_M_TIME;
        if (ps.pmove.pm_flags !== ops.pmove.pm_flags)
            flags |= PS_M_FLAGS;
        if (ps.pmove.gravity !== ops.pmove.gravity)
            flags |= PS_M_GRAVITY;
        if (readElement(ps.pmove.delta_angles, 0) !== readElement(ops.pmove.delta_angles, 0) ||
            readElement(ps.pmove.delta_angles, 1) !== readElement(ops.pmove.delta_angles, 1) ||
            readElement(ps.pmove.delta_angles, 2) !== readElement(ops.pmove.delta_angles, 2))
            flags |= PS_M_DELTA_ANGLES;
        if (readElement(ps.viewoffset, 0) !== readElement(ops.viewoffset, 0) || readElement(ps.viewoffset, 1) !== readElement(ops.viewoffset, 1) || readElement(ps.viewoffset, 2) !== readElement(ops.viewoffset, 2))
            flags |= PS_VIEWOFFSET;
        const viewangleXYChanged = readElement(ps.viewangles, 0) !== readElement(ops.viewangles, 0) || readElement(ps.viewangles, 1) !== readElement(ops.viewangles, 1);
        const viewangleZChanged = readElement(ps.viewangles, 2) !== readElement(ops.viewangles, 2);
        if (viewangleXYChanged)
            flags |= PS_VIEWANGLES;
        if (viewangleZChanged)
            extraflags |= EPS_VIEWANGLE2;
        if (readElement(ps.kick_angles, 0) !== readElement(ops.kick_angles, 0) || readElement(ps.kick_angles, 1) !== readElement(ops.kick_angles, 1) || readElement(ps.kick_angles, 2) !== readElement(ops.kick_angles, 2))
            flags |= PS_KICKANGLES;
        if (readElement(ps.blend, 0) !== readElement(ops.blend, 0) || readElement(ps.blend, 1) !== readElement(ops.blend, 1) || readElement(ps.blend, 2) !== readElement(ops.blend, 2) || readElement(ps.blend, 3) !== readElement(ops.blend, 3))
            flags |= PS_BLEND;
        if (ps.fov !== ops.fov)
            flags |= PS_FOV;
        if (ps.rdflags !== ops.rdflags)
            flags |= PS_RDFLAGS;
        flags |= PS_WEAPONINDEX;
        if (ps.gunframe !== ops.gunframe)
            flags |= PS_WEAPONFRAME;
        const gunoffsetChanged = readElement(ps.gunoffset, 0) !== readElement(ops.gunoffset, 0) || readElement(ps.gunoffset, 1) !== readElement(ops.gunoffset, 1) || readElement(ps.gunoffset, 2) !== readElement(ops.gunoffset, 2);
        if (gunoffsetChanged)
            extraflags |= EPS_GUNOFFSET;
        const gunanglesChanged = readElement(ps.gunangles, 0) !== readElement(ops.gunangles, 0) || readElement(ps.gunangles, 1) !== readElement(ops.gunangles, 1) || readElement(ps.gunangles, 2) !== readElement(ops.gunangles, 2);
        if (gunanglesChanged)
            extraflags |= EPS_GUNANGLES;
        let statbits = 0;
        for (let i = 0; i < MAX_STATS; i++)
            if (readElement(ps.stats, i) !== readElement(ops.stats, i))
                statbits |= 1 << i;
        if (statbits !== 0)
            extraflags |= EPS_STATS;
        return {
            flags,
            extraflags,
            writeBody(msg: SizeBuf): void {
                if (flags & PS_M_TYPE)
                    MSG_WriteByte(msg, ps.pmove.pm_type);
                if (flags & PS_M_ORIGIN) {
                    MSG_WriteShort(msg, readElement(ps.pmove.origin, 0));
                    MSG_WriteShort(msg, readElement(ps.pmove.origin, 1));
                }
                if (extraflags & EPS_M_ORIGIN2)
                    MSG_WriteShort(msg, readElement(ps.pmove.origin, 2));
                if (flags & PS_M_VELOCITY) {
                    MSG_WriteShort(msg, readElement(ps.pmove.velocity, 0));
                    MSG_WriteShort(msg, readElement(ps.pmove.velocity, 1));
                }
                if (extraflags & EPS_M_VELOCITY2)
                    MSG_WriteShort(msg, readElement(ps.pmove.velocity, 2));
                if (flags & PS_M_TIME)
                    MSG_WriteByte(msg, ps.pmove.pm_time);
                if (flags & PS_M_FLAGS)
                    MSG_WriteByte(msg, ps.pmove.pm_flags);
                if (flags & PS_M_GRAVITY)
                    MSG_WriteShort(msg, ps.pmove.gravity);
                if (flags & PS_M_DELTA_ANGLES) {
                    MSG_WriteShort(msg, readElement(ps.pmove.delta_angles, 0));
                    MSG_WriteShort(msg, readElement(ps.pmove.delta_angles, 1));
                    MSG_WriteShort(msg, readElement(ps.pmove.delta_angles, 2));
                }
                if (flags & PS_VIEWOFFSET) {
                    MSG_WriteChar(msg, readElement(ps.viewoffset, 0) * 4);
                    MSG_WriteChar(msg, readElement(ps.viewoffset, 1) * 4);
                    MSG_WriteChar(msg, readElement(ps.viewoffset, 2) * 4);
                }
                if (flags & PS_VIEWANGLES) {
                    MSG_WriteAngle16(msg, readElement(ps.viewangles, 0));
                    MSG_WriteAngle16(msg, readElement(ps.viewangles, 1));
                }
                if (extraflags & EPS_VIEWANGLE2)
                    MSG_WriteAngle16(msg, readElement(ps.viewangles, 2));
                if (flags & PS_KICKANGLES) {
                    MSG_WriteChar(msg, readElement(ps.kick_angles, 0) * 4);
                    MSG_WriteChar(msg, readElement(ps.kick_angles, 1) * 4);
                    MSG_WriteChar(msg, readElement(ps.kick_angles, 2) * 4);
                }
                if (flags & PS_WEAPONINDEX)
                    MSG_WriteByte(msg, ps.gunindex);
                if (flags & PS_WEAPONFRAME)
                    MSG_WriteByte(msg, ps.gunframe);
                if (extraflags & EPS_GUNOFFSET) {
                    MSG_WriteChar(msg, readElement(ps.gunoffset, 0) * 4);
                    MSG_WriteChar(msg, readElement(ps.gunoffset, 1) * 4);
                    MSG_WriteChar(msg, readElement(ps.gunoffset, 2) * 4);
                }
                if (extraflags & EPS_GUNANGLES) {
                    MSG_WriteChar(msg, readElement(ps.gunangles, 0) * 4);
                    MSG_WriteChar(msg, readElement(ps.gunangles, 1) * 4);
                    MSG_WriteChar(msg, readElement(ps.gunangles, 2) * 4);
                }
                if (flags & PS_BLEND) {
                    MSG_WriteByte(msg, readElement(ps.blend, 0) * 255);
                    MSG_WriteByte(msg, readElement(ps.blend, 1) * 255);
                    MSG_WriteByte(msg, readElement(ps.blend, 2) * 255);
                    MSG_WriteByte(msg, readElement(ps.blend, 3) * 255);
                }
                if (flags & PS_FOV)
                    MSG_WriteByte(msg, ps.fov);
                if (flags & PS_RDFLAGS)
                    MSG_WriteByte(msg, ps.rdflags);
                if (extraflags & EPS_STATS) {
                    MSG_WriteLong(msg, statbits);
                    for (let i = 0; i < MAX_STATS; i++)
                        if (statbits & (1 << i))
                            MSG_WriteShort(msg, readElement(ps.stats, i));
                }
            },
        };
    }
    function writePlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const enc = encodePlayerStateDelta(from, to);
        MSG_WriteShort(msg, enc.flags);
        MSG_WriteByte(msg, enc.extraflags);
        enc.writeBody(msg);
    }
    function copyPlayerStateFields(dst: PlayerStateT, src: PlayerStateT): void {
        dst.pmove.pm_type = src.pmove.pm_type;
        dst.pmove.origin.set(src.pmove.origin);
        dst.pmove.velocity.set(src.pmove.velocity);
        dst.pmove.pm_flags = src.pmove.pm_flags;
        dst.pmove.pm_time = src.pmove.pm_time;
        dst.pmove.gravity = src.pmove.gravity;
        dst.pmove.delta_angles.set(src.pmove.delta_angles);
        VectorCopy(src.viewangles, dst.viewangles);
        VectorCopy(src.viewoffset, dst.viewoffset);
        VectorCopy(src.kick_angles, dst.kick_angles);
        VectorCopy(src.gunangles, dst.gunangles);
        VectorCopy(src.gunoffset, dst.gunoffset);
        dst.gunindex = src.gunindex;
        dst.gunframe = src.gunframe;
        dst.blend.set(src.blend);
        dst.fov = src.fov;
        dst.rdflags = src.rdflags;
        dst.stats.set(src.stats);
    }
    function readPlayerStateFields(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT, flags: number, extraflags: number): void {
        copyPlayerStateFields(to, from);
        const target = to;
        if (flags & PS_M_TYPE)
            target.pmove.pm_type = MSG_ReadByte(msg);
        if (flags & PS_M_ORIGIN) {
            target.pmove.origin[0] = MSG_ReadShort(msg);
            target.pmove.origin[1] = MSG_ReadShort(msg);
        }
        if (extraflags & EPS_M_ORIGIN2)
            target.pmove.origin[2] = MSG_ReadShort(msg);
        if (flags & PS_M_VELOCITY) {
            target.pmove.velocity[0] = MSG_ReadShort(msg);
            target.pmove.velocity[1] = MSG_ReadShort(msg);
        }
        if (extraflags & EPS_M_VELOCITY2)
            target.pmove.velocity[2] = MSG_ReadShort(msg);
        if (flags & PS_M_TIME)
            target.pmove.pm_time = MSG_ReadByte(msg);
        if (flags & PS_M_FLAGS)
            target.pmove.pm_flags = MSG_ReadByte(msg);
        if (flags & PS_M_GRAVITY)
            target.pmove.gravity = MSG_ReadShort(msg);
        if (flags & PS_M_DELTA_ANGLES) {
            target.pmove.delta_angles[0] = MSG_ReadShort(msg);
            target.pmove.delta_angles[1] = MSG_ReadShort(msg);
            target.pmove.delta_angles[2] = MSG_ReadShort(msg);
        }
        if (flags & PS_VIEWOFFSET) {
            target.viewoffset[0] = MSG_ReadChar(msg) * 0.25;
            target.viewoffset[1] = MSG_ReadChar(msg) * 0.25;
            target.viewoffset[2] = MSG_ReadChar(msg) * 0.25;
        }
        if (flags & PS_VIEWANGLES) {
            target.viewangles[0] = MSG_ReadAngle16(msg);
            target.viewangles[1] = MSG_ReadAngle16(msg);
        }
        if (extraflags & EPS_VIEWANGLE2)
            target.viewangles[2] = MSG_ReadAngle16(msg);
        if (flags & PS_KICKANGLES) {
            target.kick_angles[0] = MSG_ReadChar(msg) * 0.25;
            target.kick_angles[1] = MSG_ReadChar(msg) * 0.25;
            target.kick_angles[2] = MSG_ReadChar(msg) * 0.25;
        }
        if (flags & PS_WEAPONINDEX)
            target.gunindex = MSG_ReadByte(msg);
        if (flags & PS_WEAPONFRAME)
            target.gunframe = MSG_ReadByte(msg);
        if (extraflags & EPS_GUNOFFSET) {
            target.gunoffset[0] = MSG_ReadChar(msg) * 0.25;
            target.gunoffset[1] = MSG_ReadChar(msg) * 0.25;
            target.gunoffset[2] = MSG_ReadChar(msg) * 0.25;
        }
        if (extraflags & EPS_GUNANGLES) {
            target.gunangles[0] = MSG_ReadChar(msg) * 0.25;
            target.gunangles[1] = MSG_ReadChar(msg) * 0.25;
            target.gunangles[2] = MSG_ReadChar(msg) * 0.25;
        }
        if (flags & PS_BLEND) {
            target.blend[0] = MSG_ReadByte(msg) / 255.0;
            target.blend[1] = MSG_ReadByte(msg) / 255.0;
            target.blend[2] = MSG_ReadByte(msg) / 255.0;
            target.blend[3] = MSG_ReadByte(msg) / 255.0;
        }
        if (flags & PS_FOV)
            target.fov = MSG_ReadByte(msg);
        if (flags & PS_RDFLAGS)
            target.rdflags = MSG_ReadByte(msg);
        if (extraflags & EPS_STATS) {
            const statbits = MSG_ReadLong(msg);
            for (let i = 0; i < MAX_STATS; i++)
                if (statbits & (1 << i))
                    target.stats[i] = MSG_ReadShort(msg);
        }
    }
    function readPlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const flags = MSG_ReadShort(msg);
        const extraflags = MSG_ReadByte(msg);
        readPlayerStateFields(msg, from, to, flags, extraflags);
    }
    let pendingFrameExtrabits = 0;
    function setR1Q2FrameExtrabits(extrabits: number): void {
        pendingFrameExtrabits = extrabits;
    }
    let pendingFrameExtraflags = 0;
    function writeFrame(msg: SizeBuf, params: FrameWriteParamsT, writeEntities: (msg: SizeBuf) => void): void {
        const enc = encodePlayerStateDelta(params.psFrom ?? new PlayerStateT(), params.psTo);
        MSG_WriteByte(msg, SvcOpsT.svc_frame | ((enc.extraflags & 0xf0) << 1));
        const offset = params.lastframe === -1 ? 31 : params.framenum - params.lastframe;
        const encodedFrame = (params.framenum & 0x07ffffff) | (offset << 27);
        MSG_WriteLong(msg, encodedFrame);
        MSG_WriteByte(msg, (params.surpressCount & 0x0f) | ((enc.extraflags & 0x0f) << 4));
        MSG_WriteByte(msg, params.areabytes);
        SZ_Write(msg, params.areabits, params.areabytes);
        MSG_WriteShort(msg, enc.flags);
        enc.writeBody(msg);
        writeEntities(msg);
    }
    function readFrameHeader(areabits: Uint8Array, _readSuppressByte: boolean): FrameHeaderT {
        const encodedFrame = MSG_ReadLong(net_message);
        const offset = encodedFrame >>> 27;
        const serverframe = encodedFrame & 0x07ffffff;
        const deltaframe = offset === 31 ? -1 : serverframe - offset;
        let extraflags = pendingFrameExtrabits >> 1;
        const suppressByte = MSG_ReadByte(net_message);
        extraflags |= (suppressByte & 0xf0) >> 4;
        pendingFrameExtraflags = extraflags;
        const surpressCount = suppressByte & 0x0f;
        const len = MSG_ReadByte(net_message);
        MSG_ReadData(net_message, areabits, len);
        return { serverframe, deltaframe, surpressCount, areabytes: len };
    }
    function readFramePlayerstate(from: PlayerStateT, to: PlayerStateT): void {
        const flags = MSG_ReadShort(net_message);
        readPlayerStateFields(net_message, from, to, flags, pendingFrameExtraflags);
    }
    const BUTTON_UCMD_DBLFORWARD = 1 << 2;
    const BUTTON_UCMD_DBLSIDE = 1 << 3;
    const BUTTON_UCMD_DBLUP = 1 << 4;
    const BUTTON_UCMD_DBL_ANGLE1 = 1 << 5;
    const BUTTON_UCMD_DBL_ANGLE2 = 1 << 6;
    function makeUsercmdCodec(minorVersion: number) {
        const compressedMovements = minorVersion >= PROTOCOL_VERSION_R1Q2_UCMD;
        function writeDeltaUsercmd(msg: SizeBuf, from: UsercmdT, cmd: UsercmdT): void {
            let bits = 0;
            if (readElement(cmd.angles, 0) !== readElement(from.angles, 0))
                bits |= 1 << 0;
            if (readElement(cmd.angles, 1) !== readElement(from.angles, 1))
                bits |= 1 << 1;
            if (readElement(cmd.angles, 2) !== readElement(from.angles, 2))
                bits |= 1 << 2;
            if (cmd.forwardmove !== from.forwardmove)
                bits |= 1 << 3;
            if (cmd.sidemove !== from.sidemove)
                bits |= 1 << 4;
            if (cmd.upmove !== from.upmove)
                bits |= 1 << 5;
            if (cmd.buttons !== from.buttons)
                bits |= 1 << 6;
            if (cmd.impulse !== from.impulse)
                bits |= 1 << 7;
            MSG_WriteByte(msg, bits);
            let buttons = bits & (1 << 6) ? cmd.buttons : 0;
            if (compressedMovements && bits & (1 << 6)) {
                if (bits & (1 << 3) && cmd.forwardmove % 5 === 0)
                    buttons |= BUTTON_UCMD_DBLFORWARD;
                if (bits & (1 << 4) && cmd.sidemove % 5 === 0)
                    buttons |= BUTTON_UCMD_DBLSIDE;
                if (bits & (1 << 5) && cmd.upmove % 5 === 0)
                    buttons |= BUTTON_UCMD_DBLUP;
                if (bits & (1 << 0) && readElement(cmd.angles, 0) % 64 === 0 && Math.abs(Math.trunc(readElement(cmd.angles, 0) / 64)) < 128)
                    buttons |= BUTTON_UCMD_DBL_ANGLE1;
                if (bits & (1 << 1) && readElement(cmd.angles, 1) % 256 === 0)
                    buttons |= BUTTON_UCMD_DBL_ANGLE2;
                MSG_WriteByte(msg, buttons);
            }
            if (bits & (1 << 0)) {
                if (buttons & BUTTON_UCMD_DBL_ANGLE1)
                    MSG_WriteChar(msg, Math.trunc(readElement(cmd.angles, 0) / 64));
                else
                    MSG_WriteShort(msg, readElement(cmd.angles, 0));
            }
            if (bits & (1 << 1)) {
                if (buttons & BUTTON_UCMD_DBL_ANGLE2)
                    MSG_WriteChar(msg, Math.trunc(readElement(cmd.angles, 1) / 256));
                else
                    MSG_WriteShort(msg, readElement(cmd.angles, 1));
            }
            if (bits & (1 << 2))
                MSG_WriteShort(msg, readElement(cmd.angles, 2));
            if (bits & (1 << 3)) {
                if (buttons & BUTTON_UCMD_DBLFORWARD)
                    MSG_WriteChar(msg, Math.trunc(cmd.forwardmove / 5));
                else
                    MSG_WriteShort(msg, cmd.forwardmove);
            }
            if (bits & (1 << 4)) {
                if (buttons & BUTTON_UCMD_DBLSIDE)
                    MSG_WriteChar(msg, Math.trunc(cmd.sidemove / 5));
                else
                    MSG_WriteShort(msg, cmd.sidemove);
            }
            if (bits & (1 << 5)) {
                if (buttons & BUTTON_UCMD_DBLUP)
                    MSG_WriteChar(msg, Math.trunc(cmd.upmove / 5));
                else
                    MSG_WriteShort(msg, cmd.upmove);
            }
            if (!compressedMovements && bits & (1 << 6))
                MSG_WriteByte(msg, cmd.buttons);
            if (bits & (1 << 7))
                MSG_WriteByte(msg, cmd.impulse);
            MSG_WriteByte(msg, cmd.msec);
            MSG_WriteByte(msg, cmd.lightlevel);
        }
        function readDeltaUsercmd(msg: SizeBuf, from: UsercmdT, move: UsercmdT): void {
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
            const bits = MSG_ReadByte(msg);
            let buttons = 0;
            if (compressedMovements && bits & (1 << 6))
                buttons = MSG_ReadByte(msg);
            if (bits & (1 << 0))
                move.angles[0] = buttons & BUTTON_UCMD_DBL_ANGLE1 ? MSG_ReadChar(msg) * 64 : MSG_ReadShort(msg);
            if (bits & (1 << 1))
                move.angles[1] = buttons & BUTTON_UCMD_DBL_ANGLE2 ? MSG_ReadChar(msg) * 256 : MSG_ReadShort(msg);
            if (bits & (1 << 2))
                move.angles[2] = MSG_ReadShort(msg);
            if (bits & (1 << 3))
                move.forwardmove = buttons & BUTTON_UCMD_DBLFORWARD ? MSG_ReadChar(msg) * 5 : MSG_ReadShort(msg);
            if (bits & (1 << 4))
                move.sidemove = buttons & BUTTON_UCMD_DBLSIDE ? MSG_ReadChar(msg) * 5 : MSG_ReadShort(msg);
            if (bits & (1 << 5))
                move.upmove = buttons & BUTTON_UCMD_DBLUP ? MSG_ReadChar(msg) * 5 : MSG_ReadShort(msg);
            if (!compressedMovements && bits & (1 << 6))
                buttons = MSG_ReadByte(msg);
            if (bits & (1 << 7))
                move.impulse = MSG_ReadByte(msg);
            move.msec = MSG_ReadByte(msg);
            move.lightlevel = MSG_ReadByte(msg);
            if (bits & (1 << 6)) {
                move.buttons = buttons & ~(BUTTON_UCMD_DBLFORWARD | BUTTON_UCMD_DBLSIDE | BUTTON_UCMD_DBLUP | BUTTON_UCMD_DBL_ANGLE1 | BUTTON_UCMD_DBL_ANGLE2);
            }
        }
        return { writeDeltaUsercmd, readDeltaUsercmd };
    }
    function readEntityBits(): {
        number: number;
        bits: number;
    } {
        let total = MSG_ReadByte(net_message);
        if (total & U_MOREBITS1)
            total |= MSG_ReadByte(net_message) << 8;
        if (total & U_MOREBITS2)
            total |= MSG_ReadByte(net_message) << 16;
        if (total & U_MOREBITS3)
            total |= MSG_ReadByte(net_message) << 24;
        let number: number;
        if (total & U_NUMBER16)
            number = MSG_ReadShort(net_message);
        else
            number = MSG_ReadByte(net_message);
        return { number, bits: total >>> 0 };
    }
    function readClientSetting(msg: SizeBuf): ClcClientSettingT {
        const index = MSG_ReadShort(msg);
        const value = MSG_ReadShort(msg);
        return { index, value };
    }
    function createR1Q2Codec(minorVersion: number): ProtocolCodec {
        const { writeDeltaEntity, readDeltaEntity } = makeEntityDeltaCodec(minorVersion);
        const { writeDeltaUsercmd, readDeltaUsercmd } = makeUsercmdCodec(minorVersion);
        return {
            name: "r1q2",
            writeServerData,
            writeDeltaEntity,
            writeEntityRemove,
            writePacketEntitiesEnd,
            writeSpawnBaseline(msg: SizeBuf, base: EntityStateT): void {
                MSG_WriteByte(msg, SvcOpsT.svc_spawnbaseline);
                writeDeltaEntity(msg, NULL_ENTITY_STATE, base, true, true);
            },
            writePlayerStateDelta,
            writePacketEntitiesBegin,
            writeFrame,
            writeDeltaUsercmd,
            readDeltaUsercmd,
            readServerData,
            readEntityBits,
            readDeltaEntity,
            readPlayerStateDelta,
            readFrameHeader,
            readFramePlayerstate,
            readPacketEntitiesBegin,
            readClientSetting,
        };
    }
    const R1Q2_CODEC: ProtocolCodec = createR1Q2Codec(PROTOCOL_VERSION_R1Q2_CURRENT);
    return { setR1Q2FrameExtrabits, createR1Q2Codec, R1Q2_CODEC };
}
