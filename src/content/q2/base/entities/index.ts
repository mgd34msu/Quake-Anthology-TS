import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import { Q2BaseMoverEntities } from "./movers.ts";
import { spawnQ2BaseScenery } from "./scenery.ts";
import { spawnQ2BaseTarget } from "./targets.ts";
import { spawnQ2EnvironmentalTrigger } from "./triggers.ts";
import { Q2TurretEntities } from "./turrets.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

export type { Q2BaseEntityHooks } from "./types.ts";
export type { Q2PlatformState } from "./movers.ts";
export { q2ClockText } from "./scenery.ts";
export { snapQ2TurretEighth } from "./turrets.ts";

/** Source g_spawn.c classnames supplied here; existing foundation modules remain registered once. */
export const q2BaseEntityClassnames: readonly string[] = [
  "func_plat", "func_door_secret", "trigger_elevator", "func_conveyor", "func_killbox", "func_object",
  "trigger_push", "trigger_hurt", "trigger_gravity", "trigger_monsterjump",
  "target_temp_entity", "target_spawner", "target_blaster", "target_crosslevel_trigger", "target_crosslevel_target",
  "target_laser", "target_lightramp", "target_earthquake", "target_character", "target_string", "func_clock",
  "viewthing", "misc_blackhole", "misc_eastertank", "misc_easterchick", "misc_easterchick2", "monster_commander_body",
  "misc_bigviper", "misc_viper_bomb", "light_mine1", "light_mine2", "misc_gib_arm", "misc_gib_leg",
  "misc_teleporter", "misc_teleporter_dest", "turret_base", "turret_breach", "turret_driver",
];

export class Q2BaseEntityModule implements Q2SpawnModule {
  private readonly movers: Q2BaseMoverEntities;
  private readonly turrets: Q2TurretEntities;
  constructor(private readonly hooks: Q2BaseEntityHooks) {
    this.movers = new Q2BaseMoverEntities(hooks); this.turrets = new Q2TurretEntities(hooks);
  }

  platformState(entity: Q2Entity) { return this.movers.platformState(entity); }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    return this.movers.spawn(entity, game) || spawnQ2EnvironmentalTrigger(entity, game, this.hooks) ||
      spawnQ2BaseTarget(entity, game, this.hooks) || spawnQ2BaseScenery(entity, game, this.hooks) || this.turrets.spawn(entity, game);
  }
}

export function createQ2BaseEntityModule(hooks: Q2BaseEntityHooks): Q2BaseEntityModule { return new Q2BaseEntityModule(hooks); }
