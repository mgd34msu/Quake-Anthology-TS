/* Original Rogue m_widow.c and g_newai.c. ZeniMax Media, GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import type { Bounds, Vec3 } from "../../../../../contracts/math.ts";
import { add, scale } from "../../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../../foundation/host.ts";
import { anglesVectors, health, visible } from "../../../foundation/monsters/ai.ts";
import type { Q2Monsters } from "../../../foundation/monsters/index.ts";
import type { MonsterContext } from "../../../foundation/monsters/types.ts";
import { recordAt } from "../../../foundation/monsters/types.ts";
import { monsterPowerArmor, restoreMonsterPowerArmor } from "../power-armor.ts";
import { createRogueGroundMonster, findRogueSpawnPoint, rogueSpawnGrow } from "../spawn.ts";
import type { Q2MissionPackMonsterState } from "../state.ts";
import type { Q2MissionPackMonsterServices } from "../types.ts";

const stalkerBounds: Bounds = { min: { x: -28, y: -28, z: -18 }, max: { x: 28, y: 28, z: 18 } };
export function widowProject(entity: Q2Entity, game: Q2GameServices, offset: Vec3): Vec3 {
  const body = game.body(entity), axes = anglesVectors(body.angles);
  return add(body.origin, add(scale(axes.forward, offset.x), add(scale(axes.right, offset.y), scale(axes.up, offset.z))));
}
export function widowSlots(context: MonsterContext): undefined {
  const { game, state } = context, skill = game.options.skill;
  state.monsterSlots = skill < 2 ? 3 : skill === 2 ? 4 : 6;
  if (game.options.mode === "coop") state.monsterSlots = Math.min(6, state.monsterSlots + skill * (game.host.players().filter(actor => game.host.actors.isLive(actor) && game.host.isPlayer(actor)).length - 1));
  return undefined;
}
export function widowSlotsLeft(context: MonsterContext): number { return context.state.monsterSlots - context.state.monsterUsed; }
function coopTarget(context: MonsterContext): ActorId | null {
  const candidates = context.game.host.players().filter(actor => context.game.host.actors.isLive(actor) && context.game.host.isPlayer(actor) && visible(context, actor));
  return candidates.length === 0 ? null : recordAt(candidates, Math.min(candidates.length - 1, Math.floor(context.game.host.random() * candidates.length)));
}
export function widowSummon(context: MonsterContext, monsters: Q2Monsters, second: boolean, grow: boolean): undefined {
  const { entity, game, state } = context;
  for (const side of [1, -1]) {
    const point = findRogueSpawnPoint(game, widowProject(entity, game, { x: 30, y: side * (second ? 135 : 100), z: second ? 0 : 16 }), stalkerBounds, 64);
    if (point === null) continue;
    if (grow) { rogueSpawnGrow(game, point, 1); continue; }
    const child = createRogueGroundMonster(monsters, game, point, game.body(entity).angles, stalkerBounds, "monster_stalker", 256);
    if (child === null) continue;
    const childContext = monsters.context(child.actor.id);
    if (childContext === null) throw new Error("Widow child lacks its shared monster controller");
    state.monsterUsed++; childContext.state.commander = entity.actor.id;
    child.nextThink = game.host.now(); child.think?.(child, game);
    childContext.state.spawnedBy = "widow"; childContext.state.doNotCount = true; childContext.state.ignoreShots = true;
    let target = entity.enemy;
    if (game.options.mode === "coop") { target = coopTarget(childContext); if (target !== null && entity.enemy !== null && target.equals(entity.enemy)) target = coopTarget(childContext); target ??= entity.enemy; }
    if (target !== null && game.host.actors.isLive(target) && health(game, target) > 0) { child.enemy = target; monsters.foundTarget(childContext); childContext.attack(); }
  }
  return undefined;
}
export function widowClearPowerups(context: MonsterContext, source: Q2MissionPackMonsterState): undefined {
  const power = source.get(context.entity);
  power.widowQuadUntil = 0; power.widowDoubleUntil = 0; power.widowInvulnerableUntil = 0;
  context.entity.effects &= ~(32768 | 65536 | 134217728);
  return context.game.host.combat.setTraits(context.entity.actor, { invulnerable: false });
}
export function widowPowerups(context: MonsterContext, services: Q2MissionPackMonsterServices, source: Q2MissionPackMonsterState): undefined {
  const { entity, game } = context, now = game.host.now(), skill = game.options.skill, own = source.get(entity);
  const shown = (until: number): boolean => { const remaining = Math.round((until - now) * 10); return remaining > 0 && (remaining > 30 || (remaining & 4) !== 0); };
  function armor(): undefined { if (game.host.inventory.count(entity.actor.id, "q2:monster-power") <= 0) monsterPowerArmor(context, "shield", 250 * skill); return undefined; }
  function respond(actor: ActorId): undefined {
    const other = services.powerups(actor);
    if (shown(other.quadUntil)) {
      if (skill === 1) { own.widowDoubleUntil = other.quadUntil; source.widowDamageMultiplier = 2; }
      else if (skill >= 2) { own.widowQuadUntil = other.quadUntil; source.widowDamageMultiplier = 4; if (skill === 3) armor(); }
    } else if (shown(other.doubleUntil)) {
      if (skill >= 2) { own.widowDoubleUntil = other.doubleUntil; source.widowDamageMultiplier = 2; if (skill === 3) armor(); }
    } else source.widowDamageMultiplier = 1;
    if (shown(other.invulnerabilityUntil)) {
      if (skill === 1) armor();
      else if (skill >= 2) { own.widowInvulnerableUntil = other.invulnerabilityUntil; if (skill === 3) armor(); }
    }
    return undefined;
  }
  if (game.options.mode !== "coop") { if (entity.enemy !== null) respond(entity.enemy); }
  else {
    const players = game.host.players().filter(actor => game.host.actors.isLive(actor) && game.host.isPlayer(actor));
    for (const field of ["invulnerabilityUntil", "quadUntil", "doubleUntil"] satisfies readonly (keyof ReturnType<Q2MissionPackMonsterServices["powerups"]>)[]) {
      const player = players.find(actor => shown(services.powerups(actor)[field]));
      if (player !== undefined) { respond(player); break; }
    }
  }
  game.host.combat.setTraits(entity.actor, { invulnerable: own.widowInvulnerableUntil > now });
  return undefined;
}
export function widowPowerThink(monsters: Q2Monsters, source: Q2MissionPackMonsterState): Q2Think {
  return (entity, game) => {
    const context = monsters.context(entity.actor.id); if (context === null) return undefined;
    const power = source.get(entity), now = game.host.now();
    entity.effects &= ~(32768 | 65536 | 134217728);
    if (health(game, entity.actor.id) > 0) {
      for (const [until, flag] of [[power.widowQuadUntil, 32768], [power.widowDoubleUntil, 134217728], [power.widowInvulnerableUntil, 65536]] satisfies readonly (readonly [number, number])[]) {
        const remaining = Math.round((until - now) * 10);
        if (remaining > 0 && (remaining > 30 || (remaining & 4) !== 0)) entity.effects |= flag;
      }
    }
    return game.host.combat.setTraits(entity.actor, { invulnerable: power.widowInvulnerableUntil > now });
  };
}
export function widowRestoreArmor(context: MonsterContext): undefined {
  if (context.game.host.inventory.entries(context.entity.actor.id).some(entry => entry.item === "q2:monster-power")) restoreMonsterPowerArmor(context);
  return undefined;
}
