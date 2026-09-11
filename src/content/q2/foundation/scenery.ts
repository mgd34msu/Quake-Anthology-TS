/* Breakable scenery and props adapted from Quake II game/g_misc.c. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import { add, integerField, normalize, numberField, scale, subtract, zero } from "./fields.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use, Q2Touch, Q2Die } from "./host.ts";
import { freeQ2Entity } from "./callbacks.ts";
import { throwGib, throwHead } from "./monsters/gibs.ts";

export function throwQ2Debris(self: Q2Entity, game: Q2GameServices, model: string, speed: number, origin: Vec3): Q2Entity {
  const chunk = game.create("debris"); chunk.model = model;
  const randomVelocity = { x: 100 * (game.host.random() * 2 - 1), y: 100 * (game.host.random() * 2 - 1), z: 100 + 100 * (game.host.random() * 2 - 1) };
  game.move(chunk, { origin, velocity: add(game.body(self).velocity, scale(randomVelocity, speed)) }, false);
  chunk.angularVelocity = { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 };
  game.host.combat.create(chunk.actor, { health: 0, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
  chunk.die = freeQ2Entity;
  game.motion(chunk, "bounce"); game.solid(chunk, "none"); game.show(chunk);
  game.schedule(chunk, 5 + game.host.random() * 5, freeQ2Entity);
  return chunk;
}

function explode(entity: Q2Entity, game: Q2GameServices, type = 1): undefined {
  game.host.emit({ kind: "effect", effect: `q2:explosion${type}`, origin: game.body(entity).origin, direction: zero, count: 1, color: 0 });
  return game.remove(entity);
}

export function killQ2Box(entity: Q2Entity, game: Q2GameServices): boolean {
  for (;;) {
    const body = game.body(entity);
    const trace = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, mask: 0x2010003 });
    if (trace.hit.kind !== "actor") return !trace.startSolid && !trace.allSolid;
    const victim = trace.hit.actor;
    if (game.host.combat.read(victim) === null) return false;
    game.damage(victim, entity, entity.actor.id, 100000, 0, zero, body.origin, zero, 21, 32);
    const live = game.entity(victim);
    if (live === null) {
      // Foreign actors retain solid state in the scene. Requery instead of assuming death unlinked them.
      const next = game.host.trace({ start: body.origin, end: body.origin, bounds: body.bounds, ignore: entity.actor.id, mask: 0x2010003 });
      return next.hit.kind !== "actor" || !next.hit.actor.equals(victim);
    }
    if (live.solid !== "none") return false;
  }
}

function wall(entity: Q2Entity, game: Q2GameServices): undefined {
  game.motion(entity, "push");
  if ((entity.spawnflags & 8) !== 0) entity.effects |= 0x1000;
  if ((entity.spawnflags & 16) !== 0) entity.effects |= 0x2000;
  if ((entity.spawnflags & 7) === 0) { game.solid(entity, "brush"); return game.show(entity); }
  entity.spawnflags |= 1;
  if ((entity.spawnflags & 4) !== 0) entity.spawnflags |= 2;
  entity.visible = (entity.spawnflags & 4) !== 0;
  game.solid(entity, entity.visible ? "brush" : "none"); game.show(entity);
  entity.use = func_wall_use;
  return undefined;
}

function explosive(entity: Q2Entity, game: Q2GameServices): undefined {
  if (game.options.mode === "deathmatch") return game.remove(entity);
  game.motion(entity, "push");
  if ((entity.spawnflags & 2) !== 0) entity.effects |= 0x1000;
  if ((entity.spawnflags & 4) !== 0) entity.effects |= 0x2000;
  
  if ((entity.spawnflags & 1) !== 0) {
    entity.visible = false;
    entity.use = func_explosive_spawn;
  } else if (entity.targetname !== "") entity.use = func_explosive_use;
  if ((entity.spawnflags & 1) !== 0 || entity.targetname === "") {
    entity.maxHealth ||= 100;
    game.host.combat.create(entity.actor, { health: entity.maxHealth, armor: { kind: "none" }, mass: numberField(entity.spawn, "mass") || 75, canTakeDamage: true, invulnerable: false, team: null });
    entity.die = func_explosive_die;
  }
  game.solid(entity, entity.visible ? "brush" : "none"); game.show(entity);
  return undefined;
}

function barrel(entity: Q2Entity, game: Q2GameServices): undefined {
  if (game.options.mode === "deathmatch") return game.remove(entity);
  entity.model = "models/objects/barrels/tris.md2"; entity.maxHealth ||= 10; entity.damage ||= 150;
  const mass = numberField(entity.spawn, "mass") || 400;
  game.host.combat.create(entity.actor, { health: entity.maxHealth, armor: { kind: "none" }, mass, canTakeDamage: true, invulnerable: false, team: null });
  game.move(entity, { bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 40 } } }, false);
  game.solid(entity, "box"); game.motion(entity, "step"); game.show(entity);
  
  entity.die = barrel_delay;
  entity.touch = barrel_touch;
  game.schedule(entity, 2 * game.host.frameSeconds(), barrelDropToFloor);
  return undefined;
}

export function createQ2SceneryModule(): Q2SpawnModule {
  return { callbacks: sceneryCallbacks, spawn(entity, game) {
    switch (entity.classname) {
      case "func_wall": wall(entity, game); return true;
      case "func_explosive": explosive(entity, game); return true;
      case "misc_explobox": barrel(entity, game); return true;
      case "misc_banner": {
        entity.model = "models/objects/banner/tris.md2"; entity.frame = Math.floor(game.host.random() * 16);
        
        game.show(entity); game.link(entity); game.schedule(entity, 0.1, bannerThink); return true;
      }
      case "misc_satellite_dish": {
        entity.model = "models/objects/satellite/tris.md2";
        game.move(entity, { bounds: { min: { x: -64, y: -64, z: 0 }, max: { x: 64, y: 64, z: 128 } } }, false);
        
        entity.use = satellite_use;
        game.solid(entity, "box"); game.show(entity); return true;
      }
      case "misc_deadsoldier": {
        if (game.options.mode === "deathmatch") { game.remove(entity); return true; }
        entity.model = "models/deadbods/dude/tris.md2";
        entity.frame = (entity.spawnflags & 2) !== 0 ? 1 : (entity.spawnflags & 4) !== 0 ? 2 : (entity.spawnflags & 8) !== 0 ? 3 : (entity.spawnflags & 16) !== 0 ? 4 : (entity.spawnflags & 32) !== 0 ? 5 : 0;
        entity.serverFlags |= 12;
        game.host.combat.create(entity.actor, { health: integerField(entity.spawn, "health"), armor: { kind: "none" }, mass: 200, canTakeDamage: true, invulnerable: false, team: null });
        game.move(entity, { bounds: { min: { x: -16, y: -16, z: 0 }, max: { x: 16, y: 16, z: 16 } } }, false);
        entity.die = misc_deadsoldier_die;
        game.solid(entity, "box"); game.show(entity); return true;
      }
      case "misc_gib_head": {
        entity.model = "models/objects/gibs/head/tris.md2"; entity.effects |= 2; entity.serverFlags |= 4;
        entity.angularVelocity = { x: game.host.random() * 200, y: game.host.random() * 200, z: game.host.random() * 200 };
        game.host.combat.create(entity.actor, { health: 0, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
        entity.die = freeQ2Entity;
        game.motion(entity, "toss"); game.solid(entity, "none"); game.show(entity);
        game.schedule(entity, 30, freeQ2Entity); return true;
      }
      default: return false;
    }
  } };
}

const func_wall_use: Q2Use = (self, services) => {
    self.visible = self.solid === "none";
    services.solid(self, self.visible ? "brush" : "none");
    if (self.visible) killQ2Box(self, services);
    services.show(self);
    if ((self.spawnflags & 2) === 0) self.use = null;
    return undefined;
  };

const breakApart = (self: Q2Entity, services: Q2GameServices, inflictor: ActorId | null, attacker: ActorId | null): undefined => {
    const body = services.body(self), size = scale(subtract(body.bounds.max, body.bounds.min), 0.5);
    const origin = add(add(body.origin, body.bounds.min), size);
    services.move(self, { origin }, false);
    if (services.host.combat.read(self.actor.id) !== null) services.host.combat.setTraits(self.actor, { canTakeDamage: false });
    if (self.damage !== 0) services.radiusDamage(self, attacker, self.damage, null, self.damage + 40, 25);
    const from = inflictor === null ? origin : services.host.bodies.read(inflictor)?.origin ?? origin;
    services.move(self, { velocity: scale(normalize(subtract(origin, from)), 150) }, false);
    const mass = numberField(self.spawn, "mass") || 75;
    const randomPoint = (): Vec3 => add(origin, { x: (services.host.random() * 2 - 1) * size.x * 0.5,
      y: (services.host.random() * 2 - 1) * size.y * 0.5, z: (services.host.random() * 2 - 1) * size.z * 0.5 });
    for (let index = 0; index < Math.min(Math.trunc(mass / 100), 8); index++) throwQ2Debris(self, services, "models/objects/debris1/tris.md2", 1, randomPoint());
    for (let index = 0; index < Math.min(Math.trunc(mass / 25), 16); index++) throwQ2Debris(self, services, "models/objects/debris2/tris.md2", 2, randomPoint());
    services.useTargets(self, attacker);
    return self.damage !== 0 ? explode(self, services) : services.remove(self);
  };

const func_explosive_spawn: Q2Use = (self, services) => { self.visible = true; self.use = null; services.solid(self, "brush"); killQ2Box(self, services); return services.show(self); };

const func_explosive_use: Q2Use = (self, services, other) => breakApart(self, services, self.actor.id, other);

const func_explosive_die: Q2Die = (self, services, reaction) => breakApart(self, services, reaction.inflictor, reaction.attacker);

const blast: Q2Think = (self, services) => {
    services.radiusDamage(self, self.activator ?? self.actor.id, self.damage, null, self.damage + 40, 26);
    const body = services.body(self), size = subtract(body.bounds.max, body.bounds.min);
    const low = add(body.origin, body.bounds.min), center = add(low, scale(size, 0.5));
    const randomPoint = (): Vec3 => add(center, { x: (services.host.random() * 2 - 1) * size.x,
      y: (services.host.random() * 2 - 1) * size.y, z: (services.host.random() * 2 - 1) * size.z });
    for (let count = 0; count < 2; count++) throwQ2Debris(self, services, "models/objects/debris1/tris.md2", 1.5 * self.damage / 200, randomPoint());
    for (const point of [low, add(low, { x: size.x, y: 0, z: 0 }), add(low, { x: 0, y: size.y, z: 0 }), add(low, { x: size.x, y: size.y, z: 0 })]) {
      throwQ2Debris(self, services, "models/objects/debris3/tris.md2", 1.75 * self.damage / 200, point);
    }
    for (let count = 0; count < 8; count++) throwQ2Debris(self, services, "models/objects/debris2/tris.md2", 2 * self.damage / 200, randomPoint());
    return explode(self, services, body.ground === null ? 1 : 2);
  };

const barrel_delay: Q2Die = (self, services, reaction) => {
    services.host.combat.setTraits(self.actor, { canTakeDamage: false }); self.activator = reaction.attacker;
    return services.schedule(self, 2 * services.host.frameSeconds(), blast);
  };

const barrel_touch: Q2Touch = (self, services, contact) => {
    const other = services.host.bodies.read(contact.other), state = services.host.combat.read(contact.other);
    if (other === null || state === null || other.ground === null || other.ground.equals(self.actor.id)) return undefined;
    const body = services.body(self), delta = subtract(body.origin, other.origin);
    const direction = normalize({ x: delta.x, y: delta.y, z: 0 });
    const end = add(body.origin, scale(direction, 20 * state.mass / (services.host.combat.read(self.actor.id)?.mass ?? 400) * services.host.frameSeconds()));
    const trace = services.host.trace({ start: body.origin, end, bounds: body.bounds, ignore: self.actor.id, mask: 0x2010003 });
    if (trace.fraction === 1) services.move(self, { origin: trace.end });
    return undefined;
  };

const barrelDropToFloor: Q2Think = (self, services) => {
    const body = services.body(self), start = add(body.origin, { x: 0, y: 0, z: 1 });
    const trace = services.host.trace({ start, end: add(start, { x: 0, y: 0, z: -256 }), bounds: body.bounds, ignore: self.actor.id, mask: 0x2010003 });
    if (!trace.allSolid && trace.fraction < 1) services.move(self, { origin: trace.end, ground: trace.hit.kind === "actor" ? trace.hit.actor : trace.hit.kind === "world" ? services.host.worldActor() : null });
    return undefined;
  };

const bannerThink: Q2Think = (self, services) => { self.frame = (self.frame + 1) % 16; services.show(self); return services.schedule(self, 0.1, bannerThink); };

const satelliteThink: Q2Think = (self, services) => {
          self.frame++; services.show(self);
          if (self.frame < 38) services.schedule(self, 0.1, satelliteThink);
          return undefined;
        };

const satellite_use: Q2Use = (self, services) => { self.frame = 0; return services.schedule(self, 0.1, satelliteThink); };

const misc_deadsoldier_die: Q2Die = (self, services, reaction) => {
          if ((services.host.combat.read(self.actor.id)?.health ?? 0) > -80) return undefined;
          services.sound(self, "misc/udeath.wav", 4);
          for (let count = 0; count < 4; count++) throwGib(self, services, "models/objects/gibs/sm_meat/tris.md2", reaction.damage);
          throwHead(self, services, "models/objects/gibs/head2/tris.md2", reaction.damage);
          return undefined;
        };

const sceneryCallbacks = {
think:{barrel_explode:blast,barrel_drop_to_floor:barrelDropToFloor,misc_banner_think:bannerThink,misc_satellite_dish_think:satelliteThink},
use: { func_wall_use, func_explosive_spawn, func_explosive_use, satellite_use },
touch: { barrel_touch },
die: { func_explosive_die, barrel_delay, misc_deadsoldier_die }
};
