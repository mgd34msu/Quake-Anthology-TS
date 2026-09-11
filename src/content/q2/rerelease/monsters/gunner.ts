// Rerelease m_gunner.cpp. ZeniMax Media, GPL-2.0.
import { add, length, normalize, numberField, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, clearShot, corpse, enemyBody, finishDodge, health, projectFlash, setDuck, targetDistance, vectorAngles, visible } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { gunnerDefinition } from "../../base/monsters/gunner.ts";
import { blockedCheckJump, blockedCheckPlatform, calculatePitchToFire, checkGib, monsterFlash, monsterJumpFinished, predictedDirection, reactsToPain } from "./common.ts";
import { gunnerFrame as frame, gunnerMoves } from "./tables/gunner.ts";
import { rereleaseFlash } from "./tables/flashes.ts";

function run(context: MonsterContext): undefined { finishDodge(context); return gunnerDefinition.run(context); }
function jumping(context: MonsterContext): boolean { return context.state.move.name === "gunner_move_jump" || context.state.move.name === "gunner_move_jump2"; }
function shooting(context: MonsterContext): boolean { return ["gunner_move_attack_chain", "gunner_move_fire_chain", "gunner_move_attack_grenade", "gunner_move_attack_grenade2"].includes(context.state.move.name); }
function grenadeCheck(context: MonsterContext): boolean {
  const enemy = enemyBody(context); if (enemy === null || !clearShot(context, muzzleOffset("rerelease", 53))) return false;
  const start = projectFlash(context, muzzleOffset("rerelease", 53)), target = context.state.manualSteering ? context.state.blindFireTarget : enemy.origin, delta = subtract(target, start);
  return length(delta) >= 100 && calculatePitchToFire(context, target, start, normalize(delta), 600, 2.5, false) !== null;
}
function grenade(context: MonsterContext): undefined {
  const { entity, game, state } = context, enemy = enemyBody(context); if (enemy === null) return undefined;
  const blind = state.manualSteering, current = entity.frame;
  let spread: number, id: number;
  if (current === frame.attak105 || current === frame.attak309) { spread = -0.1; id = 53; }
  else if (current === frame.attak108 || current === frame.attak312) { spread = -0.05; id = 54; }
  else if (current === frame.attak111 || current === frame.attak315) { spread = 0.05; id = 55; }
  else { state.manualSteering = false; spread = 0.1; id = 56; }
  if (current >= frame.attak301 && current <= frame.attak324) id = rereleaseFlash.GUNNER_GRENADE2_1 + 56 - id;
  const target = blind && !visible(context) ? state.blindFireTarget : enemy.origin;
  if (blind && !visible(context) && length(target) === 0) return undefined;
  const body = game.body(entity), axes = anglesVectors(body.angles), start = projectFlash(context, muzzleOffset("rerelease", id));
  let delta = subtract(target, body.origin); const distance = length(delta);
  if (distance > 512 && delta.z < 64 && delta.z > -64) delta = { ...delta, z: delta.z + distance - 512 };
  const pitch = Math.max(-0.5, Math.min(0.4, normalize(delta).z)), aim = add(add(axes.forward, scale(axes.right, spread)), scale(axes.up, pitch));
  const predicted = calculatePitchToFire(context, target, start, aim, 600, 2.5, false), right = (game.host.random() * 2 - 1) * 10, up = predicted === null ? 200 + (game.host.random() * 2 - 1) * 10 : game.host.random() * 10;
  const world = game.entity(game.host.worldActor());
  context.weapons.fireGrenade(entity, game, start, predicted ?? aim, 50, 600, 2.5, 90, false, false, true, { right, up, gravity: world === null ? 800 : numberField(world.spawn, "gravity", 800) });
  return monsterFlash(context, id, start, predicted ?? aim);
}
function jump(context: MonsterContext, up: boolean): undefined {
  const body = context.game.body(context.entity), axes = anglesVectors(body.angles);
  return context.game.move(context.entity, { velocity: add(body.velocity, add(scale(axes.forward, up ? 150 : 100), scale(axes.up, up ? 400 : 300))) });
}

