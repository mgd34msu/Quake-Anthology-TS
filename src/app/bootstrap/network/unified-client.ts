import type { PresentationOwner } from "../../../contracts/presentation.ts";
import type { ActorCommand, SimulationOutput } from '../../../contracts/session.ts';
import type { SimulationPresentationEvent } from '../simulation/types.ts';
import type { WireSelection, CompositionIdentity } from '../../../network/common/session.ts';
import { sameAddress, type NetworkAddress } from '../../../network/common/endpoint.ts';
import type { DatagramTransport } from '../../../network/common/transport.ts';
import { UnifiedChannel } from '../../../network/unified/channel.ts';
import { decodeUnifiedPacket } from '../../../network/unified/packet.ts';
import type { ApplicationNetwork, ApplicationNetworkPhase } from './types.ts';
import type { UnifiedRemotePresentation } from './remote-unified.ts';
import { decodeUnifiedControl, decodeUnifiedHandshake, encodeUnifiedControl, encodeUnifiedHandshake, encodeUnifiedInputs, type UnifiedInput, type UnifiedControl } from './unified-control.ts';
import { tokenizeCommand } from '../../../core/commands/index.ts';

export interface UnifiedClientOptions<TAddress extends NetworkAddress> {
  readonly transport:DatagramTransport<TAddress>;
  readonly remote:TAddress;
  readonly host:UnifiedRemotePresentation;
  userinfo():string;
}

