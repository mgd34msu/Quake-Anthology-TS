import { observeQ1Supply, previewQ1Supply } from "../../../content/q1/foundation/pickups.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import type { CvarRegistry } from "../../../core/cvars/index.ts";
import { EntityState } from "../../../content/q3/base/shared/entity-state.ts";
import { PlayerState } from "../../../content/q3/base/shared/player-state.ts";
import { EntityType, MoveType, WeaponState, statSchema } from "../../../content/q3/base/shared/definitions.ts";
import { GameMemory } from "../../../content/q3/base/game/memory.ts";
import type { BotObservedEntity, BotObservedPickup, SourceBotGame } from "../../../bots/behavior/q3/game-host.ts";
import { createQ1BotKnowledge } from "./bot-q1-knowledge.ts";
import { createQ2BotKnowledge } from "./bot-q2-knowledge.ts";
import type { SharedSimulation } from "./runtime.ts";

interface Options {
  readonly simulation: SharedSimulation;
  readonly cvars: CvarRegistry;
  actor(client: number): ActorId | null;
  connect(client: number, restart: boolean): boolean;
  drop(client: number): void;
  begin(client: number): void;
  print(text: string): void;
  console(text: string): void;
  message(client: number, text: string): void;
}
const zero = { x: 0, y: 0, z: 0 };