export const rereleaseGunnerDefinition: Q2MonsterDefinition = {
  classname: "monster_gunner", kind: "gunner", model: "models/monsters/gunner/tris.md2", health: 175, gibHealth: -70, mass: 200, bounds: gunnerDefinition.bounds, scale: Math.fround(1.15),
  initialMove: "gunner_move_stand", moves: gunnerMoves, stand: gunnerDefinition.stand, walk: gunnerDefinition.walk, run, blindFire: true,
  sight: context => context.game.sound(context.entity, "gunner/sight1.wav", 2), search: context => context.game.sound(context.entity, "gunner/gunsrch1.wav", 2),
  attack(context) {
    const { game, entity, state } = context; finishDodge(context);
    if (state.attackState === "blind") {
      if (entity.timestamp > game.host.now()) return undefined;
      const chance = state.blindFireDelay < 1 ? 1 : state.blindFireDelay < 7.5 ? 0.4 : 0.1, choice = game.host.random(); state.blindFireDelay += 4.1 + game.host.random() * 3;
      if (length(state.blindFireTarget) === 0 || choice > chance) return undefined;
      state.manualSteering = true;
      if (grenadeCheck(context)) { context.setMove(game.host.random() < 0.5 ? "gunner_move_attack_grenade2" : "gunner_move_attack_grenade"); state.attackFinished = game.host.now() + game.host.random() * 2; }
      else state.manualSteering = false;
      entity.timestamp = game.host.now() + 2 + game.host.random(); return undefined;
    }
    if (entity.timestamp > game.host.now() || targetDistance(context) <= 175 && clearShot(context, muzzleOffset("rerelease", 45))) return context.setMove("gunner_move_attack_chain");
    if (entity.timestamp <= game.host.now() && game.host.random() <= 0.5 && grenadeCheck(context)) { context.setMove(game.host.random() < 0.5 ? "gunner_move_attack_grenade2" : "gunner_move_attack_grenade"); entity.timestamp = game.host.now() + 2 + game.host.random(); }
    else if (clearShot(context, muzzleOffset("rerelease", 45))) context.setMove("gunner_move_attack_chain");
    return undefined;
  },
  pain(context, reaction) {
    const { entity, game, state } = context; finishDodge(context);
    entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? entity.skin | 1 : entity.skin & ~1;
    if (jumping(context) || game.host.now() < state.painTime) return undefined;
    state.painTime = game.host.now() + 3; game.sound(entity, game.host.random() < 0.5 ? "gunner/gunpain2.wav" : "gunner/gunpain1.wav", 2);
    if (!reactsToPain(context)) return undefined;
    context.setMove(reaction.damage <= 10 ? "gunner_move_pain3" : reaction.damage <= 25 ? "gunner_move_pain2" : "gunner_move_pain1");
    state.manualSteering = false; if (state.ducked) setDuck(context, false); return undefined;
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    if (checkGib(context)) {
      game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
      for (let i = 0; i < 2; i++) { throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage); throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage); }
      for (const part of ["chest", "garm", "gun", "foot", "head"]) throwGib(entity, game, `models/monsters/gunner/gibs/${part}.md2`, reaction.damage, { skinned: true, upright: part === "garm" || part === "gun", head: part === "head" });
      state.dead = true; state.gibbed = true; return undefined;
    }
    if (state.dead) return undefined;
    game.sound(entity, "gunner/death1.wav", 2); state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true }); return context.setMove("gunner_move_death");
  },
  duck(context) { if (jumping(context)) return false; if (shooting(context)) { setDuck(context, false); return false; } if (context.game.host.random() > 0.5) grenade(context); context.setMove("gunner_move_duck"); return true; },
  sidestep(context) { if (jumping(context) || shooting(context) || context.state.move.name === "gunner_move_pain1") return false; if (context.state.move.name !== "gunner_move_run") context.setMove("gunner_move_run"); return true; },
  blocked(context, distance) { if (blockedCheckPlatform(context, distance)) return true; const result = blockedCheckJump(context, distance, 192, 40, (context.entity.spawnflags & 8) === 0); if (result === "none") return false; if (result !== "turn" && enemyBody(context) !== null) { finishDodge(context); context.setMove(result === "up" ? "gunner_move_jump2" : "gunner_move_jump"); } return true; },
  callbacks: {
    ...gunnerDefinition.callbacks, gunner_run: run, gunner_dead: corpse, GunnerGrenade: grenade,
    gunner_fidget(context) { if (!context.state.standGround && context.entity.enemy === null && context.game.host.random() <= 0.05) context.setMove("gunner_move_fidget"); return undefined; },
    gunner_shrink(context) { context.entity.serverFlags |= 2; const bounds = context.game.body(context.entity).bounds; return context.game.move(context.entity, { bounds: { min: bounds.min, max: { ...bounds.max, z: -4 } } }); },
    gunner_runandshoot: context => context.setMove("gunner_move_runandshoot"),
    gunner_blind_check(context) { if (context.state.manualSteering) context.state.idealYaw = vectorAngles(subtract(context.state.blindFireTarget, context.game.body(context.entity).origin)).y; return undefined; },
    GunnerFire(context) { if (enemyBody(context) === null) return undefined; const id = 45 + context.entity.frame - frame.attak216, start = projectFlash(context, muzzleOffset("rerelease", id)), direction = predictedDirection(context, start, 0, true, -0.2); if (direction === null) return undefined; context.weapons.fireBullet(context.entity, context.game, start, direction, 3, 4, 300, 500, 0); return monsterFlash(context, id, start, direction); },
    gunner_refire_chain(context) { return context.setMove(health(context.game, context.entity.enemy) > 0 && visible(context) && context.game.host.random() <= 0.5 ? "gunner_move_fire_chain" : "gunner_move_endfire_chain", false); },
    gunner_jump_now: context => jump(context, false), gunner_jump2_now: context => jump(context, true),
    gunner_jump_wait_land(context) { context.state.nextFrame = context.entity.frame + (context.game.body(context.entity).ground !== null || monsterJumpFinished(context) ? 1 : 0); return undefined; },
  },
};
