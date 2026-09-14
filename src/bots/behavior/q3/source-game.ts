import type { BotArsenalBinding } from "../../../app/bootstrap/simulation/bot-arsenal.ts";
import type { ActorId } from "../../../contracts/identity.ts";
import { BotInventory } from "./ai-definitions.ts";
import type { Q3SourceRuntime } from "../../../app/bootstrap/simulation/q3/runtime.ts";
import { ServerEntityFlags } from "../../../content/q3/base/shared/entity-shared.ts";
import { ConnectionState } from "../../../content/q3/base/game/state.ts";
import { pickTeam } from "../../../content/q3/team-arena/session.ts";
import { createBotArsenalKnowledge } from "./arsenal-knowledge.ts";
import { Weapon, ItemType, statSchema, weaponCount } from "../../../content/q3/base/shared/definitions.ts";
import { updateQ3BotInventory, updateQ3BotItemInventory } from "./ai-combat.ts";
import type { SourceBotGame, BotObservedPickup, BotPickupObservations } from "./game-host.ts";

/** Reads detach source state; every mutation is an explicit call to its existing owner. */
export function q3BotGame(source: Q3SourceRuntime, insertConsoleCommand: (text: string) => void, arsenal?: BotArsenalBinding): SourceBotGame {
  const inspect = (client: number, actor: ActorId): BotObservedPickup | null => {
    const entity = source.records.nativeByActor(actor), recipient = source.pool.at(client);
    if (entity === null || entity.classname === null || !entity.inuse || !recipient.inuse || recipient.client === null) return null;
    const supply = source.observeSupply(actor, recipient.actor.id);
    return supply === null ? null : { ...supply, entity: entity.s.number, name: entity.classname,
      origin: { ...entity.r.currentOrigin }, bounds: { min: { ...entity.r.mins }, max: { ...entity.r.maxs } } };
  };
  const pickups: BotPickupObservations | null = arsenal === undefined ? null : {
    ownsItemGoal: (_client, number) => {
      const entity = source.pool.at(number);
      return entity.inuse && (entity.item?.type === ItemType.IT_WEAPON || entity.item?.type === ItemType.IT_AMMO);
    },
    inspect,
    candidates: client => {
      const result: BotObservedPickup[] = [];
      for (let number = 0; number < source.pool.numEntities; number++) {
        const entity = source.pool.at(number);
        if (!entity.inuse || entity.item === null) continue;
        const pickup = inspect(client, entity.actor.id);
        if (pickup !== null) result.push(pickup);
      }
      return result;
    },
  };
  return {
    pickups,
    options: { product: source.options.product, cvars: source.host.cvars, configstrings: source.host.configstrings,
      engine: { ...source.host.engine, insertConsoleCommand } },
    get gameType() { return source.gameType; },
    get maxClients() { return source.pool.maxClients; },
    get entityCount() { return source.pool.numEntities; },
    world: source.world, random: source.random, clock: source.level, memory: source.memory,
    knowledge: arsenal === undefined ? createBotArsenalKnowledge({ updateInventory: updateQ3BotInventory,
      candidates: (library, handle) => Array.from({ length: weaponCount(source.options.product) - 1 }, (_, index) => index + 1).flatMap(weapon => {
        const info = library.weapons.getWeaponInfo(handle, weapon); return info === undefined || !info.valid ? [] : [{ info, maximumRange: weapon === Weapon.WP_GAUNTLET ? 60 : null,
          melee: weapon === Weapon.WP_GAUNTLET, personalityRole: weapon, supply: null }];
      }) }) : { ...arsenal.knowledge, updateInventory: state => {
        arsenal.knowledge.updateInventory(state);
        state.inventory[BotInventory.ARMOR] = state.curPs.stats.get(statSchema(state.product).armor);
        updateQ3BotItemInventory(state);
      } },
    entity: number => {
      const entity = source.pool.at(number), client = entity.client;
      const observedState = entity.s.copy(), playerState = client?.ps.copy() ?? null;
      if (arsenal !== undefined && playerState !== null) {
        playerState.weapon = arsenal.sourceWeapon(number); playerState.weaponState = arsenal.sourceWeaponState(number);
        observedState.weapon = playerState.weapon;
      }
      return { generation: entity.inuse ? entity.actor.id.generation : 0, present: entity.inuse, linked: source.world.linkState(number)?.linked === true,
        hidden: (entity.r.svFlags & ServerEntityFlags.NOCLIENT) !== 0, bot: (entity.r.svFlags & ServerEntityFlags.BOT) !== 0,
        state: observedState, origin: { ...entity.r.currentOrigin }, angles: { ...entity.r.currentAngles },
        bounds: { min: { ...entity.r.mins }, max: { ...entity.r.maxs } }, contents: entity.r.contents,
        inlineModel: entity.r.model.kind === "inline" ? entity.r.model.index : null,
        classname: entity.classname, eventTime: entity.eventTime, activatorFrame: entity.activator?.s.frame ?? null,
        proximityTrigger: source.missiles.isProximityTrigger(entity),
        player: client === null || playerState === null ? null : { state: playerState, connected: client.pers.connected === ConnectionState.CONNECTED,
          team: client.sess.sessionTeam, name: client.pers.netname, lastHurtClient: client.lastHurtClient, lastHurtMod: client.lastHurtMod } };
    },
    modelIndex: name => source.config.modelIndex(name),
    chooseTeam: client => pickTeam({ clients: source.pool.clients, maxClients: source.pool.maxClients, teamScores: source.level.teamScores }, client),
    activateBot: client => { source.pool.at(client).r.svFlags |= ServerEntityFlags.BOT; source.pool.activateClient(client); },
    exitLevel: () => source.match.exitLevel(), resetPodiumPlayers: () => source.arenas.resetPodiumPlayers(),
    clientUserinfoChanged: client => source.admission.userinfoChanged(client),
    clientConnect: (client, firstTime, isBot) => source.admission.connect(client, firstTime, isBot),
    clientBegin: client => source.admission.begin(client),
  };
}