/** A sensory projection and ID lookup over existing shared actors, with no entity or physics ownership. */
export function createSharedBotWorld(options: Options) {
  const simulation = options.simulation, source = simulation.q2Source() ?? simulation.q1Source();
  if (source === null) throw new Error("Shared bot observations require an admitted Q1 or Q2 world");
  const arsenal = simulation.q2WeaponSource();
  const nativeQ1 = source.kind === "q1" && simulation.weaponProvider.provider === simulation.recipe.map.entities.provider
    && simulation.weaponProvider.content === simulation.recipe.map.entities.content;
  if (arsenal === null && !nativeQ1) throw new Error("Shared bot weapon observations require native Q1 or native/selected Q2 weapons");
  const numeric = simulation.recipe.timing.find(entry => entry.provider === simulation.recipe.engineBehavior.provider)?.numeric;
  if (numeric === undefined) throw new Error("Bot world has no source numeric policy");
  const policy = { kind: "q3", contentsMask: -1, curves: true, playerCurveClip: true } satisfies import("../../../contracts/scene.ts").TracePolicy;
  const mapName = source.kind === "q2" ? source.game.options.mapName : source.game.mapName;
  const clientInfo = (actor: ActorId | null) => {
    if (actor === null) return null;
    if (source.kind === "q2") {
      const player = source.players.states.get(actor);
      return player === undefined ? null : { name: player.name, spectator: player.spectator, score: player.score, skin: player.skin };
    }
    const player = source.composition.clients.get(actor);
    return player === null ? null : { name: player.name, spectator: player.observer, score: player.frags, skin: simulation.recipe.character.appearance.provider };
  };
  const metadata = (actor: ActorId | null) => {
    if (actor === null) return null;
    const q2 = source.kind === "q2" ? source.game.entity(actor) : arsenal?.game.entity(actor) ?? null;
    if (q2 !== null) return { model: q2.model, frame: q2.frame, classname: q2.classname, hidden: (q2.serverFlags & 1) !== 0, maxHealth: q2.maxHealth };
    const q1 = source.kind === "q1" ? source.game.entity(actor) : null;
    return q1 === null ? null : { model: q1.model, frame: q1.frame, classname: q1.classname, hidden: false, maxHealth: source.kind === "q1" ? source.game.player(actor)?.maxHealth ?? q1.maxHealth : q1.maxHealth };
  };
  const knowledge = arsenal !== null ? createQ2BotKnowledge({ simulation, actorForClient: client => actorForId(client) })
    : createQ1BotKnowledge({ simulation, actorForClient: client => actorForId(client) });
  const cvars = options.cvars;
  for (const [name, value] of Object.entries({ sv_maxclients: String(simulation.options.maxClients), g_gametype: "0", mapname: mapName,
    sv_mapname: mapName, g_spSkill: "2", bot_enable: "1", bot_minplayers: "0", dedicated: "1", g_gravity: String(simulation.physics.gravity) })) cvars.register(name, value);
  cvars.set("mapname", mapName, true); cvars.set("sv_mapname", mapName, true);
  const ids = new Map<ActorId, number>(), actors = new Map<number, ActorId>(), userinfos = new Map<number, string>(), strings = new Map<number, string>(), models = new Map<string, number>();
  let nextEntity = 64, nextGeneration = 1;
  const freeIds: number[] = [], generations = new Map<number, number>(), begun = new Set<number>();
  const retire = (): void => {
    for (const [actor, id] of ids) if (!simulation.actors.isLive(actor)) { ids.delete(actor); actors.delete(id); freeIds.push(id); }
  };
  const entityId = (actor: ActorId): number => {
    const player = simulation.movementPlayer(actor);
    if (player !== null) return player.client.slot;
    if (metadata(actor)?.classname === "worldspawn") return 1022;
    const existing = ids.get(actor); if (existing !== undefined) return existing;
    retire();
    const id = freeIds.pop() ?? nextEntity++;
    if (id >= 1022) throw new Error("Live bot observations exceed the current simultaneous entity capacity");
    ids.set(actor, id); actors.set(id, actor); generations.set(id, nextGeneration++); return id;
  };
  const refresh = (): void => {
    retire();
    for (const actor of simulation.actors.observations()) if (simulation.bodies.read(actor.id) !== null) entityId(actor.id);
  };
  const actorForId = (number: number): ActorId | null => {
    const actor = number < 64 ? simulation.players().find(actor => simulation.movementPlayer(actor)?.client.slot === number) ?? null
      : number === 1022 ? source.kind === "q1" ? source.game.world?.actor.id ?? null : source.game.host.worldActor() : actors.get(number) ?? null;
    return actor !== null && simulation.actors.isLive(actor) ? actor : null;
  };
  const modelIndex = (name: string): number => {
    if (name === "") return 0;
    const existing = models.get(name); if (existing !== undefined) return existing;
    const index = models.size + 1; models.set(name, index); return index;
  };
  const playerInfo = (client: number): string => {
    const actor = actorForId(client), player = clientInfo(actor);
    if (player === null) return "";
    return `\\n\\${player.name}\\t\\${player.spectator ? 3 : 0}\\model\\${player.skin}`;
  };
  const inspectPickup = (client: number, actor: ActorId): BotObservedPickup | null => {
    const recipient = actorForId(client);
    if (recipient === null || !simulation.actors.isLive(actor)) return null;
    const body = simulation.bodies.read(actor);
    if (body === null) return null;
    const observation = source.kind === "q1" ? observeQ1Supply(source.game, actor, recipient) : source.items.observeSupply(source.game, actor, recipient);
    if (observation === null) return null;
    const preview = source.kind === "q1" ? previewQ1Supply(source.game, actor, recipient)
      : source.items.previewSupply(source.game, actor, recipient);
    if (preview === null) return null;
    const entity = metadata(actor);
    return { observation, preview, entity: entityId(actor), origin: { ...body.origin },
      bounds: { min: { ...body.bounds.min }, max: { ...body.bounds.max } }, name: entity?.classname ?? observation.offer.kind };
  };
  const game: SourceBotGame = {
    pickups: { inspect: inspectPickup, candidates: client => {
      const pickups: BotObservedPickup[] = [];
      for (const actor of actors.values()) { const pickup = inspectPickup(client, actor); if (pickup !== null) pickups.push(pickup); }
      return pickups;
    } },
    options: { product: "baseq3", cvars, configstrings: { get: index => index >= 544 && index < 608 ? playerInfo(index - 544) : strings.get(index) ?? "", set: (index, value) => { strings.set(index, value); } },
      engine: { print: options.print, getUserinfo: client => userinfos.get(client) ?? "", setUserinfo: (client, info) => { userinfos.set(client, info); },
        sendServerCommand: options.message, dropClient: (client, reason) => { options.print(reason); options.drop(client); },
        insertConsoleCommand: options.console, appendConsoleCommand: options.console } },
    gameType: 0, maxClients: simulation.options.maxClients,
    get entityCount() { return nextEntity; },
    random: { random: () => source.game.host.random(), crandom: () => source.game.host.random() * 2 - 1 },
    clock: { get time() { return Math.trunc(simulation.timeSeconds * 1000); }, startTime: 0, get intermissionTime() { return source.kind === "q2" ? source.players.intermission.kind === "playing" ? 0 : Math.trunc(source.players.intermission.started * 1000) : source.game.intermission === null ? 0 : Math.trunc((source.game.intermission.exitAfter - 5) * 1000); } },
    memory: new GameMemory(() => 0, options.print), knowledge: knowledge.knowledge,
    entity: number => {
      const actor = actorForId(number), entity = metadata(actor), state = new EntityState(); state.number = number;
      const body = actor === null ? null : simulation.bodies.read(actor), movement = actor === null ? null : simulation.movementPlayer(actor);
      const common = clientInfo(actor);
      let player: BotObservedEntity["player"] = null;
      if (actor !== null && movement !== null && common !== null && body !== null) {
        const ps = new PlayerState("baseq3"), combat = simulation.combat.read(actor), schema = statSchema("baseq3");
        ps.clientNum = movement.client.slot; ps.origin = { ...body.origin }; ps.velocity = { ...body.velocity }; ps.viewangles = { ...movement.viewAngles };
        ps.viewheight = movement.viewHeight; ps.groundEntityNum = body.ground === null ? 1023 : entityId(body.ground);
        ps.pmType = common.spectator ? MoveType.PM_SPECTATOR : (combat?.health ?? 0) <= 0 ? MoveType.PM_DEAD : MoveType.PM_NORMAL;
        ps.weapon = knowledge.sourceWeapon(number); const phase = arsenal?.weapons.states.get(actor)?.phase;
        ps.weaponState = phase === "activating" ? WeaponState.WEAPON_RAISING : phase === "dropping" ? WeaponState.WEAPON_DROPPING
          : phase === "firing" || arsenal === null && source.kind === "q1" && (source.game.player(actor)?.attackFinished ?? 0) > source.game.time
            ? WeaponState.WEAPON_FIRING : WeaponState.WEAPON_READY;
        ps.stats.set(schema.health, combat?.health ?? 0); ps.stats.set(schema.armor, combat === null || combat.armor.kind === "none" ? 0 : combat.armor.points); ps.stats.set(schema.maxHealth, entity?.maxHealth ?? 100);
        ps.persistant.set(0, common.score); ps.persistant.set(3, common.spectator ? 3 : 0);
        player = { state: ps, connected: options.actor(number) === null || begun.has(number), team: common.spectator ? 3 : 0, name: common.name, lastHurtClient: 0, lastHurtMod: 0 };
        state.eType = EntityType.ET_PLAYER; state.weapon = ps.weapon; Object.assign(state.pos.base, body.origin); Object.assign(state.apos.base, movement.viewAngles);
        state.groundEntityNum = ps.groundEntityNum;
      } else state.eType = actor !== null && simulation.physics.solidOf(actor)?.solid === "brush" ? EntityType.ET_MOVER : EntityType.ET_GENERAL;
      state.origin = { ...(body?.origin ?? zero) }; state.modelindex = entity === null ? 0 : modelIndex(entity.model); state.frame = entity?.frame ?? 0;
      return { generation: number < 64 ? actor?.generation ?? 0 : generations.get(number) ?? 0, present: actor !== null && simulation.actors.isLive(actor) && body !== null, linked: actor !== null && simulation.bodies.linked(actor) !== null,
        hidden: entity?.hidden ?? false, bot: actor !== null && options.actor(number)?.equals(actor) === true,
        state, origin: { ...(body?.origin ?? zero) }, angles: { ...(body?.angles ?? zero) }, bounds: body?.bounds ?? { min: zero, max: zero },
        contents: actor !== null && simulation.physics.solidOf(actor)?.solid === "brush" ? 1 : player === null ? 0 : 0x2000000,
        inlineModel: entity?.model.startsWith("*") ? Number(entity.model.slice(1)) : null,
        classname: entity?.classname ?? null, eventTime: 0, activatorFrame: null, proximityTrigger: false, player };
    },
    world: { pointContents: point => {
      const result = simulation.scene.pointContents({ point, target: { kind: "world" }, passActor: null, policy, numeric });
      if (result.kind !== "q3") throw new Error("Bot contents did not use the Q3 decision representation");
      return result.contents;
    }, trace: query => {
      const result = simulation.scene.trace({ start: query.start, end: query.end,
        shape: query.shape.kind === "point" ? { kind: "point" } : { kind: "box", bounds: { min: query.shape.mins, max: query.shape.maxs } },
        target: { kind: "world" }, policy: { ...policy, contentsMask: query.mask }, numeric, passActor: actorForId(query.passEntityNum) });
      if (result.kind !== "q3") throw new Error("Bot trace did not use the Q3 decision representation");
      return { fraction: result.fraction, end: result.end, entityNum: result.hit.kind === "actor" ? entityId(result.hit.actor) : result.hit.kind === "world" ? 1022 : 1023,
        solidity: result.allSolid ? "all-solid" : result.startSolid ? "start-solid" : "clear", contact: result.contact,
        contents: result.contents, surfaceFlags: result.surfaceFlags };
    } },
    modelIndex, chooseTeam: () => 0, activateBot: client => {
      if (source.kind === "q2") { const entity = source.game.entity(options.actor(client)); if (entity !== null) entity.serverFlags |= 16; }
    },
    exitLevel: () => { if (source.kind === "q2") source.players.endDeathmatchLevel(source.game); else source.game.requestIntermissionExit(simulation.timeSeconds, true); }, resetPodiumPlayers: () => {},
    clientUserinfoChanged: client => {
      const actor = options.actor(client);
      if (actor === null) return;
      if (source.kind === "q2") { const entity = source.game.entity(actor); if (entity !== null) source.players.userinfoChanged(entity, source.game, userinfos.get(client) ?? ""); }
      else {
        const fields = (userinfos.get(client) ?? "").split("\\"), info = new Map<string, string>();
        for (let index = 1; index + 1 < fields.length; index += 2) { const key = fields[index], value = fields[index + 1]; if (key !== undefined && value !== undefined) info.set(key, value); }
        source.composition.clients.update(actor, info);
      }
    },
    clientConnect: (client, firstTime, bot) => {
      if (source.kind === "q2") {
        const result = source.product.rerelease === null ? source.players.connect(source.game, userinfos.get(client) ?? "") : source.product.rerelease.players.connect(source.game, userinfos.get(client) ?? "", bot);
        if (!result.allowed) return result.reason;
        userinfos.set(client, result.userinfo);
      }
      game.clientUserinfoChanged(client);
      return options.connect(client, !firstTime) ? null : "Bot setup failed";
    },
    clientBegin: client => { begun.add(client); options.begin(client); },
  };
  refresh();
  return { game, knowledge, entityId, actorForId, refresh };
}
