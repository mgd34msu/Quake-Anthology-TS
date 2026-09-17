import { Q3QvmServerGame } from './q3/guest-runtime.ts';
import { Q3ClientAdmissionDenied } from './q3/runtime.ts';
import type { ClientId } from '../../../contracts/identity.ts';
import { setInfoValue } from '../../../core/cvars/info.ts';
import { CvarFlag } from '../../../core/cvars/index.ts';
import { Q3ApplicationPackages } from '../network/q3-downloads.ts';
import { q3InfoValue } from '../../../network/q3/admission.ts';
import { Q3_PROTOCOL, toQ3UserCommand, fromQ3PlayerState } from '../../../network/q3/adapters.ts';
import { EntityStateRecord } from '../../../network/q3/state/entity.ts';
import { PlayerStateRecord, PlayerStateSlots } from '../../../network/q3/state/player.ts';
import type { GamestateEntry } from '../../../network/q3/server-message.ts';
import { selectQ3SnapshotEntities } from '../../../network/q3/visibility.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { Q3ApplicationAdmission, Q3ApplicationPlayer, Q3ApplicationServerHost } from '../network/q3-types.ts';
import type { SharedSimulation } from './runtime.ts';
export interface Q3ApplicationServerBindingOptions { readonly session: EngineSession; readonly simulation: SharedSimulation; readonly content: LoadedApplicationContent; readonly mode?: 'new' | 'restore'; readonly administration?: Q3ApplicationServerHost['administration']; print(text: string): void; }
export interface Q3ApplicationServerAuthority extends Q3ApplicationServerHost {
  connect(client: ClientId, userinfo: string): Promise<Q3ApplicationAdmission>;
}
export function createQ3ApplicationServerHost(options: Q3ApplicationServerBindingOptions): Q3ApplicationServerAuthority {
  const simulation = options.simulation, source = simulation.q3Guest() ?? simulation.q3Source();
  if (source === null) throw new Error('Q3 network requires a Q3 game provider');
  const guest = source instanceof Q3QvmServerGame;
  let nativeRound = guest ? null : source;
  const nativeSource = () => {
    if (nativeRound === null) throw new Error('Native source round binding is unavailable');
    return nativeRound;
  };
  const mode = options.mode ?? 'new';
  if (mode === 'restore' && !guest) throw new Error('Restored Q3 client authority requires a saved QVM source');
  const state = guest ? source.state : source.host.serverState, cvars = state.cvars;
  const product = guest ? 'baseq3' : source.options.product;
  const maxClients = simulation.options.maxClients;
  const entityCount = () => guest ? source.game.data.numEntities : nativeSource().pool.numEntities;
  const sharedEntity = (number: number) => guest ? source.records.entity(number) : nativeSource().pool.at(number);
  const linked = (number: number) => guest ? source.records.entity(number).r.linked : nativeSource().pool.at(number).inuse && nativeSource().pool.at(number).r.linked;
  if (mode === 'new') cvars.register('fs_game', guest ? cvars.variableString('fs_game') : product === 'missionpack' ? 'missionpack' : '', CvarFlag.SystemInfo);
  let packages: Q3ApplicationPackages | null = null, preparing: Promise<Q3ApplicationPackages> | null = null;
  let touchedCgame = false;
  const archiveState = (): Q3ApplicationPackages => { if (packages === null) throw new Error('Q3 package metadata has not been prepared'); return packages; };
  const requireSavedServerId = (serverId: number): void => {
    if (mode === 'restore' && serverId !== cvars.variableValue('sv_serverid')) throw new Error('Restored Q3 client authority must retain the saved server id');
  };
  const playerFor = (client: ClientId): Q3ApplicationPlayer => {
    if (guest) { const player = source.player(client); if (player === null) throw new Error('Application has not admitted the Q3 guest client'); return player; }
    const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client));
    if (actor === undefined) throw new Error('Application has not admitted the Q3 client');
    const entity = nativeSource().records.byActor(actor); if (entity === null) throw new Error('Q3 player has no source entity');
    return { client, actor, sourceEntity: entity.slot };
  };
  const connect = async (client: ClientId, userinfo: string): Promise<Q3ApplicationAdmission> => {
    if (guest) return source.connect(client, userinfo);
    state.setUserinfo(client.slot, userinfo);
    try { simulation.admitPlayer(client); return { kind: 'accepted', player: playerFor(client) }; }
    catch (error) {
      const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client));
      try { if (actor !== undefined) simulation.disconnectPlayer(actor); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Q3 client admission and cleanup failed'); }
      if (error instanceof Q3ClientAdmissionDenied) return { kind: 'rejected', reason: error.message };
      throw error;
    }
  };
  const wireEntity = (number: number) => { const state = new EntityStateRecord<number>(0); state.copyFrom(sharedEntity(number).s); return state; };
  const slots = (value: { readonly length: number; get(index: number): number }): PlayerStateSlots => { const result = new PlayerStateSlots(value.length); for (let index = 0; index < value.length; index++) result.set(index, value.get(index)); return result; };
  const configEntries = (): GamestateEntry[] => {
    const entries: GamestateEntry[] = [];
    for (let index = 0; index < 1024; index++) { const value = state.configstrings.get(index); if (value !== '') entries.push({ kind: 'configstring', index, value }); }
    return entries;
  };
  return {
    admission: {
      privateClients: () => cvars.get('sv_privateClients')?.integerValue ?? 0,
      privatePassword: () => cvars.variableString('sv_privatePassword'),
      reconnectLimitSeconds: () => cvars.get('sv_reconnectlimit')?.integerValue ?? 3,
      minimumPing: () => cvars.variableValue('sv_minPing'), maximumPing: () => cvars.variableValue('sv_maxPing'),
      demoRestricted: () => options.content.q3Product?.restriction.kind === 'demo',
      enabled: () => cvars.variableValue('g_gametype') !== 2 && cvars.variableValue('ui_singlePlayerActive') === 0,
      gameDirectory: () => cvars.variableString('fs_game'), strictAuth: () => cvars.variableString('sv_strictAuth'),
      floodProtect: () => cvars.variableValue('sv_floodProtect') !== 0,
    },
    ...(options.administration === undefined ? {} : { administration: options.administration }),
    product, maxClients, connect,
    ...(guest ? {} : { sourceRound: {
      preflight() {
        const plan = simulation.sourceRestartPlan();
        if (plan.kind !== 'source-reset') throw new Error('Q3 network fast restart is incompatible: ' + plan.reason);
        if (simulation.q3Source() !== nativeSource()) throw new Error('Q3 network source round is already retired');
      },
      rebind() {
        const next = simulation.q3Source();
        if (next === null || next === nativeSource() || next.host.serverState !== state || next.options.product !== product)
          throw new Error('Q3 network requires a new round with retained server state and product');
        nativeRound = next;
      },
      reconnect(client: ClientId, userinfo: string, lastCommand: import('../../../network/q3/message.ts').WireUserCommand) {
        nativeSource().host.serverState.setUserCommand(client.slot, lastCommand);
        return connect(client, userinfo);
      },
    } }),
    prepare: async (checksumFeed, serverId, configstring) => {
      requireSavedServerId(serverId);
      preparing ??= Q3ApplicationPackages.open(options.content, checksumFeed);
      packages = await preparing;
      if (packages.references.references.checksumFeed !== (checksumFeed >>> 0)) throw new Error('Q3 world changed checksum feed without replacing content host');
      if (cvars.variableValue('sv_pure') !== 0 && !touchedCgame) { await options.content.mounts.resolve('vm/cgame.qvm'); touchedCgame = true; }
      packages.collect(options.content);
      if (mode === 'restore') return;
      const refs = packages.references.references;
      cvars.set('sv_serverid', String(serverId), true);
      cvars.set('sv_paks', cvars.variableValue('sv_pure') !== 0 ? refs.loadedPakChecksums() : '', true);
      cvars.set('sv_pakNames', cvars.variableValue('sv_pure') !== 0 ? refs.loadedPakNames() : '', true);
      cvars.set('sv_referencedPaks', refs.referencedPakChecksums(), true);
      cvars.set('sv_referencedPakNames', refs.referencedPakNames(), true);
      for (const [index, value] of [[1, cvars.infoString(CvarFlag.SystemInfo, 8192)], [0, state.serverInfo()]] satisfies readonly (readonly [number, string])[]) {
        if (!guest) nativeSource().host.configstrings.set(index, value);
        else if (state.configstrings.get(index) !== value) {
          state.configstrings.set(index, value); await configstring?.(index, value);
        }
      }
    },
    pure: (serverId, checksumFeedServerId = serverId) => { requireSavedServerId(serverId); const state = archiveState(); return { enabled: cvars.variableValue('sv_pure') !== 0,
      checksumFeed: state.references.references.checksumFeed | 0, checksumFeedServerId,
      cgameChecksum: state.pureChecksum('vm/cgame.qvm'), uiChecksum: state.pureChecksum('vm/ui.qvm'),
      loadedPureChecksums: state.packs.map(pack => pack.pack.pureChecksum) }; },
    downloadsEnabled: () => cvars.variableValue('sv_allowDownload') !== 0,
    openDownload: name => archiveState().openDownload(name),
    rate: player => { const info = guest ? state.getUserinfo(player.sourceEntity) ?? '' : nativeSource().host.engine.getUserinfo(player.sourceEntity), fps = Math.max(1, cvars.variableValue('sv_fps'));
      const requestedRate = Number.parseInt(q3InfoValue(info, 'rate'), 10), requestedSnaps = Number.parseInt(q3InfoValue(info, 'snaps'), 10);
      return { rate: Number.isNaN(requestedRate) ? 3000 : Math.max(1000, Math.min(90000, requestedRate)), maxRate: cvars.variableValue('sv_maxRate'),
        snapshotMsec: Math.trunc(1000 / (Number.isNaN(requestedSnaps) ? fps : Math.max(1, Math.min(fps, requestedSnaps)))), local: q3InfoValue(info, 'ip') === 'localhost', forceLan: false, lan: false }; },
    supportsSourceWire: () => {
      const reasons: string[] = [];
      if (!simulation.recipe.movement.provider.startsWith('q3:')) reasons.push('Native Q3 wire requires Q3 movement');
      if (!simulation.recipe.character.definition.provider.startsWith('q3:')) reasons.push('Native Q3 wire requires a Q3 character');
      return reasons.length === 0 ? { kind: 'supported' } : { kind: 'unsupported', reasons };
    },
    time: () => guest ? Math.trunc(simulation.timeSeconds * 1000) : nativeSource().host.now(),
    occupiedSlots: () => guest ? source.players().map(player => player.sourceEntity) : simulation.players().map(actor => nativeSource().records.byActor(actor)?.slot ?? -1),
    admit: async request => {
      const client = options.session.createClient(request.slot); client.connect(request.address.kind === 'loopback' ? 'loopback' : 'remote');
      try {
        const admitted = await connect(client.id, request.userinfo);
        if (admitted.kind === 'rejected') options.session.closeClient(client.id);
        return admitted;
      } catch (error) { options.session.closeClient(client.id); throw error; }
    },
    carriedPlayer: playerFor,
    disconnect: async player => {
      try { if (guest) await source.disconnect(player); else simulation.disconnectPlayer(player.actor); }
      finally { options.session.closeClient(player.client); }
    },
    gameState: (player, serverId) => {
      requireSavedServerId(serverId);
      const entries = configEntries().filter(entry => mode === 'restore' || entry.kind !== 'configstring' || (entry.index !== 0 && entry.index !== 1));
      if (mode === 'new') {
        cvars.set('sv_serverid', String(serverId), true);
        entries.unshift({ kind: 'configstring', index: 0, value: state.serverInfo() },
          { kind: 'configstring', index: 1, value: cvars.infoString(CvarFlag.SystemInfo, 8192) });
      }
      for (let number = 1; number < entityCount(); number++) if (linked(number)) entries.push({ kind: 'baseline', number, entity: wireEntity(number) });
      return { kind: 'gamestate', commandSequence: 0, entries, clientNumber: player.sourceEntity, checksumFeed: archiveState().references.references.checksumFeed | 0 };
    },
    snapshot: player => {
      const state = (() => {
        if (guest) return fromQ3PlayerState(source.records.player(player.sourceEntity), product);
        const entity = nativeSource().records.byActor(player.actor);
        if (entity?.client === null || entity?.client === undefined) throw new Error('Q3 snapshot player disappeared');
        const ps = entity.client.ps, value = new PlayerStateRecord(product, ps.pmType, ps.weapon, ps.weaponState);
        value.copyFrom({ ...ps, origin: ps.origin, velocity: ps.velocity, product: ps.product, events: slots(ps.events), eventParms: slots(ps.eventParms), stats: slots(ps.stats), persistant: slots(ps.persistant), powerups: slots(ps.powerups), ammo: slots(ps.ammo) });
        return value;
      })();
      const scene = simulation.scene;
      const visible = selectQ3SnapshotEntities(state, { entityCount: entityCount(), dead: false, print: options.print,
        entity: number => { const item = sharedEntity(number); return { state: wireEntity(number), linked: linked(number), flags: item.r.svFlags, singleClient: item.r.singleClient }; },
        link: number => { if (guest) return source.records.visibility(number);
          const item = nativeSource().pool.at(number), linked = simulation.bodies.linked(item.actor.id); if (linked === null) return undefined;
          const leaves = scene.boxLeaves(linked.absoluteBounds, 128).leaves, areas = [...new Set(leaves.map(leaf => scene.leafArea(leaf)))], clusters = [...new Set(leaves.map(leaf => scene.leafCluster(leaf)).filter(cluster => cluster >= 0))];
          return { areanum: areas[0] ?? -1, areanum2: areas[1] ?? -1, clusters, lastCluster: 0 }; },
        collision: { pointLeafnum: point => scene.pointLeaf(point), leafArea: leaf => scene.leafArea(leaf), leafCluster: leaf => scene.leafCluster(leaf), areasConnected: (a, b) => scene.areasConnected(a, b),
          writeAreaBits: (bytes, area) => { const bits = scene.areaBits(area); for (let index = 0; index < bits.length; index++) bytes[index] = (bytes[index] ?? 0) | (bits[index] ?? 0); return bits.length; },
          clusterPVS: cluster => ({ byteAt: index => { let value = 0; for (let bit = 0; bit < 8; bit++) if (scene.clusterVisible(cluster, index * 8 + bit, 'pvs')) value |= 1 << bit; return value; } }),
        },
      });
      return { player: state, ...visible };
    },
    ...(guest ? { begin: (player: Q3ApplicationPlayer, command: import('../../../network/q3/message.ts').WireUserCommand) => source.begin(player, command) } : {}),
    input: async (player, command, sequence) => {
      if (guest) { await source.think(player, command); return null; }
      return { actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command: toQ3UserCommand(command) };
    },
    command: (player, name, args) => guest ? source.command(player, [name, ...args]) : nativeSource().playerCommand(player.actor, name, args),
    userinfo: (player, value) => { if (guest) return source.userinfo(player, value); state.setUserinfo(player.sourceEntity, value); nativeSource().admission.userinfoChanged(player.sourceEntity); return undefined; },
    status: (challenge, detailed) => {
      if (cvars.variableValue('g_gametype') === 2 || !detailed && cvars.variableValue('ui_singlePlayerActive') !== 0) return null;
      const put = (info: string, key: string, value: string): string => setInfoValue(info, key, value,
        { dialect: 'q3', maximumLength: 1024, target: 'server-info', serverHighCharacters: false, print: options.print });
      let info = put(detailed ? cvars.infoString(CvarFlag.ServerInfo) : '', 'challenge', challenge);
      if (!detailed) {
        const privateClients = cvars.get('sv_privateClients')?.integerValue ?? 0;
        const occupied = guest ? source.players().map(player => player.sourceEntity) : simulation.players().map(actor => nativeSource().records.byActor(actor)?.slot ?? -1);
        const fields: readonly (readonly [string, string])[] = [
          ['protocol', String(Q3_PROTOCOL.version)], ['hostname', cvars.variableString('sv_hostname')],
          ['mapname', cvars.variableString('mapname')], ['clients', String(occupied.filter(slot => slot >= privateClients && slot < maxClients).length)],
          ['sv_maxclients', String(maxClients - privateClients)], ['gametype', String(cvars.get('g_gametype')?.integerValue ?? 0)],
          ['pure', String(cvars.get('sv_pure')?.integerValue ?? 0)],
        ];
        for (const [key, value] of fields) info = put(info, key, value);
        for (const [key, name] of [['minPing', 'sv_minPing'], ['maxPing', 'sv_maxPing']] satisfies readonly (readonly [string, string])[]) {
          const value = cvars.get(name)?.integerValue ?? 0; if (value !== 0) info = put(info, key, String(value));
        }
        info = put(info, 'game', cvars.variableString('fs_game'));
        return `infoResponse\n${info}`;
      }
      if (options.content.q3Product?.restriction.kind === 'demo') info = put(info, 'sv_keywords', `demo ${q3InfoValue(info, 'sv_keywords')}`);
      const rows = guest ? source.players().map(player => {
        const ps = source.records.player(player.sourceEntity), name = q3InfoValue(state.getUserinfo(player.sourceEntity) ?? '', 'name');
        return `${ps.persistent[0] ?? 0} ${source.game.data.playerPing(player.sourceEntity)} "${name}"\n`;
      }) : simulation.players().map(actor => { const client = nativeSource().records.byActor(actor)?.client; return client == null ? '' : `${client.ps.persistant.get(0)} ${client.ps.ping} "${client.pers.netname}"\n`; });
      let players = '';
      for (const row of rows) { if (players.length + row.length >= 16384) break; players += row; }
      return `statusResponse\n${info}\n${players}`;
    }, print: options.print,
  };
}
