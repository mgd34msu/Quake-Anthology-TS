/* quakec_mg3/ai.qc CheckAnyAttack and species attack policies. GPL-2.0-or-later. */
import { sameActor } from "../../../../../contracts/identity.ts";
import { POINT, length, vsub } from "../../../foundation/types.ts";
import type { Mg3Monster } from "../ai/index.ts";
import { armyAttack } from "./army.ts";

export function mg3OrdinaryAttack(monster: Mg3Monster): boolean {
  const { game, entity } = monster, enemy = monster.enemy;
  if ((game.world?.number("enemy_visible") ?? 0) === 0 || enemy === null) return false;
  const range = game.world?.number("enemy_range") ?? 0;
  if (entity.classname === "monster_army") return armyAttack(monster);
  if (entity.classname === "monster_demon1" || entity.classname === "monster_dog") {
    if (range === 0) { entity.attackState = "melee"; return true; }
    const body = game.body(entity), target = game.host.bodies.read(enemy); if (target === null) return false;
    const height = target.bounds.max.z - target.bounds.min.z;
    if (body.origin.z + body.bounds.min.z > target.origin.z + target.bounds.min.z + height * 0.75 || body.origin.z + body.bounds.max.z < target.origin.z + target.bounds.min.z + height * 0.25) return false;
    const delta = vsub(target.origin, body.origin), distance = Math.hypot(delta.x, delta.y), demon = entity.classname === "monster_demon1";
    if (demon ? distance < 100 || distance > 200 && game.host.random() < 0.9 : distance < 80 || distance > 150) return false;
    entity.attackState = "missile"; if (demon) game.sound(entity, "demon/djump.wav", "voice"); return true;
  }
  const shambler = entity.classname === "monster_shambler", ogre = entity.classname === "monster_ogre", wizard = entity.classname === "monster_wizard";
  if (!shambler && !ogre && !wizard) return monster.checkAttack();
  if (!wizard && range === 0 && game.canDamage(enemy, entity.actor.id)) { entity.attackState = "melee"; return true; }
  if (game.time < monster.state.attackFinished) return false;
  const straight = (): undefined => {
    if (!monster.sliding && entity.attackState === "straight") return undefined;
    monster.sliding = false; entity.attackState = "straight"; return monster.play("wiz_run1");
  };
  if (wizard && range === 3) { straight(); return false; }
  const start = monster.eye(), end = monster.eye(enemy); if (start === null || end === null) return false;
  if (shambler && length(vsub(start, end)) > 600) return false;
  const trace = game.host.trace({ start, end, bounds: POINT, ignore: entity.actor.id, monsters: true });
  if (trace.actor === null || !sameActor(trace.actor, enemy) || !wizard && trace.inOpen && trace.inWater) { if (wizard) straight(); return false; }
  if (!wizard) {
    if (range === 3) return false;
    entity.attackState = "missile"; monster.attackFinished((shambler ? 2 : 1) + 2 * game.host.random()); return true;
  }
  const chance = range === 0 ? 0.9 : range === 1 ? 0.6 : range === 2 ? 0.2 : 0;
  if (game.host.random() < chance) { monster.sliding = false; entity.attackState = "missile"; return true; }
  if (range === 2) straight();
  else if (!monster.sliding) { monster.sliding = true; entity.attackState = "straight"; monster.play("wiz_side1"); }
  return false;
}
