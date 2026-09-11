// Rerelease m_actor.cpp. ZeniMax Media, GPL-2.0.
import { actorDefinition, actorName } from "../../../base/monsters/actor.ts";
import { add, integerField, movedir, normalize, numberField, scale, subtract, zero } from "../../../foundation/fields.ts";
import type { Q2SpawnModule, Q2Touch, Q2Use } from "../../../foundation/host.ts";
import { anglesVectors, enemyBody, health, vectorAngles } from "../../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../../foundation/monsters/types.ts";
import { recordAt } from "../../../foundation/monsters/types.ts";
import { monsterFlash } from "../common.ts";
import { actorMoves } from "../tables/actor.ts";

const holdForever = Number(0x7fffffffffffffffn) / 1000;

function dead(context: MonsterContext): undefined {
  context.state.corpse = true; context.entity.serverFlags |= 2;
  context.game.move(context.entity, { bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } } });
  context.game.motion(context.entity, "toss"); return context.game.cancel(context.entity);
}
export function createRereleaseActorModule(monsters: Q2Monsters): { readonly definition: Q2MonsterDefinition; readonly targets: Q2SpawnModule } {
  const use: Q2Use = (entity, game) => {
    const context = monsters.context(entity.actor.id); if (context === null) return undefined;
    const target = game.pickTarget(entity.target); entity.goal = context.state.moveTarget = target?.actor.id ?? null;
    if (target === null || target.classname !== "target_actor") {
      game.host.diagnostic(`misc_actor has bad target ${entity.target}`); entity.target = ""; context.state.pauseTime = holdForever; return context.stand();
    }
    context.state.idealYaw = vectorAngles(subtract(game.body(target).origin, game.body(entity).origin)).y;
    game.move(entity, { angles: { ...game.body(entity).angles, y: context.state.idealYaw } });
    context.walk(); entity.target = ""; return undefined;
  };
  const touch: Q2Touch = (self, game, contact) => {
    const actor = game.entity(contact.other), context = monsters.context(contact.other);
    if (actor === null || context === null || context.state.moveTarget !== self.actor.id || actor.enemy !== null) return undefined;
    actor.goal = context.state.moveTarget = null;
    if (self.message !== "") for (const player of game.host.players()) game.host.emit({ kind: "print", actor: player, level: "chat", text: `${actorName(actor, game)}: ${self.message}\n` });
    if ((self.spawnflags & 1) !== 0) {
      const body = game.body(actor);
      game.move(actor, { velocity: { x: self.movedir.x * self.speed, y: self.movedir.y * self.speed, z: body.ground !== null ? self.movedir.z : body.velocity.z }, ground: null });
      if (body.ground !== null) game.sound(actor, "player/male/jump1.wav", 2);
    }
    const pathTarget = self.spawn.values.get("pathtarget") ?? "";
    if ((self.spawnflags & 2) === 0 && (self.spawnflags & 4) !== 0) {
      actor.enemy = game.pickTarget(pathTarget)?.actor.id ?? null;
      if (actor.enemy !== null) {
        actor.goal = actor.enemy;
        if ((self.spawnflags & 32) !== 0) context.state.brutal = true;
        if ((self.spawnflags & 16) !== 0) { context.state.standGround = true; context.stand(); } else context.run();
      }
    }
    if ((self.spawnflags & 6) === 0 && pathTarget !== "") { const original = self.target; self.target = pathTarget; game.useTargets(self, actor.actor.id); self.target = original; }
    context.state.moveTarget = game.pickTarget(self.target)?.actor.id ?? null; actor.goal ??= context.state.moveTarget;
    if (context.state.moveTarget === null && actor.enemy === null) { context.state.pauseTime = holdForever; return context.stand(); }
    const goal = game.entity(context.state.moveTarget);
    if (goal !== null && actor.goal === goal.actor.id) context.state.idealYaw = vectorAngles(subtract(game.body(goal).origin, game.body(actor).origin)).y;
    return undefined;
  };
  return {
    definition: {
      ...actorDefinition, moves: actorMoves, sourceCallbacks: { use: { "rerelease.actor.actor_use": use } },
      initialize(context) {
        const { entity, game, state } = context;
        if (entity.targetname === "" || entity.target === "") { game.host.diagnostic(`misc_actor requires target and targetname at ${JSON.stringify(game.body(entity).origin)}`); return game.remove(entity); }
        state.goodGuy = true; entity.maxHealth = integerField(entity.spawn, "health") || 100;
        game.host.combat.setHealth(entity.actor, entity.maxHealth); return undefined;
      },
      afterSpawn(context) { context.entity.use = use; return undefined; },
      attack(context) { context.setMove("actor_move_attack"); context.state.fireWait = context.game.host.now() + 1 + context.game.host.random() * 1.6; return undefined; },
      pain(context, reaction) {
        const { entity, game, state } = context;
        entity.skin = health(game, entity.actor.id) < entity.maxHealth / 2 ? 1 : 0;
        if (game.host.now() < state.painTime) return undefined;
        state.painTime = game.host.now() + 3;
        if (reaction.attacker !== null && game.host.isPlayer(reaction.attacker) && game.host.random() < 0.4) {
          const other = game.host.bodies.read(reaction.attacker);
          if (other !== null) state.idealYaw = vectorAngles(subtract(other.origin, game.body(entity).origin)).y;
          context.setMove(game.host.random() < 0.5 ? "actor_move_flipoff" : "actor_move_taunt");
          const message = recordAt(["Watch it", "#$@*&", "Idiot", "Check your targets"], Math.floor(game.host.random() * 4));
          return game.host.emit({ kind: "print", actor: reaction.attacker, level: "chat", text: `${actorName(entity, game)}: ${message}!\n` });
        }
        return context.setMove(`actor_move_pain${Math.floor(game.host.random() * 3) + 1}`);
      },
      callbacks: {
        ...actorDefinition.callbacks, actor_dead: dead,
        actor_fire(context) {
          const { entity, game, state } = context, body = game.body(entity), axes = anglesVectors(body.angles), offset = muzzleOffset("rerelease", 63), enemy = enemyBody(context);
          const start = add(add(add(body.origin, scale(axes.forward, offset.x)), scale(axes.right, offset.y)), { x: 0, y: 0, z: offset.z });
          let direction = axes.forward;
          if (enemy !== null) {
            const target = health(game, entity.enemy) > 0 ? add(add(enemy.origin, scale(enemy.velocity, -0.2)), { x: 0, y: 0, z: game.entity(entity.enemy)?.viewHeight ?? 22 })
              : { x: enemy.origin.x + enemy.bounds.min.x, y: enemy.origin.y + enemy.bounds.min.y, z: enemy.origin.z + (enemy.bounds.min.z + enemy.bounds.max.z) / 2 + 1 };
            direction = normalize(subtract(target, start));
          }
          context.weapons.fireBullet(entity, game, start, direction, 3, 4, 300, 500, 0); monsterFlash(context, 63, start, direction);
          state.holdFrame = game.host.now() < state.fireWait; return undefined;
        },
      },
    },
    targets: {
      callbacks: { touch: { "rerelease.actor.target_actor_touch": touch } },
      spawn(entity, game) {
        if (entity.classname !== "target_actor") return false;
        if (entity.targetname === "") game.host.diagnostic(`target_actor has no targetname at ${JSON.stringify(game.body(entity).origin)}`);
        entity.serverFlags = 1; entity.visible = false; entity.touch = touch;
        game.move(entity, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } });
        if ((entity.spawnflags & 1) !== 0) {
          entity.speed ||= 200;
          const angles = game.body(entity).angles;
          entity.movedir = { ...movedir({ ...angles, y: angles.y || 360 }), z: numberField(entity.spawn, "height") || 200 };
          game.move(entity, { angles: zero });
        }
        game.solid(entity, "trigger"); return true;
      },
    },
  };
}
