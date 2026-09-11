// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
import { AXES } from "../wire-types.ts";
import type { MessageReader } from "../message.ts";
import { MSG_WriteAngle, MSG_WriteByte, MSG_WriteChar, MSG_WriteCoord, MSG_WriteLong, MSG_WriteShort, type SizeBuf, } from "../message.ts";
import type { Vec3 } from "../wire-types.ts";
import { EntityStateT } from "../wire-types.ts";
import { ENTALPHA_DEFAULT, ENTSCALE_DEFAULT, PROTOCOL_NETQUAKE, SU_ARMOR, SU_IDEALPITCH, SU_INWATER, SU_ITEMS, SU_ONGROUND, SU_PUNCH1, SU_VELOCITY1, SU_VIEWHEIGHT, SU_WEAPON, SU_WEAPONFRAME, SvcOpsT, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_COLORMAP, U_EFFECTS, U_FRAME, U_LONGENTITY, U_MODEL, U_MOREBITS, U_NOLERP, U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_SIGNAL, U_SKIN, DEFAULT_VIEWHEIGHT, DEFAULT_SOUND_PACKET_ATTENUATION, DEFAULT_SOUND_PACKET_VOLUME, SND_ATTENUATION, SND_VOLUME, } from "../constants.ts";
import { type ClientdataT, type ClientdataTailT, type EntityUpdateT, type EntityUpdateTailT, type ProtocolCodec, type SoundHeaderT, type SoundMessageT, } from "./codec.ts";
export const NQ15_MAX_MSGLEN = 8000;
export const NQ15_MAX_DATAGRAM = 1024;
export const NQ15_MAX_PRECACHE = 256;
export function createNq15Codec(reader: MessageReader): ProtocolCodec {
    return {
        protocol: PROTOCOL_NETQUAKE,
        name: "NetQuake",
        maxMsglen: NQ15_MAX_MSGLEN,
        maxDatagram: NQ15_MAX_DATAGRAM,
        maxPrecache: NQ15_MAX_PRECACHE,
        defaultFlags: 0,
        writeCoord(sb: SizeBuf, f: number): void {
            MSG_WriteCoord(sb, f);
        },
        writeAngle(sb: SizeBuf, f: number): void {
            MSG_WriteAngle(sb, f);
        },
        readCoord(): number {
            return reader.Coord();
        },
        readAngle(): number {
            return reader.Angle();
        },
        writeProtocol(sb: SizeBuf): void {
            MSG_WriteLong(sb, PROTOCOL_NETQUAKE);
        },
        writeEntityUpdate(sb: SizeBuf, e: number, u: EntityUpdateT): void {
            let bits = 0;
            for (const i of AXES) {
                const miss = u.origin[i] - u.baseline.origin[i];
                if (miss < -0.1 || miss > 0.1)
                    bits |= U_ORIGIN1 << i;
            }
            if (u.angles[0] !== u.baseline.angles[0])
                bits |= U_ANGLE1;
            if (u.angles[1] !== u.baseline.angles[1])
                bits |= U_ANGLE2;
            if (u.angles[2] !== u.baseline.angles[2])
                bits |= U_ANGLE3;
            if (u.movetypeStep)
                bits |= U_NOLERP; // don't mess up the step animation
            if (u.baseline.colormap !== u.colormap)
                bits |= U_COLORMAP;
            if (u.baseline.skin !== u.skin)
                bits |= U_SKIN;
            if (u.baseline.frame !== u.frame)
                bits |= U_FRAME;
            if (u.baseline.effects !== u.effects)
                bits |= U_EFFECTS;
            if (u.baseline.modelindex !== u.modelindex)
                bits |= U_MODEL;
            if (e >= 256)
                bits |= U_LONGENTITY;
            if (bits >= 256)
                bits |= U_MOREBITS;
            MSG_WriteByte(sb, bits | U_SIGNAL);
            if (bits & U_MOREBITS)
                MSG_WriteByte(sb, bits >> 8);
            if (bits & U_LONGENTITY)
                MSG_WriteShort(sb, e);
            else
                MSG_WriteByte(sb, e);
            if (bits & U_MODEL)
                MSG_WriteByte(sb, u.modelindex);
            if (bits & U_FRAME)
                MSG_WriteByte(sb, u.frame);
            if (bits & U_COLORMAP)
                MSG_WriteByte(sb, u.colormap);
            if (bits & U_SKIN)
                MSG_WriteByte(sb, u.skin);
            if (bits & U_EFFECTS)
                MSG_WriteByte(sb, u.effects);
            if (bits & U_ORIGIN1)
                MSG_WriteCoord(sb, u.origin[0]);
            if (bits & U_ANGLE1)
                MSG_WriteAngle(sb, u.angles[0]);
            if (bits & U_ORIGIN2)
                MSG_WriteCoord(sb, u.origin[1]);
            if (bits & U_ANGLE2)
                MSG_WriteAngle(sb, u.angles[1]);
            if (bits & U_ORIGIN3)
                MSG_WriteCoord(sb, u.origin[2]);
            if (bits & U_ANGLE3)
                MSG_WriteAngle(sb, u.angles[2]);
        },
        writeBaseline(sb: SizeBuf, entnum: number, baseline: EntityStateT): void {
            if (baseline.modelindex & 0xff00)
                baseline.modelindex = 0;
            if (baseline.frame & 0xff00)
                baseline.frame = 0;
            baseline.alpha = ENTALPHA_DEFAULT;
            baseline.scale = ENTSCALE_DEFAULT;
            MSG_WriteByte(sb, SvcOpsT.svc_spawnbaseline);
            MSG_WriteShort(sb, entnum);
            MSG_WriteByte(sb, baseline.modelindex);
            MSG_WriteByte(sb, baseline.frame);
            MSG_WriteByte(sb, baseline.colormap);
            MSG_WriteByte(sb, baseline.skin);
            for (const i of AXES) {
                MSG_WriteCoord(sb, baseline.origin[i]);
                MSG_WriteAngle(sb, baseline.angles[i]);
            }
        },
        writeStatic(sb: SizeBuf, state: EntityStateT): boolean {
            if (state.modelindex & 0xff00 || state.frame & 0xff00)
                return false;
            MSG_WriteByte(sb, SvcOpsT.svc_spawnstatic);
            MSG_WriteByte(sb, state.modelindex);
            MSG_WriteByte(sb, state.frame);
            MSG_WriteByte(sb, state.colormap);
            MSG_WriteByte(sb, state.skin);
            for (const i of AXES) {
                MSG_WriteCoord(sb, state.origin[i]);
                MSG_WriteAngle(sb, state.angles[i]);
            }
            return true;
        },
        writeStaticSound(sb: SizeBuf, org: Vec3, soundNum: number, vol: number, atten: number): boolean {
            if (soundNum > 255)
                return false; // don't send any info protocol can't support
            MSG_WriteByte(sb, SvcOpsT.svc_spawnstaticsound);
            for (const i of AXES)
                MSG_WriteCoord(sb, org[i]);
            MSG_WriteByte(sb, soundNum);
            MSG_WriteByte(sb, vol * 255);
            MSG_WriteByte(sb, atten * 64);
            return true;
        },
        writeSound(sb: SizeBuf, s: SoundMessageT): boolean {
            if (s.ent >= 8192)
                return false; // don't send any info protocol can't support
            if (s.soundNum >= 256 || s.channel >= 8)
                return false;
            let field_mask = 0;
            if (s.volume !== DEFAULT_SOUND_PACKET_VOLUME)
                field_mask |= SND_VOLUME;
            if (s.attenuation !== DEFAULT_SOUND_PACKET_ATTENUATION)
                field_mask |= SND_ATTENUATION;
            MSG_WriteByte(sb, SvcOpsT.svc_sound);
            MSG_WriteByte(sb, field_mask);
            if (field_mask & SND_VOLUME)
                MSG_WriteByte(sb, s.volume);
            if (field_mask & SND_ATTENUATION)
                MSG_WriteByte(sb, s.attenuation * 64);
            MSG_WriteShort(sb, (s.ent << 3) | s.channel);
            MSG_WriteByte(sb, s.soundNum);
            for (const i of AXES)
                MSG_WriteCoord(sb, s.origin[i]);
            return true;
        },
        writeClientdata(sb: SizeBuf, cd: ClientdataT): void {
            let bits = 0;
            if (cd.viewheight !== DEFAULT_VIEWHEIGHT)
                bits |= SU_VIEWHEIGHT;
            if (cd.idealpitch)
                bits |= SU_IDEALPITCH;
            bits |= SU_ITEMS;
            if (cd.onground)
                bits |= SU_ONGROUND;
            if (cd.inwater)
                bits |= SU_INWATER;
            for (const i of AXES) {
                if (cd.punchangle[i])
                    bits |= SU_PUNCH1 << i;
                if (cd.velocity[i])
                    bits |= SU_VELOCITY1 << i;
            }
            if (cd.weaponframe)
                bits |= SU_WEAPONFRAME;
            if (cd.armorvalue)
                bits |= SU_ARMOR;
            bits |= SU_WEAPON;
            MSG_WriteByte(sb, SvcOpsT.svc_clientdata);
            MSG_WriteShort(sb, bits);
            if (bits & SU_VIEWHEIGHT)
                MSG_WriteChar(sb, cd.viewheight);
            if (bits & SU_IDEALPITCH)
                MSG_WriteChar(sb, cd.idealpitch);
            for (const i of AXES) {
                if (bits & (SU_PUNCH1 << i))
                    MSG_WriteChar(sb, cd.punchangle[i]);
                if (bits & (SU_VELOCITY1 << i))
                    MSG_WriteChar(sb, cd.velocity[i] / 16);
            }
            MSG_WriteLong(sb, cd.items);
            if (bits & SU_WEAPONFRAME)
                MSG_WriteByte(sb, cd.weaponframe);
            if (bits & SU_ARMOR)
                MSG_WriteByte(sb, cd.armorvalue);
            if (bits & SU_WEAPON)
                MSG_WriteByte(sb, cd.weaponmodelindex);
            MSG_WriteShort(sb, cd.health);
            MSG_WriteByte(sb, cd.currentammo);
            MSG_WriteByte(sb, cd.ammo_shells);
            MSG_WriteByte(sb, cd.ammo_nails);
            MSG_WriteByte(sb, cd.ammo_rockets);
            MSG_WriteByte(sb, cd.ammo_cells);
            if (cd.standardQuake) {
                MSG_WriteByte(sb, cd.weapon);
            }
            else {
                let weapon = 0;
                for (let i = 0; i < 32; i++) {
                    if ((cd.weapon | 0) & (1 << i)) {
                        weapon = i;
                        break;
                    }
                }
                MSG_WriteByte(sb, weapon);
            }
        },
        readProtocolFlags(): number {
            return 0;
        },
        readEntityBits(bits: number): number {
            return bits;
        },
        readEntityUpdateTail(_bits: number, out: EntityUpdateTailT): void {
            out.clear();
        },
        readBaseline(baseline: EntityStateT): void {
            baseline.modelindex = reader.Byte();
            baseline.frame = reader.Byte();
            baseline.colormap = reader.Byte();
            baseline.skin = reader.Byte();
            for (const i of AXES) {
                baseline.origin[i] = reader.Coord();
                baseline.angles[i] = reader.Angle();
            }
            baseline.alpha = ENTALPHA_DEFAULT;
            baseline.scale = ENTSCALE_DEFAULT;
        },
        readClientdataBits(): number {
            return reader.Short() & 0xffff;
        },
        readClientdataTail(_bits: number, out: ClientdataTailT): void {
            out.clear();
        },
        readSoundHeader(_fieldMask: number, out: SoundHeaderT): void {
            const channel = reader.Short();
            out.ent = channel >> 3;
            out.channel = channel & 7;
            out.soundNum = reader.Byte();
        },
        readStaticSoundIndex(): number {
            return reader.Byte();
        },
    };
}
