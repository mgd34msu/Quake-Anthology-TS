import type { Product } from "./shared/definitions.ts";
import { Team } from "./shared/definitions.ts";
import { GameFlags } from "./game/state.ts";
import type { EntityPool } from "./game/entities.ts";
import type { SpawnHandler } from "./game/spawn.ts";
import { miscSpawnHandlers } from "./game/misc-spawn.ts";
import type { MiscSpawnHost } from "./game/misc-spawn.ts";
import type { MoverSpawnRuntime } from "./game/mover-spawn.ts";
import { triggerSpawnHandlers } from "./game/triggers.ts";
import type { TriggerHost } from "./game/triggers.ts";
import { targetSpawnHandlers } from "./game/targets.ts";
import type { TargetRuntime } from "./game/targets.ts";
import { spawnPlayerStart, spawnDeathmatchPoint } from "../team-arena/client-spawn.ts";
import { spawnTeamPoint } from "../team-arena/team.ts";
import type { TeamRuntime } from "../team-arena/team.ts";

export interface Q3SpawnHandlersHost {
  readonly product: Product;
  readonly misc: MiscSpawnHost;
  readonly movers: MoverSpawnRuntime;
  readonly triggers: TriggerHost;
  readonly targets: TargetRuntime;
  readonly team: TeamRuntime;
}

/** All source classname routes, including the two intentionally empty native spawn functions. */
export function createQ3SpawnHandlers(host: Q3SpawnHandlersHost): ReadonlyMap<string, SpawnHandler> {
  const handlers = new Map<string, SpawnHandler>([
    ["info_player_start", spawnPlayerStart], ["info_player_deathmatch", spawnDeathmatchPoint],
    ["info_player_intermission", () => {}], ["item_botroam", () => {}],
    ["team_CTF_redplayer", spawnTeamPoint], ["team_CTF_blueplayer", spawnTeamPoint],
    ["team_CTF_redspawn", spawnTeamPoint], ["team_CTF_bluespawn", spawnTeamPoint],
    ...miscSpawnHandlers(host.misc), ...host.movers.handlers(), ...triggerSpawnHandlers(host.triggers), ...targetSpawnHandlers(host.targets),
  ]);
  const remove = handlers.get("info_null");
  if (remove === undefined) throw new Error("Source info_null handler is unavailable");
  handlers.set("func_group", remove);
  if (host.product === "missionpack") {
    handlers.set("team_redobelisk", entity => host.team.spawnTeamObelisk(entity, Team.TEAM_RED));
    handlers.set("team_blueobelisk", entity => host.team.spawnTeamObelisk(entity, Team.TEAM_BLUE));
    handlers.set("team_neutralobelisk", entity => host.team.spawnNeutralObelisk(entity));
  }
  return handlers;
}

/** G_FindTeams preserves prepended teammate order and transfers each slave's targetname to its master. */
export function findQ3EntityTeams(pool: EntityPool): { readonly teams: number; readonly entities: number } {
  let teams = 0, entities = 0;
  for (let index = 1; index < pool.numEntities; index++) {
    const master = pool.at(index);
    if (!master.inuse || master.team === null || (master.flags & GameFlags.TEAMSLAVE) !== 0) continue;
    master.teammaster = master; teams++; entities++;
    for (let next = index + 1; next < pool.numEntities; next++) {
      const entity = pool.at(next);
      if (!entity.inuse || entity.team === null || (entity.flags & GameFlags.TEAMSLAVE) !== 0 || entity.team !== master.team) continue;
      entities++; entity.teamchain = master.teamchain; master.teamchain = entity;
      entity.teammaster = master; entity.flags |= GameFlags.TEAMSLAVE;
      if (entity.targetname !== null) { master.targetname = entity.targetname; entity.targetname = null; }
    }
  }
  return { teams, entities };
}
