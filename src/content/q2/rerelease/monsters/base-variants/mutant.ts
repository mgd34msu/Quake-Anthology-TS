// Rerelease m_mutant.cpp. ZeniMax Media, GPL-2.0.
import { createMutantDefinition } from "../../../base/monsters/mutant.ts";
import { aliveEnemy } from "../../../base/monsters/common.ts";
import { add, length, normalize, scale, subtract } from "../../../foundation/fields.ts";
import type { Q2Touch } from "../../../foundation/host.ts";
import { anglesVectors, checkBottom, corpse, enemyBody, health, targetDistance, walkMove } from "../../../foundation/monsters/ai.ts";
import { throwGib } from "../../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { blockedCheckJump, blockedCheckPlatform, checkGib, monsterJumpFinished, reactsToPain } from "../common.ts";
import { mutantFrame, mutantMoves } from "../tables/mutant.ts";

function hit(context: MonsterContext, right: boolean): undefined {
  const { game, entity } = context, bounds = game.body(entity).bounds;
  const connected = context.weapons.fireHit(entity, game, { x: 80, y: right ? bounds.max.x : bounds.min.x, z: 8 }, 5 + Math.floor(game.host.random() * 10), 100);
  if (!connected) context.state.meleeTime = game.host.now() + 1.5;
  return game.sound(entity, connected ? right ? "mutant/mutatck3.wav" : "mutant/mutatck2.wav" : "mutant/mutatck1.wav", 1);
}
function jump(context: MonsterContext, up: boolean): undefined {
  const body = context.game.body(context.entity), axes = anglesVectors(body.angles);
  return context.game.move(context.entity, { velocity: add(body.velocity, add(scale(axes.forward, up ? 200 : 100), scale(axes.up, up ? 450 : 300))) });
}
export function createRereleaseMutantDefinition(monsters: Q2Monsters): Q2MonsterDefinition {
  const mutantDefinition = createMutantDefinition(monsters);
  const touch: Q2Touch = (entity, game, contact) => {
    const context = monsters.context(entity.actor.id); if (context === null) return undefined;
    if (health(game, entity.actor.id) <= 0) { entity.touch = null; return undefined; }
    const body = game.body(entity);
    if (entity.style === 1 && game.host.combat.read(contact.other)?.canTakeDamage === true && length(body.velocity) > 30) {
      const normal = normalize(body.velocity), point = add(body.origin, scale(normal, body.bounds.max.x)), damage = Math.trunc(40 + game.host.random() * 10);
      game.damage(contact.other, entity, entity.actor.id, damage, damage, body.velocity, point, normal, 0); entity.style = 0;
    }
    if (!checkBottom(context, game.body(entity).origin)) {
      if (game.body(entity).ground !== null) { context.state.nextFrame = mutantFrame.attack02; entity.touch = null; }
      return undefined;
    }
    entity.touch = null; return undefined;
  };
  return {
    ...mutantDefinition, moves: mutantMoves, sourceCallbacks: { touch: { mutant_jump_touch: touch } },
    ai: {
      ai_move_slide_right(context, distance) { walkMove(context, context.game.body(context.entity).angles.y + 90, distance); return undefined; },
      ai_move_slide_left(context, distance) { walkMove(context, context.game.body(context.entity).angles.y - 90, distance); return undefined; },
    },
    checkAttack(context) {
      const { state, entity, game } = context;
      if (!aliveEnemy(context)) return false;
      if (targetDistance(context) <= 80 && state.meleeTime <= game.host.now()) { state.attackState = "melee"; return true; }
      if ((entity.spawnflags & 8) !== 0) return false;
      const enemy = enemyBody(context); if (enemy === null) return false;
      const body = game.body(entity);
      if (body.origin.z + body.bounds.min.z + 125 < enemy.origin.z + enemy.bounds.min.z) return false;
      const delta = subtract(body.origin, enemy.origin), distance = Math.hypot(delta.x, delta.y);
      if (distance < 100 && state.meleeTime <= game.host.now() || distance > 265 || state.attackFinished >= game.host.now() || game.host.random() >= 0.5) return false;
      state.attackState = "missile"; return true;
    },
    pain(context) {
      const { entity, game, state } = context;
      entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
      if (game.host.now() < state.painTime) return undefined;
      state.painTime = game.host.now() + 3;
      const choice = game.host.random(); game.sound(entity, choice < 0.33 || choice >= 0.66 ? "mutant/mutpain1.wav" : "mutant/mutpain2.wav", 2);
      if (!reactsToPain(context)) return undefined;
      return context.setMove(choice < 0.33 ? "mutant_move_pain1" : choice < 0.66 ? "mutant_move_pain2" : "mutant_move_pain3");
    },
    die(context, reaction) {
      const { entity, game, state } = context;
      if (checkGib(context)) {
        game.sound(entity, "misc/udeath.wav", 2); entity.skin = Math.trunc(entity.skin / 2);
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
        for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/monsters/mutant/gibs/hand.md2", reaction.damage, { skinned: true, upright: true });
        for (let i = 0; i < 2; i++) throwGib(entity, game, "models/monsters/mutant/gibs/foot.md2", reaction.damage, { skinned: true });
        throwGib(entity, game, "models/monsters/mutant/gibs/chest.md2", reaction.damage, { skinned: true });
        throwGib(entity, game, "models/monsters/mutant/gibs/head.md2", reaction.damage, { skinned: true, head: true });
        state.dead = true; state.gibbed = true; return undefined;
      }
      if (state.dead) return undefined;
      game.sound(entity, "mutant/mutdeth1.wav", 2); state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
      return context.setMove(game.host.random() < 0.5 ? "mutant_move_death1" : "mutant_move_death2");
    },
    blocked(context, distance) {
      const result = blockedCheckJump(context, distance, 256, 68, (context.entity.spawnflags & 8) === 0);
      if (result !== "none") { if (result !== "turn" && context.entity.enemy !== null) context.setMove(result === "up" ? "mutant_move_jump_up" : "mutant_move_jump_down"); return true; }
      return blockedCheckPlatform(context, distance);
    },
    callbacks: {
      ...mutantDefinition.callbacks,
      mutant_step(context) { return context.game.sound(context.entity, `mutant/step${Math.floor(context.game.host.random() * 3) + 1}.wav`, 4); },
      mutant_hit_left: context => hit(context, false), mutant_hit_right: context => hit(context, true),
      mutant_check_refire(context) {
        if (aliveEnemy(context) && context.state.meleeTime <= context.game.host.now() && (context.game.host.random() < 0.5 || targetDistance(context) <= 80)) context.state.nextFrame = mutantFrame.attack09;
        return undefined;
      },
      mutant_jump_takeoff(context) {
        const { entity, game, state } = context, body = game.body(entity), forward = anglesVectors(body.angles).forward;
        game.sound(entity, "mutant/mutsght1.wav", 2);
        game.move(entity, { origin: { ...body.origin, z: body.origin.z + 1 }, velocity: { ...scale(forward, 425), z: 160 }, ground: null });
        state.ducked = true; state.attackFinished = game.host.now() + 3; entity.style = 1; entity.touch = touch; return undefined;
      },
      mutant_check_landing(context) {
        monsterJumpFinished(context);
        if (context.game.body(context.entity).ground !== null) {
          context.game.sound(context.entity, "mutant/thud1.wav", 1); context.state.attackFinished = context.game.host.now() + 0.5 + context.game.host.random();
          if (targetDistance(context) <= 160) context.melee(); return undefined;
        }
        context.state.nextFrame = context.game.host.now() > context.state.attackFinished ? mutantFrame.attack02 : mutantFrame.attack05; return undefined;
      },
      mutant_jump_down: context => jump(context, false), mutant_jump_up: context => jump(context, true),
      mutant_jump_wait_land(context) { context.state.nextFrame = !monsterJumpFinished(context) && context.game.body(context.entity).ground === null ? context.entity.frame : context.entity.frame + 1; return undefined; },
      mutant_shrink(context) { const body = context.game.body(context.entity); context.entity.serverFlags |= 2; return context.game.move(context.entity, { bounds: { ...body.bounds, max: { ...body.bounds.max, z: 0 } } }); },
      monster_dead(context) { const bounds = context.game.body(context.entity).bounds; corpse(context); return context.game.move(context.entity, { bounds }); },
    },
  };
}
