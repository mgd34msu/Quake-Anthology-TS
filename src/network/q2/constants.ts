// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
export const PROTOCOL_VERSION = 34;
export const PROTOCOL_VERSION_RERELEASE = 1038;
export const PROTOCOL_VERSION_RERELEASE_CLASSIC = 4038;
export const PROTOCOL_VERSION_R1Q2 = 35;
export const PROTOCOL_VERSION_R1Q2_MINIMUM = 1903;
export const PROTOCOL_VERSION_R1Q2_UCMD = 1904;
export const PROTOCOL_VERSION_R1Q2_LONG_SOLID = 1905;
export const PROTOCOL_VERSION_R1Q2_CURRENT = 1905;
export const PROTOCOL_VERSION_Q2PRO = 36;
export const PROTOCOL_VERSION_Q2PRO_MINIMUM = 1015;
export const PROTOCOL_VERSION_Q2PRO_SERVER_STATE = 1019;
export const PROTOCOL_VERSION_Q2PRO_CURRENT = PROTOCOL_VERSION_Q2PRO_SERVER_STATE;
export const EPS_GUNOFFSET = 1 << 0;
export const EPS_GUNANGLES = 1 << 1;
export const EPS_M_VELOCITY2 = 1 << 2;
export const EPS_M_ORIGIN2 = 1 << 3;
export const EPS_VIEWANGLE2 = 1 << 4;
export const EPS_STATS = 1 << 5;
export const SVC_ZPACKET = 21;
export const PORT_MASTER = 27900;
export const PORT_CLIENT = 27901;
export const PORT_SERVER = 27910;
export const UPDATE_BACKUP = 16;
export const UPDATE_MASK = UPDATE_BACKUP - 1;
export enum SvcOpsT {
    svc_bad,
    svc_muzzleflash,
    svc_muzzleflash2,
    svc_temp_entity,
    svc_layout,
    svc_inventory,
    svc_nop,
    svc_disconnect,
    svc_reconnect,
    svc_sound,
    svc_print,
    svc_stufftext,
    svc_serverdata,
    svc_configstring,
    svc_spawnbaseline,
    svc_centerprint,
    svc_download,
    svc_playerinfo,
    svc_packetentities,
    svc_deltapacketentities,
    svc_frame
}
export enum ClcOpsT {
    clc_bad,
    clc_nop,
    clc_move,
    clc_userinfo,
    clc_stringcmd,
    clc_r1q2_setting = 5,
    clc_q2pro_move_nodelta = 10,
    clc_q2pro_move_batched,
    clc_q2pro_userinfo_delta
}
export const CM_ANGLE1 = 1 << 0;
export const CM_ANGLE2 = 1 << 1;
export const CM_ANGLE3 = 1 << 2;
export const CM_FORWARD = 1 << 3;
export const CM_SIDE = 1 << 4;
export const CM_UP = 1 << 5;
export const CM_BUTTONS = 1 << 6;
export const CM_IMPULSE = 1 << 7;
export const U_ORIGIN1 = 1 << 0;
export const U_ORIGIN2 = 1 << 1;
export const U_ANGLE2 = 1 << 2;
export const U_ANGLE3 = 1 << 3;
export const U_FRAME8 = 1 << 4;
export const U_EVENT = 1 << 5;
export const U_REMOVE = 1 << 6;
export const U_MOREBITS1 = 1 << 7;
export const U_NUMBER16 = 1 << 8;
export const U_ORIGIN3 = 1 << 9;
export const U_ANGLE1 = 1 << 10;
export const U_MODEL = 1 << 11;
export const U_RENDERFX8 = 1 << 12;
export const U_EFFECTS8 = 1 << 14;
export const U_MOREBITS2 = 1 << 15;
export const U_SKIN8 = 1 << 16;
export const U_FRAME16 = 1 << 17;
export const U_RENDERFX16 = 1 << 18;
export const U_EFFECTS16 = 1 << 19;
export const U_MODEL2 = 1 << 20;
export const U_MODEL3 = 1 << 21;
export const U_MODEL4 = 1 << 22;
export const U_MOREBITS3 = 1 << 23;
export const U_OLDORIGIN = 1 << 24;
export const U_SKIN16 = 1 << 25;
export const U_SOUND = 1 << 26;
export const U_SOLID = 1 << 27;
export const PS_M_TYPE = 1 << 0;
export const PS_M_ORIGIN = 1 << 1;
export const PS_M_VELOCITY = 1 << 2;
export const PS_M_TIME = 1 << 3;
export const PS_M_FLAGS = 1 << 4;
export const PS_M_GRAVITY = 1 << 5;
export const PS_M_DELTA_ANGLES = 1 << 6;
export const PS_VIEWOFFSET = 1 << 7;
export const PS_VIEWANGLES = 1 << 8;
export const PS_KICKANGLES = 1 << 9;
export const PS_BLEND = 1 << 10;
export const PS_FOV = 1 << 11;
export const PS_WEAPONINDEX = 1 << 12;
export const PS_WEAPONFRAME = 1 << 13;
export const PS_RDFLAGS = 1 << 14;
export const PS_RR_VIEWHEIGHT = 1 << 15;
export const PORT_ANY = -1;
export const MAX_MSGLEN = 1400;
export const PACKET_HEADER = 10;
export const ERR_FATAL = 0;
export const ERR_DROP = 1;
export const ERR_QUIT = 2;
export class ComError extends Error {
    code: number;
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.name = "ComError";
    }
}
