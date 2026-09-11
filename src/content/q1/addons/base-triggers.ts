/* quakec_mg1/triggers.qc and quakec_mg3/triggers.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Q1Actor } from "../foundation/entity.ts";
import { spawnMapActor } from "../foundation/spawns.ts";
import { spawnRemainingMapActor } from "../base/map-entities.ts";
import type { Q1AddonContext } from "./context.ts";

export function registerAddonBaseTriggers(context: Q1AddonContext): undefined {
  const { game, base } = context, prefix = `${context.program}:trigger:`;
  const grounded = (entity: Q1Actor, other: ActorId | null): boolean => {
    if (context.program !== "mg3" || (entity.spawnflags & 64) === 0) return true;
    const body = other === null ? null : game.host.bodies.read(other); return body !== null && body.ground !== null;
  };
  game.named.register(prefix + "multi_touch", { touch: (_game, entity, other, normal) => grounded(entity, other) ? game.named.touch(entity, "multi_touch")(other, normal) : undefined });
  game.named.register(prefix + "multi_use", { use: (_game, entity, other, activator) => grounded(entity, other) ? game.named.use(entity, "multi_use")(other, activator) : undefined });
  game.named.register(prefix + "multi_killed", { die: (_game, entity, attacker) => grounded(entity, attacker) ? game.named.die(entity, "multi_killed")(attacker) : undefined });
  const multiple = (entity: Q1Actor): undefined => {
    if (context.removedOutsideCoop(entity) || context.removedForRunes(entity)) return undefined;
    entity.fields.set("netname", "trigger_multiple");
    if ((entity.spawnflags & 2) !== 0) { entity.spawnflags &= ~2; entity.use = game.named.use(entity, prefix + "activate_multi"); return undefined; }
    entity.wait ||= 0.2; context.initTrigger(entity); if (!game.live(entity)) return undefined;
    entity.use = game.named.use(entity, prefix + "multi_use");
    if (entity.maxHealth !== 0) {
      if ((entity.spawnflags & 1) !== 0) throw new Error("health and notouch don't make sense");
      entity.damageable = true; entity.solid = "bbox"; entity.die = game.named.die(entity, prefix + "multi_killed");
    } else if ((entity.spawnflags & 1) === 0) entity.touch = game.named.touch(entity, prefix + "multi_touch");
    return undefined;
  };
  game.named.register(prefix + "activate_multi", { use: (_game, entity) => multiple(entity) });
  for (const classname of ["trigger_multiple", "trigger_once", "trigger_secret"]) game.registerSpawn(classname, (_game, entity) => {
    if (context.removedOutsideCoop(entity) || context.removedForRunes(entity)) return undefined;
    if (classname !== "trigger_multiple") entity.wait = -1;
    if (classname === "trigger_secret") {
      game.totalSecrets++;
      if (context.program !== "mg3" || (entity.spawnflags & 128) === 0) entity.message ||= "$qc_found_secret";
      entity.sounds ||= 1;
    }
    multiple(entity); if (classname === "trigger_once") entity.fields.set("netname", "trigger_once"); return undefined;
  });
  for (const classname of ["trigger_teleport", "trigger_relay"]) game.registerSpawn(classname, (_game, entity) => {
    if (context.removedOutsideCoop(entity, classname === "trigger_relay") || context.removedForRunes(entity)) return undefined;
    return spawnMapActor(game, entity);
  });
  for (const classname of ["trigger_onlyregistered", "trigger_monsterjump", "trigger_setskill"]) {
    game.replaceSpawn(classname, (_game, entity) => {
      if (context.removedOutsideCoop(entity, false) || context.removedForRunes(entity)) return undefined;
      return spawnRemainingMapActor(base, entity);
    });
  }
  return undefined;
}
