import type { Q1Base } from "../../base/provider.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import type { Q1MissionPack } from "../types.ts";
import type { MissionMonsterHooks } from "./types.ts";
import { Q1MissionPackMonsters } from "./runtime.ts";
import { armagonDefinition } from "./armagon.ts";
import { registerHipnoticPaths } from "./paths.ts";
import { dragonDefinition, registerDragonCorners } from "./dragon.ts";
import { hipnoticArmyDefinition, hipnoticDogDefinition } from "./charmed-base.ts";
import { gremlinDefinition } from "./gremlin.ts";
import { decoyDefinition } from "./decoy.ts";
import { registerDormantSpikemine } from "./spikemine.ts";
import { overlordDefinition, registerOverlordDestination } from "./overlord.ts";
import { morphDefinition } from "./morph.ts";
import { scourgeDefinition } from "./scourge.ts";
import { lavamanDefinition } from "./lavaman.ts";
import { mummyDefinition } from "./mummy.ts";
import { eelDefinition } from "./eel.ts";
import { swordDefinition } from "./sword.ts";
import { wrathDefinition } from "./wrath.ts";

export function registerMissionPackMonsters(game: Q1EntityServices, base: Q1Base, pack: Q1MissionPack, hooks: MissionMonsterHooks = {}): Q1MissionPackMonsters {
  const runtime = new Q1MissionPackMonsters(game, base, pack, hooks);
  if (pack === "hipnotic") { runtime.register(scourgeDefinition(runtime)); runtime.register(gremlinDefinition(runtime)); runtime.register(armagonDefinition(runtime)); runtime.register(decoyDefinition); runtime.register(hipnoticArmyDefinition); runtime.register(hipnoticDogDefinition(runtime)); registerDormantSpikemine(game); registerHipnoticPaths(runtime); }
  if (pack === "rogue") { registerOverlordDestination(game); registerDragonCorners(game); for (const definition of [eelDefinition, swordDefinition, wrathDefinition, mummyDefinition, lavamanDefinition, overlordDefinition, morphDefinition(runtime), dragonDefinition(runtime)]) runtime.register(definition); }
  return runtime;
}
export { Q1MissionPackMonsters, MissionMonster } from "./runtime.ts";
export type { MissionMonsterHooks, MissionAction, PackMonsterDefinition, PackMonsterFactory } from "./types.ts";

export { becomeDecoy } from "./decoy.ts";

export { launchDragonFireball } from "./dragon.ts";
