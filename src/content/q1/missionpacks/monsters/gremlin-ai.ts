/* hipgrem.qc corpse search, victim selection and evasive goals. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { POINT, length, normalize, vadd, vscale, vsub, yawFor } from "../../foundation/types.ts";
import { velocityAngles } from "../types.ts";
import type { MissionMonster } from "./runtime.ts";
import { number, radiusActors } from "./helpers.ts";
import { gremlinHasAmmo } from "./gremlin-weapons.ts";

export function gremlinFindVictim(monster: MissionMonster): ActorId | null {
  const { game, entity } = monster; monster.state.searchUntil = game.time + 1;
  let selected: ActorId | null = null, distance = 1000;
  for (const actor of radiusActors(game, monster.origin, 1000)) {
    const other = game.entity(actor), flags = (other?.movementFlags ?? 0) | (game.isPlayer(actor) ? 8 : 0), body = game.host.bodies.read(actor);
    if ((flags & 128) !== 0 || (flags & (32 | 8)) === 0 || !monster.visible(actor) || game.health(actor) <= 0 || actor === entity.actor.id || body === null) continue;
    let range = length(vsub(body.origin, monster.origin));
    if (actor === entity.references.get("lastvictim")) range *= 2;
    if ((flags & 8) !== 0) range /= 1.5;
    if (other?.classname === entity.classname) range *= 1.5;
    if (range < distance) { distance = range; selected = actor; }
  }
  entity.references.set("lastvictim", selected); return selected;
}
export function gremlinFindTarget(monster: MissionMonster): boolean {
  const { game, entity } = monster;
  if (entity.number("stoleweapon") === 0 && game.time > entity.wait) {
    entity.wait = game.time + 1; let distance = 2000, gorge: ActorId | null = null;
    for (const actor of game.host.actors.observations()) {
      const other = game.entity(actor.id), body = game.host.bodies.read(actor.id), flags = (other?.movementFlags ?? 0) | (game.isPlayer(actor.id) ? 8 : 0);
      if (body === null || game.health(actor.id) >= 1 || (flags & (32 | 8)) === 0) continue;
      const vertical = Math.abs(body.origin.z - monster.origin.z), visible = monster.visible(actor.id), start = monster.eye(), end = monster.eye(actor.id);
      const range = start === null || end === null ? Infinity : length(vsub(end, start));
      if (visible && vertical < 80 && (other?.number("gorging") ?? 0) === 0 && range < distance) { distance = range; gorge = actor.id; }
    }
    if (gorge !== null && distance < 700 * game.host.random()) {
      monster.state.oldEnemy = monster.enemy; number(monster, "gorging", 1); monster.enemy = gorge; monster.state.searchUntil = game.time + 4;
      monster.found(gorge); return true;
    }
  } else if (entity.number("stoleweapon") !== 0) {
    const victim = gremlinFindVictim(monster);
    if (victim !== null) { monster.found(victim); monster.state.attackFinished = game.time; monster.state.searchUntil = game.time + 2; return true; }
  }
  const found = monster.findTarget(); monster.state.searchUntil = game.time + 2; return found;
}
export function gremlinWalk(monster: MissionMonster, distance: number): undefined {
  if (gremlinFindTarget(monster)) return undefined;
  const { game, entity } = monster, goal = game.entity(entity.references.get("goalentity") ?? null) ?? game.find(monster.state.path)[0];
  if (goal !== undefined && goal !== null) game.host.moveToGoal(entity.actor, goal.actor.id, distance);
  return undefined;
}
export function gremlinStand(monster: MissionMonster): undefined {
  if (monster.findTarget()) return undefined;
  if (monster.game.time > monster.state.pauseUntil) return monster.play("gremlin_walk1");
  return undefined;
}
export function gremlinRun(monster: MissionMonster, distance: number): undefined {
  const { game, entity } = monster;
  if (entity.waterType === -5) game.damage(entity.actor.id, game.world?.actor.id ?? entity.actor.id, game.world?.actor.id ?? null, 2000);
  if (entity.number("stoleweapon") !== 0) entity.frame += 164 - 29;
  const target = monster.target;
  if (target === null) return monster.ai("run", distance);
  if (entity.number("gorging") !== 0) {
    if (game.host.trace({ start: monster.origin, end: target, bounds: POINT, ignore: entity.actor.id, monsters: false }).fraction !== 1 || !monster.visible()) { number(monster, "gorging", 0); return undefined; }
    const range = monster.distance;
    if (range < 130) {
      monster.face(); if (range < 45) { monster.meleeAttack(); entity.attackState = "straight"; return undefined; }
      if (!game.host.walkMove(entity.actor, game.body(entity).angles.y, distance)) number(monster, "gorging", 0);
      return undefined;
    }
    if (monster.enemy !== null) game.host.moveToGoal(entity.actor, monster.enemy, distance);
    return undefined;
  }
  if (game.host.random() > 0.97 && gremlinFindTarget(monster)) return undefined;
  if (entity.number("stoleweapon") !== 0) {
    if (monster.enemy !== null && game.health(monster.enemy) < 0 && game.host.classname(monster.enemy) === "player") return monster.play("gremlin_glook1");
    let goal = game.entity(entity.references.get("trigger_field") ?? null);
    if (!gremlinHasAmmo(monster)) {
      if (entity.number("t_length") === 1) { if (goal !== null) game.remove(goal); entity.references.set("goalentity", monster.enemy); number(monster, "t_length", 0); }
      return undefined;
    }
    const range = monster.distance, direction = normalize(vsub(monster.origin, target));
    if (entity.number("t_length") === 0 && range < 150) {
      goal = game.create("gremlin_goal"); game.setBounds(goal, { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }); entity.references.set("trigger_field", goal.actor.id); number(monster, "t_length", 1);
    }
    if (entity.number("t_length") === 1 && goal !== null) {
      if (range > 250) { game.remove(goal); entity.references.set("goalentity", monster.enemy); number(monster, "t_length", 0); }
      else {
        if (range < 160) {
          let angles = velocityAngles(direction), end = target;
          for (let count = 0; count < 10; count++) {
            end = vadd(target, vscale(game.makeVectors(angles).forward, 350));
            const clear = game.host.trace({ start: target, end, bounds: POINT, ignore: entity.actor.id, monsters: true }).fraction === 1 && game.host.trace({ start: monster.origin, end, bounds: POINT, ignore: entity.actor.id, monsters: true }).fraction === 1;
            angles = { ...angles, y: (angles.y + 36) % 360 }; if (clear) break;
          }
          game.setOrigin(goal, end);
        }
        entity.references.set("goalentity", goal.actor.id); entity.idealYaw = yawFor(normalize(vsub(game.body(goal).origin, monster.origin)));
        monster.changeYaw();
        game.host.moveToGoal(entity.actor, goal.actor.id, distance); return monster.delay(0.1);
      }
    }
  }
  monster.ai("run", distance); return monster.delay(0.1);
}
