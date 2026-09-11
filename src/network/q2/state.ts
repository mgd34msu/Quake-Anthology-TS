// Quake II / q2proto algorithms ported from quake-2-re-ts and original id Software sources. GPL-2.0-or-later.
export type Vec3 = Float32Array;
export const MAX_EDICTS = 1024;
export enum PmTypeT {
    PM_NORMAL,
    PM_SPECTATOR,
    PM_DEAD,
    PM_GIB,
    PM_FREEZE,
    PM_GRAPPLE = 5,
    PM_NOCLIP = 6
}
export class PmoveStateT {
    delta_anglesF = new Float32Array(3);
    deltaAngleEncoding: "short" | "float" = "short";
    pm_type = 0;
    origin: Int32Array = new Int32Array(3);
    velocity: Int32Array = new Int32Array(3);
    pm_flags = 0;
    pm_time = 0;
    gravity = 0;
    delta_angles: Int16Array = new Int16Array(3);
    viewheight = 0;
    originF: Vec3 = new Float32Array(3);
    velocityF: Vec3 = new Float32Array(3);
}
export class UsercmdT {
    msec = 0;
    buttons = 0;
    angles: Int16Array = new Int16Array(3);
    forwardmove = 0;
    sidemove = 0;
    upmove = 0;
    impulse = 0;
    lightlevel = 0;
}
export const RF_BEAM = 128;
export const MAX_STATS = 32;
export const MAX_STATS_STORAGE = 64;
export function ANGLE2SHORT(x: number): number {
    return Math.trunc((x * 65536) / 360) & 65535;
}
export function SHORT2ANGLE(x: number): number {
    return x * (360.0 / 65536);
}
export class EntityStateT {
    number = 0;
    origin: Vec3 = new Float32Array(3);
    angles: Vec3 = new Float32Array(3);
    old_origin: Vec3 = new Float32Array(3);
    modelindex = 0;
    modelindex2 = 0;
    modelindex3 = 0;
    modelindex4 = 0;
    frame = 0;
    skinnum = 0;
    effects = 0;
    renderfx = 0;
    solid = 0;
    sound = 0;
    event = 0;
    alpha = 0;
    scale = 0;
    instance_bits = 0;
    loop_volume = 0;
    loop_attenuation = 0;
    owner = 0;
    old_frame = 0;
    morefx = 0;
}
/** Native Q2PRO fog words remain encoded; gameplay/render adapters own interpretation. */
export interface Q2ProPlayerFog {
    color: readonly [
        number,
        number,
        number
    ];
    density: number;
    skyFactor: number;
    heightDensity: number;
    heightFalloff: number;
    heightStartColor: readonly [
        number,
        number,
        number
    ];
    heightEndColor: readonly [
        number,
        number,
        number
    ];
    heightStartDistance: number;
    heightEndDistance: number;
}
export class PlayerStateT {
    clientnum = 0;
    q2proFog: Q2ProPlayerFog = { color: [0, 0, 0], density: 0, skyFactor: 0, heightDensity: 0, heightFalloff: 0, heightStartColor: [0, 0, 0], heightEndColor: [0, 0, 0], heightStartDistance: 0, heightEndDistance: 0 };
    pmove: PmoveStateT = new PmoveStateT();
    viewangles: Vec3 = new Float32Array(3);
    viewoffset: Vec3 = new Float32Array(3);
    kick_angles: Vec3 = new Float32Array(3);
    gunangles: Vec3 = new Float32Array(3);
    gunoffset: Vec3 = new Float32Array(3);
    gunindex = 0;
    gunskin = 0;
    gunframe = 0;
    gunrate = 0;
    blend: Float32Array = new Float32Array(4);
    damage_blend: Float32Array = new Float32Array(4);
    fov = 0;
    rdflags = 0;
    stats: Int16Array = new Int16Array(MAX_STATS_STORAGE);
    team_id = 0;
}
export function vec3(x = 0, y = 0, z = 0): Vec3 { return new Float32Array([x, y, z]); }
export function VectorCopy(a: Vec3, b: Vec3): void { b.set(a.subarray(0, 3)); }
export function DotProduct(a: Vec3, b: Vec3): number { return readElement(a, 0) * readElement(b, 0) + readElement(a, 1) * readElement(b, 1) + readElement(a, 2) * readElement(b, 2); }
export function readElement<T>(array: {
    readonly [index: number]: T;
}, index: number): T {
    const value = array[index];
    if (value === undefined)
        throw new RangeError("Q2 field index outside storage: " + index);
    return value;
}
