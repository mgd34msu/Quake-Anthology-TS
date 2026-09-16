import { expect, test } from 'bun:test';
import { writeNetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import { Q1RemotePresentation } from '../../../src/app/bootstrap/network/remote-q1.ts';
import { QwRemotePresentation } from '../../../src/app/bootstrap/network/remote-qw.ts';
import { LoadedApplicationContent } from '../../../src/app/bootstrap/content.ts';
import { InstalledCatalog } from '../../../src/content/catalog/index.ts';
import { MountedContent } from '../../../src/content/mounts/index.ts';
import type { OpenedResource } from '../../../src/content/mounts/index.ts';
import { readQ1Bsp } from '../../../src/formats/q1-map/index.ts';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import { EngineSession } from '../../../src/world/session/session.ts';
import { nextActorGeneration } from '../../../src/world/actors/registry.ts';
import type { QwServerData } from '../../../src/app/bootstrap/network/qw-types.ts';
import type { ExecutableRecipe, ProviderReference, ResolvedResourceReference, ContentId } from '../../../src/contracts/content.ts';
import { createContentDigest, createResourceId, createMountPlanId, createMountIdentity, createMountId } from '../../../src/contracts/content.ts';
function recipe(): ExecutableRecipe {
  const content = "q1:classic:musicmod:fixture";
  const provider = (role: string): ProviderReference => ({ provider: `q1:${role}`, content });
  const raw: Omit<ResolvedResourceReference, "id"> = { requestedPath: "maps/start.bsp", provenance: { kind: "loose", memberPath: "maps/start.bsp", mount: { kind: "loose", identity: { id: "mount:q1:fixture", content, generation: 2 }, rootPath: "/fixture" } },
    digest: createContentDigest("0".repeat(64)), byteLength: 123, resolution: { kind: "default-order", plan: "mount-plan:fixture:1", rank: 0 } };
  const geometry = { ...raw, id: createResourceId(raw) };
  return { schemaVersion: 3, id: "recipe:fixture:1", preset: "recipe:fixture:1", map: { geometryContent: content, geometry, entities: provider("game") }, campaign: { kind: "campaign", mission: provider("mission"), gamecode: provider("game") },
    movement: provider("movement"), character: { definition: provider("character"), appearance: provider("appearance") }, weapons: [provider("weapons")], equipment: { grapple: { kind: "disabled" }, handGrenades: { kind: "disabled" } }, enemies: { kind: "map-defined" },
    presentation: { doppler: { kind: "source" }, environment: { kind: "audio-content" }, assets: content, hud: provider("hud"), effects: provider("effects"), audio: provider("audio") }, engineBehavior: provider("engine"), combat: provider("combat"), inventory: provider("inventory"), match: provider("match"), transition: provider("transition"),
    execution: [{ kind: "typescript", owner: provider("game"), implementation: "q1:official", role: "server-game", api: { kind: "q1-netquake", programVersion: 6, systemCrc: 5927 } }],
    mounts: { id: "mount-plan:fixture:1", mounts: [raw.provenance.mount], defaultOrder: [raw.provenance.mount.identity.id], prefixOrders: [] }, resources: [geometry], timing: [],
    ordering: { kind: "native", traversal: "source-slot-order", clock: { kind: "q1-netquake", minimumFrameSeconds: 0.001, maximumFrameSeconds: 0.1, fixedFrameSeconds: null } } };
}

function musicWave(sample: number): Uint8Array {
  const bytes = new Uint8Array(44 + 64), view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string): void => { bytes.set(new TextEncoder().encode(value), offset); };
  tag(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); tag(8, "WAVE"); tag(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true); view.setUint32(28, 88200, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, 64, true);
  for (let offset = 44; offset < bytes.length; offset += 2) view.setInt16(offset, sample, true);
  return bytes;
}

