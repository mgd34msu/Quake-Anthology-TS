/* Quake II rogue/g_combat.c and g_newai.c. ZeniMax Media, GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import { anglesVectors, health, visible } from "../../foundation/monsters/ai.ts";
import { dot, normalize, scale, subtract } from "../../foundation/fields.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import type { MonsterContext, Q2MonsterSourceCombatHooks } from "../../foundation/monsters/types.ts";
import type { Q2MissionPackMonsterState } from "./state.ts";
import type { Q2MissionPackMonsterServices } from "./types.ts";

export function rogueHealEffects(context: MonsterContext): undefined {
  const { entity, state, game } = context;
  entity.effects &= ~256; entity.renderFlags &= ~(1024 | 2048 | 4096);
  if (state.resurrecting) { entity.effects |= 256; entity.renderFlags |= 1024; }
  return game.show(entity);
}

export function cleanupRogueHealTarget(monsters: Q2Monsters, source: Q2MissionPackMonsterState, entity: Q2Entity, game: Q2GameServices): undefined {
  source.get(entity).healer = null;
  game.host.combat.setTraits(entity.actor, { canTakeDamage: true });
  const patient = monsters.context(entity.actor.id);
  if (patient !== null) { patient.state.canTakeDamage = true; patient.state.resurrecting = false; rogueHealEffects(patient); }
  return undefined;
}

export function createRogueCombatHooks(monsters: Q2Monsters, source: Q2MissionPackMonsterState, services: Q2MissionPackMonsterServices): Q2MonsterSourceCombatHooks {
  const isGoodGuy = (entity: Q2Entity): boolean => monsters.context(entity.actor.id)?.state.goodGuy ?? source.get(entity).goodGuy;
  function cleanup(context: MonsterContext): undefined {
    const target = context.game.entity(context.entity.enemy);
    if (target !== null) cleanupRogueHealTarget(monsters, source, target, context.game);
    context.state.medic = false;
    return undefined;
  }
  function targetTesla(context: MonsterContext, tesla: Q2Entity): undefined {
    const { entity, game, state } = context;
    if (state.medic) cleanup(context);
    if (entity.enemy !== null && game.host.isPlayer(entity.enemy)) source.get(entity).lastPlayerEnemy = entity.enemy;
    if (entity.enemy === tesla.actor.id) return undefined;
    state.oldEnemy = entity.enemy; entity.enemy = tesla.actor.id;
    if (!state.hasRangedAttack) return monsters.foundTarget(context);
    return health(game, entity.actor.id) > 0 ? context.attack() : undefined;
  }
  return {
    isGoodGuy,
    recoverEnemy(context) {
      const state = source.get(context.entity), actor = state.lastPlayerEnemy;
      if (actor === null || health(context.game, actor) <= 0) return null;
      state.lastPlayerEnemy = null; return actor;
    },
    beforeMove(context, displacement) {
      const { game, entity, state } = context, metadata = source.get(entity);
      if (health(game, entity.actor.id) <= 0) return { kind: "move", displacement };
      const current = services.badAreaEntity(entity.actor.id);
      if (current !== null) {
        metadata.badArea = current.actor.id;
        if (game.entity(entity.enemy)?.classname === "tesla") {
          const body = game.body(entity), forward = anglesVectors(body.angles).forward;
          const badDot = dot(forward, normalize(subtract(game.body(current).origin, body.origin))), moveDot = dot(forward, normalize(displacement));
          if (badDot < 0 && moveDot < 0 || badDot > 0 && moveDot > 0) return { kind: "move", displacement: scale(displacement, -1) };
        }
      } else if (metadata.badArea !== null) {
        metadata.badArea = null;
        if (state.oldEnemy !== null) { entity.enemy = state.oldEnemy; entity.goal = state.oldEnemy; monsters.foundTarget(context); return { kind: "handled" }; }
      }
      return { kind: "move", displacement };
    },
    acceptsGroundMove(context, origin) {
      const { entity, game } = context;
      if (health(game, entity.actor.id) <= 0 || source.get(entity).badArea !== null) return true;
      const area = services.badAreaEntity(entity.actor.id, origin);
      if (area === null) return true;
      const owner = game.entity(area.owner), enemy = game.entity(entity.enemy);
      if (owner?.classname === "tesla" && (enemy === null || enemy.classname !== "telsa" && (!game.host.isPlayer(enemy.actor.id) || !visible(context)))) {
        targetTesla(context, owner); source.get(entity).blocked = true;
      }
      return false;
    },
    beforeKilled(context) { if (context.state.medic) cleanup(context); return undefined; },
    beforeReact(context: MonsterContext, attacker: ActorId): boolean {
      const { entity, game, state } = context;
      const inflictor = game.entity(entity.lastAttack?.inflictor ?? null);
      if (inflictor?.classname === "tesla") {
        if (services.markTeslaArea(entity, inflictor)) targetTesla(context, inflictor);
        return true;
      }
      if (attacker === entity.actor.id || attacker === entity.enemy) return false;
      const other = game.entity(attacker);
      if (state.goodGuy && (game.host.isPlayer(attacker) || other !== null && isGoodGuy(other))) return false;
      const percent = health(game, entity.actor.id) / entity.maxHealth;
      if (entity.enemy !== null && state.targetAnger) {
        if (game.host.actors.isLive(entity.enemy) && percent > 0.33) return true;
        state.targetAnger = false;
      }
      if (entity.enemy !== null && state.medic) {
        if (game.host.actors.isLive(entity.enemy) && percent > 0.25) return true;
        cleanup(context);
      }
      return false;
    },
  };
}

export function rogueTargetAnger(monsters: Q2Monsters, source: Q2MissionPackMonsterState, entity: Q2Entity, target: Q2Entity, game: Q2GameServices): undefined {
  if (!game.host.actors.isLive(entity.actor.id) || !game.host.actors.isLive(target.actor.id)) return undefined;
  const targetContext = monsters.context(target.actor.id);
  if (targetContext !== null) targetContext.state.goodGuy = true;
  else source.get(target).goodGuy = true;
  const context = monsters.context(entity.actor.id);
  if (context === null) return undefined;
  entity.enemy = target.actor.id; context.state.targetAnger = true;
  return monsters.foundTarget(context);
}
