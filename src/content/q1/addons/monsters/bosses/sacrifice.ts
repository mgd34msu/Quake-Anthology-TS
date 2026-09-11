/* quakec_mg3/monsters/mg3_sacrifice.qc. Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import { throwGib } from "../../../base/projectiles.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { vadd } from "../../../foundation/types.ts";
import type { Q1AddonContext } from "../../context.ts";

export function registerSacrifice(context: Q1AddonContext): undefined {
  const { game } = context;
  const gib = (entity: Q1Actor): undefined => {
    game.setBody(entity, { origin: vadd(game.body(entity).origin, { x: 0, y: 0, z: -32 }) });
    for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, game.body(entity).origin, model, -10);
    game.sound(entity, game.host.random() < 0.5 ? "player/gib.wav" : "player/udeath.wav", "voice", 0); game.useTargets(entity, entity.activator); return game.remove(entity);
  };
  game.named.register("mg3:sacrifice_gib", { use: (_game, entity, _other, activator) => { entity.activator = activator; return gib(entity); }, die: (_game, entity) => gib(entity) });
  game.named.register("mg3:sacrifice_animate", { action: (_game, entity) => {
    entity.count++; if (entity.count > 75) entity.count = 5; entity.frame = entity.count; return game.schedule(entity, 0.1, game.named.action(entity, "mg3:sacrifice_animate"));
  } });
  game.named.register("mg3:sacrifice_think", { action: (_game, entity) => {
    entity.count = Math.fround(entity.count + 0.1); game.setOrigin(entity, vadd(entity.vector("dest"), { x: 0, y: 0, z: Math.cos(entity.count * 90) * 16 }));
    game.setBody(entity, { angles: vadd(game.body(entity).angles, { x: 0, y: 3.6, z: 0 }) }); return game.schedule(entity, 0.1, game.named.action(entity, "mg3:sacrifice_think"));
  } });
  game.registerSpawn("misc_sacrifice", (_game, entity) => {
    entity.use = game.named.use(entity, "mg3:sacrifice_gib"); entity.die = game.named.die(entity, "mg3:sacrifice_gib"); game.host.combat.setHealth(entity.actor, 100); entity.maxHealth = 100;
    entity.solid = "slidebox"; entity.damageable = (entity.spawnflags & 1) === 0; entity.aimedDamage = entity.damageable; entity.movement = "step";
    if ((entity.spawnflags & 2) !== 0) {
      entity.model = "progs/player_hanging.mdl"; entity.count = 0; entity.angularVelocity = { x: 0, y: 36, z: 0 }; context.setVector(entity, "dest", game.body(entity).origin);
      game.schedule(entity, 0.1, game.named.action(entity, "mg3:sacrifice_think"));
    } else {
      entity.count = 5 + Math.floor(game.host.random() * 65 + 0.5); entity.model = "progs/player_hanging_animated.mdl"; entity.frame = entity.count;
      game.schedule(entity, 0.1, game.named.action(entity, "mg3:sacrifice_animate"));
    }
    return game.setBounds(entity, { min: { x: -16, y: -16, z: -56 }, max: { x: 16, y: 16, z: 0 } });
  }); return undefined;
}
