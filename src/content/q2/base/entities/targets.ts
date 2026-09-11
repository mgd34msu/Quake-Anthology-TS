/* Remaining Quake II g_target.c targets. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { add, integerField, movedir, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

function laser(entity: Q2Entity, game: Q2GameServices): undefined {
  const think: Q2Think = (self, services) => {
    const count = (self.spawnflags & 0x80000000) !== 0 ? 8 : 4;
    const origin = services.body(self).origin;
    const target = self.enemy === null ? null : services.host.bodies.read(self.enemy);
    if (target !== null) {
      const direction = normalize(subtract(add(target.origin, scale(add(target.bounds.min, target.bounds.max), 0.5)), origin));
      if (direction.x !== self.movedir.x || direction.y !== self.movedir.y || direction.z !== self.movedir.z) self.spawnflags |= 0x80000000;
      self.movedir = direction;
    }
    const end = add(origin, scale(self.movedir, 2048));
    let start = origin, terminal = end;
    let ignore: ActorId | null = self.actor.id;
    const passed: ActorId[] = [];
    for (;;) {
      const trace = services.host.trace({ start, end, bounds: null, ignore, mask: 0x6000001, exclude: passed });
      terminal = trace.end;
      const hit = trace.hit.kind === "actor" ? trace.hit.actor : null;
      if (hit !== null && services.host.combat.read(hit)?.canTakeDamage === true && services.entity(hit)?.laserImmune !== true) {
        services.damage(hit, self, self.activator, self.damage, 1, self.movedir, trace.end, zero, 30, 4);
      }
      if (hit === null || !services.host.isMonster(hit) && !services.host.isPlayer(hit)) {
        if (trace.fraction < 1 && (self.spawnflags & 0x80000000) !== 0) {
          self.spawnflags &= ~0x80000000;
          services.host.emit({ kind: "effect", effect: "q2:laser-sparks", origin: trace.end,
            direction: trace.contact.kind === "plane" ? trace.contact.plane.normal : zero, count, color: self.skin & 255 });
        }
        break;
      }
      passed.push(hit); ignore = hit; start = trace.end;
    }
    services.host.emit({ kind: "beam", actor: self.actor.id, start: origin, end: terminal, width: self.frame, color: self.skin, visible: true });
    return services.schedule(self, services.host.frameSeconds(), think);
  };
  const on: Q2Think = (self, services) => {
    self.activator ??= self.actor.id; self.spawnflags |= 0x80000001; self.visible = true;
    return think(self, services);
  };
  const off: Q2Think = (self, services) => {
    self.spawnflags &= ~1; self.visible = false; services.cancel(self);
    services.host.emit({ kind: "visibility", actor: self.actor.id, visible: false });
    return services.host.emit({ kind: "beam", actor: self.actor.id, start: services.body(self).origin,
      end: services.body(self).origin, width: self.frame, color: self.skin, visible: false });
  };
  return game.schedule(entity, 1, (self, services) => {
    self.frame = (self.spawnflags & 64) !== 0 ? 16 : 4;
    self.renderFlags |= 0xa0;
    self.skin = (self.spawnflags & 2) !== 0 ? 0xf2f2f0f0 : (self.spawnflags & 4) !== 0 ? 0xd0d1d2d3 :
      (self.spawnflags & 8) !== 0 ? 0xf3f3f1f1 : (self.spawnflags & 16) !== 0 ? 0xdcdddedf : (self.spawnflags & 32) !== 0 ? 0xe0e1e2e3 : 0;
    if (self.enemy === null) {
      if (self.target !== "") {
        self.enemy = services.targets(self.target)[0]?.actor.id ?? null;
        if (self.enemy === null) services.host.diagnostic(`target_laser has missing target ${self.target}`);
      } else { self.movedir = movedir(services.body(self).angles); services.move(self, { angles: zero }, false); }
    }
    self.damage ||= 1;
    services.move(self, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } });
    self.use = (current, host, _other, activator) => { current.activator = activator; return (current.spawnflags & 1) !== 0 ? off(current, host) : on(current, host); };
    return (self.spawnflags & 1) !== 0 ? on(self, services) : off(self, services);
  });
}

function lightRamp(entity: Q2Entity, game: Q2GameServices): undefined {
  if (!/^[a-z]{2}$/.test(entity.message) || entity.message[0] === entity.message[1] || entity.target === "" || game.options.mode === "deathmatch") {
    if (game.options.mode !== "deathmatch") game.host.diagnostic(`Invalid target_lightramp ${entity.message}`);
    return game.remove(entity);
  }
  let from = entity.message.charCodeAt(0) - 97, to = entity.message.charCodeAt(1) - 97, timestamp = 0;
  const think: Q2Think = (self, services) => {
    const target = services.entity(self.enemy);
    if (target === null) return undefined;
    const elapsed = services.host.now() - timestamp;
    const level = Math.trunc(97 + from + elapsed / self.speed * (to - from));
    services.host.emit({ kind: "lightstyle", style: integerField(target.spawn, "style"), pattern: String.fromCharCode(level & 255) });
    if (elapsed < self.speed) services.schedule(self, services.host.frameSeconds(), think);
    else if ((self.spawnflags & 1) !== 0) { const old = from; from = to; to = old; }
    return undefined;
  };
  entity.use = (self, services) => {
    if (services.entity(self.enemy) === null) {
      for (const target of services.targets(self.target)) {
        if (target.classname === "light") self.enemy = target.actor.id;
        else services.host.diagnostic(`target_lightramp target ${target.classname} is not a light`);
      }
      if (self.enemy === null) { services.host.diagnostic(`target_lightramp missing target ${self.target}`); return services.remove(self); }
    }
    timestamp = services.host.now(); return think(self, services);
  };
  return undefined;
}

export function spawnQ2BaseTarget(entity: Q2Entity, game: Q2GameServices, hooks: Q2BaseEntityHooks): boolean {
  switch (entity.classname) {
    case "target_temp_entity":
      entity.use = (self, services) => services.host.emit({ kind: "effect", effect: `q2:temp-${integerField(self.spawn, "style") & 255}`,
        origin: services.body(self).origin, direction: zero, count: 1, color: 0 });
      return true;
    case "target_spawner":
      entity.visible = false;
      if (entity.speed !== 0) { entity.movedir = scale(movedir(game.body(entity).angles), entity.speed); game.move(entity, { angles: zero }, false); }
      entity.use = (self, services) => {
        const body = services.body(self);
        const values = new Map<string, string>([["classname", self.target], ["origin", `${body.origin.x} ${body.origin.y} ${body.origin.z}`], ["angles", `${body.angles.x} ${body.angles.y} ${body.angles.z}`]]);
        const spawned = services.spawn({ ordinal: -1, classname: self.target, values });
        if (!services.host.actors.isLive(spawned.actor.id)) return undefined;
        services.host.bodies.unlink(spawned.actor); killQ2Box(spawned, services); services.link(spawned);
        if (self.speed !== 0) { services.move(spawned, { velocity: self.movedir }, false); services.motion(spawned, spawned.motion); }
        return undefined;
      };
      return true;
    case "target_blaster":
      entity.visible = false; entity.damage ||= 15; entity.speed ||= 1000;
      entity.movedir = movedir(game.body(entity).angles); game.move(entity, { angles: zero }, false);
      entity.use = (self, services) => {
        // Classic g_target.c calculates spawnflag effects but passes EF_BLASTER unconditionally.
        const effects = services.options.edition === "classic" ? 8 : (self.spawnflags & 2) !== 0 ? 0 : (self.spawnflags & 1) !== 0 ? 64 : 8;
        hooks.weapons.fireBlaster(self, services, services.body(self).origin, self.movedir, self.damage, self.speed, effects, false, 33);
        return services.sound(self, "weapons/laser2.wav", 2);
      };
      return true;
    case "target_crosslevel_trigger":
      entity.visible = false;
      entity.use = (self, services) => { services.counters.serverFlags |= self.spawnflags; return services.remove(self); };
      return true;
    case "target_crosslevel_target":
      entity.visible = false; entity.delay ||= 1;
      game.schedule(entity, entity.delay, (self, services) => {
        if (self.spawnflags === (services.counters.serverFlags & 255 & self.spawnflags)) {
          services.useTargets(self, self.actor.id); services.remove(self);
        }
        return undefined;
      });
      return true;
    case "target_laser": laser(entity, game); return true;
    case "target_lightramp": lightRamp(entity, game); return true;
    case "target_earthquake": {
      entity.visible = false; entity.count ||= 5; entity.speed ||= 200;
      let until = 0, lastSound = 0;
      const think: Q2Think = (self, services) => {
        if (lastSound < services.host.now()) { services.sound(self, "world/quake.wav", 0, 1, 0); lastSound = services.host.now() + 0.5; }
        for (const player of services.host.players()) {
          const body = services.host.bodies.read(player), actor = services.host.actors.resolveOwned(player);
          if (body === null || actor === null || body.ground === null) continue;
          const mass = services.host.combat.read(player)?.mass ?? 200;
          services.host.bodies.write(actor, { ...body, ground: null, velocity: { x: body.velocity.x + (services.host.random() * 2 - 1) * 150,
            y: body.velocity.y + (services.host.random() * 2 - 1) * 150, z: self.speed * (100 / mass) } });
        }
        if (services.host.now() < until) services.schedule(self, services.host.frameSeconds(), think);
        return undefined;
      };
      entity.use = (self, services, _other, activator) => {
        until = services.host.now() + self.count; lastSound = 0; self.activator = activator;
        return services.schedule(self, services.host.frameSeconds(), think);
      };
      return true;
    }
    default: return false;
  }
}
