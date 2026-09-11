// q2proto_proto_kex.c server writers, with source instance/owner/old-frame fields retained.
// Copyright id Software and q2proto contributors. GPL-2.0-or-later.
import { U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_FRAME8, U_FRAME16, U_SKIN8, U_SKIN16, U_EFFECTS8, U_EFFECTS16, U_RENDERFX8, U_RENDERFX16, U_MODEL, U_MODEL2, U_MODEL3, U_MODEL4, U_OLDORIGIN, U_SOUND, U_SOLID, U_EVENT, PS_M_TYPE, PS_M_ORIGIN, PS_M_VELOCITY, PS_M_TIME, PS_M_FLAGS, PS_M_GRAVITY, PS_M_DELTA_ANGLES, PS_VIEWOFFSET, PS_VIEWANGLES, PS_KICKANGLES, PS_BLEND, PS_FOV, PS_WEAPONINDEX, PS_WEAPONFRAME, PS_RDFLAGS } from '../constants.ts';
import { MSG_WriteByte, MSG_WriteChar, MSG_WriteShort, MSG_WriteLong, MSG_WriteFloat, MSG_WriteString, MSG_WriteCoord, SZ_Write } from '../message.ts';
import type { SizeBuf } from '../message.ts';
import { EntityStateT, PlayerStateT, SHORT2ANGLE, RF_BEAM, readElement } from '../state.ts';
import type { ProtocolCodec } from './codec.ts';
import type { createRereleaseContext } from './q2repro.ts';
type Writers = Pick<ProtocolCodec, 'writeServerData' | 'writeDeltaEntity' | 'writeEntityRemove' | 'writePacketEntitiesEnd' | 'writeSpawnBaseline' | 'writePlayerStateDelta' | 'writePacketEntitiesBegin' | 'writeFrame'>;
const U_MODEL16 = 1 << 28, U_EFFECTS64 = 1 << 29, U_ALPHA = 1 << 30;
const PS_MOREBITS = 1 << 15, PS_DAMAGE_BLEND = 1 << 16, PS_TEAM = 1 << 17;
function width(value: number, byte: number, short: number): number { const unsigned = value >>> 0; return (unsigned & 0xffff8000) !== 0 ? byte | short : unsigned > 255 ? short : byte; }
function changed(a: ArrayLike<number>, b: ArrayLike<number>, convert: (value: number) => number = (value) => value): boolean {
    for (let i = 0; i < a.length; i++)
        if (convert(readElement(a, i)) !== convert(readElement(b, i)))
            return true;
    return false;
}
function byteColor(value: number): number { return Math.max(0, Math.min(255, Math.trunc(value * 255))); }
function fixed(value: number, scale: number): number { return Math.max(-32768, Math.min(32767, Math.trunc(value * scale))); }
export function createKexWriter(protocol: () => number, helpers: ReturnType<typeof createRereleaseContext>): Writers {
    const { writeEntityBitsWide, encodeAlpha, encodeScale, encodeLoopVolume, encodeLoopAttenuation } = helpers;
    function writeWidth(m: SizeBuf, value: number, bits: number, byte: number, short: number): void {
        if ((bits & (byte | short)) === (byte | short))
            MSG_WriteLong(m, value);
        else if (bits & short)
            MSG_WriteShort(m, value);
        else if (bits & byte)
            MSG_WriteByte(m, value);
    }
    function writeDeltaEntity(m: SizeBuf, from: EntityStateT, to: EntityStateT, force: boolean, newEntity: boolean): void {
        let bits = 0, high = 0;
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
        if (to.frame !== from.frame)
            bits |= to.frame >= 256 ? U_FRAME16 : U_FRAME8;
        if (to.skinnum !== from.skinnum)
            bits |= width(to.skinnum, U_SKIN8, U_SKIN16);
        if (to.effects !== from.effects || to.morefx !== from.morefx) {
            if (to.morefx !== 0)
                bits |= U_EFFECTS64 | width(to.morefx, U_EFFECTS8, U_EFFECTS16);
            else
                bits |= width(to.effects, U_EFFECTS8, U_EFFECTS16);
        }
        if (to.renderfx !== from.renderfx)
            bits |= width(to.renderfx, U_RENDERFX8, U_RENDERFX16);
        if (to.solid !== from.solid)
            bits |= U_SOLID;
        if (to.event !== 0)
            bits |= U_EVENT;
        const models: readonly [
            number,
            number,
            number
        ][] = [[U_MODEL, to.modelindex, from.modelindex], [U_MODEL2, to.modelindex2, from.modelindex2], [U_MODEL3, to.modelindex3, from.modelindex3], [U_MODEL4, to.modelindex4, from.modelindex4]];
        for (const [flag, value, old] of models)
            if (value !== old) {
                bits |= flag;
                if (value > 255)
                    bits |= U_MODEL16;
            }
        const volume = encodeLoopVolume(to.loop_volume), attenuation = encodeLoopAttenuation(to.loop_attenuation);
        const changedVolume = volume !== encodeLoopVolume(from.loop_volume), changedAttenuation = attenuation !== encodeLoopAttenuation(from.loop_attenuation);
        if (to.sound !== from.sound || changedVolume || changedAttenuation)
            bits |= U_SOUND;
        if (newEntity || (to.renderfx & RF_BEAM) !== 0)
            bits |= U_OLDORIGIN;
        if (encodeAlpha(to.alpha) !== encodeAlpha(from.alpha))
            bits |= U_ALPHA;
        if (encodeScale(to.scale) !== encodeScale(from.scale))
            high |= 1;
        if (to.instance_bits !== from.instance_bits)
            high |= 2;
        if (to.owner !== from.owner)
            high |= 4;
        if (to.old_frame !== from.old_frame)
            high |= 8;
        if (bits === 0 && high === 0 && !force)
            return;
        // The native KEX reader sign-extends bit 31 into the high word. q2proto emits every high flag.
        if (high !== 0)
            high = 255;
        writeEntityBitsWide(m, bits, high, to.number);
        for (const [flag, value] of models)
            if (bits & flag) {
                if (bits & U_MODEL16)
                    MSG_WriteShort(m, value);
                else
                    MSG_WriteByte(m, value);
            }
        if (bits & U_FRAME16)
            MSG_WriteShort(m, to.frame);
        else if (bits & U_FRAME8)
            MSG_WriteByte(m, to.frame);
        writeWidth(m, to.skinnum, bits, U_SKIN8, U_SKIN16);
        if (bits & U_EFFECTS64)
            MSG_WriteLong(m, to.effects);
        writeWidth(m, (bits & U_EFFECTS64) !== 0 ? to.morefx : to.effects, bits, U_EFFECTS8, U_EFFECTS16);
        writeWidth(m, to.renderfx, bits, U_RENDERFX8, U_RENDERFX16);
        if (bits & U_SOLID)
            MSG_WriteLong(m, to.solid);
        const coord = protocol() !== 2022 || to.solid !== 0 ? MSG_WriteFloat : MSG_WriteCoord;
        if (bits & U_ORIGIN1)
            coord(m, readElement(to.origin, 0));
        if (bits & U_ORIGIN2)
            coord(m, readElement(to.origin, 1));
        if (bits & U_ORIGIN3)
            coord(m, readElement(to.origin, 2));
        if (bits & U_OLDORIGIN)
            for (let i = 0; i < 3; i++)
                coord(m, readElement(to.old_origin, i));
        if (bits & U_ANGLE1)
            MSG_WriteFloat(m, readElement(to.angles, 0));
        if (bits & U_ANGLE2)
            MSG_WriteFloat(m, readElement(to.angles, 1));
        if (bits & U_ANGLE3)
            MSG_WriteFloat(m, readElement(to.angles, 2));
        if (bits & U_SOUND) {
            MSG_WriteShort(m, to.sound | (changedVolume ? 1 << 14 : 0) | (changedAttenuation ? 1 << 15 : 0));
            if (changedVolume)
                MSG_WriteByte(m, volume);
            if (changedAttenuation)
                MSG_WriteByte(m, attenuation);
        }
        if (bits & U_EVENT)
            MSG_WriteByte(m, to.event);
        if (bits & U_ALPHA)
            MSG_WriteByte(m, encodeAlpha(to.alpha));
        if (high & 1)
            MSG_WriteByte(m, encodeScale(to.scale));
        if (high & 2)
            MSG_WriteByte(m, to.instance_bits);
        if (high & 4)
            MSG_WriteShort(m, to.owner);
        if (high & 8)
            MSG_WriteShort(m, to.old_frame);
    }
    const deltaAngle = (state: PlayerStateT, index: number): number => state.pmove.deltaAngleEncoding === 'float' ? readElement(state.pmove.delta_anglesF, index) : SHORT2ANGLE(readElement(state.pmove.delta_angles, index));
    function writePlayerStateDelta(m: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        let flags = 0, gunbits = 0;
        if (to.pmove.pm_type !== from.pmove.pm_type)
            flags |= PS_M_TYPE;
        if (changed(to.pmove.originF, from.pmove.originF))
            flags |= PS_M_ORIGIN;
        if (changed(to.pmove.velocityF, from.pmove.velocityF))
            flags |= PS_M_VELOCITY;
        if (to.pmove.pm_time !== from.pmove.pm_time)
            flags |= PS_M_TIME;
        if (to.pmove.pm_flags !== from.pmove.pm_flags)
            flags |= PS_M_FLAGS;
        if (to.pmove.gravity !== from.pmove.gravity)
            flags |= PS_M_GRAVITY;
        for (let i = 0; i < 3; i++)
            if (deltaAngle(to, i) !== deltaAngle(from, i))
                flags |= PS_M_DELTA_ANGLES;
        if (changed(to.viewoffset, from.viewoffset, value => fixed(value, 16)) || to.pmove.viewheight !== from.pmove.viewheight)
            flags |= PS_VIEWOFFSET;
        if (changed(to.viewangles, from.viewangles))
            flags |= PS_VIEWANGLES;
        if (changed(to.kick_angles, from.kick_angles, value => fixed(value, 1024)))
            flags |= PS_KICKANGLES;
        if (changed(to.blend, from.blend, byteColor))
            flags |= PS_BLEND;
        if (changed(to.damage_blend, from.damage_blend, byteColor))
            flags |= PS_DAMAGE_BLEND;
        if (to.team_id !== from.team_id)
            flags |= PS_TEAM;
        if (to.fov !== from.fov)
            flags |= PS_FOV;
        if (to.rdflags !== from.rdflags)
            flags |= PS_RDFLAGS;
        if (to.gunindex !== from.gunindex || to.gunskin !== from.gunskin)
            flags |= PS_WEAPONINDEX;
        for (let i = 0; i < 3; i++) {
            if (readElement(to.gunoffset, i) !== readElement(from.gunoffset, i))
                gunbits |= 1 << i;
            if (readElement(to.gunangles, i) !== readElement(from.gunangles, i))
                gunbits |= 1 << (i + 3);
        }
        if (to.gunrate !== from.gunrate)
            gunbits |= 64;
        if (to.gunframe !== from.gunframe || gunbits !== 0)
            flags |= PS_WEAPONFRAME;
        if (flags > 65535)
            flags |= PS_MOREBITS;
        MSG_WriteShort(m, flags);
        if (flags & PS_MOREBITS)
            MSG_WriteShort(m, flags >>> 16);
        if (flags & PS_M_TYPE)
            MSG_WriteByte(m, to.pmove.pm_type);
        if (flags & PS_M_ORIGIN)
            for (let i = 0; i < 3; i++)
                MSG_WriteFloat(m, readElement(to.pmove.originF, i));
        if (flags & PS_M_VELOCITY)
            for (let i = 0; i < 3; i++)
                MSG_WriteFloat(m, readElement(to.pmove.velocityF, i));
        if (flags & PS_M_TIME)
            MSG_WriteShort(m, to.pmove.pm_time);
        if (flags & PS_M_FLAGS)
            MSG_WriteShort(m, to.pmove.pm_flags);
        if (flags & PS_M_GRAVITY)
            MSG_WriteShort(m, to.pmove.gravity);
        if (flags & PS_M_DELTA_ANGLES)
            for (let i = 0; i < 3; i++)
                MSG_WriteFloat(m, deltaAngle(to, i));
        if (flags & PS_VIEWOFFSET) {
            for (let i = 0; i < 3; i++)
                MSG_WriteShort(m, fixed(readElement(to.viewoffset, i), 16));
            MSG_WriteChar(m, to.pmove.viewheight);
        }
        if (flags & PS_VIEWANGLES)
            for (let i = 0; i < 3; i++)
                MSG_WriteFloat(m, readElement(to.viewangles, i));
        if (flags & PS_KICKANGLES)
            for (let i = 0; i < 3; i++)
                MSG_WriteShort(m, fixed(readElement(to.kick_angles, i), 1024));
        if (flags & PS_WEAPONINDEX)
            MSG_WriteShort(m, to.gunindex | (to.gunskin << 13));
        if (flags & PS_WEAPONFRAME) {
            if (to.gunframe > 511 || to.gunframe < 0)
                throw new RangeError('KEX gun frame exceeds nine bits');
            MSG_WriteShort(m, to.gunframe | (gunbits << 9));
            for (let i = 0; i < 3; i++)
                if (gunbits & (1 << i))
                    MSG_WriteFloat(m, readElement(to.gunoffset, i));
            for (let i = 0; i < 3; i++)
                if (gunbits & (1 << (i + 3)))
                    MSG_WriteFloat(m, readElement(to.gunangles, i));
            if (gunbits & 64)
                MSG_WriteByte(m, to.gunrate);
        }
        if (flags & PS_BLEND)
            for (const value of to.blend)
                MSG_WriteByte(m, byteColor(value));
        if (flags & PS_FOV)
            MSG_WriteByte(m, to.fov);
        if (flags & PS_RDFLAGS)
            MSG_WriteByte(m, to.rdflags);
        for (let half = 0; half < 2; half++) {
            let mask = 0;
            for (let i = 0; i < 32; i++)
                if (readElement(to.stats, i + half * 32) !== readElement(from.stats, i + half * 32))
                    mask |= 1 << i;
            MSG_WriteLong(m, mask);
            for (let i = 0; i < 32; i++)
                if (mask & (1 << i))
                    MSG_WriteShort(m, readElement(to.stats, i + half * 32));
        }
        if (flags & PS_DAMAGE_BLEND)
            for (const value of to.damage_blend)
                MSG_WriteByte(m, byteColor(value));
        if (flags & PS_TEAM)
            MSG_WriteByte(m, to.team_id);
    }
    return {
        writeServerData(m, params) { MSG_WriteByte(m, 12); MSG_WriteLong(m, protocol()); MSG_WriteLong(m, params.servercount); MSG_WriteByte(m, params.attractloop ? 1 : 0); MSG_WriteByte(m, params.serverFps ?? 40); MSG_WriteString(m, params.gamedir); MSG_WriteShort(m, params.clientnum); MSG_WriteString(m, params.levelname); },
        writeDeltaEntity,
        writeEntityRemove(m, number) { writeEntityBitsWide(m, 1 << 6, 0, number); },
        writePacketEntitiesEnd(m) { MSG_WriteShort(m, 0); },
        writeSpawnBaseline(m, entity) { MSG_WriteByte(m, 14); writeDeltaEntity(m, new EntityStateT(), entity, true, true); },
        writePlayerStateDelta,
        writePacketEntitiesBegin(m) { MSG_WriteByte(m, 18); },
        writeFrame(m, params, entities) { MSG_WriteByte(m, 20); MSG_WriteLong(m, params.framenum); MSG_WriteLong(m, params.lastframe); MSG_WriteByte(m, params.surpressCount); MSG_WriteByte(m, params.areabytes); SZ_Write(m, params.areabits, params.areabytes); MSG_WriteByte(m, 17); writePlayerStateDelta(m, params.psFrom ?? new PlayerStateT(), params.psTo); entities(m); },
    };
}
