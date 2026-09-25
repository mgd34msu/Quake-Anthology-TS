import { expect, test } from 'bun:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { ResolvedResourceReference } from '../../../src/contracts/content.ts';
import type { SceneEntity, Q3MeshModel } from '../../../src/contracts/scene.ts';
import type { UnifiedPredictionProjection } from '../../../src/app/bootstrap/network/unified-prediction.ts';
import type { UnifiedPresentationFrame } from '../../../src/app/bootstrap/network/unified-types.ts';
import { encodeUnifiedFrame, decodeUnifiedFrame, type UnifiedFrameDecoder } from '../../../src/app/bootstrap/network/unified-frame-codec.ts';
import { encodeUnifiedPresentationEvents, decodeUnifiedPresentationEvents } from '../../../src/app/bootstrap/network/unified-event-codec.ts';
import { decodeCheckpointValue, encodeCheckpointValue, SaveReader } from '../../../src/persistence/value.ts';

const server=createIdentityOwner('server'),client=createIdentityOwner('client'),id=server.actor(4,2);
const origin={x:1,y:2,z:3},white={x:1,y:1,z:1,w:1};
const resource:ResolvedResourceReference={id:'resource:test',requestedPath:'models/test.md3',byteLength:42,digest:`sha256:${'0'.repeat(64)}`,
  provenance:{kind:'loose',memberPath:'models/test.md3',mount:{kind:'loose',rootPath:'/server-private',identity:{id:'mount:test:base',content:'q3:base:baseq3:1',generation:0}}},
  resolution:{kind:'default-order',plan:'mount-plan:test:base',rank:0}};
const localResource:ResolvedResourceReference={...resource,provenance:{kind:'loose',memberPath:resource.requestedPath,mount:{kind:'loose',identity:resource.provenance.mount.identity,rootPath:'/local-only'}}};
const model:Q3MeshModel={kind:'q3-md3',name:'local-model',frames:[],tags:[],surfaces:[]};
const entity:SceneEntity={actor:id,resource,model,transform:{origin,axis:[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}],scale:origin},previousOrigin:origin,
  pose:{kind:'skeleton',joints:[{position:origin,orientation:white,scale:1}]},skin:2,color:white,shaderTime:{kind:'seconds',value:1},flags:{kind:'q3',bits:0},lightingOrigin:origin,shadowPlane:0,attachments:[]};
const prediction:UnifiedPredictionProjection={actor:id,sequence:9,commandTimeMilliseconds:1000,
  state:{kind:'q2-classic',type:0,originEighths:[8,16,24],velocityEighths:[0,0,0],flags:0,timeEightMilliseconds:0,gravity:800,deltaAngleShorts:[0,0,0]},
  profile:{kind:'q2-classic',id:'q2:movement',airAccelerate:0,snapInitial:false,clock:{kind:'q2-classic',frameMilliseconds:100},
    numeric:{id:'q2:binary32',arithmetic:{kind:'binary32',round:'each-operation'},scalarStorage:'binary32',floatToInt:'checked-c-truncation',integerOverflow:'wrap32'}},
  arsenal:{provider:'q1:arsenal',activeWeapon:'q1:shotgun',ammo:[{item:'q2:cells',count:17,capacity:200}],state:{kind:'q1',frame:0,attackFinishedSeconds:0,sourceWeapon:1}},
  animation:{provider:'q3:character',state:{kind:'q3',legs:1,torso:2,legsTimerMilliseconds:100,torsoTimerMilliseconds:200}},
  standingBounds:{min:{x:-16,y:-16,z:-24},max:{x:16,y:16,z:32}},standingViewHeight:26,
  bounds:{min:{x:-16,y:-16,z:-24},max:{x:16,y:16,z:32}},viewAngles:origin,viewHeight:26,viewOffset:{x:0,y:0,z:26},
  environment:{health:85,flight:false,haste:false,invulnerable:false,gravityMultiplier:1},contact:null,collisions:[]};
