import type { ActorId } from '../../../contracts/identity.ts';
import type { Q1CompositionEvent } from '../../../content/composition/q1/types.ts';
import type { NetQuakeMessage } from '../../../network/q1/netquake.ts';

const STATE_SERVER_VARS = 0;
const STATE_SET_VIEWS = 1;
const STATE_SEQUENCE = 2;
const STATE_LEVEL_COMPLETED = 3;
const STATE_BACK_TO_LOBBY = 4;
const STATE_PROMPT_BEGIN = 5;
const STATE_PROMPT_CHOICE = 6;
const STATE_STAT = 7;
const STATE_LIGHT_STYLE = 8;
const STATE_NAME = 9;
const STATE_COLORS = 10;
const STATE_FRAGS = 11;
const STATE_PING = 12;
const STATE_SOCIAL = 13;
const STATE_PLAYER_INFO = 14;
const STATE_SET_VIEW = 15;
const STATE_SET_ANGLE = 16;
const STATE_PAUSE = 17;
const STATE_CD_TRACK = 18;
const STATE_FOG = 19;
const STATE_SKYBOX = 20;
const STATE_INTERMISSION = 21;
function stateKey(category: number, discriminator = 0): number { return discriminator * 32 + category; }
type LocalMessageState = Map<number, NetQuakeMessage>;

