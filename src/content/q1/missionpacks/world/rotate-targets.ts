/* hiprot.qc target transforms. Copyright id Software. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { ZERO, vadd, vsub, vscale, vectors } from "../../foundation/types.ts";
import { number, vector } from "./common.ts";

export function normalizeAngles(angles: Vec3): Vec3 {
  const normalize = (angle: number): number => Math.fround(angle - Math.floor(angle / 360) * 360);
  return { x: normalize(angles.x), y: normalize(angles.y), z: normalize(angles.z) };
}
export function linkRotateTargets(game: Q1Foundation, entity: Q1Actor): undefined {
  const origin = game.body(entity).origin; vector(entity, "oldorigin", origin);
  for (const target of game.find(entity.target)) {
    const body = game.body(target), wall = target.classname === "func_movewall";
    const center = wall ? vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)) : body.origin;
    const relative = vsub(center, origin); vector(target, "oldorigin", relative); vector(target, "neworigin", relative);
    number(target, "rotate_type", wall ? 1 : target.classname === "rotate_object" ? 0 : 2);
    if (wall || target.classname === "rotate_object") target.owner = entity.actor.id;
  }
  return undefined;
}
export function rotateTargets(game: Q1Foundation, entity: Q1Actor): undefined {
  const body = game.body(entity), basis = vectors(body.angles);
  for (const target of game.find(entity.target)) {
    const old = target.vector("oldorigin"), type = target.number("rotate_type");
    let next = vadd(vadd(vscale(basis.forward, old.x), vscale(basis.right, -old.y)), vscale(basis.up, old.z));
    if (type === 1) {
      next = vadd(vsub(body.origin, entity.vector("oldorigin")), vsub(next, old));
      vector(target, "neworigin", next); game.setBody(target, { velocity: vscale(vsub(next, game.body(target).origin), 25) });
    } else {
      vector(target, "neworigin", next); if (type === 0) game.setBody(target, { angles: body.angles });
      game.setOrigin(target, vadd(next, body.origin));
    }
  }
  return undefined;
}
export function rotateTargetsFinal(game: Q1Foundation, entity: Q1Actor): undefined {
  for (const target of game.find(entity.target)) game.setBody(target, target.number("rotate_type") === 0 ? { velocity: ZERO, angles: game.body(entity).angles } : { velocity: ZERO });
  return undefined;
}
export function setTargetOrigin(game: Q1Foundation, entity: Q1Actor): undefined {
  for (const target of game.find(entity.target)) game.setOrigin(target, target.number("rotate_type") === 1
    ? vadd(vsub(game.body(entity).origin, entity.vector("oldorigin")), vsub(target.vector("neworigin"), target.vector("oldorigin")))
    : vadd(target.vector("neworigin"), game.body(entity).origin));
  return undefined;
}
export function damageOnTargets(game: Q1Foundation, entity: Q1Actor, damage: number): undefined {
  for (const target of game.find(entity.target)) if (target.classname === "trigger_hurt" || target.classname === "func_movewall") target.damage = damage;
  return undefined;
}
