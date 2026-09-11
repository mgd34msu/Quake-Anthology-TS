/* Original Rogue changes to the base species. ZeniMax Media, GPL-2.0-or-later. */
import { add, length, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, enemyEye, projectFlash } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { brainDefinition } from "../../base/monsters/brain.ts";
import { floaterDefinition } from "../../base/monsters/floater.ts";
import { gladiatorDefinition } from "../../base/monsters/gladiator.ts";
import { boss2Definition } from "../../base/monsters/boss2.ts";
import { createJorgDefinition } from "../../base/monsters/jorg.ts";
import { makronDefinition, withMakronSpawnCallbacks } from "../../base/monsters/makron.ts";
import { supertankDefinition } from "../../base/monsters/supertank.ts";
import { damagedSkin, shot } from "../../base/monsters/common.ts";
import { bossCheckAttack, withBossExplosionCallbacks } from "../../base/monsters/boss-common.ts";
import { supertankFrame } from "../../base/monsters/tables/supertank.ts";
import { blockedCheckPlatform, monsterFlash } from "../../rerelease/monsters/common.ts";
import { rogueBlockedCheckShot, rogueDuckDown, rogueDuckHold, rogueDuckUp, rogueMonsterDodge } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { createRogueSoldierDefinitions } from "./rogue-soldier.ts";
import { createRogueInfantryDefinition } from "./rogue-infantry.ts";
import { brainFrame, brainMoves } from "./tables/rogue-brain.ts";
import { floatFrame, floatMoves } from "./tables/rogue-float.ts";

