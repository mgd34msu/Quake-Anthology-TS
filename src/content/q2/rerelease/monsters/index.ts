import type { Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { Q2MissionPackMonsterWeapons } from "../../missionpacks/monsters/types.ts";
import { arachnidDefinition } from "./arachnid.ts";
import { createRereleaseBerserkDefinition } from "./berserk.ts";
import { createGuardianDefinition } from "./guardian.ts";
import { shamblerDefinition } from "./shambler.ts";
import { createGunCommanderDefinition } from "./guncmdr.ts";
import { createRereleaseTankDefinitions, rereleaseTankStandModule } from "./tank.ts";
import { createRereleaseGladiatorDefinitions } from "./gladiator.ts";
import { createRereleaseSupertankDefinitions } from "./supertank.ts";
import { rereleaseGunnerDefinition } from "./gunner.ts";
import { rereleaseFlipperDefinition } from "./base-variants/flipper.ts";
import { rereleaseFloaterDefinition } from "./base-variants/floater.ts";
import { createRereleaseHoverDefinition } from "./base-variants/hover.ts";
import { createRereleaseFlyerDefinition } from "./base-variants/flyer.ts";
import { createRereleaseChickDefinitions } from "./base-variants/chick.ts";
import { createRereleaseMutantDefinition } from "./base-variants/mutant.ts";
import { rereleaseInsaneDefinition } from "./base-variants/insane.ts";
import { createRereleaseActorModule } from "./base-variants/actor.ts";
import { rereleaseBoss2Definition } from "./base-variants/boss2.ts";
import { createRereleaseJorgDefinition } from "./base-variants/jorg.ts";
import { rereleaseMakronDefinition } from "./base-variants/makron.ts";
import { createRereleaseBrainDefinition } from "./base-variants/brain.ts";

export interface Q2RereleaseMonsterOptions {
  readonly isN64: boolean;
  readonly expansion: "base" | "xatrix" | "rogue" | "mg1";
  readonly weapons: Q2MissionPackMonsterWeapons;
  readonly transferHealthbarTarget?: (oldActor: ActorId, newActor: ActorId, game: Q2GameServices) => undefined;
}

export function registerQ2RereleaseMonsters(monsters: Q2Monsters, options: Q2RereleaseMonsterOptions): Q2SpawnModule {
  monsters.register(arachnidDefinition, "rerelease");
  monsters.register(createRereleaseBerserkDefinition(monsters), "rerelease");
  monsters.register(createGuardianDefinition(monsters), "rerelease");
  monsters.register(shamblerDefinition, "rerelease");
  monsters.register(createGunCommanderDefinition(options.weapons), "rerelease");
  monsters.register(rereleaseGunnerDefinition, "rerelease");
  monsters.register(rereleaseFlipperDefinition, "rerelease");
  monsters.register(rereleaseFloaterDefinition, "rerelease");
  monsters.register(createRereleaseHoverDefinition(monsters), "rerelease");
  monsters.register(createRereleaseFlyerDefinition(monsters), "rerelease");
  for (const definition of createRereleaseChickDefinitions(options.weapons)) monsters.register(definition, "rerelease");
  monsters.register(createRereleaseMutantDefinition(monsters), "rerelease");
  monsters.register(rereleaseInsaneDefinition, "rerelease");
  monsters.register(rereleaseBoss2Definition, "rerelease");
  monsters.register(rereleaseMakronDefinition, "rerelease");
  monsters.register(createRereleaseJorgDefinition(monsters, options.transferHealthbarTarget), "rerelease");
  monsters.register(createRereleaseBrainDefinition(monsters), "rerelease");
  const actor = createRereleaseActorModule(monsters);
  monsters.register(actor.definition, "rerelease");
  for (const definition of createRereleaseTankDefinitions(options.weapons)) monsters.register(definition, "rerelease");
  for (const definition of createRereleaseGladiatorDefinitions(options.weapons)) monsters.register(definition, "rerelease");
  for (const definition of createRereleaseSupertankDefinitions(options.weapons, options.isN64)) monsters.register(definition, "rerelease");
  return {
    callbacks: { ...monsters.callbacks, think: { ...monsters.callbacks.think, ...rereleaseTankStandModule.callbacks?.think }, use: { ...monsters.callbacks.use, ...rereleaseTankStandModule.callbacks?.use }, touch: { ...monsters.callbacks.touch, ...actor.targets.callbacks?.touch } },
    spawn(entity, game) { return rereleaseTankStandModule.spawn(entity, game) || actor.targets.spawn(entity, game) || monsters.spawn(entity, game); },
  };
}

export { arachnidDefinition, createRereleaseBerserkDefinition, createGuardianDefinition, shamblerDefinition, createGunCommanderDefinition, createRereleaseTankDefinitions, rereleaseTankStandModule };
