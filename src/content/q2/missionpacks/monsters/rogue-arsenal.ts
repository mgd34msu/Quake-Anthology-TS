/* Original Rogue Tank and Iron Maiden weapon and dodge behavior. GPL-2.0-or-later. */
import { add, length, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, finishDodge, health, projectFlash, targetDistance, visible } from "../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { chickDefinition } from "../../base/monsters/chick.ts";
import { tankDefinition } from "../../base/monsters/tank.ts";
import { aliveEnemy, damagedSkin } from "../../base/monsters/common.ts";
import { tankFrame } from "../../base/monsters/tables/tank.ts";
import { blockedCheckPlatform, monsterFlash } from "../../rerelease/monsters/common.ts";
import { rogueBlockedCheckShot, rogueDuckDown, rogueDuckHold, rogueDuckUp, rogueMonsterDodge, sourceTraceWorld } from "./rogue-common.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import { chickFrame, chickMoves } from "./tables/rogue-chick.ts";

/** Both original callbacks share the sight/feet prediction and three blind-fire traces. */
function rocket(context: MonsterContext, flash: number, headChance: number, blindOffset: number): undefined {
  const { entity, game, state } = context, enemy = enemyBody(context);
  if (enemy === null || entity.enemy === null) return undefined;
  const start = projectFlash(context, muzzleOffset(game.options.edition, flash)), right = anglesVectors(game.body(entity).angles).right;
  const speed = 500 + 100 * game.options.skill, blind = state.manualSteering, target = blind ? state.blindFireTarget : enemy.origin;
  let point = blind ? target : { ...target, z: game.host.random() < headChance || start.z < enemy.origin.z + enemy.bounds.min.z ? target.z + (game.entity(entity.enemy)?.viewHeight ?? 22) : enemy.origin.z + enemy.bounds.min.z };
  if (!blind && game.host.random() < 0.2 + (3 - game.options.skill) * 0.15) point = add(point, scale(enemy.velocity, length(subtract(point, start)) / speed));
  const traceTo = (end: typeof point) => game.host.trace({ start, end, bounds: null, ignore: entity.actor.id, mask: 0x6000003 });
  let trace = traceTo(point);
  if (blind) {
    if (trace.startSolid || trace.allSolid || trace.fraction < 0.5) {
      point = add(target, scale(right, -blindOffset)); trace = traceTo(point);
      if (trace.startSolid || trace.allSolid || trace.fraction < 0.5) {
        point = add(target, scale(right, blindOffset)); trace = traceTo(point);
        if (trace.startSolid || trace.allSolid || trace.fraction < 0.5) return undefined;
      }
    }
  } else {
    // Both source callbacks perform this second trace, then use the Chick flash even for a Tank.
    trace = traceTo(point);
    if (!(trace.hit.kind === "actor" && trace.hit.actor === entity.enemy || sourceTraceWorld(game, trace)) || !(trace.fraction > 0.5 || trace.hit.kind === "actor" && game.host.isPlayer(trace.hit.actor))) return undefined;
  }
  const direction = normalize(subtract(point, start));
  context.weapons.fireRocket(entity, game, start, direction, 50, speed, 70, 50);
  return monsterFlash(context, blind ? flash : 57, start, direction);
}
function blindChance(context: MonsterContext): number { return context.state.blindFireDelay < 1 ? 1 : context.state.blindFireDelay < 7.5 ? 0.4 : 0.1; }
function zeroTarget(context: MonsterContext): boolean { const point = context.state.blindFireTarget; return point.x === 0 && point.y === 0 && point.z === 0; }