export function createRogueBaseVariants(monsters: Q2Monsters, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  const shotBlocked = (context: MonsterContext): boolean => rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source);
  const blocked = (context: MonsterContext, distance: number): boolean => shotBlocked(context) || blockedCheckPlatform(context, distance);
  function brainDuck(context: MonsterContext, eta: number): undefined {
    rogueDuckDown(context);
    context.state.duckWait = context.game.host.now() + eta + (context.game.options.skill === 0 ? 1 : 0.1 * (3 - context.game.options.skill));
    context.state.nextFrame = brainFrame.duck01;
    return context.setMove("brain_move_duck");
  }
  const brain: Q2MonsterDefinition = {
    ...brainDefinition, moves: brainMoves,
    pain(context) {
      damagedSkin(context);
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      if (context.game.options.skill === 3) return undefined;
      const random = context.game.host.random();
      context.game.sound(context.entity, random < 0.33 || random >= 0.66 ? "brain/brnpain1.wav" : "brain/brnpain2.wav", 2);
      context.setMove(random < 0.33 ? "brain_move_pain1" : random < 0.66 ? "brain_move_pain2" : "brain_move_pain3");
      if (context.state.ducked) rogueDuckUp(context);
      return undefined;
    },
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, brainDuck, null); },
    duck(context, eta) { brainDuck(context, eta); return true; },
    callbacks: { ...brainDefinition.callbacks, monster_duck_down: rogueDuckDown, monster_duck_hold: rogueDuckHold, monster_duck_up: rogueDuckUp },
  };
  const floater: Q2MonsterDefinition = {
    ...floaterDefinition, moves: floatMoves.filter(move => move.name !== "floater_move_activate"), blocked: shotBlocked,
    attack(context) {
      const skill = context.game.options.skill, chance = skill === 0 ? 0 : 1 - 0.5 / skill;
      if (context.game.host.random() > chance) { context.state.attackState = "straight"; return context.setMove("floater_move_attack1"); }
      if (context.game.host.random() <= 0.5) context.state.lefty = !context.state.lefty;
      context.state.attackState = "sliding";
      return context.setMove("floater_move_attack1a");
    },
    callbacks: { ...floaterDefinition.callbacks,
      floater_fire_blaster(context) {
        const aim = shot(context, 82); if (aim === null) return undefined;
        const effect = context.entity.frame === floatFrame.attak104 || context.entity.frame === floatFrame.attak107 ? 64 : 0;
        context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, effect);
        return monsterFlash(context, 82, aim.start, aim.direction);
      },
    },
  };
  function bossRockets(context: MonsterContext, predictive: boolean): undefined {
    const { entity, game } = context, enemy = enemyBody(context);
    if (enemy === null) return undefined;
    const right = anglesVectors(game.body(entity).angles).right;
    if (predictive) game.host.diagnostic("predictive fire");
    for (let index = 0; index < 4; index++) {
      const flash = 78 + index, start = projectFlash(context, muzzleOffset(game.options.edition, flash));
      const direction = predictive ? normalize(subtract(add(enemy.origin, scale(enemy.velocity, length(subtract(enemy.origin, start)) / 750 - 0.3 + index * 0.15)), start))
        : normalize(add(normalize(subtract({ ...enemy.origin, z: enemy.origin.z - (index === 0 || index === 3 ? 15 : 0) }, start)), scale(right, recordAt([0.4, 0.025, -0.025, -0.4], index))));
      context.weapons.fireRocket(entity, game, start, direction, 50, predictive ? 750 : 500, 70, 50);
      monsterFlash(context, flash, start, direction);
    }
    return undefined;
  }
  function bossBullet(context: MonsterContext, right: boolean): undefined {
    const aim = shot(context, right ? 133 : 73, right ? 0.2 : -0.2); if (aim === null) return undefined;
    context.weapons.fireBullet(context.entity, context.game, aim.start, aim.direction, 6, 4, 900, 500, 0);
    return monsterFlash(context, right ? 133 : 73, aim.start, aim.direction);
  }
  const boss2: Q2MonsterDefinition = {
    ...boss2Definition, yawSpeed: 50,
    checkAttack: context => bossCheckAttack(context, true, true),
    callbacks: { ...boss2Definition.callbacks,
      Boss2PredictiveRocket: context => bossRockets(context, true),
      Boss2Rocket: context => bossRockets(context, context.entity.enemy !== null && context.game.host.isPlayer(context.entity.enemy) && context.game.host.random() < 0.9),
      boss2_firebullet_right: context => bossBullet(context, true), boss2_firebullet_left: context => bossBullet(context, false),
      Boss2MachineGun(context) { bossBullet(context, false); return bossBullet(context, true); },
    },
  };
  const supertank: Q2MonsterDefinition = {
    ...supertankDefinition, blocked,
    initialize(context) { context.state.ignoreShots = true; return undefined; },
    callbacks: { ...supertankDefinition.callbacks,
      supertankRocket(context) {
        const flash = context.entity.frame === supertankFrame.attak2_8 ? 70 : context.entity.frame === supertankFrame.attak2_11 ? 71 : 72;
        const aim = shot(context, flash); if (aim === null) return undefined;
        context.weapons.fireRocket(context.entity, context.game, aim.start, aim.direction, 50, 500, 70, 50);
        return monsterFlash(context, flash, aim.start, aim.direction);
      },
      supertankMachineGun(context) {
        const eye = enemyEye(context); if (eye === null) return undefined;
        const flash = 64 + context.entity.frame - supertankFrame.attak1_1;
        const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash), { x: 0, y: context.game.body(context.entity).angles.y, z: 0 });
        const direction = normalize(subtract(eye, start));
        context.weapons.fireBullet(context.entity, context.game, start, direction, 6, 4, 300, 500, 0);
        return monsterFlash(context, flash, start, direction);
      },
    },
  };
  const jorg = createJorgDefinition(monsters);
  return [...createRogueSoldierDefinitions(monsters, source), createRogueInfantryDefinition(monsters, source), brain, floater, { ...gladiatorDefinition, blocked }, withBossExplosionCallbacks(boss2, monsters), withBossExplosionCallbacks(supertank, monsters),
    withBossExplosionCallbacks({ ...jorg, initialize(context) { jorg.initialize?.(context); context.state.ignoreShots = true; return undefined; } }, monsters),
    withMakronSpawnCallbacks({ ...makronDefinition, initialize(context) { context.state.ignoreShots = true; return undefined; } }, monsters)];
}
