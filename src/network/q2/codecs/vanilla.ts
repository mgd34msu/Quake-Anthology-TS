import { readElement } from '../state.ts';
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import { MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteString, MSG_WriteAngle16, MSG_WriteDeltaEntity, MSG_WriteDeltaUsercmd, MSG_ReadDeltaUsercmd, MSG_ReadByte, MSG_ReadShort, MSG_ReadLong, MSG_ReadString, MSG_ReadChar, MSG_ReadAngle, MSG_ReadAngle16, MSG_ReadCoord, MSG_ReadPos, MSG_ReadData, SZ_Write, } from "../message.ts";
import { PROTOCOL_VERSION } from "../constants.ts";
import { Com_Error } from "../errors.ts";
import { U_REMOVE, U_NUMBER16, U_MOREBITS1, U_MOREBITS2, U_MOREBITS3, U_MODEL, U_MODEL2, U_MODEL3, U_MODEL4, U_FRAME8, U_FRAME16, U_SKIN8, U_SKIN16, U_EFFECTS8, U_EFFECTS16, U_RENDERFX8, U_RENDERFX16, U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_OLDORIGIN, U_SOUND, U_EVENT, U_SOLID, SvcOpsT, PS_M_TYPE, PS_M_ORIGIN, PS_M_VELOCITY, PS_M_TIME, PS_M_FLAGS, PS_M_GRAVITY, PS_M_DELTA_ANGLES, PS_VIEWOFFSET, PS_VIEWANGLES, PS_KICKANGLES, PS_BLEND, PS_FOV, PS_WEAPONINDEX, PS_WEAPONFRAME, PS_RDFLAGS, ERR_DROP, } from "../constants.ts";
import { EntityStateT, PlayerStateT, type UsercmdT, MAX_STATS } from "../state.ts";
import { VectorCopy } from "../state.ts";
import type { ProtocolCodec, ServerDataParamsT, ServerDataReadResultT, FrameWriteParamsT, FrameHeaderT } from "./codec.ts";
export function createVanillaContext(net_message: SizeBuf) {
    const NULL_ENTITY_STATE = new EntityStateT();
    function writeServerData(msg: SizeBuf, params: ServerDataParamsT): void {
        MSG_WriteByte(msg, SvcOpsT.svc_serverdata);
        MSG_WriteLong(msg, PROTOCOL_VERSION);
        MSG_WriteLong(msg, params.servercount);
        MSG_WriteByte(msg, params.attractloop ? 1 : 0);
        MSG_WriteString(msg, params.gamedir);
        MSG_WriteShort(msg, params.clientnum);
        MSG_WriteString(msg, params.levelname);
    }
    function writeDeltaEntity(msg: SizeBuf, from: EntityStateT, to: EntityStateT, force: boolean, newentity: boolean): void {
        MSG_WriteDeltaEntity(from, to, msg, force, newentity);
    }
    function writeEntityRemove(msg: SizeBuf, oldnum: number): void {
        let bits = U_REMOVE;
        if (oldnum >= 256)
            bits |= U_NUMBER16 | U_MOREBITS1;
        MSG_WriteByte(msg, bits & 255);
        if (bits & 0x0000ff00)
            MSG_WriteByte(msg, (bits >> 8) & 255);
        if (bits & U_NUMBER16)
            MSG_WriteShort(msg, oldnum);
        else
            MSG_WriteByte(msg, oldnum);
    }
    function writePacketEntitiesEnd(msg: SizeBuf): void {
        MSG_WriteShort(msg, 0);
    }
    function writePacketEntitiesBegin(msg: SizeBuf): void {
        MSG_WriteByte(msg, SvcOpsT.svc_packetentities);
    }
    function writeSpawnBaseline(msg: SizeBuf, base: EntityStateT): void {
        MSG_WriteByte(msg, SvcOpsT.svc_spawnbaseline);
        MSG_WriteDeltaEntity(NULL_ENTITY_STATE, base, msg, true, true);
    }
    function writePlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const ps = to;
        const ops = from;
        let pflags = 0;
        if (ps.pmove.pm_type !== ops.pmove.pm_type)
            pflags |= PS_M_TYPE;
        if (readElement(ps.pmove.origin, 0) !== readElement(ops.pmove.origin, 0) || readElement(ps.pmove.origin, 1) !== readElement(ops.pmove.origin, 1) || readElement(ps.pmove.origin, 2) !== readElement(ops.pmove.origin, 2))
            pflags |= PS_M_ORIGIN;
        if (readElement(ps.pmove.velocity, 0) !== readElement(ops.pmove.velocity, 0) ||
            readElement(ps.pmove.velocity, 1) !== readElement(ops.pmove.velocity, 1) ||
            readElement(ps.pmove.velocity, 2) !== readElement(ops.pmove.velocity, 2))
            pflags |= PS_M_VELOCITY;
        if (ps.pmove.pm_time !== ops.pmove.pm_time)
            pflags |= PS_M_TIME;
        if (ps.pmove.pm_flags !== ops.pmove.pm_flags)
            pflags |= PS_M_FLAGS;
        if (ps.pmove.gravity !== ops.pmove.gravity)
            pflags |= PS_M_GRAVITY;
        if (readElement(ps.pmove.delta_angles, 0) !== readElement(ops.pmove.delta_angles, 0) ||
            readElement(ps.pmove.delta_angles, 1) !== readElement(ops.pmove.delta_angles, 1) ||
            readElement(ps.pmove.delta_angles, 2) !== readElement(ops.pmove.delta_angles, 2))
            pflags |= PS_M_DELTA_ANGLES;
        if (readElement(ps.viewoffset, 0) !== readElement(ops.viewoffset, 0) || readElement(ps.viewoffset, 1) !== readElement(ops.viewoffset, 1) || readElement(ps.viewoffset, 2) !== readElement(ops.viewoffset, 2))
            pflags |= PS_VIEWOFFSET;
        if (readElement(ps.viewangles, 0) !== readElement(ops.viewangles, 0) || readElement(ps.viewangles, 1) !== readElement(ops.viewangles, 1) || readElement(ps.viewangles, 2) !== readElement(ops.viewangles, 2))
            pflags |= PS_VIEWANGLES;
        if (readElement(ps.kick_angles, 0) !== readElement(ops.kick_angles, 0) || readElement(ps.kick_angles, 1) !== readElement(ops.kick_angles, 1) || readElement(ps.kick_angles, 2) !== readElement(ops.kick_angles, 2))
            pflags |= PS_KICKANGLES;
        if (readElement(ps.blend, 0) !== readElement(ops.blend, 0) ||
            readElement(ps.blend, 1) !== readElement(ops.blend, 1) ||
            readElement(ps.blend, 2) !== readElement(ops.blend, 2) ||
            readElement(ps.blend, 3) !== readElement(ops.blend, 3))
            pflags |= PS_BLEND;
        if (ps.fov !== ops.fov)
            pflags |= PS_FOV;
        if (ps.rdflags !== ops.rdflags)
            pflags |= PS_RDFLAGS;
        if (ps.gunframe !== ops.gunframe)
            pflags |= PS_WEAPONFRAME;
        pflags |= PS_WEAPONINDEX;
        MSG_WriteByte(msg, SvcOpsT.svc_playerinfo);
        MSG_WriteShort(msg, pflags);
        if (pflags & PS_M_TYPE)
            MSG_WriteByte(msg, ps.pmove.pm_type);
        if (pflags & PS_M_ORIGIN) {
            MSG_WriteShort(msg, readElement(ps.pmove.origin, 0));
            MSG_WriteShort(msg, readElement(ps.pmove.origin, 1));
            MSG_WriteShort(msg, readElement(ps.pmove.origin, 2));
        }
        if (pflags & PS_M_VELOCITY) {
            MSG_WriteShort(msg, readElement(ps.pmove.velocity, 0));
            MSG_WriteShort(msg, readElement(ps.pmove.velocity, 1));
            MSG_WriteShort(msg, readElement(ps.pmove.velocity, 2));
        }
        if (pflags & PS_M_TIME)
            MSG_WriteByte(msg, ps.pmove.pm_time);
        if (pflags & PS_M_FLAGS)
            MSG_WriteByte(msg, ps.pmove.pm_flags);
        if (pflags & PS_M_GRAVITY)
            MSG_WriteShort(msg, ps.pmove.gravity);
        if (pflags & PS_M_DELTA_ANGLES) {
            MSG_WriteShort(msg, readElement(ps.pmove.delta_angles, 0));
            MSG_WriteShort(msg, readElement(ps.pmove.delta_angles, 1));
            MSG_WriteShort(msg, readElement(ps.pmove.delta_angles, 2));
        }
        if (pflags & PS_VIEWOFFSET) {
            MSG_WriteChar(msg, readElement(ps.viewoffset, 0) * 4);
            MSG_WriteChar(msg, readElement(ps.viewoffset, 1) * 4);
            MSG_WriteChar(msg, readElement(ps.viewoffset, 2) * 4);
        }
        if (pflags & PS_VIEWANGLES) {
            MSG_WriteAngle16(msg, readElement(ps.viewangles, 0));
            MSG_WriteAngle16(msg, readElement(ps.viewangles, 1));
            MSG_WriteAngle16(msg, readElement(ps.viewangles, 2));
        }
        if (pflags & PS_KICKANGLES) {
            MSG_WriteChar(msg, readElement(ps.kick_angles, 0) * 4);
            MSG_WriteChar(msg, readElement(ps.kick_angles, 1) * 4);
            MSG_WriteChar(msg, readElement(ps.kick_angles, 2) * 4);
        }
        if (pflags & PS_WEAPONINDEX) {
            MSG_WriteByte(msg, ps.gunindex);
        }
        if (pflags & PS_WEAPONFRAME) {
            MSG_WriteByte(msg, ps.gunframe);
            MSG_WriteChar(msg, readElement(ps.gunoffset, 0) * 4);
            MSG_WriteChar(msg, readElement(ps.gunoffset, 1) * 4);
            MSG_WriteChar(msg, readElement(ps.gunoffset, 2) * 4);
            MSG_WriteChar(msg, readElement(ps.gunangles, 0) * 4);
            MSG_WriteChar(msg, readElement(ps.gunangles, 1) * 4);
            MSG_WriteChar(msg, readElement(ps.gunangles, 2) * 4);
        }
        if (pflags & PS_BLEND) {
            MSG_WriteByte(msg, readElement(ps.blend, 0) * 255);
            MSG_WriteByte(msg, readElement(ps.blend, 1) * 255);
            MSG_WriteByte(msg, readElement(ps.blend, 2) * 255);
            MSG_WriteByte(msg, readElement(ps.blend, 3) * 255);
        }
        if (pflags & PS_FOV)
            MSG_WriteByte(msg, ps.fov);
        if (pflags & PS_RDFLAGS)
            MSG_WriteByte(msg, ps.rdflags);
        let statbits = 0;
        for (let i = 0; i < MAX_STATS; i++)
            if (readElement(ps.stats, i) !== readElement(ops.stats, i))
                statbits |= 1 << i;
        MSG_WriteLong(msg, statbits);
        for (let i = 0; i < MAX_STATS; i++)
            if (statbits & (1 << i))
                MSG_WriteShort(msg, readElement(ps.stats, i));
    }
    function writeFrame(msg: SizeBuf, params: FrameWriteParamsT, writeEntities: (msg: SizeBuf) => void): void {
        MSG_WriteByte(msg, SvcOpsT.svc_frame);
        MSG_WriteLong(msg, params.framenum);
        MSG_WriteLong(msg, params.lastframe);
        MSG_WriteByte(msg, params.surpressCount);
        MSG_WriteByte(msg, params.areabytes);
        SZ_Write(msg, params.areabits, params.areabytes);
        writePlayerStateDelta(msg, params.psFrom ?? new PlayerStateT(), params.psTo);
        writeEntities(msg);
    }
    function writeDeltaUsercmd(msg: SizeBuf, from: UsercmdT, cmd: UsercmdT): void {
        MSG_WriteDeltaUsercmd(msg, from, cmd);
    }
    function readDeltaUsercmd(msg: SizeBuf, from: UsercmdT, move: UsercmdT): void {
        MSG_ReadDeltaUsercmd(msg, from, move);
    }
    const bitcounts = new Int32Array(32);
    function readServerData(): ServerDataReadResultT {
        const servercount = MSG_ReadLong(net_message);
        const attractloop = MSG_ReadByte(net_message) !== 0;
        const gamedir = MSG_ReadString(net_message);
        const clientnum = MSG_ReadShort(net_message);
        const levelname = MSG_ReadString(net_message);
        return { servercount, attractloop, gamedir, clientnum, levelname, serverState: 0 };
    }
    function readEntityBits(): {
        number: number;
        bits: number;
    } {
        let total = MSG_ReadByte(net_message);
        if (total & U_MOREBITS1) {
            const b = MSG_ReadByte(net_message);
            total |= b << 8;
        }
        if (total & U_MOREBITS2) {
            const b = MSG_ReadByte(net_message);
            total |= b << 16;
        }
        if (total & U_MOREBITS3) {
            const b = MSG_ReadByte(net_message);
            total |= b << 24;
        }
        for (let i = 0; i < 32; i++)
            if (total & (1 << i))
                bitcounts[i] = readElement(bitcounts, i) + 1;
        let number: number;
        if (total & U_NUMBER16)
            number = MSG_ReadShort(net_message);
        else
            number = MSG_ReadByte(net_message);
        return { number, bits: total >>> 0 };
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
            to.frame = MSG_ReadShort(net_message);
        if (bits & U_SKIN8 && bits & U_SKIN16)
            to.skinnum = MSG_ReadLong(net_message);
        else if (bits & U_SKIN8)
            to.skinnum = MSG_ReadByte(net_message);
        else if (bits & U_SKIN16)
            to.skinnum = MSG_ReadShort(net_message);
        if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16))
            to.effects = MSG_ReadLong(net_message);
        else if (bits & U_EFFECTS8)
            to.effects = MSG_ReadByte(net_message);
        else if (bits & U_EFFECTS16)
            to.effects = MSG_ReadShort(net_message);
        if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16))
            to.renderfx = MSG_ReadLong(net_message);
        else if (bits & U_RENDERFX8)
            to.renderfx = MSG_ReadByte(net_message);
        else if (bits & U_RENDERFX16)
            to.renderfx = MSG_ReadShort(net_message);
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
            to.solid = MSG_ReadShort(net_message);
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
    function readPlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        copyPlayerStateFields(to, from);
        const target = to;
        const flags = MSG_ReadShort(msg);
        if (flags & PS_M_TYPE)
            target.pmove.pm_type = MSG_ReadByte(msg);
        if (flags & PS_M_ORIGIN) {
            target.pmove.origin[0] = MSG_ReadShort(msg);
            target.pmove.origin[1] = MSG_ReadShort(msg);
            target.pmove.origin[2] = MSG_ReadShort(msg);
        }
        if (flags & PS_M_VELOCITY) {
            target.pmove.velocity[0] = MSG_ReadShort(msg);
            target.pmove.velocity[1] = MSG_ReadShort(msg);
            target.pmove.velocity[2] = MSG_ReadShort(msg);
        }
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
            target.viewangles[2] = MSG_ReadAngle16(msg);
        }
        if (flags & PS_KICKANGLES) {
            target.kick_angles[0] = MSG_ReadChar(msg) * 0.25;
            target.kick_angles[1] = MSG_ReadChar(msg) * 0.25;
            target.kick_angles[2] = MSG_ReadChar(msg) * 0.25;
        }
        if (flags & PS_WEAPONINDEX) {
            target.gunindex = MSG_ReadByte(msg);
        }
        if (flags & PS_WEAPONFRAME) {
            target.gunframe = MSG_ReadByte(msg);
            target.gunoffset[0] = MSG_ReadChar(msg) * 0.25;
            target.gunoffset[1] = MSG_ReadChar(msg) * 0.25;
            target.gunoffset[2] = MSG_ReadChar(msg) * 0.25;
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
        const statbits = MSG_ReadLong(msg);
        for (let i = 0; i < MAX_STATS; i++)
            if (statbits & (1 << i))
                target.stats[i] = MSG_ReadShort(msg);
    }
    function readFrameHeader(areabits: Uint8Array, readSuppressByte: boolean): FrameHeaderT {
        const serverframe = MSG_ReadLong(net_message);
        const deltaframe = MSG_ReadLong(net_message);
        let surpressCount = 0;
        if (readSuppressByte)
            surpressCount = MSG_ReadByte(net_message);
        const len = MSG_ReadByte(net_message);
        MSG_ReadData(net_message, areabits, len);
        return { serverframe, deltaframe, surpressCount, areabytes: len };
    }
    function readFramePlayerstate(from: PlayerStateT, to: PlayerStateT): void {
        const cmd = MSG_ReadByte(net_message);
        if (cmd !== SvcOpsT.svc_playerinfo)
            Com_Error(ERR_DROP, "CL_ParseFrame: not playerinfo");
        readPlayerStateDelta(net_message, from, to);
    }
    function readPacketEntitiesBegin(): void {
        const cmd = MSG_ReadByte(net_message);
        if (cmd !== SvcOpsT.svc_packetentities)
            Com_Error(ERR_DROP, "CL_ParseFrame: not packetentities");
    }
    const VANILLA_CODEC: ProtocolCodec = {
        name: "vanilla",
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
        readPlayerStateDelta,
        readFrameHeader,
        readFramePlayerstate,
        readPacketEntitiesBegin,
        clcMoveHasChecksum: true,
    };
    return { VANILLA_CODEC };
}
