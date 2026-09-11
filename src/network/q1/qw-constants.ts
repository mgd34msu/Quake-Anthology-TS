// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
import { type Vec3, vec3 } from "./wire-types.ts";
import { DEFAULT_SOUND_PACKET_VOLUME, DEFAULT_SOUND_PACKET_ATTENUATION, ENTALPHA_DEFAULT, ENTSCALE_DEFAULT, } from "./constants.ts";
export { DEFAULT_SOUND_PACKET_VOLUME, DEFAULT_SOUND_PACKET_ATTENUATION };
export const PROTOCOL_VERSION = 28;
export const QW_CHECK_HASH = 0x5157;
export const PORT_CLIENT = 27001;
export const PORT_MASTER = 27000;
export const PORT_SERVER = 27500;
export const S2C_CHALLENGE = "c";
export const S2C_CONNECTION = "j";
export const A2A_PING = "k"; // respond with an A2A_ACK
export const A2A_ACK = "l"; // general acknowledgement without info
export const A2A_NACK = "m"; // [+ comment] general failure
export const A2A_ECHO = "e"; // for echoing
export const A2C_PRINT = "n"; // print a message on client
export const S2M_HEARTBEAT = "a"; // + serverinfo + userlist + fraglist
export const A2C_CLIENT_COMMAND = "B"; // + command line
export const S2M_SHUTDOWN = "C";
export enum SvcOpsT {
    svc_bad = 0,
    svc_nop = 1,
    svc_disconnect = 2,
    svc_updatestat = 3,// [byte] [byte]
    svc_setview = 5,// [short] entity number
    svc_sound = 6,// <see code>
    svc_print = 8,// [byte] id [string] null terminated string
    svc_stufftext = 9,// [string] stuffed into client's console buffer
    svc_setangle = 10,// [angle3] set the view angle to this absolute value
    svc_serverdata = 11,// [long] protocol ...
    svc_lightstyle = 12,// [byte] [string]
    svc_updatefrags = 14,// [byte] [short]
    svc_stopsound = 16,// <see code>
    svc_damage = 19,
    svc_spawnstatic = 20,
    svc_spawnbaseline = 22,
    svc_temp_entity = 23,// variable
    svc_setpause = 24,// [byte] on / off
    svc_centerprint = 26,// [string] to put in center of the screen
    svc_killedmonster = 27,
    svc_foundsecret = 28,
    svc_spawnstaticsound = 29,// [coord3] [byte] samp [byte] vol [byte] aten
    svc_intermission = 30,// [vec3_t] origin [vec3_t] angle
    svc_finale = 31,// [string] text
    svc_cdtrack = 32,// [byte] track
    svc_sellscreen = 33,
    svc_smallkick = 34,// set client punchangle to 2
    svc_bigkick = 35,// set client punchangle to 4
    svc_updateping = 36,// [byte] [short]
    svc_updateentertime = 37,// [byte] [float]
    svc_updatestatlong = 38,// [byte] [long]
    svc_muzzleflash = 39,// [short] entity
    svc_updateuserinfo = 40,// [byte] slot [long] uid
    svc_download = 41,// [short] size [size bytes]
    svc_playerinfo = 42,// variable
    svc_nails = 43,// [byte] num [48 bits] xyzpy 12 12 12 4 8
    svc_chokecount = 44,// [byte] packets choked
    svc_modellist = 45,// [strings]
    svc_soundlist = 46,// [strings]
    svc_packetentities = 47,// [...]
    svc_deltapacketentities = 48,// [...]
    svc_maxspeed = 49,// maxspeed change, for prediction
    svc_entgravity = 50,// gravity change, for prediction
    svc_setinfo = 51,// setinfo on a client
    svc_serverinfo = 52,// serverinfo
    svc_updatepl = 53
}
export enum ClcOpsT {
    clc_bad = 0,
    clc_nop = 1,
    clc_move = 3,// [[usercmd_t]
    clc_stringcmd = 4,// [string] message
    clc_delta = 5,// [byte] sequence number, requests delta compression of message
    clc_tmove = 6,// teleport request, spectator only
    clc_upload = 7
}
export const PF_MSEC = 1 << 0;
export const PF_COMMAND = 1 << 1;
export const PF_VELOCITY1 = 1 << 2;
export const PF_VELOCITY2 = 1 << 3;
export const PF_VELOCITY3 = 1 << 4;
export const PF_MODEL = 1 << 5;
export const PF_SKINNUM = 1 << 6;
export const PF_EFFECTS = 1 << 7;
export const PF_WEAPONFRAME = 1 << 8; // only sent for view player
export const PF_DEAD = 1 << 9; // don't block movement any more
export const PF_GIB = 1 << 10; // offset the view height differently
export const PF_NOGRAV = 1 << 11; // don't apply gravity for prediction
export const CM_ANGLE1 = 1 << 0;
export const CM_ANGLE3 = 1 << 1;
export const CM_FORWARD = 1 << 2;
export const CM_SIDE = 1 << 3;
export const CM_UP = 1 << 4;
export const CM_BUTTONS = 1 << 5;
export const CM_IMPULSE = 1 << 6;
export const CM_ANGLE2 = 1 << 7;
export const U_ORIGIN1 = 1 << 9;
export const U_ORIGIN2 = 1 << 10;
export const U_ORIGIN3 = 1 << 11;
export const U_ANGLE2 = 1 << 12;
export const U_FRAME = 1 << 13;
export const U_REMOVE = 1 << 14; // REMOVE this entity, don't add it
export const U_MOREBITS = 1 << 15;
export const U_ANGLE1 = 1 << 0;
export const U_ANGLE3 = 1 << 1;
export const U_MODEL = 1 << 2;
export const U_COLORMAP = 1 << 3;
export const U_SKIN = 1 << 4;
export const U_EFFECTS = 1 << 5;
export const U_SOLID = 1 << 6; // the entity should be solid for prediction
export const SND_VOLUME = 1 << 15; // a byte
export const SND_ATTENUATION = 1 << 14; // a byte
export const PRINT_LOW = 0;
export const PRINT_MEDIUM = 1;
export const PRINT_HIGH = 2;
export const PRINT_CHAT = 3; // also go to chat buffer
export const TE_SPIKE = 0;
export const TE_SUPERSPIKE = 1;
export const TE_GUNSHOT = 2;
export const TE_EXPLOSION = 3;
export const TE_TAREXPLOSION = 4;
export const TE_LIGHTNING1 = 5;
export const TE_LIGHTNING2 = 6;
export const TE_WIZSPIKE = 7;
export const TE_KNIGHTSPIKE = 8;
export const TE_LIGHTNING3 = 9;
export const TE_LAVASPLASH = 10;
export const TE_TELEPORT = 11;
export const TE_BLOOD = 12;
export const TE_LIGHTNINGBLOOD = 13;
export const MAX_CLIENTS = 32;
export const UPDATE_BACKUP = 64; // copies of entity_state_t to keep buffered
export const UPDATE_MASK = UPDATE_BACKUP - 1;
export class QwEntityStateT {
    number = 0; // edict index
    flags = 0; // nolerp, etc
    origin: Vec3 = vec3();
    angles: Vec3 = vec3();
    modelindex = 0;
    frame = 0;
    colormap = 0;
    skinnum = 0;
    effects = 0;
    alpha: number = ENTALPHA_DEFAULT;
    scale: number = ENTSCALE_DEFAULT;
    clear(): void {
        this.number = 0;
        this.flags = 0;
        this.origin[0] = this.origin[1] = this.origin[2] = 0;
        this.angles[0] = this.angles[1] = this.angles[2] = 0;
        this.modelindex = 0;
        this.frame = 0;
        this.colormap = 0;
        this.skinnum = 0;
        this.effects = 0;
        this.alpha = ENTALPHA_DEFAULT;
        this.scale = ENTSCALE_DEFAULT;
    }
    copyFrom(from: QwEntityStateT): void {
        this.number = from.number;
        this.flags = from.flags;
        this.origin[0] = from.origin[0];
        this.origin[1] = from.origin[1];
        this.origin[2] = from.origin[2];
        this.angles[0] = from.angles[0];
        this.angles[1] = from.angles[1];
        this.angles[2] = from.angles[2];
        this.modelindex = from.modelindex;
        this.frame = from.frame;
        this.colormap = from.colormap;
        this.skinnum = from.skinnum;
        this.effects = from.effects;
        this.alpha = from.alpha;
        this.scale = from.scale;
    }
}
export const MAX_PACKET_ENTITIES = 64; // doesn't count nails
export class PacketEntitiesT {
    num_entities = 0;
    entities: QwEntityStateT[] = makeArray(MAX_PACKET_ENTITIES, () => new QwEntityStateT());
}
export class QwUsercmdT {
    msec = 0; // byte
    angles: Vec3 = vec3();
    forwardmove = 0; // short
    sidemove = 0; // short
    upmove = 0; // short
    buttons = 0; // byte
    impulse = 0; // byte
}
function makeArray<T>(n: number, make: () => T): T[] {
    const a: T[] = new Array<T>(n);
    for (let i = 0; i < n; i++)
        a[i] = make();
    return a;
}
