/* Original Rogue m_soldier.c behavior. ZeniMax Media, GPL-2.0-or-later. */
import { add, dot, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, enemyEye, finishDodge, health, projectFlash, targetDistance, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import { soldierCallbacks, soldierDie, soldierRun, soldierStand, soldierWalk } from "../../foundation/monsters/soldier.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { finishCorpse, humanoidBounds } from "../../base/monsters/common.ts";
import { blockedCheckPlatform, monsterFlash } from "../../rerelease/monsters/common.ts";
import { rogueBlockedCheckShot, rogueDuckDown, rogueDuckHold, rogueDuckUp, rogueMonsterDodge } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { soldierFrame, soldierMoves } from "./tables/rogue-soldier.ts";

const blasterFlashes = [39, 40, 83, 86, 89, 92, 95, 98];
const shotgunFlashes = [41, 42, 84, 87, 90, 93, 96, 99];
const machinegunFlashes = [43, 44, 85, 88, 91, 94, 97, 100];
function run(context: MonsterContext): undefined { finishDodge(context); return soldierRun(context); }
function stand(context: MonsterContext): undefined { return (context.entity.spawnflags & 8) !== 0 ? context.setMove("soldier_move_blind") : soldierStand(context); }
function fire(context: MonsterContext, input: number): undefined {
  const { entity, game, state, weapons } = context;
  if (enemyBody(context) === null) { state.holdFrame = false; return undefined; }
  const index = Math.abs(input), flash = recordAt(entity.skin < 2 ? blasterFlashes : entity.skin < 4 ? shotgunFlashes : machinegunFlashes, index);
  const start = projectFlash(context, muzzleOffset(game.options.edition, flash));
  let aim = anglesVectors(game.body(entity).angles).forward;
  if (index !== 5 && index !== 6) {
    const eye = enemyEye(context);
    if (eye === null) return undefined;
    const direction = subtract(eye, start);
    if (input < 0 && dot(normalize(direction), aim) < 0.9) return undefined;
    const axes = anglesVectors(vectorAngles(direction)), spread = game.options.skill < 2 ? 1000 : 500;
    aim = normalize(add(scale(axes.forward, 8192), add(scale(axes.right, (game.host.random() * 2 - 1) * spread), scale(axes.up, (game.host.random() * 2 - 1) * spread * 0.5))));
    const trace = game.host.trace({ start, end: eye, bounds: null, ignore: entity.actor.id, mask: 0x6000003 });
    if (trace.hit.kind === "actor" && trace.hit.actor !== entity.enemy) return undefined;
  }
  if (entity.skin <= 1) weapons.fireBlaster(entity, game, start, aim, 5, 600, 8);
  else if (entity.skin <= 3) weapons.fireShotgun(entity, game, start, aim, 2, 1, 1000, 500, 12, 0);
  else {
    if (!state.holdFrame) entity.wait = game.host.now() + (3 + (Math.floor(game.host.random() * 0x8000) % 8)) * 0.1;
    weapons.fireBullet(entity, game, start, aim, 2, 4, 300, 500, 0);
    state.holdFrame = game.host.now() < entity.wait;
  }
  return monsterFlash(context, flash, start, aim);
}
function duck(context: MonsterContext, eta: number): undefined {
  const { game, state } = context;
  rogueDuckDown(context);
  const simple = game.options.skill === 0 || game.host.random() > game.options.skill * 0.3;
  state.nextFrame = simple ? soldierFrame.duck01 : soldierFrame.attak301;
  context.setMove(simple ? "soldier_move_duck" : "soldier_move_attack3");
  state.duckWait = game.host.now() + eta + (game.options.skill === 0 || !simple ? 1 : 0.1 * (3 - game.options.skill));
  return undefined;
}
function sidestep(context: MonsterContext): undefined {
  const move = context.entity.skin <= 3 ? "soldier_move_attack6" : "soldier_move_start_run";
  return context.state.move.name === move ? undefined : context.setMove(move);
}
function refire(context: MonsterContext, first: boolean, blaster: boolean): undefined {
  const { entity, game, state } = context;
  if (first && blaster && state.manualSteering) { state.manualSteering = false; return undefined; }
  if (entity.enemy === null || (entity.skin <= 1) !== blaster || health(game, entity.enemy) <= 0) return undefined;
  if (game.options.skill === 3 && game.host.random() < 0.5 || targetDistance(context) < 80) state.nextFrame = first ? soldierFrame.attak102 : soldierFrame.attak204;
  else if (blaster) state.nextFrame = first ? soldierFrame.attak110 : soldierFrame.attak216;
  return undefined;
}

export function createRogueSoldierDefinitions(monsters: Q2Monsters, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  return ["monster_soldier_light", "monster_soldier", "monster_soldier_ss"].map((classname): Q2MonsterDefinition => ({
    classname, kind: "soldier", model: "models/monsters/soldier/tris.md2", health: classname === "monster_soldier_light" ? 20 : classname === "monster_soldier" ? 30 : 40,
    gibHealth: -30, mass: 100, bounds: humanoidBounds, scale: 1, initialMove: "soldier_move_stand1", moves: soldierMoves,
    stand, walk: soldierWalk, run, die: soldierDie, blindFire: classname === "monster_soldier_light", initialize: stand,
    attack(context) {
      finishDodge(context);
      const { game, state, entity } = context;
      if (state.attackState === "blind") {
        const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1, random = game.host.random();
        state.blindFireDelay += 4.1 + game.host.random() * 3;
        if (state.blindFireTarget.x === 0 && state.blindFireTarget.y === 0 && state.blindFireTarget.z === 0 || random > chance) return undefined;
        state.manualSteering = true; context.setMove("soldier_move_attack1"); state.attackFinished = game.host.now() + 1.5 + game.host.random();
        return undefined;
      }
      const random = game.host.random();
      if (!source.get(entity).blocked && !state.standGround && targetDistance(context) >= 80 && random < game.options.skill * 0.25 && entity.skin <= 3) return context.setMove("soldier_move_attack6");
      return context.setMove(entity.skin < 4 ? game.host.random() < 0.5 ? "soldier_move_attack1" : "soldier_move_attack2" : "soldier_move_attack4");
    },
    sight(context) {
      const { game, entity } = context;
      game.sound(entity, game.host.random() < 0.5 ? "soldier/solsght1.wav" : "soldier/solsrch1.wav", 2);
      if (game.options.skill > 0 && entity.enemy !== null && targetDistance(context) >= 80 && game.host.random() > 0.75 && entity.skin <= 3) context.setMove("soldier_move_attack6");
      return undefined;
    },
    pain(context) {
      const { entity, game, state } = context;
      if (health(game, entity.actor.id) < entity.maxHealth / 2) entity.skin |= 1;
      finishDodge(context); state.charging = false; state.manualSteering = false;
      const airborne = game.body(entity).velocity.z > 100;
      if (game.host.now() < state.painTime) {
        if (airborne && ["soldier_move_pain1", "soldier_move_pain2", "soldier_move_pain3"].includes(state.move.name)) {
          if (state.ducked) rogueDuckUp(context);
          context.setMove("soldier_move_pain4");
        }
        return undefined;
      }
      state.painTime = game.host.now() + 3;
      game.sound(entity, (entity.skin | 1) === 1 ? "soldier/solpain2.wav" : (entity.skin | 1) === 3 ? "soldier/solpain1.wav" : "soldier/solpain3.wav", 2);
      if (airborne) { if (state.ducked) rogueDuckUp(context); return context.setMove("soldier_move_pain4"); }
      if (game.options.skill === 3) return undefined;
      const random = game.host.random();
      context.setMove(random < 0.33 ? "soldier_move_pain1" : random < 0.66 ? "soldier_move_pain2" : "soldier_move_pain3");
      if (state.ducked) rogueDuckUp(context);
      return undefined;
    },
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, duck, sidestep); },
    duck(context, eta) { duck(context, eta); return true; },
    blocked(context, distance) { return !context.state.dodging && !context.state.ducked && (rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source) || blockedCheckPlatform(context, distance)); },
    callbacks: {
      ...soldierCallbacks, soldier_run: run, monster_done_dodge: finishDodge,
      monster_duck_down: rogueDuckDown, monster_duck_hold: rogueDuckHold, monster_duck_up: rogueDuckUp,
      soldier_stop_charge(context) { context.state.charging = false; return undefined; },
      soldier_fire1: context => fire(context, 0), soldier_fire2: context => fire(context, 1),
      soldier_fire3(context) { rogueDuckDown(context); return fire(context, 2); },
      soldier_fire4: context => fire(context, 3), soldier_fire6: context => fire(context, 5), soldier_fire7: context => fire(context, 6), soldier_fire8: context => fire(context, -7),
      soldier_fire_run(context) { return context.entity.skin <= 1 && context.entity.enemy !== null && visible(context) ? fire(context, 0) : undefined; },
      soldier_attack1_refire1: context => refire(context, true, true), soldier_attack1_refire2: context => refire(context, true, false),
      soldier_attack2_refire1: context => refire(context, false, true), soldier_attack2_refire2: context => refire(context, false, false),
      soldier_attack3_refire(context) { if (context.game.host.now() + 0.4 < context.state.duckWait) context.state.nextFrame = soldierFrame.attak303; return undefined; },
      soldier_attack6_refire(context) {
        finishDodge(context); context.state.charging = false;
        if (context.entity.enemy !== null && health(context.game, context.entity.enemy) > 0 && targetDistance(context) >= 80 && (context.game.options.skill === 3 || context.game.host.random() < 0.25 * context.game.options.skill)) context.state.nextFrame = soldierFrame.runs03;
        return undefined;
      },
      soldier_dead2(context) {
        const { entity, game } = context, origin = game.body(entity).origin, start = { ...origin, z: origin.z + 1 };
        const bounds = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -8 } };
        const trace = game.host.trace({ start, end: start, bounds, ignore: entity.actor.id, mask: 3 });
        return trace.startSolid || trace.allSolid ? finishCorpse(context) : finishCorpse(context, bounds);
      },
    },
  }));
}
