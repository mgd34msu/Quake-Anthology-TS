import type { ActorId } from "../../../contracts/identity.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { EntityState } from "../../../content/q3/base/shared/entity-state.ts";
import { PlayerState } from "../../../content/q3/base/shared/player-state.ts";
import { EntityType, MoveType, WeaponState, statSchema } from "../../../content/q3/base/shared/definitions.ts";
import { GameMemory } from "../../../content/q3/base/game/memory.ts";
import type { BotObservedEntity, SourceBotGame } from "../../../bots/behavior/q3/game-host.ts";
import { createQ2BotKnowledge } from "./bot-q2-knowledge.ts";
import type { SharedSimulation } from "./runtime.ts";

interface Options {
  readonly simulation: SharedSimulation;
  readonly cvars: CvarRegistry;
  actor(client: number): ActorId | null;
  connect(client: number, restart: boolean): boolean;
  drop(client: number): void;
  print(text: string): void;
  console(text: string): void;
  message(client: number, text: string): void;
}
const zero = { x: 0, y: 0, z: 0 };

/** A sensory projection and ID lookup over existing Q2 actors, with no entity or physics ownership. */
export function createQ2BotWorld(options: Options) {
  const simulation = options.simulation, source = simulation.q2Source();
  if (source === null) throw new Error("Q2 bot observations require the admitted Q2 world");
  const knowledge = createQ2BotKnowledge({ simulation, actorForClient: options.actor });
  const cvars = options.cvars;
  for (const [name, value] of Object.entries({ sv_maxclients: String(simulation.options.maxClients), g_gametype: "0", mapname: source.game.options.mapName,
    sv_mapname: source.game.options.mapName, g_spSkill: "2", bot_enable: "1", bot_minplayers: "0", dedicated: "1", g_gravity: String(simulation.physics.gravity) })) cvars.register(name, value);
  cvars.set("mapname", source.game.options.mapName, true); cvars.set("sv_mapname", source.game.options.mapName, true);
  const ids = new Map<ActorId, number>(), actors = new Map<number, ActorId>(), userinfos = new Map<number, string>(), strings = new Map<number, string>(), models = new Map<string, number>();
  let nextEntity = 64, nextGeneration = 1, refreshedAt = -1;
  const freeIds: number[] = [], generations = new Map<number, number>(), begun = new Set<number>();
  const retire = (): void => {
    for (const [actor, id] of ids) if (!simulation.actors.isLive(actor)) { ids.delete(actor); actors.delete(id); freeIds.push(id); }
  };
  const entityId = (actor: ActorId): number => {
    const player = simulation.movementPlayer(actor);
    if (player !== null) return player.client.slot;
    if (source.game.entity(actor)?.classname === "worldspawn") return 1022;
    const existing = ids.get(actor); if (existing !== undefined) return existing;
    retire();
    const id = freeIds.pop() ?? nextEntity++;
    if (id >= 1022) throw new Error("Live bot observations exceed the current simultaneous entity capacity");
    ids.set(actor, id); actors.set(id, actor); generations.set(id, nextGeneration++); return id;
  };
  const refresh = (): void => {
    if (refreshedAt === simulation.timeSeconds) return;
    refreshedAt = simulation.timeSeconds; retire();
    for (const actor of source.game.entities.keys()) entityId(actor);
  };
  const actorForId = (number: number): ActorId | null => number < 64
    ? simulation.players().find(actor => simulation.movementPlayer(actor)?.client.slot === number) ?? null : actors.get(number) ?? null;
  const modelIndex = (name: string): number => {
    if (name === "") return 0;
    const existing = models.get(name); if (existing !== undefined) return existing;
    const index = models.size + 1; models.set(name, index); return index;
  };
  const playerInfo = (client: number): string => {
    const actor = actorForId(client), player = actor === null ? undefined : source.players.states.get(actor);
    if (player === undefined) return "";
    return `\\n\\${player.name}\\t\\${player.spectator ? 3 : 0}\\model\\${player.skin}`;
  };
  const game: SourceBotGame = {
    options: { product: "baseq3", cvars, configstrings: { get: index => index >= 544 && index < 608 ? playerInfo(index - 544) : strings.get(index) ?? "", set: (index, value) => { strings.set(index, value); } },
      engine: { print: options.print, getUserinfo: client => userinfos.get(client) ?? "", setUserinfo: (client, info) => { userinfos.set(client, info); },
        sendServerCommand: options.message, dropClient: (client, reason) => { options.print(reason); options.drop(client); },
        insertConsoleCommand: options.console, appendConsoleCommand: options.console } },
    gameType: 0, maxClients: simulation.options.maxClients,
    get entityCount() { refresh(); return nextEntity; },
    random: { random: () => source.game.host.random(), crandom: () => source.game.host.random() * 2 - 1 },
    clock: { get time() { return Math.trunc(simulation.timeSeconds * 1000); }, startTime: 0, get intermissionTime() { return source.players.intermission.kind === "playing" ? 0 : Math.trunc(source.players.intermission.started * 1000); } },
    memory: new GameMemory(() => 0, options.print), knowledge: knowledge.knowledge,
    entity: number => {
      refresh();
      const actor = actorForId(number), entity = actor === null ? null : source.game.entity(actor), state = new EntityState(); state.number = number;
      const body = actor === null ? null : simulation.bodies.read(actor), movement = actor === null ? null : simulation.movementPlayer(actor);
      const common = actor === null ? undefined : source.players.states.get(actor);
      let player: BotObservedEntity["player"] = null;
      if (actor !== null && movement !== null && common !== undefined && body !== null) {
        const ps = new PlayerState("baseq3"), combat = simulation.combat.read(actor), schema = statSchema("baseq3");
        ps.clientNum = movement.client.slot; ps.origin = { ...body.origin }; ps.velocity = { ...body.velocity }; ps.viewangles = { ...movement.viewAngles };
        ps.viewheight = movement.viewHeight; ps.groundEntityNum = body.ground === null ? 1023 : entityId(body.ground);
        ps.pmType = common.spectator ? MoveType.PM_SPECTATOR : (combat?.health ?? 0) <= 0 ? MoveType.PM_DEAD : MoveType.PM_NORMAL;
        ps.weapon = knowledge.sourceWeapon(number); const phase = source.weapons.states.get(actor)?.phase;
        ps.weaponState = phase === "activating" ? WeaponState.WEAPON_RAISING : phase === "dropping" ? WeaponState.WEAPON_DROPPING
          : phase === "firing" ? WeaponState.WEAPON_FIRING : WeaponState.WEAPON_READY;
        ps.stats.set(schema.health, combat?.health ?? 0); ps.stats.set(schema.armor, combat === null || combat.armor.kind === "none" ? 0 : combat.armor.points); ps.stats.set(schema.maxHealth, entity?.maxHealth ?? 100);
        ps.persistant.set(0, common.score); ps.persistant.set(3, common.spectator ? 3 : 0);
        player = { state: ps, connected: options.actor(number) === null || begun.has(number), team: common.spectator ? 3 : 0, name: common.name, lastHurtClient: 0, lastHurtMod: 0 };
        state.eType = EntityType.ET_PLAYER; state.weapon = ps.weapon; Object.assign(state.pos.base, body.origin); Object.assign(state.apos.base, movement.viewAngles);
        state.groundEntityNum = ps.groundEntityNum;
      } else state.eType = entity?.solid === "brush" ? EntityType.ET_MOVER : EntityType.ET_GENERAL;
      state.origin = { ...(body?.origin ?? zero) }; state.modelindex = entity === null ? 0 : modelIndex(entity.model); state.frame = entity?.frame ?? 0;
      return { generation: number < 64 ? actor?.generation ?? 0 : generations.get(number) ?? 0, present: entity !== null && body !== null, linked: actor !== null && simulation.bodies.linked(actor) !== null,
        hidden: entity === null || (entity.serverFlags & 1) !== 0, bot: actor !== null && options.actor(number)?.equals(actor) === true,
        state, origin: { ...(body?.origin ?? zero) }, angles: { ...(body?.angles ?? zero) }, bounds: body?.bounds ?? { min: zero, max: zero },
        contents: entity?.solid === "brush" ? 1 : player === null ? 0 : 0x2000000,
        inlineModel: entity?.model.startsWith("*") ? Number(entity.model.slice(1)) : null,
        classname: entity?.classname ?? null, eventTime: 0, activatorFrame: null, proximityTrigger: false, player };
    },
    world: { pointContents: point => source.game.host.pointContents(point), trace: query => {
      const result = source.game.host.trace({ start: query.start, end: query.end,
        bounds: query.shape.kind === "point" ? null : { min: query.shape.mins, max: query.shape.maxs }, ignore: actorForId(query.passEntityNum), mask: query.mask | ((query.mask & 0x2000000) !== 0 ? 0x40000000 : 0) });
      return { fraction: result.fraction, end: result.end, entityNum: result.hit.kind === "actor" ? entityId(result.hit.actor) : result.hit.kind === "world" ? 1022 : 1023,
        solidity: result.allSolid ? "all-solid" : result.startSolid ? "start-solid" : "clear", contact: result.contact,
        contents: result.kind === "q1" ? 0 : result.contents, surfaceFlags: result.kind === "q2" ? result.surface?.flags ?? 0 : result.kind === "q3" ? result.surfaceFlags : 0 };
    } },
    modelIndex, chooseTeam: () => 0, activateBot: client => { const actor = options.actor(client), entity = source.game.entity(actor); if (entity !== null) entity.serverFlags |= 16; },
    exitLevel: () => { source.players.endDeathmatchLevel(source.game); }, resetPodiumPlayers: () => {},
    clientUserinfoChanged: client => { const entity = source.game.entity(options.actor(client)); if (entity !== null) source.players.userinfoChanged(entity, source.game, userinfos.get(client) ?? ""); },
    clientConnect: (client, firstTime, bot) => {
      const result = source.product.rerelease === null ? source.players.connect(source.game, userinfos.get(client) ?? "") : source.product.rerelease.players.connect(source.game, userinfos.get(client) ?? "", bot);
      if (!result.allowed) return result.reason;
      userinfos.set(client, result.userinfo); game.clientUserinfoChanged(client);
      return options.connect(client, !firstTime) ? null : "Bot setup failed";
    },
    clientBegin: client => { begun.add(client); },
  };
  return { game, knowledge, entityId, actorForId };
}
