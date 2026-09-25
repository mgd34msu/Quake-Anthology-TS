import { UnifiedNativeConsumers } from "./unified-native-consumer.ts";
import type { ActiveModClientPresentation } from "../../../world/session/mod-client-presentation.ts";
import { PresentationState } from "../presentation-state.ts";
import { ModUserFiles } from "../../../world/session/mod-files.ts";
import type { PresentationOwner } from "../../../contracts/presentation.ts";
import type { UnifiedComponentUpdate } from "./unified-components.ts";
import { UnifiedComponentConsumers } from "./unified-component-consumer.ts";
import type { ActorId, ClientId, IdentityOwner, SeatId } from '../../../contracts/identity.ts';
import type { ContentId, ResolvedResourceReference, ResourceId } from '../../../contracts/content.ts';
import type { DecodedModel } from '../../../contracts/scene.ts';
import type { SimulationEvent, SimulationOutput } from '../../../contracts/session.ts';
import type { SessionClient } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import { RemoteWorldContent } from './remote-world.ts';
import { readUnifiedFrame, type UnifiedResourceKey } from './unified-frame-codec.ts';
import type { UnifiedIdentityDecoder, UnifiedPresentationFrame } from './unified-types.ts';
import { decodeUnifiedPresentationEvents, readUnifiedSimulationEvent } from './unified-event-codec.ts';
import { resolveUnifiedResource, unifiedResourceId } from './unified-content.ts';
import type { UnifiedControl } from './unified-control.ts';
import { SelectedMovementPrediction } from '../simulation/prediction.ts';
import type { MovementPredictionResult, PredictionCommand } from '../simulation/prediction.ts';
import { movementOrigin, movementVelocity } from '../simulation/players.ts';
import type { UnifiedPredictionProjection } from './unified-prediction.ts';
import type { Vec3 } from '../../../contracts/math.ts';
import { SaveReader, decodeCheckpointValue } from '../../../persistence/value.ts';

export interface UnifiedRemoteOptions {
  readonly identity: IdentityOwner;
  readonly client: SessionClient;
  readonly seat: SeatId;
  nextGeneration(slot: number): number;
  loadContent(offer: Extract<UnifiedControl,{kind:'offer'}>, assertCurrent:()=>void): Promise<LoadedApplicationContent>;
  model(key: UnifiedResourceKey, brushModel: number|null): Promise<DecodedModel>;
  publish(output: SimulationOutput): void;
  publishComponents?(operation: () => void | Promise<void>): Promise<void>;
  sendCommand(name:string,args:readonly string[]): void;
  readonly modFiles?: ModUserFiles;
  sendComponentCommand?(owner:PresentationOwner,generation:number,args:readonly string[]): void;
  disconnected(reason:string): void;
  print(text:string): void;
}

