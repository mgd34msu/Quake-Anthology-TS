import type { QvmCheckpoint } from '../../../../contracts/execution.ts';
import { SaveReader, encodeCheckpointValue, decodeCheckpointValue } from '../../../../persistence/value.ts';
import { savedActorId, readSavedActor } from '../../../../persistence/save-image.ts';
import type { QvmHostCheckpoint } from '../../../../compat/qvm/module.ts';
import type { ClientId } from '../../../../contracts/identity.ts';
import type { MountedContent } from '../../../../content/mounts/index.ts';
import type { UserFileStore } from '../../../../platform/files/writable.ts';
import type { WireUserCommand } from '../../../../network/q3/message.ts';
import { CommonParseCursor, CommonParseState } from '../../../../core/common-parse.ts';
import { CvarFlag } from '../../../../core/cvars/index.ts';
import { nativeAtof } from '../../../../core/numeric.ts';
import { QvmGame } from '../../../../compat/qvm/game.ts';
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
}
export type Q3SavedGuestClientId = Pick<ClientId, 'slot' | 'generation'>;
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
  phase: { readonly kind: 'connecting' | 'connected' | 'active' } | { readonly kind: 'dropping'; readonly reason: string };
}

/** The guest owns all game-private state; application operations own external serialization. */
export class Q3QvmServerGame {
  readonly state: Q3ServerState;
  readonly game: QvmGame;
  readonly records: Q3GuestRecords;
  readonly spatial: Q3GuestSpatial;
  private readonly files: QvmFiles;
  private readonly services: QvmServerGameServices;
  private readonly common: Extract<QvmCommonServices, { readonly role: 'qagame' }>;
  private lifecycle: Lifecycle = { kind: 'created' };
  private externalOperations = 0;
  private currentCall: QvmHostCall | null = null;
  private readonly cursor: CommonParseCursor;
  private readonly parser = new CommonParseState();
  private restoreClient: ((saved: Q3SavedGuestClientId) => ClientId) | null = null;
  private readonly clients = new Map<number, ClientEntry>();