/** Client-owned service state, separate from the module's authoritative edict fields. */
export class QuakeCLocalMessages {
  private readonly baseline: LocalMessageState = new Map<number, NetQuakeMessage>();
  private readonly clients = new Map<ActorId, LocalMessageState>();
  private baselineView: ActorId | null = null;
  private readonly views = new Map<ActorId, ActorId>();
  private retained(state: LocalMessageState, message: NetQuakeMessage): void {
    switch (message.kind) {
      case 'server-vars': state.set(stateKey(STATE_SERVER_VARS), message); break;
      case 'set-views': state.set(stateKey(STATE_SET_VIEWS), message); break;
      case 'sequence': state.set(stateKey(STATE_SEQUENCE), message); break;
      case 'level-completed': state.set(stateKey(STATE_LEVEL_COMPLETED), message); break;
      case 'back-to-lobby': state.set(stateKey(STATE_BACK_TO_LOBBY), message); break;
      case 'prompt-begin': case 'prompt-clear':
        for (const key of state.keys()) if (key % 32 === STATE_PROMPT_BEGIN || key % 32 === STATE_PROMPT_CHOICE) state.delete(key);
        state.set(stateKey(STATE_PROMPT_BEGIN), message); break;
      case 'prompt-choice': {
        const begin = state.get(stateKey(STATE_PROMPT_BEGIN));
        if (begin?.kind === 'prompt-begin' && begin.text !== '') {
          const count = [...state.values()].filter(value => value.kind === 'prompt-choice').length;
          state.set(stateKey(STATE_PROMPT_CHOICE, count), message);
        }
        break;
      }
      case 'stat':
        if (!Number.isInteger(message.index) || message.index < 0 || message.index >= 32) throw new Error('Invalid NetQuake client stat');
        state.set(stateKey(STATE_STAT, message.index), message); break;
      case 'killed-monster': case 'found-secret': {
        const index = message.kind === 'killed-monster' ? 14 : 13, old = state.get(stateKey(STATE_STAT, index));
        state.set(stateKey(STATE_STAT, index), {kind:'stat',index,value:(old?.kind === 'stat' ? old.value : 0) + 1}); break;
      }
      case 'spawned-monster': {
        const old = state.get(stateKey(STATE_STAT, 12)); state.set(stateKey(STATE_STAT, 12), {kind:'stat',index:12,value:(old?.kind === 'stat' ? old.value : 0) + message.value}); break;
      }
      case 'light-style': state.set(stateKey(STATE_LIGHT_STYLE, message.index), message); break;
      case 'name': state.set(stateKey(STATE_NAME, message.slot), message); break;
      case 'colors': state.set(stateKey(STATE_COLORS, message.slot), message); break;
      case 'frags': state.set(stateKey(STATE_FRAGS, message.slot), message); break;
      case 'ping': state.set(stateKey(STATE_PING, message.slot), message); break;
      case 'social': state.set(stateKey(STATE_SOCIAL, message.slot), message); break;
      case 'player-info': state.set(stateKey(STATE_PLAYER_INFO, message.slot), message); break;
      case 'set-view': state.set(stateKey(STATE_SET_VIEW), message); break;
      case 'set-angle': state.set(stateKey(STATE_SET_ANGLE), message); break;
      case 'pause': state.set(stateKey(STATE_PAUSE), message); break;
      case 'cd-track': state.set(stateKey(STATE_CD_TRACK), message); break;
      case 'fog': state.set(stateKey(STATE_FOG), message); break;
      case 'skybox': state.set(stateKey(STATE_SKYBOX), message); break;
      case 'intermission': case 'finale': case 'cutscene': state.set(stateKey(STATE_INTERMISSION), message); break;
      default: break;
    }
  }
  admit(actor: ActorId): void { if (!this.clients.has(actor)) { this.clients.set(actor, new Map(this.baseline));
    if (this.baselineView !== null) this.views.set(actor, this.baselineView); } }
  hasClient(actor: ActorId): boolean { return this.clients.has(actor); }
  retire(actor: ActorId): void { this.clients.delete(actor); this.views.delete(actor);
    if (this.baselineView?.equals(actor) === true) this.baselineView = null;
    for (const [recipient, target] of this.views) if (target.equals(actor)) this.views.delete(recipient); }
  receive(messages: readonly NetQuakeMessage[], actor: ActorId | null, viewTarget?: ActorId | null): void {
    if (actor !== null) this.admit(actor);
    for (const message of messages) if (message.kind === 'set-view' && viewTarget !== undefined) {
      if (actor === null) { this.baselineView = viewTarget; for (const recipient of this.clients.keys()) {
        if (viewTarget === null) this.views.delete(recipient); else this.views.set(recipient, viewTarget);
      } } else if (viewTarget === null) this.views.delete(actor); else this.views.set(actor, viewTarget);
    }
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
    const message = this.clients.get(actor)?.get(stateKey(STATE_STAT, index));
    return message?.kind === 'stat' ? message.value : null;
  }
  angles(actor: ActorId) { const message = this.clients.get(actor)?.get(stateKey(STATE_SET_ANGLE)); return message?.kind === 'set-angle' ? message.angles : null; }
  view(actor: ActorId): number | null { const message = this.clients.get(actor)?.get(stateKey(STATE_SET_VIEW)); return message?.kind === 'set-view' ? message.entity : null; }
  viewTarget(actor: ActorId): ActorId | null { return this.views.get(actor) ?? null; }
  captureViews() { return { baseline: this.baselineView, clients: [...this.views].map(([actor, target]) => ({ actor, target })) }; }
  restoreViews(baseline: ActorId | null, clients: readonly { readonly actor: ActorId; readonly target: ActorId }[]): void {
    this.baselineView = baseline; this.views.clear();
    for (const entry of clients) {
      if (!this.clients.has(entry.actor) || this.views.has(entry.actor)) throw new Error('Invalid retained QC view recipient');
      this.views.set(entry.actor, entry.target);
    }
  }
  sessionState(actor: ActorId) {
    const state = this.clients.get(actor), server = state?.get(stateKey(STATE_SERVER_VARS)), views = state?.get(stateKey(STATE_SET_VIEWS)), sequence = state?.get(stateKey(STATE_SEQUENCE));
    return {serverVars:server?.kind === 'server-vars' ? server.text : '',views:views?.kind === 'set-views' ? views.value : 1,
      sequence:sequence?.kind === 'sequence' ? sequence.value : 0,levelCompleted:state?.has(stateKey(STATE_LEVEL_COMPLETED)) === true,backToLobby:state?.has(stateKey(STATE_BACK_TO_LOBBY)) === true};
  }
  prompt(actor: ActorId): Extract<Q1CompositionEvent, {readonly kind:'prompt' | 'clear-prompt'}> {
    const messages = this.clients.get(actor), begin = messages?.get(stateKey(STATE_PROMPT_BEGIN));
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
  intermission(actor: ActorId): boolean { return this.clients.get(actor)?.has(stateKey(STATE_INTERMISSION)) === true; }
  presentation(actor: ActorId): readonly NetQuakeMessage[] {
    return [...(this.clients.get(actor)?.values() ?? [])].filter(message => message.kind === 'skybox' || message.kind === 'name' || message.kind === 'colors' || message.kind === 'frags' || message.kind === 'ping' || message.kind === 'social' || message.kind === 'player-info' || message.kind === 'prompt-begin' || message.kind === 'prompt-choice' || message.kind === 'prompt-clear' || message.kind === 'light-style' || message.kind === 'intermission' || message.kind === 'finale' || message.kind === 'cutscene' || message.kind === 'cd-track' || message.kind === 'pause');
  }
  capture() { return { baseline: [...this.baseline.values()], clients: [...this.clients].map(([actor, messages]) => ({actor,messages:[...messages.values()]})) }; }
  restore(baseline: readonly NetQuakeMessage[], clients: readonly {readonly actor: ActorId; readonly messages: readonly NetQuakeMessage[]}[]): void {
    this.baseline.clear(); this.clients.clear(); this.baselineView = null; this.views.clear();
    for (const message of baseline) this.retained(this.baseline, message);
    for (const entry of clients) {
      if (this.clients.has(entry.actor)) throw new Error('Duplicate restored local QC client');
      const state: LocalMessageState = new Map<number, NetQuakeMessage>();
      for (const message of entry.messages) this.retained(state, message);
      this.clients.set(entry.actor,state);
    }
  }
}

/** Source camera targets retain the generation captured by WriteEntity. */
export function quakeCLocalView(actor: ActorId, state: Pick<QuakeCLocalMessages, "viewTarget" | "angles" | "intermission">,
  source: { read(actor: ActorId): { readonly origin: import('../../../contracts/math.ts').Vec3; readonly angles: import('../../../contracts/math.ts').Vec3 } | null;
    offset(actor: ActorId): import('../../../contracts/math.ts').Vec3 }): import('./types.ts').PlayerView | null {
  const intermission = state.intermission(actor), target = state.viewTarget(actor);
  if (!intermission && (target === null || target.equals(actor))) return null;
  const viewed = source.read(target ?? actor);
  if (viewed === null) return null;
  const offset = intermission ? { x: 0, y: 0, z: 0 } : source.offset(actor);
  return { origin: { x: viewed.origin.x + offset.x, y: viewed.origin.y + offset.y, z: viewed.origin.z },
    viewHeight: offset.z, angles: state.angles(actor) ?? viewed.angles };
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
        const listener = state.viewTarget(actor) ?? actor;
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
