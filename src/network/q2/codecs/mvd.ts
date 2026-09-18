import { MSG_ReadFloat } from '../message.ts';
import { readQ2ProInt23, readQ2ProVar64, readQ2ProFog } from './q2pro-fields.ts';
import { readElement } from '../state.ts';
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import { MSG_WriteByte, MSG_WriteShort, MSG_WriteChar, MSG_WriteLong, MSG_WriteLong64, MSG_ReadByte, MSG_ReadShort, MSG_ReadWord, MSG_ReadChar, MSG_ReadLong, MSG_ReadLong64 } from "../message.ts";
import { ANGLE2SHORT, SHORT2ANGLE, PlayerStateT } from "../state.ts";
export const MVD_MAGIC = 0x3244564d >>> 0;
export const PROTOCOL_VERSION_MVD = 37;
export const PROTOCOL_VERSION_MVD_MINIMUM = 2009;
export const PROTOCOL_VERSION_MVD_DEFAULT = 2010;
export const PROTOCOL_VERSION_MVD_EXTENDED_LIMITS = 2011;
export const PROTOCOL_VERSION_MVD_EXTENDED_LIMITS_2 = 2012;
export const PROTOCOL_VERSION_MVD_CURRENT = 2013;
export const PROTOCOL_VERSION_MVD_RERELEASE = 3038;
export const SVCMD_BITS = 5;
export const SVCMD_MASK = (1 << SVCMD_BITS) - 1;
export const mvd_bad = 0;
export const mvd_nop = 1;
export const mvd_disconnect = 2;
export const mvd_reconnect = 3;
export const mvd_serverdata = 4;
export const mvd_configstring = 5;
export const mvd_frame = 6;
export const mvd_frame_nodelta = 7;
export const mvd_unicast = 8;
export const mvd_unicast_r = 9;
export const mvd_multicast_all = 10;
export const mvd_multicast_phs = 11;
export const mvd_multicast_pvs = 12;
export const mvd_multicast_all_r = 13;
export const mvd_multicast_phs_r = 14;
export const mvd_multicast_pvs_r = 15;
export const mvd_sound = 16;
export const mvd_print = 17;
export const mvd_stufftext = 18;
export function MSG_WriteMvdCmd(msg: SizeBuf, op: number, extrabits: number): void {
    MSG_WriteByte(msg, (op | (extrabits << SVCMD_BITS)) & 0xff);
}
export interface MvdCmdT {
    op: number;
    extrabits: number;
}
export function MSG_ReadMvdCmd(msg: SizeBuf): MvdCmdT {
    const byte = MSG_ReadByte(msg);
    return { op: byte & SVCMD_MASK, extrabits: (byte & 0xff) >>> SVCMD_BITS };
}
export const MVF_NOMSGS = 1 << 0;
export const MVF_EXTLIMITS = 1 << 2;
export const MVF_EXTLIMITS_2 = 1 << 3;
export const CLIENTNUM_NONE = 255;
export const PPS_M_TYPE = 1 << 0;
export const PPS_M_ORIGIN = 1 << 1;
export const PPS_M_ORIGIN2 = 1 << 2;
export const PPS_VIEWOFFSET = 1 << 3;
export const PPS_VIEWANGLES = 1 << 4;
export const PPS_VIEWANGLE2 = 1 << 5;
export const PPS_KICKANGLES = 1 << 6;
export const PPS_BLEND = 1 << 7;
export const PPS_FOV = 1 << 8;
export const PPS_WEAPONINDEX = 1 << 9;
export const PPS_WEAPONFRAME = 1 << 10;
export const PPS_GUNOFFSET = 1 << 11;
export const PPS_GUNANGLES = 1 << 12;
export const PPS_RDFLAGS = 1 << 13;
export const PPS_STATS = 1 << 14;
export const PPS_MOREBITS = 1 << 15;
export const GTV_PROTOCOL_VERSION = 0xed04;
export const MAX_GTC_MSGLEN = 256;
export const GTF_DEFLATE = 1;
export const GTF_STRINGCMDS = 2;
export enum GtvServerOpT {
    GTS_HELLO,
    GTS_PONG,
    GTS_STREAM_START,
    GTS_STREAM_STOP,
    GTS_STREAM_DATA,
    GTS_ERROR,
    GTS_BADREQUEST,
    GTS_NOACCESS,
    GTS_DISCONNECT,
    GTS_RECONNECT
}
export enum GtvClientOpT {
    GTC_HELLO,
    GTC_PING,
    GTC_STREAM_START,
    GTC_STREAM_STOP,
    GTC_STRINGCMD
}
export const MAX_STATS_OLD = 32;
export function MSG_ValidMvdClientNumber(number: number): boolean {
    return number >= 0 && number < CLIENTNUM_NONE;
}
export function MSG_WriteMvdPlayersEnd(msg: SizeBuf): void {
    MSG_WriteByte(msg, CLIENTNUM_NONE);
}
export function MSG_WriteDeltaMvdPlayerstate(msg: SizeBuf, from: PlayerStateT | null, to: PlayerStateT | null, number: number, force: boolean): void {
    if (!MSG_ValidMvdClientNumber(number)) {
        throw new Error(`MSG_WriteDeltaMvdPlayerstate: bad number: ${number}`);
    }
    if (!to) {
        MSG_WriteByte(msg, number);
        MSG_WriteShort(msg, PPS_MOREBITS);
        return;
    }
    const f = from ?? new PlayerStateT();
    let pflags = 0;
    if (to.pmove.pm_type !== f.pmove.pm_type)
        pflags |= PPS_M_TYPE;
    if (readElement(to.pmove.origin, 0) !== readElement(f.pmove.origin, 0) || readElement(to.pmove.origin, 1) !== readElement(f.pmove.origin, 1))
        pflags |= PPS_M_ORIGIN;
    if (readElement(to.pmove.origin, 2) !== readElement(f.pmove.origin, 2))
        pflags |= PPS_M_ORIGIN2;
    if (readElement(to.viewoffset, 0) !== readElement(f.viewoffset, 0) || readElement(to.viewoffset, 1) !== readElement(f.viewoffset, 1) || readElement(to.viewoffset, 2) !== readElement(f.viewoffset, 2))
        pflags |= PPS_VIEWOFFSET;
    const toYaw0 = ANGLE2SHORT(readElement(to.viewangles, 0));
    const toYaw1 = ANGLE2SHORT(readElement(to.viewangles, 1));
    const toYaw2 = ANGLE2SHORT(readElement(to.viewangles, 2));
    const fromYaw0 = ANGLE2SHORT(readElement(f.viewangles, 0));
    const fromYaw1 = ANGLE2SHORT(readElement(f.viewangles, 1));
    const fromYaw2 = ANGLE2SHORT(readElement(f.viewangles, 2));
    if (toYaw0 !== fromYaw0 || toYaw1 !== fromYaw1)
        pflags |= PPS_VIEWANGLES;
    if (toYaw2 !== fromYaw2)
        pflags |= PPS_VIEWANGLE2;
    if (readElement(to.kick_angles, 0) !== readElement(f.kick_angles, 0) || readElement(to.kick_angles, 1) !== readElement(f.kick_angles, 1) || readElement(to.kick_angles, 2) !== readElement(f.kick_angles, 2))
        pflags |= PPS_KICKANGLES;
    if (readElement(to.blend, 0) !== readElement(f.blend, 0) || readElement(to.blend, 1) !== readElement(f.blend, 1) || readElement(to.blend, 2) !== readElement(f.blend, 2) || readElement(to.blend, 3) !== readElement(f.blend, 3))
        pflags |= PPS_BLEND;
    if (to.fov !== f.fov)
        pflags |= PPS_FOV;
    if (to.rdflags !== f.rdflags)
        pflags |= PPS_RDFLAGS;
    if (to.gunindex !== f.gunindex)
        pflags |= PPS_WEAPONINDEX;
    if (to.gunframe !== f.gunframe)
        pflags |= PPS_WEAPONFRAME;
    if (readElement(to.gunoffset, 0) !== readElement(f.gunoffset, 0) || readElement(to.gunoffset, 1) !== readElement(f.gunoffset, 1) || readElement(to.gunoffset, 2) !== readElement(f.gunoffset, 2))
        pflags |= PPS_GUNOFFSET;
    if (readElement(to.gunangles, 0) !== readElement(f.gunangles, 0) || readElement(to.gunangles, 1) !== readElement(f.gunangles, 1) || readElement(to.gunangles, 2) !== readElement(f.gunangles, 2))
        pflags |= PPS_GUNANGLES;
    let statbits = 0;
    for (let i = 0; i < MAX_STATS_OLD; i++) {
        if (readElement(to.stats, i) !== readElement(f.stats, i))
            statbits |= 1 << i;
    }
    if (statbits)
        pflags |= PPS_STATS;
    if (!pflags && !force)
        return;
    MSG_WriteByte(msg, number);
    MSG_WriteShort(msg, pflags & 0xffff);
    if (pflags & PPS_M_TYPE)
        MSG_WriteByte(msg, to.pmove.pm_type);
    if (pflags & PPS_M_ORIGIN) {
        MSG_WriteShort(msg, readElement(to.pmove.origin, 0));
        MSG_WriteShort(msg, readElement(to.pmove.origin, 1));
    }
    if (pflags & PPS_M_ORIGIN2)
        MSG_WriteShort(msg, readElement(to.pmove.origin, 2));
    if (pflags & PPS_VIEWOFFSET) {
        MSG_WriteChar(msg, Math.trunc(readElement(to.viewoffset, 0) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.viewoffset, 1) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.viewoffset, 2) * 4));
    }
    if (pflags & PPS_VIEWANGLES) {
        MSG_WriteShort(msg, toYaw0);
        MSG_WriteShort(msg, toYaw1);
    }
    if (pflags & PPS_VIEWANGLE2)
        MSG_WriteShort(msg, toYaw2);
    if (pflags & PPS_KICKANGLES) {
        MSG_WriteChar(msg, Math.trunc(readElement(to.kick_angles, 0) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.kick_angles, 1) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.kick_angles, 2) * 4));
    }
    if (pflags & PPS_WEAPONINDEX)
        MSG_WriteByte(msg, to.gunindex);
    if (pflags & PPS_WEAPONFRAME)
        MSG_WriteByte(msg, to.gunframe);
    if (pflags & PPS_GUNOFFSET) {
        MSG_WriteChar(msg, Math.trunc(readElement(to.gunoffset, 0) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.gunoffset, 1) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.gunoffset, 2) * 4));
    }
    if (pflags & PPS_GUNANGLES) {
        MSG_WriteChar(msg, Math.trunc(readElement(to.gunangles, 0) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.gunangles, 1) * 4));
        MSG_WriteChar(msg, Math.trunc(readElement(to.gunangles, 2) * 4));
    }
    if (pflags & PPS_BLEND) {
        MSG_WriteByte(msg, Math.trunc(readElement(to.blend, 0) * 255));
        MSG_WriteByte(msg, Math.trunc(readElement(to.blend, 1) * 255));
        MSG_WriteByte(msg, Math.trunc(readElement(to.blend, 2) * 255));
        MSG_WriteByte(msg, Math.trunc(readElement(to.blend, 3) * 255));
    }
    if (pflags & PPS_FOV)
        MSG_WriteByte(msg, to.fov);
    if (pflags & PPS_RDFLAGS)
        MSG_WriteByte(msg, to.rdflags);
    if (pflags & PPS_STATS) {
        MSG_WriteLong(msg, statbits);
        for (let i = 0; i < MAX_STATS_OLD; i++) {
            if (statbits & (1 << i))
                MSG_WriteShort(msg, readElement(to.stats, i));
        }
    }
}
export interface MvdPlayerReadResultT {
    number: number;
    removed: boolean;
    ps: PlayerStateT;
}
export function MSG_ReadDeltaMvdPlayerstate(msg: SizeBuf, from: PlayerStateT | null): MvdPlayerReadResultT {
    const number = MSG_ReadByte(msg);
    return MSG_ReadDeltaMvdPlayerstateBody(msg, from, number);
}
export function MSG_ReadDeltaMvdPlayerstateBody(msg: SizeBuf, from: PlayerStateT | null, number: number): MvdPlayerReadResultT {
    const pflags = MSG_ReadShort(msg) & 0xffff;
    const ps = new PlayerStateT();
    if (from) {
        ps.pmove.pm_type = from.pmove.pm_type;
        ps.pmove.origin.set(from.pmove.origin);
        ps.viewoffset.set(from.viewoffset);
        ps.viewangles.set(from.viewangles);
        ps.kick_angles.set(from.kick_angles);
        ps.gunangles.set(from.gunangles);
        ps.gunoffset.set(from.gunoffset);
        ps.gunindex = from.gunindex;
        ps.gunframe = from.gunframe;
        ps.blend.set(from.blend);
        ps.fov = from.fov;
        ps.rdflags = from.rdflags;
        ps.stats.set(from.stats);
    }
    if (pflags === PPS_MOREBITS) {
        return { number, removed: true, ps };
    }
    if (pflags & PPS_M_TYPE)
        ps.pmove.pm_type = MSG_ReadByte(msg);
    if (pflags & PPS_M_ORIGIN) {
        ps.pmove.origin[0] = MSG_ReadShort(msg);
        ps.pmove.origin[1] = MSG_ReadShort(msg);
    }
    if (pflags & PPS_M_ORIGIN2)
        ps.pmove.origin[2] = MSG_ReadShort(msg);
    if (pflags & PPS_VIEWOFFSET) {
        ps.viewoffset[0] = MSG_ReadChar(msg) * 0.25;
        ps.viewoffset[1] = MSG_ReadChar(msg) * 0.25;
        ps.viewoffset[2] = MSG_ReadChar(msg) * 0.25;
    }
    if (pflags & PPS_VIEWANGLES) {
        ps.viewangles[0] = SHORT2ANGLE(MSG_ReadShort(msg));
        ps.viewangles[1] = SHORT2ANGLE(MSG_ReadShort(msg));
    }
    if (pflags & PPS_VIEWANGLE2)
        ps.viewangles[2] = SHORT2ANGLE(MSG_ReadShort(msg));
    if (pflags & PPS_KICKANGLES) {
        ps.kick_angles[0] = MSG_ReadChar(msg) * 0.25;
        ps.kick_angles[1] = MSG_ReadChar(msg) * 0.25;
        ps.kick_angles[2] = MSG_ReadChar(msg) * 0.25;
    }
    if (pflags & PPS_WEAPONINDEX)
        ps.gunindex = MSG_ReadByte(msg);
    if (pflags & PPS_WEAPONFRAME)
        ps.gunframe = MSG_ReadByte(msg);
    if (pflags & PPS_GUNOFFSET) {
        ps.gunoffset[0] = MSG_ReadChar(msg) * 0.25;
        ps.gunoffset[1] = MSG_ReadChar(msg) * 0.25;
        ps.gunoffset[2] = MSG_ReadChar(msg) * 0.25;
    }
    if (pflags & PPS_GUNANGLES) {
        ps.gunangles[0] = MSG_ReadChar(msg) * 0.25;
        ps.gunangles[1] = MSG_ReadChar(msg) * 0.25;
        ps.gunangles[2] = MSG_ReadChar(msg) * 0.25;
    }
    if (pflags & PPS_BLEND) {
        ps.blend[0] = MSG_ReadByte(msg) / 255;
        ps.blend[1] = MSG_ReadByte(msg) / 255;
        ps.blend[2] = MSG_ReadByte(msg) / 255;
        ps.blend[3] = MSG_ReadByte(msg) / 255;
    }
    if (pflags & PPS_FOV)
        ps.fov = MSG_ReadByte(msg);
    if (pflags & PPS_RDFLAGS)
        ps.rdflags = MSG_ReadByte(msg);
    if (pflags & PPS_STATS) {
        const statbits = MSG_ReadLong(msg) >>> 0;
        for (let i = 0; i < MAX_STATS_OLD; i++) {
            if (statbits & (1 << i))
                ps.stats[i] = MSG_ReadShort(msg);
        }
    }
    return { number, removed: false, ps };
}
export const MAX_STATS_NEW = 64;
export const GUNINDEX_BITS = 13;
export const RERELEASE_VIEWOFFSET_SCALE = 16;
export const RERELEASE_KICKANGLES_SCALE = 1024;
export const RERELEASE_GUNOFFSET_SCALE = 512;
export const RERELEASE_GUNANGLES_SCALE = 4096;
function scaledShort(x: number, scale: number): number {
    return Math.max(-32768, Math.min(32767, Math.trunc(x * scale)));
}
function blendByte(x: number): number {
    return Math.max(0, Math.min(255, Math.trunc(x * 255)));
}
function packedGunIndex(ps: PlayerStateT): number {
    return (ps.gunindex & 0x1fff) | ((ps.gunskin & 0x7) << GUNINDEX_BITS);
}
function writeDeltaBlend(msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
    let bflags = 0;
    for (let i = 0; i < 4; i++) {
        if (blendByte(readElement(to.blend, i)) !== blendByte(readElement(from.blend, i)))
            bflags |= 1 << i;
        if (blendByte(readElement(to.damage_blend, i)) !== blendByte(readElement(from.damage_blend, i)))
            bflags |= 1 << (4 + i);
    }
    MSG_WriteByte(msg, bflags);
    for (let i = 0; i < 4; i++) {
        if (bflags & (1 << i))
            MSG_WriteByte(msg, blendByte(readElement(to.blend, i)));
    }
    for (let i = 0; i < 4; i++) {
        if (bflags & (1 << (4 + i)))
            MSG_WriteByte(msg, blendByte(readElement(to.damage_blend, i)));
    }
}
function readDeltaBlend(msg: SizeBuf, ps: PlayerStateT): void {
    const bflags = MSG_ReadByte(msg);
    for (let i = 0; i < 4; i++) {
        if (bflags & (1 << i))
            ps.blend[i] = MSG_ReadByte(msg) / 255;
    }
    for (let i = 0; i < 4; i++) {
        if (bflags & (1 << (4 + i)))
            ps.damage_blend[i] = MSG_ReadByte(msg) / 255;
    }
}
function blendChanged(from: PlayerStateT, to: PlayerStateT): boolean {
    for (let i = 0; i < 4; i++) {
        if (blendByte(readElement(to.blend, i)) !== blendByte(readElement(from.blend, i)))
            return true;
        if (blendByte(readElement(to.damage_blend, i)) !== blendByte(readElement(from.damage_blend, i)))
            return true;
    }
    return false;
}
export function MSG_WriteDeltaMvdPlayerstateRerelease(msg: SizeBuf, from: PlayerStateT | null, to: PlayerStateT | null, number: number, force: boolean): void {
    if (!MSG_ValidMvdClientNumber(number)) {
        throw new Error(`MSG_WriteDeltaMvdPlayerstateRerelease: bad number: ${number}`);
    }
    if (!to) {
        MSG_WriteByte(msg, number);
        MSG_WriteShort(msg, PPS_MOREBITS);
        return;
    }
    const f = from ?? new PlayerStateT();
    let pflags = 0;
    if (to.pmove.pm_type !== f.pmove.pm_type)
        pflags |= PPS_M_TYPE;
    if (readElement(to.pmove.origin, 0) !== readElement(f.pmove.origin, 0) || readElement(to.pmove.origin, 1) !== readElement(f.pmove.origin, 1))
        pflags |= PPS_M_ORIGIN;
    if (readElement(to.pmove.origin, 2) !== readElement(f.pmove.origin, 2))
        pflags |= PPS_M_ORIGIN2;
    const toViewoffset: [
        number,
        number,
        number
    ] = [scaledShort(readElement(to.viewoffset, 0), RERELEASE_VIEWOFFSET_SCALE), scaledShort(readElement(to.viewoffset, 1), RERELEASE_VIEWOFFSET_SCALE), scaledShort(readElement(to.viewoffset, 2), RERELEASE_VIEWOFFSET_SCALE)];
    const fromViewoffset: [
        number,
        number,
        number
    ] = [scaledShort(readElement(f.viewoffset, 0), RERELEASE_VIEWOFFSET_SCALE), scaledShort(readElement(f.viewoffset, 1), RERELEASE_VIEWOFFSET_SCALE), scaledShort(readElement(f.viewoffset, 2), RERELEASE_VIEWOFFSET_SCALE)];
    if (readElement(toViewoffset, 0) !== readElement(fromViewoffset, 0) || readElement(toViewoffset, 1) !== readElement(fromViewoffset, 1) || readElement(toViewoffset, 2) !== readElement(fromViewoffset, 2))
        pflags |= PPS_VIEWOFFSET;
    const toYaw0 = ANGLE2SHORT(readElement(to.viewangles, 0));
    const toYaw1 = ANGLE2SHORT(readElement(to.viewangles, 1));
    const toYaw2 = ANGLE2SHORT(readElement(to.viewangles, 2));
    const fromYaw0 = ANGLE2SHORT(readElement(f.viewangles, 0));
    const fromYaw1 = ANGLE2SHORT(readElement(f.viewangles, 1));
    const fromYaw2 = ANGLE2SHORT(readElement(f.viewangles, 2));
    if (toYaw0 !== fromYaw0 || toYaw1 !== fromYaw1)
        pflags |= PPS_VIEWANGLES;
    if (toYaw2 !== fromYaw2)
        pflags |= PPS_VIEWANGLE2;
    const toKick: [
        number,
        number,
        number
    ] = [scaledShort(readElement(to.kick_angles, 0), RERELEASE_KICKANGLES_SCALE), scaledShort(readElement(to.kick_angles, 1), RERELEASE_KICKANGLES_SCALE), scaledShort(readElement(to.kick_angles, 2), RERELEASE_KICKANGLES_SCALE)];
    const fromKick: [
        number,
        number,
        number
    ] = [scaledShort(readElement(f.kick_angles, 0), RERELEASE_KICKANGLES_SCALE), scaledShort(readElement(f.kick_angles, 1), RERELEASE_KICKANGLES_SCALE), scaledShort(readElement(f.kick_angles, 2), RERELEASE_KICKANGLES_SCALE)];
    if (readElement(toKick, 0) !== readElement(fromKick, 0) || readElement(toKick, 1) !== readElement(fromKick, 1) || readElement(toKick, 2) !== readElement(fromKick, 2))
        pflags |= PPS_KICKANGLES;
    if (blendChanged(f, to))
        pflags |= PPS_BLEND;
    if (to.fov !== f.fov)
        pflags |= PPS_FOV;
    if (to.rdflags !== f.rdflags)
        pflags |= PPS_RDFLAGS;
    const toGunIndex = packedGunIndex(to);
    const fromGunIndex = packedGunIndex(f);
    if (toGunIndex !== fromGunIndex)
        pflags |= PPS_WEAPONINDEX;
    if (to.gunframe !== f.gunframe)
        pflags |= PPS_WEAPONFRAME;
    const toGunoffset: [
        number,
        number,
        number
    ] = [scaledShort(readElement(to.gunoffset, 0), RERELEASE_GUNOFFSET_SCALE), scaledShort(readElement(to.gunoffset, 1), RERELEASE_GUNOFFSET_SCALE), scaledShort(readElement(to.gunoffset, 2), RERELEASE_GUNOFFSET_SCALE)];
    const fromGunoffset: [
        number,
        number,
        number
    ] = [scaledShort(readElement(f.gunoffset, 0), RERELEASE_GUNOFFSET_SCALE), scaledShort(readElement(f.gunoffset, 1), RERELEASE_GUNOFFSET_SCALE), scaledShort(readElement(f.gunoffset, 2), RERELEASE_GUNOFFSET_SCALE)];
    if (readElement(toGunoffset, 0) !== readElement(fromGunoffset, 0) || readElement(toGunoffset, 1) !== readElement(fromGunoffset, 1) || readElement(toGunoffset, 2) !== readElement(fromGunoffset, 2))
        pflags |= PPS_GUNOFFSET;
    const toGunangles: [
        number,
        number,
        number
    ] = [scaledShort(readElement(to.gunangles, 0), RERELEASE_GUNANGLES_SCALE), scaledShort(readElement(to.gunangles, 1), RERELEASE_GUNANGLES_SCALE), scaledShort(readElement(to.gunangles, 2), RERELEASE_GUNANGLES_SCALE)];
    const fromGunangles: [
        number,
        number,
        number
    ] = [scaledShort(readElement(f.gunangles, 0), RERELEASE_GUNANGLES_SCALE), scaledShort(readElement(f.gunangles, 1), RERELEASE_GUNANGLES_SCALE), scaledShort(readElement(f.gunangles, 2), RERELEASE_GUNANGLES_SCALE)];
    if (readElement(toGunangles, 0) !== readElement(fromGunangles, 0) || readElement(toGunangles, 1) !== readElement(fromGunangles, 1) || readElement(toGunangles, 2) !== readElement(fromGunangles, 2))
        pflags |= PPS_GUNANGLES;
    let statbits = 0n;
    for (let i = 0; i < MAX_STATS_NEW; i++) {
        const toStat = to.stats[i] ?? 0;
        const fromStat = f.stats[i] ?? 0;
        if (toStat !== fromStat)
            statbits |= 1n << BigInt(i);
    }
    if (statbits !== 0n)
        pflags |= PPS_STATS;
    if (!pflags && !force)
        return;
    MSG_WriteByte(msg, number);
    MSG_WriteShort(msg, pflags & 0xffff);
    if (pflags & PPS_M_TYPE)
        MSG_WriteByte(msg, to.pmove.pm_type);
    if (pflags & PPS_M_ORIGIN) {
        MSG_WriteShort(msg, readElement(to.pmove.origin, 0));
        MSG_WriteShort(msg, readElement(to.pmove.origin, 1));
    }
    if (pflags & PPS_M_ORIGIN2)
        MSG_WriteShort(msg, readElement(to.pmove.origin, 2));
    if (pflags & PPS_VIEWOFFSET) {
        MSG_WriteShort(msg, readElement(toViewoffset, 0));
        MSG_WriteShort(msg, readElement(toViewoffset, 1));
        MSG_WriteShort(msg, readElement(toViewoffset, 2));
    }
    if (pflags & PPS_VIEWANGLES) {
        MSG_WriteShort(msg, toYaw0);
        MSG_WriteShort(msg, toYaw1);
    }
    if (pflags & PPS_VIEWANGLE2)
        MSG_WriteShort(msg, toYaw2);
    if (pflags & PPS_KICKANGLES) {
        MSG_WriteShort(msg, readElement(toKick, 0));
        MSG_WriteShort(msg, readElement(toKick, 1));
        MSG_WriteShort(msg, readElement(toKick, 2));
    }
    if (pflags & PPS_WEAPONINDEX)
        MSG_WriteShort(msg, toGunIndex);
    if (pflags & PPS_WEAPONFRAME)
        MSG_WriteShort(msg, to.gunframe);
    if (pflags & PPS_GUNOFFSET) {
        MSG_WriteShort(msg, readElement(toGunoffset, 0));
        MSG_WriteShort(msg, readElement(toGunoffset, 1));
        MSG_WriteShort(msg, readElement(toGunoffset, 2));
    }
    if (pflags & PPS_GUNANGLES) {
        MSG_WriteShort(msg, readElement(toGunangles, 0));
        MSG_WriteShort(msg, readElement(toGunangles, 1));
        MSG_WriteShort(msg, readElement(toGunangles, 2));
    }
    if (pflags & PPS_BLEND)
        writeDeltaBlend(msg, f, to);
    if (pflags & PPS_FOV)
        MSG_WriteByte(msg, to.fov);
    if (pflags & PPS_RDFLAGS)
        MSG_WriteByte(msg, to.rdflags);
    if (pflags & PPS_STATS) {
        MSG_WriteLong64(msg, statbits);
        for (let i = 0; i < MAX_STATS_NEW; i++) {
            if (statbits & (1n << BigInt(i)))
                MSG_WriteShort(msg, to.stats[i] ?? 0);
        }
    }
}
export function MSG_ReadDeltaMvdPlayerstateRerelease(msg: SizeBuf, from: PlayerStateT | null): MvdPlayerReadResultT {
    const number = MSG_ReadByte(msg);
    return MSG_ReadDeltaMvdPlayerstateRereleaseBody(msg, from, number);
}
export function MSG_ReadDeltaMvdPlayerstateRereleaseBody(msg: SizeBuf, from: PlayerStateT | null, number: number): MvdPlayerReadResultT {
    const pflags = MSG_ReadShort(msg) & 0xffff;
    const ps = new PlayerStateT();
    if (from) {
        ps.pmove.pm_type = from.pmove.pm_type;
        ps.pmove.origin.set(from.pmove.origin);
        ps.viewoffset.set(from.viewoffset);
        ps.viewangles.set(from.viewangles);
        ps.kick_angles.set(from.kick_angles);
        ps.gunangles.set(from.gunangles);
        ps.gunoffset.set(from.gunoffset);
        ps.gunindex = from.gunindex;
        ps.gunskin = from.gunskin;
        ps.gunframe = from.gunframe;
        ps.blend.set(from.blend);
        ps.damage_blend.set(from.damage_blend);
        ps.fov = from.fov;
        ps.rdflags = from.rdflags;
        ps.stats.set(from.stats);
    }
    if (pflags === PPS_MOREBITS) {
        return { number, removed: true, ps };
    }
    if (pflags & PPS_M_TYPE)
        ps.pmove.pm_type = MSG_ReadByte(msg);
    if (pflags & PPS_M_ORIGIN) {
        ps.pmove.origin[0] = MSG_ReadShort(msg);
        ps.pmove.origin[1] = MSG_ReadShort(msg);
    }
    if (pflags & PPS_M_ORIGIN2)
        ps.pmove.origin[2] = MSG_ReadShort(msg);
    if (pflags & PPS_VIEWOFFSET) {
        ps.viewoffset[0] = MSG_ReadShort(msg) / RERELEASE_VIEWOFFSET_SCALE;
        ps.viewoffset[1] = MSG_ReadShort(msg) / RERELEASE_VIEWOFFSET_SCALE;
        ps.viewoffset[2] = MSG_ReadShort(msg) / RERELEASE_VIEWOFFSET_SCALE;
    }
    if (pflags & PPS_VIEWANGLES) {
        ps.viewangles[0] = SHORT2ANGLE(MSG_ReadShort(msg));
        ps.viewangles[1] = SHORT2ANGLE(MSG_ReadShort(msg));
    }
    if (pflags & PPS_VIEWANGLE2)
        ps.viewangles[2] = SHORT2ANGLE(MSG_ReadShort(msg));
    if (pflags & PPS_KICKANGLES) {
        ps.kick_angles[0] = MSG_ReadShort(msg) / RERELEASE_KICKANGLES_SCALE;
        ps.kick_angles[1] = MSG_ReadShort(msg) / RERELEASE_KICKANGLES_SCALE;
        ps.kick_angles[2] = MSG_ReadShort(msg) / RERELEASE_KICKANGLES_SCALE;
    }
    if (pflags & PPS_WEAPONINDEX) {
        const packed = MSG_ReadShort(msg) & 0xffff;
        ps.gunindex = packed & 0x1fff;
        ps.gunskin = (packed >>> GUNINDEX_BITS) & 0x7;
    }
    if (pflags & PPS_WEAPONFRAME)
        ps.gunframe = MSG_ReadWord(msg);
    if (pflags & PPS_GUNOFFSET) {
        ps.gunoffset[0] = MSG_ReadShort(msg) / RERELEASE_GUNOFFSET_SCALE;
        ps.gunoffset[1] = MSG_ReadShort(msg) / RERELEASE_GUNOFFSET_SCALE;
        ps.gunoffset[2] = MSG_ReadShort(msg) / RERELEASE_GUNOFFSET_SCALE;
    }
    if (pflags & PPS_GUNANGLES) {
        ps.gunangles[0] = MSG_ReadShort(msg) / RERELEASE_GUNANGLES_SCALE;
        ps.gunangles[1] = MSG_ReadShort(msg) / RERELEASE_GUNANGLES_SCALE;
        ps.gunangles[2] = MSG_ReadShort(msg) / RERELEASE_GUNANGLES_SCALE;
    }
    if (pflags & PPS_BLEND)
        readDeltaBlend(msg, ps);
    if (pflags & PPS_FOV)
        ps.fov = MSG_ReadByte(msg);
    if (pflags & PPS_RDFLAGS)
        ps.rdflags = MSG_ReadByte(msg);
    if (pflags & PPS_STATS) {
        const statbits = MSG_ReadLong64(msg);
        for (let i = 0; i < MAX_STATS_NEW; i++) {
            if (statbits & (1n << BigInt(i))) {
                const value = MSG_ReadShort(msg);
                if (i < ps.stats.length)
                    ps.stats[i] = value;
            }
        }
    }
    return { number, removed: false, ps };
}

