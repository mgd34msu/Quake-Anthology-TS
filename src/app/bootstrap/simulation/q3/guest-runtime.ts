import type { ArsenalState } from "../../../../contracts/movement.ts";
import { Q3GuestBots, type Q3GuestBotOptions } from './guest-bots.ts';
import { tokenizeCommand } from '../../../../core/commands/index.ts';
import type { QvmCheckpoint } from '../../../../contracts/execution.ts';
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from '../../../../persistence/value.ts';
import { savedActorId, readSavedActor } from '../../../../persistence/save-image.ts';
import type { QvmHostCheckpoint } from '../../../../compat/qvm/module.ts';
import type { ActorId, ClientId } from '../../../../contracts/identity.ts';
import type { MountedContent } from '../../../../content/mounts/index.ts';
import type { UserFileStore } from '../../../../platform/files/writable.ts';
import type { WireUserCommand } from '../../../../network/q3/message.ts';
import { CommonParseCursor, CommonParseState } from '../../../../core/common-parse.ts';
import { QvmGame } from '../../../../compat/qvm/game.ts';
import { QvmInputBinding, type QvmInputDefinition, type QvmInputServices } from '../../../../compat/qvm/game-input.ts';
import type { QvmFunctionCall, QvmSystemCallResult } from '../../../../compat/qvm/interpreter.ts';
import type { ModClientIdentity } from '../../../../world/session/mod-clients.ts';
import { QvmGameExport, QvmGameImport } from '../../../../compat/qvm/abi.ts';
import { qvmArguments } from '../../../../compat/qvm/module.ts';
import type { QvmModuleOptions } from '../../../../compat/qvm/module.ts';
import { QvmFiles, qvmFileSyscall } from '../../../../compat/qvm/file-syscalls.ts';
import { qvmCommonSyscall } from '../../../../compat/qvm/common-syscalls.ts';
import type { QvmCommonServices } from '../../../../compat/qvm/common-syscalls.ts';
import { qvmServerGameSyscall } from '../../../../compat/qvm/server-game-syscalls.ts';
import type { QvmServerGameServices } from '../../../../compat/qvm/server-game-syscalls.ts';
import { rejectQvmSyscall } from '../../../../compat/qvm/syscalls.ts';
import type { QvmHostCall, QvmHostResult } from '../../../../compat/qvm/syscalls.ts';
import type { Q3ApplicationAdmission, Q3ApplicationPlayer } from '../../network/q3-types.ts';
import { Q3GuestRecords } from './guest-records.ts';
import type { Q3GuestRecordHost } from './guest-records.ts';
import { Q3GuestSpatial } from './guest-spatial.ts';
import type { Q3ServerState } from './server-state.ts';

export interface Q3GuestBotPreparation {
  readonly library: Omit<Q3GuestBotOptions['library'], 'clientCommand'>;
  readonly selected: Q3GuestBotOptions['selected'];
  createClient(slot: number): ClientId | null;
  freeClient(client: ClientId): void;
  snapshotEntities(player: Q3ApplicationPlayer): readonly number[];
}
export interface Q3GuestOutput {
  dropClient(slot: number, reason: string): Promise<void>;
  sendServerCommand(slot: number, text: string): void | Promise<void>;
  configstring(index: number, value: string): void | Promise<void>;
}
export interface Q3GuestRuntimeOptions {
  readonly artifact: QvmModuleOptions['artifact'];
  readonly state: Q3ServerState;
  readonly records: Q3GuestRecordHost;
  readonly mounts: MountedContent;
  readonly writable: UserFileStore;
  readonly maxClients: number;
  readonly dedicated?: boolean;
  readonly seed: number;
  readonly entityText: string;
  readonly common: Pick<Extract<QvmCommonServices, { readonly role: 'qagame' }>, 'milliseconds' | 'realTime' | 'commands'>;
  now(): number;
  assertCurrent(): void;
  beforeDisconnect?(actor: ActorId): void;
  beforeRetire?(): void;
  sourceRestored?(): void;
  arsenal?(actor: ActorId): ArsenalState;
  clientChanged?(kind: 'admitted' | 'userinfo', actor: ActorId): void;
  botCommand?(actor: ActorId, command: WireUserCommand): void;
}
export type Q3SavedGuestClientId = Pick<ClientId, 'slot' | 'generation'>;
export interface Q3GuestMapClient { readonly client: ClientId; readonly userinfo: string; readonly bot?: boolean; }
export interface Q3GuestMapTransition {
  /** Restore through the destination registry before applying its new map settings. */
  readonly cvars: ReturnType<Q3ServerState['cvars']['captureSaveState']>;
  readonly clients: readonly Q3GuestMapClient[];
}
export type Q3GuestInitialization = { readonly kind: 'new' }
  | { readonly kind: 'map-change' | 'map-restart'; readonly clients: readonly Q3GuestMapClient[] };
