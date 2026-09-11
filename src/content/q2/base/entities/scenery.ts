/* Quake II g_misc.c clocks, decorative models and teleporters. GPL-2.0-or-later. */
import type { Bounds } from "../../../../contracts/math.ts";
import { add, integerField, scale, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import { vectorAngles } from "../../foundation/weapons/vectors.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

function model(entity: Q2Entity, game: Q2GameServices, path: string, bounds: Bounds, solid: Q2Entity["solid"]): undefined {
  entity.model = path; game.move(entity, { bounds }, false); game.solid(entity, solid); return game.show(entity);
}

function animate(entity: Q2Entity, game: Q2GameServices, first: number, end: number, initialDelay = 0.2): undefined {
  entity.frame = first;
  const step: Q2Think = (self, services) => {
    self.frame++;
    if (self.frame >= end) self.frame = first;
    services.show(self); return services.schedule(self, services.host.frameSeconds(), step);
  };
  game.show(entity); return game.schedule(entity, initialDelay, step);
}

export function q2ClockText(seconds: number, style: number): string {
  const sec = String(seconds % 60).padStart(2, "0");
  if (style === 0) return String(seconds).padStart(2, " ");
  if (style === 1) return `${String(Math.trunc(seconds / 60)).padStart(2, " ")}:${sec}`;
  const hours = Math.trunc(seconds / 3600), minutes = Math.trunc((seconds - hours * 3600) / 60);
  return `${String(hours).padStart(2, " ")}:${String(minutes).padStart(2, "0")}:${sec}`;
}

function clock(entity: Q2Entity, game: Q2GameServices, hooks: Q2BaseEntityHooks): undefined {
  if (entity.target === "" || (entity.spawnflags & 2) !== 0 && entity.count === 0) {
    game.host.diagnostic(`func_clock without ${(entity.spawnflags & 2) !== 0 ? "count or target" : "target"}`); return game.remove(entity);
  }
  if ((entity.spawnflags & 1) !== 0 && entity.count === 0) entity.count = 3600;
  let value = 0;
  const reset = (): undefined => {
    entity.activator = null;
    if ((entity.spawnflags & 1) !== 0) { value = 0; entity.wait = entity.count; }
    else if ((entity.spawnflags & 2) !== 0) { value = entity.count; entity.wait = 0; }
    return undefined;
  };
  reset();
  const tick: Q2Think = (self, services) => {
    let display = services.entity(self.enemy);
    if (display === null) { display = services.targets(self.target)[0] ?? null; self.enemy = display?.actor.id ?? null; }
    if (display === null) return undefined;
    if ((self.spawnflags & 1) !== 0) { self.message = q2ClockText(value, integerField(self.spawn, "style")); value++; }
    else if ((self.spawnflags & 2) !== 0) { self.message = q2ClockText(value, integerField(self.spawn, "style")); value--; }
    else {
      const time = hooks.localTime(); self.message = `${String(time.hour).padStart(2, " ")}:${String(time.minute).padStart(2, "0")}:${String(time.second).padStart(2, "0")}`;
    }
    self.message = self.message.slice(0, 15);
    display.message = self.message; services.host.callbacks.use(display.actor, self.actor.id, self.actor.id);
    if ((self.spawnflags & 1) !== 0 && value > self.wait || (self.spawnflags & 2) !== 0 && value < self.wait) {
      const pathTarget = self.spawn.values.get("pathtarget") ?? "";
      if (pathTarget !== "") {
        const previousTarget = self.target, previousMessage = self.message;
        self.target = pathTarget; self.message = "";
        try { services.useTargets(self, self.activator); } finally { self.target = previousTarget; self.message = previousMessage; }
      }
      if ((self.spawnflags & 8) === 0 || !services.host.actors.isLive(self.actor.id)) return undefined;
      reset();
      if ((self.spawnflags & 4) !== 0) return undefined;
    }
    return services.schedule(self, 1, tick);
  };
  if ((entity.spawnflags & 4) !== 0) entity.use = (self, services, _other, activator) => {
    if ((self.spawnflags & 8) === 0) self.use = null;
    if (self.activator !== null) return undefined;
    self.activator = activator; return tick(self, services);
  };
  else game.schedule(entity, 1, tick);
  return undefined;
}

function teleporter(entity: Q2Entity, game: Q2GameServices, hooks: Q2BaseEntityHooks): undefined {
  if (entity.target === "") { game.host.diagnostic("teleporter without a target"); return game.remove(entity); }
  entity.skin = 1; entity.effects = 0x20000;
  model(entity, game, "models/objects/dmspot/tris.md2", { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -16 } }, "box");
  game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin,
    path: "world/amb10.wav", channel: 0, volume: 1, attenuation: 3, reliable: false, loop: "start" });
  const trigger = game.create("teleporter_trigger"); trigger.target = entity.target; trigger.owner = entity.actor.id; trigger.visible = false;
  game.move(trigger, { origin: game.body(entity).origin, bounds: { min: { x: -8, y: -8, z: 8 }, max: { x: 8, y: 8, z: 24 } } }, false);
  trigger.touch = (self, services, contact) => {
    if (!services.host.isPlayer(contact.other)) return undefined;
    const destination = services.targets(self.target)[0], player = services.entity(contact.other);
    const owned = services.host.actors.resolveOwned(contact.other), body = services.host.bodies.read(contact.other);
    if (destination === undefined) { services.host.diagnostic(`Teleporter destination missing: ${self.target}`); return undefined; }
    if (owned === null || body === null) return undefined;
    const target = services.body(destination), origin = add(target.origin, { x: 0, y: 0, z: 10 });
    services.host.bodies.unlink(owned);
    services.host.bodies.write(owned, { ...body, origin, velocity: zero, angles: zero });
    hooks.teleportPlayer(contact.other, target.origin, target.angles);
    services.host.emit({ kind: "effect", effect: "q2:player-teleport", origin: services.body(entity).origin, direction: zero, count: 1, color: 0 });
    services.host.emit({ kind: "effect", effect: "q2:player-teleport", origin, direction: zero, count: 1, color: 0 });
    if (player !== null) killQ2Box(player, services);
    else {
      for (;;) {
        const trace = services.host.trace({ start: origin, end: origin, bounds: body.bounds, ignore: contact.other, mask: 0x2010003 });
        if (trace.hit.kind !== "actor") break;
        const victim = trace.hit.actor;
        services.host.combat.apply({ attack: { ...services.attack(self, contact.other, 21, 32, null), inflictor: contact.other },
          target: victim, amount: 100000, knockback: 0, direction: zero, point: origin, normal: zero, delivery: "direct" });
        const check = services.host.trace({ start: origin, end: origin, bounds: body.bounds, ignore: contact.other, mask: 0x2010003 });
        if (check.hit.kind === "actor" && check.hit.actor.equals(victim)) break;
      }
    }
    services.host.bodies.link(owned); return undefined;
  };
  return game.solid(trigger, "trigger");
}

