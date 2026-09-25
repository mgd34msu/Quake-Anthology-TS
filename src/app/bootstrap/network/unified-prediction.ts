import type { ActorId } from '../../../contracts/identity.ts';
import type { MovementState, MovementProfile, ArsenalState, WeaponState, AnimationState, ActorAnimationState } from '../../../contracts/movement.ts';
import type { TraceHit } from '../../../contracts/scene.ts';
import type { Bounds } from '../../../contracts/math.ts';
import type { SpatialActor } from '../../../world/spatial/index.ts';
import type { SharedSimulation } from '../simulation/runtime.ts';
import type { MovementPredictionSnapshot } from '../simulation/prediction/types.ts';
import { copyPredictionSnapshot } from '../simulation/prediction/step.ts';
import { encodeCheckpointValue, decodeCheckpointValue, SaveReader, namespaced } from '../../../persistence/value.ts';
import { readClock, readNumeric, readTime } from '../../../persistence/shared.ts';
import { readInventoryEntry } from '../../../persistence/save-image.ts';
import { actor, wireActor, vector as readVector } from './unified-frame-values.ts';
import type { UnifiedIdentityDecoder } from './unified-types.ts';

/** Admitted-player movement only. No save image, weapon VM state, or other player's inventory. */
export interface UnifiedPredictionProjection extends Omit<MovementPredictionSnapshot, 'q3Arsenal'> {
  readonly actor: ActorId;
  readonly profile: MovementProfile;
  readonly standingBounds: Bounds;
  readonly standingViewHeight: number;
  readonly collisions: readonly SpatialActor[];
}
function readClientOutputs(r: SaveReader): import('../../../contracts/mod-client-outputs.ts').ModClientMovementOutputs {
  return { ...(r.field('viewOffset').value === undefined ? {} : { viewOffset: readVector(r.field('viewOffset')) }),
    ...(r.field('mode').value === undefined ? {} : { mode: r.field('mode').choice('normal','noclip','freeze') }),
    ...(r.field('stance').value === undefined ? {} : { stance: r.field('stance').boolean() }) };
}
function readBounds(r: SaveReader): Bounds { return { min: readVector(r.field('min')), max: readVector(r.field('max')) }; }
function triple(r: SaveReader): readonly [number,number,number] {
  const values=r.list(v=>v.finite()), [x,y,z]=values;
  if(values.length!==3||x===undefined||y===undefined||z===undefined)return r.fail('expected three numbers');
  return [x,y,z];
}
function writeHit(hit: TraceHit) { return hit.kind==='actor'?{kind:hit.kind,actor:wireActor(hit.actor)}:hit; }
function readHit(r: SaveReader, identity: UnifiedIdentityDecoder): TraceHit {
  switch(r.field('kind').choice('none','world','actor')){
    case 'none': return {kind:'none'};
    case 'world': return {kind:'world',model:r.field('model').integer(0)};
    case 'actor': return {kind:'actor',actor:actor(r.field('actor'),identity)};
  }
}
function writeMovement(state: MovementState) {
  if(state.kind==='q3')return {...state,ground:writeHit(state.ground),jumpPad:state.jumpPad===null?null:wireActor(state.jumpPad)};
  return state.kind==='q1-netquake'||state.kind==='q1-quakeworld'?{...state,ground:writeHit(state.ground)}:state;
}
function readMovement(reader: SaveReader, identity: UnifiedIdentityDecoder): MovementState {
  const n = (key: string) => reader.field(key).finite(), v = (key: string) => readVector(reader.field(key));
  switch (reader.field("kind").choice("q1-netquake", "q1-quakeworld", "q2-classic", "q2-rerelease", "q3")) {
    case "q1-netquake": return { kind: "q1-netquake", origin: v("origin"), velocity: v("velocity"), angles: v("angles"), oldOrigin: v("oldOrigin"), angularVelocity: v("angularVelocity"),
      viewAngles: v("viewAngles"), punchAngles: v("punchAngles"), moveType: n("moveType"), flags: n("flags"), ground: readHit(reader.field("ground"), identity), waterLevel: n("waterLevel"), waterType: n("waterType"),
      teleportTimeSeconds: n("teleportTimeSeconds"), waterJumpDirection: v("waterJumpDirection"), idealPitch: n("idealPitch"), fixAngle: reader.field("fixAngle").boolean(), health: n("health") };
    case "q1-quakeworld": return { kind: "q1-quakeworld", origin: v("origin"), velocity: v("velocity"), angles: v("angles"), oldButtons: n("oldButtons"), waterJumpTimeSeconds: n("waterJumpTimeSeconds"),
      dead: reader.field("dead").boolean(), spectator: n("spectator"), ground: readHit(reader.field("ground"), identity) };
    case "q2-classic": return { kind: "q2-classic", type: n("type"), originEighths: triple(reader.field("originEighths")), velocityEighths: triple(reader.field("velocityEighths")), flags: n("flags"),
      timeEightMilliseconds: n("timeEightMilliseconds"), gravity: n("gravity"), deltaAngleShorts: triple(reader.field("deltaAngleShorts")) };
    case "q2-rerelease": return { kind: "q2-rerelease", type: n("type"), origin: v("origin"), velocity: v("velocity"), flags: n("flags"), timeMilliseconds: n("timeMilliseconds"), gravity: n("gravity"), deltaAngles: v("deltaAngles"), viewHeight: n("viewHeight") };
    case "q3": return { kind: "q3", commandTimeMilliseconds: n("commandTimeMilliseconds"), movementType: n("movementType"), bobCycle: n("bobCycle"), movementFlags: n("movementFlags"), movementTimeMilliseconds: n("movementTimeMilliseconds"),
      origin: v("origin"), velocity: v("velocity"), gravity: n("gravity"), speed: n("speed"), deltaAngleWords: triple(reader.field("deltaAngleWords")), movementDirection: n("movementDirection"), grapplePoint: v("grapplePoint"), flags: n("flags"),
      viewAngles: v("viewAngles"), viewHeight: n("viewHeight"), ground: readHit(reader.field("ground"), identity), predictableEventSequence: n("predictableEventSequence"),
      jumpPad: reader.field("jumpPad").nullable(value => actor(value, identity)), movementFrame: n("movementFrame"), jumpPadFrame: n("jumpPadFrame") };
  }
}
function readWeapon(reader: SaveReader): WeaponState {
  switch (reader.field("kind").choice("q1", "q2", "q3")) {
    case "q1": return { kind: "q1", frame: reader.field("frame").finite(), attackFinishedSeconds: reader.field("attackFinishedSeconds").finite(), sourceWeapon: reader.field("sourceWeapon").finite() };
    case "q2": return { kind: "q2", gunFrame: reader.field("gunFrame").finite(), state: reader.field("state").finite(), pendingWeapon: reader.field("pendingWeapon").nullable(namespaced), machinegunShots: reader.field("machinegunShots").finite(), grenadeTime: readTime(reader.field("grenadeTime")), grenadeBlewUp: reader.field("grenadeBlewUp").boolean() };
    case "q3": return { kind: "q3", sourceWeapon: reader.field("sourceWeapon").finite(), state: reader.field("state").finite(), timeMilliseconds: reader.field("timeMilliseconds").finite() };
  }
}
function readArsenal(reader: SaveReader): ArsenalState {
  return { provider: namespaced(reader.field("provider")), activeWeapon: reader.field("activeWeapon").nullable(namespaced), state: readWeapon(reader.field("state")), ammo: reader.field("ammo").list(readInventoryEntry) };
}
function readAnimation(reader: SaveReader): AnimationState {
  switch (reader.field("kind").choice("q1", "q2", "q3")) {
    case "q1": return { kind: "q1", frame: reader.field("frame").finite(), nextFrameSeconds: reader.field("nextFrameSeconds").finite() };
    case "q2": return { kind: "q2", frame: reader.field("frame").finite(), endFrame: reader.field("endFrame").finite(), priority: reader.field("priority").finite(), duck: reader.field("duck").boolean(), run: reader.field("run").boolean() };
    case "q3": return { kind: "q3", legs: reader.field("legs").finite(), torso: reader.field("torso").finite(), legsTimerMilliseconds: reader.field("legsTimerMilliseconds").finite(), torsoTimerMilliseconds: reader.field("torsoTimerMilliseconds").finite() };
  }
}
function readActorAnimation(reader: SaveReader): ActorAnimationState { return { provider: namespaced(reader.field("provider")), state: readAnimation(reader.field("state")) }; }
function readProfile(r: SaveReader): MovementProfile {
  const base={id:namespaced(r.field('id')),clock:readClock(r.field('clock')),numeric:readNumeric(r.field('numeric'))};
  const kind=r.field('kind').choice('q1-netquake','q1-quakeworld','q2-classic','q2-rerelease','q3');
  if(base.clock.kind!==kind)return r.fail('movement clock differs from profile');
  if(kind==='q1-netquake'||kind==='q1-quakeworld'){
    const p=r.field('parameters'), n=(key:string)=>p.field(key).finite();
    const parameters={gravity:n('gravity'),stopSpeed:n('stopSpeed'),maxSpeed:n('maxSpeed'),spectatorMaxSpeed:n('spectatorMaxSpeed'),accelerate:n('accelerate'),airAccelerate:n('airAccelerate'),waterAccelerate:n('waterAccelerate'),friction:n('friction'),waterFriction:n('waterFriction'),entityGravity:n('entityGravity')};
    return kind==='q1-quakeworld'?{...base,kind,parameters}:{...base,kind,parameters,edition:r.field('edition').choice('classic','rerelease','quake64'),edgeFriction:r.field('edgeFriction').finite(),noClipAngleHack:r.field('noClipAngleHack').boolean()};
  }
  if(kind==='q2-classic')return {...base,kind,airAccelerate:r.field('airAccelerate').finite(),snapInitial:r.field('snapInitial').boolean(),...(r.field('strafejumpHack').value===undefined?{}:{strafejumpHack:r.field('strafejumpHack').boolean()})};
  if(kind==='q2-rerelease')return {...base,kind,airAccelerate:r.field('airAccelerate').finite(),n64Physics:r.field('n64Physics').boolean()};
  return {...base,kind,product:r.field('product').choice('baseq3','missionpack'),fixedMilliseconds:r.field('fixedMilliseconds').nullable(v=>v.finite()),noFootsteps:r.field('noFootsteps').boolean()};
}
function readCollision(r: SaveReader, identity: UnifiedIdentityDecoder): SpatialActor {
  const b=r.field('body'), s=b.field('state'),c=r.field('collision'),shape=c.field('shape'),kind=shape.field('kind').choice('box','capsule','model');
  return {body:{actor:actor(b.field('actor'),identity),state:{origin:readVector(s.field('origin')),angles:readVector(s.field('angles')),velocity:readVector(s.field('velocity')),bounds:readBounds(s.field('bounds')),ground:s.field('ground').nullable(v=>actor(v,identity))},linkCount:b.field('linkCount').integer(0),absoluteBounds:readBounds(b.field('absoluteBounds'))},
    collision:{family:c.field('family').choice('q1','q2','q3'),shape:kind==='model'?{kind,model:shape.field('model').integer(0)}:{kind},contents:c.field('contents').integer(),owner:c.field('owner').nullable(v=>actor(v,identity)),role:c.field('role').choice('solid','trigger'),monster:c.field('monster').boolean(),deadMonster:c.field('deadMonster').boolean(),
      ...(c.field('q1Corpse').value===undefined?{}:{q1Corpse:c.field('q1Corpse').literal(true)}),
      ...(c.field('q3Owner').value===undefined?{}:{q3Owner:{entityNumber:c.field('q3Owner').field('entityNumber').integer(),ownerNumber:c.field('q3Owner').field('ownerNumber').integer()}})}};
}
export function encodeUnifiedPrediction(value: UnifiedPredictionProjection): Uint8Array {
  return encodeCheckpointValue({schema:'qts-unified-prediction',version:1,actor:wireActor(value.actor),sequence:value.sequence,commandTimeMilliseconds:value.commandTimeMilliseconds,profile:value.profile,state:writeMovement(value.state),arsenal:value.arsenal,animation:value.animation,standingBounds:value.standingBounds,standingViewHeight:value.standingViewHeight,bounds:value.bounds,viewAngles:value.viewAngles,viewHeight:value.viewHeight,viewOffset:value.viewOffset,environment:value.environment,
    contact:value.contact===null?null:{...value.contact,ground:writeHit(value.contact.ground)},
    collisions:value.collisions.map(({body,collision})=>({body:{...body,actor:wireActor(body.actor),state:{...body.state,ground:body.state.ground===null?null:wireActor(body.state.ground)}},collision:{...collision,owner:collision.owner===null?null:wireActor(collision.owner)}}))});
}
export function decodeUnifiedPrediction(bytes: Uint8Array, identity: UnifiedIdentityDecoder): UnifiedPredictionProjection {
  if(bytes.length>32*1024*1024)throw new RangeError('Unified prediction exceeds byte limit');
  const r=new SaveReader(decodeCheckpointValue(bytes),'unified-prediction');r.field('schema').literal('qts-unified-prediction');r.field('version').literal(1);
  const state=readMovement(r.field('state'),identity),profile=readProfile(r.field('profile')),e=r.field('environment');
  if(state.kind!==profile.kind)return r.fail('movement state differs from profile');
  return {actor:actor(r.field('actor'),identity),sequence:r.field('sequence').integer(-1),commandTimeMilliseconds:r.field('commandTimeMilliseconds').finite(),state,profile,
    arsenal:readArsenal(r.field('arsenal')),animation:readActorAnimation(r.field('animation')),
    standingBounds:readBounds(r.field('standingBounds')),standingViewHeight:r.field('standingViewHeight').finite(),
    bounds:readBounds(r.field('bounds')),viewAngles:readVector(r.field('viewAngles')),viewHeight:r.field('viewHeight').finite(),viewOffset:readVector(r.field('viewOffset')),
    environment:{health:e.field('health').finite(),flight:e.field('flight').boolean(),haste:e.field('haste').boolean(),invulnerable:e.field('invulnerable').boolean(),gravityMultiplier:e.field('gravityMultiplier').finite(), ...(e.field('clientOutputs').value === undefined ? {} : { clientOutputs: readClientOutputs(e.field('clientOutputs')) })},
    contact:r.field('contact').nullable(c=>({ground:readHit(c.field('ground'),identity),waterLevel:c.field('waterLevel').integer(),waterType:c.field('waterType').integer()})),
    collisions:r.field('collisions').list(c=>readCollision(c,identity))};
}
export function projectUnifiedPrediction(simulation: SharedSimulation, actor: ActorId, acknowledgedInput: number): UnifiedPredictionProjection {
  const player=simulation.movementPlayer(actor);
  if(player===null)throw new Error('Unified prediction requires an admitted movement player');
  const state=player.readState();
  const snapshot=copyPredictionSnapshot({sequence:acknowledgedInput,commandTimeMilliseconds:state.kind==='q3'?state.commandTimeMilliseconds:simulation.timeSeconds*1000,
    state,arsenal:player.arsenal,animation:player.animation,environment:player.predictionEnvironment,bounds:player.bounds,
    viewAngles:player.viewAngles,viewHeight:player.viewHeight,viewOffset:{x:0,y:0,z:player.viewHeight},
    contact:{ground:player.ground,waterLevel:player.waterLevel,waterType:player.waterType},q3Arsenal:null});
  const collisions:SpatialActor[]=[];
  for(const observation of simulation.actors.observations()){
    const linked=simulation.scene.linkedActor(observation.id);if(linked!==null)collisions.push(linked);
  }
  return {actor,sequence:snapshot.sequence,commandTimeMilliseconds:snapshot.commandTimeMilliseconds,state:snapshot.state,arsenal:snapshot.arsenal,animation:snapshot.animation,environment:snapshot.environment,bounds:snapshot.bounds,viewAngles:snapshot.viewAngles,viewHeight:snapshot.viewHeight,viewOffset:snapshot.viewOffset,contact:snapshot.contact,
    profile:player.predictionProfile,standingBounds:player.standingBounds,standingViewHeight:player.character==='q3'?26:22,collisions};
}
