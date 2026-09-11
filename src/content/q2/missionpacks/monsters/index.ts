import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { withBossExplosionCallbacks } from "../../base/monsters/boss-common.ts";
import { boss5Definition } from "./boss5.ts";
import { createChickHeatDefinition } from "./chick-heat.ts";
import { createFixbotDefinition } from "./fixbot.ts";
import { createGekkDefinition } from "./gekk.ts";
import { createGladbDefinition } from "./gladb.ts";
import { createSoldierHeavyDefinitions } from "./soldierh.ts";
import { createStalkerDefinition } from "./stalker.ts";
import { createRogueFlyerDefinitions } from "./flyer.ts";
import { createRogueHoverDefinitions } from "./hover.ts";
import { createRogueTurretDefinition } from "./turret.ts";
import { createCarrierDefinition } from "./carrier.ts";
import { createRogueMedicDefinitions } from "./medic.ts";
import { createRogueCombatHooks, rogueTargetAnger } from "./combat.ts";
import { monsterDabeamCallbacks } from "./dabeam.ts";
import { createXatrixBaseVariants } from "./xatrix-variants.ts";
import { Q2RogueHints } from "./hints.ts";
import { createRogueBaseVariants } from "./rogue-variants.ts";
import { createRogueArsenalMonsters } from "./rogue-arsenal.ts";
import { createRogueJumpingMonsters } from "./rogue-jumpers.ts";
import { Q2MissionPackMonsterState } from "./state.ts";
import type { Q2MissionPackMonstersCheckpoint } from "./state.ts";
import type { Q2MissionPackMonsterServices, Q2MissionPackMonsterWeapons, Q2MonsterMissionPack } from "./types.ts";

export function q2XatrixMonsterDefinitions(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons): readonly Q2MonsterDefinition[] {
  return [createGekkDefinition(monsters), createFixbotDefinition(monsters), createGladbDefinition(weapons), withBossExplosionCallbacks(boss5Definition, monsters), createChickHeatDefinition(weapons), ...createSoldierHeavyDefinitions(weapons), ...createXatrixBaseVariants(monsters)];
}

export function q2RogueMonsterDefinitions(monsters: Q2Monsters, weapons: Q2MissionPackMonsterWeapons, services: Q2MissionPackMonsterServices, state: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  return [createStalkerDefinition(monsters, weapons, state, () => services.gravity()), ...createRogueFlyerDefinitions(monsters, state),
    ...createRogueHoverDefinitions(weapons, state), createRogueTurretDefinition(monsters, services.movers, state), createCarrierDefinition(monsters, services), ...createRogueMedicDefinitions(monsters, weapons, state), ...createRogueBaseVariants(monsters, state), ...createRogueArsenalMonsters(monsters, state), ...createRogueJumpingMonsters(monsters, state)];
}

export const q2OriginalMissionPackFallbacks: ReadonlySet<string> = new Set(["monster_gekk", "monster_fixbot", "monster_gladb", "monster_boss5", "monster_chick_heat", "monster_soldier_ripper", "monster_soldier_hypergun", "monster_soldier_lasergun", "monster_stalker", "monster_kamikaze", "monster_daedalus", "monster_turret", "monster_carrier", "monster_medic_commander", "monster_widow", "monster_widow2"]);

export class Q2MissionPackMonsters implements Q2SpawnModule {
  readonly source = new Q2MissionPackMonsterState();
  readonly originalSourceFallbacks: readonly string[];
  readonly hints: Q2RogueHints | null;
  constructor(private readonly monsters: Q2Monsters, pack: Q2MonsterMissionPack, weapons: Q2MissionPackMonsterWeapons, services: Q2MissionPackMonsterServices, edition: Q2GameServices["options"]["edition"] = "classic") {
    this.hints = pack === "rogue" ? new Q2RogueHints(monsters) : null;
    if (this.hints !== null) monsters.setHintPaths(this.hints.hooks);
    const definitions = pack === "xatrix" ? q2XatrixMonsterDefinitions(monsters, weapons) : q2RogueMonsterDefinitions(monsters, weapons, services, this.source);
    this.originalSourceFallbacks = definitions.filter(definition => q2OriginalMissionPackFallbacks.has(definition.classname)).map(definition => definition.classname);
    for (const definition of definitions) {
      if (edition === "classic") monsters.register(definition, "classic");
      if (q2OriginalMissionPackFallbacks.has(definition.classname)) monsters.register(definition);
    }
    monsters.setSourceCombatRules(pack === "rogue" ? "rogue" : "base", pack === "rogue" ? createRogueCombatHooks(monsters, this.source, services) : null);
  }
  get callbacks() { const callbacks = this.monsters.callbacks; return { ...callbacks, think: { ...callbacks.think, ...monsterDabeamCallbacks.think }, touch: { ...callbacks.touch, ...this.hints?.callbacks.touch } }; }
  spawn(entity: Q2Entity, game: Q2GameServices): boolean { return this.hints?.spawn(entity, game) === true || this.monsters.spawn(entity, game); }
  capture(game: Q2GameServices): Q2MissionPackMonstersCheckpoint { return { ...this.source.capture(game), hints: this.hints?.capture(game) ?? null }; }
  restore(game: Q2GameServices, checkpoint: Q2MissionPackMonstersCheckpoint): undefined {
    this.source.restore(game, checkpoint);
    if (checkpoint.hints !== null) {
      if (this.hints === null) throw new Error("Rogue hint paths restored without their selected source module");
      this.hints.restore(game, checkpoint.hints);
    }
    return undefined;
  }
  targetAnger(entity: Q2Entity, target: Q2Entity, game: Q2GameServices): undefined { return rogueTargetAnger(this.monsters, this.source, entity, target, game); }
}

export function registerQ2MissionPackMonsters(monsters: Q2Monsters, pack: Q2MonsterMissionPack, weapons: Q2MissionPackMonsterWeapons, services: Q2MissionPackMonsterServices, edition: Q2GameServices["options"]["edition"] = "classic"): Q2MissionPackMonsters {
  return new Q2MissionPackMonsters(monsters, pack, weapons, services, edition);
}

export { boss5Definition, createChickHeatDefinition, createFixbotDefinition, createGekkDefinition, createGladbDefinition, createSoldierHeavyDefinitions,
  createStalkerDefinition, createRogueFlyerDefinitions, createRogueHoverDefinitions, createRogueTurretDefinition, createCarrierDefinition, createRogueMedicDefinitions, Q2MissionPackMonsterState };
export type { Q2MissionPackMonsterServices, Q2MissionPackMonsterWeapons, Q2MonsterMissionPack, Q2MissionPackMonstersCheckpoint };
