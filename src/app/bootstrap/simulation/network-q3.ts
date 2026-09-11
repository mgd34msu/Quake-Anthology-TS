import type { ClientId } from '../../../contracts/identity.ts';
import { CvarFlag } from '../../../core/cvars/index.ts';
import { Q3_PROTOCOL, toQ3UserCommand } from '../../../network/q3/adapters.ts';
import { EntityStateRecord } from '../../../network/q3/state/entity.ts';
import { PlayerStateRecord, PlayerStateSlots } from '../../../network/q3/state/player.ts';
import type { GamestateEntry } from '../../../network/q3/server-message.ts';
import { selectQ3SnapshotEntities } from '../../../network/q3/visibility.ts';
import type { EngineSession } from '../../../world/session/session.ts';
import type { LoadedApplicationContent } from '../content.ts';
import type { Q3ApplicationPlayer, Q3ApplicationServerHost } from '../network/q3-types.ts';
import type { SharedSimulation } from './runtime.ts';
export interface Q3ApplicationServerBindingOptions { readonly session: EngineSession; readonly simulation: SharedSimulation; readonly content: LoadedApplicationContent; print(text: string): void; }
export function createQ3ApplicationServerHost(options: Q3ApplicationServerBindingOptions): Q3ApplicationServerHost {
  const simulation = options.simulation, source = simulation.q3Source();
  if (source === null) throw new Error('Q3 network requires the Q3 source game provider');
  const playerFor = (client: ClientId): Q3ApplicationPlayer => {
    const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client));
    if (actor === undefined) throw new Error('Application has not admitted the Q3 client');
    const entity = source.records.byActor(actor); if (entity === null) throw new Error('Q3 player has no source entity');
    return { client, actor, sourceEntity: entity.slot };
  };
  const wireEntity = (number: number) => { const state = new EntityStateRecord<number>(0); state.copyFrom(source.pool.at(number).s); return state; };
  const slots = (value: { readonly length: number; get(index: number): number }): PlayerStateSlots => { const result = new PlayerStateSlots(value.length); for (let index = 0; index < value.length; index++) result.set(index, value.get(index)); return result; };
  const configEntries = (): GamestateEntry[] => {
    const entries: GamestateEntry[] = [];
    for (let index = 0; index < 1024; index++) { const value = source.host.configstrings.get(index); if (value !== '') entries.push({ kind: 'configstring', index, value }); }
    return entries;
  };
  return {
    product: source.options.product, maxClients: source.options.maxClients,
    supportsSourceWire: () => {
      const reasons: string[] = [];
      if (!simulation.recipe.movement.provider.startsWith('q3:')) reasons.push('Native Q3 wire requires Q3 movement');
      if (!simulation.recipe.character.definition.provider.startsWith('q3:')) reasons.push('Native Q3 wire requires a Q3 character');
      return reasons.length === 0 ? { kind: 'supported' } : { kind: 'unsupported', reasons };
    },
    time: () => source.level.time,
    occupiedSlots: () => simulation.players().map(actor => source.records.byActor(actor)?.slot ?? -1),
    admit: request => {
      const client = options.session.createClient(request.slot); client.connect(request.address.kind === 'loopback' ? 'loopback' : 'remote');
      source.host.engine.setUserinfo(request.slot, request.userinfo);
      try { simulation.admitPlayer(client.id); return { kind: 'accepted', player: playerFor(client.id) }; }
      catch (error) { const actor = simulation.players().find(actor => simulation.movementPlayer(actor)?.client.equals(client.id)); if (actor !== undefined) simulation.disconnectPlayer(actor); options.session.closeClient(client.id); return { kind: 'rejected', reason: error instanceof Error ? error.message : String(error) }; }
    },
    carriedPlayer: playerFor,
    disconnect: player => { simulation.disconnectPlayer(player.actor); options.session.closeClient(player.client); },
    gameState: (player, serverId) => {
      const entries = configEntries().filter(entry => entry.kind !== 'configstring' || (entry.index !== 0 && entry.index !== 1));
      entries.unshift({ kind: 'configstring', index: 0, value: source.host.cvars.infoString(CvarFlag.ServerInfo) },
        { kind: 'configstring', index: 1, value: `\\sv_serverid\\${serverId}\\sv_pure\\0\\fs_game\\${source.options.product === 'missionpack' ? 'missionpack' : ''}` });
      for (let number = 1; number < source.pool.numEntities; number++) if (source.pool.at(number).inuse && source.pool.at(number).r.linked) entries.push({ kind: 'baseline', number, entity: wireEntity(number) });
      return { kind: 'gamestate', commandSequence: 0, entries, clientNumber: player.sourceEntity, checksumFeed: 0 };
    },
    snapshot: player => {
      const entity = source.records.byActor(player.actor); if (entity?.client === null || entity?.client === undefined) throw new Error('Q3 snapshot player disappeared');
      const ps = entity.client.ps, state = new PlayerStateRecord(source.options.product, ps.pmType, ps.weapon, ps.weaponState);
      state.copyFrom({ ...ps, origin: ps.origin, velocity: ps.velocity, product: ps.product, events: slots(ps.events), eventParms: slots(ps.eventParms), stats: slots(ps.stats), persistant: slots(ps.persistant), powerups: slots(ps.powerups), ammo: slots(ps.ammo) });
      const scene = simulation.scene;
      const visible = selectQ3SnapshotEntities(state, { entityCount: source.pool.numEntities, dead: false, print: options.print,
        entity: number => { const item = source.pool.at(number); return { state: wireEntity(number), linked: item.inuse && item.r.linked, flags: item.r.svFlags, singleClient: item.r.singleClient }; },
        link: number => { const item = source.pool.at(number), linked = simulation.bodies.linked(item.actor.id); if (linked === null) return undefined;
          const leaves = scene.boxLeaves(linked.absoluteBounds, 128).leaves, areas = [...new Set(leaves.map(leaf => scene.leafArea(leaf)))], clusters = [...new Set(leaves.map(leaf => scene.leafCluster(leaf)).filter(cluster => cluster >= 0))];
          return { areanum: areas[0] ?? -1, areanum2: areas[1] ?? -1, clusters, lastCluster: 0 }; },
        collision: { pointLeafnum: point => scene.pointLeaf(point), leafArea: leaf => scene.leafArea(leaf), leafCluster: leaf => scene.leafCluster(leaf), areasConnected: (a, b) => scene.areasConnected(a, b),
          writeAreaBits: (bytes, area) => { const bits = scene.areaBits(area); for (let index = 0; index < bits.length; index++) bytes[index] = (bytes[index] ?? 0) | (bits[index] ?? 0); return bits.length; },
          clusterPVS: cluster => ({ byteAt: index => { let value = 0; for (let bit = 0; bit < 8; bit++) if (scene.clusterVisible(cluster, index * 8 + bit, 'pvs')) value |= 1 << bit; return value; } }),
        },
      });
      return { player: state, ...visible };
    },
    input: (player, command, sequence) => ({ actor: player.actor, source: { kind: 'remote-client', client: player.client }, sequence, command: toQ3UserCommand(command) }),
    command: (player, name, args) => source.playerCommand(player.actor, name, args),
    userinfo: (player, value) => { source.host.engine.setUserinfo(player.sourceEntity, value); source.admission.userinfoChanged(player.sourceEntity); },
    status: (challenge, detailed) => {
      const info = `${source.host.cvars.infoString(CvarFlag.ServerInfo)}\\protocol\\${Q3_PROTOCOL.version}\\challenge\\${challenge.replace(/[\\;"\n\r]/g, '')}\\clients\\${simulation.players().length}`;
      const players = simulation.players().map(actor => { const client = source.records.byActor(actor)?.client; return client == null ? '' : `${client.ps.persistant.get(0)} ${client.ps.ping} "${client.pers.netname}"\n`; }).join('');
      return detailed ? `statusResponse\n${info}\n${players}` : `infoResponse\n${info}`;
    }, print: options.print,
  };
}
