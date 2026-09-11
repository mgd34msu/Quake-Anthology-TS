// Adapted from quake-1-re-ts and id Software Quake. GPL-2.0-or-later.
export const PROTOCOL_VERSION = 15;
export const U_MOREBITS = 1 << 0;
export const U_ORIGIN1 = 1 << 1;
export const U_ORIGIN2 = 1 << 2;
export const U_ORIGIN3 = 1 << 3;
export const U_ANGLE2 = 1 << 4;
export const U_NOLERP = 1 << 5; // don't interpolate movement
export const U_FRAME = 1 << 6;
export const U_SIGNAL = 1 << 7; // just differentiates from other updates
export const U_ANGLE1 = 1 << 8;
export const U_ANGLE3 = 1 << 9;
export const U_MODEL = 1 << 10;
export const U_COLORMAP = 1 << 11;
export const U_SKIN = 1 << 12;
export const U_EFFECTS = 1 << 13;
export const U_LONGENTITY = 1 << 14;
export const SU_VIEWHEIGHT = 1 << 0;
export const SU_IDEALPITCH = 1 << 1;
export const SU_PUNCH1 = 1 << 2;
export const SU_PUNCH2 = 1 << 3;
export const SU_PUNCH3 = 1 << 4;
export const SU_VELOCITY1 = 1 << 5;
export const SU_VELOCITY2 = 1 << 6;
export const SU_VELOCITY3 = 1 << 7;
export const SU_ITEMS = 1 << 9;
export const SU_ONGROUND = 1 << 10; // no data follows, the bit is it
export const SU_INWATER = 1 << 11; // no data follows, the bit is it
export const SU_WEAPONFRAME = 1 << 12;
export const SU_ARMOR = 1 << 13;
export const SU_WEAPON = 1 << 14;
export const SND_VOLUME = 1 << 0; // a byte
export const SND_ATTENUATION = 1 << 1; // a byte
export const SND_LOOPING = 1 << 2; // a long
export const DEFAULT_VIEWHEIGHT = 22;
export const DEFAULT_SOUND_PACKET_VOLUME = 255;
export const DEFAULT_SOUND_PACKET_ATTENUATION = 1.0;
export const GAME_COOP = 0;
export const GAME_DEATHMATCH = 1;
export enum SvcOpsT {
    svc_bad = 0,
    svc_nop = 1,
    svc_disconnect = 2,
    svc_updatestat = 3,// [byte] [long]
    svc_version = 4,// [long] server version
    svc_setview = 5,// [short] entity number
    svc_sound = 6,// <see code>
    svc_time = 7,// [float] server time
    svc_print = 8,// [string] null terminated string
    svc_stufftext = 9,// [string] stuffed into client's console buffer
    svc_setangle = 10,// [angle3] set the view angle to this absolute value
    svc_serverinfo = 11,// [long] version
    svc_lightstyle = 12,// [byte] [string]
    svc_updatename = 13,// [byte] [string]
    svc_updatefrags = 14,// [byte] [short]
    svc_clientdata = 15,// <shortbits + data>
    svc_stopsound = 16,// <see code>
    svc_updatecolors = 17,// [byte] [byte]
    svc_particle = 18,// [vec3] <variable>
    svc_damage = 19,
    svc_spawnstatic = 20,
    svc_spawnbaseline = 22,
    svc_temp_entity = 23,
    svc_setpause = 24,// [byte] on / off
    svc_signonnum = 25,// [byte]  used for the signon sequence
    svc_centerprint = 26,// [string] to put in center of the screen
    svc_killedmonster = 27,
    svc_foundsecret = 28,
    svc_spawnstaticsound = 29,// [coord3] [byte] samp [byte] vol [byte] aten
    svc_intermission = 30,// [string] music
    svc_finale = 31,// [string] music [string] text
    svc_cdtrack = 32,// [byte] track [byte] looptrack
    svc_sellscreen = 33,
    svc_cutscene = 34
}
export enum ClcOpsT {
    clc_bad = 0,
    clc_nop = 1,
    clc_disconnect = 2,
    clc_move = 3,// [usercmd_t]
    clc_stringcmd = 4
}
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
export const TE_EXPLOSION2 = 12;
export const TE_BEAM = 13;
export const PROTOCOL_NETQUAKE = 15;
export const PROTOCOL_FITZQUAKE = 666;
export const PROTOCOL_RMQ = 999;
export const PRFL_SHORTANGLE = 1 << 1;
export const PRFL_FLOATANGLE = 1 << 2;
export const PRFL_24BITCOORD = 1 << 3;
export const PRFL_FLOATCOORD = 1 << 4;
export const PRFL_EDICTSCALE = 1 << 5;
export const PRFL_ALPHASANITY = 1 << 6; // cleanup insanity with alpha
export const PRFL_INT32COORD = 1 << 7;
export const PRFL_MOREFLAGS = 1 << 31; // not supported
export const PRFL_SUPPORTED = PRFL_SHORTANGLE | PRFL_FLOATANGLE | PRFL_24BITCOORD | PRFL_FLOATCOORD | PRFL_EDICTSCALE | PRFL_INT32COORD;
export const U_STEP = U_NOLERP;
export const U_EXTEND1 = 1 << 15;
export const U_ALPHA = 1 << 16; // 1 byte, uses ENTALPHA_ENCODE, not sent if equal to baseline
export const U_FRAME2 = 1 << 17; // 1 byte, this is .frame & 0xFF00 (second byte)
export const U_MODEL2 = 1 << 18; // 1 byte, this is .modelindex & 0xFF00 (second byte)
export const U_LERPFINISH = 1 << 19; // 1 byte, 0.0-1.0 maps to 0-255, this is ent->v.nextthink - sv.time
export const U_SCALE = 1 << 20; // 1 byte, for PROTOCOL_RMQ PRFL_EDICTSCALE
export const U_UNUSED21 = 1 << 21;
export const U_UNUSED22 = 1 << 22;
export const U_EXTEND2 = 1 << 23; // another byte to follow, future expansion
export const SU_EXTEND1 = 1 << 15; // another byte to follow
export const SU_WEAPON2 = 1 << 16; // 1 byte, this is .weaponmodel & 0xFF00 (second byte)
export const SU_ARMOR2 = 1 << 17; // 1 byte, this is .armorvalue & 0xFF00 (second byte)
export const SU_AMMO2 = 1 << 18; // 1 byte, this is .currentammo & 0xFF00 (second byte)
export const SU_SHELLS2 = 1 << 19; // 1 byte, this is .ammo_shells & 0xFF00 (second byte)
export const SU_NAILS2 = 1 << 20; // 1 byte, this is .ammo_nails & 0xFF00 (second byte)
export const SU_ROCKETS2 = 1 << 21; // 1 byte, this is .ammo_rockets & 0xFF00 (second byte)
export const SU_CELLS2 = 1 << 22; // 1 byte, this is .ammo_cells & 0xFF00 (second byte)
export const SU_EXTEND2 = 1 << 23; // another byte to follow
export const SU_WEAPONFRAME2 = 1 << 24; // 1 byte, this is .weaponframe & 0xFF00 (second byte)
export const SU_WEAPONALPHA = 1 << 25; // 1 byte, alpha for weaponmodel, uses ENTALPHA_ENCODE
export const SU_EXTEND3 = 1 << 31; // another byte to follow, future expansion
export const SND_LARGEENTITY = 1 << 3; // a short + byte (instead of just a short)
export const SND_LARGESOUND = 1 << 4; // a short soundindex (instead of a byte)
export const B_LARGEMODEL = 1 << 0; // modelindex is short instead of byte
export const B_LARGEFRAME = 1 << 1; // frame is short instead of byte
export const B_ALPHA = 1 << 2; // 1 byte, uses ENTALPHA_ENCODE, not sent if ENTALPHA_DEFAULT
export const B_SCALE = 1 << 3;
export const ENTALPHA_DEFAULT = 0; // entity's alpha is "default" (i.e. water obeys r_wateralpha)
export const ENTALPHA_ZERO = 1; // entity is invisible (lowest possible alpha)
export const ENTALPHA_ONE = 255; // entity is fully opaque (highest possible alpha)
export function ENTALPHA_ENCODE(a: number): number {
    if (a === 0)
        return ENTALPHA_DEFAULT;
    const v = a * 254 + 1;
    return Q_rint(v < 1 ? 1 : v > 255 ? 255 : v);
}
export function ENTALPHA_DECODE(a: number): number {
    return a === ENTALPHA_DEFAULT ? 1.0 : (a - 1) / 254;
}
export function ENTALPHA_TOSAVE(a: number): number {
    return a === ENTALPHA_DEFAULT ? 0.0 : a === ENTALPHA_ZERO ? -1.0 : (a - 1) / 254;
}
export const ENTSCALE_DEFAULT = 16; // equivalent to float 1.0 due to byte packing
export function ENTSCALE_ENCODE(a: number): number {
    return a ? a * ENTSCALE_DEFAULT : ENTSCALE_DEFAULT;
}
export function ENTSCALE_DECODE(a: number): number {
    return a / ENTSCALE_DEFAULT;
}
export function Q_rint(x: number): number {
    return x > 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5);
}
export const svc_skybox = 37; // [string] name
export const svc_bf = 40;
export const svc_fog = 41; // [byte] density [byte] red [byte] green [byte] blue [float] time
export const svc_spawnbaseline2 = 42; // support for large modelindex, large framenum, alpha, using flags
export const svc_spawnstatic2 = 43; // support for large modelindex, large framenum, alpha, using flags
export const svc_spawnstaticsound2 = 44; // [coord3] [short] samp [byte] vol [byte] aten
export const svc_botchat = 38; // [string] text -- a bot's chat line
export const svc_spawnedmonster = 39; // [byte] count -- monsters added to the level total since the map loaded
export const svc_setviews = 45; // [byte] numviews -- splitscreen seat count
export const svc_updateping = 46; // [byte] client [short] milliseconds
export const svc_updatesocial = 47; // [byte] client [string] platform id
export const svc_updateplinfo = 48; // [byte] client [string] info string
export const svc_rawprint = 49; // [string] text, printed without notification handling
export const svc_servervars = 50; // [string] "key value key value ..." pairs
export const svc_seq = 51; // [long] sequence number
export const svc_achievement = 52; // [string] id
export const svc_chat = 53; // [string] text
export const svc_levelcompleted = 54; // no payload
export const svc_backtolobby = 55; // no payload
export const svc_localsound = 56; // [byte] flags [byte/short] sound number (SND_LARGESOUND -> short)
export const svc_prompt = 57; // [byte] op, then per op -- see PROMPT_* below
export const PROMPT_BEGIN = 0; // [string] text [byte] numchoices
export const PROMPT_CHOICE = 1; // [string] text [byte] impulse
export const PROMPT_CLEAR = 2; // no payload
