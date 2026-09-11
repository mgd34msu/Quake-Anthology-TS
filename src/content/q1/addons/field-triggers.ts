/* quakec_mg1/triggers.qc and quakec_mg3/triggers.qc. GPL-2.0-or-later. */
import { dot, length, normalize, vadd, vscale, vsub } from "../foundation/types.ts";
import type { Q1AddonContext } from "./context.ts";

export function registerAddonFieldTriggers(context: Q1AddonContext): undefined {
  const { game } = context, prefix = `${context.program}:field:`;
  game.named.register(prefix + "hurt_on", { action: (_game, entity) => { entity.solid = "trigger"; return game.cancel(entity); } });
  game.named.register(prefix + "hurt", { use: (_game, entity) => context.setNumber(entity, "state", 1 - entity.number("state")), touch: (_game, entity, other) => {
    if (entity.number("state") !== 0 || !game.host.combat.read(other)?.canTakeDamage || (entity.spawnflags & 8) !== 0 && !context.services.isMonster(other)) return undefined;
    entity.solid = "none"; game.damage(other, entity.actor.id, entity.actor.id, entity.damage);
    return game.schedule(entity, entity.wait, game.named.action(entity, prefix + "hurt_on"));
  } });
  game.registerSpawn("trigger_hurt", (_game, entity) => {
    context.initTrigger(entity); if (!game.live(entity)) return undefined;
    entity.fields.set("netname", "trigger_hurt"); entity.damage ||= 5; entity.wait ||= 1;
    if ((entity.spawnflags & 1) !== 0) context.setNumber(entity, "state", 1);
    entity.touch = game.named.touch(entity, prefix + "hurt"); entity.use = game.named.use(entity, prefix + "hurt"); return undefined;
  });
  game.named.register(prefix + "push", { use: (_game, entity) => {
    if (entity.solid === "trigger") entity.solid = "none"; else { entity.solid = "trigger"; game.forceRetouch = 1; } return undefined;
  }, touch: (_game, entity, other) => {
    const actor = game.host.actors.resolveOwned(other), body = game.host.bodies.read(other); if (actor === null || body === null) return undefined;
    const source = game.entity(other), classname = game.host.classname(other), player = game.isPlayer(other), delta = vscale(entity.movedir, entity.speed * 10);
    const velocity = (entity.spawnflags & 2) !== 0 ? vadd(body.velocity, vscale(delta, context.frameTime)) : delta;
    if (context.program !== "mg3" && [...game.entities.values()].some(target => target.classname === "horde_manager")) {
      if (source !== null) source.spawnflags &= ~4;
      if (!player) {
        if (classname === "item_artifact_invulnerability" || classname === "item_artifact_super_damage") game.host.bodies.write(actor, { ...body, velocity });
        return undefined;
      }
    }
    if (game.health(other) > 0 || classname === "grenade") {
      if (source === null ? context.playerNumber(other, "in_shelter") !== 0 : (source.movementFlags & 32768) !== 0) return undefined;
      const jump = context.program === "mg3" && (entity.spawnflags & 16) !== 0; if (jump && body.ground === null) return undefined;
      const monster = context.services.isMonster(other); game.host.bodies.write(actor, { ...body, velocity, ground: monster ? null : body.ground });
      if (monster && source !== null) source.movementFlags &= ~512;
      if (player && context.playerNumber(other, "fly_sound") < game.time) {
        context.setPlayerNumber(other, "fly_sound", game.time + (jump ? 0.5 : 1.5));
        game.sound(actor, jump ? "weapons/sgun1.wav" : context.program === "mg3" && (entity.spawnflags & 8) !== 0 ? "player/inh2o.wav" : "ambience/windfly.wav", "auto");
      }
    }
    return (entity.spawnflags & 1) !== 0 ? game.remove(entity) : undefined;
  } });
  game.registerSpawn("trigger_push", (_game, entity) => {
    if (context.program === "mg3") {
      const angles = game.body(entity).angles, direction = entity.vector("movedir");
      if (length(angles) === 0 && length(direction) === 0) context.setVector(entity, "movedir", { x: 1, y: 0, z: 0 });
      else if (length(direction) !== 0) context.setVector(entity, "movedir", normalize(direction));
    }
    context.initTrigger(entity); if (!game.live(entity)) return undefined;
    if (context.program === "mg3" && entity.fields.has("movedir")) entity.movedir = entity.vector("movedir");
    entity.fields.set("netname", "trigger_push"); entity.speed ||= 1000;
    entity.touch = game.named.touch(entity, prefix + "push"); entity.use = game.named.use(entity, prefix + "push");
    if ((entity.spawnflags & 4) !== 0) entity.solid = "none"; return undefined;
  });
  game.named.register(prefix + "shelter", { touch: (_game, entity, other) => {
    if (game.health(other) <= 0 && game.host.classname(other) !== "grenade") return undefined;
    const body = game.host.bodies.read(other); if (body === null) return undefined;
    const sheltered = dot(vsub(body.origin, entity.pos1), entity.pos2) >= 0, source = game.entity(other);
    if (source !== null) source.movementFlags = sheltered ? source.movementFlags | 32768 : source.movementFlags & ~32768;
    else context.setPlayerNumber(other, "in_shelter", sheltered ? 1 : 0);
    return undefined;
  } });
  game.registerSpawn("trigger_shelter_portal", (_game, entity) => {
    context.initTrigger(entity); if (!game.live(entity)) return undefined;
    const bounds = game.body(entity).bounds, size = vsub(bounds.max, bounds.min);
    entity.pos1 = vadd(bounds.min, vscale(size, 0.5));
    entity.pos2 = size.x < size.y ? size.x < size.z ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 } : size.y < size.z ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    if ((entity.spawnflags & 1) !== 0) entity.pos2 = vscale(entity.pos2, -1);
    entity.touch = game.named.touch(entity, prefix + "shelter"); return undefined;
  });
  return undefined;
}
