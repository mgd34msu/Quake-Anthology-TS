import { expect, test } from 'bun:test';
import { createIdentityOwner } from '../../../src/contracts/identity.ts';
import type { ActorId } from '../../../src/contracts/identity.ts';
import type { Q1Event } from '../../../src/content/q1/foundation/types.ts';
import { readQuakeCCompatibility } from '../../../src/compat/qc/compatibility.ts';
import { NetQuakeDecoder, writeNetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { SizeBuf } from '../../../src/network/q1/message.ts';
import type { NetQuakeMessage } from '../../../src/network/q1/netquake.ts';
import { QuakeCLocalMessages, quakeCLocalView, presentQuakeCLocalMessage, type QuakeCLocalMessageHost } from '../../../src/app/bootstrap/simulation/quakec-local-messages.ts';

test('QC local service effects retain recipient, listener and source counters', () => {
  const identity = createIdentityOwner('qc-local-services'), first = identity.actor(1,0), second = identity.actor(2,0), camera = identity.actor(3,0);
  const state = new QuakeCLocalMessages(); state.admit(first); state.admit(second);
  const effects: { event: Q1Event; recipient: ActorId | undefined }[] = [], prints: string[] = [];
  const sessions: {kind:'level-completed'|'back-to-lobby';recipient:ActorId|null}[] = [];
  const prompts: unknown[] = [];
  const fog: { value: Extract<NetQuakeMessage,{kind:'fog'}>; recipient: ActorId | null }[] = [];
  const host: QuakeCLocalMessageHost = {
    recipients:[first,second],sourceActor:identity.actor(0,0),map:'maps/start.bsp',seconds:4,
    actor: slot => { if(slot === 3)return camera; throw new Error('Unexpected source entity'); },
    camera: () => ({origin:{x:1,y:2,z:3},angles:{x:0,y:0,z:0}}),
    sound: index => { if(index === 1)return 'misc/menu1.wav'; throw new Error('Unknown source sound'); },
    model: () => {throw new Error('Unexpected model');},emit:(event,recipient) => {effects.push({event,recipient});},
    message:event => {if(event.kind === 'print')prints.push(event.text);},music:()=>{},angles:()=>{},pause:()=>{},
    sky:()=>{},clientMetadata:()=>{},
    session:(kind,recipient)=>{sessions.push({kind,recipient});},prompt:value=>{prompts.push(value);},
    fog:(value,recipient)=>{fog.push({value,recipient});},
  };
  const receive = (message:NetQuakeMessage,target:ActorId|null):void => {state.receive([message],target,message.kind === 'set-view' ? host.actor(message.entity) : undefined);presentQuakeCLocalMessage(message,target,state,host);};
  receive({kind:'set-view',entity:3},first);
  receive({kind:'local-sound',index:1},first);
  expect(effects.shift()).toEqual({recipient:first,event:{kind:'sound',actor:camera,path:'misc/menu1.wav',channel:-1,volume:1,attenuation:1}});
  receive({kind:'bonus-flash'},first);
  expect(effects.shift()).toEqual({recipient:first,event:{kind:'effect',effect:'pickup',actor:first,origin:{x:1,y:2,z:3},amount:1}});
  receive({kind:'achievement',text:'secret-room'},first);
  expect(effects.shift()).toEqual({recipient:first,event:{kind:'achievement',player:first,id:'secret-room'}});
  receive({kind:'fog',density:0.4,color:{x:0.1,y:0.2,z:0.3},transitionSeconds:2},second);
  expect(fog[0]?.recipient).toBe(second);expect(fog[0]?.value.transitionSeconds).toBe(2);
  receive({kind:'stat',index:12,value:10},null);effects.length=0;
  receive({kind:'spawned-monster',value:3},first);
  expect(state.stat(first,12)).toBe(13);expect(state.stat(second,12)).toBe(10);
  expect(effects).toEqual([{recipient:first,event:{kind:'monster-total',total:13}}]);
  receive({kind:'raw-print',text:'raw'},first);receive({kind:'chat',text:'chat'},first);receive({kind:'botchat',text:'bot'},first);
  expect(prints).toEqual(['raw','chat','bot']);
  receive({kind:'prompt-begin',text:'Choose',choices:1},first);receive({kind:'prompt-choice',text:'Red',impulse:101},first);
  expect(prompts.at(-1)).toEqual({kind:'prompt',actor:first,title:'Choose',choices:[{label:'Red',impulse:101}]});
  receive({kind:'level-completed'},first);receive({kind:'back-to-lobby'},second);
  expect(sessions).toEqual([{kind:'level-completed',recipient:first},{kind:'back-to-lobby',recipient:second}]);
  receive({kind:'server-vars',text:'skill 2'},first);receive({kind:'set-views',value:2},first);receive({kind:'sequence',value:123},first);
  expect(state.sessionState(first)).toEqual({serverVars:'skill 2',views:2,sequence:123,levelCompleted:true,backToLobby:false});
  expect(state.sessionState(second).backToLobby).toBe(true);
  receive({kind:'skybox',text:'night'},first);
  receive({kind:'ping',slot:0,value:42},first);receive({kind:'social',slot:0,value:'source:id'},first);receive({kind:'player-info',slot:0,value:'opaque'},first);
  expect(state.presentation(first)).toContainEqual({kind:'skybox',text:'night'});
  expect(state.presentation(first)).toContainEqual({kind:'ping',slot:0,value:42});
  expect(()=>receive({kind:'time',seconds:100},first)).toThrow('Unsupported local QuakeC service time');
});

test('QC private prompts retain incremental per-client choices, restore, and clear on source impulse', () => {
  const identity = createIdentityOwner('qc-prompts'), first = identity.actor(1,0), second = identity.actor(2,0);
  const state = new QuakeCLocalMessages(); state.admit(first); state.admit(second);
  state.receive([{kind:'prompt-begin',text:'Choose team',choices:2},{kind:'prompt-choice',text:'Red',impulse:101}],first);
  expect(state.prompt(first)).toEqual({kind:'prompt',actor:first,title:'Choose team',choices:[{label:'Red',impulse:101}]});
  expect(state.prompt(second)).toEqual({kind:'clear-prompt',actor:second});
  const saved = state.capture(), restored = new QuakeCLocalMessages(); restored.restore(saved.baseline,saved.clients);
  restored.receive([{kind:'prompt-choice',text:'Blue',impulse:102}],first);
  expect(restored.prompt(first)).toEqual({kind:'prompt',actor:first,title:'Choose team',choices:[{label:'Red',impulse:101},{label:'Blue',impulse:102}]});
  expect(restored.answerPrompt(first,9)).toBe(false);
  expect(restored.answerPrompt(first,102)).toBe(true);
  expect(restored.prompt(first)).toEqual({kind:'clear-prompt',actor:first});
  restored.receive([{kind:'prompt-choice',text:'Orphan',impulse:103}],first);
  expect(restored.prompt(first)).toEqual({kind:'clear-prompt',actor:first});
  restored.receive([{kind:'prompt-begin',text:'Both',choices:1},{kind:'prompt-choice',text:'Continue',impulse:104}],null);
  expect(restored.prompt(second)).toEqual({kind:'prompt',actor:second,title:'Both',choices:[{label:'Continue',impulse:104}]});
  restored.receive([{kind:'prompt-clear'}],first);
  expect(restored.prompt(second).kind).toBe('prompt');
 });

const originalPak = '/home/buzzkill/Projects/qfiles/q1/id1/PAK0.PAK';
test.skipIf(!await Bun.file(originalPak).exists())('original NQ entity writer captures camera generation through buffered flush and save', async () => {
  const { openArchive } = await import('../../../src/content/archive/index.ts');
  const { QcBroadcastMessages } = await import('../../../src/compat/qc/presentation-host.ts');
  const { QcMachine, QcEntityMemory, loadQcProgram, classicQcEntityLayout, createQcBuiltins } = await import('../../../src/compat/qc/index.ts');
  const { SessionActorRegistry } = await import('../../../src/world/actors/registry.ts');
  const { createNumericOperations, Q1_DONOR_PROFILE } = await import('../../../src/core/numeric.ts');
  const archive = await openArchive(originalPak), entry = archive.findEntries('progs.dat')[0];
  if (entry === undefined) throw Error('Missing original program');
  const program = loadQcProgram(await archive.readEntry(entry)), actors = new SessionActorRegistry(createIdentityOwner('nq-camera'));
  const player = actors.allocate('q1:base', 'q1:player'), camera = actors.allocate('mod:camera', 'quakec:camera');
  const slots = new Map([[1, player], [2, camera]]), entities = new QcEntityMemory(classicQcEntityLayout(program), 8, 3);
  const state = new QuakeCLocalMessages(); state.admit(player.id);
  const messages = new QcBroadcastMessages({ options: { program, entities, slots: { at: slot => slots.get(slot) ?? null } },
    actor: slot => { const actor = slots.get(slot); if (actor === undefined) throw Error('Missing source actor'); return actor; } }, () => undefined, undefined,
    { native: () => false, loading: () => false, client: actor => actor.equals(player.id), route: (values, destination, targets) => {
      if (destination.kind !== 'client') throw Error('Expected source recipient');
      for (const [index, message] of values.entries()) state.receive([message], destination.actor, targets?.get(index));
      return undefined;
    } });
  const vm = new QcMachine({ program, entities, numeric: createNumericOperations(Q1_DONOR_PROFILE),
    builtins: createQcBuiltins({ kind: 'netquake', host: messages.host }), serverActive: () => true });
  const target = (slot: number) => {
    vm.globals.setInt(vm.globalOffset('msg_entity'), entities.reference(1)); vm.globals.setFloat(4, 1); vm.globals.setFloat(7, 5);
    vm.execute(program.functionNamed('WriteByte').index); vm.globals.setFloat(4, 1); vm.globals.setInt(7, entities.reference(slot));
    vm.execute(program.functionNamed('WriteEntity').index);
  };
  let x = 10;
  const source = { read: (actor: ActorId) => actors.isLive(actor) ? { origin: { x, y: 20, z: 30 }, angles: { x: 0, y: 90, z: 0 } } : null,
    offset: () => ({ x: 0, y: 0, z: 22 }) };
  try {
    target(2); messages.flush(); expect(state.viewTarget(player.id)).toBe(camera.id);
    expect(quakeCLocalView(player.id, state, source)?.origin.x).toBe(10);
    x = 40; expect(quakeCLocalView(player.id, state, source)?.origin.x).toBe(40);
    const saved = state.capture(), views = state.captureViews(), restored = new QuakeCLocalMessages();
    restored.restore(saved.baseline, saved.clients); restored.restoreViews(views.baseline, views.clients);
    expect(quakeCLocalView(player.id, restored, source)?.viewHeight).toBe(22);
    target(1); messages.flush(); expect(quakeCLocalView(player.id, state, source)).toBeNull();
    target(2); actors.release(camera); const replacement = actors.allocate('mod:camera', 'quakec:camera'); slots.set(2, replacement);
    messages.flush(); expect(state.viewTarget(player.id)).toBe(camera.id);
    expect(quakeCLocalView(player.id, state, source)).toBeNull(); expect(quakeCLocalView(player.id, restored, source)).toBeNull();
  } finally { actors.close(); archive.close(); }
});

test('private QC message dialect requires matching artifact metadata and decodes prompt service bytes', () => {
  const digest = 'sha256:' + 'a'.repeat(64), encode = (value:unknown) => new TextEncoder().encode(JSON.stringify(value));
  expect(readQuakeCCompatibility(null,digest)).toBe('known-retail');
  const dialect = readQuakeCCompatibility(encode({version:1,artifactDigest:digest,messageDialect:'quake-1-re-ts-private'}),digest);
  expect(dialect).toBe('quake-1-re-ts-private');
  expect(()=>readQuakeCCompatibility(encode({version:1,artifactDigest:'other',messageDialect:dialect}),digest)).toThrow();
  const protocol = new NetQuakeDecoder().protocol, bytes = new SizeBuf(1024);
  const messages: readonly NetQuakeMessage[] = [{kind:'prompt-begin',text:'Team',choices:1},{kind:'prompt-choice',text:'Red',impulse:101},{kind:'level-completed'},{kind:'back-to-lobby'},{kind:'prompt-clear'}];
  for(const message of messages) {if(message.kind === 'entity')throw new Error('Unexpected entity');writeNetQuakeMessage(bytes,protocol,message,dialect);}
  expect(new NetQuakeDecoder(protocol,dialect).decode(bytes.bytes())).toEqual(messages);
  expect(()=>new NetQuakeDecoder(protocol).decode(bytes.bytes())).toThrow();
});

test('Q1 source sky resolves real image faces and isolates recipients and obsolete loads', async () => {
  const {Q1ServicePresentation}=await import('../../../src/app/bootstrap/q1-service-presentation.ts');
  const {SceneImageRegistry}=await import('../../../src/render/scene/resources.ts');
  const {SceneTextureLoader}=await import('../../../src/render/scene/textures.ts');
  const identity=createIdentityOwner('q1-sky'),first=identity.actor(1,0),second=identity.actor(2,0);
  const content: import('../../../src/contracts/content.ts').ContentId='q1:classic:id1:test';
  const imageBytes=new Uint8Array(21);imageBytes[2]=2;imageBytes[12]=1;imageBytes[14]=1;imageBytes[16]=24;imageBytes[17]=32;imageBytes[20]=255;
  const images=new SceneImageRegistry({identity:Symbol('q1-sky'),session:identity.session,generation:0});
  const paths:string[]=[];
  const textures=new SceneTextureLoader(images,{read:async(path):Promise<import('../../../src/render/scene/textures.ts').SceneAsset|null>=>{
    paths.push(path);return path.endsWith('.tga') ? {bytes:imageBytes,source:{kind:'generated',name:path}} : null;
  }});
  const helper=new Q1ServicePresentation(),base={sequence:0,content,seconds:0};
  helper.receive([{...base,kind:'q1-sky',event:{kind:'skybox',name:'night'}},
    {...base,sequence:1,kind:'q1-client',event:{kind:'name',slot:4,value:'QuakeC'}},
    {...base,sequence:2,kind:'q1-client',recipient:first,event:{kind:'ping',slot:4,value:37}},
    {...base,sequence:3,kind:'q1-client',recipient:first,event:{kind:'social',slot:4,value:'opaque:source'}}]);
  await helper.prepare({provider:async requested=>{expect(requested).toBe(content);return {textures};}});
  expect(helper.view(first).sourceSky?.images).toHaveLength(6);
  expect(paths).toEqual(['rt','lf','bk','ft','up','dn'].map(face=>`gfx/env/night${face}.tga`));
  expect(helper.clients(content,first)).toEqual([{slot:4,name:'QuakeC',colors:0,frags:0,ping:37,social:'opaque:source'}]);
  expect(helper.clients(content,second)).toEqual([{slot:4,name:'QuakeC',colors:0,frags:0}]);
  const previousSky = helper.view(second).sourceSky;
  const replacementTextures = new SceneTextureLoader(images, { read: async path => ({ bytes: imageBytes, source: { kind: 'generated', name: `reloaded:${path}` } }) });
  const commit = await helper.prepareImageRefresh({ provider: async () => ({ textures: replacementTextures }) });
  expect(helper.view(second).sourceSky).toBe(previousSky);
  commit();
  expect(helper.view(second).sourceSky?.images[0]).not.toBe(previousSky?.images[0]);
  const obsolete = await helper.prepareImageRefresh({ provider: async () => ({ textures }) });
  helper.receive([{ ...base, kind: 'q1-sky', recipient: first, event: { kind: 'skybox', name: '' } }]);
  obsolete();
  expect(helper.view(first)).toEqual({});

  helper.receive([{...base,sequence:4,kind:'q1-sky',recipient:first,event:{kind:'skybox',name:''}}]);
  await helper.prepare({provider:async()=>({textures})});
  expect(helper.view(first)).toEqual({});expect(helper.view(second).sourceSky?.images).toHaveLength(6);
  const gate=Promise.withResolvers<void>();
  helper.receive([{...base,sequence:5,kind:'q1-sky',recipient:first,event:{kind:'skybox',name:'delayed'}}]);
  const pending=helper.prepare({provider:async()=>{await gate.promise;return {textures};}});
  helper.retire(first);gate.resolve();await pending;
  expect(helper.view(first).sourceSky?.images[0]).toBe(helper.view(second).sourceSky?.images[0]);
  helper.close();expect(helper.clients(content,second)).toEqual([]);
});

test('Q1 sky and source client metadata persist with saved recipient ownership', async()=>{
  const {SessionActorRegistry,SharedBodyTable}=await import('../../../src/world/actors/index.ts');
  const {SimulationEvents}=await import('../../../src/app/bootstrap/simulation/events.ts');
  const {SaveReader}=await import('../../../src/persistence/value.ts');
  const identity=createIdentityOwner('q1-service-save'),actors=new SessionActorRegistry(identity);
  const actor=actors.allocate('q1:base','q1:player');
  const bodies=new SharedBodyTable(actors,{absoluteBounds:(_actor,body)=>body.bounds,onLink:()=>undefined,onUnlink:()=>undefined});
  const events=new SimulationEvents(bodies,()=>({kind:'seconds',value:1}),()=>null,actor=>actor.slot);
  const content: import('../../../src/contracts/content.ts').ContentId='q1:classic:id1:test';
  events.emit(content,{kind:'q1-sky',event:{kind:'skybox',name:'night'}},undefined,actor.id);
  events.emit(content,{kind:'q1-client',event:{kind:'player-info',slot:4,value:'source text'}},undefined,actor.id);
  const saved=events.capture();
  events.restore(new SaveReader(saved,'events'),()=>actor.id);
  expect(events.persistentPresentation()).toHaveLength(2);
  expect(events.persistentPresentation().every(event=>event.recipient?.equals(actor.id))).toBe(true);
  events.retire(actor.id);expect(events.persistentPresentation()).toHaveLength(0);
});
