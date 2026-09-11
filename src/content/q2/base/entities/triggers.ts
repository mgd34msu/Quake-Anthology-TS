/* Quake II g_trigger.c environmental triggers. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { integerField, movedir, numberField, scale, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices } from "../../foundation/host.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

function velocity(game: Q2GameServices, actor: ActorId, value: Vec3, ground?: ActorId | null): undefined {
  const body = game.host.bodies.read(actor), owner = game.host.actors.resolveOwned(actor);
  if (body === null || owner === null) return undefined;
  game.host.bodies.write(owner, { ...body, velocity: value, ground: ground === undefined ? body.ground : ground });
  const entity = game.entity(actor);
  if (entity !== null) game.motion(entity, entity.motion);
  return undefined;
}

function init(entity: Q2Entity, game: Q2GameServices): undefined {
  entity.visible = false; entity.movedir = movedir(game.body(entity).angles);
  game.move(entity, { angles: zero }, false);
  return game.solid(entity, "trigger");
}

export function spawnQ2EnvironmentalTrigger(entity: Q2Entity, game: Q2GameServices, hooks: Q2BaseEntityHooks): boolean {
  switch (entity.classname) {
    case "trigger_push": {
      init(entity, game); entity.speed ||= 1000;
      const windTimes = new Map<ActorId, number>();
      entity.touch = (self, services, contact) => {
        const other = services.entity(contact.other);
        if (other?.classname === "grenade" || (services.host.combat.read(contact.other)?.health ?? 0) > 0) {
          const push = scale(self.movedir, self.speed * 10);
          velocity(services, contact.other, push);
          if (services.host.isPlayer(contact.other)) {
            hooks.playerPush(contact.other, push);
            if ((windTimes.get(contact.other) ?? 0) < services.host.now()) {
              windTimes.set(contact.other, services.host.now() + 1.5);
              const body = services.host.bodies.read(contact.other);
              if (body !== null) services.host.emit({ kind: "sound", actor: contact.other, origin: body.origin,
                path: "misc/windfly.wav", channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
            }
          }
        }
        if ((self.spawnflags & 1) !== 0) services.remove(self);
        return undefined;
      };
      return true;
    }
    case "trigger_hurt": {
      init(entity, game); entity.damage ||= 5;
      let nextDamage = 0;
      if ((entity.spawnflags & 1) !== 0) game.solid(entity, "none");
      if ((entity.spawnflags & 2) !== 0) entity.use = (self, services) => {
        services.solid(self, self.solid === "none" ? "trigger" : "none");
        if ((self.spawnflags & 2) === 0) self.use = null;
        return undefined;
      };
      entity.touch = (self, services, contact) => {
        const body = services.host.bodies.read(contact.other);
        if (body === null || services.host.combat.read(contact.other)?.canTakeDamage !== true || nextDamage > services.host.now()) return undefined;
        nextDamage = services.host.now() + ((self.spawnflags & 16) !== 0 ? 1 : services.host.frameSeconds());
        if ((self.spawnflags & 4) === 0 && Math.round(services.host.now() / services.host.frameSeconds()) % 10 === 0) {
          services.host.emit({ kind: "sound", actor: contact.other, origin: body.origin, path: "world/electro.wav",
            channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "once" });
        }
        services.damage(contact.other, self, self.actor.id, self.damage, self.damage, zero, body.origin, zero, 31, (self.spawnflags & 8) !== 0 ? 32 : 0);
        return undefined;
      };
      return true;
    }
    case "trigger_gravity": {
      if (!entity.spawn.values.has("gravity")) { game.host.diagnostic("trigger_gravity without gravity set"); game.remove(entity); return true; }
      init(entity, game);
      entity.gravity = game.options.edition === "classic" ? integerField(entity.spawn, "gravity") : numberField(entity.spawn, "gravity");
      entity.touch = (self, services, contact) => {
        const other = services.entity(contact.other);
        if (other !== null) { other.gravity = self.gravity; services.motion(other, other.motion); }
        return hooks.setActorGravity(contact.other, self.gravity);
      };
      return true;
    }
    case "trigger_monsterjump": {
      entity.speed ||= 200;
      const angles = game.body(entity).angles;
      if (angles.y === 0) game.move(entity, { angles: { ...angles, y: 360 } }, false);
      init(entity, game); entity.movedir = { ...entity.movedir, z: numberField(entity.spawn, "height") || 200 };
      entity.touch = (self, services, contact) => {
        const other = services.entity(contact.other), body = services.host.bodies.read(contact.other);
        if (body === null || !services.host.isMonster(contact.other) || other !== null && ((other.flags & 3) !== 0 || (other.serverFlags & 8) !== 0)) return undefined;
        return velocity(services, contact.other, { x: self.movedir.x * self.speed, y: self.movedir.y * self.speed,
          z: body.ground === null ? body.velocity.z : self.movedir.z }, null);
      };
      return true;
    }
    default: return false;
  }
}
