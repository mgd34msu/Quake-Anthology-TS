import type { ActorId } from '../../../contracts/identity.ts';
import type { Q1CompositionEvent } from '../../../content/composition/q1/types.ts';
import type { NetQuakeMessage } from '../../../network/q1/netquake.ts';

/** Client-owned service state, separate from the module's authoritative edict fields. */
export class QuakeCLocalMessages {
  private readonly baseline = new Map<string, NetQuakeMessage>();
  private readonly clients = new Map<ActorId, Map<string, NetQuakeMessage>>();
  private retained(state: Map<string, NetQuakeMessage>, message: NetQuakeMessage): void {
    switch (message.kind) {
      case 'server-vars': case 'set-views': case 'sequence': case 'level-completed': case 'back-to-lobby':
        state.set(message.kind, message); break;
      case 'prompt-begin': case 'prompt-clear':
        for (const key of state.keys()) if (key.startsWith('prompt:')) state.delete(key);
        state.set('prompt:begin', message); break;
      case 'prompt-choice': {
        const begin = state.get('prompt:begin');
        if (begin?.kind === 'prompt-begin' && begin.text !== '') {
          const count = [...state.values()].filter(value => value.kind === 'prompt-choice').length;
          state.set(`prompt:choice:${count}`, message);
        }
        break;
      }
      case 'stat':
        if (!Number.isInteger(message.index) || message.index < 0 || message.index >= 32) throw new Error('Invalid NetQuake client stat');
        state.set(`stat:${message.index}`, message); break;
      case 'killed-monster': case 'found-secret': {
        const index = message.kind === 'killed-monster' ? 14 : 13, old = state.get(`stat:${index}`);
        state.set(`stat:${index}`, {kind:'stat',index,value:(old?.kind === 'stat' ? old.value : 0) + 1}); break;
      }
      case 'spawned-monster': {
        const old = state.get('stat:12'); state.set('stat:12', {kind:'stat',index:12,value:(old?.kind === 'stat' ? old.value : 0) + message.value}); break;
      }
      case 'light-style': state.set(`light-style:${message.index}`, message); break;
      case 'name': case 'colors': case 'frags': case 'ping': case 'social': case 'player-info': state.set(`${message.kind}:${message.slot}`, message); break;
      case 'set-view': case 'set-angle': case 'pause': case 'cd-track': case 'fog': case 'skybox': state.set(message.kind, message); break;
      case 'intermission': case 'finale': case 'cutscene': state.set('intermission', message); break;
      default: break;
    }
  }
  admit(actor: ActorId): void { if (!this.clients.has(actor)) this.clients.set(actor, new Map(this.baseline)); }
  hasClient(actor: ActorId): boolean { return this.clients.has(actor); }
  retire(actor: ActorId): void { this.clients.delete(actor); }
  receive(messages: readonly NetQuakeMessage[], actor: ActorId | null): void {
    if (actor === null) for (const message of messages) {
      this.retained(this.baseline, message);
      for (const state of this.clients.values()) this.retained(state, message);
    } else {
      this.admit(actor);
      const state = this.clients.get(actor); if (state === undefined) throw new Error('Missing local QC client state');
      for (const message of messages) this.retained(state, message);
    }
  }
  stat(actor: ActorId, index: number): number | null {
    const message = this.clients.get(actor)?.get(`stat:${index}`);
    return message?.kind === 'stat' ? message.value : null;
  }
  angles(actor: ActorId) { const message = this.clients.get(actor)?.get('set-angle'); return message?.kind === 'set-angle' ? message.angles : null; }
  view(actor: ActorId): number | null { const message = this.clients.get(actor)?.get('set-view'); return message?.kind === 'set-view' ? message.entity : null; }
  sessionState(actor: ActorId) {
    const state = this.clients.get(actor), server = state?.get('server-vars'), views = state?.get('set-views'), sequence = state?.get('sequence');
    return {serverVars:server?.kind === 'server-vars' ? server.text : '',views:views?.kind === 'set-views' ? views.value : 1,
      sequence:sequence?.kind === 'sequence' ? sequence.value : 0,levelCompleted:state?.has('level-completed') === true,backToLobby:state?.has('back-to-lobby') === true};
  }
  prompt(actor: ActorId): Extract<Q1CompositionEvent, {readonly kind:'prompt' | 'clear-prompt'}> {
    const messages = this.clients.get(actor), begin = messages?.get('prompt:begin');
    if (begin?.kind !== 'prompt-begin' || begin.text === '') return {kind:'clear-prompt',actor};
    const choices: {label:string;impulse:number}[] = [];
    for (const message of messages?.values() ?? []) if (message.kind === 'prompt-choice') choices.push({label:message.text,impulse:message.impulse});
    return {kind:'prompt',actor,title:begin.text,choices};
  }
  answerPrompt(actor: ActorId, impulse: number): boolean {
    const prompt = this.prompt(actor);
    if (prompt.kind !== 'prompt' || !prompt.choices.some(choice => choice.impulse === impulse)) return false;
    this.receive([{kind:'prompt-clear'}], actor); return true;
  }
  intermission(actor: ActorId): boolean { return this.clients.get(actor)?.has('intermission') === true; }
  presentation(actor: ActorId): readonly NetQuakeMessage[] {
    return [...(this.clients.get(actor)?.values() ?? [])].filter(message => message.kind === 'skybox' || message.kind === 'name' || message.kind === 'colors' || message.kind === 'frags' || message.kind === 'ping' || message.kind === 'social' || message.kind === 'player-info' || message.kind === 'prompt-begin' || message.kind === 'prompt-choice' || message.kind === 'prompt-clear' || message.kind === 'light-style' || message.kind === 'intermission' || message.kind === 'finale' || message.kind === 'cutscene' || message.kind === 'cd-track' || message.kind === 'pause');
  }
  capture() { return { baseline: [...this.baseline.values()], clients: [...this.clients].map(([actor, messages]) => ({actor,messages:[...messages.values()]})) }; }
  restore(baseline: readonly NetQuakeMessage[], clients: readonly {readonly actor: ActorId; readonly messages: readonly NetQuakeMessage[]}[]): void {
    this.baseline.clear(); this.clients.clear();
    for (const message of baseline) this.retained(this.baseline, message);
    for (const entry of clients) {
      if (this.clients.has(entry.actor)) throw new Error('Duplicate restored local QC client');
      const state = new Map<string, NetQuakeMessage>();
      for (const message of entry.messages) this.retained(state, message);
      this.clients.set(entry.actor,state);
    }
  }
}