  constructor(private readonly options: Q3GuestRuntimeOptions) {
    if (!Number.isInteger(options.maxClients) || options.maxClients < 1 || options.maxClients > 64) throw new RangeError('Q3 guest requires 1..64 clients');
    this.state = options.state;
    for (const name of ['bot_enable', 'bot_minplayers']) {
      if (this.state.cvars.variableValue(name) !== 0) throw new Error('Q3 guest bots are unsupported');
      this.state.cvars.set(name, '0', true); this.state.cvars.register(name, '0', CvarFlag.ReadOnly);
    }
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
      configstrings: { get: index => this.state.configstrings.get(index), set: (index, value) => {
        if (this.state.configstrings.get(index) === value) return;
        this.state.configstrings.set(index, value); return this.output().configstring(index, value);
      } },
      getUserinfo: slot => this.state.getUserinfo(slot) ?? '', setUserinfo: (slot, value) => this.state.setUserinfo(slot, value),
      getUserCommand: slot => this.state.getUserCommand(slot) ?? { serverTime: 0, angles: [0, 0, 0], buttons: 0, weapon: 0, forwardmove: 0, rightmove: 0, upmove: 0 }, dropClient: (slot, reason) => this.drop(slot, reason),
      sendServerCommand: (slot, text) => this.output().sendServerCommand(slot, text),
      entityToken: () => ({ token: this.parser.parse(this.cursor), ended: this.cursor.offset === null }),
    };
  }
  get isRetired(): boolean { return this.lifecycle.kind === 'retired'; }

  checkpoint(): QvmCheckpoint { return this.game.module.checkpoint(); }

  private portalWorld() {
    const models = this.options.records.scene.nativeQ3ClipModels();
    if (models === null) throw new Error('Q3 guest portal state requires the Q3 scene');
    return models.world;
  }

  private captureHost(): QvmHostCheckpoint {
    this.running();
    if (this.externalOperations !== 0 || this.currentCall !== null || [...this.clients.values()].some(entry => entry.phase.kind !== 'connected' && entry.phase.kind !== 'active')) {
      throw new Error('Q3 guest checkpoint requires completed client operations');
    }
    return { state: { module: this.game.module.profile.module, format: 'q3:qagame-host', bytes: encodeCheckpointValue({
      version: 1, maxClients: this.game.data.numClients, data: this.game.data.checkpoint(), server: this.state.captureSaveState(),
      entityText: this.cursor.source, cursor: this.cursor.offset, parser: this.parser.captureSaveState(),
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
  }

  completeRestore(output: Q3GuestOutput): void {
    this.current();
    if (this.lifecycle.kind !== 'restored') throw new Error('Q3 guest restore is not ready for output attachment');
    this.lifecycle = { kind: 'running', output };
  }

  discard(): void {
    if (this.lifecycle.kind === 'retired') return;
    if (this.externalOperations !== 0 || this.game.module.interpreter.isActive) throw new Error('Q3 guest discard must await the active operation');
    const errors: unknown[] = [];
    try { this.files.closeAll(); } catch (error) { errors.push(error); }
    try { this.records.close(); } catch (error) { errors.push(error); }
    this.game.retire(); this.clients.clear(); this.lifecycle = { kind: 'retired' };
    if (errors.length !== 0) throw new AggregateError(errors, 'Q3 guest discard failed');
  }

  private current(): void {
    if (this.lifecycle.kind === 'retired') throw new Error('Q3 guest is retired');
    this.options.assertCurrent();
    if (this.state.cvars.variableValue('bot_enable') !== 0 || this.state.cvars.variableValue('bot_minplayers') !== 0) throw new Error('Q3 guest bots are unsupported');
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
      if (call.kind === 'engine' && call.role === 'qagame' && call.code === QvmGameImport.G_CVAR_SET) {
        const name = call.guest.readString(call.words.getInt32(4, true)).toLowerCase(), value = call.words.getInt32(8, true);
        if ((name === 'bot_enable' || name === 'bot_minplayers') && value !== 0 && nativeAtof(call.guest.readString(value)) !== 0) throw new Error('Q3 guest bots are unsupported');
      }
      const result = qvmCommonSyscall(call, this.common) ?? qvmFileSyscall(call, this.files)
        ?? qvmServerGameSyscall(call, this.services) ?? this.disabledBot(call) ?? rejectQvmSyscall(call);
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
  private async refreshServerInfo(): Promise<void> {
    this.current();
    const value = this.state.refreshServerInfo();
    if (value !== null) await this.output().configstring(0, value);
    this.current();
  }

  async initialize(output: Q3GuestOutput): Promise<void> {
    this.current();
    if (this.lifecycle.kind !== 'created') throw new Error('Q3 guest has already initialized');
    this.lifecycle = { kind: 'initializing', output };
    try {
      await this.game.initializeAsync(this.options.now(), this.options.seed);
      await this.refreshServerInfo();
      this.current(); this.lifecycle = { kind: 'running', output };
    } catch (error) {
      try { await this.shutdown(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Q3 guest initialization and cleanup failed'); }
      throw error;
    }
  }
  async connect(client: ClientId, userinfo: string): Promise<Q3ApplicationAdmission> {
    this.externalOperations++;
    try {
      this.running();
      if (this.player(client) !== null) throw new Error('Q3 client already has a guest slot');
      const slot = client.slot;
      if (client.session !== this.options.records.actors.session || !Number.isInteger(slot) || slot < 0 || slot >= this.options.maxClients) throw new RangeError('Q3 client slot belongs to another server or is outside its capacity');
      if (this.clients.has(slot)) return { kind: 'rejected', reason: 'Client slot is already occupied.' };
      const player = { client, actor: this.records.actor(slot).id, sourceEntity: slot };
      const entry: ClientEntry = { player, phase: { kind: 'connecting' } };
      this.clients.set(slot, entry); this.state.setUserinfo(slot, userinfo);
      try {
        const denied = await this.game.clientConnectAsync(slot, true, false);
        this.current();
        if (this.clients.get(slot) !== entry || entry.phase.kind === 'dropping') return { kind: 'rejected', reason: entry.phase.kind === 'dropping' ? entry.phase.reason : 'Client disconnected during admission.' };
        if (denied !== null) { this.release(entry); return { kind: 'rejected', reason: denied }; }
        entry.phase = { kind: 'connected' }; return { kind: 'accepted', player };
      } catch (error) { if (this.clients.get(slot) === entry) this.release(entry); throw error; }
    } finally { this.externalOperations--; }
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
      if (this.clients.get(player.sourceEntity) === entry && entry.phase.kind === 'connected') entry.phase = { kind: 'active' };
    } finally { this.externalOperations--; }
  }
  async think(player: Q3ApplicationPlayer, command: WireUserCommand): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); if (this.entry(player).phase.kind !== 'active') throw new Error('Q3 guest client is not active');
      this.state.setUserCommand(player.sourceEntity, command); await this.game.clientThinkAsync(player.sourceEntity); this.current();
    } finally { this.externalOperations--; }
  }
  async userinfo(player: Q3ApplicationPlayer, value: string): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); this.entry(player); this.state.setUserinfo(player.sourceEntity, value);
      await this.game.clientUserinfoChangedAsync(player.sourceEntity); this.current();
    } finally { this.externalOperations--; }
  }
  async command(player: Q3ApplicationPlayer, argv: readonly string[]): Promise<void> {
    this.externalOperations++;
    try {
      this.running(); this.entry(player); await this.game.clientCommandAsync(player.sourceEntity, argv); this.current();
    } finally { this.externalOperations--; }
  }
  private async drop(slot: number, reason: string): Promise<void> {
    const entry = this.clients.get(slot);
    if (entry !== undefined) entry.phase = { kind: 'dropping', reason };
    await this.output().dropClient(slot, reason); this.current();
    if (entry !== undefined && this.clients.get(slot) === entry) await this.disconnect(entry.player);
  }
  async disconnect(player: Q3ApplicationPlayer): Promise<void> {
    this.externalOperations++;
    try {
      this.current();
      if (this.lifecycle.kind !== 'initializing' && this.lifecycle.kind !== 'running' && this.lifecycle.kind !== 'shutting-down') throw new Error('Q3 guest client disconnect requires attached output');
      const entry = this.clients.get(player.sourceEntity);
      if (entry === undefined || entry.player !== player) return;
      if (entry.phase.kind !== 'dropping') entry.phase = { kind: 'dropping', reason: 'Client disconnected.' };
      this.clients.delete(player.sourceEntity);
      try {
        const call = this.currentCall;
        if (call === null) await this.game.clientDisconnectAsync(player.sourceEntity);
        else await call.invokeAsync(qvmArguments([QvmGameExport.GAME_CLIENT_DISCONNECT, player.sourceEntity]));
        this.current();
      } finally { this.state.clearClient(player.sourceEntity); this.records.releaseClient(player.sourceEntity); }
    } finally { this.externalOperations--; }
  }
  private release(entry: ClientEntry): void {
    this.clients.delete(entry.player.sourceEntity); this.state.clearClient(entry.player.sourceEntity); this.records.releaseClient(entry.player.sourceEntity);
  }
  async consoleCommand(argv: readonly string[]): Promise<boolean> {
    this.externalOperations++;
    try {
      this.running(); const handled = await this.game.consoleCommandAsync(argv); this.current(); return handled;
    } finally { this.externalOperations--; }
  }
  async runFrame(timeMilliseconds: number): Promise<void> {
    this.externalOperations++;
    try { this.running(); await this.game.runFrameAsync(timeMilliseconds); await this.refreshServerInfo(); this.current();
    } finally { this.externalOperations--; }
  }
  players(): readonly Q3ApplicationPlayer[] { return [...this.clients.values()].filter(entry => entry.phase.kind !== 'dropping').map(entry => entry.player); }
  player(client: ClientId): Q3ApplicationPlayer | null { return this.players().find(player => player.client.equals(client)) ?? null; }
  async shutdown(): Promise<void> {
    if (this.lifecycle.kind === 'retired') return;
    if (this.externalOperations !== 0 || this.game.module.interpreter.isActive) throw new Error('Q3 guest shutdown must await the active operation');
    const lifecycle = this.lifecycle, errors: unknown[] = [];
    if (lifecycle.kind === 'initializing' || lifecycle.kind === 'running' || lifecycle.kind === 'shutting-down') {
      this.lifecycle = { kind: 'shutting-down', output: lifecycle.output };
      for (const entry of [...this.clients.values()]) { try { await this.disconnect(entry.player); } catch (error) { errors.push(error); } }
      try { await this.game.shutdownAsync(false); } catch (error) { errors.push(error); }
    }
    try { this.files.closeAll(); } catch (error) { errors.push(error); }
    try { this.records.close(); } catch (error) { errors.push(error); }
    this.game.retire(); this.clients.clear(); this.lifecycle = { kind: 'retired' };
    if (errors.length !== 0) throw new AggregateError(errors, 'Q3 guest shutdown failed');
  }
}