const frame:UnifiedPresentationFrame={epoch:3,acknowledgedInput:9,prediction,output:{snapshot:{session:server.session,frame:{frame:7,time:{kind:'seconds',value:1},elapsed:{kind:'seconds',value:0.1},phase:'frame-exit'},
  actors:[{id,owner:'q1:game',definition:'q1:player'}],bodies:[{actor:id,body:{origin,angles:origin,velocity:origin,bounds:{min:origin,max:origin},ground:id}}],
  inventories:[{actor:id,entries:[{item:'q2:cells',count:17,capacity:200}]}],configurations:[{actor:id,movement:{provider:'q2:movement',content:'q2:classic:baseq2:1'},character:{definition:{provider:'q3:character',content:'q3:base:baseq3:1'},appearance:{provider:'q3:sarge',content:'q3:base:baseq3:1'}},weapons:[{provider:'q1:arsenal',content:'q1:registered:id1:1'}],inventory:{provider:'q2:inventory',content:'q2:classic:baseq2:1'}}],
  scene:{session:server.session,time:{kind:'seconds',value:1},world:null,entities:[{...entity,attachments:[{tag:'tag_weapon',entity}]}],
    lights:[{origin,color:origin,radius:10,additive:true,profile:{kind:'q2',scale:2,cone:{direction:origin,cosHalfAngle:0.4},shadow:{kind:'cast',resolution:64}}}],
    particles:[{kind:'indexed',origin,paletteIndex:10,alpha:0.5,size:1},{kind:'rgba',origin,color:white,size:2,rotation:0.4}],lightStyles:[{kind:'q1',style:0,value:1},{kind:'q2',style:2,rgb:origin,white:1}],areaBits:new Uint8Array([1,4])}},
  events:[{sequence:3,time:{kind:'seconds',value:1},audience:{kind:'client',client:server.client(0,1)},payload:{kind:'sound',resource:`resource:unified:${'a'.repeat(64)}`,actor:id,origin,channel:1,volume:1,attenuation:0.5}}]},
  models:[{actor:id,content:'q2:classic:baseq2:1',family:'q2',path:'players/male/tris.md2',frame:1,oldFrame:0,backLerp:0.25,skin:0,indexedSkin:{name:'translated',width:2,height:1,pixels:new Uint8Array([7,8])},effects:1,renderFlags:0,origin,previousOrigin:origin,angles:origin,scale:1,visible:true,viewWeapon:false,alpha:0.5,q3Weapon:{timeMilliseconds:1000,torsoAnimation:1,lastFireMilliseconds:null,firing:false,horizontalSpeed:0,bobCycle:0,weapon:2}}],
  characters:[{actor:id,origin,angles:origin,velocity:origin,movementDirection:0,animation:{kind:'q3',legs:1,torso:2,legsTimerMilliseconds:100,torsoTimerMilliseconds:200},sourceFlags:0,powerups:4,team:'red',color:white,opacity:0.7}],
  worldText:[{content:'q1:registered:id1:1',text:'shared',origin,color:white,cellSize:8,orientation:{kind:'fixed',angles:origin},depthTest:true,font:'selected',distanceCullFactor:0.2}],
  player:{actor:id,view:{origin,angles:origin,viewHeight:22,blend:white,kickAngles:origin,fieldOfView:110,pitchDrift:{grounded:true,idealPitch:5,disabled:false}},ui:{health:85,armor:{regular:{kind:'q3',points:25,protection:0.66},powered:{kind:'shield',cells:17}},activeWeapon:'q1:shotgun',ammo:{item:'q2:cells',count:17},inventory:[{item:'q2:cells',count:17,capacity:200}],powerups:[{item:'q3:quad',label:'Quad',remainingSeconds:10}],weaponStatus:{source:{provider:'q1:arsenal',content:'q1:registered:id1:1'},item:'q1:shotgun',label:'Shotgun',ammo:{kind:'finite',item:'q2:cells',count:17,hasAmmoToStart:true,low:false}},arsenalWarning:'none',items:[]}}};
const context:UnifiedFrameDecoder={...client,resourceId:id=>id,world:null,resource:async()=>localResource,model:async()=>model};

test('source grapple cable and looping sound retain client-owned actor identities',async()=>{
  const result=await decodeUnifiedFrame(encodeUnifiedFrame({...frame,models:frame.models.map(model=>({...model,
    replacesBody:true,renderOwner:'source-client',modelAnchor:{path:'models/weapons2/shotgun/shotgun_hand.md3',tag:'tag_weapon',offset:{x:5,y:0,z:-1},fovOffset:{above:90,scale:-0.2}},
    q3GrappleCable:{owner:id,ownerOrigin:origin,ownerAngles:origin,viewHeight:26,offhand:true,attached:true,
      flight:'models/grapple/flight.md3',pull:'models/grapple/pull.md3',hold:'models/grapple/hold.md3',segmentLength:14}}))}),context);
  expect(result.models[0]?.q3GrappleCable?.owner.equals(client.actor(4,2))).toBe(true);
  expect(result.models[0]?.replacesBody).toBe(true);
  expect(result.models[0]?.renderOwner).toBe('source-client');
  expect(result.models[0]?.q3GrappleCable?.owner.equals(id)).toBe(false);
  expect(result.models[0]?.modelAnchor).toEqual({path:'models/weapons2/shotgun/shotgun_hand.md3',tag:'tag_weapon',offset:{x:5,y:0,z:-1},fovOffset:{above:90,scale:-0.2}});
  const events=decodeUnifiedPresentationEvents(encodeUnifiedPresentationEvents([{kind:'q3-source',sequence:1,seconds:1,content:'q3:base:baseq3:1',
    event:{kind:'sound',actor:id,origin,velocity:origin,path:'sound/grapple/pull.wav',channel:0,volume:1,loop:true}}]),context);
  const event=events[0];
  expect(event?.kind).toBe('q3-source');
  if(event?.kind!=='q3-source'||event.event.kind!=='sound')throw new Error('Missing grapple sound');
  expect(event.event.actor.equals(client.actor(4,2))).toBe(true);
  expect(event.event.loop).toBe(true);
  expect(event.event.path).toBe('sound/grapple/pull.wav');
});