class MusicMemoryMounts extends MountedContent {
  constructor(readonly content: ContentId, private readonly files: ReadonlyMap<string, Uint8Array>) {
    super({ id: createMountPlanId("music-memory", content.replaceAll(":", "-")), mounts: [], defaultOrder: [], prefixOrders: [] }, []);
  }
  override async open(path: string): Promise<OpenedResource | null> {
    this.assertOpen();
    const bytes = this.files.get(path); if (bytes === undefined) return null;
    const record: Omit<ResolvedResourceReference, "id"> = { requestedPath: path, byteLength: bytes.length,
      digest: createContentDigest(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")),
      provenance: { kind: "loose", memberPath: path, mount: { kind: "loose", rootPath: "/music-memory",
        identity: createMountIdentity(createMountId("music-memory", this.content.replaceAll(":", "-")), this.content, 0) } },
      resolution: { kind: "default-order", plan: this.plan.id, rank: 0 } };
    return { bytes, reference: { ...record, id: createResourceId(record) } };
  }
}

class MusicContent extends LoadedApplicationContent {
  override async forContent(content: ContentId): Promise<MountedContent> {
    if (content !== this.recipe.map.entities.content) throw new Error('Wrong music content owner');
    return this.mounts;
  }
}
function fixture() {
  const selected = recipe(), bytes = new Uint8Array(124); new DataView(bytes.buffer).setInt32(0, 29, true);
  const owner = selected.map.entities.content;
  const mounts = new MusicMemoryMounts(owner, new Map([['music/06.wav', musicWave(1000)], ['music/09.wav', musicWave(2000)]]));
  const catalog = new InstalledCatalog('/unused', [{ id: owner, expectation: { id: 'musicmod', family: 'q1', edition: 'classic', campaign: 'musicmod', title: 'Music fixture', contentDirectory: 'q1/musicmod', baseProduct: null, requiredContentArchives: [], requiredPrograms: [], mapWitness: null, unresolvedReason: null }, availability: { kind: 'installed' }, archives: [], looseRoot: null, userContent: null, maps: [], diagnostics: [] }], [], 0);
  const content = new MusicContent(catalog, selected, readQ1Bsp(bytes), mounts);
  const identity = createIdentityOwner('remote music'), session = new EngineSession(identity, { kind: 'headless' });
  const options = { identity, session, seat: identity.seat(5), client: session.createClient(0), nextGeneration: (slot: number) => nextActorGeneration(session.session, slot), content: null,
    loadContent: async () => content, sendCommand() {}, print() {}, publish: (output: import('../../../src/contracts/session.ts').SimulationOutput) => session.publish(output), disconnected: () => {} };
  return { content, session, options };
}
const serverData = (serverCount: number): QwServerData => ({ kind: 'server-data', protocol: { kind: 'q1-quakeworld', version: 28 }, serverCount, gameDirectory: 'musicmod', playerSlot: 0, spectator: false, level: 'fixture',
  moveVariables: { gravity: 800, stopSpeed: 100, maxSpeed: 320, spectatorMaxSpeed: 500, accelerate: 10, airAccelerate: 0.7, waterAccelerate: 10, friction: 4, waterFriction: 4, entityGravity: 1 } });




import { nativeProviderTiming } from '../../../src/content/catalog/timing.ts';
import { RemoteWorldContent } from '../../../src/app/bootstrap/network/remote-world.ts';
import { NetQuakeDemoInput, QuakeWorldDemoInput } from '../../../src/app/bootstrap/network/q1-demo.ts';
import { NetQuakeDemoReader, QuakeWorldDemoReader, writeNetQuakeDemoHeader, writeNetQuakeDemoRecord, writeQuakeWorldDemoRecord } from '../../../src/network/q1/demos.ts';
import { writeNetQuakeEntity } from '../../../src/network/q1/netquake.ts';
import { writeQuakeWorldMessage } from '../../../src/network/q1/quakeworld.ts';
import type { NetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import type { Q1ExtendedEntityState, QwUserCommand } from '../../../src/contracts/protocol.ts';
import { openArchive } from '../../../src/content/archive/index.ts';
import { existsSync } from 'node:fs';
function concat(parts: readonly Uint8Array[]): Uint8Array { const bytes=new Uint8Array(parts.reduce((total,part)=>total+part.length,0));let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes; }
const zero={x:0,y:0,z:0};
const entity=(x:number):Q1ExtendedEntityState=>({number:1,origin:{x,y:0,z:0},angles:zero,modelIndex:0,frame:0,colorMap:0,skin:0,effects:0,alpha:0,scale:16,lerpFinishSeconds:0,step:false});
function nqRecord(messages:readonly NetQuakeMessage[],yaw=0):Uint8Array {
 const packet=new SizeBuf(4096);for(const message of messages)if(message.kind==='entity')writeNetQuakeEntity(packet,{kind:'q1-netquake',version:15},message.state,entity(0),0);else writeNetQuakeMessage(packet,{kind:'q1-netquake',version:15},message);
 return writeNetQuakeDemoRecord({viewAngles:{x:0,y:yaw,z:0},message:packet.bytes()});
}
const initial:readonly NetQuakeMessage[]=[{kind:'server-info',protocol:{kind:'q1-netquake',version:15},maxClients:1,gameType:0,level:'fixture',models:['maps/music.bsp'],sounds:[]},{kind:'signon',stage:1},{kind:'signon',stage:2},{kind:'signon',stage:3},{kind:'set-view',entity:1},{kind:'time',seconds:10},{kind:'client-data',weaponAlpha:0,data:{viewHeight:22,idealPitch:0,punchAngles:zero,velocity:zero,items:0,onGround:false,inWater:false,weaponFrame:0,armor:0,weaponModel:0,health:100,ammo:0,shells:0,nails:0,rockets:0,cells:0,activeWeapon:0}},{kind:'entity',state:entity(1)}];
test('NQ demo primes real signon, interpolates recorded source clock/camera and applies forced CD track',async()=>{
 const {content,session,options}=fixture(),remote=new Q1RemotePresentation(options);
 const bytes=concat([writeNetQuakeDemoHeader(265),nqRecord([...initial,{kind:'cd-track',track:6,loopTrack:6}],350),nqRecord([{kind:'time',seconds:10.1},{kind:'entity',state:entity(21)}],10),nqRecord([{kind:'disconnect'}])]);
 const input=new NetQuakeDemoInput(new NetQuakeDemoReader(bytes),remote);
 try {
  expect(await input.advance({frame:0,elapsedSeconds:0,timedemo:false})).toEqual({phase:'active',recordedSeconds:10,recordsRead:1});
  expect(remote.drainPresentationEvents().filter(value=>value.kind==='music').map(value=>value.event.track)).toEqual([9]);
  await input.advance({frame:1,elapsedSeconds:0.05,timedemo:false});const player=remote.player;if(player===null)throw Error('Missing demo player');
  expect(remote.playerView(player.actor).origin.x).toBeCloseTo(11,3);expect(remote.playerView(player.actor).angles.y).toBeCloseTo(360,3);
  remote.samplePresentation(900000);expect(remote.playerView(player.actor).origin.x).toBeCloseTo(11,3);
  const end=await input.advance({frame:2,elapsedSeconds:0.2,timedemo:false});expect(end.phase).toBe('ended');if(end.phase==='ended')expect(end.reason).toBe('recorded-disconnect');
 }finally{input.close();session.close();await content.close();}
});
test('NQ timedemo reads one post-signon record per rendered frame and leaves -1 track native',async()=>{
 const {content,session,options}=fixture(),remote=new Q1RemotePresentation(options),input=new NetQuakeDemoInput(new NetQuakeDemoReader(concat([writeNetQuakeDemoHeader(),nqRecord([...initial,{kind:'cd-track',track:6,loopTrack:9}]),nqRecord([{kind:'time',seconds:11}]),nqRecord([{kind:'time',seconds:12}])])),remote);
 try {await input.advance({frame:0,elapsedSeconds:0,timedemo:true});expect(remote.drainPresentationEvents().filter(value=>value.kind==='music').map(value=>value.event.track)).toEqual([6]);expect((await input.advance({frame:1,elapsedSeconds:1,timedemo:true})).recordedSeconds).toBe(11);expect((await input.advance({frame:2,elapsedSeconds:1,timedemo:true})).recordedSeconds).toBe(12);const end=await input.advance({frame:3,elapsedSeconds:0,timedemo:true});expect(end).toMatchObject({phase:'ended',reason:'eof'});}finally{input.close();session.close();await content.close();}
});
test('NQ close during world load rejects concurrent advancement and prevents stale publication',async()=>{
 const {content,session,options}=fixture();let release:()=>void=()=>{throw Error('Load not entered');};const loading=new Promise<void>(resolve=>{release=resolve;});
 const remote=new Q1RemotePresentation({...options,loadContent:async()=>{await loading;return content;}}),input=new NetQuakeDemoInput(new NetQuakeDemoReader(concat([writeNetQuakeDemoHeader(),nqRecord(initial)])),remote);
 try {const pending=input.advance({frame:0,elapsedSeconds:0,timedemo:false});await expect(input.advance({frame:1,elapsedSeconds:0,timedemo:false})).rejects.toThrow('already in progress');input.close();release();expect(await pending).toMatchObject({phase:'ended',reason:'closed'});expect(remote.output).toBeNull();expect(()=>remote.scene).toThrow('not supplied a world');}finally{input.close();session.close();await content.close();}
});
test('QWD timedemo consumes timestamp groups rather than draining the file',async()=>{
 const {content,session,options}=fixture();const remote=new QwRemotePresentation({...options,prepareServerData:async()=>{},mapChecksum:async()=>0,skinOptions:{read:async()=>null,noskins:()=>1,baseskin:()=>'',allskins:()=>''}});
 const command:QwUserCommand={kind:'q1-quakeworld',milliseconds:20,angles:zero,forwardMove:0,sideMove:0,upMove:0,buttons:0,impulse:0};
 const bytes=concat(([{kind:'sequences',seconds:4,outgoing:7,incoming:2},{kind:'command',seconds:4,command,viewAngles:{x:0,y:30,z:0}},{kind:'command',seconds:5,command,viewAngles:{x:0,y:60,z:0}}] satisfies readonly import('../../../src/network/q1/demos.ts').QuakeWorldDemoRecord[]).map(record=>writeQuakeWorldDemoRecord(record)));
 const input=new QuakeWorldDemoInput(new QuakeWorldDemoReader(bytes),remote);
 try{expect(await input.advance({frame:0,elapsedSeconds:0,timedemo:true})).toEqual({phase:'loading',recordedSeconds:4,recordsRead:2});expect(await input.advance({frame:1,elapsedSeconds:0,timedemo:true})).toEqual({phase:'ended',reason:'eof',recordedSeconds:5,recordsRead:1});}finally{input.close();session.close();await content.close();}
});
const retail='/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK';
test.skipIf(!existsSync(retail))('retail demo1 traverses actual records through NQ presentation to recorded disconnect',async()=>{
 const archive=await openArchive(retail),entry=archive.findEntries('demo1.dem')[0];if(entry===undefined)throw Error('Missing demo1');
 const {content,session,options}=fixture();let remote:Q1RemotePresentation;
 remote=new Q1RemotePresentation({...options,loadContent:async world=>{for(const sound of world.sounds)remote.registerResource(content.recipe.map.entities.content,'sound/'+sound,content.recipe.map.geometry);return content;}});
 const input=new NetQuakeDemoInput(new NetQuakeDemoReader(await archive.readEntry(entry)),remote);let active=0,records=0,last=0,terminal='';
 try{for(let frame=0;frame<20000;frame++){const state=await input.advance({frame,elapsedSeconds:0.05,timedemo:false});records+=state.recordsRead;if(state.phase==='active'){active++;last=state.recordedSeconds;remote.drainPresentationEvents();}if(state.phase==='ended'){terminal=state.reason;break;}}expect(active).toBeGreaterThan(100);expect(records).toBeGreaterThan(100);expect(last).toBeGreaterThan(1);expect(terminal).toBe('recorded-disconnect');}finally{input.close();archive.close();session.close();await content.close();}
});

test.skipIf(!existsSync(retail))('QWD native packets prime the live receiver and replay recorded command/ack sequences',async()=>{
 const archive=await openArchive(retail),mapEntry=archive.findEntries('maps/start.bsp')[0];if(mapEntry===undefined)throw Error('Missing map');
 const original=fixture(),content=new MusicContent(original.content.catalog,{...original.content.recipe,timing:[nativeProviderTiming(original.content.recipe.movement,'q1',false)]},readQ1Bsp(await archive.readEntry(mapEntry)),original.content.mounts);
 const remote=new QwRemotePresentation({...original.options,loadContent:async()=>content,prepareServerData:async()=>{},mapChecksum:async()=>0,skinOptions:{read:async()=>null,noskins:()=>1,baseskin:()=>'',allskins:()=>''}});
 const command:QwUserCommand={kind:'q1-quakeworld',milliseconds:20,angles:zero,forwardMove:100,sideMove:0,upMove:0,buttons:0,impulse:0};
 const packet=(sequence:number,ack:number,messages:readonly Parameters<typeof writeQuakeWorldMessage>[2][],frame:boolean):Uint8Array=>{
  const payload=new SizeBuf(4096);for(const message of messages)writeQuakeWorldMessage(payload,{kind:'q1-quakeworld',version:28},message);
  const bytes=new Uint8Array(8+payload.bytes().length+(frame?3:0)),view=new DataView(bytes.buffer);view.setUint32(0,sequence,true);view.setUint32(4,ack,true);bytes.set(payload.bytes(),8);if(frame)bytes.set([47,0,0],8+payload.bytes().length);return bytes;
 };
 const player:Parameters<typeof writeQuakeWorldMessage>[2]={kind:'player',state:{number:0,flags:0,origin:{x:0,y:0,z:64},velocity:zero,modelIndex:1,frame:0,skin:0,effects:0,weaponFrame:0,milliseconds:0,command}};
 const records:import('../../../src/network/q1/demos.ts').QuakeWorldDemoRecord[]=[
  {kind:'sequences',seconds:1,outgoing:10,incoming:0},
  {kind:'packet',seconds:1,message:packet(1,8,[serverData(1),{kind:'sound-list',first:0,names:[],next:0},{kind:'model-list',first:0,names:['maps/start.bsp'],next:0}],false)},
  {kind:'command',seconds:1,command,viewAngles:{x:0,y:45,z:0}},
  {kind:'packet',seconds:1,message:packet(2,9,[{kind:'stat',index:0,value:100},player],true)},
  {kind:'command',seconds:2,command,viewAngles:{x:0,y:90,z:0}},
  {kind:'packet',seconds:3,message:packet(3,10,[player],true)},
 ];
 const sent:number[]=[],acks:number[]=[],originalSent=remote.prediction.sent,originalAck=remote.prediction.acknowledged;
 remote.prediction.sent=(sequence,cmd,now)=>{sent.push(sequence);originalSent(sequence,cmd,now);};
 remote.prediction.acknowledged=(sequence,now)=>{acks.push(sequence);originalAck(sequence,now);};
 const input=new QuakeWorldDemoInput(new QuakeWorldDemoReader(concat(records.map(writeQuakeWorldDemoRecord))),remote);
 try{
  expect((await input.advance({frame:0,elapsedSeconds:0,timedemo:true})).phase).toBe('active');expect(sent).toContain(10);expect(acks).toEqual([8,9]);
  const actor=remote.player?.actor;if(actor===undefined)throw Error('Missing QW recorded player');
  expect(remote.playerView(actor).angles.y).toBe(45);
  await input.advance({frame:1,elapsedSeconds:0,timedemo:true});expect(sent).toContain(11);expect(remote.playerView(actor).angles.y).toBe(90);
  await input.advance({frame:2,elapsedSeconds:0,timedemo:true});expect(acks).toEqual([8,9,10]);expect(remote.output).not.toBeNull();
 }finally{input.close();archive.close();original.session.close();await content.close();await original.content.close();}
});

test('candidate demo publication and client lifetime remain owned by caller',async()=>{
 const {content,session,options}=fixture(),connection=options.client.connect('loopback');
 const outputs:import('../../../src/contracts/session.ts').SimulationOutput[]=[];let disconnects=0;
 const remote=new Q1RemotePresentation({...options,publish:output=>{outputs.push(output);},disconnected:()=>{disconnects++;}});
 const input=new NetQuakeDemoInput(new NetQuakeDemoReader(concat([writeNetQuakeDemoHeader(),nqRecord(initial)])),remote);
 try {await input.advance({frame:0,elapsedSeconds:0,timedemo:false});expect(outputs.length).toBeGreaterThan(0);expect(session.snapshot).toBeNull();expect(options.client.connection).toBe(connection);remote.disconnected('retire');expect(disconnects).toBe(1);expect(connection.isClosed).toBe(false);const output=outputs.at(-1);if(output===undefined)throw Error('Missing publication');session.publish(output);expect(session.snapshot).toBe(output.snapshot);}finally{input.close();session.close();await content.close();}
});

test('NQ malformed demo errors propagate without converting them into normal EOF',async()=>{
 const {content,session,options}=fixture(),remote=new Q1RemotePresentation(options),input=new NetQuakeDemoInput(new NetQuakeDemoReader(concat([writeNetQuakeDemoHeader(),new Uint8Array([1])])),remote);
 try{await expect(input.advance({frame:0,elapsedSeconds:0,timedemo:false})).rejects.toThrow();input.close();expect(await input.advance({frame:1,elapsedSeconds:0,timedemo:false})).toMatchObject({phase:'ended',reason:'closed'});}finally{input.close();session.close();await content.close();}
});

function qwPacket(sequence:number,ack:number,messages:readonly Parameters<typeof writeQuakeWorldMessage>[2][],frame=false):Uint8Array {
 const payload=new SizeBuf(4096);for(const message of messages)writeQuakeWorldMessage(payload,{kind:'q1-quakeworld',version:28},message);
 const bytes=new Uint8Array(8+payload.bytes().length+(frame?3:0)),view=new DataView(bytes.buffer);view.setUint32(0,sequence,true);view.setUint32(4,ack,true);bytes.set(payload.bytes(),8);if(frame)bytes.set([47,0,0],8+payload.bytes().length);return bytes;
}
const qwPreamble:readonly Parameters<typeof writeQuakeWorldMessage>[2][]=[serverData(1),{kind:'sound-list',first:0,names:[],next:0},{kind:'model-list',first:0,names:['maps/start.bsp'],next:0}];
const qwIdle:QwUserCommand={kind:'q1-quakeworld',milliseconds:20,angles:zero,forwardMove:0,sideMove:0,upMove:0,buttons:0,impulse:0};
const qwPlayer=(x:number,number=0):Parameters<typeof writeQuakeWorldMessage>[2]=>({kind:'player',state:{number,flags:0,origin:{x,y:0,z:64},velocity:zero,modelIndex:1,frame:0,skin:0,effects:0,weaponFrame:0,milliseconds:0,command:qwIdle}});

test('QWD close during world load preserves both QW and NQ content owners',async()=>{
 const {content,session,options}=fixture();let release:()=>void=()=>{throw Error('Unentered load');};const loading=new Promise<void>(resolve=>{release=resolve;});let entered:()=>void=()=>{};const loadEntered=new Promise<void>(resolve=>{entered=resolve;});let publications=0;
 const remote=new QwRemotePresentation({...options,publish:()=>{publications++;},loadContent:async()=>{entered();await loading;return content;},prepareServerData:async()=>{},mapChecksum:async()=>0,skinOptions:{read:async()=>null,noskins:()=>1,baseskin:()=>'',allskins:()=>''}});
 const input=new QuakeWorldDemoInput(new QuakeWorldDemoReader(writeQuakeWorldDemoRecord({kind:'packet',seconds:1,message:qwPacket(1,0,qwPreamble)})),remote);
 const descriptor=Object.getOwnPropertyDescriptor(RemoteWorldContent.prototype,'content');if(descriptor===undefined)throw Error('Missing content descriptor');const originalSet:((this:RemoteWorldContent,value:LoadedApplicationContent)=>void)|undefined=descriptor.set;if(originalSet===undefined)throw Error('Missing content setter');const assigned:LoadedApplicationContent[]=[];Object.defineProperty(RemoteWorldContent.prototype,'content',{...descriptor,set(this:RemoteWorldContent,value:LoadedApplicationContent){assigned.push(value);originalSet.call(this,value);}});
 try{const pending=input.advance({frame:0,elapsedSeconds:0,timedemo:false});await loadEntered;input.close();release();expect(await pending).toMatchObject({phase:'ended',reason:'closed'});expect(publications).toBe(0);expect(assigned).toEqual([]);expect(()=>remote.scene).toThrow('not supplied a world');expect(()=>remote.shared.scene).toThrow('not supplied a world');expect(remote.output).toBeNull();}finally{Object.defineProperty(RemoteWorldContent.prototype,'content',descriptor);input.close();session.close();await content.close();}
});

test.skipIf(!existsSync(retail))('QWD close while loading skins prevents post-await collision, prediction and publication',async()=>{
 const archive=await openArchive(retail),entry=archive.findEntries('maps/start.bsp')[0];if(entry===undefined)throw Error('Missing map');
 const original=fixture(),content=new MusicContent(original.content.catalog,{...original.content.recipe,timing:[nativeProviderTiming(original.content.recipe.movement,'q1',false)]},readQ1Bsp(await archive.readEntry(entry)),original.content.mounts);
 let release:()=>void=()=>{throw Error('Unentered skin load');},entered:()=>void=()=>{};const skinLoading=new Promise<void>(resolve=>{release=resolve;}),skinEntered=new Promise<void>(resolve=>{entered=resolve;});let publications=0;
 const remote=new QwRemotePresentation({...original.options,publish:()=>{publications++;},loadContent:async()=>content,prepareServerData:async()=>{},mapChecksum:async()=>0,skinOptions:{read:async()=>{entered();await skinLoading;return null;},noskins:()=>0,baseskin:()=>'',allskins:()=>''}});
 const records:import('../../../src/network/q1/demos.ts').QuakeWorldDemoRecord[]=[{kind:'packet',seconds:1,message:qwPacket(1,0,[...qwPreamble,{kind:'stat',index:0,value:100},qwPlayer(0)],true)},{kind:'packet',seconds:2,message:qwPacket(2,0,[{kind:'userinfo',slot:0,userId:1,value:'\\name\\Recorder\\skin\\custom'},qwPlayer(50),qwPlayer(25,1)],true)}];
 const input=new QuakeWorldDemoInput(new QuakeWorldDemoReader(concat(records.map(writeQuakeWorldDemoRecord))),remote);
 try{await input.advance({frame:0,elapsedSeconds:0,timedemo:true});const scene=remote.scene,link=scene.link.bind(scene);let links=0;scene.link=(...args)=>{links++;return link(...args);};const pending=input.advance({frame:1,elapsedSeconds:0,timedemo:true});await skinEntered;const actor=remote.player?.actor;if(actor===undefined)throw Error('Missing player');const origin={...remote.playerView(actor).origin},published=publications,linked=links;input.close();release();expect(await pending).toMatchObject({phase:'ended',reason:'closed'});expect(publications).toBe(published);expect(links).toBe(linked);expect(remote.playerView(actor).origin).toEqual(origin);expect(remote.scene).toBe(scene);}finally{input.close();release();archive.close();original.session.close();await content.close();await original.content.close();}
});

test.skipIf(!existsSync(retail))('normal QWD large timestamp gap catches up to one second before the next record',async()=>{
 const archive=await openArchive(retail),entry=archive.findEntries('maps/start.bsp')[0];if(entry===undefined)throw Error('Missing map');const original=fixture(),content=new MusicContent(original.content.catalog,{...original.content.recipe,timing:[nativeProviderTiming(original.content.recipe.movement,'q1',false)]},readQ1Bsp(await archive.readEntry(entry)),original.content.mounts);
 const remote=new QwRemotePresentation({...original.options,loadContent:async()=>content,prepareServerData:async()=>{},mapChecksum:async()=>0,skinOptions:{read:async()=>null,noskins:()=>1,baseskin:()=>'',allskins:()=>''}});
 const records:import('../../../src/network/q1/demos.ts').QuakeWorldDemoRecord[]=[{kind:'packet',seconds:10,message:qwPacket(1,0,[...qwPreamble,{kind:'stat',index:0,value:100},qwPlayer(0)],true)},{kind:'command',seconds:100,command:qwIdle,viewAngles:zero}];
 const input=new QuakeWorldDemoInput(new QuakeWorldDemoReader(concat(records.map(writeQuakeWorldDemoRecord))),remote);
 try{expect(await input.advance({frame:0,elapsedSeconds:0,timedemo:false})).toMatchObject({phase:'active',recordedSeconds:99,recordsRead:1});expect(await input.advance({frame:1,elapsedSeconds:0.5,timedemo:false})).toMatchObject({phase:'active',recordedSeconds:99.5,recordsRead:0});expect(await input.advance({frame:2,elapsedSeconds:0.5,timedemo:false})).toMatchObject({phase:'ended',reason:'eof',recordedSeconds:100,recordsRead:1});}finally{input.close();archive.close();original.session.close();await content.close();await original.content.close();}
});

import { RecordedRemoteSource } from '../../../src/app/bootstrap/network/recorded-source.ts';
import { CvarRegistry } from '../../../src/core/cvars/index.ts';
import type { DemoCompletion } from '../../../src/app/bootstrap/demo-commands.ts';

test('shared recorded source preserves NQ native interpolation and reports completion once after advancement', async () => {
 const {content,session,options}=fixture(), remote=new Q1RemotePresentation(options);
 const bytes=concat([writeNetQuakeDemoHeader(),nqRecord(initial,350),nqRecord([{kind:'time',seconds:10.1},{kind:'entity',state:entity(21)}],10),nqRecord([{kind:'disconnect'}])]);
 const completions:DemoCompletion[]=[];
 const cvars=new CvarRegistry({dialect:'q1-netquake',context:{session:session.session,origin:{kind:'local-console'}}});
 const source=new RecordedRemoteSource({kind:'q1',path:'demo1.dem',bytes},remote,false,cvars,reason=>completions.push(reason));
 try {
  expect(completions).toEqual([]);expect(source.phase).toBe('loading');
  await source.advance(0,0,100000);expect(source.phase).toBe('active');
  await source.advance(50,1,100050);const actor=remote.player?.actor;if(actor===undefined)throw new Error('Missing recorded actor');
  expect(remote.playerView(actor).origin.x).toBeCloseTo(11,3);expect(remote.playerView(actor).angles.y).toBeCloseTo(360,3);
  await source.advance(200,2,100250);expect(completions).toEqual(['disconnected']);expect(source.phase).toBe('closed');
  await source.advance(200,3,100450);source.close();expect(completions).toEqual(['disconnected']);
 } finally {source.close();session.close();await content.close();}
});

test('retained script mounts outlive content retirement until the last idempotent release', async () => {
 const {content,session}=fixture();const first=content.retainMainMounts(),second=content.retainMainMounts(),mounts=content.mounts;
 await content.close();expect(()=>content.retainMainMounts()).toThrow('Application content is closed');
 expect(await mounts.open('music/06.wav')).not.toBeNull();first();first();expect(await mounts.open('music/06.wav')).not.toBeNull();
 second();second();expect(mounts.open('music/06.wav')).rejects.toThrow();session.close();
});
