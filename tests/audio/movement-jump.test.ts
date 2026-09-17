import { expect,test } from "bun:test";
import { movementJumped } from "../../src/app/bootstrap/simulation/player-jump.ts";
import { createIdentityOwner } from "../../src/contracts/identity.ts";
import type { Q2MovementResult,Q2RereleaseMovementResult,QwMovementResult } from "../../src/contracts/movement.ts";
import type { Q2UserCommand } from "../../src/contracts/protocol.ts";
const zero={x:0,y:0,z:0}, actor=createIdentityOwner("jump-cues").actor(1,0);
const common={status:"active",actor,commandSequence:1,bounds:{min:zero,max:zero},viewAngles:zero,viewHeight:22,ground:{kind:"none"},waterLevel:0,waterType:0,horizontalSpeed:0,contacts:[],effects:[],arsenal:{provider:"q2:official",activeWeapon:null,ammo:[],state:{kind:"q2",gunFrame:0,state:0,pendingWeapon:null,machinegunShots:0,grenadeTime:{kind:"seconds",value:0},grenadeBlewUp:false}},animation:{provider:"q3:character",state:{kind:"q3",legs:0,torso:0,legsTimerMilliseconds:0,torsoTimerMilliseconds:0}}} satisfies Omit<Extract<Q2MovementResult,{status:"active"}>,"kind"|"state">;
const command:Q2UserCommand={kind:"q2-classic",milliseconds:50,angleShorts:[0,0,0],forwardMove:0,sideMove:0,upMove:200,buttons:0,impulse:0,lightLevel:0};
const classic:Extract<Q2MovementResult,{status:"active"}>={...common,kind:"q2-classic",state:{kind:"q2-classic",type:0,originEighths:[0,0,0],velocityEighths:[0,0,1840],flags:2,timeEightMilliseconds:0,gravity:800,deltaAngleShorts:[0,0,0]}};
test("Q2 source jump cue requires leaving ground with jump intent in dry air",()=>{
 expect(movementJumped(classic.state,{kind:"world",model:0},command,classic)).toBe(true);
 expect(movementJumped(classic.state,{kind:"none"},command,classic)).toBe(false);
 expect(movementJumped(classic.state,{kind:"world",model:0},{...command,upMove:0},classic)).toBe(false);
 expect(movementJumped(classic.state,{kind:"world",model:0},command,{...classic,waterLevel:2})).toBe(false);
 expect(movementJumped(classic.state,{kind:"world",model:0},command,{...classic,ground:{kind:"world",model:0}})).toBe(false);
});
test("rerelease uses authored jumpSound and excludes ladder sounds",()=>{
 const result:Extract<Q2RereleaseMovementResult,{status:"active"}>={...common,kind:"q2-rerelease",state:{kind:"q2-rerelease",type:0,origin:zero,velocity:zero,flags:0,timeMilliseconds:0,gravity:800,deltaAngles:zero,viewHeight:22},screenBlend:{x:0,y:0,z:0,w:0},renderFlags:0,jumpSound:true,stepClip:false,impactDelta:0};
 expect(movementJumped(result.state,{kind:"none"},command,result)).toBe(true);
 expect(movementJumped(result.state,{kind:"world",model:0},command,{...result,jumpSound:false})).toBe(false);
 expect(movementJumped(result.state,{kind:"world",model:0},command,{...result,state:{...result.state,flags:128}})).toBe(false);
});
test("QuakeWorld cue follows accepted jump latch rather than held air input",()=>{
 const result:Extract<QwMovementResult,{status:"active"}>={...common,kind:"q1-quakeworld",state:{kind:"q1-quakeworld",origin:zero,velocity:{...zero,z:270},angles:zero,oldButtons:2,waterJumpTimeSeconds:0,dead:false,spectator:0,ground:{kind:"none"}}};
 const before={...result.state,oldButtons:0};
 expect(movementJumped(before,{kind:"world",model:0},command,result)).toBe(true);
 expect(movementJumped(result.state,{kind:"world",model:0},command,result)).toBe(false);
 expect(movementJumped(before,{kind:"none"},command,result)).toBe(false);
 expect(movementJumped(before,{kind:"world",model:0},command,{...result,state:{...result.state,dead:true}})).toBe(false);
});
