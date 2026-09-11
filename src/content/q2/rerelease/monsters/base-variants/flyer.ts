// Rerelease m_flyer.cpp normal Flyer. ZeniMax Media, GPL-2.0.
import { flyerDefinition } from "../../../base/monsters/flyer.ts";
import { loopSound, move, shot, sound } from "../../../base/monsters/common.ts";
import { add, normalize, scale, subtract, zero } from "../../../foundation/fields.ts";
import type { Q2Touch } from "../../../foundation/host.ts";
import { enemyBody, health, targetDistance, visible } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { monsterFlash, reactsToPain, rereleaseRandom } from "../common.ts";
import { flyerMoves } from "../tables/flyer.ts";

function flight(context: MonsterContext, melee: boolean): undefined {
  const { state } = context;
  if (melee) { state.flyPinned = false; state.flyPositionTime = 0; }
  state.flyThrusters = melee; state.flyAcceleration = melee ? 20 : 15; state.flySpeed = melee ? 210 : 165;
  state.flyMinDistance = melee ? 0 : 45; state.flyMaxDistance = melee ? 10 : 200; return undefined;
}
function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "flyer_move_stand" : "flyer_move_run"); }
function fire(context: MonsterContext, flash: number): undefined {
  const aim = shot(context, flash); if (aim === null) return undefined;
  context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, context.entity.frame % 4 === 0 ? 64 : 0);
  return monsterFlash(context, flash, aim.start, aim.direction);
}
function slash(context: MonsterContext, right: boolean): undefined {
  const bounds = context.game.body(context.entity).bounds;
  if (!context.weapons.fireHit(context.entity, context.game, { x: 80, y: right ? bounds.max.x : bounds.min.x, z: 0 }, 5, 0)) context.state.meleeTime = context.game.host.now() + 1.5;
  return context.game.sound(context.entity, "flyer/flyatck2.wav", 1);
}
export function createRereleaseFlyerDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const touch: Q2Touch = (entity, game, contact) => {
    const context = monsters.context(entity.actor.id), other = monsters.context(contact.other);
    if (context === null || other === null || !other.state.alternateFly || other.state.locomotion !== "fly" || context.state.duckWait >= game.host.now()) return undefined;
    context.state.duckWait = game.host.now() + 1; context.state.flyThrusters = false;
    const origin = game.body(entity).origin, direction = normalize(subtract(origin, game.body(other.entity).origin));
    game.move(entity, { velocity: scale(direction, 500) });
    return game.host.emit({ kind: "effect", effect: "q2:splash", origin, direction, count: 32, color: 1 });
  };
  return {
    ...flyerDefinition, moves: flyerMoves.filter(animation => animation.name !== "flyer_move_kamikaze"),
    bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 16 } }, viewHeight: 12, run,
    sourceCallbacks: { touch: { flyer_touch: touch } },
    initialize(context) { context.state.alternateFly = true; context.state.flyBuzzard = true; context.entity.touch = touch; flight(context, false); return loopSound(context, "flyer/flyidle1.wav"); },
    attack(context) {
      const { state, game, entity } = context, enemy = enemyBody(context), range = targetDistance(context);
      state.attackState = "straight";
      if (enemy !== null && visible(context) && range <= 225 && game.host.random() > range / 225 * 0.35) {
        context.setMove("flyer_move_start_melee"); flight(context, true);
      } else context.setMove("flyer_move_attack2");
      if (!state.flyPinned && rereleaseRandom(context).integer(2) !== 0 && enemy !== null && visible(context)) {
        state.flyPinned = true; state.flyPositionTime += 1.7;
        const body = game.body(entity);
        state.flyIdealPosition = rereleaseRandom(context).integer(2) !== 0 ? add(body.origin, scale(body.velocity, game.host.random())) : add(state.flyIdealPosition, enemy.origin);
      }
      return undefined;
    },
    melee(context) { context.setMove("flyer_move_start_melee"); return flight(context, true); },
    pain(context) {
      const { entity, game, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      const choice = rereleaseRandom(context).integer(3);
      game.sound(entity, choice === 1 ? "flyer/flypain2.wav" : "flyer/flypain1.wav", 2);
      if (!reactsToPain(context)) return undefined;
      flight(context, false); return context.setMove(`flyer_move_pain${choice + 1}`);
    },
    die(context) {
      const { entity, game, state } = context;
      game.sound(entity, "flyer/flydeth1.wav", 2);
      game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
      entity.skin = Math.trunc(entity.skin / 2);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 55);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 55);
      throwGib(entity, game, "models/monsters/flyer/gibs/base.md2", 55, { skinned: true });
      for (const part of ["gun", "wing"]) for (let i = 0; i < 2; i++) throwGib(entity, game, `models/monsters/flyer/gibs/${part}.md2`, 55, { skinned: true });
      throwGib(entity, game, "models/monsters/flyer/gibs/head.md2", 55, { skinned: true, head: true });
      entity.touch = null; state.dead = true; state.gibbed = true; return undefined;
    },
    callbacks: {
      flyer_run: run, flyer_pop_blades: sound("flyer/flyatck1.wav", 2), flyer_loop_melee: move("flyer_move_loop_melee"),
      flyer_fireleft: context => fire(context, 58), flyer_fireright: context => fire(context, 59),
      flyer_slash_left: context => slash(context, false), flyer_slash_right: context => slash(context, true),
      flyer_check_melee(context) {
        if (targetDistance(context) <= 80 && context.state.meleeTime <= context.game.host.now()) return context.setMove("flyer_move_loop_melee");
        context.setMove("flyer_move_end_melee"); return flight(context, false);
      },
    },
  };
}
