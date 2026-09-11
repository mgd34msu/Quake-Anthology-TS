/* Quake II m_actor.c. id Software, GPL-2.0-or-later. */
import { add, integerField, movedir, normalize, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule } from "../../foundation/host.ts";
import { anglesVectors, enemyBody, health, projectFlash, vectorAngles } from "../../foundation/monsters/ai.ts";
import { throwGib, throwHead } from "../../foundation/monsters/gibs.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";
import { recordAt } from "../../foundation/monsters/types.ts";
import { damagedSkin, finishCorpse, humanoidBounds, move, muzzle } from "./common.ts";
import { actorFrame, actorMoves } from "./tables/actor.ts";

const actorNames = ["Hellrot", "Tokay", "Killme", "Disruptor", "Adrianator", "Rambear", "Titus", "Bitterman"];
export function actorName(entity: Q2Entity, game: Q2GameServices): string { return recordAt(actorNames, (game.host.actors.sourceOf(entity.actor.id)?.slot ?? entity.actor.id.slot) % 8); }
function stand(context: MonsterContext): undefined {
  context.setMove("actor_move_stand");
  if (context.game.host.now() < 1) context.entity.frame = actorFrame.stand101 + Math.floor(context.game.host.random() * (actorFrame.stand140 - actorFrame.stand101 + 1));
  return undefined;
}
function run(context: MonsterContext): undefined {
  if (context.game.host.now() < context.state.painTime && context.entity.enemy === null) return context.state.moveTarget !== null ? context.setMove("actor_move_walk") : stand(context);
  return context.state.standGround ? stand(context) : context.setMove("actor_move_run");
}
export const actorDefinition: Q2MonsterDefinition = {
  classname: "misc_actor", kind: "actor", model: "players/male/tris.md2", health: 100, gibHealth: -80, mass: 200, bounds: humanoidBounds, scale: 1,
  initialMove: "actor_move_stand", moves: actorMoves, stand, walk: move("actor_move_walk"), run,
  initialize(context) {
    const { entity, game, state } = context;
    if (entity.targetname === "" || entity.target === "") { game.host.diagnostic(`misc_actor requires target and targetname at ${JSON.stringify(game.body(entity).origin)}`); return game.remove(entity); }
    state.goodGuy = true;
    entity.maxHealth = integerField(entity.spawn, "health") || 100;
    game.host.combat.setHealth(entity.actor, entity.maxHealth);
    entity.use = () => {
      const target = game.pickTarget(entity.target);
      entity.goal = state.moveTarget = target?.actor.id ?? null;
      if (target === null || target.classname !== "target_actor") { game.host.diagnostic(`misc_actor has bad target ${entity.target}`); entity.target = ""; state.pauseTime = 100000000; return stand(context); }
      state.idealYaw = vectorAngles(subtract(game.body(target).origin, game.body(entity).origin)).y;
      game.move(entity, { angles: { ...game.body(entity).angles, y: state.idealYaw } });
      context.walk(); entity.target = "";
      return undefined;
    };
    return undefined;
  },
  attack(context) { context.setMove("actor_move_attack"); context.state.pauseTime = context.game.host.now() + (Math.floor(context.game.host.random() * 16) + 10) * 0.1; return undefined; },
  pain(context, reaction) {
    damagedSkin(context);
    if (context.game.host.now() < context.state.painTime) return undefined;
    context.state.painTime = context.game.host.now() + 3;
    if (reaction.attacker !== null && context.game.host.isPlayer(reaction.attacker) && context.game.host.random() < 0.4) {
      const other = context.game.host.bodies.read(reaction.attacker);
      if (other !== null) context.state.idealYaw = vectorAngles(subtract(other.origin, context.game.body(context.entity).origin)).y;
      context.setMove(context.game.host.random() < 0.5 ? "actor_move_flipoff" : "actor_move_taunt");
      const messages = ["Watch it", "#$@*&", "Idiot", "Check your targets"];
      return context.game.host.emit({ kind: "print", actor: reaction.attacker, level: "chat", text: `${actorName(context.entity, context.game)}: ${recordAt(messages, Math.floor(context.game.host.random() * 3))}!\n` });
    }
    const n = Math.floor(context.game.host.random() * 3);
    return context.setMove(n === 0 ? "actor_move_pain1" : n === 1 ? "actor_move_pain2" : "actor_move_pain3");
  },
  die(context, reaction) {
    const { entity, game, state } = context;
    if (health(game, entity.actor.id) <= -80) {
      for (let i = 0; i < 2; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
      throwHead(entity, game, "models/objects/gibs/head2/tris.md2", reaction.damage);
      state.dead = true; state.gibbed = true;
      return undefined;
    }
    if (state.dead) return undefined;
    state.dead = true; state.canTakeDamage = true; game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
    return context.setMove(game.host.random() < 0.5 ? "actor_move_death1" : "actor_move_death2");
  },
  callbacks: {
    actor_run: run, actor_dead: finishCorpse,
    actor_fire(context) {
      const { entity, game } = context, enemy = enemyBody(context), start = projectFlash(context, muzzleOffset(game.options.edition, 63));
      let direction = anglesVectors(game.body(entity).angles).forward;
      if (enemy !== null) {
        const target = health(game, entity.enemy) > 0 ? add(add(enemy.origin, scale(enemy.velocity, -0.2)), { x: 0, y: 0, z: game.entity(entity.enemy)?.viewHeight ?? 22 }) : { x: enemy.origin.x + enemy.bounds.min.x, y: enemy.origin.y + enemy.bounds.min.y, z: enemy.origin.z + (enemy.bounds.min.z + enemy.bounds.max.z) / 2 };
        direction = normalize(subtract(target, start));
      }
      context.weapons.fireBullet(entity, game, start, direction, 3, 4, 300, 500, 0);
      muzzle(context, 63, direction, start);
      context.state.holdFrame = game.host.now() < context.state.pauseTime;
      return undefined;
    },
  },
};

export function createActorTargetModule(monsters: Q2Monsters): Q2SpawnModule {
  return { spawn(entity, game) {
    if (entity.classname !== "target_actor") return false;
    if (entity.targetname === "") game.host.diagnostic(`target_actor has no targetname at ${JSON.stringify(game.body(entity).origin)}`);
    entity.serverFlags = 1; entity.visible = false;
    game.move(entity, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } });
    if ((entity.spawnflags & 1) !== 0) {
      entity.speed ||= 200;
      const angles = game.body(entity).angles;
      entity.movedir = { ...movedir({ ...angles, y: angles.y || 360 }), z: numberField(entity.spawn, "height") || 200 };
      game.move(entity, { angles: zero });
    }
    game.solid(entity, "trigger");
    entity.touch = (self, services, contact) => {
      const actor = services.entity(contact.other), context = monsters.context(contact.other);
      if (actor === null || context === null || context.state.moveTarget !== self.actor.id || actor.enemy !== null) return undefined;
      actor.goal = context.state.moveTarget = null;
      if (self.message !== "") for (const player of services.host.players()) services.host.emit({ kind: "print", actor: player, level: "chat", text: `${actorName(actor, services)}: ${self.message}\n` });
      if ((self.spawnflags & 1) !== 0) {
        const body = services.body(actor);
        services.move(actor, { velocity: { x: self.movedir.x * self.speed, y: self.movedir.y * self.speed, z: body.ground !== null ? self.movedir.z : body.velocity.z }, ground: null });
        if (body.ground !== null) services.sound(actor, "player/male/jump1.wav", 2);
      }
      const pathTarget = self.spawn.values.get("pathtarget") ?? "";
      if ((self.spawnflags & 2) === 0 && (self.spawnflags & 4) !== 0) {
        actor.enemy = services.pickTarget(pathTarget)?.actor.id ?? null;
        if (actor.enemy !== null) {
          actor.goal = actor.enemy;
          if ((self.spawnflags & 32) !== 0) context.state.brutal = true;
          if ((self.spawnflags & 16) !== 0) { context.state.standGround = true; stand(context); } else run(context);
        }
      }
      if ((self.spawnflags & 6) === 0 && pathTarget !== "") {
        const original = self.target; self.target = pathTarget;
        services.useTargets(self, actor.actor.id); self.target = original;
      }
      context.state.moveTarget = services.pickTarget(self.target)?.actor.id ?? null;
      actor.goal ??= context.state.moveTarget;
      if (context.state.moveTarget === null && actor.enemy === null) { context.state.pauseTime = services.host.now() + 100000000; return stand(context); }
      const goal = services.entity(context.state.moveTarget);
      if (goal !== null && actor.goal === goal.actor.id) context.state.idealYaw = vectorAngles(subtract(services.body(goal).origin, services.body(actor).origin)).y;
      return undefined;
    };
    return true;
  } };
}