function viperBomb(entity: Q2Entity, game: Q2GameServices, hooks: Q2BaseEntityHooks): undefined {
  entity.visible = false; entity.damage ||= 1000;
  model(entity, game, "models/objects/bomb/tris.md2", { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, "none");
  entity.use = (self, services, _other, activator) => {
    const viper = [...services.entities.values()].find(candidate => candidate.classname === "misc_viper");
    if (viper === undefined) { services.host.diagnostic("misc_viper_bomb has no misc_viper"); return undefined; }
    const direction = hooks.movers.getTrainDirection(viper, services), timestamp = services.host.now();
    self.visible = true; self.use = null; self.activator = activator; self.effects |= 16;
    services.move(self, { velocity: scale(direction, viper.speed) }, false);
    services.solid(self, "box"); services.motion(self, "toss"); services.show(self);
    self.prethink = (current, host) => {
      const diff = Math.max(-1, timestamp - host.host.now());
      const angles = vectorAngles({ ...scale(direction, 1 + diff), z: diff });
      host.move(current, { ground: null, angles: { ...angles, z: host.body(current).angles.z + 10 } }, false);
      return undefined;
    };
    self.touch = (current, host) => {
      host.useTargets(current, current.activator);
      if (!host.host.actors.isLive(current.actor.id)) return undefined;
      const body = host.body(current); host.move(current, { origin: { ...body.origin, z: body.origin.z + body.bounds.min.z + 1 } }, false);
      host.radiusDamage(current, current.actor.id, current.damage, null, current.damage + 40, 27);
      host.host.emit({ kind: "effect", effect: "q2:explosion2", origin: host.body(current).origin, direction: zero, count: 1, color: 0 });
      return host.remove(current);
    };
    return undefined;
  };
  return undefined;
}

export function spawnQ2BaseScenery(entity: Q2Entity, game: Q2GameServices, hooks: Q2BaseEntityHooks): boolean {
  switch (entity.classname) {
    case "viewthing":
      entity.renderFlags = 64;
      model(entity, game, "models/objects/banner/tris.md2", { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 32 } }, "box");
      animate(entity, game, 0, 7, 0.5); return true;
    case "misc_blackhole":
      entity.renderFlags = 32; entity.use = (self, services) => services.remove(self);
      model(entity, game, "models/objects/black/tris.md2", { min: { x: -64, y: -64, z: 0 }, max: { x: 64, y: 64, z: 8 } }, "none");
      animate(entity, game, 0, 19); return true;
    case "misc_eastertank":
      model(entity, game, "models/monsters/tank/tris.md2", { min: { x: -32, y: -32, z: -16 }, max: { x: 32, y: 32, z: 32 } }, "box");
      animate(entity, game, 254, 293); return true;
    case "misc_easterchick": case "misc_easterchick2":
      model(entity, game, "models/monsters/bitch/tris.md2", { min: { x: -32, y: -32, z: 0 }, max: { x: 32, y: 32, z: 32 } }, "box");
      animate(entity, game, entity.classname === "misc_easterchick" ? 208 : 248, entity.classname === "misc_easterchick" ? 247 : 287); return true;
    case "monster_commander_body": {
      entity.renderFlags |= 64; entity.flags |= 16;
      model(entity, game, "models/monsters/commandr/tris.md2", { min: { x: -32, y: -32, z: 0 }, max: { x: 32, y: 32, z: 48 } }, "box");
      game.host.combat.create(entity.actor, { health: 0, armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: true, team: null });
      const collapse: Q2Think = (self, services) => {
        self.frame++; services.show(self);
        if (self.frame === 22) services.sound(self, "tank/thud.wav", 4);
        if (self.frame < 24) services.schedule(self, services.host.frameSeconds(), collapse);
        return undefined;
      };
      entity.use = (self, services) => { services.sound(self, "tank/pain.wav", 4); return services.schedule(self, services.host.frameSeconds(), collapse); };
      game.schedule(entity, 5 * game.host.frameSeconds(), (self, services) => {
        services.move(self, { origin: add(services.body(self).origin, { x: 0, y: 0, z: 2 }) }); return services.motion(self, "toss");
      });
      return true;
    }
    case "misc_bigviper":
      model(entity, game, "models/ships/bigviper/tris.md2", { min: { x: -176, y: -120, z: -24 }, max: { x: 176, y: 120, z: 72 } }, "box"); return true;
    case "misc_viper_bomb": viperBomb(entity, game, hooks); return true;
    case "light_mine1": case "light_mine2":
      entity.model = entity.classname === "light_mine1" ? "models/objects/minelite/light1/tris.md2" : "models/objects/minelite/light2/tris.md2";
      game.link(entity); game.show(entity); return true;
    case "misc_gib_arm": case "misc_gib_leg":
      entity.model = `models/objects/gibs/${entity.classname === "misc_gib_arm" ? "arm" : "leg"}/tris.md2`;
      entity.effects |= 2; entity.serverFlags |= 4;
      entity.angularVelocity = { x: game.host.random() * 200, y: game.host.random() * 200, z: game.host.random() * 200 };
      game.host.combat.create(entity.actor, { health: 0, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
      entity.die = (self, services) => services.remove(self);
      game.motion(entity, "toss"); game.solid(entity, "none"); game.show(entity);
      game.schedule(entity, 30, (self, services) => services.remove(self)); return true;
    case "target_character":
      entity.frame = 12; game.motion(entity, "push"); game.solid(entity, "brush"); game.show(entity); return true;
    case "target_string":
      entity.use = (self, services) => {
        const team = self.spawn.values.get("team");
        for (const member of services.entities.values()) {
          if (member.count === 0 || (team === undefined ? member !== self : member.spawn.values.get("team") !== team)) continue;
          const character = self.message[member.count - 1] ?? "";
          member.frame = /^[0-9]$/.test(character) ? Number(character) : character === "-" ? 10 : character === ":" ? 11 : 12;
          services.show(member);
        }
        return undefined;
      };
      return true;
    case "func_clock": clock(entity, game, hooks); return true;
    case "misc_teleporter": teleporter(entity, game, hooks); return true;
    case "misc_teleporter_dest":
      entity.skin = 0; model(entity, game, "models/objects/dmspot/tris.md2", { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: -16 } }, "box"); return true;
    default: return false;
  }
}