/** Authenticated datagram lane for one retained local seat. */
export class UnifiedClientNetwork<TAddress extends NetworkAddress> implements ApplicationNetwork {
  readonly role='client';
  private state:ApplicationNetworkPhase='challenging';
  private readonly nonce=Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  private token:string|null=null;
  private channel:UnifiedChannel|null=null;
  private composition:CompositionIdentity|null=null;
  private epoch=0;
  private generation=0;
  private lastHandshake=-Infinity;
  private lastReceived:number|null=null;
  private handshakeStarted:number|null=null;
  private lastUserinfo='';
  private readonly inputs=new Map<number,UnifiedInput>();
  private acknowledged=-1;
  private commandTime:number|null=null;
  private submittedAt:number|null=null;
  constructor(private readonly options:UnifiedClientOptions<TAddress>){}
  get phase():ApplicationNetworkPhase{return this.state;}
  get wire():WireSelection {if(this.composition===null)throw new Error('Unified composition has not been negotiated');return {kind:'unified',version:1,composition:this.composition.digest,snapshotSchema:this.composition.composition.snapshotSchema};}
  private sendControl(control:UnifiedControl):void {if(this.channel===null)throw new Error('Unified connection has no channel');this.channel.queueReliable(encodeUnifiedControl(control));}
  private assertCurrent(generation:number):void{if(this.state==='closed'||this.state==='rejected'||generation!==this.generation)throw new Error('Unified channel operation was retired');}
  async poll(now:number):Promise<readonly ActorCommand[]> {
    if(this.state==='closed'||this.state==='rejected')return [];
    const generation=this.generation;
    this.handshakeStarted??=now;
    try {
      if(this.composition===null&&now-this.lastHandshake>=1000){this.lastHandshake=now;this.options.transport.send(this.options.remote,encodeUnifiedHandshake(this.token===null?{kind:'hello',nonce:this.nonce}:{kind:'connect',nonce:this.nonce,token:this.token}));}
      for(;;){
        const packet=this.options.transport.poll();if(packet===null)break;
        if(packet.kind==='error')throw packet.error;if(packet.kind!=='packet'||!sameAddress(packet.from,this.options.remote))continue;
        const handshake=decodeUnifiedHandshake(packet.payload);
        if(handshake!==null){if(handshake.kind==='challenge'&&handshake.nonce===this.nonce&&this.composition===null){
          if(this.token!==null&&this.token!==handshake.token)continue;
          this.token=handshake.token;this.channel??=new UnifiedChannel(handshake.token,{datagramBytes:Math.min(1200,this.options.transport.maxDatagramBytes??1200)});this.state='connecting';this.lastHandshake=now;
          this.options.transport.send(this.options.remote,encodeUnifiedHandshake({kind:'connect',nonce:this.nonce,token:handshake.token}));
        }continue;}
        const channel=this.channel,decoded=decodeUnifiedPacket(packet.payload);if(channel===null||decoded===null||decoded.token!==channel.token)continue;
        this.lastReceived=now;
        for(const message of channel.receive(packet.payload,now)){
          if(message.kind==='reliable'){
            const control=decodeUnifiedControl(message.payload);
            if(control.kind==='disconnect'){this.state='rejected';this.options.host.disconnected(control.reason);this.close();return [];}
            if(control.kind==='offer'){
              if(control.epoch<=this.epoch)continue;
              this.state='loading';this.epoch=control.epoch;this.inputs.clear();this.acknowledged=-1;this.commandTime=null;this.submittedAt=null;
              await this.options.host.offer(control);this.assertCurrent(generation);this.composition=control.composition;
              this.lastUserinfo=this.options.userinfo();this.sendControl({kind:'ready',epoch:this.epoch,composition:control.composition.digest,userinfo:this.lastUserinfo});
            }else if(control.epoch===this.epoch){
              if(control.kind==='admitted')this.options.host.admitted(control);
              else if(control.kind==='resources'){await this.options.host.declare(control.epoch,control.resources);this.assertCurrent(generation);}
              else if(control.kind==='components'){await this.options.host.receiveComponents(control.epoch,control.update);this.assertCurrent(generation);}
              else if(control.kind==='events')this.options.host.receiveEvents(control.epoch,control.frame,control.payload,control.simulation);
              else throw new Error('Unexpected unified server control');
            }
          }else{
            const acknowledged=await this.options.host.receiveFrame(message.payload);this.assertCurrent(generation);
            if(acknowledged!==null){this.state='active';this.acknowledged=Math.max(this.acknowledged,acknowledged);for(const sequence of this.inputs.keys())if(sequence<=this.acknowledged)this.inputs.delete(sequence);if(this.inputs.size===0)this.commandTime=this.options.host.commandTimeMilliseconds;}
          }
        }
      }
      if(now-(this.lastReceived??this.handshakeStarted)>120000)throw new Error('Unified connection timed out');
      if(this.channel!==null){
        if(this.state==='active'){const userinfo=this.options.userinfo();if(userinfo!==this.lastUserinfo){this.sendControl({kind:'userinfo',epoch:this.epoch,value:userinfo});this.lastUserinfo=userinfo;}
          this.channel.queueFrame(encodeUnifiedInputs({epoch:this.epoch,commands:[...this.inputs.values()]}),0);}
        for(const bytes of this.channel.flush(now))this.options.transport.send(this.options.remote,bytes);
      }
      return [];
    }catch(error){if(this.phase!=='closed'){this.state='rejected';this.options.host.disconnected(error instanceof Error?error.message:String(error));this.close();}throw error;}
  }
  submit(commands:readonly ActorCommand[],now:number):void{
    this.submitTimed(commands,now,this.submittedAt===null?0:Math.max(0,now-this.submittedAt));
  }
  submitTimed(commands:readonly ActorCommand[],now:number,elapsedMilliseconds:number):void{
    if(!Number.isFinite(elapsedMilliseconds)||elapsedMilliseconds<0)throw new RangeError('Unified input needs finite elapsed milliseconds');
    if(this.state!=='active')return;
    const player=this.options.host.player;
    for(const command of commands){if(player===null||!command.actor.equals(player.actor)||command.source.kind!=='local-seat'||!command.source.client.equals(this.options.host.client.id))throw new Error('Unified input belongs to another player');
      if(command.sequence<=this.acknowledged||this.inputs.has(command.sequence))continue;
      const baseline=this.options.host.commandTimeMilliseconds;if(baseline===null)throw new Error('Unified input has no authoritative clock');
      const source=command.command;
      const duration=source.kind==='q1-netquake'||source.kind==='q3'?elapsedMilliseconds:source.milliseconds;
      this.commandTime=Math.max(this.commandTime??baseline,baseline)+duration;this.submittedAt=now;
      const timed=source.kind==='q3'?{...source,serverTimeMilliseconds:Math.trunc(this.commandTime)}
        :source.kind==='q1-netquake'?{...source,acknowledgedServerTimeSeconds:baseline/1000}:source;
      this.options.host.predict({sequence:command.sequence,timeMilliseconds:this.commandTime,command:timed,angleSpace:'absolute',...(command.arsenal===undefined?{}:{arsenal:command.arsenal})});
      this.inputs.set(command.sequence,{sequence:command.sequence,command:timed,...(command.arsenal===undefined?{}:{arsenal:command.arsenal})});
      while(this.inputs.size>64){const oldest=this.inputs.keys().next();if(oldest.done)break;this.inputs.delete(oldest.value);}}
  }
  command(text:string):void {const parsed=tokenizeCommand(text,'q3');if(parsed===null||parsed.argv.length===0)return;const [name,...args]=parsed.argv;if(name!==undefined)this.playerCommand(name,args);}
  playerCommand(name:string,args:readonly string[]):void{if(this.state!=='active')return;this.sendControl({kind:'command',epoch:this.epoch,name,args});}
  componentCommand(owner:PresentationOwner,generation:number,args:readonly string[]):void{if(this.state!=='active')throw new Error('Component command requires an active client');this.sendControl({kind:'component-command',epoch:this.epoch,owner,generation,args});}
  userinfo(value:string):void{if(this.epoch!==0)this.sendControl({kind:'userinfo',epoch:this.epoch,value});}
  publish(_output:SimulationOutput,_events:readonly SimulationPresentationEvent[],_now:number):void{throw new Error('Unified client cannot publish authoritative state');}
  close():void{
    if(this.state==='closed')return;
    if(this.channel!==null&&!this.channel.closed&&this.epoch!==0){try{this.sendControl({kind:'disconnect',reason:'Client disconnected'});for(const bytes of this.channel.flush(performance.now()))this.options.transport.send(this.options.remote,bytes);}catch{/* Preserve local retirement even after transport failure. */}}
    this.state='closed';this.generation++;this.options.host.close();this.channel?.close();this.inputs.clear();this.options.transport.close();
  }
}
