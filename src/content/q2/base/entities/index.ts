import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import { Q2BaseMoverEntities } from "./movers.ts";
import type { Q2BaseMoversCheckpoint } from "./movers.ts";
import { Q2BaseScenery } from "./scenery.ts";
import type { Q2BaseSceneryCheckpoint } from "./scenery.ts";
import { Q2BaseTargets } from "./targets.ts";
import { Q2EnvironmentalTriggers } from "./triggers.ts";
import { Q2TurretEntities } from "./turrets.ts";
import type { Q2TurretsCheckpoint } from "./turrets.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

export type { Q2BaseEntityHooks } from "./types.ts";
export type { Q2PlatformState } from "./movers.ts";
export { q2ClockText } from "./scenery.ts";
export { snapQ2TurretEighth } from "./turrets.ts";

export interface Q2BaseEntitiesCheckpoint {
  readonly version: 1;
  readonly movers: Q2BaseMoversCheckpoint;
  readonly scenery: Q2BaseSceneryCheckpoint;
  readonly turrets: Q2TurretsCheckpoint;
  readonly windTimes: ReturnType<Q2EnvironmentalTriggers["capture"]>;
}

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
  private readonly targets: Q2BaseTargets;
  private readonly triggers: Q2EnvironmentalTriggers;
  private readonly scenery: Q2BaseScenery;
  constructor(hooks: Q2BaseEntityHooks) {
    this.movers = new Q2BaseMoverEntities(hooks); this.turrets = new Q2TurretEntities(hooks);
    this.targets = new Q2BaseTargets(hooks); this.triggers = new Q2EnvironmentalTriggers(hooks);
    this.scenery = new Q2BaseScenery(hooks);
  }

  get callbacks(): Q2CallbackDefinitions {
    const sources = [this.movers.callbacks, this.targets.callbacks, this.triggers.callbacks, this.scenery.callbacks, this.turrets.callbacks];
    return { think: Object.fromEntries(sources.flatMap(source => Object.entries(source.think ?? {}))),
      use: Object.fromEntries(sources.flatMap(source => Object.entries(source.use ?? {}))),
      touch: Object.fromEntries(sources.flatMap(source => Object.entries(source.touch ?? {}))),
      die: Object.fromEntries(sources.flatMap(source => Object.entries(source.die ?? {}))),
      blocked: Object.fromEntries(sources.flatMap(source => Object.entries(source.blocked ?? {}))) };
  }

  capture(game: Q2GameServices): Q2BaseEntitiesCheckpoint {
    return { version: 1, movers: this.movers.capture(game), scenery: this.scenery.capture(game), turrets: this.turrets.capture(game), windTimes: this.triggers.capture(game) };
  }

  /** Restore after shared tables, foundation entities and monster contexts; no source callback runs. */
  restore(game: Q2GameServices, checkpoint: Q2BaseEntitiesCheckpoint): undefined {
    this.movers.restore(game, checkpoint.movers); this.scenery.restore(game, checkpoint.scenery);
    this.triggers.restore(game, checkpoint.windTimes); return this.turrets.restore(game, checkpoint.turrets);
  }

  platformState(entity: Q2Entity) { return this.movers.platformState(entity); }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    return this.movers.spawn(entity, game) || this.triggers.spawn(entity, game) ||
      this.targets.spawn(entity, game) || this.scenery.spawn(entity, game) || this.turrets.spawn(entity, game);
  }
}

export function createQ2BaseEntityModule(hooks: Q2BaseEntityHooks): Q2BaseEntityModule { return new Q2BaseEntityModule(hooks); }