function readGuestClients(reader: SaveReader) {
  return reader.list(entry => ({ sourceEntity: entry.field('sourceEntity').integer(0),
    client: { slot: entry.field('client').field('slot').integer(0), generation: entry.field('client').field('generation').integer(0) },
    actor: readSavedActor(entry.field('actor')), phase: entry.field('phase').choice('connected', 'active') }));
}

export function savedQ3GuestClients(checkpoint: QvmCheckpoint) {
  if (checkpoint.hostState.format !== 'q3:qagame-host') throw new Error('Unsupported Q3 guest host checkpoint format');
  const reader = new SaveReader(decodeCheckpointValue(checkpoint.hostState.bytes), 'q3.guest.host');
  reader.field('version').literal(1);
  const maximum = reader.field('maxClients').integer(1), slots = new Set<number>();
  if (maximum > 64) reader.fail('invalid guest client capacity');
  const clients = readGuestClients(reader.field('clients'));
  for (const entry of clients) {
    if (entry.sourceEntity >= maximum || entry.sourceEntity !== entry.client.slot || slots.has(entry.sourceEntity)) reader.fail('invalid or duplicate source client slot');
    slots.add(entry.sourceEntity);
  }
  return clients;
}

type Lifecycle = { readonly kind: 'created' | 'restoring' | 'restored' } | { readonly kind: 'retired' }
  | { readonly kind: 'initializing' | 'running' | 'shutting-down'; readonly output: Q3GuestOutput };
interface ClientEntry {
  readonly player: Q3ApplicationPlayer;
  disconnectNotified?: boolean;
  phase: { readonly kind: 'connecting' | 'connected' | 'active' } | { readonly kind: 'dropping'; readonly reason: string };
}
interface InputRetirement {
  readonly identity: ModClientIdentity;
  readonly entry: ClientEntry | null;
  phase: 'pending' | 'disconnecting' | 'complete';
}

/** The guest owns all game-private state; application operations own external serialization. */
export class Q3QvmServerGame {
  readonly state: Q3ServerState;
  readonly game: QvmGame;
  readonly records: Q3GuestRecords;
  readonly spatial: Q3GuestSpatial;
  private readonly files: QvmFiles;
  private bots: Q3GuestBots | null = null;
  private savedBots: unknown = null;
  private botPreparation: Q3GuestBotPreparation | null = null;
  private readonly botClients = new Set<number>();
  private readonly pendingBotAdmissions = new Set<number>();
  private readonly botMessages = new Map<number, string[]>();
  private readonly services: QvmServerGameServices;
  private readonly common: Extract<QvmCommonServices, { readonly role: 'qagame' }>;
  private lifecycle: Lifecycle = { kind: 'created' };
  private externalOperations = 0;
  private currentCall: QvmHostCall | null = null;
  private readonly cursor: CommonParseCursor;
  private readonly parser = new CommonParseState();
  private restoreClient: ((saved: Q3SavedGuestClientId) => ClientId) | null = null;
  private readonly clients = new Map<number, ClientEntry>();
  private readonly reconnecting = new Map<number, Q3GuestMapClient>();
  private inputBinding: QvmInputBinding | null = null;
  private readonly inputRetirements = new Map<number, InputRetirement>();

  playerArsenal(actor: ActorId): ArsenalState | null { this.current(); return this.options.arsenal?.(actor) ?? null; }

