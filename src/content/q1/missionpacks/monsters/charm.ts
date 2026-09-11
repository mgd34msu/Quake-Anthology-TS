/* Hipnotic ai.qc HuntCharmer, FleeCharmer and charmed target selection. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { POINT, dot, length, normalize, vadd, vscale, vsub, yawFor } from "../../foundation/types.ts";
import { number, radiusActors } from "./helpers.ts";
import type { MissionMonster } from "./runtime.ts";

export function charmer(monster: MissionMonster): ActorId | null { return monster.entity.number("charmed") === 0 ? null : monster.entity.references.get("charmer") ?? null; }
function updateGoal(monster: MissionMonster): Q1Actor | null {
  const { game, entity } = monster, owner = charmer(monster), body = owner === null ? null : game.host.bodies.read(owner);
  if (body === null) return null;
  let goal = game.entity(entity.references.get("trigger_field") ?? null);
  if (entity.number("huntingcharmer") === 1) {
    goal = game.create("charmed_goal"); entity.references.set("trigger_field", goal.actor.id); game.setOrigin(goal, body.origin); number(monster, "huntingcharmer", 2); entity.references.set("goalentity", goal.actor.id);
  }
  if (goal === null) return null;
  if (entity.number("huntingcharmer") === 2) {
    if (game.host.trace({ start: monster.origin, end: body.origin, bounds: POINT, ignore: entity.actor.id, monsters: false }).fraction === 1) game.setOrigin(goal, body.origin);
  } else game.setOrigin(goal, vadd(body.origin, vscale(normalize(vsub(monster.origin, body.origin)), 300)));
  return goal;
}
export function huntCharmer(monster: MissionMonster, flee = false): undefined {
  number(monster, "huntingcharmer", 1); const goal = updateGoal(monster);
  if (flee) number(monster, "huntingcharmer", 3);
  else if (goal !== null) monster.entity.idealYaw = yawFor(vsub(monster.game.body(goal).origin, monster.origin));
  monster.nextFrame = monster.spec.walk; return monster.delay(0.1);
}
function stopHunting(monster: MissionMonster): undefined {
  const goal = monster.game.entity(monster.entity.references.get("trigger_field") ?? null);
  if (monster.entity.number("huntingcharmer") > 1 && goal !== null) monster.game.remove(goal);
  monster.entity.references.set("goalentity", null); number(monster, "huntingcharmer", 0); monster.nextFrame = monster.spec.stand;
  return monster.delay(0.1);
}
export function findCharmedTarget(monster: MissionMonster): boolean | null {
  const owner = charmer(monster);
  if (owner === null) return null;
  const { game, entity } = monster, ownerBody = game.host.bodies.read(owner);
  if (ownerBody === null) return false;
  entity.effects |= 8;
  if (entity.number("huntingcharmer") > 0) {
    const goal = updateGoal(monster), distance = goal === null ? Infinity : length(vsub(monster.origin, game.body(goal).origin));
    if (distance < 150) {
      if (entity.number("huntingcharmer") === 3 && distance > 120) return false;
      stopHunting(monster); return true;
    }
  } else if (length(vsub(monster.origin, ownerBody.origin)) > 200) { huntCharmer(monster); return false; }
  else if (length(vsub(monster.origin, ownerBody.origin)) < 120) { huntCharmer(monster, true); return false; }
  let selected: ActorId | null = null, distance = 1500;
  for (const actor of radiusActors(game, monster.origin, 1500)) {
    const candidate = game.entity(actor), body = game.host.bodies.read(actor);
    if (candidate === null || body === null || (candidate.movementFlags & 128) !== 0 || (candidate.movementFlags & 32) === 0 || actor === entity.actor.id || actor === owner || candidate.references.get("charmer") === owner || game.health(actor) <= 0 || !monster.visible(actor)) continue;
    const range = monster.rangeDistance(actor);
    if (range < distance) { selected = actor; distance = range; }
  }
  if (selected === null || selected === monster.enemy || distance >= 1000 || (game.player(selected)?.powerups.get("invisibility") ?? 0) > game.time) return false;
  monster.found(selected); return true;
}
export function findHipnoticTarget(monster: MissionMonster): boolean {
  const { game, entity } = monster;
  let candidate: ActorId | null;
  if (game.sightEntity !== null && game.sightTime >= game.time - 0.1 && (entity.spawnflags & 3) === 0) {
    if (game.sightEntity.monster?.enemy === monster.enemy) return false;
    candidate = game.sightEntity.actor.id;
  } else candidate = game.host.checkClient(entity.actor);
  if (candidate === null || candidate === monster.enemy) return false;
  const target = game.entity(candidate), body = game.host.bodies.read(candidate);
  if (body === null || ((target?.movementFlags ?? 0) & 128) !== 0 || (game.player(candidate)?.powerups.get("invisibility") ?? 0) > game.time) return false;
  const distance = monster.rangeDistance(candidate); if (distance >= 1000 || !monster.visible(candidate)) return false;
  if (distance >= 120) {
    const hostile = game.player(candidate)?.hostileUntil ?? target?.number("show_hostile") ?? 0;
    if ((distance >= 500 || hostile < game.time) && dot(normalize(vsub(body.origin, monster.origin)), game.makeVectors(game.body(entity).angles).forward) <= 0.3) return false;
  }
  if ((target?.number("charmed") ?? 0) === 0 && !game.isPlayer(candidate)) {
    candidate = target?.monster?.enemy ?? null;
    if (candidate === null || !game.isPlayer(candidate)) return false;
  }
  monster.found(candidate); return true;
}
export function walkWithCharmer(monster: MissionMonster, distance: number): boolean {
  if (charmer(monster) === null) return false;
  if (monster.findTarget()) return true;
  const goal = monster.game.entity(monster.entity.references.get("goalentity") ?? null) ?? monster.game.find(monster.state.path)[0];
  if (goal !== null && goal !== undefined) monster.game.host.moveToGoal(monster.entity.actor, goal.actor.id, distance);
  if (monster.entity.number("huntingcharmer") !== 0) monster.delay((monster.entity.nextThink - monster.game.time) / 2);
  return true;
}
