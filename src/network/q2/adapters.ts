import type { Vec3, Vec4 } from '../../contracts/math.ts';
import type { Q2EntityState, Q2RereleaseEntityState, Q2PlayerState, Q2RereleasePlayerState, Q2UserCommand, Q2RereleaseUserCommand } from '../../contracts/protocol.ts';
import { ANGLE2SHORT, SHORT2ANGLE, EntityStateT, PlayerStateT, UsercmdT, readElement } from './state.ts';
function vector(value: ArrayLike<number>): Vec3 { return { x: readElement(value, 0), y: readElement(value, 1), z: readElement(value, 2) }; }
function color(value: ArrayLike<number>): Vec4 { return { x: readElement(value, 0), y: readElement(value, 1), z: readElement(value, 2), w: readElement(value, 3) }; }
function triple(value: ArrayLike<number>): [
    number,
    number,
    number
] { return [readElement(value, 0), readElement(value, 1), readElement(value, 2)]; }
function setVector(target: Float32Array, value: Vec3): void { target.set([value.x, value.y, value.z]); }
function setColor(target: Float32Array, value: Vec4): void { target.set([value.x, value.y, value.z, value.w]); }
export function fromQ2Entity(state: Q2EntityState | Q2RereleaseEntityState): EntityStateT {
    const wire = new EntityStateT();
    wire.number = state.number;
    setVector(wire.origin, state.origin);
    setVector(wire.angles, state.angles);
    setVector(wire.old_origin, state.oldOrigin);
    [wire.modelindex, wire.modelindex2, wire.modelindex3, wire.modelindex4] = state.modelIndexes;
    wire.frame = state.frame;
    wire.skinnum = state.skin;
    wire.renderfx = state.renderEffects;
    wire.solid = state.solid;
    wire.sound = state.sound;
    wire.event = state.event;
    if (typeof state.effects === 'bigint') {
        wire.effects = Number(BigInt.asUintN(32, state.effects));
        wire.morefx = Number(BigInt.asUintN(32, state.effects >> 32n));
    }
    else
        wire.effects = state.effects;
    if ('alpha' in state) {
        wire.alpha = state.alpha;
        wire.scale = state.scale;
        wire.instance_bits = state.instanceBits;
        wire.loop_volume = state.loopVolume;
        wire.loop_attenuation = state.loopAttenuation;
        wire.owner = state.owner;
        wire.old_frame = state.oldFrame;
    }
    return wire;
}
export function toQ2Entity(wire: EntityStateT): Q2EntityState {
    return { number: wire.number, origin: vector(wire.origin), angles: vector(wire.angles), oldOrigin: vector(wire.old_origin), modelIndexes: [wire.modelindex, wire.modelindex2, wire.modelindex3, wire.modelindex4], frame: wire.frame, skin: wire.skinnum, effects: wire.effects >>> 0, renderEffects: wire.renderfx >>> 0, solid: wire.solid >>> 0, sound: wire.sound, event: wire.event };
}
export function toQ2RereleaseEntity(wire: EntityStateT): Q2RereleaseEntityState {
    return { ...toQ2Entity(wire), effects: BigInt(wire.effects >>> 0) | (BigInt(wire.morefx >>> 0) << 32n), alpha: wire.alpha, scale: wire.scale, instanceBits: wire.instance_bits, loopVolume: wire.loop_volume, loopAttenuation: wire.loop_attenuation, owner: wire.owner, oldFrame: wire.old_frame };
}
export function fromQ2Player(state: Q2PlayerState | Q2RereleasePlayerState): PlayerStateT {
    const wire = new PlayerStateT();
    wire.pmove.pm_type = state.movement.type;
    wire.pmove.pm_flags = state.movement.flags;
    wire.pmove.gravity = state.movement.gravity;
    setVector(wire.viewangles, state.viewAngles);
    setVector(wire.viewoffset, state.viewOffset);
    setVector(wire.kick_angles, state.kickAngles);
    setVector(wire.gunangles, state.gunAngles);
    setVector(wire.gunoffset, state.gunOffset);
    wire.gunindex = state.gunIndex;
    wire.gunframe = state.gunFrame;
    wire.fov = state.fov;
    wire.rdflags = state.renderFlags;
    if (state.stats.length > wire.stats.length)
        throw new RangeError('Q2 wire has at most 64 player stats');
    wire.stats.set(state.stats);
    if (state.kind === 'q2-classic') {
        wire.pmove.origin.set(state.movement.originEighths);
        wire.pmove.velocity.set(state.movement.velocityEighths);
        wire.pmove.delta_angles.set(state.movement.deltaAngleShorts);
        wire.pmove.pm_time = state.movement.timeEightMilliseconds;
        setColor(wire.blend, state.blend);
    }
    else {
        setVector(wire.pmove.delta_anglesF, state.movement.deltaAngles);
        wire.pmove.deltaAngleEncoding = "float";
        setVector(wire.pmove.originF, state.movement.origin);
        setVector(wire.pmove.velocityF, state.movement.velocity);
        wire.pmove.pm_time = state.movement.timeMilliseconds;
        wire.pmove.viewheight = state.movement.viewHeight;
        wire.pmove.delta_angles.set([ANGLE2SHORT(state.movement.deltaAngles.x), ANGLE2SHORT(state.movement.deltaAngles.y), ANGLE2SHORT(state.movement.deltaAngles.z)]);
        setColor(wire.blend, state.screenBlend);
        setColor(wire.damage_blend, state.damageBlend);
        wire.gunskin = state.gunSkin;
        wire.gunrate = state.gunRate;
        wire.team_id = state.teamId;
    }
    return wire;
}
function playerView(wire: PlayerStateT) { return { viewAngles: vector(wire.viewangles), viewOffset: vector(wire.viewoffset), kickAngles: vector(wire.kick_angles), gunAngles: vector(wire.gunangles), gunOffset: vector(wire.gunoffset), gunIndex: wire.gunindex, gunFrame: wire.gunframe, fov: wire.fov, renderFlags: wire.rdflags, stats: Array.from(wire.stats) }; }
export function toQ2Player(wire: PlayerStateT): Q2PlayerState {
    return { kind: 'q2-classic', ...playerView(wire), stats: Array.from(wire.stats.subarray(0, 32)), movement: { kind: 'q2-classic', type: wire.pmove.pm_type, originEighths: triple(wire.pmove.origin), velocityEighths: triple(wire.pmove.velocity), flags: wire.pmove.pm_flags, timeEightMilliseconds: wire.pmove.pm_time, gravity: wire.pmove.gravity, deltaAngleShorts: triple(wire.pmove.delta_angles) }, blend: color(wire.blend) };
}
export function toQ2RereleasePlayer(wire: PlayerStateT): Q2RereleasePlayerState {
    const angles = vector(wire.pmove.delta_angles);
    return { kind: 'q2-rerelease', ...playerView(wire), movement: { kind: 'q2-rerelease', type: wire.pmove.pm_type, origin: vector(wire.pmove.originF), velocity: vector(wire.pmove.velocityF), flags: wire.pmove.pm_flags, timeMilliseconds: wire.pmove.pm_time, gravity: wire.pmove.gravity, deltaAngles: wire.pmove.deltaAngleEncoding === "float" ? vector(wire.pmove.delta_anglesF) : { x: SHORT2ANGLE(angles.x), y: SHORT2ANGLE(angles.y), z: SHORT2ANGLE(angles.z) }, viewHeight: wire.pmove.viewheight }, gunSkin: wire.gunskin, gunRate: wire.gunrate, screenBlend: color(wire.blend), damageBlend: color(wire.damage_blend), teamId: wire.team_id };
}
export function fromQ2Command(command: Q2UserCommand | Q2RereleaseUserCommand): UsercmdT {
    const wire = new UsercmdT();
    wire.msec = command.milliseconds;
    wire.forwardmove = command.forwardMove;
    wire.sidemove = command.sideMove;
    wire.buttons = command.buttons;
    if (command.kind === 'q2-classic') {
        wire.angles.set(command.angleShorts);
        wire.upmove = command.upMove;
        wire.impulse = command.impulse;
        wire.lightlevel = command.lightLevel;
    }
    else {
        wire.angles.set([ANGLE2SHORT(command.angles.x), ANGLE2SHORT(command.angles.y), ANGLE2SHORT(command.angles.z)]);
        wire.serverFrame = command.serverFrame;
    }
    return wire;
}
export function toQ2Command(wire: UsercmdT): Q2UserCommand {
    return { kind: 'q2-classic', milliseconds: wire.msec, angleShorts: triple(wire.angles), forwardMove: wire.forwardmove, sideMove: wire.sidemove, upMove: wire.upmove, buttons: wire.buttons, impulse: wire.impulse, lightLevel: wire.lightlevel };
}
export function toQ2RereleaseCommand(wire: UsercmdT, serverFrame: number): Q2RereleaseUserCommand {
    const angles = vector(wire.angles);
    return { kind: 'q2-rerelease', milliseconds: wire.msec, angles: { x: SHORT2ANGLE(angles.x), y: SHORT2ANGLE(angles.y), z: SHORT2ANGLE(angles.z) }, forwardMove: wire.forwardmove, sideMove: wire.sidemove, buttons: wire.buttons, serverFrame };
}
