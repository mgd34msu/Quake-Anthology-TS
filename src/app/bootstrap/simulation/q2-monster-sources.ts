import type { ActorId } from "../../../contracts/identity.ts";
import type { Q2EntityServices } from "../../../content/q2/foundation/entity-services.ts";
import type { Q2Edition, Q2SpawnModule } from "../../../content/q2/foundation/host.ts";
import { Q2Monsters } from "../../../content/q2/foundation/monsters/index.ts";
import { Q2Ballistics } from "../../../content/q2/foundation/weapons/ballistics.ts";
import type { Q2WeaponHooks } from "../../../content/q2/foundation/weapons/types.ts";
import { Q2MoverModule } from "../../../content/q2/foundation/movers.ts";
import { registerQ2ClassicBaseMonsters } from "../../../content/q2/base/monsters/index.ts";
import { Q2MissionPackProjectiles } from "../../../content/q2/missionpacks/projectiles/index.ts";
import type { Q2MissionPackPlayerEffect } from "../../../content/q2/missionpacks/types.ts";
import { registerQ2MissionPackMonsters } from "../../../content/q2/missionpacks/monsters/index.ts";
import type { Q2MissionPackMonsters, Q2MissionPackMonsterServices } from "../../../content/q2/missionpacks/monsters/index.ts";
import { registerQ2RereleaseMonsters } from "../../../content/q2/rerelease/monsters/index.ts";

export interface SelectedQ2MonsterModules {
  readonly game: Q2EntityServices;
  readonly monsters: Q2Monsters;
  readonly ballistics: Q2Ballistics;
  readonly movers: Q2MoverModule;
  readonly packs: readonly { readonly pack: "xatrix" | "rogue"; readonly monsters: Q2MissionPackMonsters }[];
}
export function createSelectedQ2MonsterModules(options: {
  readonly edition: Q2Edition;
  readonly program: "baseq2" | "xatrix" | "rogue" | "mg2";
  readonly weapons: Omit<Q2WeaponHooks, "noise">;
  readonly behavior: ConstructorParameters<typeof Q2Monsters>[1];
  createGame(monsters: Q2Monsters, modules: readonly Q2SpawnModule[]): Q2EntityServices;
  gravity(): number;
  powerups(actor: ActorId): ReturnType<Q2MissionPackMonsterServices["powerups"]>;
  playerEffect(event: Q2MissionPackPlayerEffect): undefined;
}): SelectedQ2MonsterModules {
  let monsters: Q2Monsters;
  const ballistics = new Q2Ballistics({ ...options.weapons, noise: (actor, origin, secondary) => monsters.reportNoise(actor, origin, secondary) });
  monsters = new Q2Monsters(ballistics, options.behavior);
  const base = registerQ2ClassicBaseMonsters(monsters);
  const movers = new Q2MoverModule({ pathCorner: (entity, game, actor) => monsters.touchPathCorner(entity, game, actor),
    combatPoint: (entity, game, actor) => monsters.touchCombatPoint(entity, game, actor) });
  const projectiles = new Q2MissionPackProjectiles({ base: ballistics, monster: actor => monsters.context(actor), gravity: options.gravity, playerEffect: options.playerEffect });
  let game: Q2EntityServices;
  const services: Q2MissionPackMonsterServices = { movers, gravity: options.gravity, powerups: options.powerups,
    badArea: actor => projectiles.badArea(actor, game), badAreaEntity: (actor, origin) => projectiles.badAreaEntity(actor, game, origin),
    markTeslaArea: (self, tesla) => projectiles.markTeslaArea(self, game, tesla) };
  const selectedPacks: readonly ("xatrix" | "rogue")[] = options.edition === "rerelease" ? ["xatrix", "rogue"] : options.program === "xatrix" ? ["xatrix"] : options.program === "rogue" ? ["rogue"] : [];
  const packs = selectedPacks.map(pack => ({ pack, monsters: registerQ2MissionPackMonsters(monsters, pack, projectiles, services, options.edition) }));
  const modules: Q2SpawnModule[] = [base, ...packs.map(pack => pack.monsters)];
  if (options.edition === "rerelease") {
    const source = packs.find(pack => pack.pack === "rogue")?.monsters.source;
    if (source === undefined) throw new Error("Rerelease monster registration requires its Rogue state");
    modules.push(registerQ2RereleaseMonsters(monsters, { source, weapons: projectiles, isN64: false,
      expansion: options.program === "baseq2" ? "base" : options.program === "mg2" ? "mg1" : options.program }));
  }
  game = options.createGame(monsters, modules);
  ballistics.registerCallbacks(game); game.sourceCallbacks.register(projectiles.callbacks); game.sourceCallbacks.register(movers.callbacks);
  return { game, monsters, ballistics, movers, packs };
}
