/* Quake II m_mutant.c. id Software, GPL-2.0-or-later. */
import { add, length, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, checkBottom, enemyBody, flyCheck, health, targetDistance } from "../../foundation/monsters/ai.ts";
import type { Q2Touch } from "../../foundation/host.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { aliveEnemy, beginDeath, damagedSkin, finishCorpse, move, sound, standardGib } from "./common.ts";
import { mutantFrame, mutantMoves } from "./tables/mutant.ts";

function run(context: MonsterContext): undefined { return context.setMove(context.state.standGround ? "mutant_move_stand" : "mutant_move_run"); }
function hit(context: MonsterContext, right: boolean): undefined {
  const bounds = context.game.body(context.entity).bounds;
  const connected = context.weapons.fireHit(context.entity, context.game, { x: 80, y: right ? bounds.max.x : bounds.min.x, z: 8 }, 10 + Math.floor(context.game.host.random() * 5), 100);
  return context.game.sound(context.entity, connected ? right ? "mutant/mutatck3.wav" : "mutant/mutatck2.wav" : "mutant/mutatck1.wav", 1);
}
export function createMutantDefinition(monsters: Q2Monsters, source: "classic" | "rogue" = "classic"): Q2MonsterDefinition {
  const touch: Q2Touch = (self, services, contact) => {
    const context = monsters.context(self.actor.id);
    if (context === null) throw new Error("Mutant jump has no source continuation");
    if (health(services, self.actor.id) <= 0) { self.touch = null; return undefined; }
    const current = services.body(self);
    if (services.host.combat.read(contact.other)?.canTakeDamage === true && length(current.velocity) > 400) {
      const normal = normalize(current.velocity), point = add(current.origin, scale(normal, current.bounds.max.x)), damage = Math.trunc(40 + 10 * services.host.random());
      services.damage(contact.other, self, self.actor.id, damage, damage, current.velocity, point, normal, 0);
    }
    if (!checkBottom(context, services.body(self).origin)) {
      if (services.body(self).ground !== null) { context.state.nextFrame = mutantFrame.attack02; self.touch = null; }
      return undefined;
    }
    self.touch = null;
    return undefined;
  };
  return {
    sourceCallbacks: { touch: { [`${source}_mutant_jump_touch`]: touch } },
    classname: "monster_mutant", kind: "mutant", model: "models/monsters/mutant/tris.md2", health: 300, gibHealth: -120, mass: 300,
    bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 48 } }, scale: 1,
    initialMove: "mutant_move_stand", moves: mutantMoves, stand: move("mutant_move_stand"), walk: move("mutant_move_start_walk"), run,
    attack: move("mutant_move_jump"), melee: move("mutant_move_attack"), sight: sound("mutant/mutsght1.wav"), search: sound("mutant/mutsrch1.wav"),
    idle(context) { context.setMove("mutant_move_idle"); return context.game.sound(context.entity, "mutant/mutidle1.wav", 2, 1, 2); },
    checkAttack(context) {
      if (!aliveEnemy(context)) return false;
      if (targetDistance(context) < 80) { context.state.attackState = "melee"; return true; }
      const enemy = enemyBody(context); if (enemy === null) return false;
      const body = context.game.body(context.entity), enemyMinimum = enemy.origin.z + enemy.bounds.min.z, enemySize = enemy.bounds.max.z - enemy.bounds.min.z;
      if (body.origin.z + body.bounds.min.z > enemyMinimum + 0.75 * enemySize || body.origin.z + body.bounds.max.z < enemyMinimum + 0.25 * enemySize) return false;
      const delta = subtract(body.origin, enemy.origin), distance = Math.hypot(delta.x, delta.y);
      if (distance < 100 || distance > 100 && context.game.host.random() < 0.9) return false;
      context.state.attackState = "missile";
      return true;
    },
    pain(context) {
      damagedSkin(context);
      if (context.game.host.now() < context.state.painTime) return undefined;
      context.state.painTime = context.game.host.now() + 3;
      if (context.game.options.skill === 3) return undefined;
      const r = context.game.host.random();
      context.game.sound(context.entity, r < 0.33 || r >= 0.66 ? "mutant/mutpain1.wav" : "mutant/mutpain2.wav", 2);
      return context.setMove(r < 0.33 ? "mutant_move_pain1" : r < 0.66 ? "mutant_move_pain2" : "mutant_move_pain3");
    },
    die(context, reaction) {
      if (standardGib(context, reaction) || context.state.dead) return undefined;
      context.entity.skin = 1;
      return beginDeath(context, reaction, "mutant/mutdeth1.wav", context.game.host.random() < 0.5 ? "mutant_move_death1" : "mutant_move_death2");
    },
    callbacks: {
      mutant_stand: move("mutant_move_stand"), mutant_walk: move("mutant_move_start_walk"), mutant_walk_loop: move("mutant_move_walk"), mutant_run: run,
      mutant_idle_loop(context) { if (context.game.host.random() < 0.75) context.state.nextFrame = mutantFrame.stand155; return undefined; },
      mutant_step(context) { const n = (Math.floor(context.game.host.random() * 3) + 1) % 3; return context.game.sound(context.entity, `mutant/step${n + 1}.wav`, 2); },
      mutant_hit_left(context) { return hit(context, false); }, mutant_hit_right(context) { return hit(context, true); },
      mutant_check_refire(context) { if (aliveEnemy(context) && (context.game.options.skill === 3 && context.game.host.random() < 0.5 || targetDistance(context) < 80)) context.state.nextFrame = mutantFrame.attack09; return undefined; },
      mutant_jump_takeoff(context) {
        const { entity, game, state } = context, body = game.body(entity), forward = anglesVectors(body.angles).forward;
        game.sound(entity, "mutant/mutsght1.wav", 2);
        game.move(entity, { origin: { ...body.origin, z: body.origin.z + 1 }, velocity: { ...scale(forward, 600), z: 250 }, ground: null });
        state.ducked = true; state.attackFinished = game.host.now() + 3;
        entity.touch = touch;
        return undefined;
      },
      mutant_check_landing(context) {
        if (context.game.body(context.entity).ground !== null) { context.game.sound(context.entity, "mutant/thud1.wav", 1); context.state.attackFinished = 0; context.state.ducked = false; return undefined; }
        context.state.nextFrame = context.game.host.now() > context.state.attackFinished ? mutantFrame.attack02 : mutantFrame.attack05;
        return undefined;
      },
      mutant_dead(context) { finishCorpse(context); return flyCheck(context); },
    },
  };
}
