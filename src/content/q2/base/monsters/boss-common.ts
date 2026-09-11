/* Shared original boss routines. id Software Quake II, GPL-2.0-or-later. */
import { add, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Think } from "../../foundation/host.ts";
import type { Q2Monsters } from "../../foundation/monsters/index.ts";
import { enemyBody, enemyEye, health, targetDistance, vectorAngles } from "../../foundation/monsters/ai.ts";
import { throwGib } from "../../foundation/monsters/gibs.ts";
import type { MonsterContext, Q2MonsterDefinition } from "../../foundation/monsters/types.ts";

export function stopLoop(context: MonsterContext): undefined {
  return context.game.host.emit({ kind: "sound", actor: context.entity.actor.id, origin: context.game.body(context.entity).origin, path: "", channel: 0, volume: 0, attenuation: 1, reliable: false, loop: "stop" });
}
export function bossCheckAttack(context: MonsterContext, hover = false, allowNonSolid = false): boolean {
  const { game, entity, state } = context, body = game.body(entity), enemy = enemyBody(context), eye = enemyEye(context);
  if (enemy === null || eye === null || entity.enemy === null) return false;
  if (health(game, entity.enemy) > 0) {
    const trace = game.host.trace({ start: { ...body.origin, z: body.origin.z + entity.viewHeight }, end: eye, bounds: null, ignore: entity.actor.id, mask: 1 | 0x2000000 | 16 | 8 });
    if ((trace.hit.kind !== "actor" || trace.hit.actor !== entity.enemy) && (!allowNonSolid || game.entity(entity.enemy)?.solid !== "none" || trace.fraction < 1)) return false;
  }
  const distance = targetDistance(context);
  state.idealYaw = vectorAngles(subtract(enemy.origin, body.origin)).y;
  if (distance < 80) { state.attackState = state.hasMelee ? "melee" : "missile"; return true; }
  if (!state.hasRangedAttack || game.host.now() < state.attackFinished || distance >= 1000) return false;
  const chance = state.standGround ? 0.4 : hover ? 0.8 : distance < 500 ? 0.4 : 0.2;
  if (game.host.random() < chance || allowNonSolid && game.entity(entity.enemy)?.solid === "none") { state.attackState = "missile"; state.attackFinished = game.host.now() + 2 * game.host.random(); return true; }
  if (state.locomotion === "fly") state.attackState = game.host.random() < 0.3 ? "sliding" : "straight";
  return false;
}
const explosionCallbacks = new WeakMap<Q2Monsters, Q2Think>();
export function withBossExplosionCallbacks(definition: Q2MonsterDefinition, monsters: Q2Monsters): Q2MonsterDefinition {
  let think = explosionCallbacks.get(monsters);
  if (think === undefined) {
    think = (entity, game) => {
      const context = monsters.context(entity.actor.id);
      if (context === null || context.game !== game) throw new Error("Boss explosion has no restored source monster context");
      return advanceBossExplosion(context);
    };
    explosionCallbacks.set(monsters, think);
  }
  return { ...definition, sourceCallbacks: { ...definition.sourceCallbacks, think: { ...definition.sourceCallbacks?.think, "q2:BossExplode": think } } };
}

export function bossExplode(context: MonsterContext): undefined {
  const think = context.game.sourceCallbacks.think.resolve("q2:BossExplode");
  if (think === null) throw new Error("Boss explosion source callback was not registered");
  return think(context.entity, context.game);
}

function advanceBossExplosion(context: MonsterContext): undefined {
  const { entity, game } = context;
  const positions: readonly { readonly x: number; readonly y: number }[] = [
    { x: -24, y: -24 }, { x: 24, y: 24 }, { x: 24, y: -24 }, { x: -24, y: 24 },
    { x: -48, y: -48 }, { x: 48, y: 48 }, { x: -48, y: 48 }, { x: 48, y: -48 },
  ];
    const height = 24 + Math.floor(game.host.random() * 16), index = entity.count++;
    if (index === 8) {
      stopLoop(context);
      for (let i = 0; i < 4; i++) throwGib(entity, game, "models/objects/gibs/sm_meat/tris.md2", 500);
      for (let i = 0; i < 8; i++) throwGib(entity, game, "models/objects/gibs/sm_metal/tris.md2", 500, { metallic: true });
      throwGib(entity, game, "models/objects/gibs/chest/tris.md2", 500);
      throwGib(entity, game, "models/objects/gibs/gear/tris.md2", 500, { metallic: true, head: true });
      context.state.dead = true; context.state.gibbed = true;
      return undefined;
    }
    const offset = positions[index] ?? { x: 0, y: 0 };
    game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: add(game.body(entity).origin, { ...offset, z: height }), direction: zero, count: 1, color: 0 });
    const think = game.sourceCallbacks.think.resolve("q2:BossExplode");
    if (think === null) throw new Error("Boss explosion source callback was not registered");
    return game.schedule(entity, 0.1, think);
}