export interface QuakeCLocalMessageHost {
  readonly actor: (slot: number) => ActorId;
  readonly recipients: readonly ActorId[];
  readonly sourceActor: ActorId;
  readonly map: string;
  readonly seconds: number;
  readonly camera: (actor: ActorId) => {readonly origin: import('../../../contracts/math.ts').Vec3; readonly angles: import('../../../contracts/math.ts').Vec3};
  readonly sound: (index: number) => string;
  readonly model: (index: number) => string;
  readonly emit: (event: import('../../../content/q1/foundation/types.ts').Q1Event, recipient?: ActorId) => void;
  readonly message: (event: import('../../../contracts/protocol.ts').NetworkEvent, actor: ActorId | null) => void;
  readonly music: (track: number) => void;
  readonly angles: (actor: ActorId, angles: import('../../../contracts/math.ts').Vec3) => void;
  readonly pause: (paused: boolean) => void;
  readonly sky: (name: string, recipient: ActorId | null) => void;
  readonly clientMetadata: (event: import('./types.ts').Q1ClientMetadataEvent, recipient: ActorId | null) => void;
  readonly session: (kind: 'level-completed' | 'back-to-lobby', recipient: ActorId | null) => void;
  readonly prompt: (value: Extract<Q1CompositionEvent, {readonly kind:'prompt' | 'clear-prompt'}>) => void;
  readonly fog: (value: Extract<NetQuakeMessage, {readonly kind:'fog'}>, recipient: ActorId | null) => void;
}

