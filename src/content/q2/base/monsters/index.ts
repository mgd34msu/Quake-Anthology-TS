import type { Q2SpawnModule } from "../../foundation/host.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { actorDefinition, createActorTargetModule } from "./actor.ts";
import { berserkDefinition } from "./berserk.ts";
import { boss2Definition } from "./boss2.ts";
import { q2Boss3StandModule } from "./boss3-stand.ts";
import { brainDefinition } from "./brain.ts";
import { chickDefinition } from "./chick.ts";
import { flipperDefinition } from "./flipper.ts";
import { floaterDefinition } from "./floater.ts";
import { flyerDefinition } from "./flyer.ts";
import { gladiatorDefinition } from "./gladiator.ts";
import { gunnerDefinition } from "./gunner.ts";
import { hoverDefinition } from "./hover.ts";
import { insaneDefinition } from "./insane.ts";
import { createJorgDefinition } from "./jorg.ts";
import { makronDefinition } from "./makron.ts";
import { createMedicDefinition } from "./medic.ts";
import { mutantDefinition } from "./mutant.ts";
import { parasiteDefinition } from "./parasite.ts";
import { supertankDefinition } from "./supertank.ts";
import { tankCommanderDefinition, tankDefinition } from "./tank.ts";

/** Original base gameplay definitions; rerelease providers explicitly replace changed species. */
export function q2ClassicBaseMonsterDefinitions(monsters: Q2Monsters): readonly Q2MonsterDefinition[] {
  return [berserkDefinition, brainDefinition, chickDefinition, flipperDefinition, floaterDefinition, flyerDefinition, gladiatorDefinition, gunnerDefinition, hoverDefinition,
    createMedicDefinition(monsters), mutantDefinition, parasiteDefinition, supertankDefinition, tankDefinition, tankCommanderDefinition, boss2Definition,
    createJorgDefinition(monsters), makronDefinition, actorDefinition, insaneDefinition];
}

/** Soldier and infantry remain registered by the permanent foundation provider. */
export function registerQ2ClassicBaseMonsters(monsters: Q2Monsters): Q2SpawnModule {
  for (const definition of q2ClassicBaseMonsterDefinitions(monsters)) monsters.register(definition);
  const targets = createActorTargetModule(monsters);
  return { spawn(entity, game) { return q2Boss3StandModule.spawn(entity, game) || targets.spawn(entity, game) || monsters.spawn(entity, game); } };
}

export { actorDefinition, createActorTargetModule, berserkDefinition, boss2Definition, q2Boss3StandModule, brainDefinition, chickDefinition, flipperDefinition, floaterDefinition,
  flyerDefinition, gladiatorDefinition, gunnerDefinition, hoverDefinition, insaneDefinition, createJorgDefinition, makronDefinition, createMedicDefinition, mutantDefinition,
  parasiteDefinition, supertankDefinition, tankDefinition, tankCommanderDefinition };
