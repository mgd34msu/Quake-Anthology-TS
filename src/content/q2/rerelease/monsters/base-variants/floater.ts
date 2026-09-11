// Rerelease m_float.cpp. ZeniMax Media, GPL-2.0.
import { floaterDefinition } from "../../../base/monsters/floater.ts";
import { loopSound, shot } from "../../../base/monsters/common.ts";
import { subtract, zero } from "../../../foundation/fields.ts";
import { enemyBody, health, projectFlash } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { monsterFlash, reactsToPain, rereleaseRandom } from "../common.ts";
import { floatMoves } from "../tables/float.ts";

function stand(context: MonsterContext): undefined {
  return context.setMove(context.state.move.name === "floater_move_disguise" ? "floater_move_disguise" : context.game.host.random() <= 0.5 ? "floater_move_stand1" : "floater_move_stand2");
}
function run(context: MonsterContext): undefined {
  return context.setMove(context.state.move.name === "floater_move_disguise" ? "floater_move_pop" : context.state.standGround ? "floater_move_stand1" : "floater_move_run");
}
export const rereleaseFloaterDefinition: Q2MonsterDefinition = {
  ...floaterDefinition, moves: floatMoves, bounds: { min: { x: -24, y: -24, z: -24 }, max: { x: 24, y: 24, z: 48 } }, stand, run,
  initialize(context) {
    const { state } = context; state.alternateFly = true; state.flyThrusters = false;
    state.flyAcceleration = 10; state.flySpeed = 100; state.flyMinDistance = 20; state.flyMaxDistance = 200;
    loopSound(context, "floater/fltsrch1.wav");
    if ((context.entity.spawnflags & 8) !== 0) return context.setMove("floater_move_disguise");
    return stand(context);
  },
  attack(context) {
    if (context.game.host.random() > 0.5) { context.state.attackState = "straight"; return context.setMove("floater_move_attack1"); }
    if (context.game.host.random() <= 0.5) context.state.lefty = !context.state.lefty;
    context.state.attackState = "sliding";
    return context.setMove("floater_move_attack1a");
  },
  pain(context) {
    const { entity, game, state } = context;
    entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
    if (game.host.now() < state.painTime || state.move.name === "floater_move_disguise" || state.move.name === "floater_move_pop") return undefined;
    const first = rereleaseRandom(context).integer(3) === 0;
    game.sound(entity, first ? "floater/fltpain1.wav" : "floater/fltpain2.wav", 2);
    state.painTime = game.host.now() + 3;
    if (!reactsToPain(context)) return undefined;
    return context.setMove(first ? "floater_move_pain1" : "floater_move_pain2");
  },
  die(context) {
    const { entity, game, state } = context;
    game.sound(entity, "floater/fltdeth1.wav", 2);
    game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
    entity.skin = Math.trunc(entity.skin / 2);
    for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 55);
    for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 55);
    for (const part of ["piece", "gun", "base"]) throwGib(entity, game, `models/monsters/float/gibs/${part}.md2`, 55, { skinned: true });
    throwGib(entity, game, "models/monsters/float/gibs/jar.md2", 55, { skinned: true, head: true });
    state.dead = true; state.gibbed = true; return undefined;
  },
  callbacks: {
    ...floaterDefinition.callbacks, floater_run: run,
    floater_fire_blaster(context) {
      const aim = shot(context, 82); if (aim === null) return undefined;
      context.weapons.fireBlaster(context.entity, context.game, aim.start, aim.direction, 1, 1000, context.entity.frame % 4 === 0 ? 64 : 0);
      return monsterFlash(context, 82, aim.start, aim.direction);
    },
    floater_wham(context) {
      context.game.sound(context.entity, "floater/fltatck3.wav", 1);
      if (!context.weapons.fireHit(context.entity, context.game, { x: 80, y: 0, z: 0 }, rereleaseRandom(context).integer(5, 11), -50)) context.state.meleeTime = context.game.host.now() + 3;
      return undefined;
    },
    floater_zap(context) {
      const { entity, game } = context, enemy = enemyBody(context);
      if (enemy === null || entity.enemy === null) return undefined;
      const direction = subtract(enemy.origin, game.body(entity).origin), origin = projectFlash(context, { x: 18.5, y: -0.9, z: 10 });
      game.sound(entity, "floater/fltatck2.wav", 1); game.host.emit({ kind: "effect", effect: "q2:splash", origin, direction, count: 32, color: 1 });
      game.damage(entity.enemy, entity, entity.actor.id, rereleaseRandom(context).integer(5, 11), -10, direction, enemy.origin, zero, 0, 4); return undefined;
    },
  },
};