  bindInput(definition: QvmInputDefinition, services: QvmInputServices): void {
    this.inputBinding?.close();
    this.inputBinding = new QvmInputBinding({ game: this.game, definition,
      retiring: (slot, identity) => this.retireInput(slot, identity), retired: slot => this.records.isInputRetired(slot),
      disconnect: (slot, identity, call) => this.disconnectInput(slot, identity, call),
      movement: (slot, run) => this.records.withInputMotion(slot, run) }, services);
  }
  private retireInput(slot: number, identity: ModClientIdentity): void {
    const existing = this.inputRetirements.get(slot);
    if (existing !== undefined) {
      if (!existing.identity.actor.equals(identity.actor) || !existing.identity.client.equals(identity.client)) throw new Error('QVM input retirement changed client generation');
      return;
    }
    const entry = this.clients.get(slot) ?? null;
    if (entry !== null && (!entry.player.actor.equals(identity.actor) || !entry.player.client.equals(identity.client)))
      throw new Error('QVM input retirement does not own its source client');
    this.records.retireInputClient(slot);
    this.inputRetirements.set(slot, { identity, entry, phase: entry === null ? 'complete' : 'pending' });
  }
  private disconnectInput(slot: number, identity: ModClientIdentity, call: QvmFunctionCall): QvmSystemCallResult {
    this.retireInput(slot, identity);
    const retirement = this.inputRetirements.get(slot);
    if (retirement === undefined) throw new Error('QVM input retirement was lost');
    if (retirement.phase !== 'pending') return 0;
    retirement.phase = 'disconnecting';
    const entry = retirement.entry;
    if (entry !== null) { this.notifyDisconnect(entry); entry.phase = { kind: 'dropping', reason: 'Client input actor was removed.' }; }
    const complete = (result: number): number => { retirement.phase = 'complete'; return result; };
    const args = qvmArguments([QvmGameExport.GAME_CLIENT_DISCONNECT, slot]);
    return call.execution === 'synchronous' ? complete(call.invoke(args)) : call.invokeAsync(args).then(complete);
  }
  private finishExternalOperation(): void {
    this.externalOperations--;
    if (this.externalOperations !== 0 || this.game.module.interpreter.isActive) return;
    for (const [slot, retirement] of this.inputRetirements) {
      if (retirement.phase !== 'complete') continue;
      if (retirement.entry !== null && this.clients.get(slot) === retirement.entry) this.release(retirement.entry);
      if (this.botClients.delete(slot)) this.botPreparation?.freeClient(retirement.identity.client);
      this.botMessages.delete(slot); this.pendingBotAdmissions.delete(slot);
      this.records.finishInputRetirement(slot); this.inputRetirements.delete(slot);
    }
  }

  constructor(private readonly options: Q3GuestRuntimeOptions) {
    if (!Number.isInteger(options.maxClients) || options.maxClients < 1 || options.maxClients > 64) throw new RangeError('Q3 guest requires 1..64 clients');
    this.state = options.state;
    this.state.cvars.register('bot_enable', '1', 0);
    this.state.cvars.set('sv_maxclients', String(options.maxClients), true);
    this.state.cvars.set('dedicated', options.dedicated === false ? '0' : '1', true);
    this.files = new QvmFiles({ mounts: options.mounts, writable: options.writable, print: text => this.state.print(text), assertCurrent: () => this.current() });
    this.game = new QvmGame({ artifact: options.artifact, host: call => this.host(call), hostState: {
      checkpoint: () => this.captureHost(), restore: state => { this.restoreHost(state); return undefined; },
    } });
    try {
      this.game.data.setClientCount(options.maxClients);
      this.records = new Q3GuestRecords(this.game.data, options.records);
      this.spatial = new Q3GuestSpatial(this.records, options.records.scene, this.state.cvars);
    } catch (error) { this.files.closeAll(); this.game.retire(); throw error; }
    this.common = { ...options.common, role: 'qagame', cvars: this.state.cvars, print: text => this.state.print(text), arguments: () => [] };
    this.cursor = new CommonParseCursor(options.entityText);
    this.services = { data: this.game.data, cvars: this.state.cvars, maxClients: options.maxClients, spatial: this.spatial,
      configstrings: { get: index => this.state.configstrings.get(index), set: (index, value) => this.setConfigstring(index, value) },
      getUserinfo: slot => this.state.getUserinfo(slot) ?? '', setUserinfo: (slot, value) => this.state.setUserinfo(slot, value),
      getUserCommand: slot => this.state.getUserCommand(slot) ?? { serverTime: 0, angles: [0, 0, 0], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }, dropClient: (slot, reason) => this.drop(slot, reason),
      sendServerCommand: (slot, text) => {
        for (const [client, messages] of this.botMessages) if (slot === -1 || slot === client) { messages.push(text); if (messages.length > 64) messages.shift(); }
        if (this.botClients.has(slot)) return;
        return this.output().sendServerCommand(slot, text);
      },
      entityToken: () => ({ token: this.parser.parse(this.cursor), ended: this.cursor.offset === null }),
    };
  }
  attachBots(preparation: Q3GuestBotPreparation): void {
    this.current();
    if (this.bots !== null || (this.lifecycle.kind !== 'created' && this.lifecycle.kind !== 'restored')) throw new Error('Attach guest bot services before game initialization');
    this.botPreparation = preparation;
    this.bots = new Q3GuestBots({ library: { ...preparation.library, clientCommand: (slot, text) => {
      if (!this.botClients.has(slot)) throw new Error(`Bot command has no owned client ${slot}`);
      this.game.clientCommand(slot, tokenizeCommand(text, 'q3').argv); this.admitPendingBots(); return undefined;
    } }, selected: preparation.selected, records: this.records, spatial: this.spatial, entities: this.options.entityText,
      mapName: this.state.cvars.variableString('mapname'), clients: {
        allocateClient: () => {
          for (let slot = 0; slot < this.options.maxClients; slot++) {
            if (this.clients.has(slot) || this.reconnecting.has(slot) || this.inputRetirements.has(slot)) continue;
            const client = preparation.createClient(slot); if (client === null) continue;
            this.records.entity(slot).s.number = slot;
            const player = { client, actor: this.records.actor(slot).id, sourceEntity: slot };
            this.validateClient(client); this.clients.set(slot, { player, phase: { kind: 'active' } }); this.botClients.add(slot); this.pendingBotAdmissions.add(slot); this.botMessages.set(slot, []); return slot;
          }
          return -1;
        },
        freeClient: slot => {
          if (!this.botClients.delete(slot)) return;
          this.records.entity(slot).r.svFlags &= ~8;
          const entry = this.clients.get(slot); if (entry !== undefined) { this.notifyDisconnect(entry); this.release(entry); preparation.freeClient(entry.player.client); }
          this.pendingBotAdmissions.delete(slot);
          this.botMessages.delete(slot);
        },
        snapshotEntity: (slot, sequence) => { const entry = this.clients.get(slot); return entry === undefined ? -1 : preparation.snapshotEntities(entry.player)[sequence] ?? -1; },
        consoleMessage: slot => this.botMessages.get(slot)?.shift() ?? null,
        userCommand: async (slot, command) => {
          if (!this.botClients.has(slot)) throw new Error(`Bot input has no owned client ${slot}`);
          const entry = this.clients.get(slot); if (entry === undefined) throw new Error('Bot input lost its source client');
          this.admitPendingBots(); this.options.botCommand?.(entry.player.actor, command);
          this.state.setUserCommand(slot, command); await this.game.clientThinkAsync(slot);
        },
      } });
    if (this.savedBots !== null) { this.bots.restore(this.savedBots); this.savedBots = null; }
  }
  get isRetired(): boolean { return this.lifecycle.kind === 'retired'; }

