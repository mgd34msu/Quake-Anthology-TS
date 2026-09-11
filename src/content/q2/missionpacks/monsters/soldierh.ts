/* Quake II xatrix/m_soldier.c heavy soldier variants. ZeniMax Media, GPL-2.0-or-later. */
import { add, integerField, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, enemyEye, health, projectFlash, setDuck, targetDistance, vectorAngles } from "../../foundation/monsters/ai.ts";
import { throwGib, throwHead } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { aliveEnemy, finishCorpse, humanoidBounds, muzzle } from "../../base/monsters/common.ts";
import { monsterDabeam } from "./dabeam.ts";
import { soldierhFrame, soldierhMoves } from "./tables/xatrix-soldierh.ts";
import type { Q2MissionPackMonsterWeapons } from "./types.ts";

const blasterFlashes = [39, 40, 83, 86, 89, 92, 95, 98];
const machinegunFlashes = [43, 44, 85, 88, 91, 94, 97, 100];
function stand(context: MonsterContext): undefined { return context.setMove(context.state.move.name === "soldierh_move_stand3" || context.game.host.random() < 0.8 ? "soldierh_move_stand1" : "soldierh_move_stand3"); }
function run(context: MonsterContext): undefined {
  if (context.state.standGround) return context.setMove("soldierh_move_stand1");
  return context.setMove(["soldierh_move_walk1", "soldierh_move_walk2", "soldierh_move_start_run"].includes(context.state.move.name) ? "soldierh_move_run" : "soldierh_move_start_run");
}
function refire(context: MonsterContext): boolean { return context.game.options.skill === 3 && context.game.host.random() < 0.5 || targetDistance(context) < 80; }
function duck(context: MonsterContext): undefined { if (context.state.ducked) return undefined; setDuck(context, true); context.state.pauseTime = context.game.host.now() + 1; return undefined; }
function painSound(context: MonsterContext, death = false): undefined {
  const n = context.entity.skin | 1, variant = n === 1 ? 2 : n === 3 ? 1 : 3;
  return context.game.sound(context.entity, `soldier/${death ? "soldeth" : "solpain"}${variant}.wav`, 2);
}