test('unified frame reconstructs mixed presentation identities and local resources without server paths',async()=>{
  const bytes=encodeUnifiedFrame(frame),text=new TextDecoder().decode(inflateRawSync(bytes));
  expect(new SaveReader(decodeCheckpointValue(inflateRawSync(bytes))).field('version').integer()).toBe(6);
  expect(text.includes('/server-private')).toBe(false);expect(text.includes('local-model')).toBe(false);
  const result=await decodeUnifiedFrame(bytes,context),snapshot=result.output.snapshot;
  expect(snapshot.session).toBe(client.session);expect(result.player.actor.equals(client.actor(4,2))).toBe(true);expect(result.player.actor.equals(id)).toBe(false);
  expect(snapshot.bodies[0]?.body.ground?.equals(result.player.actor)).toBe(true);
  expect(snapshot.scene.entities[0]?.resource).toBe(localResource);expect(snapshot.scene.entities[0]?.model).toBe(model);
  expect(snapshot.scene.entities[0]?.attachments[0]?.entity.actor?.equals(result.player.actor)).toBe(true);
  expect(snapshot.scene.entities[0]?.pose).toEqual(entity.pose);expect(snapshot.scene.lights).toEqual(frame.output.snapshot.scene.lights);
  expect(snapshot.scene.particles).toEqual(frame.output.snapshot.scene.particles);expect(snapshot.scene.lightStyles).toEqual(frame.output.snapshot.scene.lightStyles);
  expect(snapshot.scene.areaBits).toEqual(new Uint8Array([1,4]));expect(snapshot.configurations[0]?.movement.provider).toBe('q2:movement');
  expect(result.models[0]?.indexedSkin?.pixels).toEqual(new Uint8Array([7,8]));expect(result.characters[0]?.animation).toEqual(frame.characters[0]?.animation);
  expect(result.player.ui).toEqual(frame.player.ui);expect(result.player.view).toEqual(frame.player.view);expect(result.worldText).toEqual(frame.worldText);
  expect(result.output.events[0]?.audience.kind).toBe('client');expect(result.epoch).toBe(3);expect(result.acknowledgedInput).toBe(9);
});
test('unified frame rejects mismatched local resource and unsafe server path',async()=>{
  await expect(decodeUnifiedFrame(encodeUnifiedFrame(frame),{...context,resource:async()=>({...localResource,byteLength:43})})).rejects.toThrow('differs');
  const unsafe={...frame,output:{...frame.output,snapshot:{...frame.output.snapshot,scene:{...frame.output.snapshot.scene,entities:[{...entity,resource:{...resource,requestedPath:'../outside.md3'}}]}}}};
  await expect(decodeUnifiedFrame(encodeUnifiedFrame(unsafe),context)).rejects.toThrow('relative resource path');
});
test('unified frame rejects wrong schema before resolving resources',async()=>{
  const value=new SaveReader(decodeCheckpointValue(inflateRawSync(encodeUnifiedFrame(frame))));
  await expect(decodeUnifiedFrame(deflateRawSync(encodeCheckpointValue({schema:'wrong',version:1,epoch:value.field('epoch').value})),context)).rejects.toThrow('qts-unified-frame');
});

test('unified frame preserves source armor projection without assigning an absorption formula',async()=>{
  const armor = { regular: { kind: 'source', points: 39, item: 'mod:armor' }, powered: { kind: 'shield', cells: 17 } } satisfies UnifiedPresentationFrame['player']['ui']['armor'];
  const event = { sequence: 4, time: { kind: 'seconds', value: 1 }, audience: { kind: 'world' }, payload: { kind: 'damage', outcome: { kind: 'committed', survived: true,
    decision: { appliedDamage: 1, reaction: 'pain', mutations: [{ kind: 'armor', before: armor, after: armor }],
      request: { target: id, amount: 1, knockback: 0, direction: origin, point: origin, normal: origin, delivery: 'direct',
        attack: { sequence: 1, time: { kind: 'seconds', value: 1 }, attacker: id, inflictor: id, weapon: null, weaponProvider: 'q1:weapons', combatProvider: 'q1:combat',
          inventoryProvider: 'q1:inventory', movementProvider: 'q1:movement', cause: { kind: 'q1', deathType: '' } } } } } } } satisfies UnifiedPresentationFrame['output']['events'][number];
  const result = await decodeUnifiedFrame(encodeUnifiedFrame({ ...frame, output: { ...frame.output, events: [event] }, player: { ...frame.player, ui: { ...frame.player.ui, armor } } }), context);
  expect(result.player.ui.armor).toEqual(armor);
  const payload = result.output.events[0]?.payload;
  if (payload?.kind !== 'damage' || payload.outcome.kind !== 'committed') throw new Error('Missing damage event');
  expect(payload.outcome.decision.mutations).toEqual(event.payload.outcome.decision.mutations);
});
