/* Quake II rogue/m_flyer.c. ZeniMax Media, GPL-2.0-or-later. */
import { flyerDefinition } from "../../base/monsters/flyer.ts";
import { explode, move } from "../../base/monsters/common.ts";
import { add, scale, subtract, zero } from "../../foundation/fields.ts";
import { enemyBody, targetDistance } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { monsterMass, rogueBlockedCheckShot } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { flyerMoves } from "./tables/rogue-flyer.ts";

export function createRogueFlyerDefinitions(monsters: Q2Monsters, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  const run = (context: MonsterContext): undefined => context.setMove(monsterMass(context) > 50 ? "flyer_move_kamikaze" : context.state.standGround ? "flyer_move_stand" : "flyer_move_run");
  function returnSlot(context: MonsterContext): undefined {
    const commander = context.game.entity(context.state.commander), commanderState = commander === null ? undefined : monsters.context(commander.actor.id)?.state;
    if (commander?.classname === "monster_carrier" && commanderState !== undefined) commanderState.monsterSlots++;
    return undefined;
  }
  function kamikazeExplode(context: MonsterContext): undefined {
    const { entity, game } = context;
    returnSlot(context);
    const enemy = enemyBody(context);
    if (entity.enemy !== null && enemy !== null) game.damage(entity.enemy, entity, entity.actor.id, 50, 50, subtract(enemy.origin, game.body(entity).origin), game.body(entity).origin, zero, 0, 1);
    return explode(context, "flyer/flydeth1.wav");
  }
  function kamikazeCheck(context: MonsterContext): undefined {
    const { entity, game } = context;
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if (entity.enemy === null || !game.host.actors.isLive(entity.enemy)) return kamikazeExplode(context);
    entity.goal = entity.enemy;
    return targetDistance(context) < 90 ? kamikazeExplode(context) : undefined;
  }
  const definition: Q2MonsterDefinition = {
    ...flyerDefinition, bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 16 } }, moves: flyerMoves,
    run,
    stand(context) { return monsterMass(context) > 50 ? run(context) : context.setMove("flyer_move_stand"); },
    walk(context) { return monsterMass(context) > 50 ? run(context) : context.setMove("flyer_move_walk"); },
    melee(context) { return monsterMass(context) > 50 ? run(context) : context.setMove("flyer_move_start_melee"); },
    attack(context) {
      if (monsterMass(context) > 50) return run(context);
      const chance = context.game.options.skill === 0 ? 0 : 1 - 0.5 / context.game.options.skill;
      if (context.game.host.random() > chance) { context.state.attackState = "straight"; return context.setMove("flyer_move_attack2"); }
      if (context.game.host.random() <= 0.5) context.state.lefty = !context.state.lefty;
      context.state.attackState = "sliding";
      return context.setMove("flyer_move_attack3");
    },
    pain(context, reaction) { return monsterMass(context) === 50 ? flyerDefinition.pain?.(context, reaction) : undefined; },
    blocked(context) {
      if (monsterMass(context) !== 100) return rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source);
      kamikazeCheck(context);
      if (context.game.host.actors.isLive(context.entity.actor.id)) {
        returnSlot(context);
        const body = context.game.body(context.entity);
        context.game.host.emit({ kind: "effect", effect: "q2:rocket-explosion", origin: add(body.origin, scale(body.velocity, -0.02)), direction: zero, count: 1, color: 0 });
        context.game.remove(context.entity);
      }
      return true;
    },
    callbacks: {
      ...flyerDefinition.callbacks,
      flyer_run: run, flyer_kamikaze: move("flyer_move_kamikaze"), flyer_kamikaze_check: kamikazeCheck,
      flyer_setstart(context) { source.flyerNextMove = "run"; return context.setMove("flyer_move_start"); },
      flyer_nextmove(context) { return source.flyerNextMove === "run" ? context.setMove("flyer_move_run") : undefined; },
    },
  };
  return [definition, {
    ...definition, classname: "monster_kamikaze", kind: "kamikaze", mass: 100,
    initialize(context) {
      context.entity.effects |= 16;
      // The kamikaze spawn does not apply the base flyer's jail5 correction.
      return context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path: "flyer/flyidle1.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
    },
  }];
}
