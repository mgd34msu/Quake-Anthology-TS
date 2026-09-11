import { readQ2ProEntityBits, readQ2ProEntity, writeQ2ProEntity, readQ2ProInt23, writeQ2ProInt23, readQ2ProVar64, writeQ2ProVar64, readQ2ProFog, writeQ2ProFog, q2proFogBits, q2proExtensions, q2proExtensionsV2, type Q2ProFeatures } from './q2pro-fields.ts';
import { readElement } from '../state.ts';
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import { MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteString, MSG_WriteAngle16, MSG_WriteDeltaUsercmd, MSG_ReadDeltaUsercmd, MSG_ReadByte, MSG_ReadShort, MSG_ReadWord, MSG_ReadLong, MSG_ReadString, MSG_ReadChar, MSG_ReadAngle16, MSG_ReadData, SZ_Write } from "../message.ts";
import { PROTOCOL_VERSION_Q2PRO, PROTOCOL_VERSION_Q2PRO_CURRENT, U_REMOVE, U_NUMBER16, U_MOREBITS1, SvcOpsT, PS_M_TYPE, PS_M_ORIGIN, PS_M_VELOCITY, PS_M_TIME, PS_M_FLAGS, PS_M_GRAVITY, PS_M_DELTA_ANGLES, PS_VIEWOFFSET, PS_VIEWANGLES, PS_KICKANGLES, PS_BLEND, PS_FOV, PS_WEAPONINDEX, PS_WEAPONFRAME, PS_RDFLAGS, EPS_GUNOFFSET, EPS_GUNANGLES, EPS_M_VELOCITY2, EPS_M_ORIGIN2, EPS_VIEWANGLE2, EPS_STATS, CM_ANGLE1, CM_ANGLE2, CM_ANGLE3, CM_FORWARD, CM_SIDE, CM_UP, CM_BUTTONS, CM_IMPULSE } from "../constants.ts";
import { EntityStateT, PlayerStateT, UsercmdT } from "../state.ts";
import { VectorCopy } from "../state.ts";
import type { ProtocolCodec, ServerDataParamsT, ServerDataReadResultT, FrameWriteParamsT, FrameHeaderT, ClcBatchMoveT, ClcUserinfoDeltaT, ClcClientSettingT } from "./codec.ts";
import { BitWriter, writeBatchMoveFrames, type ClcBatchMoveFrameT, BitReader, readBatchMoveAngleComponent, readBatchMoveFrames, seedFromPrev, ClcBatchMoveError, MAX_CLC_BATCH_MOVE_FRAMES } from "./clc_batch_move.ts";
interface PlayerStateDeltaEncoding {
    flags: number;
    extraflags: number;
    writeBody(msg: SizeBuf): void;
}
export function createQ2ProContext(net_message: SizeBuf) {
    const NULL_ENTITY_STATE = new EntityStateT();
    const features: Q2ProFeatures = { revision: 1015, flags: 0 };
    function makeWriteServerData(minorVersion: number) {
        return function writeServerData(msg: SizeBuf, params: ServerDataParamsT): void {
            MSG_WriteByte(msg, SvcOpsT.svc_serverdata);
            MSG_WriteLong(msg, PROTOCOL_VERSION_Q2PRO);
            MSG_WriteLong(msg, params.servercount);
            MSG_WriteByte(msg, params.attractloop ? 1 : 0);
            MSG_WriteString(msg, params.gamedir);
            MSG_WriteShort(msg, params.clientnum);
            MSG_WriteString(msg, params.levelname);
            features.revision = params.q2proVersion ?? minorVersion;
            features.flags = params.wireFlags ?? ((params.q2proStrafejumpHack ? 1 : 0) | (params.q2proQwMode ? 2 : 0) | (params.q2proWaterjumpHack ? 4 : 0));
            MSG_WriteShort(msg, features.revision);
            MSG_WriteByte(msg, params.serverState);
            if (features.revision >= 1024)
                MSG_WriteShort(msg, features.flags);
            else {
                MSG_WriteByte(msg, features.flags & 1 ? 1 : 0);
                MSG_WriteByte(msg, features.flags & 2 ? 1 : 0);
                MSG_WriteByte(msg, features.flags & 4 ? 1 : 0);
            }
        };
    }
    function writeDeltaEntityQ2Pro(from: EntityStateT, to: EntityStateT, msg: SizeBuf, force: boolean, newentity: boolean): void { writeQ2ProEntity(msg, features, from, to, force, newentity); }
    function writeDeltaEntity(msg: SizeBuf, from: EntityStateT, to: EntityStateT, force: boolean, newentity: boolean): void {
        writeDeltaEntityQ2Pro(from, to, msg, force, newentity);
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
    function writePacketEntitiesBegin(_msg: SizeBuf): void { }
    function writeSpawnBaseline(msg: SizeBuf, base: EntityStateT): void {
        MSG_WriteByte(msg, SvcOpsT.svc_spawnbaseline);
        writeDeltaEntityQ2Pro(NULL_ENTITY_STATE, base, msg, true, true);
    }
    function encodePlayerStateDelta(from: PlayerStateT, to: PlayerStateT): PlayerStateDeltaEncoding {
        const ps = to;
        const extended = q2proExtensions(features), v2 = q2proExtensionsV2(features);
        const ops = from;
        let flags = 0;
        let extraflags = 0;
        if (ps.pmove.pm_type !== ops.pmove.pm_type)
            flags |= PS_M_TYPE;
        if (readElement(ps.pmove.origin, 0) !== readElement(ops.pmove.origin, 0) || readElement(ps.pmove.origin, 1) !== readElement(ops.pmove.origin, 1))
            flags |= PS_M_ORIGIN;
        if (readElement(ps.pmove.origin, 2) !== readElement(ops.pmove.origin, 2))
            extraflags |= EPS_M_ORIGIN2;
        if (readElement(ps.pmove.velocity, 0) !== readElement(ops.pmove.velocity, 0) || readElement(ps.pmove.velocity, 1) !== readElement(ops.pmove.velocity, 1))
            flags |= PS_M_VELOCITY;
        if (readElement(ps.pmove.velocity, 2) !== readElement(ops.pmove.velocity, 2))
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
        if (readElement(ps.viewangles, 0) !== readElement(ops.viewangles, 0) || readElement(ps.viewangles, 1) !== readElement(ops.viewangles, 1))
            flags |= PS_VIEWANGLES;
        if (readElement(ps.viewangles, 2) !== readElement(ops.viewangles, 2))
            extraflags |= EPS_VIEWANGLE2;
        if (readElement(ps.kick_angles, 0) !== readElement(ops.kick_angles, 0) || readElement(ps.kick_angles, 1) !== readElement(ops.kick_angles, 1) || readElement(ps.kick_angles, 2) !== readElement(ops.kick_angles, 2))
            flags |= PS_KICKANGLES;
        if (ps.gunindex !== ops.gunindex || ps.gunskin !== ops.gunskin)
            flags |= PS_WEAPONINDEX;
        if (ps.gunframe !== ops.gunframe)
            flags |= PS_WEAPONFRAME;
        if (readElement(ps.gunoffset, 0) !== readElement(ops.gunoffset, 0) || readElement(ps.gunoffset, 1) !== readElement(ops.gunoffset, 1) || readElement(ps.gunoffset, 2) !== readElement(ops.gunoffset, 2))
            extraflags |= EPS_GUNOFFSET;
        if (readElement(ps.gunangles, 0) !== readElement(ops.gunangles, 0) || readElement(ps.gunangles, 1) !== readElement(ops.gunangles, 1) || readElement(ps.gunangles, 2) !== readElement(ops.gunangles, 2))
            extraflags |= EPS_GUNANGLES;
        if (readElement(ps.blend, 0) !== readElement(ops.blend, 0) || readElement(ps.blend, 1) !== readElement(ops.blend, 1) || readElement(ps.blend, 2) !== readElement(ops.blend, 2) || readElement(ps.blend, 3) !== readElement(ops.blend, 3))
            flags |= PS_BLEND;
        if (ps.fov !== ops.fov)
            flags |= PS_FOV;
        if (ps.rdflags !== ops.rdflags)
            flags |= PS_RDFLAGS;
        let statbits = 0n;
        const numstats = v2 ? 64 : 32;
        for (let i = 0; i < numstats; i++)
            if (readElement(ps.stats, i) !== readElement(ops.stats, i))
                statbits |= 1n << BigInt(i);
        if (statbits !== 0n)
            extraflags |= EPS_STATS;
        if (ps.clientnum !== ops.clientnum)
            extraflags |= 64;
        let blendbits = 0;
        for (let i = 0; i < 4; i++) {
            if (readElement(ps.blend, i) !== readElement(ops.blend, i))
                blendbits |= 1 << i;
            if (readElement(ps.damage_blend, i) !== readElement(ops.damage_blend, i))
                blendbits |= 16 << i;
        }
        if (v2 && blendbits !== 0)
            flags |= PS_BLEND;
        const fogbits = q2proFogBits(ops.q2proFog, ps.q2proFog);
        if (fogbits !== 0) {
            if (features.revision < 1026)
                throw new Error('Q2PRO player fog requires revision 1026');
            flags |= 0x18000;
        }
        function writeBody(msg: SizeBuf): void {
            const writeMovement = (current: number, previous: number): void => {
                if (v2)
                    writeQ2ProInt23(msg, current, previous);
                else
                    MSG_WriteShort(msg, current);
            };
            if (flags & PS_M_TYPE)
                MSG_WriteByte(msg, ps.pmove.pm_type);
            if (flags & PS_M_ORIGIN) {
                writeMovement(readElement(ps.pmove.origin, 0), readElement(ops.pmove.origin, 0));
                writeMovement(readElement(ps.pmove.origin, 1), readElement(ops.pmove.origin, 1));
            }
            if (extraflags & EPS_M_ORIGIN2)
                writeMovement(readElement(ps.pmove.origin, 2), readElement(ops.pmove.origin, 2));
            if (flags & PS_M_VELOCITY) {
                writeMovement(readElement(ps.pmove.velocity, 0), readElement(ops.pmove.velocity, 0));
                writeMovement(readElement(ps.pmove.velocity, 1), readElement(ops.pmove.velocity, 1));
            }
            if (extraflags & EPS_M_VELOCITY2)
                writeMovement(readElement(ps.pmove.velocity, 2), readElement(ops.pmove.velocity, 2));
            if (flags & PS_M_TIME) {
                if (v2)
                    MSG_WriteShort(msg, ps.pmove.pm_time);
                else
                    MSG_WriteByte(msg, ps.pmove.pm_time);
            }
            if (flags & PS_M_FLAGS) {
                if (v2)
                    MSG_WriteShort(msg, ps.pmove.pm_flags);
                else
                    MSG_WriteByte(msg, ps.pmove.pm_flags);
            }
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
            if (flags & PS_WEAPONINDEX) {
                if (extended)
                    MSG_WriteShort(msg, ps.gunindex | (ps.gunskin << 13));
                else {
                    if (ps.gunindex > 255 || ps.gunskin !== 0)
                        throw new Error('Q2PRO gun needs negotiated game extensions');
                    MSG_WriteByte(msg, ps.gunindex);
                }
            }
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
                if (v2) {
                    MSG_WriteByte(msg, blendbits);
                    for (let i = 0; i < 4; i++)
                        if (blendbits & (1 << i))
                            MSG_WriteByte(msg, readElement(ps.blend, i) * 255);
                    for (let i = 0; i < 4; i++)
                        if (blendbits & (16 << i))
                            MSG_WriteByte(msg, readElement(ps.damage_blend, i) * 255);
                }
                else
                    for (const value of ps.blend)
                        MSG_WriteByte(msg, value * 255);
            }
            if (flags & 0x10000)
                writeQ2ProFog(msg, fogbits, ps.q2proFog);
            if (flags & PS_FOV)
                MSG_WriteByte(msg, ps.fov);
            if (flags & PS_RDFLAGS)
                MSG_WriteByte(msg, ps.rdflags);
            if (extraflags & EPS_STATS) {
                if (v2)
                    writeQ2ProVar64(msg, statbits);
                else
                    MSG_WriteLong(msg, Number(statbits));
                for (let i = 0; i < numstats; i++)
                    if (statbits & (1n << BigInt(i)))
                        MSG_WriteShort(msg, readElement(ps.stats, i));
            }
            if (extraflags & 64) {
                if (features.revision >= 1022)
                    MSG_WriteShort(msg, ps.clientnum);
                else
                    MSG_WriteByte(msg, ps.clientnum);
            }
        }
        return { flags, extraflags, writeBody };
    }
    function writePlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const enc = encodePlayerStateDelta(from, to);
        MSG_WriteByte(msg, SvcOpsT.svc_playerinfo);
        MSG_WriteShort(msg, enc.flags);
        if (enc.flags & 0x8000)
            MSG_WriteByte(msg, enc.flags >>> 16);
        MSG_WriteByte(msg, enc.extraflags);
        enc.writeBody(msg);
    }
    function writeFrame(msg: SizeBuf, params: FrameWriteParamsT, writeEntities: (msg: SizeBuf) => void): void {
        const enc = encodePlayerStateDelta(params.psFrom ?? new PlayerStateT(), params.psTo);
        const extrabits = (enc.extraflags & 0x70) << 1;
        MSG_WriteByte(msg, SvcOpsT.svc_frame | extrabits);
        const deltaframe = params.lastframe;
        const offset = deltaframe === -1 ? 31 : params.framenum - deltaframe;
        const encodedFrame = (params.framenum & 0x07ffffff) | (offset << 27);
        MSG_WriteLong(msg, encodedFrame);
        const suppressByte = (params.surpressCount & 0x0f) | ((enc.extraflags & 0x0f) << 4);
        MSG_WriteByte(msg, suppressByte);
        MSG_WriteByte(msg, params.areabytes);
        SZ_Write(msg, params.areabits, params.areabytes);
        MSG_WriteShort(msg, enc.flags);
        if (enc.flags & 0x8000)
            MSG_WriteByte(msg, enc.flags >>> 16);
        enc.writeBody(msg);
        writeEntities(msg);
    }
    function writeDeltaUsercmd(msg: SizeBuf, from: UsercmdT, cmd: UsercmdT): void {
        MSG_WriteDeltaUsercmd(msg, from, cmd);
    }
    function readDeltaUsercmd(msg: SizeBuf, from: UsercmdT, move: UsercmdT): void {
        MSG_ReadDeltaUsercmd(msg, from, move);
    }
    function decodeQ2ProBatchCmd(br: BitReader, prev: UsercmdT | null): UsercmdT {
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
            cmd.upmove = br.readSigned(10);
        }
        if (bits & CM_BUTTONS) {
            const raw = br.readUnsigned(3);
            cmd.buttons = (raw & 3) | ((raw & 4) << 5);
        }
        if (bits & CM_IMPULSE)
            cmd.msec = br.readUnsigned(8);
        else
            cmd.msec = prev ? prev.msec : 0;
        return cmd;
    }
    function encodeQ2ProBatchCmd(bw: BitWriter, cmd: UsercmdT, prev: UsercmdT | null): void {
        const from = prev ?? new UsercmdT();
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
        if (cmd.msec !== from.msec)
            bits |= CM_IMPULSE;
        bw.writeUnsigned(bits === 0 ? 0 : 1, 1);
        if (bits === 0)
            return;
        bw.writeUnsigned(bits, 8);
        const angle = (axis: number): void => {
            const value = readElement(cmd.angles, axis), delta = value - readElement(from.angles, axis);
            const small = delta >= -128 && delta <= 127;
            bw.writeUnsigned(small ? 1 : 0, 1);
            bw.writeSigned(small ? delta : value, small ? 8 : 16);
        };
        if (bits & CM_ANGLE1)
            angle(0);
        if (bits & CM_ANGLE2)
            angle(1);
        if (bits & CM_ANGLE3)
            bw.writeSigned(readElement(cmd.angles, 2), 16);
        if (bits & CM_FORWARD)
            bw.writeSigned(cmd.forwardmove, 10);
        if (bits & CM_SIDE)
            bw.writeSigned(cmd.sidemove, 10);
        if (bits & CM_UP)
            bw.writeSigned(cmd.upmove, 10);
        if (bits & CM_BUTTONS)
            bw.writeUnsigned((cmd.buttons & 3) | ((cmd.buttons >> 5) & 4), 3);
        if (bits & CM_IMPULSE)
            bw.writeUnsigned(cmd.msec, 8);
    }
    function writeBatchMove(msg: SizeBuf, lastframe: number | null, frames: ClcBatchMoveFrameT[]): void {
        if (frames.length < 1 || frames.length >= MAX_CLC_BATCH_MOVE_FRAMES || frames.some(frame => frame.cmds.length > 31))
            throw new ClcBatchMoveError('Q2PRO command batch exceeds wire bounds');
        if (lastframe !== null)
            MSG_WriteLong(msg, lastframe);
        MSG_WriteByte(msg, frames.at(-1)?.cmds.at(-1)?.lightlevel ?? 0);
        writeBatchMoveFrames(new BitWriter(msg), frames, encodeQ2ProBatchCmd);
    }
    function readBatchMove(msg: SizeBuf, nodelta: boolean, opcodeExtra: number): ClcBatchMoveT {
        const numDups = opcodeExtra;
        if (numDups >= MAX_CLC_BATCH_MOVE_FRAMES - 1) {
            throw new ClcBatchMoveError("clc_q2pro_move_batched (36): num_dups out of range (Q2P_ERR_BAD_DATA, q2proto_proto_q2pro.c:2481-2482)");
        }
        const lastframe = nodelta ? -1 : MSG_ReadLong(msg);
        const lightlevel = MSG_ReadByte(msg);
        if (lightlevel < 0)
            throw new ClcBatchMoveError("clc_q2pro_move_batched (36): truncated message (lightlevel)");
        const br = new BitReader(msg);
        const frames = readBatchMoveFrames(br, numDups, decodeQ2ProBatchCmd);
        return { lastframe, numDups, frames };
    }
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
    function readServerData(minorVersion: number): ServerDataReadResultT {
        const servercount = MSG_ReadLong(net_message);
        const attractloop = MSG_ReadByte(net_message) !== 0;
        const gamedir = MSG_ReadString(net_message);
        const clientnum = MSG_ReadShort(net_message);
        const levelname = MSG_ReadString(net_message);
        const q2proVersion = MSG_ReadWord(net_message);
        features.revision = q2proVersion || minorVersion;
        const serverState = MSG_ReadByte(net_message);
        features.flags = features.revision >= 1024 ? MSG_ReadWord(net_message) : (MSG_ReadByte(net_message) ? 1 : 0) | (MSG_ReadByte(net_message) ? 2 : 0) | (MSG_ReadByte(net_message) ? 4 : 0);
        const q2proStrafejumpHack = (features.flags & 1) !== 0, q2proQwMode = (features.flags & 2) !== 0, q2proWaterjumpHack = (features.flags & 4) !== 0;
        return {
            servercount,
            attractloop,
            gamedir,
            clientnum,
            levelname,
            serverState,
            q2proVersion: features.revision,
            wireFlags: features.flags,
            q2proStrafejumpHack,
            q2proQwMode,
            q2proWaterjumpHack,
        };
    }
    function readEntityBits(): {
        number: number;
        bits: number;
    } { return readQ2ProEntityBits(net_message); }
    function readDeltaEntity(from: EntityStateT, to: EntityStateT, number: number, bits: number): void { readQ2ProEntity(net_message, features, from, to, number, bits); }
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
        dst.gunskin = src.gunskin;
        dst.clientnum = src.clientnum;
        dst.q2proFog = { ...src.q2proFog };
        dst.damage_blend.set(src.damage_blend);
        dst.gunframe = src.gunframe;
        dst.blend.set(src.blend);
        dst.fov = src.fov;
        dst.rdflags = src.rdflags;
        dst.stats.set(src.stats);
    }
    function readPlayerStateBody(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT, flags: number, extraflags: number): void {
        copyPlayerStateFields(to, from);
        const target = to;
        const extended = q2proExtensions(features), v2 = q2proExtensionsV2(features);
        const readMovement = (previous: number): number => v2 ? readQ2ProInt23(msg, previous) : MSG_ReadShort(msg);
        if (flags & PS_M_TYPE)
            target.pmove.pm_type = MSG_ReadByte(msg);
        if (flags & PS_M_ORIGIN) {
            target.pmove.origin[0] = readMovement(readElement(from.pmove.origin, 0));
            target.pmove.origin[1] = readMovement(readElement(from.pmove.origin, 1));
        }
        if (extraflags & EPS_M_ORIGIN2)
            target.pmove.origin[2] = readMovement(readElement(from.pmove.origin, 2));
        if (flags & PS_M_VELOCITY) {
            target.pmove.velocity[0] = readMovement(readElement(from.pmove.velocity, 0));
            target.pmove.velocity[1] = readMovement(readElement(from.pmove.velocity, 1));
        }
        if (extraflags & EPS_M_VELOCITY2)
            target.pmove.velocity[2] = readMovement(readElement(from.pmove.velocity, 2));
        if (flags & PS_M_TIME)
            target.pmove.pm_time = v2 ? MSG_ReadWord(msg) : MSG_ReadByte(msg);
        if (flags & PS_M_FLAGS)
            target.pmove.pm_flags = v2 ? MSG_ReadWord(msg) : MSG_ReadByte(msg);
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
        if (flags & PS_WEAPONINDEX) {
            if (extended) {
                const gun = MSG_ReadWord(msg);
                target.gunindex = gun & 8191;
                target.gunskin = gun >>> 13;
            }
            else
                target.gunindex = MSG_ReadByte(msg);
        }
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
            if (v2) {
                const bits = MSG_ReadByte(msg);
                for (let i = 0; i < 4; i++)
                    if (bits & (1 << i))
                        target.blend[i] = MSG_ReadByte(msg) / 255;
                for (let i = 0; i < 4; i++)
                    if (bits & (16 << i))
                        target.damage_blend[i] = MSG_ReadByte(msg) / 255;
            }
            else
                for (let i = 0; i < 4; i++)
                    target.blend[i] = MSG_ReadByte(msg) / 255;
        }
        if (flags & 0x10000)
            target.q2proFog = readQ2ProFog(msg, from.q2proFog);
        if (flags & PS_FOV)
            target.fov = MSG_ReadByte(msg);
        if (flags & PS_RDFLAGS)
            target.rdflags = MSG_ReadByte(msg);
        if (extraflags & EPS_STATS) {
            const statbits = v2 ? readQ2ProVar64(msg) : BigInt(MSG_ReadLong(msg) >>> 0);
            for (let i = 0; i < (v2 ? 64 : 32); i++)
                if (statbits & (1n << BigInt(i)))
                    target.stats[i] = MSG_ReadShort(msg);
        }
        if (extraflags & 64)
            target.clientnum = features.revision >= 1022 ? MSG_ReadShort(msg) : MSG_ReadByte(msg);
    }
    function readPlayerStateDelta(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        let flags = MSG_ReadWord(msg);
        if (features.revision >= 1026 && (flags & 0x8000))
            flags |= MSG_ReadByte(msg) << 16;
        const extraflags = MSG_ReadByte(msg);
        readPlayerStateBody(msg, from, to, flags, extraflags);
    }
    let pendingOpcodeExtrabits = 0;
    let pendingFrameExtraflags = 0;
    function noteQ2ProFrameOpcodeExtrabits(extrabits: number): void {
        pendingOpcodeExtrabits = extrabits;
    }
    function readFrameHeader(areabits: Uint8Array, _readSuppressByte: boolean): FrameHeaderT {
        const encodedFrame = MSG_ReadLong(net_message);
        const offset = encodedFrame >>> 27;
        const serverframe = encodedFrame & 0x07ffffff;
        const deltaframe = offset === 31 ? -1 : serverframe - offset;
        const extraflagsHigh = (pendingOpcodeExtrabits >> 1) & 0x70;
        pendingOpcodeExtrabits = 0;
        const suppressRaw = MSG_ReadByte(net_message);
        const surpressCount = suppressRaw & 0x0f;
        const extraflagsLow = (suppressRaw & 0xf0) >> 4;
        pendingFrameExtraflags = extraflagsHigh | extraflagsLow;
        const len = MSG_ReadByte(net_message);
        MSG_ReadData(net_message, areabits, len);
        return { serverframe, deltaframe, surpressCount, areabytes: len };
    }
    function readFramePlayerstate(from: PlayerStateT, to: PlayerStateT): void {
        let flags = MSG_ReadWord(net_message);
        if (features.revision >= 1026 && (flags & 0x8000))
            flags |= MSG_ReadByte(net_message) << 16;
        readPlayerStateBody(net_message, from, to, flags, pendingFrameExtraflags);
    }
    function readPacketEntitiesBegin(): void {
    }
    function createQ2ProCodec(minorVersion: number): ProtocolCodec {
        features.revision = minorVersion;
        const writeServerData = makeWriteServerData(minorVersion);
        return {
            name: "q2pro",
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
            readServerData: () => readServerData(minorVersion),
            readEntityBits,
            readDeltaEntity,
            readPlayerStateDelta,
            readFrameHeader,
            readFramePlayerstate,
            readPacketEntitiesBegin,
            readBatchMove,
            writeBatchMove,
            readUserinfoDelta,
            readClientSetting,
        };
    }
    const Q2PRO_CODEC: ProtocolCodec = createQ2ProCodec(PROTOCOL_VERSION_Q2PRO_CURRENT);
    return { features, noteQ2ProFrameOpcodeExtrabits, createQ2ProCodec, Q2PRO_CODEC };
}
