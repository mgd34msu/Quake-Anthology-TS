/* Quake II m_float.c. id Software, GPL-2.0-or-later. */
import { subtract, zero } from "../../foundation/fields.ts";
import { enemyBody, projectFlash } from "../../foundation/monsters/ai.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { damagedSkin, explode, finishCorpse, loopSound, move, muzzle, shot, sound } from "./common.ts";
import { floatFrame, floatMoves } from "./tables/float.ts";

function stand(context: MonsterContext): undefined { return context.setMove(context.game.host.random() <= 0.5 ? "floater_move_stand1" : "floater_move_stand2"); }
function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "floater_move_stand1" : "floater_move_run"); }
// Original activate has 30 rows for 31 frames and is never selected by the game.
const activeMoves = floatMoves.filter(animation => animation.name !== "floater_move_activate");
export const floaterDefinition: Q2MonsterDefinition = {
  classname: "monster_floater", kind: "floater", model: "models/monsters/float/tris.md2", health: 200, gibHealth: -80, mass: 300,
  bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 32 } }, scale: 1, locomotion: "fly",
  initialMove: "floater_move_stand1", moves: activeMoves, stand, walk: move("floater_move_walk"), run, attack: move("floater_move_attack1"),
  melee(context) { return context.setMove(context.game.host.random() < 0.5 ? "floater_move_attack3" : "floater_move_attack2"); },
  sight: sound("floater/fltsght1.wav"), idle: sound("floater/fltidle1.wav", 2, 2),
  initialize(context) { loopSound(context, "floater/fltsrch1.wav"); return stand(context); },
  pain(context) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (context.game.options.skill === 3) return undefined;
    const first = (Math.floor(context.game.host.random() * 3) + 1) % 3 === 0;
    context.game.sound(context.entity, first ? "floater/fltpain1.wav" : "floater/fltpain2.wav", 2);
    return context.setMove(first ? "floater_move_pain1" : "floater_move_pain2");
  },
  die(context) { return explode(context, "floater/fltdeth1.wav"); },
  callbacks: {
    floater_run: run, floater_dead: finishCorpse,
    floater_fire_blaster(context) {
      const aim = shot(context, 82); if (aim === null) return undefined;
      const effects = context.entity.frame === floatFrame.attak104 || context.entity.frame === floatFrame.attak107 ? 64 : 0;
      context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, effects);
      return muzzle(context, 82, aim.direction, aim.start);
    },
    floater_wham(context) {
      context.game.sound(context.entity, "floater/fltatck3.wav", 1);
      context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, 5 + Math.floor(context.game.host.random() * 6), -50);
      return undefined;
    },
    floater_zap(context) {
      const { entity, game } = context, enemy = enemyBody(context);
      if (enemy === null || entity.enemy === null) return undefined;
      const direction = subtract(enemy.origin, game.body(entity).origin), origin = projectFlash(context, { x: 18.5, y: -0.9, z: 10 });
      game.sound(entity, "floater/fltatck2.wav", 1);
      game.host.emit({ kind: "effect", effect: "q2:splash", origin, direction, count: 32, color: 1 });
      game.damage(entity.enemy, entity, entity.actor.id, 5 + Math.floor(game.host.random() * 6), -10, direction, enemy.origin, zero, 0, 4);
      return undefined;
    },
  },
};
