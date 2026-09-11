import { createKexWriter } from "./kex-write.ts";
import { inflateSync } from "node:zlib";
// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
import { SizeBuf, SZ_Init, MSG_BeginReading, MSG_ReadByte, MSG_ReadChar, MSG_ReadShort, MSG_ReadWord, MSG_ReadLong, MSG_ReadFloat, MSG_ReadString, MSG_ReadData, MSG_ReadDir } from "../message.ts";
import { U_ORIGIN1, U_ORIGIN2, U_ORIGIN3, U_ANGLE1, U_ANGLE2, U_ANGLE3, U_FRAME8, U_EVENT, U_MODEL, U_RENDERFX8, U_EFFECTS8, U_SKIN8, U_FRAME16, U_RENDERFX16, U_EFFECTS16, U_MODEL2, U_MODEL3, U_MODEL4, U_OLDORIGIN, U_SKIN16, U_SOUND, U_SOLID, PS_M_TYPE, PS_M_ORIGIN, PS_M_VELOCITY, PS_M_TIME, PS_M_FLAGS, PS_M_GRAVITY, PS_M_DELTA_ANGLES, PS_VIEWOFFSET, PS_VIEWANGLES, PS_KICKANGLES, PS_BLEND, PS_FOV, PS_WEAPONINDEX, PS_WEAPONFRAME, PS_RDFLAGS, SvcOpsT, ComError, ERR_DROP, } from "../constants.ts";
import { EntityStateT, PlayerStateT, ANGLE2SHORT } from "../state.ts";
import type { ProtocolCodec, ServerDataReadResultT, FrameHeaderT } from "./codec.ts";
import { createRereleaseContext } from "./q2repro.ts";
export interface KexDamageIndicatorT {
    damage: number;
    health: boolean;
    armor: boolean;
    shield: boolean;
    direction: Float32Array;
}
export interface KexPoiT {
    key: number;
    time: number;
    pos: Float32Array;
    image: number;
    color: number;
    flags: number;
}
export interface KexHelpPathT {
    start: boolean;
    pos: Float32Array;
    dir: Float32Array;
}
export interface KexMuzzleflash3T {
    entity: number;
    weapon: number;
}
export interface KexLocprintT {
    flags: number;
    base: string;
    args: string[];
}
export interface KexSoundT {
    flags: number;
    index: number;
    volume: number;
    attenuation: number;
    timeofs: number;
    entity: number;
    channel: number;
    pos: Float32Array | null;
}
export interface KexConfigstringRecordT {
    index: number;
    value: string;
}
export function createKexContext(net_message: SizeBuf) {
    const { readEntityBitsWide, bitsHasHi, HI_SCALE, HI_MOREFX16, decodeAlpha, decodeScale, decodeLoopVolume, decodeLoopAttenuation, SOUND_FLAG_VOLUME, SOUND_FLAG_ATTENUATION, pmFloatToShort, VIEWOFFSET_SCALE, KICK_ANGLE_SCALE, Q2PRO_GUNINDEX_BITS, Q2PRO_GUNINDEX_MASK } = createRereleaseContext(net_message);
    const PROTOCOL_KEX_DEMOS = 2022;
    const PROTOCOL_KEX = 2023;
    let kexServerProtocol = PROTOCOL_KEX;
    function setKexProtocol(protocol: number): void {
        kexServerProtocol = protocol;
    }
    const kexDemoEdictNonzeroSolid = new Map<number, boolean>();
    const U_MODEL16 = 1 << 28;
    const U_KEX_EFFECTS64 = 1 << 29;
    const U_ALPHA = 1 << 30;
    const HI_KEX_INSTANCE = HI_MOREFX16;
    const HI_KEX_OWNER = 4;
    const HI_KEX_OLDFRAME = 8;
    const PS_MOREBITS = 1 << 15;
    const PS_KEX_DAMAGE_BLEND = 1 << 16;
    const PS_KEX_TEAM_ID = 1 << 17;
    const GUNBIT_OFFSET_X = 1 << 0;
    const GUNBIT_OFFSET_Y = 1 << 1;
    const GUNBIT_OFFSET_Z = 1 << 2;
    const GUNBIT_ANGLES_X = 1 << 3;
    const GUNBIT_ANGLES_Y = 1 << 4;
    const GUNBIT_ANGLES_Z = 1 << 5;
    const GUNBIT_GUNRATE = 1 << 6;
    const SND_VOLUME = 1 << 0;
    const SND_ATTENUATION = 1 << 1;
    const SND_POS = 1 << 2;
    const SND_ENT = 1 << 3;
    const SND_OFFSET = 1 << 4;
    const SND_KEX_LARGE_ENT = 1 << 6;
    const SOUND_DEFAULT_VOLUME = 1.0;
    const SOUND_DEFAULT_ATTENUATION = 1.0;
    const COORD_SHORT_SCALE = 0.125;
    function readServerData(): ServerDataReadResultT {
        kexDemoEdictNonzeroSolid.clear();
        const servercount = MSG_ReadLong(net_message);
        const attractloop = MSG_ReadByte(net_message) !== 0;
        const serverFps = MSG_ReadByte(net_message);
        const gamedir = MSG_ReadString(net_message);
        const clientnum = MSG_ReadShort(net_message);
        if (clientnum === -2) {
            throw new ComError(ERR_DROP, "kexdemo: svc_serverdata clientnum -2 (split-screen) is not supported");
        }
        const levelname = MSG_ReadString(net_message);
        return { servercount, attractloop, gamedir, clientnum, levelname, serverState: 0, serverFps };
    }
    const readEntityBits = readEntityBitsWide;
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
        dst.instance_bits = src.instance_bits;
        dst.owner = src.owner;
        dst.old_frame = src.old_frame;
    }
    function readDeltaEntity(from: EntityStateT, to: EntityStateT, number: number, bits: number): void {
        copyEntityState(to, from);
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
        if (bits & U_FRAME8)
            to.frame = MSG_ReadByte(net_message);
        else if (bits & U_FRAME16)
            to.frame = MSG_ReadWord(net_message);
        if ((bits & (U_SKIN8 | U_SKIN16)) === (U_SKIN8 | U_SKIN16))
            to.skinnum = MSG_ReadLong(net_message);
        else if (bits & U_SKIN16)
            to.skinnum = MSG_ReadWord(net_message);
        else if (bits & U_SKIN8)
            to.skinnum = MSG_ReadByte(net_message);
        let lowEffects = 0;
        if (bits & U_KEX_EFFECTS64)
            lowEffects = MSG_ReadLong(net_message) >>> 0;
        let effects32 = 0;
        const effectsCombo = bits & (U_EFFECTS8 | U_EFFECTS16);
        if (effectsCombo === (U_EFFECTS8 | U_EFFECTS16))
            effects32 = MSG_ReadLong(net_message) >>> 0;
        else if (bits & U_EFFECTS16)
            effects32 = MSG_ReadWord(net_message) >>> 0;
        else if (bits & U_EFFECTS8)
            effects32 = MSG_ReadByte(net_message) >>> 0;
        if (bits & (U_KEX_EFFECTS64 | U_EFFECTS8 | U_EFFECTS16)) {
            if (bits & U_KEX_EFFECTS64) {
                to.effects = lowEffects >>> 0;
                to.morefx = effects32 >>> 0;
            }
            else {
                to.effects = effects32 >>> 0;
                to.morefx = 0;
            }
        }
        if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16))
            to.renderfx = MSG_ReadLong(net_message);
        else if (bits & U_RENDERFX16)
            to.renderfx = MSG_ReadWord(net_message);
        else if (bits & U_RENDERFX8)
            to.renderfx = MSG_ReadByte(net_message);
        let nonzeroSolid: boolean;
        if (bits & U_SOLID) {
            to.solid = MSG_ReadLong(net_message) >>> 0;
            nonzeroSolid = to.solid !== 0;
            kexDemoEdictNonzeroSolid.set(number, nonzeroSolid);
        }
        else {
            nonzeroSolid = kexDemoEdictNonzeroSolid.get(number) ?? false;
        }
        const highPrecisionOrigin = kexServerProtocol !== PROTOCOL_KEX_DEMOS || nonzeroSolid;
        if (highPrecisionOrigin) {
            if (bits & U_ORIGIN1)
                to.origin[0] = MSG_ReadFloat(net_message);
            if (bits & U_ORIGIN2)
                to.origin[1] = MSG_ReadFloat(net_message);
            if (bits & U_ORIGIN3)
                to.origin[2] = MSG_ReadFloat(net_message);
            if (bits & U_OLDORIGIN) {
                to.old_origin[0] = MSG_ReadFloat(net_message);
                to.old_origin[1] = MSG_ReadFloat(net_message);
                to.old_origin[2] = MSG_ReadFloat(net_message);
            }
        }
        else {
            if (bits & U_ORIGIN1)
                to.origin[0] = MSG_ReadShort(net_message) * COORD_SHORT_SCALE;
            if (bits & U_ORIGIN2)
                to.origin[1] = MSG_ReadShort(net_message) * COORD_SHORT_SCALE;
            if (bits & U_ORIGIN3)
                to.origin[2] = MSG_ReadShort(net_message) * COORD_SHORT_SCALE;
            if (bits & U_OLDORIGIN) {
                to.old_origin[0] = MSG_ReadShort(net_message) * COORD_SHORT_SCALE;
                to.old_origin[1] = MSG_ReadShort(net_message) * COORD_SHORT_SCALE;
                to.old_origin[2] = MSG_ReadShort(net_message) * COORD_SHORT_SCALE;
            }
        }
        if (bits & U_ANGLE1)
            to.angles[0] = MSG_ReadFloat(net_message);
        if (bits & U_ANGLE2)
            to.angles[1] = MSG_ReadFloat(net_message);
        if (bits & U_ANGLE3)
            to.angles[2] = MSG_ReadFloat(net_message);
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
        if (bits & U_ALPHA)
            to.alpha = decodeAlpha(MSG_ReadByte(net_message));
        if (bitsHasHi(bits, HI_SCALE))
            to.scale = decodeScale(MSG_ReadByte(net_message));
        if (bitsHasHi(bits, HI_KEX_INSTANCE))
            to.instance_bits = MSG_ReadByte(net_message);
        if (bitsHasHi(bits, HI_KEX_OWNER))
            to.owner = MSG_ReadWord(net_message);
        if (bitsHasHi(bits, HI_KEX_OLDFRAME))
            to.old_frame = MSG_ReadWord(net_message);
    }
    function readKexFlags(): number {
        let flags = MSG_ReadWord(net_message);
        if (flags & PS_MOREBITS) {
            const moreFlags = MSG_ReadWord(net_message);
            flags |= moreFlags << 16;
        }
        return flags >>> 0;
    }
    function readKexPlayerStateFields(from: PlayerStateT, to: PlayerStateT, flags: number): void {
        to.pmove.pm_type = from.pmove.pm_type;
        to.pmove.origin.set(from.pmove.origin);
        to.pmove.velocity.set(from.pmove.velocity);
        to.pmove.originF.set(from.pmove.originF);
        to.pmove.velocityF.set(from.pmove.velocityF);
        to.pmove.pm_flags = from.pmove.pm_flags;
        to.pmove.pm_time = from.pmove.pm_time;
        to.pmove.gravity = from.pmove.gravity;
        to.pmove.delta_angles.set(from.pmove.delta_angles);
        to.pmove.delta_anglesF.set(from.pmove.delta_anglesF);
        to.pmove.deltaAngleEncoding = from.pmove.deltaAngleEncoding;
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
        to.team_id = from.team_id;
        if (flags & PS_M_TYPE)
            to.pmove.pm_type = MSG_ReadByte(net_message);
        if (flags & PS_M_ORIGIN) {
            const x = MSG_ReadFloat(net_message);
            const y = MSG_ReadFloat(net_message);
            const z = MSG_ReadFloat(net_message);
            to.pmove.originF[0] = x;
            to.pmove.originF[1] = y;
            to.pmove.originF[2] = z;
            to.pmove.origin[0] = pmFloatToShort(x);
            to.pmove.origin[1] = pmFloatToShort(y);
            to.pmove.origin[2] = pmFloatToShort(z);
        }
        if (flags & PS_M_VELOCITY) {
            const x = MSG_ReadFloat(net_message);
            const y = MSG_ReadFloat(net_message);
            const z = MSG_ReadFloat(net_message);
            to.pmove.velocityF[0] = x;
            to.pmove.velocityF[1] = y;
            to.pmove.velocityF[2] = z;
            to.pmove.velocity[0] = pmFloatToShort(x);
            to.pmove.velocity[1] = pmFloatToShort(y);
            to.pmove.velocity[2] = pmFloatToShort(z);
        }
        if (flags & PS_M_TIME)
            to.pmove.pm_time = MSG_ReadWord(net_message);
        if (flags & PS_M_FLAGS)
            to.pmove.pm_flags = MSG_ReadWord(net_message);
        if (flags & PS_M_GRAVITY)
            to.pmove.gravity = MSG_ReadShort(net_message);
        if (flags & PS_M_DELTA_ANGLES) {
            to.pmove.deltaAngleEncoding = "float";
            to.pmove.delta_anglesF[0] = MSG_ReadFloat(net_message);
            to.pmove.delta_angles[0] = ANGLE2SHORT(to.pmove.delta_anglesF[0] ?? 0);
            to.pmove.delta_anglesF[1] = MSG_ReadFloat(net_message);
            to.pmove.delta_angles[1] = ANGLE2SHORT(to.pmove.delta_anglesF[1] ?? 0);
            to.pmove.delta_anglesF[2] = MSG_ReadFloat(net_message);
            to.pmove.delta_angles[2] = ANGLE2SHORT(to.pmove.delta_anglesF[2] ?? 0);
        }
        if (flags & PS_VIEWOFFSET) {
            to.viewoffset[0] = MSG_ReadShort(net_message) / VIEWOFFSET_SCALE;
            to.viewoffset[1] = MSG_ReadShort(net_message) / VIEWOFFSET_SCALE;
            to.viewoffset[2] = MSG_ReadShort(net_message) / VIEWOFFSET_SCALE;
            to.pmove.viewheight = MSG_ReadChar(net_message);
        }
        if (flags & PS_VIEWANGLES) {
            to.viewangles[0] = MSG_ReadFloat(net_message);
            to.viewangles[1] = MSG_ReadFloat(net_message);
            to.viewangles[2] = MSG_ReadFloat(net_message);
        }
        if (flags & PS_KICKANGLES) {
            to.kick_angles[0] = MSG_ReadShort(net_message) / KICK_ANGLE_SCALE;
            to.kick_angles[1] = MSG_ReadShort(net_message) / KICK_ANGLE_SCALE;
            to.kick_angles[2] = MSG_ReadShort(net_message) / KICK_ANGLE_SCALE;
        }
        if (flags & PS_WEAPONINDEX) {
            const gunIndexAndSkin = MSG_ReadWord(net_message);
            to.gunindex = gunIndexAndSkin & Q2PRO_GUNINDEX_MASK;
            to.gunskin = gunIndexAndSkin >>> Q2PRO_GUNINDEX_BITS;
        }
        if (flags & PS_WEAPONFRAME) {
            let gunbits = MSG_ReadWord(net_message);
            to.gunframe = gunbits & 0x1ff;
            gunbits >>>= 9;
            if (gunbits & GUNBIT_OFFSET_X)
                to.gunoffset[0] = MSG_ReadFloat(net_message);
            if (gunbits & GUNBIT_OFFSET_Y)
                to.gunoffset[1] = MSG_ReadFloat(net_message);
            if (gunbits & GUNBIT_OFFSET_Z)
                to.gunoffset[2] = MSG_ReadFloat(net_message);
            if (gunbits & GUNBIT_ANGLES_X)
                to.gunangles[0] = MSG_ReadFloat(net_message);
            if (gunbits & GUNBIT_ANGLES_Y)
                to.gunangles[1] = MSG_ReadFloat(net_message);
            if (gunbits & GUNBIT_ANGLES_Z)
                to.gunangles[2] = MSG_ReadFloat(net_message);
            if (gunbits & GUNBIT_GUNRATE)
                to.gunrate = MSG_ReadByte(net_message);
        }
        if (flags & PS_BLEND) {
            to.blend[0] = MSG_ReadByte(net_message) / 255;
            to.blend[1] = MSG_ReadByte(net_message) / 255;
            to.blend[2] = MSG_ReadByte(net_message) / 255;
            to.blend[3] = MSG_ReadByte(net_message) / 255;
        }
        if (flags & PS_FOV)
            to.fov = MSG_ReadByte(net_message);
        if (flags & PS_RDFLAGS)
            to.rdflags = MSG_ReadByte(net_message);
        const statbits1 = MSG_ReadLong(net_message) >>> 0;
        for (let i = 0; i < 32; i++) {
            if (statbits1 & (1 << i)) {
                const value = MSG_ReadShort(net_message);
                if (i < to.stats.length)
                    to.stats[i] = value;
            }
        }
        const statbits2 = MSG_ReadLong(net_message) >>> 0;
        for (let i = 0; i < 32; i++) {
            if (statbits2 & (1 << i)) {
                const value = MSG_ReadShort(net_message);
                const idx = 32 + i;
                if (idx < to.stats.length)
                    to.stats[idx] = value;
            }
        }
        if (flags & PS_KEX_DAMAGE_BLEND) {
            to.damage_blend[0] = MSG_ReadByte(net_message) / 255;
            to.damage_blend[1] = MSG_ReadByte(net_message) / 255;
            to.damage_blend[2] = MSG_ReadByte(net_message) / 255;
            to.damage_blend[3] = MSG_ReadByte(net_message) / 255;
        }
        if (flags & PS_KEX_TEAM_ID) {
            to.team_id = MSG_ReadByte(net_message);
        }
    }
    function readPlayerStateDelta(_msg: SizeBuf, from: PlayerStateT, to: PlayerStateT): void {
        const flags = readKexFlags();
        readKexPlayerStateFields(from, to, flags);
    }
    function readFrameHeader(areabits: Uint8Array, _readSuppressByte: boolean): FrameHeaderT {
        const serverframe = MSG_ReadLong(net_message);
        const deltaframe = MSG_ReadLong(net_message);
        const surpressCount = MSG_ReadByte(net_message);
        const len = MSG_ReadByte(net_message);
        MSG_ReadData(net_message, areabits, len);
        return { serverframe, deltaframe, surpressCount, areabytes: len };
    }
    function readFramePlayerstate(from: PlayerStateT, to: PlayerStateT): void {
        const cmd = MSG_ReadByte(net_message);
        if (cmd !== SvcOpsT.svc_playerinfo)
            throw new ComError(ERR_DROP, `kexdemo: CL_ParseFrame: not playerinfo (got ${cmd})`);
        const flags = readKexFlags();
        readKexPlayerStateFields(from, to, flags);
    }
    function readPacketEntitiesBegin(): void {
        const cmd = MSG_ReadByte(net_message);
        if (cmd !== SvcOpsT.svc_packetentities)
            throw new ComError(ERR_DROP, `kexdemo: CL_ParseFrame: not packetentities (got ${cmd})`);
    }
    const KEX_DEMO_CODEC: ProtocolCodec = {
        name: "kexdemo",
        ...createKexWriter(() => kexServerProtocol, createRereleaseContext(net_message)),
        readServerData,
        readEntityBits,
        readDeltaEntity,
        readPlayerStateDelta,
        readFrameHeader,
        readFramePlayerstate,
        readPacketEntitiesBegin,
    };
    const MAX_DAMAGE_INDICATORS = 4;
    function readDamageKex(): KexDamageIndicatorT[] {
        const count = MSG_ReadByte(net_message);
        const result: KexDamageIndicatorT[] = [];
        for (let i = 0; i < count; i++) {
            const encoded = MSG_ReadByte(net_message);
            const direction = new Float32Array(3);
            MSG_ReadDir(net_message, direction);
            if (i >= MAX_DAMAGE_INDICATORS)
                continue;
            result.push({
                damage: encoded & 0x1f,
                health: (encoded & 0x20) !== 0,
                armor: (encoded & 0x40) !== 0,
                shield: (encoded & 0x80) !== 0,
                direction,
            });
        }
        return result;
    }
    function readPoiKex(): KexPoiT {
        const key = MSG_ReadWord(net_message);
        const time = MSG_ReadWord(net_message);
        const pos = new Float32Array([MSG_ReadFloat(net_message), MSG_ReadFloat(net_message), MSG_ReadFloat(net_message)]);
        const image = MSG_ReadWord(net_message);
        const color = MSG_ReadByte(net_message);
        const flags = MSG_ReadByte(net_message);
        return { key, time, pos, image, color, flags };
    }
    function readHelpPathKex(): KexHelpPathT {
        const start = MSG_ReadByte(net_message) !== 0;
        const pos = new Float32Array([MSG_ReadFloat(net_message), MSG_ReadFloat(net_message), MSG_ReadFloat(net_message)]);
        const dir = new Float32Array(3);
        MSG_ReadDir(net_message, dir);
        return { start, pos, dir };
    }
    function readMuzzleflash3Kex(): KexMuzzleflash3T {
        const entity = MSG_ReadShort(net_message);
        const weapon = MSG_ReadWord(net_message);
        return { entity, weapon };
    }
    function readAchievementKex(): string {
        return MSG_ReadString(net_message);
    }
    const MAX_LOCALIZATION_ARGS = 8;
    function readLocprintKex(): KexLocprintT {
        const flags = MSG_ReadByte(net_message);
        const base = MSG_ReadString(net_message);
        const numArgs = MSG_ReadByte(net_message);
        if (numArgs > MAX_LOCALIZATION_ARGS) {
            throw new ComError(ERR_DROP, `kexdemo: svc_rr_locprint num_args ${numArgs} exceeds MAX_LOCALIZATION_ARGS (${MAX_LOCALIZATION_ARGS})`);
        }
        const args: string[] = [];
        for (let i = 0; i < numArgs; i++)
            args.push(MSG_ReadString(net_message));
        return { flags, base, args };
    }
    function readSplitclientKex(): number {
        return MSG_ReadByte(net_message);
    }
    function isKexDemoProtocol(): boolean {
        return kexServerProtocol === PROTOCOL_KEX_DEMOS;
    }
    function readSoundKex(): KexSoundT {
        const flags = MSG_ReadByte(net_message);
        const index = MSG_ReadWord(net_message);
        const volume = flags & SND_VOLUME ? MSG_ReadByte(net_message) / 255 : SOUND_DEFAULT_VOLUME;
        const attenuation = flags & SND_ATTENUATION ? MSG_ReadByte(net_message) / 64 : SOUND_DEFAULT_ATTENUATION;
        const timeofs = flags & SND_OFFSET ? MSG_ReadByte(net_message) / 1000 : 0;
        let entity = 0;
        let channel = 0;
        if (flags & SND_ENT) {
            const entchan = flags & SND_KEX_LARGE_ENT ? MSG_ReadLong(net_message) >>> 0 : MSG_ReadWord(net_message);
            entity = entchan >>> 3;
            channel = entchan & 7;
        }
        let pos: Float32Array | null = null;
        if (flags & SND_POS) {
            if (!isKexDemoProtocol()) {
                pos = new Float32Array([MSG_ReadFloat(net_message), MSG_ReadFloat(net_message), MSG_ReadFloat(net_message)]);
                return { flags, index, volume, attenuation, timeofs, entity, channel, pos };
            }
            pos = new Float32Array([
                MSG_ReadShort(net_message) * COORD_SHORT_SCALE,
                MSG_ReadShort(net_message) * COORD_SHORT_SCALE,
                MSG_ReadShort(net_message) * COORD_SHORT_SCALE,
            ]);
        }
        return { flags, index, volume, attenuation, timeofs, entity, channel, pos };
    }
    function inflateInternal(compressedLen: number): Uint8Array {
        const compressed = new Uint8Array(compressedLen);
        MSG_ReadData(net_message, compressed, compressedLen);
        try {
            return new Uint8Array(inflateSync(compressed));
        }
        catch (e) {
            throw new ComError(ERR_DROP, `kexdemo: zlib inflate failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    function makeReadBuf(data: Uint8Array): SizeBuf {
        const buf = new SizeBuf();
        SZ_Init(buf, data, data.length);
        buf.cursize = data.length;
        MSG_BeginReading(buf);
        return buf;
    }
    function readConfigblastKex(): KexConfigstringRecordT[] {
        const compressedLen = MSG_ReadWord(net_message);
        MSG_ReadWord(net_message);
        const inflated = inflateInternal(compressedLen);
        const buf = makeReadBuf(inflated);
        const records: KexConfigstringRecordT[] = [];
        while (buf.readcount < buf.cursize) {
            const index = MSG_ReadWord(buf);
            const value = MSG_ReadString(buf);
            records.push({ index, value });
        }
        return records;
    }
    function readSpawnbaselineblastKex(): Array<{
        entnum: number;
        state: EntityStateT;
    }> {
        const compressedLen = MSG_ReadWord(net_message);
        MSG_ReadWord(net_message);
        const inflated = inflateInternal(compressedLen);
        const saved = { data: net_message.data, view: net_message.view, cursize: net_message.cursize, readcount: net_message.readcount, maxsize: net_message.maxsize };
        net_message.data = inflated;
        net_message.view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
        net_message.cursize = inflated.length;
        net_message.readcount = 0;
        net_message.maxsize = inflated.length;
        const results: Array<{
            entnum: number;
            state: EntityStateT;
        }> = [];
        try {
            while (net_message.readcount < net_message.cursize) {
                const { number: entnum, bits } = readEntityBitsWide();
                const state = new EntityStateT();
                readDeltaEntity(new EntityStateT(), state, entnum, bits);
                state.number = entnum;
                results.push({ entnum, state });
            }
        }
        finally {
            net_message.data = saved.data;
            net_message.view = saved.view;
            net_message.cursize = saved.cursize;
            net_message.readcount = saved.readcount;
            net_message.maxsize = saved.maxsize;
        }
        return results;
    }
    return { PROTOCOL_KEX_DEMOS, PROTOCOL_KEX, setKexProtocol, HI_KEX_OWNER, HI_KEX_OLDFRAME, GUNBIT_GUNRATE, KEX_DEMO_CODEC, readDamageKex, readPoiKex, readHelpPathKex, readMuzzleflash3Kex, readAchievementKex, readLocprintKex, readSplitclientKex, isKexDemoProtocol, readSoundKex, readConfigblastKex, readSpawnbaselineblastKex };
}
