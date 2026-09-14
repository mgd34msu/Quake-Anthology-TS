import type { SavedActorId, SavedBodyState } from "../../../../contracts/session.ts";
import type { SessionActorRegistry } from "../../../../world/actors/registry.ts";
import { savedActorId } from "../../../../persistence/save-image.ts";
import type { Q3EntityRecords } from "../records.ts";
import { itemAt, itemList } from "../shared/items.ts";
import { GameEntity, MAX_CLIENTS, MAX_GENTITIES } from "./state.ts";
import type { GameClient } from "./state.ts";
import type { EntityPool } from "./entities.ts";
import type { PlayerState, PlayerStateSlots } from "../shared/player-state.ts";
import { captureEntityValues, restoreEntityValues, captureClientValues, restoreClientValues,
  capturePlayerValues, restorePlayerValues, capturePersistantValues, restorePersistantValues,
  captureTeamValues, restoreTeamValues, captureSessionValues, restoreSessionValues,
  captureNetworkValues, restoreNetworkValues } from "./save-values.ts";
import type { EntityValues, ClientValues, PlayerValues, PersistantValues, TeamValues, SessionValues, NetworkValues } from "./save-values.ts";

export interface Q3EntityState {
  readonly values: EntityValues;
  readonly network: NetworkValues;
  readonly pos: GameEntity["s"]["pos"];
  readonly apos: GameEntity["s"]["apos"];
  readonly shared: Pick<GameEntity["r"], "svFlags" | "singleClient" | "model" | "contents" | "ownerNum">;
  readonly sharedPrivate: {
    readonly previousLink: { readonly actor: SavedActorId; readonly state: SavedBodyState; readonly absoluteBounds: { readonly min: GameEntity["r"]["mins"]; readonly max: GameEntity["r"]["maxs"] }; readonly linkCount: number } | null;
    readonly absMinOverride: GameEntity["r"]["mins"] | null;
    readonly absMaxOverride: GameEntity["r"]["maxs"] | null;
  };
  readonly client: number | null;
  readonly classname: { readonly kind: "value"; readonly value: string | null } | { readonly kind: "client-name"; readonly client: number };
  readonly parent: number | null; readonly nextTrain: number | null; readonly prevTrain: number | null;
  readonly targetEnt: number | null; readonly chain: number | null; readonly enemy: number | null;
  readonly activator: number | null; readonly teamchain: number | null; readonly teammaster: number | null;
  readonly activation: { readonly kind: "entity"; readonly slot: number } | { readonly kind: "actor"; readonly actor: SavedActorId } | null;
  readonly item: number | null;
  readonly nextthink: number;
  readonly think: string | null; readonly reached: string | null; readonly blocked: string | null;
  readonly touch: string | null; readonly use: string | null; readonly pain: string | null; readonly die: string | null;
}
export interface Q3ClientState {
  readonly values: ClientValues;
  readonly player: PlayerValues;
  readonly persistant: PersistantValues;
  readonly command: GameClient["pers"]["cmd"];
  readonly team: TeamValues;
  readonly session: SessionValues;
  readonly events: readonly number[]; readonly eventParms: readonly number[];
  readonly persistantSlots: readonly number[]; readonly powerups: readonly number[]; readonly ammoTimes: readonly number[];
  readonly backing: ReturnType<Q3EntityRecords["captureClientBacking"]>;
  readonly hook: number | null; readonly persistantPowerup: number | null;
  readonly areabits: Uint8Array | null;
}
export interface Q3GraphState {
  readonly ownership: readonly { readonly actor: SavedActorId | null; readonly active: boolean; readonly borrowed: boolean }[];
  readonly entities: readonly Q3EntityState[];
  readonly clients: readonly Q3ClientState[];
  readonly numEntities: number;
  readonly maxClients: number;
}
function trajectory(value: GameEntity["s"]["pos"]): GameEntity["s"]["pos"] {
  return { type: value.type, time: value.time, duration: value.duration, base: { ...value.base }, delta: { ...value.delta } };
}
function restoreSlots(target: PlayerStateSlots, values: readonly number[]): void {
  if (values.length !== target.length) throw new Error("Q3 saved player slot count mismatch");
  values.forEach((value, index) => target.set(index, value));
}
export function captureQ3Graph(records: Q3EntityRecords, pool: EntityPool): Q3GraphState {
  const entitySlot = (entity: GameEntity | null): number | null => {
    if (entity === null) return null;
    if (pool.get(entity.slot) !== entity) throw new Error("Q3 graph contains a foreign entity record");
    return entity.slot;
  };
  const clientSlot = (client: GameClient | null): number | null => {
    if (client === null) return null;
    const slot = pool.clients.indexOf(client);
    if (slot < 0) throw new Error("Q3 graph contains a foreign client record");
    return slot;
  };
  const callbacks = pool.callbacks;
  return {
    ownership: records.captureOwnership().map(state => ({ ...state, actor: state.actor === null ? null : savedActorId(state.actor.id) })),
    numEntities: pool.numEntities, maxClients: pool.maxClients,
    entities: Array.from({ length: MAX_GENTITIES }, (_, slot): Q3EntityState => {
      const entity = pool.at(slot), classname = entity.captureClassname();
      const privateState = entity.r.capturePrivateState(), link = privateState.previousLink;
      const sharedPrivate = { absMinOverride: privateState.absMinOverride === null ? null : { ...privateState.absMinOverride },
        absMaxOverride: privateState.absMaxOverride === null ? null : { ...privateState.absMaxOverride },
        previousLink: link === null ? null : { actor: savedActorId(link.actor), linkCount: link.linkCount,
          absoluteBounds: { min: { ...link.absoluteBounds.min }, max: { ...link.absoluteBounds.max } },
          state: { origin: { ...link.state.origin }, angles: { ...link.state.angles }, velocity: { ...link.state.velocity },
            bounds: { min: { ...link.state.bounds.min }, max: { ...link.state.bounds.max } }, ground: link.state.ground === null ? null : savedActorId(link.state.ground) } } };
      const savedClassname = (): Q3EntityState["classname"] => {
        if (classname.kind === "value") return { ...classname };
        const client = clientSlot(classname.client);
        if (client === null) throw new Error("Q3 bound classname has no client");
        return { kind: "client-name", client };
      };
      if (entity.activation instanceof GameEntity) entitySlot(entity.activation);
      const item = entity.item === null ? null : itemList(records.product).indexOf(entity.item);
      if (item === -1) throw new Error("Q3 entity has an unknown item identity");
      return { values: captureEntityValues(entity), network: captureNetworkValues(entity.s), pos: trajectory(entity.s.pos), apos: trajectory(entity.s.apos),
        shared: { svFlags: entity.r.svFlags, singleClient: entity.r.singleClient, model: { ...entity.r.model }, contents: entity.r.contents, ownerNum: entity.r.ownerNum },
        sharedPrivate, client: clientSlot(entity.client), classname: savedClassname(),
        parent: entitySlot(entity.parent), nextTrain: entitySlot(entity.nextTrain), prevTrain: entitySlot(entity.prevTrain),
        targetEnt: entitySlot(entity.targetEnt), chain: entitySlot(entity.chain), enemy: entitySlot(entity.enemy), activator: entitySlot(entity.activator),
        teamchain: entitySlot(entity.teamchain), teammaster: entitySlot(entity.teammaster),
        activation: entity.activation === null ? null : entity.activation instanceof GameEntity
          ? { kind: "entity", slot: entity.activation.slot } : { kind: "actor", actor: savedActorId(entity.activation.actor) },
        item, nextthink: entity.nextthink, think: callbacks.think.capture(entity.think), reached: callbacks.reached.capture(entity.reached),
        blocked: callbacks.blocked.capture(entity.blocked), touch: callbacks.touch.capture(entity.touch), use: callbacks.use.capture(entity.use),
        pain: callbacks.pain.capture(entity.pain), die: callbacks.die.capture(entity.die) };
    }),
    clients: pool.clients.map((client, slot): Q3ClientState => ({ values: captureClientValues(client), player: capturePlayerValues(client.ps),
      persistant: capturePersistantValues(client.pers), command: { ...client.pers.cmd, angles: { ...client.pers.cmd.angles } },
      team: captureTeamValues(client.pers.teamState), session: captureSessionValues(client.sess),
      events: Array.from(client.ps.events.copy()), eventParms: Array.from(client.ps.eventParms.copy()),
      persistantSlots: Array.from(client.ps.persistant.copy()), powerups: Array.from(client.ps.powerups.copy()), ammoTimes: Array.from(client.ammoTimes.copy()),
      backing: records.captureClientBacking(slot), hook: entitySlot(client.hook), persistantPowerup: entitySlot(client.persistantPowerup),
      areabits: client.areabits === null ? null : client.areabits.slice() })),
  };
}

