import type { Q3SourceRuntime } from "../../../app/bootstrap/simulation/q3/runtime.ts";
import { ServerEntityFlags } from "../../../content/q3/base/shared/entity-shared.ts";
import { ConnectionState } from "../../../content/q3/base/game/state.ts";
import { pickTeam } from "../../../content/q3/team-arena/session.ts";
import { createBotArsenalKnowledge } from "./arsenal-knowledge.ts";
import { Weapon } from "../../../content/q3/base/shared/definitions.ts";
import { updateQ3BotInventory } from "./ai-combat.ts";
import type { SourceBotGame } from "./game-host.ts";

/** Reads detach source state; every mutation is an explicit call to its existing owner. */
export function q3BotGame(source: Q3SourceRuntime, insertConsoleCommand: (text: string) => void): SourceBotGame {
  return {
    pickups: null,
    options: { product: source.options.product, cvars: source.host.cvars, configstrings: source.host.configstrings,
      engine: { ...source.host.engine, insertConsoleCommand } },
    get gameType() { return source.gameType; },
    get maxClients() { return source.pool.maxClients; },
    get entityCount() { return source.pool.numEntities; },
    world: source.world, random: source.random, clock: source.level, memory: source.memory,
    knowledge: createBotArsenalKnowledge({ updateInventory: updateQ3BotInventory,
      candidates: (library, handle) => Array.from({ length: source.options.product === "missionpack" ? 14 : 11 }, (_, weapon) => weapon).flatMap(weapon => {
        const info = library.weapons.getWeaponInfo(handle, weapon); return info === undefined || !info.valid ? [] : [{ info, maximumRange: weapon === Weapon.WP_GAUNTLET ? 60 : null,
          melee: weapon === Weapon.WP_GAUNTLET, personalityRole: weapon, supply: null }];
      }) }),
    entity: number => {
      const entity = source.pool.at(number), client = entity.client;
      return { generation: entity.inuse ? entity.actor.id.generation : 0, present: entity.inuse, linked: source.world.linkState(number)?.linked === true,
        hidden: (entity.r.svFlags & ServerEntityFlags.NOCLIENT) !== 0, bot: (entity.r.svFlags & ServerEntityFlags.BOT) !== 0,
        state: entity.s.copy(), origin: { ...entity.r.currentOrigin }, angles: { ...entity.r.currentAngles },
        bounds: { min: { ...entity.r.mins }, max: { ...entity.r.maxs } }, contents: entity.r.contents,
        inlineModel: entity.r.model.kind === "inline" ? entity.r.model.index : null,
        classname: entity.classname, eventTime: entity.eventTime, activatorFrame: entity.activator?.s.frame ?? null,
        proximityTrigger: source.missiles.isProximityTrigger(entity),
        player: client === null ? null : { state: client.ps.copy(), connected: client.pers.connected === ConnectionState.CONNECTED,
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
