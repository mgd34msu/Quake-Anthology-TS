// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
import type { SizeBuf } from "../message.ts";
import type { Vec3 } from "../wire-types.ts";
import { vec3 } from "../wire-types.ts";
import { EntityStateT } from "../wire-types.ts";
import { ENTALPHA_DEFAULT, ENTSCALE_DEFAULT } from "../constants.ts";
import type { QwEntityStateT, QwUsercmdT } from "../qw-constants.ts";
export class EntityUpdateT {
    origin: Vec3 = vec3();
    angles: Vec3 = vec3();
    modelindex = 0;
    frame = 0;
    colormap = 0;
    skin = 0;
    effects = 0;
    alpha: number = ENTALPHA_DEFAULT; // already ENTALPHA_ENCODE'd
    scale: number = ENTSCALE_DEFAULT; // already ENTSCALE_ENCODE'd
    movetypeStep = false; // ent->v.movetype == MOVETYPE_STEP
    sendinterval = false; // Ironwail's ent->sendinterval (U_LERPFINISH gate)
    lerpfinish = 0; // ent->v.nextthink - sv.time
    baseline: EntityStateT = new EntityStateT();
}
export class ClientdataT {
    viewheight = 0;
    idealpitch = 0;
    punchangle: Vec3 = vec3();
    velocity: Vec3 = vec3();
    items = 0;
    onground = false;
    inwater = false;
    weaponframe = 0;
    armorvalue = 0;
    weaponmodelindex = 0;
    health = 0;
    currentammo = 0;
    ammo_shells = 0;
    ammo_nails = 0;
    ammo_rockets = 0;
    ammo_cells = 0;
    weapon = 0;
    standardQuake = true;
    alpha: number = ENTALPHA_DEFAULT; // the player entity's alpha, reused as weaponalpha
}
export class SoundMessageT {
    ent = 0;
    channel = 0;
    soundNum = 0;
    volume = 0;
    attenuation = 0;
    origin: Vec3 = vec3();
}
export class EntityUpdateTailT {
    hasAlpha = false;
    alpha: number = ENTALPHA_DEFAULT;
    hasScale = false;
    scale: number = ENTSCALE_DEFAULT;
    hasFrame2 = false;
    frameHigh = 0; // the byte, not yet shifted
    hasModel2 = false;
    modelHigh = 0;
    hasLerpfinish = false;
    lerpfinish = 0; // the raw byte / 255, added to ent.msgtime by the caller
    clear(): void {
        this.hasAlpha = false;
        this.alpha = ENTALPHA_DEFAULT;
        this.hasScale = false;
        this.scale = ENTSCALE_DEFAULT;
        this.hasFrame2 = false;
        this.frameHigh = 0;
        this.hasModel2 = false;
        this.modelHigh = 0;
        this.hasLerpfinish = false;
        this.lerpfinish = 0;
    }
}
export class ClientdataTailT {
    weaponHigh = 0;
    armorHigh = 0;
    ammoHigh = 0;
    shellsHigh = 0;
    nailsHigh = 0;
    rocketsHigh = 0;
    cellsHigh = 0;
    weaponframeHigh = 0;
    weaponalpha: number = ENTALPHA_DEFAULT;
    clear(): void {
        this.weaponHigh = 0;
        this.armorHigh = 0;
        this.ammoHigh = 0;
        this.shellsHigh = 0;
        this.nailsHigh = 0;
        this.rocketsHigh = 0;
        this.cellsHigh = 0;
        this.weaponframeHigh = 0;
        this.weaponalpha = ENTALPHA_DEFAULT;
    }
}
export class SoundHeaderT {
    ent = 0;
    channel = 0;
    soundNum = 0;
}
export class QwEntityWordT {
    bits = 0;
    ext = 0; // the protocol-29 extend byte; always 0 on 28
    number = 0;
    remove = false;
    clear(): void {
        this.bits = 0;
        this.ext = 0;
        this.number = 0;
        this.remove = false;
    }
}
export interface ProtocolCodec {
    readonly protocol: number;
    readonly name: string;
    readonly maxMsglen: number;
    readonly maxDatagram: number;
    readonly maxPrecache: number;
    readonly defaultFlags: number;
    writeCoord(sb: SizeBuf, f: number, flags: number): void;
    writeAngle(sb: SizeBuf, f: number, flags: number): void;
    readCoord(flags: number): number;
    readAngle(flags: number): number;
    writeProtocol(sb: SizeBuf, flags: number): void;
    writeEntityUpdate(sb: SizeBuf, e: number, u: EntityUpdateT, flags: number): void;
    writeBaseline(sb: SizeBuf, entnum: number, baseline: EntityStateT, flags: number): void;
    writeStatic(sb: SizeBuf, state: EntityStateT, flags: number): boolean;
    writeStaticSound(sb: SizeBuf, org: Vec3, soundNum: number, vol: number, atten: number, flags: number): boolean;
    writeSound(sb: SizeBuf, s: SoundMessageT, flags: number): boolean;
    writeClientdata(sb: SizeBuf, cd: ClientdataT, flags: number): void;
    readProtocolFlags(): number;
    readEntityBits(bits: number): number;
    readEntityUpdateTail(bits: number, out: EntityUpdateTailT): void;
    readBaseline(baseline: EntityStateT, version: number, flags: number): void;
    readClientdataBits(): number;
    readClientdataTail(bits: number, out: ClientdataTailT): void;
    readSoundHeader(fieldMask: number, out: SoundHeaderT): void;
    readStaticSoundIndex(version: number): number;
    readonly maxEntityNumber?: number;
    readonly maxPacketEntities?: number;
    writeDeltaUsercmd?(sb: SizeBuf, from: QwUsercmdT, cmd: QwUsercmdT): void;
    readDeltaUsercmd?(from: QwUsercmdT, move: QwUsercmdT): void;
    writeDeltaEntity?(sb: SizeBuf, from: QwEntityStateT, to: QwEntityStateT, force: boolean, flags: number): boolean;
    writeRemoveEntity?(sb: SizeBuf, entnum: number): void;
    writePacketEntitiesEnd?(sb: SizeBuf): void;
    readDeltaEntityHeader?(word: number, out: QwEntityWordT): void;
    readDeltaEntity?(from: QwEntityStateT, to: QwEntityStateT, hdr: QwEntityWordT, flags: number): void;
    writeQwBaseline?(sb: SizeBuf, es: QwEntityStateT, flags: number): void;
    readQwBaseline?(es: QwEntityStateT, flags: number): void;
    writeModelIndex?(sb: SizeBuf, n: number): void;
    readModelIndex?(): number;
    writeSoundIndex?(sb: SizeBuf, n: number): void;
    readSoundIndex?(): number;
    writePrecacheCount?(sb: SizeBuf, n: number): void;
    readPrecacheCount?(): number;
}
export type QwProtocolCodec = ProtocolCodec & Required<Pick<ProtocolCodec, "maxEntityNumber" | "maxPacketEntities" | "writeDeltaUsercmd" | "readDeltaUsercmd" | "writeDeltaEntity" | "writeRemoveEntity" | "writePacketEntitiesEnd" | "readDeltaEntityHeader" | "readDeltaEntity" | "writeQwBaseline" | "readQwBaseline" | "writeModelIndex" | "readModelIndex" | "writeSoundIndex" | "readSoundIndex" | "writePrecacheCount" | "readPrecacheCount">>;