/** Read-only replica: identities and presentation state, never an authoritative Simulation. */
export class UnifiedRemotePresentation {
  readonly client: SessionClient;
  private readonly world = new RemoteWorldContent(null);
  private readonly actors = new Map<string,ActorId>();
  private readonly clients = new Map<string,ClientId>();
  private readonly resources = new Map<ResourceId,ResolvedResourceReference>();
  private readonly pendingEvents: {frame:number;events:readonly SimulationPresentationEvent[];simulation:readonly SimulationEvent[]}[]=[];
  private readonly sourceSequences = new Map<number, number>();
  private mediaValue = new PresentationState(() => this.current?.output.snapshot.frame.time ?? {kind:"milliseconds",value:0}, actor => this.numberOf(actor));
  private components: UnifiedComponentConsumers | null = null;
  private native: UnifiedNativeConsumers | null = null;
  get media(): PresentationState { return this.mediaValue; }
  private simulationEvents:SimulationEvent[]=[];
  private current:UnifiedPresentationFrame|null=null;
  private binding:Extract<UnifiedControl,{kind:'admitted'}>|null=null;
  private predictor:SelectedMovementPrediction|null=null;
  private predicted:MovementPredictionResult|null=null;
  private projection:UnifiedPredictionProjection|null=null;
  private readonly linked=new Set<ActorId>();
  private generation=0;
  private closed=false;
  private worldEpoch=0;
  private contentEpoch=0;
  private offeredDigest:string|null=null;
  private lastEventSequence=-1;
  private lastSimulationSequence=-1;
  constructor(private readonly options:UnifiedRemoteOptions){this.client=options.client;}
  get compositionDigest():string|null{return this.offeredDigest;}
  get epoch():number{return this.worldEpoch;}
  get loadedEpoch():number{return this.contentEpoch;}
  get scene(){return this.world.scene;}
  get output():SimulationOutput|null{return this.current?.output??null;}
  get player(){return this.current===null||this.binding===null?null:{actor:this.current.player.actor,client:this.client.id,sourceEntity:this.binding.sourceEntity};}
  private assertCurrent(generation:number):void {if(this.closed||generation!==this.generation)throw new Error('Unified replica load was retired');}
  private identity():UnifiedIdentityDecoder {
    return {session:this.options.identity.session,actor:(slot,generation)=>{
      const key=`${slot}:${generation}`,old=this.actors.get(key);if(old!==undefined)return old;
      const value=this.options.identity.actor(slot,this.options.nextGeneration(slot));this.actors.set(key,value);return value;
    },client:(slot,generation)=>{
      if(this.binding?.client.slot===slot&&this.binding.client.generation===generation)return this.client.id;
      const key=`${slot}:${generation}`,old=this.clients.get(key);if(old!==undefined)return old;
      // Remote references are not admitted session clients; their generation is epoch-scoped.
      const value=this.options.identity.client(slot,this.options.nextGeneration(slot));this.clients.set(key,value);return value;
    },seat:()=>this.options.seat,resourceId:id=>{const resource=this.resources.get(id);if(resource===undefined)throw new Error(`Unified resource was not declared: ${id}`);return resource.id;}};
  }
  async offer(offer:Extract<UnifiedControl,{kind:'offer'}>):Promise<void>{
    if(this.closed)throw new Error('Unified replica is closed');
    let generation=this.generation;
    const retire=():void=>{if(this.closed)throw new Error('Unified replica is closed');
      this.components?.close();this.components=null;this.native?.close();this.native=null;generation=++this.generation;
      this.worldEpoch=offer.epoch;this.offeredDigest=offer.composition.digest;this.binding=null;};
    if(this.options.publishComponents===undefined)retire();else await this.options.publishComponents(retire);
    const content=await this.options.loadContent(offer,()=>this.assertCurrent(generation));this.assertCurrent(generation);
    this.clearPrediction();this.world.content=content;this.contentEpoch=offer.epoch;this.current=null;this.actors.clear();this.clients.clear();this.resources.clear();this.sourceSequences.clear();this.mediaValue=new PresentationState(() => this.current?.output.snapshot.frame.time ?? {kind:"milliseconds",value:0}, actor => this.numberOf(actor));this.simulationEvents=[];this.pendingEvents.length=0;this.lastEventSequence=-1;this.lastSimulationSequence=-1;
    this.native = new UnifiedNativeConsumers({ content, events: this.mediaValue, assertCurrent: () => this.assertCurrent(generation), viewer: () => this.player?.actor ?? null });
    const files=this.options.modFiles;
    if(content.preparedMods.some(mod=>mod.presentation!==undefined)){
      if(files===undefined)throw new Error("Remote component presentation requires client-owned writable storage");
      this.components=new UnifiedComponentConsumers({content,events:this.mediaValue,files,
        assertCurrent:()=>this.assertCurrent(generation),viewer:()=>this.player?.actor??null,
        command:(owner,sourceGeneration,args)=>{if(this.options.sendComponentCommand===undefined)throw new Error("Remote component command channel is unavailable");this.options.sendComponentCommand(owner,sourceGeneration,args);}});
    }
  }
  admitted(binding:Extract<UnifiedControl,{kind:'admitted'}>):void {if(binding.epoch!==this.worldEpoch)return;this.binding=binding;this.identity().actor(binding.actor.slot,binding.actor.generation);}
  async receiveComponents(epoch:number,update:UnifiedComponentUpdate):Promise<void>{
    const publish=async():Promise<void>=>{
      if(epoch!==this.worldEpoch||this.closed)return;
      const publishNative = this.native?.prepareUpdate(update);
      if(this.components===null){if(update.sources.length!==0)throw new Error("Server activated an unqualified remote component");}
      else await this.components.update(update);
      publishNative?.();
    };
    if(this.options.publishComponents===undefined)await publish();else await this.options.publishComponents(publish);
  }
  modPresentationSources(){return this.components?.sources()??[];}
  modClientPresentationSources(): readonly ActiveModClientPresentation[] {
    return [...(this.components?.clientSources() ?? []), ...(this.native?.sources() ?? [])];
  }
  async declare(epoch:number,keys:readonly UnifiedResourceKey[]):Promise<void>{
    if(epoch!==this.worldEpoch||this.closed)return;
    const generation=this.generation;
    for(const key of keys){const resource=await resolveUnifiedResource(this.world.content,key);this.assertCurrent(generation);this.resources.set(unifiedResourceId(key),resource);}
  }
  receiveEvents(epoch:number,frame:number,payload:Uint8Array,simulation:Uint8Array):void{
    if(epoch!==this.worldEpoch||this.closed)return;
    const identity=this.identity();
    this.pendingEvents.push({frame,events:decodeUnifiedPresentationEvents(payload,identity),simulation:new SaveReader(decodeCheckpointValue(simulation),'unified-events').list(value=>readUnifiedSimulationEvent(value.value,identity))});
    this.releaseEvents();
  }
  private releaseEvents():SimulationEvent[] {
    const frame=this.current?.output.snapshot.frame.frame,simulation:SimulationEvent[]=[];if(frame===undefined)return simulation;
    while(this.pendingEvents[0]!==undefined&&this.pendingEvents[0].frame<=frame){
      const next=this.pendingEvents.shift();if(next===undefined)break;
      for(const event of next.events)if(event.sequence>this.lastEventSequence){
        if(event.kind==="presentation-owner" && event.event.kind==="retired")this.native?.retire(event.event.owner);
        this.sourceSequences.set(event.sequence,this.mediaValue.receivePresentation(event));this.lastEventSequence=event.sequence;}
      for(const event of next.simulation)if(event.sequence>this.lastSimulationSequence){const sourceSequence=event.payload.kind==='message'?event.payload.sourcePresentationSequence:undefined;
        const localSequence=sourceSequence===undefined?undefined:this.sourceSequences.get(sourceSequence);
        simulation.push(event.payload.kind==='message'&&localSequence!==undefined?{...event,payload:{...event.payload,sourcePresentationSequence:localSequence}}:event);this.lastSimulationSequence=event.sequence;}
    }
    if(this.sourceSequences.size>4096)for(const sequence of this.sourceSequences.keys())if(sequence<this.lastEventSequence-2048)this.sourceSequences.delete(sequence);
    this.simulationEvents.push(...simulation);return simulation;
  }
  async receiveFrame(bytes:Uint8Array):Promise<number|null>{
    const envelope=readUnifiedFrame(bytes);
    if(this.closed||envelope.epoch!==this.worldEpoch||this.binding===null)return null;
    const generation=this.generation,world=this.world.content;
    const frame=await envelope.decode({...this.identity(),world:{resource:world.recipe.map.geometry,geometry:world.world},
      resource:async key=>{const id=unifiedResourceId(key),existing=this.resources.get(id);if(existing!==undefined)return existing;const value=await resolveUnifiedResource(world,key);this.assertCurrent(generation);this.resources.set(id,value);return value;},model:(key,brush)=>this.options.model(key,brush)});
    this.assertCurrent(generation);
    const expected=this.identity().actor(this.binding.actor.slot,this.binding.actor.generation);
    if(!frame.player.actor.equals(expected))throw new Error('Unified frame changed the admitted player');
    if(this.current!==null&&frame.output.snapshot.frame.frame<=this.current.output.snapshot.frame.frame)return frame.acknowledgedInput;
    const publishNative=this.native?.prepare(frame.components??{revision:0,sources:[]},expected,frame.nativeCamera);
    if(publishNative===null)return frame.acknowledgedInput;
    if(this.components!==null&&!this.components.accept(frame.components??{revision:0,sources:[]},expected))return frame.acknowledgedInput;
    if(this.components===null&&(frame.components?.sources.length??0)!==0)throw new Error("Remote frame contains unadmitted components");
    this.current={...frame,output:{...frame.output,events:[]}};publishNative?.();this.correctPrediction(frame);this.releaseEvents();this.options.publish(this.current.output);return frame.acknowledgedInput;
  }
  private clearPrediction():void {
    if(this.projection!==null)for(const actor of this.linked)this.scene.unlink(actor);
    this.linked.clear();this.predictor=null;this.predicted=null;this.projection=null;
  }
  private correctPrediction(frame:UnifiedPresentationFrame):void {
    const projection=frame.prediction;
    if(!projection.actor.equals(frame.player.actor)||projection.sequence!==frame.acknowledgedInput)throw new Error('Unified prediction does not match admitted snapshot');
    if(this.projection!==null&&!this.projection.actor.equals(projection.actor))this.clearPrediction();
    const nextLinked=new Set(projection.collisions.map(entry=>entry.body.actor));
    for(const actor of this.linked)if(!nextLinked.has(actor)){this.scene.unlink(actor);this.linked.delete(actor);}
    for(const entry of projection.collisions){this.scene.link(entry.body,entry.collision);this.linked.add(entry.body.actor);}
    this.projection=projection;
    const initial={...projection,q3Arsenal:null}, replica=this;
    if(this.predictor===null)this.predictor=new SelectedMovementPrediction({movementOnly:true,
      actor:this.options.identity.ownedActor(projection.actor,this.world.content.recipe.map.entities.provider),seat:this.options.seat,recipe:this.world.content.recipe,
      get profile(){return replica.projection?.profile??projection.profile;},
      get standingBounds(){return replica.projection?.standingBounds??projection.standingBounds;},
      get standingViewHeight(){return replica.projection?.standingViewHeight??projection.standingViewHeight;},
      scene:this.scene,isBrush:hit=>hit.kind==='world'||hit.kind==='actor'&&this.scene.linkedActor(hit.actor)?.collision.shape.kind==='model'},initial);
    else this.predictor.receive(initial);
    this.predicted=this.predictor.replay();
  }
  get commandTimeMilliseconds():number|null{return this.projection?.commandTimeMilliseconds??null;}
  predict(command:PredictionCommand):void {if(this.predictor===null)return;this.predictor.submit({...command,angleSpace:'absolute'});this.predicted=this.predictor.replay();}
  private predictedPlayer(){return this.predicted===null||(this.predicted.status==='history-exhausted'||this.predicted.status==='unchanged')?null:this.predicted.player;}
  private shift(origin:Vec3):Vec3 {
    const player=this.predictedPlayer(),current=this.current;if(player===null||current===null)return origin;
    const predicted=movementOrigin(player.state),original=movementOrigin(current.prediction.state);
    return {x:origin.x+predicted.x-original.x,y:origin.y+predicted.y-original.y,z:origin.z+predicted.z-original.z};
  }
  samplePresentation(_now:number):SimulationOutput|null{
    const output=this.output,player=this.predictedPlayer(),actor=this.current?.player.actor;
    if(output===null||player===null||actor===undefined)return output;
    return {...output,snapshot:{...output.snapshot,bodies:output.snapshot.bodies.map(entry=>entry.actor.equals(actor)?{...entry,body:{...entry.body,
      origin:movementOrigin(player.state),velocity:movementVelocity(player.state),bounds:player.bounds,
      ground:player.contact?.ground.kind==='actor'?player.contact.ground.actor:null}}:entry),
      scene:{...output.snapshot.scene,entities:output.snapshot.scene.entities.map(entity=>entity.actor?.equals(actor)?{...entity,
        transform:{...entity.transform,origin:this.shift(entity.transform.origin)},previousOrigin:this.shift(entity.previousOrigin),lightingOrigin:this.shift(entity.lightingOrigin)}:entity)}}};
  }
  playerUi(actor:ActorId){if(this.current===null||!this.current.player.actor.equals(actor))throw new Error('Unified player UI belongs to another actor');return this.current.player.ui;}
  playerView(actor:ActorId){if(this.current===null||!this.current.player.actor.equals(actor))throw new Error('Unified player view belongs to another actor');const view=this.current.player.view,player=this.predictedPlayer();return player===null?view:{...view,origin:this.shift(view.origin),angles:player.viewAngles,viewHeight:player.viewHeight};}
  presentations(){const actor=this.current?.player.actor;return this.current?.models.map(model=>actor!==undefined&&model.actor.equals(actor)?{...model,origin:this.shift(model.origin),...(model.previousOrigin===undefined?{}:{previousOrigin:this.shift(model.previousOrigin)})}:model)??[];}
  characterViews(){const actor=this.current?.player.actor,player=this.predictedPlayer();return this.current?.characters.map(view=>player!==null&&actor!==undefined&&view.actor.equals(actor)?{...view,origin:this.shift(view.origin),velocity:movementVelocity(player.state)}:view)??[];}
  worldText(){return this.current?.worldText??[];}
  isPlayer(actor:ActorId):boolean{return this.current?.output.snapshot.configurations.some(value=>value.actor.equals(actor))??false;}
  numberOf(actor:ActorId):number|null {for(const [key,value] of this.actors)if(value.equals(actor))return Number(key.split(':')[0]);return null;}
  playerCommand(actor:ActorId,name:string,args:readonly string[]):undefined {if(this.player===null||!this.player.actor.equals(actor))throw new Error('Unified command belongs to another player');this.options.sendCommand(name,args);return undefined;}
  registerResource(_content:ContentId,_path:string,resource:ResolvedResourceReference):undefined {this.resources.set(unifiedResourceId(resource),resource);return undefined;}
  drainSimulationEvents():readonly SimulationEvent[]{const events=this.simulationEvents;this.simulationEvents=[];return events;}
  drainPresentationEvents():readonly SimulationPresentationEvent[]{return this.mediaValue.takePresentation();}
  disconnected(reason:string):void{this.options.disconnected(reason);}
  print(text:string):void{this.options.print(text);}
  close():void{this.components?.close();this.components=null;this.native?.close();this.native=null;this.clearPrediction();this.contentEpoch=0;this.closed=true;this.generation++;this.current=null;this.pendingEvents.length=0;this.sourceSequences.clear();this.mediaValue.takePresentation();this.simulationEvents=[];this.resources.clear();this.actors.clear();this.clients.clear();}
}
