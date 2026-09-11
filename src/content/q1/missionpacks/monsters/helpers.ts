/* Shared source operations used by Hipnotic/Rogue monster callbacks. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { POINT, ZERO, length, vadd, vscale, vsub } from "../../foundation/types.ts";
import { throwGib, throwHead } from "../../base/projectiles.ts";
import type { MissionMonster } from "./runtime.ts";

export function number(monster: MissionMonster, key: string, value: number): undefined { monster.entity.fields.set(key, String(Math.fround(value))); return undefined; }
export function dropToFloor(monster: MissionMonster): boolean {
  const { game, entity } = monster, body = game.body(entity);
  const trace = game.host.trace({ start: body.origin, end: vadd(body.origin, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: entity.actor.id, monsters: false });
  if (trace.fraction === 1 || trace.allSolid) return false;
  entity.movementFlags |= 512;
  game.setBody(entity, { origin: trace.end, ground: trace.actor }); game.link(entity);
  return true;
}
export function gib(monster: MissionMonster, head: string, gibs: readonly string[], sound = "player/udeath.wav"): undefined {
  const { game, entity } = monster;
  if (sound !== "") game.sound(entity, sound);
  throwHead(game, entity, head);
  for (const model of gibs) throwGib(game, monster.origin, model, game.health(entity.actor.id));
  return undefined;
}
export function eye(game: Q1Foundation, actor: ActorId): Vec3 | null {
  const body = game.host.bodies.read(actor);
  const entity = game.entity(actor);
  return body === null ? null : vadd(body.origin, entity?.fields.has("view_ofs") ? entity.vector("view_ofs") : { x: 0, y: 0, z: game.isPlayer(actor) ? 22 : (entity?.movementFlags ?? 0) & 2 ? 10 : 25 });
}
export function radiusActors(game: Q1Foundation, origin: Vec3, radius: number): readonly ActorId[] {
  return game.host.actors.observations().flatMap(actor => {
    const entity = game.entity(actor.id), body = game.host.bodies.read(actor.id);
    if (body === null || entity?.solid === "none") return [];
    return length(vsub(origin, vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)))) <= radius ? [actor.id] : [];
  }).reverse();
}
export function eelZap(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  for (const target of radiusActors(game, monster.origin, 85)) {
    if (game.host.classname(target) === "monster_eel" || ((game.entity(target)?.movementFlags ?? 0) & 16) === 0) continue;
    const body = game.host.bodies.read(target);
    if (body === null || game.host.combat.read(target)?.canTakeDamage !== true) continue;
    let points = 45 - Math.max(0, 0.5 * length(vsub(monster.origin, vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)))));
    if (target === entity.actor.id) points *= 0.5;
    if (points > 0 && game.canDamage(target, entity.actor.id)) game.damage(target, entity.actor.id, entity.actor.id, points);
  }
  return undefined;
}
export function missile(game: Q1Foundation, owner: ActorId, classname: string, model: string, origin: Vec3, velocity: Vec3, touch: string, seconds = 5): Q1Actor {
  const entity = game.create(classname); entity.owner = owner; entity.model = model; entity.movement = "flymissile"; entity.solid = "bbox";
  game.setBody(entity, { origin, velocity, bounds: POINT, ground: null }); entity.touch = game.named.touch(entity, touch);
  game.schedule(entity, seconds, game.named.action(entity, "SUB_Remove")); game.link(entity);
  return entity;
}
export function emptyPain(): undefined { return undefined; }
export const humanBounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } };
export function setPointBounds(monster: MissionMonster): undefined { return monster.game.setBounds(monster.entity, { min: ZERO, max: ZERO }); }

export const hullBounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