  checkpoint(): QvmCheckpoint { return this.game.module.checkpoint(); }

  private portalWorld() { return this.spatial.world; }

  private captureHost(): QvmHostCheckpoint {
    this.running();
    if (this.externalOperations !== 0 || this.currentCall !== null || this.reconnecting.size !== 0 || this.inputRetirements.size !== 0 || [...this.clients.values()].some(entry => entry.phase.kind !== 'connected' && entry.phase.kind !== 'active')) {
      throw new Error('Q3 guest checkpoint requires completed client operations');
    }
    return { state: { module: this.game.module.profile.module, format: 'q3:qagame-host', bytes: encodeCheckpointValue({
      version: 1, maxClients: this.game.data.numClients, data: this.game.data.checkpoint(), server: this.state.captureSaveState(),
      entityText: this.cursor.source, cursor: this.cursor.offset, parser: this.parser.captureSaveState(),
      bots: this.bots?.checkpoint() ?? null, botClients: [...this.botClients], botMessages: [...this.botMessages].map(([slot, messages]) => ({ slot, messages })),
      records: this.records.captureCheckpoint(), portals: this.portalWorld().capturePortalCheckpoint(), files: this.files.captureCheckpoint(),
      clients: [...this.clients.values()].map(entry => ({ sourceEntity: entry.player.sourceEntity,
        client: { slot: entry.player.client.slot, generation: entry.player.client.generation },
        actor: savedActorId(entry.player.actor), phase: entry.phase.kind })),
    }) }, random: [], callbacks: [] };
  }

