/* Remaining Quake II g_target.c targets. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { add, integerField, movedir, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Use } from "../../foundation/host.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

export const q2TargetLaserThink: Q2Think = (self, services) => {
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
    return services.schedule(self, services.host.frameSeconds(), q2TargetLaserThink);
};

export class Q2BaseTargets {
  constructor(private readonly hooks: Q2BaseEntityHooks) {}
  get callbacks(): Q2CallbackDefinitions {
    return { think: { target_laser_think: q2TargetLaserThink, target_laser_start: this.laserStart, target_laser_on: this.laserOn,
      target_laser_off: this.laserOff, target_lightramp_think: this.rampThink, target_crosslevel_target_think: this.crosslevelThink, target_earthquake_think: this.quakeThink },
      use: { target_laser_use: this.laserUse, target_lightramp_use: this.rampUse, Use_Target_Tent: this.tempUse, use_target_spawner: this.spawnerUse,
        use_target_blaster: this.blasterUse, target_crosslevel_trigger_use: this.crosslevelUse, target_earthquake_use: this.quakeUse } };
  }
  private readonly laserOn: Q2Think = (self, game) => {
    self.activator ??= self.actor.id; self.spawnflags |= 0x80000001; self.visible = true; return q2TargetLaserThink(self, game);
  };
  private readonly laserOff: Q2Think = (self, game) => {
    self.spawnflags &= ~1; self.visible = false; game.cancel(self);
    game.host.emit({ kind: "visibility", actor: self.actor.id, visible: false });
    return game.host.emit({ kind: "beam", actor: self.actor.id, start: game.body(self).origin, end: game.body(self).origin, width: self.frame, color: self.skin, visible: false });
  };
  private readonly laserUse: Q2Use = (self, game, _other, activator) => {
    self.activator = activator; return (self.spawnflags & 1) !== 0 ? this.laserOff(self, game) : this.laserOn(self, game);
  };
  private readonly laserStart: Q2Think = (self, game) => {
    self.frame = (self.spawnflags & 64) !== 0 ? 16 : 4; self.renderFlags |= 0xa0;
    self.skin = (self.spawnflags & 2) !== 0 ? 0xf2f2f0f0 : (self.spawnflags & 4) !== 0 ? 0xd0d1d2d3 :
      (self.spawnflags & 8) !== 0 ? 0xf3f3f1f1 : (self.spawnflags & 16) !== 0 ? 0xdcdddedf : (self.spawnflags & 32) !== 0 ? 0xe0e1e2e3 : 0;
    if (self.enemy === null) {
      if (self.target !== "") {
        self.enemy = game.targets(self.target)[0]?.actor.id ?? null;
        if (self.enemy === null) game.host.diagnostic(`target_laser has missing target ${self.target}`);
      } else { self.movedir = movedir(game.body(self).angles); game.move(self, { angles: zero }, false); }
    }
    self.damage ||= 1;
    game.move(self, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } }); self.use = this.laserUse;
    return (self.spawnflags & 1) !== 0 ? this.laserOn(self, game) : this.laserOff(self, game);
  };
  private readonly rampThink: Q2Think = (self, game) => {
    const target = game.entity(self.enemy); if (target === null) return undefined;
    const elapsed = game.host.now() - self.timestamp, { x: from, y: to } = self.movedir;
    const level = Math.trunc(97 + from + elapsed / self.speed * (to - from));
    game.host.emit({ kind: "lightstyle", style: integerField(target.spawn, "style"), pattern: String.fromCharCode(level & 255) });
    if (elapsed < self.speed) game.schedule(self, game.host.frameSeconds(), this.rampThink);
    else if ((self.spawnflags & 1) !== 0) self.movedir = { ...self.movedir, x: to, y: from };
    return undefined;
  };
  private readonly rampUse: Q2Use = (self, game) => {
    if (game.entity(self.enemy) === null) {
      for (const target of game.targets(self.target)) {
        if (target.classname === "light") self.enemy = target.actor.id;
        else game.host.diagnostic(`target_lightramp target ${target.classname} is not a light`);
      }
      if (self.enemy === null) { game.host.diagnostic(`target_lightramp missing target ${self.target}`); return game.remove(self); }
    }
    self.timestamp = game.host.now(); return this.rampThink(self, game);
  };
  private readonly tempUse: Q2Use = (self, game) => game.host.emit({ kind: "effect", effect: `q2:temp-${integerField(self.spawn, "style") & 255}`,
    origin: game.body(self).origin, direction: zero, count: 1, color: 0 });
  private readonly spawnerUse: Q2Use = (self, game) => {
    const body = game.body(self);
    const values = new Map<string, string>([["classname", self.target], ["origin", `${body.origin.x} ${body.origin.y} ${body.origin.z}`], ["angles", `${body.angles.x} ${body.angles.y} ${body.angles.z}`]]);
    const spawned = game.spawn({ ordinal: -1, classname: self.target, values });
    if (!game.host.actors.isLive(spawned.actor.id)) return undefined;
    game.host.bodies.unlink(spawned.actor); killQ2Box(spawned, game); game.link(spawned);
    if (self.speed !== 0) { game.move(spawned, { velocity: self.movedir }, false); game.motion(spawned, spawned.motion); }
    return undefined;
  };
  private readonly blasterUse: Q2Use = (self, game) => {
    const effects = game.options.edition === "classic" ? 8 : (self.spawnflags & 2) !== 0 ? 0 : (self.spawnflags & 1) !== 0 ? 64 : 8;
    this.hooks.weapons.fireBlaster(self, game, game.body(self).origin, self.movedir, self.damage, self.speed, effects, false, 33);
    return game.sound(self, "weapons/laser2.wav", 2);
  };
  private readonly crosslevelUse: Q2Use = (self, game) => { game.counters.serverFlags |= self.spawnflags; return game.remove(self); };
  private readonly crosslevelThink: Q2Think = (self, game) => {
    if (self.spawnflags === (game.counters.serverFlags & 255 & self.spawnflags)) { game.useTargets(self, self.actor.id); game.remove(self); }
    return undefined;
  };
  private readonly quakeThink: Q2Think = (self, game) => {
    if (self.wait < game.host.now()) { game.sound(self, "world/quake.wav", 0, 1, 0); self.wait = game.host.now() + 0.5; }
    for (const player of game.host.players()) {
      const body = game.host.bodies.read(player), actor = game.host.actors.resolveOwned(player);
      if (body === null || actor === null || body.ground === null) continue;
      const mass = game.host.combat.read(player)?.mass ?? 200;
      game.host.bodies.write(actor, { ...body, ground: null, velocity: { x: body.velocity.x + (game.host.random() * 2 - 1) * 150,
        y: body.velocity.y + (game.host.random() * 2 - 1) * 150, z: self.speed * (100 / mass) } });
    }
    if (game.host.now() < self.timestamp) game.schedule(self, game.host.frameSeconds(), this.quakeThink);
    return undefined;
  };
  private readonly quakeUse: Q2Use = (self, game, _other, activator) => {
    self.timestamp = game.host.now() + self.count; self.wait = 0; self.activator = activator;
    return game.schedule(self, game.host.frameSeconds(), this.quakeThink);
  };
  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "target_temp_entity": entity.use = this.tempUse; return true;
      case "target_spawner":
        entity.visible = false;
        if (entity.speed !== 0) { entity.movedir = scale(movedir(game.body(entity).angles), entity.speed); game.move(entity, { angles: zero }, false); }
        entity.use = this.spawnerUse; return true;
      case "target_blaster":
        entity.visible = false; entity.damage ||= 15; entity.speed ||= 1000;
        entity.movedir = movedir(game.body(entity).angles); game.move(entity, { angles: zero }, false); entity.use = this.blasterUse; return true;
      case "target_crosslevel_trigger": entity.visible = false; entity.use = this.crosslevelUse; return true;
      case "target_crosslevel_target": entity.visible = false; entity.delay ||= 1; game.schedule(entity, entity.delay, this.crosslevelThink); return true;
      case "target_laser": game.schedule(entity, 1, this.laserStart); return true;
      case "target_lightramp":
        if (!/^[a-z]{2}$/.test(entity.message) || entity.message[0] === entity.message[1] || entity.target === "" || game.options.mode === "deathmatch") {
          if (game.options.mode !== "deathmatch") game.host.diagnostic(`Invalid target_lightramp ${entity.message}`);
          game.remove(entity); return true;
        }
        entity.movedir = { x: entity.message.charCodeAt(0) - 97, y: entity.message.charCodeAt(1) - 97, z: 0 }; entity.timestamp = 0; entity.use = this.rampUse; return true;
      case "target_earthquake": entity.visible = false; entity.count ||= 5; entity.speed ||= 200; entity.timestamp = 0; entity.wait = 0; entity.use = this.quakeUse; return true;
      default: return false;
    }
  }
}