export function prepareQ3Graph(records: Q3EntityRecords, state: Q3GraphState, actors: Pick<SessionActorRegistry, "resolveSaved">): void {
  if (state.entities.length !== MAX_GENTITIES || state.clients.length !== MAX_CLIENTS) throw new Error("Q3 save must retain all entity and client slots");
  records.restoreOwnership(state.ownership.map(entry => {
    const actor = entry.actor === null ? null : actors.resolveSaved(entry.actor);
    if (entry.actor !== null && actor === null) throw new Error("Q3 saved ownership actor is not live");
    return { actor, active: entry.active, borrowed: entry.borrowed };
  }));
  state.clients.forEach((client, slot) => records.restoreClientBacking(slot, client.backing));
}

export function restoreQ3Graph(records: Q3EntityRecords, pool: EntityPool, state: Q3GraphState, actors: Pick<SessionActorRegistry, "referenceSaved">): void {
  if (state.entities.length !== MAX_GENTITIES || state.clients.length !== MAX_CLIENTS) throw new Error("Q3 save must retain all entity and client slots");
  const entity = (slot: number | null): GameEntity | null => slot === null ? null : pool.at(slot);
  const callbacks = pool.callbacks;
  state.entities.forEach((saved, slot) => {
    const target = pool.at(slot);
    restoreEntityValues(target, saved.values); restoreNetworkValues(target.s, saved.network);
    target.s.pos = trajectory(saved.pos); target.s.apos = trajectory(saved.apos);
    target.r.svFlags = saved.shared.svFlags; target.r.singleClient = saved.shared.singleClient;
    target.r.model = { ...saved.shared.model }; target.r.contents = saved.shared.contents; target.r.ownerNum = saved.shared.ownerNum;
    const link = saved.sharedPrivate.previousLink;
    target.r.restorePrivateState({ absMinOverride: saved.sharedPrivate.absMinOverride, absMaxOverride: saved.sharedPrivate.absMaxOverride,
      previousLink: link === null ? null : { actor: actors.referenceSaved(link.actor), linkCount: link.linkCount, absoluteBounds: link.absoluteBounds,
        state: { ...link.state, ground: link.state.ground === null ? null : actors.referenceSaved(link.state.ground) } } });
    target.client = saved.client === null ? null : pool.clientAt(saved.client);
    if (saved.classname.kind === "value") target.classname = saved.classname.value;
    else target.bindClientName(pool.clientAt(saved.classname.client));
    target.parent = entity(saved.parent); target.nextTrain = entity(saved.nextTrain); target.prevTrain = entity(saved.prevTrain);
    target.targetEnt = entity(saved.targetEnt); target.chain = entity(saved.chain); target.enemy = entity(saved.enemy);
    target.activator = entity(saved.activator); target.teamchain = entity(saved.teamchain); target.teammaster = entity(saved.teammaster);
    target.activation = saved.activation === null ? null : saved.activation.kind === "entity"
      ? pool.at(saved.activation.slot) : records.damageInflictor(actors.referenceSaved(saved.activation.actor));
    target.item = saved.item === null ? null : itemAt(records.product, saved.item);
    target.restoreNextThink(saved.nextthink);
    target.think = callbacks.think.resolve(saved.think); target.reached = callbacks.reached.resolve(saved.reached);
    target.blocked = callbacks.blocked.resolve(saved.blocked); target.touch = callbacks.touch.resolve(saved.touch);
    target.use = callbacks.use.resolve(saved.use); target.pain = callbacks.pain.resolve(saved.pain); target.die = callbacks.die.resolve(saved.die);
  });
  state.clients.forEach((saved, slot) => {
    const target = records.client(slot);
    restoreClientValues(target, saved.values); restorePlayerValues(target.ps, saved.player);
    restorePersistantValues(target.pers, saved.persistant); target.pers.cmd = { ...saved.command, angles: { ...saved.command.angles } };
    restoreTeamValues(target.pers.teamState, saved.team); restoreSessionValues(target.sess, saved.session);
    restoreSlots(target.ps.events, saved.events); restoreSlots(target.ps.eventParms, saved.eventParms);
    restoreSlots(target.ps.persistant, saved.persistantSlots); restoreSlots(target.ps.powerups, saved.powerups); restoreSlots(target.ammoTimes, saved.ammoTimes);
    target.hook = entity(saved.hook); target.persistantPowerup = entity(saved.persistantPowerup);
    target.areabits = saved.areabits === null ? null : saved.areabits.slice();
  });
  pool.restoreCounts(state);
  records.restoreCallbacks();
}

type CompleteCoverage<T extends never> = T;
export type Q3EntityStateCoverage = CompleteCoverage<Exclude<keyof GameEntity, keyof EntityValues
  | "s" | "r" | "client" | "inuse" | "actor" | "classname" | "captureClassname" | "bindClientName" | "restoreNextThink"
  | "parent" | "nextTrain" | "prevTrain" | "targetEnt" | "nextthink" | "think" | "reached" | "blocked" | "touch" | "use" | "pain" | "die"
  | "health" | "takedamage" | "chain" | "enemy" | "activator" | "activation" | "teamchain" | "teammaster" | "item" | "slot" | "binding">>;
export type Q3ClientStateCoverage = CompleteCoverage<Exclude<keyof GameClient, keyof ClientValues
  | "ps" | "pers" | "sess" | "hook" | "persistantPowerup" | "ammoTimes" | "areabits">>;
export type Q3PlayerStateCoverage = CompleteCoverage<Exclude<keyof PlayerState, keyof PlayerValues
  | "origin" | "velocity" | "stats" | "ammo" | "events" | "eventParms" | "persistant" | "powerups"
  | "product" | "copy" | "copyFrom" | "health" | "setEventDebug" | "addEvent">>;
