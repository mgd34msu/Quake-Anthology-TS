import type { Q3EntityState, Q3PlayerState, Q3UserCommand, Q3Trajectory, Q3Snapshot, ProtocolIdentity, Q3ProtocolIdentity } from "../../contracts/protocol.ts";
import type { Vec3 } from "../../contracts/math.ts";
import { EntityStateRecord } from "./state/entity.ts";
import type { EntityStateFields } from "./state/entity.ts";
import { PlayerStateRecord } from "./state/player.ts";
import type { PlayerStateFields, PlayerStateSlots } from "./state/player.ts";
import type { Trajectory } from "./state/trajectory.ts";
import type { Product } from "./state/product.ts";
import type { WireUserCommand } from "./message.ts";
import type { Snapshot } from "./server-message.ts";
export const Q3_PROTOCOL: Q3ProtocolIdentity = { kind: "q3", version: 68 };
export function requireQ3Protocol(protocol: ProtocolIdentity): Q3ProtocolIdentity {
  if (protocol.kind !== "q3" || protocol.version !== 68) throw new RangeError("Quake 3 source codec requires protocol 68");
  return protocol;
}
function vector(value: Vec3): Vec3 { return { ...value }; }
function trajectoryKind(type: number): Q3Trajectory["kind"] {
  switch(type) { case 0:return "stationary"; case 1:return "interpolate"; case 2:return "linear"; case 3:return "linear-stop"; case 4:return "sine"; case 5:return "gravity"; default:throw new RangeError(`Raw Q3 trajectory tag ${type} needs a mod-specific presentation binding`); }
}
function trajectoryType(kind: Q3Trajectory["kind"]): number {
  switch(kind) { case "stationary":return 0; case "interpolate":return 1; case "linear":return 2; case "linear-stop":return 3; case "sine":return 4; case "gravity":return 5; }
}
function canonicalTrajectory(value: Trajectory): Q3Trajectory { return { kind:trajectoryKind(value.type), timeMilliseconds:value.time, durationMilliseconds:value.duration, base:vector(value.base), delta:vector(value.delta) }; }
function wireTrajectory(value: Q3Trajectory): Trajectory { return { type:trajectoryType(value.kind), time:value.timeMilliseconds, duration:value.durationMilliseconds, base:vector(value.base), delta:vector(value.delta) }; }
export function toQ3UserCommand(value: WireUserCommand): Q3UserCommand { return { kind:"q3", serverTimeMilliseconds:value.serverTime, angleWords:[...value.angles], buttons:value.buttons, weapon:value.weapon, forwardMove:value.forwardmove, rightMove:value.rightmove, upMove:value.upmove }; }
export function fromQ3UserCommand(value: Q3UserCommand): WireUserCommand { return { serverTime:value.serverTimeMilliseconds, angles:[...value.angleWords], buttons:value.buttons, weapon:value.weapon, forwardmove:value.forwardMove, rightmove:value.rightMove, upmove:value.upMove }; }
export function toQ3EntityState(value: Readonly<EntityStateFields>): Q3EntityState {
 return {
  number:value.number,
  type:value.eType,
  flags:value.eFlags,
  timeMilliseconds:value.time,
  time2Milliseconds:value.time2,
  otherEntityNumber:value.otherEntityNum,
  otherEntityNumber2:value.otherEntityNum2,
  groundEntityNumber:value.groundEntityNum,
  constantLight:value.constantLight,
  loopSound:value.loopSound,
  modelIndex:value.modelindex,
  modelIndex2:value.modelindex2,
  clientNumber:value.clientNum,
  frame:value.frame,
  solid:value.solid,
  event:value.event,
  eventParameter:value.eventParm,
  powerups:value.powerups,
  weapon:value.weapon,
  legsAnimation:value.legsAnim,
  torsoAnimation:value.torsoAnim,
  generic1:value.generic1,
  position:canonicalTrajectory(value.pos),angularPosition:canonicalTrajectory(value.apos),
  origin:vector(value.origin),origin2:vector(value.origin2),angles:vector(value.angles),angles2:vector(value.angles2) };
}
export function fromQ3EntityState(value: Q3EntityState): EntityStateRecord<number> {
 const result=new EntityStateRecord<number>(0);
 result.number=value.number;
 result.eType=value.type;
 result.eFlags=value.flags;
 result.time=value.timeMilliseconds;
 result.time2=value.time2Milliseconds;
 result.otherEntityNum=value.otherEntityNumber;
 result.otherEntityNum2=value.otherEntityNumber2;
 result.groundEntityNum=value.groundEntityNumber;
 result.constantLight=value.constantLight;
 result.loopSound=value.loopSound;
 result.modelindex=value.modelIndex;
 result.modelindex2=value.modelIndex2;
 result.clientNum=value.clientNumber;
 result.frame=value.frame;
 result.solid=value.solid;
 result.event=value.event;
 result.eventParm=value.eventParameter;
 result.powerups=value.powerups;
 result.weapon=value.weapon;
 result.legsAnim=value.legsAnimation;
 result.torsoAnim=value.torsoAnimation;
 result.generic1=value.generic1;
 result.pos=wireTrajectory(value.position);result.apos=wireTrajectory(value.angularPosition);
 result.origin=vector(value.origin);result.origin2=vector(value.origin2);result.angles=vector(value.angles);result.angles2=vector(value.angles2);
 return result;
}
export function toQ3PlayerState(value: Readonly<PlayerStateFields>): Q3PlayerState {
 return {
  commandTimeMilliseconds:value.commandTime,
  movementType:value.pmType,
  bobCycle:value.bobCycle,
  movementFlags:value.pmFlags,
  movementTimeMilliseconds:value.pmTime,
  weaponTimeMilliseconds:value.weaponTime,
  gravity:value.gravity,
  speed:value.speed,
  groundEntityNumber:value.groundEntityNum,
  legsTimerMilliseconds:value.legsTimer,
  legsAnimation:value.legsAnim,
  torsoTimerMilliseconds:value.torsoTimer,
  torsoAnimation:value.torsoAnim,
  movementDirection:value.movementDir,
  flags:value.eFlags,
  eventSequence:value.eventSequence,
  externalEvent:value.externalEvent,
  externalEventParameter:value.externalEventParm,
  externalEventTimeMilliseconds:value.externalEventTime,
  clientNumber:value.clientNum,
  weapon:value.weapon,
  weaponState:value.weaponState,
  viewHeight:value.viewheight,
  damageEvent:value.damageEvent,
  damageYaw:value.damageYaw,
  damagePitch:value.damagePitch,
  damageCount:value.damageCount,
  generic1:value.generic1,
  loopSound:value.loopSound,
  jumpPadEntity:value.jumppadEnt,
  pingMilliseconds:value.ping,
  movementFrameCount:value.pmoveFramecount,
  jumpPadFrame:value.jumppadFrame,
  entityEventSequence:value.entityEventSequence,
  origin:vector(value.origin),
  velocity:vector(value.velocity),
  grapplePoint:vector(value.grapplePoint),
  viewAngles:vector(value.viewangles),
  stats:Array.from(value.stats.copy()),
  persistent:Array.from(value.persistant.copy()),
  powerups:Array.from(value.powerups.copy()),
  ammo:Array.from(value.ammo.copy()),
  deltaAngleWords:[value.deltaAngles.x,value.deltaAngles.y,value.deltaAngles.z],
  events:[value.events.get(0),value.events.get(1)],eventParameters:[value.eventParms.get(0),value.eventParms.get(1)] };
}
function assignSlots(target:PlayerStateSlots, values:readonly number[]):void {
 if(values.length!==target.length)throw new RangeError(`Q3 wire needs ${target.length} source slots, received ${values.length}`);
 values.forEach((value,index)=>target.set(index,value));
}
export function fromQ3PlayerState(value: Q3PlayerState, product: Product): PlayerStateRecord<number,number,number> {
 const result=new PlayerStateRecord(product,value.movementType,value.weapon,value.weaponState);
 result.commandTime=value.commandTimeMilliseconds;
 result.pmType=value.movementType;
 result.bobCycle=value.bobCycle;
 result.pmFlags=value.movementFlags;
 result.pmTime=value.movementTimeMilliseconds;
 result.weaponTime=value.weaponTimeMilliseconds;
 result.gravity=value.gravity;
 result.speed=value.speed;
 result.groundEntityNum=value.groundEntityNumber;
 result.legsTimer=value.legsTimerMilliseconds;
 result.legsAnim=value.legsAnimation;
 result.torsoTimer=value.torsoTimerMilliseconds;
 result.torsoAnim=value.torsoAnimation;
 result.movementDir=value.movementDirection;
 result.eFlags=value.flags;
 result.eventSequence=value.eventSequence;
 result.externalEvent=value.externalEvent;
 result.externalEventParm=value.externalEventParameter;
 result.externalEventTime=value.externalEventTimeMilliseconds;
 result.clientNum=value.clientNumber;
 result.weapon=value.weapon;
 result.weaponState=value.weaponState;
 result.viewheight=value.viewHeight;
 result.damageEvent=value.damageEvent;
 result.damageYaw=value.damageYaw;
 result.damagePitch=value.damagePitch;
 result.damageCount=value.damageCount;
 result.generic1=value.generic1;
 result.loopSound=value.loopSound;
 result.jumppadEnt=value.jumpPadEntity;
 result.ping=value.pingMilliseconds;
 result.pmoveFramecount=value.movementFrameCount;
 result.jumppadFrame=value.jumpPadFrame;
 result.entityEventSequence=value.entityEventSequence;
 result.origin=vector(value.origin);
 result.velocity=vector(value.velocity);
 result.grapplePoint=vector(value.grapplePoint);
 result.viewangles=vector(value.viewAngles);
 assignSlots(result.stats,value.stats);
 assignSlots(result.persistant,value.persistent);
 assignSlots(result.powerups,value.powerups);
 assignSlots(result.ammo,value.ammo);
 result.deltaAngles={x:value.deltaAngleWords[0],y:value.deltaAngleWords[1],z:value.deltaAngleWords[2]};
 assignSlots(result.events,value.events);assignSlots(result.eventParms,value.eventParameters);
 return result;
}
export function toQ3Snapshot(value: Snapshot, pingMilliseconds: number, serverCommandCount: number): Q3Snapshot {
 return {kind:"q3",protocol:Q3_PROTOCOL,flags:value.flags,pingMilliseconds,serverTimeMilliseconds:value.serverTime,areaMask:value.areaMask.slice(),player:toQ3PlayerState(value.playerState),entities:value.entities.map(toQ3EntityState),serverCommandCount,serverCommandSequence:value.serverCommandNumber};
}