/** Native packet-player flags; extended coordinates and fog share Q2PRO primitives. */
export function readMvdPlayer(message: SizeBuf, from: PlayerStateT | null, number: number, profile: import('../mvd-profile.ts').MvdProfile): MvdPlayerReadResultT {
    if (!profile.extended) return MSG_ReadDeltaMvdPlayerstateBody(message, from, number);
    let flags = MSG_ReadWord(message);
    if (flags & PPS_MOREBITS) {
        if (profile.fog) flags |= MSG_ReadByte(message) << 16;
        else return { number, removed: true, ps: from ?? new PlayerStateT() };
    }
    const ps = new PlayerStateT();
    if (from !== null) {
        ps.pmove.pm_type = from.pmove.pm_type; ps.pmove.origin.set(from.pmove.origin); ps.pmove.originF.set(from.pmove.originF);
        ps.viewoffset.set(from.viewoffset); ps.viewangles.set(from.viewangles); ps.kick_angles.set(from.kick_angles); ps.gunoffset.set(from.gunoffset); ps.gunangles.set(from.gunangles);
        ps.gunindex = from.gunindex; ps.gunskin = from.gunskin; ps.gunframe = from.gunframe; ps.blend.set(from.blend); ps.damage_blend.set(from.damage_blend); ps.stats.set(from.stats); ps.fov = from.fov; ps.rdflags = from.rdflags; ps.q2proFog = { ...from.q2proFog };
    }
    if (flags & PPS_M_TYPE) ps.pmove.pm_type = MSG_ReadByte(message);
    for (let axis = 0; axis < 3; axis++) if (flags & (axis === 2 ? PPS_M_ORIGIN2 : PPS_M_ORIGIN)) {
        if (profile.rerelease) ps.pmove.originF[axis] = MSG_ReadFloat(message);
        else ps.pmove.origin[axis] = profile.v2 ? readQ2ProInt23(message, ps.pmove.origin[axis] ?? 0) : MSG_ReadShort(message);
    }
    const vector = (target: Float32Array, scale: number, short: boolean): void => { for (let axis = 0; axis < 3; axis++) target[axis] = (short ? MSG_ReadShort(message) : MSG_ReadChar(message)) / scale; };
    if (flags & PPS_VIEWOFFSET) vector(ps.viewoffset, profile.rerelease ? 16 : 4, profile.rerelease);
    if (flags & PPS_VIEWANGLES) { ps.viewangles[0] = SHORT2ANGLE(MSG_ReadShort(message)); ps.viewangles[1] = SHORT2ANGLE(MSG_ReadShort(message)); }
    if (flags & PPS_VIEWANGLE2) ps.viewangles[2] = SHORT2ANGLE(MSG_ReadShort(message));
    if (flags & PPS_KICKANGLES) vector(ps.kick_angles, profile.rerelease ? 1024 : 4, profile.rerelease);
    if (flags & PPS_WEAPONINDEX) { const packed = MSG_ReadWord(message); ps.gunindex = packed & 8191; ps.gunskin = packed >>> 13; }
    if (flags & PPS_WEAPONFRAME) ps.gunframe = profile.rerelease ? MSG_ReadWord(message) : MSG_ReadByte(message);
    if (flags & PPS_GUNOFFSET) vector(ps.gunoffset, profile.rerelease ? 512 : 8, true);
    if (flags & PPS_GUNANGLES) vector(ps.gunangles, profile.rerelease ? 4096 : 65536 / 360, true);
    if (flags & PPS_BLEND) {
        if (profile.rerelease || profile.v2) readDeltaBlend(message, ps);
        else for (let axis = 0; axis < 4; axis++) ps.blend[axis] = MSG_ReadByte(message) / 255;
    }
    if (flags & (1 << 17)) ps.q2proFog = readQ2ProFog(message, ps.q2proFog);
    if (flags & PPS_FOV) ps.fov = MSG_ReadByte(message);
    if (flags & PPS_RDFLAGS) ps.rdflags = MSG_ReadByte(message);
    if (flags & PPS_STATS) {
        const bits = profile.rerelease ? MSG_ReadLong64(message) : profile.v2 ? readQ2ProVar64(message) : BigInt(MSG_ReadLong(message) >>> 0);
        for (let index = 0; index < (profile.rerelease || profile.v2 ? 64 : 32); index++) if (bits & (1n << BigInt(index))) ps.stats[index] = MSG_ReadShort(message);
    }
    return { number, removed: (flags & (1 << 16)) !== 0, ps };
}
