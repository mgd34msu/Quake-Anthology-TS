import type { ActorId } from "../../../contracts/identity.ts";
import type { Q2Foundation } from "../../../content/q2/foundation/runtime.ts";
import type { Q2Edition, Q2SpawnModule } from "../../../content/q2/foundation/host.ts";
import { Q2Monsters } from "../../../content/q2/foundation/monsters/index.ts";
import { Q2Ballistics } from "../../../content/q2/foundation/weapons/ballistics.ts";
import type { Q2WeaponHooks } from "../../../content/q2/foundation/weapons/types.ts";
import { Q2MoverModule } from "../../../content/q2/foundation/movers.ts";
import { createQ2TargetModule } from "../../../content/q2/foundation/targets.ts";
import { createQ2SceneryModule } from "../../../content/q2/foundation/scenery.ts";
import { createQ2ItemModule, type Q2ItemHooks, type Q2ItemModule } from "../../../content/q2/foundation/items.ts";
import { createQ2BaseEntityModule, type Q2BaseEntityModule } from "../../../content/q2/base/entities/index.ts";
import { registerQ2ClassicBaseMonsters } from "../../../content/q2/base/monsters/index.ts";
import { Q2MissionPackProjectiles } from "../../../content/q2/missionpacks/projectiles/index.ts";
import { Q2MissionPackEntities } from "../../../content/q2/missionpacks/index.ts";
import type { Q2MissionPackPlayerEffect } from "../../../content/q2/missionpacks/types.ts";
import { registerQ2MissionPackMonsters } from "../../../content/q2/missionpacks/monsters/index.ts";
import type { Q2MissionPackMonsters, Q2MissionPackMonsterServices } from "../../../content/q2/missionpacks/monsters/index.ts";
import { registerQ2RereleaseMonsters } from "../../../content/q2/rerelease/monsters/index.ts";

export interface ForeignQ2WorldModules {
  readonly game: Q2Foundation;
  readonly monsters: Q2Monsters;
  readonly ballistics: Q2Ballistics;
  readonly movers: Q2MoverModule;
  readonly items: Q2ItemModule;
  readonly baseEntities: Q2BaseEntityModule;
  readonly packs: readonly { readonly pack: "xatrix" | "rogue"; readonly monsters: Q2MissionPackMonsters; readonly entities: Q2MissionPackEntities }[];
}

/** A full Q2 world (entities, targets, movers, scenery, items, monsters)
 * hosted as an adjunct for a foreign-authored map whose primary source is
 * another family's program. Mirrors createSelectedQ2MonsterModules'
 * wiring, extended with the world spawn modules the primary Q2 product
 * registers; player/match ownership stays with the primary source, so
 * player-facing hooks route to shared runtime services. */
export function createForeignQ2WorldModules(options: {
  readonly edition: Q2Edition;
  readonly program: "baseq2" | "xatrix" | "rogue" | "mg2";
  readonly weapons: Omit<Q2WeaponHooks, "noise">;
  readonly behavior: ConstructorParameters<typeof Q2Monsters>[1];
  createGame(monsters: Q2Monsters, modules: readonly Q2SpawnModule[]): Q2Foundation;
  gravity(): number;
  powerups(actor: ActorId): ReturnType<Q2MissionPackMonsterServices["powerups"]>;
  playerEffect(event: Q2MissionPackPlayerEffect): undefined;
  teleportPlayer(actor: ActorId, origin: { readonly x: number; readonly y: number; readonly z: number }, angles: { readonly x: number; readonly y: number; readonly z: number }): undefined;
  playerPush(actor: ActorId, velocity: { readonly x: number; readonly y: number; readonly z: number }): undefined;
  setActorGravity(actor: ActorId, gravity: number): undefined;
  readonly itemHooks: Q2ItemHooks;
}): ForeignQ2WorldModules {
  let monsters: Q2Monsters;
  const ballistics = new Q2Ballistics({ ...options.weapons, noise: (actor, origin, secondary) => monsters.reportNoise(actor, origin, secondary) });
  monsters = new Q2Monsters(ballistics, options.behavior);
  const base = registerQ2ClassicBaseMonsters(monsters);
  const movers = new Q2MoverModule({ pathCorner: (entity, game, actor) => monsters.touchPathCorner(entity, game, actor),
    combatPoint: (entity, game, actor) => monsters.touchCombatPoint(entity, game, actor) });
  const projectiles = new Q2MissionPackProjectiles({ base: ballistics, monster: actor => monsters.context(actor), gravity: options.gravity, playerEffect: options.playerEffect });
  let game: Q2Foundation;
  const services: Q2MissionPackMonsterServices = { movers, gravity: options.gravity, powerups: options.powerups,
    badArea: actor => projectiles.badArea(actor, game), badAreaEntity: (actor, origin) => projectiles.badAreaEntity(actor, game, origin),
    markTeslaArea: (self, tesla) => projectiles.markTeslaArea(self, game, tesla) };
  const selectedPacks: readonly ("xatrix" | "rogue")[] = options.edition === "rerelease" ? ["xatrix", "rogue"] : options.program === "xatrix" ? ["xatrix"] : options.program === "rogue" ? ["rogue"] : [];
  const packs = selectedPacks.map(pack => {
    const packMonsters = registerQ2MissionPackMonsters(monsters, pack, projectiles, services, options.edition);
    const entities = new Q2MissionPackEntities(pack, { movers, weapons: ballistics, projectiles,
      teleportPlayer: (actor, origin, angles) => options.teleportPlayer(actor, origin, angles),
      targetAnger: (entity, target, angerGame) => packMonsters.targetAnger(entity, target, angerGame),
      emit: () => undefined,
    });
    return { pack, monsters: packMonsters, entities };
  });
  const baseEntities = createQ2BaseEntityModule({ movers, weapons: ballistics,
    teleportPlayer: (actor, origin, angles) => options.teleportPlayer(actor, origin, angles),
    playerPush: (actor, velocity) => options.playerPush(actor, velocity),
    setActorGravity: (actor, gravity) => options.setActorGravity(actor, gravity),
    localTime: () => { const time = new Date(); return { hour: time.getHours(), minute: time.getMinutes(), second: time.getSeconds() }; },
    turretDriver: (entity, turretGame) => monsters.spawnInfantryDriver(entity, turretGame),
    monsterContext: actor => monsters.context(actor),
    resumeMonster: (entity, resumeGame) => monsters.resumeMonster(entity, resumeGame),
  });
  const items = createQ2ItemModule(options.itemHooks);
  const modules: Q2SpawnModule[] = [...packs.map(pack => pack.entities), baseEntities, createQ2TargetModule(), movers, createQ2SceneryModule(), items, base, ...packs.map(pack => pack.monsters)];
  if (options.edition === "rerelease") {
    const source = packs.find(pack => pack.pack === "rogue")?.monsters.source;
    if (source === undefined) throw new Error("Rerelease monster registration requires its Rogue state");
    modules.push(registerQ2RereleaseMonsters(monsters, { source, weapons: projectiles, isN64: false,
      expansion: options.program === "baseq2" ? "base" : options.program === "mg2" ? "mg1" : options.program }));
  }
  game = options.createGame(monsters, modules);
  ballistics.registerCallbacks(game); game.sourceCallbacks.register(projectiles.callbacks); game.sourceCallbacks.register(movers.callbacks);
  return { game, monsters, ballistics, movers, items, baseEntities, packs };
}