/** Decoded source services use the same common presentation events as source-authored TS games. */
export function presentQuakeCLocalMessage(message: NetQuakeMessage, target: ActorId | null, state: QuakeCLocalMessages, host: QuakeCLocalMessageHost): void {
  const recipients = target === null ? host.recipients : [target];
  switch (message.kind) {
    case 'server-vars': case 'set-views': case 'sequence': break;
    case 'level-completed': case 'back-to-lobby': host.session(message.kind,target); break;
    case 'prompt-begin': case 'prompt-choice': case 'prompt-clear':
      for (const actor of recipients) host.prompt(state.prompt(actor));
      break;
    case 'stat': if(message.index === 12) host.emit({kind:'monster-total',total:message.value}); break;
    case 'nop': case 'set-view': break;
    case 'name': case 'colors': case 'frags': case 'ping': case 'social': case 'player-info': host.clientMetadata(message,target); break;
    case 'skybox': host.sky(message.text,target); break;
    case 'raw-print': case 'chat': case 'botchat': host.message({kind:'print',level:2,text:message.text},target); break;
    case 'print': case 'center-print': case 'stufftext':
      host.message(message.kind === 'stufftext' ? {kind:'command-text',text:message.text} : message.kind === 'print'
        ? {kind:'print',level:2,text:message.text} : {kind:'center-print',text:message.text}, target); break;
    case 'disconnect': host.message({kind:'disconnect',reason:'Source disconnected client'}, target); break;
    case 'set-angle': for (const actor of recipients) host.angles(actor,message.angles); break;
    case 'light-style': host.emit({kind:'lightstyle',style:message.index,pattern:message.value}); break;
    case 'cd-track': host.music(message.track); break;
    case 'pause': host.pause(message.paused); break;
    case 'fog': host.fog(message,target); break;
    case 'bonus-flash':
      for (const actor of recipients) host.emit({kind:'effect',effect:'pickup',actor,origin:host.camera(actor).origin,amount:1},actor);
      break;
    case 'achievement': host.emit({kind:'achievement',player:target,id:message.text},target ?? undefined); break;
    case 'spawned-monster':
      for (const actor of recipients) host.emit({kind:'monster-total',total:state.stat(actor,12) ?? 0},actor);
      break;
    case 'local-sound':
      for (const actor of recipients) {
        const entity = state.view(actor), listener = entity === null ? actor : host.actor(entity);
        host.emit({kind:'sound',actor:listener,path:host.sound(message.index),channel:-1,volume:1,attenuation:1},actor);
      }
      break;
    case 'damage': host.message({kind:'q1-damage',armor:message.armor,blood:message.blood,source:message.source},target); break;
    case 'particle': host.message({kind:'q1-particle',origin:message.origin,direction:message.direction,count:message.count,color:message.color},target); break;
    case 'killed-monster': case 'found-secret':
      for (const actor of recipients) host.emit({kind:message.kind === 'found-secret' ? 'secret' : 'monster-killed',actor,
        total:state.stat(actor,message.kind === 'found-secret' ? 11 : 12) ?? 0,found:state.stat(actor,message.kind === 'found-secret' ? 13 : 14) ?? 0}); break;
    case 'intermission': {
      for (const actor of recipients) host.emit({kind:'intermission',...host.camera(actor),map:host.map,exitAfter:host.seconds + 5,track:0},actor);
      break;
    }
    case 'finale': case 'cutscene': host.emit({kind:'finale',text:message.text,stage:message.kind === 'finale' ? 4 : 1}); break;
    case 'sell-screen': host.message({kind:'command-text',text:'help\n'},target); break;
    case 'sound': case 'static-sound': {
      const path = host.sound(message.index);
      if (message.kind === 'static-sound') host.emit({kind:'ambient',path,origin:message.origin,volume:message.volume/255,attenuation:message.attenuation});
      else {
        const channels: readonly import('../../../content/q1/foundation/types.ts').Q1SoundChannel[] = ['auto','weapon','voice','item','body',5,6,7];
        const channel = channels[message.channel]; if (channel === undefined) throw new Error('Invalid local QC sound channel');
        host.emit({kind:'sound',actor:host.actor(message.entity),path,channel,origin:message.origin,volume:message.volume/255,attenuation:message.attenuation});
      }
      break;
    }
    case 'stop-sound': host.emit({kind:'stop-sound',actor:host.actor(message.entity),channel:message.channel}); break;
    case 'static': host.emit({kind:'static-model',path:host.model(message.state.modelIndex),frame:message.state.frame,
      colorMap:message.state.colorMap,skin:message.state.skin,origin:message.state.origin,angles:message.state.angles}); break;
    // Owner-aware temporary effects are translated once by QcBroadcastMessages.
    case 'temporary-entity': break;
    default: throw new Error(`Unsupported local QuakeC service ${message.kind}`);
  }
}