export function createSoldierHeavyDefinitions(weapons: Q2MissionPackMonsterWeapons): readonly Q2MonsterDefinition[] {
  function fire(context: MonsterContext, index: number): undefined {
    const { entity, game, state } = context, flash = recordAt(entity.skin < 4 ? blasterFlashes : machinegunFlashes, index);
    const start = projectFlash(context, muzzleOffset(game.options.edition, flash)), axes = anglesVectors(game.body(entity).angles);
    let direction = axes.forward;
    if (index !== 5 && index !== 6) {
      const eye = enemyEye(context); if (eye === null) return undefined;
      const aim = anglesVectors(vectorAngles(subtract(eye, start)));
      direction = normalize(add(scale(aim.forward, 8192), add(scale(aim.right, (game.host.random() * 2 - 1) * 100), scale(aim.up, (game.host.random() * 2 - 1) * 50))));
    }
    if (entity.skin < 2) { weapons.fireIonRipper(entity, game, start, direction, 5, 600, 0x100000); return muzzle(context, flash, direction, start); }
    if (entity.skin < 4) { weapons.fireBlueBlaster(entity, game, start, direction, 1, 600, 0x400000); return muzzle(context, 17, direction, start); }
    if (!state.holdFrame) state.pauseTime = game.host.now() + (3 + Math.floor(game.host.random() * 8)) * 0.1;
    if (game.host.random() > 0.8) game.sound(entity, "misc/lasfly.wav", 0, 1, 3);
    const enemy = enemyBody(context); if (enemy === null) return undefined;
    const body = game.body(entity), aimAngles = vectorAngles(subtract(enemy.origin, body.origin)), aim = anglesVectors(aimAngles), offset = muzzleOffset(game.options.edition, flash);
    const origin = add(body.origin, add(scale(aim.right, offset.x + (flash === 85 ? -14 : 2)), add(scale(aim.up, offset.z + 8), scale(aim.forward, offset.y))));
    monsterDabeam(entity, game, entity.enemy, origin, aimAngles, 1, false);
    state.holdFrame = game.host.now() < state.pauseTime;
    return undefined;
  }
  function hyperRefire(context: MonsterContext, second: boolean): undefined {
    if (context.entity.skin < 2 || context.entity.skin >= 4) return undefined;
    if (context.game.host.random() < 0.7) context.entity.frame = second ? soldierhFrame.attak205 : soldierhFrame.attak103;
    else context.game.sound(context.entity, "weapons/hyprbd1a.wav", 0);
    return undefined;
  }
  const common: Q2MonsterDefinition = {
    classname: "monster_soldier_ripper", kind: "soldierh", model: "models/monsters/soldierh/tris.md2", health: 50, gibHealth: -30, mass: 100, bounds: humanoidBounds, scale: 1,
    initialMove: "soldierh_move_stand3", moves: soldierhMoves, stand, run,
    walk(context) { return context.setMove(context.game.host.random() < 0.5 ? "soldierh_move_walk1" : "soldierh_move_walk2"); },
    attack(context) { return context.setMove(context.entity.skin >= 4 ? "soldierh_move_attack4" : context.game.host.random() < 0.5 ? "soldierh_move_attack1" : "soldierh_move_attack2"); },
    // Xatrix sets variant health after the common monster_start max_health copy.
    afterSpawn(context) { context.entity.maxHealth = integerField(context.entity.spawn, "health"); return undefined; },
    sight(context) {
      context.game.sound(context.entity, context.game.host.random() < 0.5 ? "soldier/solsght1.wav" : "soldier/solsrch1.wav", 2);
      if (context.game.options.skill > 0 && targetDistance(context) >= 500 && context.game.host.random() > 0.5) context.setMove(context.entity.skin < 4 ? "soldierh_move_attack6" : "soldierh_move_attack4");
      return undefined;
    },
    pain(context) {
      if (health(context.game, context.entity.actor.id) < context.entity.maxHealth / 2) context.entity.skin |= 1;
      const airborne = context.game.body(context.entity).velocity.z > 100;
      if (context.game.host.now() < context.state.painTime) { if (airborne && ["soldierh_move_pain1", "soldierh_move_pain2", "soldierh_move_pain3"].includes(context.state.move.name)) context.setMove("soldierh_move_pain4"); return undefined; }
      context.state.painTime = context.game.host.now() + 3; painSound(context);
      if (airborne) return context.setMove("soldierh_move_pain4");
      if (context.game.options.skill === 3) return undefined;
      const r = context.game.host.random(); return context.setMove(r < 0.33 ? "soldierh_move_pain1" : r < 0.66 ? "soldierh_move_pain2" : "soldierh_move_pain3");
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (health(game, entity.actor.id) <= state.gibHealth) {
        game.sound(entity, "misc/udeath.wav", 2);
        for (let i = 0; i < 3; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        throwGib(entity, game, "models/objects/gibs/chest/tris.md2", reaction.damage); throwHead(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage);
        state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      state.dead = true; state.canTakeDamage = true; entity.skin |= 1; game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); painSound(context, true);
      if (Math.abs(game.body(entity).origin.z + entity.viewHeight - reaction.point.z) <= 4) return context.setMove("soldierh_move_death3");
      return context.setMove(recordAt(["soldierh_move_death1", "soldierh_move_death2", "soldierh_move_death4", "soldierh_move_death5", "soldierh_move_death6"], Math.floor(game.host.random() * 5)));
    },
    dodge(context, attacker, eta) {
      if (context.game.host.random() > 0.25) return undefined;
      context.entity.enemy ??= attacker;
      if (context.game.options.skill === 0) return context.setMove("soldierh_move_duck");
      context.state.pauseTime = context.game.host.now() + eta + 0.3;
      return context.setMove(context.game.host.random() > (context.game.options.skill === 1 ? 0.33 : 0.66) ? "soldierh_move_duck" : "soldierh_move_attack3");
    },
    callbacks: {
      soldierh_stand: stand, soldierh_run: run, soldierh_dead: finishCorpse,
      soldierh_idle(context) { if (context.game.host.random() > 0.8) context.game.sound(context.entity, "soldier/solidle1.wav", 2, 1, 2); return undefined; },
      soldierh_cock(context) { return context.game.sound(context.entity, "infantry/infatck3.wav", 1, 1, context.entity.frame === soldierhFrame.stand322 ? 2 : 1); },
      soldierh_walk1_random(context) { if (context.game.host.random() > 0.1) context.state.nextFrame = soldierhFrame.walk101; return undefined; },
      soldierh_hyper_sound(context) { if (context.entity.skin >= 2 && context.entity.skin < 4) context.game.sound(context.entity, "weapons/hyprbl1a.wav", 0); return undefined; },
      soldierh_hyper_refire1(context) { return hyperRefire(context, false); }, soldierh_hyper_refire2(context) { return hyperRefire(context, true); },
      soldierh_fire1(context) { return fire(context, 0); }, soldierh_fire2(context) { return fire(context, 1); }, soldierh_fire3(context) { duck(context); return fire(context, 2); },
      soldierh_fire4(context) { return fire(context, 3); }, soldierh_fire8(context) { return fire(context, 7); },
      soldierh_fire6(context) { return context.entity.skin < 4 ? fire(context, 5) : undefined; }, soldierh_fire7(context) { return context.entity.skin < 4 ? fire(context, 6) : undefined; },
      soldierh_ripper1(context) { return context.entity.skin < 4 ? fire(context, 0) : undefined; }, soldierh_ripper2(context) { return context.entity.skin < 4 ? fire(context, 1) : undefined; },
      soldierh_attack1_refire1(context) { if (context.entity.skin <= 1 && aliveEnemy(context)) context.state.nextFrame = refire(context) ? soldierhFrame.attak102 : soldierhFrame.attak110; return undefined; },
      soldierh_attack1_refire2(context) { if (context.entity.skin >= 2 && aliveEnemy(context) && refire(context)) context.state.nextFrame = soldierhFrame.attak102; return undefined; },
      soldierh_attack2_refire1(context) { if (context.entity.skin <= 1 && aliveEnemy(context)) context.state.nextFrame = refire(context) ? soldierhFrame.attak204 : soldierhFrame.attak216; return undefined; },
      soldierh_attack2_refire2(context) { if (context.entity.skin >= 2 && aliveEnemy(context) && (context.game.options.skill === 3 && context.game.host.random() < 0.5 || targetDistance(context) < 80 && context.entity.skin < 4)) context.state.nextFrame = soldierhFrame.attak204; return undefined; },
      soldierh_attack3_refire(context) { if (context.game.host.now() + 0.4 < context.state.pauseTime) context.state.nextFrame = soldierhFrame.attak303; return undefined; },
      soldierh_attack6_refire(context) { if (aliveEnemy(context) && targetDistance(context) >= 500 && context.game.options.skill === 3) context.state.nextFrame = soldierhFrame.runs03; return undefined; },
      soldierh_duck_down: duck, soldierh_duck_up(context) { return setDuck(context, false); }, soldierh_duck_hold(context) { context.state.holdFrame = context.game.host.now() < context.state.pauseTime; return undefined; },
    },
  };
  return [common, { ...common, classname: "monster_soldier_hypergun", health: 60, initialize(context) { context.entity.skin = 2; return undefined; } },
    { ...common, classname: "monster_soldier_lasergun", health: 70, initialize(context) { context.entity.skin = 4; return undefined; } }];
}