export function createRogueArsenalMonsters(monsters: Q2Monsters, source: Q2MissionPackMonsterState): readonly Q2MonsterDefinition[] {
  const machineGun = tankDefinition.callbacks["TankMachineGun"];
  if (machineGun === undefined) throw new Error("Base Tank is missing its source machine gun callback");
  const blocked = (context: MonsterContext, distance: number): boolean => rogueBlockedCheckShot(context, 0.25 + 0.05 * context.game.options.skill, source) || blockedCheckPlatform(context, distance);
  const tank: Q2MonsterDefinition = {
    ...tankDefinition, blindFire: true, blocked,
    initialize(context) { context.state.ignoreShots = true; return undefined; },
    pain(context, reaction) {
      const { entity, game, state } = context;
      if (health(game, entity.actor.id) < entity.maxHealth / 2) entity.skin |= 1;
      if (reaction.damage <= 10 || game.host.now() < state.painTime || reaction.damage <= 30 && game.host.random() > 0.2) return undefined;
      const frame = entity.frame;
      if (game.options.skill >= 2 && (frame >= tankFrame.attak301 && frame <= tankFrame.attak330 || frame >= tankFrame.attak101 && frame <= tankFrame.attak116)) return undefined;
      state.painTime = game.host.now() + 3; game.sound(entity, "tank/tnkpain2.wav", 2);
      if (game.options.skill === 3) return undefined;
      state.manualSteering = false;
      return context.setMove(reaction.damage <= 30 ? "tank_move_pain1" : reaction.damage <= 60 ? "tank_move_pain2" : "tank_move_pain3");
    },
    attack(context) {
      const { entity, game, state } = context;
      if (entity.enemy === null || !game.host.actors.isLive(entity.enemy)) return undefined;
      if (health(game, entity.enemy) < 0) { state.brutal = false; return context.setMove("tank_move_attack_strike"); }
      if (state.attackState !== "blind") return tankDefinition.attack(context);
      const chance = blindChance(context), random = game.host.random();
      state.blindFireDelay += 5.2 + game.host.random() * 3;
      if (zeroTarget(context) || random > chance) return undefined;
      state.manualSteering = true; context.setMove("tank_move_attack_fire_rocket");
      state.attackFinished = game.host.now() + 3 + 2 * game.host.random(); state.painTime = game.host.now() + 5;
      return undefined;
    },
    callbacks: { ...tankDefinition.callbacks,
      TankRocket(context) { return rocket(context, context.entity.frame === tankFrame.attak324 ? 23 : context.entity.frame === tankFrame.attak327 ? 24 : 25, 0.66, 20); },
      TankMachineGun(context) { return enemyBody(context) === null ? undefined : machineGun(context); },
      tank_refire_rocket(context) {
        if (context.state.manualSteering) { context.state.manualSteering = false; return context.setMove("tank_move_attack_post_rocket"); }
        return context.setMove(context.game.options.skill >= 2 && aliveEnemy(context) && visible(context) && context.game.host.random() <= 0.4 ? "tank_move_attack_fire_rocket" : "tank_move_attack_post_rocket");
      },
    },
  };
  function chickRun(context: MonsterContext): undefined { finishDodge(context); return chickDefinition.run(context); }
  function chickShooting(context: MonsterContext): boolean { return context.state.move.name === "chick_move_start_attack1" || context.state.move.name === "chick_move_attack1"; }
  function duck(context: MonsterContext, eta: number): undefined {
    if (chickShooting(context) && context.game.options.skill !== 0) { context.state.ducked = false; return undefined; }
    context.state.duckWait = context.game.host.now() + eta + (context.game.options.skill === 0 ? 1 : 0.1 * (3 - context.game.options.skill));
    rogueDuckDown(context); context.state.nextFrame = chickFrame.duck01;
    return context.setMove("chick_move_duck");
  }
  function sidestep(context: MonsterContext): undefined {
    if (chickShooting(context) && context.game.options.skill !== 0) { context.state.dodging = false; return undefined; }
    return context.state.move.name === "chick_move_run" ? undefined : context.setMove("chick_move_run");
  }
  const chick: Q2MonsterDefinition = {
    ...chickDefinition, model: "models/monsters/bitch2/tris.md2", moves: chickMoves, run: chickRun, blocked, blindFire: true,
    attack(context) {
      finishDodge(context);
      const { game, state } = context;
      if (state.attackState === "blind") {
        const chance = blindChance(context), random = game.host.random(); state.blindFireDelay += 5.5 + game.host.random();
        if (zeroTarget(context) || random > chance) return undefined;
        state.manualSteering = true; context.setMove("chick_move_start_attack1"); state.attackFinished = game.host.now() + 2 * game.host.random(); return undefined;
      }
      return context.setMove("chick_move_start_attack1");
    },
    pain(context, reaction) {
      finishDodge(context); damagedSkin(context);
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      const random = context.game.host.random();
      context.game.sound(context.entity, random < 0.33 ? "chick/chkpain1.wav" : random < 0.66 ? "chick/chkpain2.wav" : "chick/chkpain3.wav", 2);
      if (context.game.options.skill === 3) return undefined;
      context.state.manualSteering = false;
      context.setMove(reaction.damage <= 10 ? "chick_move_pain1" : reaction.damage <= 25 ? "chick_move_pain2" : "chick_move_pain3");
      if (context.state.ducked) rogueDuckUp(context);
      return undefined;
    },
    dodge(context, attacker, eta, trace) { return rogueMonsterDodge(context, monsters, attacker, eta, trace, duck, sidestep); },
    duck(context, eta) { duck(context, eta); return true; }, sidestep(context) { sidestep(context); return true; },
    callbacks: { ...chickDefinition.callbacks, chick_run: chickRun,
      monster_duck_down: rogueDuckDown, monster_duck_hold: rogueDuckHold, monster_duck_up: rogueDuckUp,
      ChickRocket: context => rocket(context, 57, 0.33, 10),
      chick_rerocket(context) {
        if (context.state.manualSteering) { context.state.manualSteering = false; return context.setMove("chick_move_end_attack1"); }
        return context.setMove(aliveEnemy(context) && targetDistance(context) >= 80 && visible(context) && context.game.host.random() <= 0.6 + 0.05 * context.game.options.skill ? "chick_move_attack1" : "chick_move_end_attack1");
      },
    },
  };
  return [tank, { ...tank, classname: "monster_tank_commander", health: 1000, gibHealth: -225, initialize(context) { context.state.ignoreShots = true; context.entity.skin = 2; return undefined; } }, chick];
}
