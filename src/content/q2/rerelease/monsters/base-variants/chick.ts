// Rerelease m_chick.cpp. ZeniMax Media, GPL-2.0.
import { chickDefinition } from "../../../base/monsters/chick.ts";
import { aliveEnemy } from "../../../base/monsters/common.ts";
import { add, length, normalize, scale, subtract } from "../../../foundation/fields.ts";
import { anglesVectors, clearShot, corpse, enemyBody, finishDodge, health, projectFlash, setDuck, targetDistance, vectorAngles, visible } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterWeapons } from "../../../missionpacks/monsters/types.ts";
import { blockedCheckPlatform, checkGib, monsterFlash, predictAim, reactsToPain } from "../common.ts";
import { chickMoves } from "../tables/chick.ts";

function run(context: MonsterContext): undefined {
  finishDodge(context);
  return context.setMove(context.state.standGround ? "chick_move_stand" : ["chick_move_walk", "chick_move_start_run"].includes(context.state.move.name) ? "chick_move_run" : "chick_move_start_run");
}
function rocket(context: MonsterContext, weapons: Q2MissionPackMonsterWeapons): undefined {
  const { entity, state, game } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
  const start = projectFlash(context, muzzleOffset("rerelease", 57)), right = anglesVectors(game.body(entity).angles).right;
  const target = state.manualSteering ? state.blindFireTarget : enemy.origin, heat = entity.skin > 1, speed = heat ? 500 : 650;
  let point = target;
  if (!state.manualSteering) point = game.host.random() < 0.33 || start.z < enemy.origin.z + enemy.bounds.min.z
    ? { ...target, z: target.z + (game.entity(entity.enemy)?.viewHeight ?? 22) }
    : { ...target, z: enemy.origin.z + enemy.bounds.min.z + 1 };
  if (!state.manualSteering && game.host.random() < 0.35) point = predictAim(context, start, speed, false, 0)?.point ?? point;
  const trace = (end: typeof point) => game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: 0x46004003 });
  let obstruction = trace(point);
  if (state.manualSteering) {
    const blocked = (): boolean => obstruction.startSolid || obstruction.allSolid || obstruction.fraction < 0.5;
    if (blocked()) { point = add(target, scale(right, -10)); obstruction = trace(point); }
    if (blocked()) { point = add(target, scale(right, 10)); obstruction = trace(point); }
    if (blocked()) return undefined;
  } else if (obstruction.fraction <= 0.5 && (obstruction.hit.kind === "world" || obstruction.hit.kind === "actor" && game.entity(obstruction.hit.actor)?.solid === "brush")) return undefined;
  const direction = normalize(subtract(point, start));
  if (heat) weapons.fireHeatRocket(entity, game, start, direction, 50, speed, 70, 50, state.manualSteering ? 0.075 : 0.15);
  else context.weapons.fireRocket(entity, game, start, direction, 50, speed, 70, 50);
  return monsterFlash(context, 57, start, direction);
}
export function createRereleaseChickDefinitions(weapons: Q2MissionPackMonsterWeapons): readonly Q2MonsterDefinition[] {
  const definition: Q2MonsterDefinition = {
  classname: chickDefinition.classname, kind: chickDefinition.kind, model: chickDefinition.model, health: 175, gibHealth: -70, mass: 200,
  bounds: chickDefinition.bounds, scale: 1, initialMove: chickDefinition.initialMove, stand: chickDefinition.stand, walk: chickDefinition.walk,
  melee: context => context.setMove("chick_move_start_slash"), sight: context => context.game.sound(context.entity, "chick/chksght1.wav", 2),
  moves: chickMoves, blindFire: true, run,
  attack(context) {
    if (!clearShot(context, muzzleOffset("rerelease", 57))) return undefined;
    finishDodge(context);
    const { game, state } = context;
    if (state.attackState === "blind") {
      const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1, choice = game.host.random();
      state.blindFireDelay += 5.5 + game.host.random();
      if (length(state.blindFireTarget) === 0 || choice > chance) return undefined;
      state.manualSteering = true; state.attackFinished = game.host.now() + game.host.random() * 2;
    }
    return context.setMove("chick_move_start_attack1");
  },
  pain(context, reaction) {
    const { game, entity, state } = context; finishDodge(context);
    entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
    if (game.host.now() < state.painTime) return undefined;
    state.painTime = game.host.now() + 3;
    const choice = game.host.random(); game.sound(entity, choice < 0.33 ? "chick/chkpain1.wav" : choice < 0.66 ? "chick/chkpain2.wav" : "chick/chkpain3.wav", 2);
    if (!reactsToPain(context)) return undefined;
    state.manualSteering = false; context.setMove(reaction.damage <= 10 ? "chick_move_pain1" : reaction.damage <= 25 ? "chick_move_pain2" : "chick_move_pain3");
    if (state.ducked) setDuck(context, false); return undefined;
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      for (const part of ["arm", "foot", "tube"]) throwGib(entity, game, `models/monsters/bitch/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: true });
      throwGib(entity, game, "models/monsters/bitch/gibs/chest.md2", reaction.damage, { skinned: true });
      throwGib(entity, game, "models/monsters/bitch/gibs/head.md2", reaction.damage, { skinned: true, head: true });
      state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    const first = game.host.random() >= 0.5;
    game.sound(entity, first ? "chick/chkdeth1.wav" : "chick/chkdeth2.wav", 2);
    return context.setMove(first ? "chick_move_death1" : "chick_move_death2");
  },
  duck(context) {
    if (["chick_move_start_attack1", "chick_move_attack1"].includes(context.state.move.name)) { context.dispatch("monster_duck_up"); return false; }
    context.setMove("chick_move_duck"); return true;
  },
  sidestep(context) {
    if (["chick_move_start_attack1", "chick_move_attack1", "chick_move_pain3"].includes(context.state.move.name)) return false;
    if (context.state.move.name !== "chick_move_run") context.setMove("chick_move_run"); return true;
  },
  blocked: blockedCheckPlatform,
  callbacks: {
    ...chickDefinition.callbacks, chick_run: run, ChickRocket: context => rocket(context, weapons),
    Chick_PreAttack1(context) {
      context.game.sound(context.entity, "chick/chkatck1.wav", 2);
      if (context.state.manualSteering) context.state.idealYaw = vectorAngles(subtract(context.state.blindFireTarget, context.game.body(context.entity).origin)).y;
      return undefined;
    },
    ChickSlash(context) {
      context.game.sound(context.entity, "chick/chkatck3.wav", 1);
      context.weapons.fireHit(context.entity, context.game, { x: 80, y: context.game.body(context.entity).bounds.min.x, z: 10 }, 10 + Math.floor(context.game.host.random() * 6), 100);
      return undefined;
    },
    chick_rerocket(context) {
      if (context.state.manualSteering) { context.state.manualSteering = false; return context.setMove("chick_move_end_attack1"); }
      return context.setMove(clearShot(context, muzzleOffset("rerelease", 57)) && aliveEnemy(context) && targetDistance(context) > 80 && visible(context) && context.game.host.random() <= 0.7 ? "chick_move_attack1" : "chick_move_end_attack1");
    },
    chick_reslash(context) { return context.setMove(aliveEnemy(context) && targetDistance(context) <= 80 && context.game.host.random() <= 0.9 ? "chick_move_slash" : "chick_move_end_slash"); },
    chick_shrink(context) { const body = context.game.body(context.entity); context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: 12 } } }); },
    chick_dead(context) { corpse(context); return context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 8 } } }); },
  },
};
  return [definition, { ...definition, classname: "monster_chick_heat", afterSpawn(context) { context.entity.skin = 2; return undefined; } }];
}