  restoreCheckpoint(checkpoint: QvmCheckpoint, resolveClient: (saved: Q3SavedGuestClientId) => ClientId): void {
    this.current();
    if (this.lifecycle.kind !== 'created') throw new Error('Q3 guest restore requires an inert candidate');
    this.lifecycle = { kind: 'restoring' }; this.restoreClient = resolveClient;
    try { this.game.module.restore(checkpoint); this.lifecycle = { kind: 'restored' }; }
    catch (error) {
      try { this.discard(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Q3 guest restore and discard failed'); }
      throw error;
    } finally { this.restoreClient = null; }
  }

  private restoreHost(checkpoint: QvmHostCheckpoint): void {
    const resolveClient = this.restoreClient;
    if (this.lifecycle.kind !== 'restoring' || resolveClient === null) throw new Error('Q3 guest host restore requires the candidate restore operation');
    if (checkpoint.state.format !== 'q3:qagame-host' || checkpoint.callbacks.length !== 0 || checkpoint.random.length !== 0) {
      throw new Error('Unsupported Q3 guest host checkpoint format, callbacks or external random streams');
    }
    this.options.sourceRestored?.();
    const reader = new SaveReader(decodeCheckpointValue(checkpoint.state.bytes), 'q3.guest.host');
    reader.field('version').literal(1); reader.field('maxClients').literal(this.options.maxClients);
    reader.field('entityText').literal(this.cursor.source);
    const data = reader.field('data');
    this.game.data.setClientCount(this.options.maxClients);
    this.game.data.restore({ entitiesWord: data.field('entitiesWord').integer(), numEntities: data.field('numEntities').integer(0),
      entityStride: data.field('entityStride').integer(0), clientsWord: data.field('clientsWord').integer(), clientStride: data.field('clientStride').integer(0) });
    this.state.restoreSaveState(reader.field('server').value);
    this.current();
    this.cursor.offset = reader.field('cursor').nullable(offset => offset.integer(0));
    this.parser.restoreSaveState(reader.field('parser').value);
    this.portalWorld().restorePortalCheckpoint(reader.field('portals').value);
    this.records.restoreCheckpoint(reader.field('records').value);
    const clients = readGuestClients(reader.field('clients'));
    for (const saved of clients) {
      const actor = this.options.records.actors.resolveSaved(saved.actor), client = resolveClient(saved.client);
      if (saved.sourceEntity >= this.options.maxClients || saved.sourceEntity !== saved.client.slot || this.clients.has(saved.sourceEntity)
        || client.session !== this.options.records.actors.session || client.slot !== saved.sourceEntity || actor === null
        || this.records.slot(actor.id) !== saved.sourceEntity) throw reader.fail('invalid restored guest client binding');
      this.clients.set(saved.sourceEntity, { player: { client, actor: actor.id, sourceEntity: saved.sourceEntity }, phase: { kind: saved.phase } });
    }
    this.files.restoreCheckpoint(reader.field('files').value);
    this.savedBots = reader.field('bots').value ?? null;
    const savedClients = reader.field('botClients');
    if (savedClients.value !== undefined) for (const slot of savedClients.list(cell => cell.integer(0))) {
      if (!this.clients.has(slot) || this.botClients.has(slot)) throw new Error('Invalid saved guest bot slot');
      this.botClients.add(slot);
    }
    const messages = reader.field('botMessages');
    if (messages.value !== undefined) for (const entry of messages.list(cell => ({ slot: cell.field('slot').integer(0), messages: cell.field('messages').list(text => text.string()) }))) {
      if (!this.botClients.has(entry.slot) || this.botMessages.has(entry.slot)) throw new Error('Invalid saved guest bot message owner');
      this.botMessages.set(entry.slot, [...entry.messages]);
    }
  }

  completeRestore(output: Q3GuestOutput): void {
    this.current();
    if (this.lifecycle.kind !== 'restored') throw new Error('Q3 guest restore is not ready for output attachment');
    if (this.savedBots !== null) throw new Error('Saved guest bot services must be restored before output attachment');
    this.lifecycle = { kind: 'running', output };
  }

  discard(): void {
    if (this.lifecycle.kind === 'retired') return;
    if (this.externalOperations !== 0 || this.game.module.interpreter.isActive) throw new Error('Q3 guest discard must await the active operation');
    this.inputBinding?.close(); this.inputBinding = null; this.inputRetirements.clear();
    const errors: unknown[] = [];
    try { this.bots?.close(); } catch (error) { errors.push(error); }
    try { this.files.closeAll(); } catch (error) { errors.push(error); }
    try { this.options.beforeRetire?.(); } catch (error) { errors.push(error); }
    try { this.records.close(); } catch (error) { errors.push(error); }
    this.game.retire(); this.clients.clear(); this.reconnecting.clear(); this.lifecycle = { kind: 'retired' };
    if (errors.length !== 0) throw new AggregateError(errors, 'Q3 guest discard failed');
  }

  private current(): void {
    if (this.lifecycle.kind === 'retired') throw new Error('Q3 guest is retired');
    this.options.assertCurrent();

  }
  private running(): void {
    this.current();
    if (this.lifecycle.kind !== 'running') throw new Error('Q3 guest is not running');
    if (this.game.module.interpreter.isActive) throw new Error('Q3 guest already has an active external operation');
  }
  private output(): Q3GuestOutput {
    const lifecycle = this.lifecycle;
    if (lifecycle.kind !== 'initializing' && lifecycle.kind !== 'running' && lifecycle.kind !== 'shutting-down') throw new Error('Q3 guest output is unavailable');
    return lifecycle.output;
  }
  private host(call: QvmHostCall): QvmHostResult {
    this.current();
    const previous = this.currentCall;
    this.currentCall = call;
    try {
      const result = qvmCommonSyscall(call, this.common) ?? qvmFileSyscall(call, this.files)
        ?? qvmServerGameSyscall(call, this.services) ?? this.bots?.syscall(call) ?? this.disabledBot(call) ?? rejectQvmSyscall(call);
      if (result instanceof Promise) return result.then(value => { this.current(); return value; }).finally(() => { this.currentCall = previous; });
      this.current(); this.currentCall = previous; return result;
    } catch (error) { this.currentCall = previous; throw error; }
  }
  private disabledBot(call: QvmHostCall): number | null {
    if (call.kind !== 'engine' || call.role !== 'qagame') return null;
    switch (call.code) {
      case QvmGameImport.BOTLIB_SETUP: return 0;
      case QvmGameImport.BOTLIB_AAS_INITIALIZED: return 0;
      case QvmGameImport.BOTLIB_SHUTDOWN: this.state.print('BotLibShutdown: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_START_FRAME: this.state.print('BotStartFrame: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_LOAD_MAP: this.state.print('BotLoadMap: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_UPDATENTITY: this.state.print('BotUpdateEntity: bot library used before being setup\n'); return 1;
      case QvmGameImport.BOTLIB_TEST: return 0;
      default: return null;
    }
  }
  get timeMilliseconds(): number { this.current(); return this.options.now(); }
  setConfigstring(index: number, value: string): void | Promise<void> {
    this.current();
    if (this.state.configstrings.get(index) === value) return;
    this.state.configstrings.set(index, value);
    return this.output().configstring(index, value);
  }
  private async refreshServerInfo(): Promise<void> {
    this.current();
    const value = this.state.refreshServerInfo();
    if (value !== null) await this.output().configstring(0, value);
    this.current();
  }

  async initialize(output: Q3GuestOutput, start: Q3GuestInitialization = { kind: 'new' }): Promise<void> {
    this.current();
    if (this.lifecycle.kind !== 'created') throw new Error('Q3 guest has already initialized');
    if (start.kind !== 'new') {
      const slots = new Set<number>();
      for (const entry of start.clients) {
        this.validateClient(entry.client);
        if (slots.has(entry.client.slot)) throw new Error('Q3 map transition repeats a client slot');
        slots.add(entry.client.slot);
      }
      for (const entry of start.clients) {
        this.reconnecting.set(entry.client.slot, entry);
        this.state.setUserinfo(entry.client.slot, entry.userinfo);
        if (entry.bot === true) { this.botClients.add(entry.client.slot); this.botMessages.set(entry.client.slot, []); }
      }
    }
    if (this.bots === null && this.state.cvars.variableValue('bot_enable') !== 0) throw new Error('Q3 guest bot services must be attached before initialization');
    this.lifecycle = { kind: 'initializing', output };
    try {
      await this.game.initializeAsync(this.options.now(), this.options.seed, start.kind === 'map-restart');
      await this.refreshServerInfo();
      this.current(); this.lifecycle = { kind: 'running', output }; this.admitPendingBots();
    } catch (error) {
      try { await this.shutdown(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Q3 guest initialization and cleanup failed'); }
      throw error;
    }
  }
  async connect(client: ClientId, userinfo: string): Promise<Q3ApplicationAdmission> {
    if (this.reconnecting.has(client.slot)) throw new Error('Q3 carried client requires map reconnection');
    return this.admit(client, userinfo, true);
  }
  async reconnect(client: ClientId): Promise<Q3ApplicationAdmission> {
    this.running();
    const previous = this.reconnecting.get(client.slot);
    if (previous === undefined || !previous.client.equals(client)) throw new Error('Q3 client is not carried by this map transition');
    try { return await this.admit(client, this.state.getUserinfo(client.slot) ?? previous.userinfo, false, previous.bot === true); }
    finally { this.reconnecting.delete(client.slot); }
  }
  private validateClient(client: ClientId): void {
    if (client.session !== this.options.records.actors.session || !Number.isInteger(client.slot) || client.slot < 0 || client.slot >= this.options.maxClients)
      throw new RangeError('Q3 client slot belongs to another server or is outside its capacity');
  }
  private async admit(client: ClientId, userinfo: string, firstTime: boolean, isBot = false): Promise<Q3ApplicationAdmission> {
    this.externalOperations++;
    try {
      this.running();
      if (this.player(client) !== null) throw new Error('Q3 client already has a guest slot');
      const slot = client.slot;
      this.validateClient(client);
      if (this.clients.has(slot) || this.inputRetirements.has(slot)) return { kind: 'rejected', reason: 'Client slot is already occupied.' };
      const player = { client, actor: this.records.actor(slot).id, sourceEntity: slot };
      const entry: ClientEntry = { player, phase: { kind: 'connecting' } };
      this.clients.set(slot, entry); this.state.setUserinfo(slot, userinfo);
      try {
        const denied = await this.game.clientConnectAsync(slot, firstTime, isBot);
        this.current();
        if (this.clients.get(slot) !== entry || entry.phase.kind === 'dropping') return { kind: 'rejected', reason: entry.phase.kind === 'dropping' ? entry.phase.reason : 'Client disconnected during admission.' };
        if (denied !== null) {
          if (firstTime) this.release(entry); else await this.disconnect(entry.player);
          return { kind: 'rejected', reason: denied };
        }
        entry.phase = { kind: 'connected' }; return { kind: 'accepted', player };
      } catch (error) { if (this.clients.get(slot) === entry) this.release(entry); throw error; }
    } finally { this.finishExternalOperation(); }
  }
  private entry(player: Q3ApplicationPlayer): ClientEntry {
    const entry = this.clients.get(player.sourceEntity);
    if (entry === undefined || entry.player !== player) throw new Error('Q3 player is no longer admitted');
    return entry;
  }
  async begin(player: Q3ApplicationPlayer, command: WireUserCommand): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); const entry = this.entry(player);
      if (entry.phase.kind !== 'connected') throw new Error('Q3 guest client cannot begin in this phase');
      this.state.setUserCommand(player.sourceEntity, command);
      await this.game.clientBeginAsync(player.sourceEntity); this.current();
      if (this.clients.get(player.sourceEntity) === entry && entry.phase.kind === 'connected') {
        entry.phase = { kind: 'active' }; this.options.clientChanged?.('admitted', player.actor);
      }
    } finally { this.finishExternalOperation(); }
  }
  async think(player: Q3ApplicationPlayer, command: WireUserCommand): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); if (this.entry(player).phase.kind !== 'active') throw new Error('Q3 guest client is not active');
      this.state.setUserCommand(player.sourceEntity, command); await this.game.clientThinkAsync(player.sourceEntity); this.current();
    } finally { this.finishExternalOperation(); }
  }
  async userinfo(player: Q3ApplicationPlayer, value: string): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); this.entry(player); this.state.setUserinfo(player.sourceEntity, value);
      await this.game.clientUserinfoChangedAsync(player.sourceEntity); this.current();
      this.options.clientChanged?.('userinfo', player.actor);
    } finally { this.finishExternalOperation(); }
  }
  commandImmediate(player: Q3ApplicationPlayer, argv: readonly string[]): void {
    this.externalOperations++;
    try { this.running(); this.entry(player); this.game.clientCommand(player.sourceEntity, argv); this.current(); }
    finally { this.finishExternalOperation(); }
  }
  async command(player: Q3ApplicationPlayer, argv: readonly string[]): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); this.entry(player); await this.game.clientCommandAsync(player.sourceEntity, argv); this.current();
    } finally { this.finishExternalOperation(); }
  }
  private async drop(slot: number, reason: string): Promise<void> {
    this.reconnecting.delete(slot);
    const entry = this.clients.get(slot);
    if (entry !== undefined) { this.notifyDisconnect(entry); entry.phase = { kind: 'dropping', reason }; }
    if (!this.botClients.has(slot)) await this.output().dropClient(slot, reason);
    this.current();
    if (entry !== undefined && this.clients.get(slot) === entry) await this.disconnect(entry.player);
  }
  async disconnect(player: Q3ApplicationPlayer): Promise<void> {
    this.externalOperations++;
    try {
      this.current();
      if (this.lifecycle.kind !== 'initializing' && this.lifecycle.kind !== 'running' && this.lifecycle.kind !== 'shutting-down') throw new Error('Q3 guest client disconnect requires attached output');
      const entry = this.clients.get(player.sourceEntity);
      if (entry === undefined || entry.player !== player) return;
      this.notifyDisconnect(entry);
      if (entry.phase.kind !== 'dropping') entry.phase = { kind: 'dropping', reason: 'Client disconnected.' };
      this.clients.delete(player.sourceEntity);
      try {
        const call = this.currentCall;
        if (call === null) await this.game.clientDisconnectAsync(player.sourceEntity);
        else await call.invokeAsync(qvmArguments([QvmGameExport.GAME_CLIENT_DISCONNECT, player.sourceEntity]));
        this.current();
      } finally {
        this.state.clearClient(player.sourceEntity); this.records.releaseClient(player.sourceEntity);
        if (this.botClients.delete(player.sourceEntity)) this.botPreparation?.freeClient(player.client);
        this.botMessages.delete(player.sourceEntity);
      }
    } finally { this.finishExternalOperation(); }
  }
  private notifyDisconnect(entry: ClientEntry): void {
    if (entry.disconnectNotified === true) return;
    entry.disconnectNotified = true;
    this.options.beforeDisconnect?.(entry.player.actor);
  }
  private admitPendingBots(): void {
    for (const slot of this.pendingBotAdmissions) {
      this.pendingBotAdmissions.delete(slot);
      const entry = this.clients.get(slot);
      if (entry?.phase.kind === 'active') this.options.clientChanged?.('admitted', entry.player.actor);
    }
  }
  private release(entry: ClientEntry): void {
    this.pendingBotAdmissions.delete(entry.player.sourceEntity);
    this.clients.delete(entry.player.sourceEntity); this.state.clearClient(entry.player.sourceEntity); this.records.releaseClient(entry.player.sourceEntity);
  }
  async consoleCommand(argv: readonly string[]): Promise<boolean> {
    this.externalOperations++;
    try {
      this.running(); const handled = await this.game.consoleCommandAsync(argv); this.current(); this.admitPendingBots(); return handled;
    } finally { this.finishExternalOperation(); }
  }
  async runFrame(timeMilliseconds: number): Promise<void> {
    this.externalOperations++;
    try { this.running();
      if (this.bots !== null && this.state.cvars.variableValue('bot_enable') !== 0) await this.game.module.callAsync([QvmGameExport.BOTAI_START_FRAME, timeMilliseconds]);
      await this.game.runFrameAsync(timeMilliseconds); await this.refreshServerInfo(); this.current(); this.admitPendingBots();
    } finally { this.finishExternalOperation(); }
  }
  isBot(client: ClientId): boolean { return this.botClients.has(client.slot) && this.player(client) !== null; }
  players(): readonly Q3ApplicationPlayer[] { return [...this.clients.values()].filter(entry => entry.phase.kind !== 'dropping' && !this.inputRetirements.has(entry.player.sourceEntity)).map(entry => entry.player); }
  player(client: ClientId): Q3ApplicationPlayer | null { return this.players().find(player => player.client.equals(client)) ?? null; }
  async shutdown(): Promise<void> {
    if (this.lifecycle.kind === 'retired') return;
    if (this.externalOperations !== 0 || this.game.module.interpreter.isActive) throw new Error('Q3 guest shutdown must await the active operation');
    const errors: unknown[] = [];
    try { await this.shutdownSource(); } catch (error) { errors.push(error); }
    this.releaseSource(errors);
    if (errors.length !== 0) throw new AggregateError(errors, 'Q3 guest shutdown failed');
  }
  async shutdownForMapChange(restart = false): Promise<Q3GuestMapTransition> {
    this.running();
    if (this.externalOperations !== 0 || this.game.module.interpreter.isActive || this.reconnecting.size !== 0
      || [...this.clients.values()].some(entry => entry.phase.kind !== 'connected' && entry.phase.kind !== 'active'))
      throw new Error('Q3 map transition requires completed client operations');
    const errors: unknown[] = [];
    let transition: Q3GuestMapTransition | null = null;
    try {
      await this.shutdownSource(restart);
      transition = { cvars: this.state.cvars.captureSaveState(), clients: [...this.clients.values()].filter(entry => entry.phase.kind !== 'dropping')
        .map(entry => ({ client: entry.player.client, userinfo: this.state.getUserinfo(entry.player.sourceEntity) ?? '', bot: this.botClients.has(entry.player.sourceEntity) })) };
    } catch (error) { errors.push(error); }
    this.releaseSource(errors, transition !== null);
    if (errors.length !== 0) throw new AggregateError(errors, 'Q3 guest map shutdown failed');
    if (transition === null) throw new Error('Q3 map transition did not capture source state');
    return transition;
  }
  private async shutdownSource(restart = false): Promise<void> {
    this.inputBinding?.close(); this.inputBinding = null; this.inputRetirements.clear();
    const lifecycle = this.lifecycle;
    if (lifecycle.kind === 'initializing' || lifecycle.kind === 'running' || lifecycle.kind === 'shutting-down') {
      this.lifecycle = { kind: 'shutting-down', output: lifecycle.output };
      await this.game.shutdownAsync(restart);
    }
  }
  private releaseSource(errors: unknown[], transferClients = false): void {
    try { this.bots?.close(); } catch (error) { errors.push(error); }
    try { this.files.closeAll(); } catch (error) { errors.push(error); }
    try { this.options.beforeRetire?.(); } catch (error) { errors.push(error); }
    try { this.records.close(); } catch (error) { errors.push(error); }
    if (!transferClients) for (const slot of this.botClients) { const entry = this.clients.get(slot); if (entry !== undefined) this.botPreparation?.freeClient(entry.player.client); }
    this.botClients.clear(); this.botMessages.clear();
    for (const slot of new Set([...this.clients.keys(), ...this.reconnecting.keys()])) this.state.clearClient(slot);
    this.game.retire(); this.clients.clear(); this.reconnecting.clear(); this.lifecycle = { kind: 'retired' };
  }
}
