/* Shared source monster callbacks. id Software Quake II, GPL-2.0-or-later. */
import type { Bounds, Vec3 } from "../../../../contracts/math.ts";
import type { DeathReaction } from "../../../../contracts/world.ts";
import { add, normalize, scale, subtract } from "../../foundation/fields.ts";
import { anglesVectors, enemyBody, enemyEye, health, projectFlash } from "../../foundation/monsters/ai.ts";
import { throwGib, throwHead } from "../../foundation/monsters/gibs.ts";
import { muzzleOffset } from "../../foundation/monsters/muzzle.ts";
import type { MonsterContext, MonsterHandler } from "../../foundation/monsters/types.ts";

export const humanoidBounds: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } };
export function move(name: string): MonsterHandler { return context => context.setMove(name); }
export function sound(path: string, channel = 2, attenuation = 1): MonsterHandler {
  return ({ entity, game }) => game.sound(entity, path, channel, 1, attenuation);
}
export function aliveEnemy(context: MonsterContext): boolean { return enemyBody(context) !== null && health(context.game, context.entity.enemy) > 0; }
export function damagedSkin(context: MonsterContext): undefined {
  if (health(context.game, context.entity.actor.id) < context.entity.maxHealth / 2) context.entity.skin = 1;
  return undefined;
}
export function muzzle(context: MonsterContext, flash: number, direction: Vec3, origin: Vec3): undefined {
  return context.game.host.emit({ kind: "effect", effect: "q2:muzzleflash2", origin, direction, count: flash, color: 0 });
}
export function shot(context: MonsterContext, flash: number, lead = 0): { readonly start: Vec3; readonly direction: Vec3 } | null {
  const enemy = enemyBody(context), eye = enemyEye(context);
  if (enemy === null || eye === null) return null;
  const start = projectFlash(context, muzzleOffset(context.game.options.edition, flash));
  return { start, direction: normalize(subtract(add(eye, scale(enemy.velocity, lead)), start)) };
}
export function forwardShot(context: MonsterContext, flash: number): { readonly start: Vec3; readonly direction: Vec3 } {
  return { start: projectFlash(context, muzzleOffset(context.game.options.edition, flash)), direction: anglesVectors(context.game.body(context.entity).angles).forward };
}
export function standardGib(context: MonsterContext, reaction: DeathReaction, bones = 2, meats = 4, head = "models/objects/gibs/head2/tris.md2", attenuation = 1): boolean {
  const { state, game, entity } = context;
  if (health(game, entity.actor.id) > state.gibHealth) return false;
  game.sound(entity, "misc/udeath.wav", 2, 1, attenuation);
  for (let i = 0; i < bones; i++) throwGib(entity, game, "models/objects/gibs/bone/tris.md2", reaction.damage);
  for (let i = 0; i < meats; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
  throwHead(entity, game, head, reaction.damage);
  state.dead = true; state.gibbed = true;
  return true;
}
export function explode(context: MonsterContext, path: string): undefined {
  const { entity, game } = context;
  game.sound(entity, path, 2);
  game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: game.body(entity).origin, direction: { x: 0, y: 0, z: 0 }, count: 1, color: 0 });
  context.state.dead = true;
  return game.remove(entity);
}
export function loopSound(context: MonsterContext, path: string): undefined {
  return context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
}
export function beginDeath(context: MonsterContext, reaction: DeathReaction, path: string, animation: string, bones = 2, meats = 4): undefined {
  if (standardGib(context, reaction, bones, meats) || context.state.dead) return undefined;
  context.game.sound(context.entity, path, 2);
  context.state.dead = true; context.state.canTakeDamage = true;
  context.game.host.combat.setTraits(context.entity.actor, { canTakeDamage: true });
  return context.setMove(animation);
}
export function finishCorpse(context: MonsterContext, bounds: Bounds = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: -8 } }): undefined {
  const { entity, game, state } = context;
  state.corpse = true;
  entity.serverFlags |= 2;
  game.move(entity, { bounds });
  game.motion(entity, "toss");
  return game.cancel(entity);
}
