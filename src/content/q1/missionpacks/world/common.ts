/* Mission pack QuakeC. Copyright id Software. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { moveDirection } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { ZERO } from "../../foundation/types.ts";

export function number(entity: Q1Actor, key: string, value: number): undefined { entity.fields.set(key, String(Math.fround(value))); return undefined; }
export function vector(entity: Q1Actor, key: string, value: Vec3): undefined { entity.fields.set(key, `${Math.fround(value.x)} ${Math.fround(value.y)} ${Math.fround(value.z)}`); return undefined; }
export function later(game: Q1EntityServices, entity: Q1Actor, delay: number, name: string): undefined { return game.schedule(entity, delay, game.named.action(entity, name)); }
export function trigger(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.movedir = moveDirection(game.body(entity).angles, game); entity.solid = "trigger"; entity.model = "";
  return game.setBody(entity, { angles: ZERO });
}
export function brush(game: Q1EntityServices, entity: Q1Actor): undefined {
  entity.mangle = game.body(entity).angles; entity.solid = "bsp"; entity.movement = "push";
  return game.setBody(entity, { angles: ZERO });
}
export function targetEvent(game: Q1EntityServices, entity: Q1Actor, target: string, message = ""): undefined {
  const prior = entity.target, priorMessage = entity.message;
  entity.target = target; entity.message = message;
  try { return game.useTargets(entity, entity.activator); }
  finally { entity.target = prior; entity.message = priorMessage; }
}
