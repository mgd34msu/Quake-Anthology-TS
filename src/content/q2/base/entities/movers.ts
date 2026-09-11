/* Quake II g_func.c platforms, secret doors and supporting brush entities. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import { add, dot, integerField, numberField, scale, subtract, zero } from "../../foundation/fields.ts";
import type { Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { Q2LinearMotion } from "../../foundation/motion.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import { angleVectors } from "../../foundation/weapons/vectors.ts";
import type { Q2BaseEntityHooks } from "./types.ts";

export interface Q2PlatformState {
  readonly top: Vec3;
  readonly bottom: Vec3;
  phase: "top" | "bottom" | "up" | "down";
}

function loop(entity: Q2Entity, game: Q2GameServices, path: string, start: boolean): undefined {
  return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path,
    channel: 2, volume: 1, attenuation: 3, reliable: false, loop: start ? "start" : "stop" });
}

function portals(entity: Q2Entity, game: Q2GameServices, open: boolean): undefined {
  for (const portal of game.targets(entity.target)) if (portal.classname === "func_areaportal") game.host.setAreaPortal(integerField(portal.spawn, "style"), open);
  return undefined;
}

/** Returns false after destroying a non-player obstruction, matching source blocked callbacks. */
function crush(entity: Q2Entity, game: Q2GameServices, other: ActorId): boolean {
  const body = game.host.bodies.read(other);
  if (body === null) return false;
  if (!game.host.isPlayer(other) && !game.host.isMonster(other)) {
    if (game.host.combat.read(other)?.canTakeDamage === true) game.damage(other, entity, entity.actor.id, 100000, 1, zero, body.origin, zero, 20);
    const obstacle = game.entity(other);
    if (obstacle !== null) {
      game.host.emit({ kind: "effect", effect: "q2:explosion1", origin: body.origin, direction: zero, count: 1, color: 0 }); game.remove(obstacle);
    }
    return false;
  }
  game.damage(other, entity, entity.actor.id, entity.damage, 1, zero, body.origin, zero, 20);
  return true;
}

export class Q2BaseMoverEntities {
  readonly linear = new Q2LinearMotion();
  private readonly platforms = new WeakMap<Q2Entity, Q2PlatformState>();
  constructor(private readonly hooks: Q2BaseEntityHooks) {}

  platformState(entity: Q2Entity): Readonly<Q2PlatformState> | null { return this.platforms.get(entity) ?? null; }

  private platform(entity: Q2Entity): Q2PlatformState {
    const state = this.platforms.get(entity);
    if (state === undefined) throw new Error("Platform callback without platform state");
    return state;
  }

  private platformSound(entity: Q2Entity, game: Q2GameServices, start: boolean): undefined {
    game.sound(entity, start ? "plats/pt1_strt.wav" : "plats/pt1_end.wav", 2, 1, 3);
    return loop(entity, game, "plats/pt1_mid.wav", start);
  }

  private readonly bottom: Q2Think = (entity, game) => {
    this.platform(entity).phase = "bottom"; return this.platformSound(entity, game, false);
  };

  private readonly top: Q2Think = (entity, game) => {
    this.platform(entity).phase = "top"; this.platformSound(entity, game, false);
    return game.schedule(entity, 3, this.down);
  };

  private readonly down: Q2Think = (entity, game) => {
    const state = this.platform(entity); state.phase = "down"; this.platformSound(entity, game, true);
    return this.linear.moveTo(entity, game, state.bottom, this.bottom);
  };

  private readonly up: Q2Think = (entity, game) => {
    const state = this.platform(entity); state.phase = "up"; this.platformSound(entity, game, true);
    return this.linear.moveTo(entity, game, state.top, this.top);
  };

  private spawnPlatform(entity: Q2Entity, game: Q2GameServices): undefined {
    game.move(entity, { angles: zero }, false); game.solid(entity, "brush"); game.motion(entity, "push");
    entity.speed = entity.speed === 0 ? 20 : entity.speed * 0.1;
    entity.accel = entity.accel === 0 ? 5 : entity.accel * 0.1;
    entity.decel = entity.decel === 0 ? 5 : entity.decel * 0.1;
    entity.damage ||= 2;
    const body = game.body(entity), lip = numberField(entity.spawn, "lip") || 8;
    const height = numberField(entity.spawn, "height") || body.bounds.max.z - body.bounds.min.z - lip;
    const top = body.origin, bottom = { ...top, z: top.z - height };
    const state: Q2PlatformState = { top, bottom, phase: entity.targetname !== "" ? "up" : "bottom" };
    this.platforms.set(entity, state);
    entity.use = (self, services) => self.think !== null ? undefined : this.down(self, services);
    entity.blocked = (self, services, other) => {
      if (!crush(self, services, other)) return undefined;
      const phase = this.platform(self).phase;
      return phase === "up" ? this.down(self, services) : phase === "down" ? this.up(self, services) : undefined;
    };
    const trigger = game.create("plat_trigger"); trigger.enemy = entity.actor.id; trigger.visible = false;
    let minX = body.bounds.min.x + 25, maxX = body.bounds.max.x - 25;
    let minY = body.bounds.min.y + 25, maxY = body.bounds.max.y - 25;
    const minZ = body.bounds.max.z + 8 - (height + lip);
    if (maxX - minX <= 0) { minX = (body.bounds.min.x + body.bounds.max.x) * 0.5; maxX = minX + 1; }
    if (maxY - minY <= 0) { minY = (body.bounds.min.y + body.bounds.max.y) * 0.5; maxY = minY + 1; }
    game.move(trigger, { bounds: { min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: (entity.spawnflags & 1) !== 0 ? minZ + 8 : body.bounds.max.z + 8 } } }, false);
    trigger.touch = (_self, services, contact) => {
      if (!services.host.isPlayer(contact.other) || (services.host.combat.read(contact.other)?.health ?? 0) <= 0) return undefined;
      if (state.phase === "bottom") return this.up(entity, services);
      if (state.phase === "top") return services.schedule(entity, 1, this.down);
      return undefined;
    };
    game.solid(trigger, "trigger");
    if (entity.targetname === "") game.move(entity, { origin: bottom });
    return game.show(entity);
  }

  private spawnSecret(entity: Q2Entity, game: Q2GameServices): undefined {
    const axes = angleVectors(game.body(entity).angles);
    game.move(entity, { angles: zero }, false); game.solid(entity, "brush"); game.motion(entity, "push");
    const body = game.body(entity), size = subtract(body.bounds.max, body.bounds.min);
    const width = Math.abs(dot((entity.spawnflags & 4) !== 0 ? axes.up : axes.right, size));
    const length = Math.abs(dot(axes.forward, size));
    const first = add(body.origin, scale((entity.spawnflags & 4) !== 0 ? axes.up : axes.right, (entity.spawnflags & 4) !== 0 ? -width : (1 - (entity.spawnflags & 2)) * width));
    const second = add(first, scale(axes.forward, length));
    const home = zero;
    entity.damage ||= 2; entity.wait ||= 5; entity.speed = 50; entity.accel = 50; entity.decel = 50;
    let blockedTime = 0, messageTime = 0;
    const shootable = entity.targetname === "" || (entity.spawnflags & 1) !== 0;
    if (shootable || entity.maxHealth !== 0) game.host.combat.create(entity.actor, { health: shootable ? 0 : entity.maxHealth,
      armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    const done: Q2Think = (self, services) => {
      if (shootable) { services.host.combat.setHealth(self.actor, 0); services.host.combat.setTraits(self.actor, { canTakeDamage: true }); }
      return portals(self, services, false);
    };
    const returnHome: Q2Think = (self, services) => this.linear.moveTo(self, services, home, done);
    const returnPause: Q2Think = (self, services) => services.schedule(self, 1, returnHome);
    const returnFirst: Q2Think = (self, services) => this.linear.moveTo(self, services, first, returnPause);
    const opened: Q2Think = (self, services) => self.wait === -1 ? undefined : services.schedule(self, self.wait, returnFirst);
    const goSecond: Q2Think = (self, services) => this.linear.moveTo(self, services, second, opened);
    const firstPause: Q2Think = (self, services) => services.schedule(self, 1, goSecond);
    entity.use = (self, services) => {
      const origin = services.body(self).origin;
      if (origin.x !== home.x || origin.y !== home.y || origin.z !== home.z) return undefined;
      this.linear.moveTo(self, services, first, firstPause);
      return portals(self, services, true);
    };
    if (shootable || entity.maxHealth !== 0) entity.die = (self, services, reaction) => {
      services.host.combat.setTraits(self.actor, { canTakeDamage: false });
      return self.use?.(self, services, reaction.attacker, reaction.attacker);
    };
    else if (entity.targetname !== "" && entity.message !== "") entity.touch = (self, services, contact) => {
      if (!services.host.isPlayer(contact.other) || messageTime > services.host.now()) return undefined;
      messageTime = services.host.now() + 5;
      services.host.emit({ kind: "centerprint", actor: contact.other, text: self.message });
      return services.sound(self, "misc/talk1.wav", 0);
    };
    entity.blocked = (self, services, other) => {
      if (!services.host.isPlayer(other) && !services.host.isMonster(other)) { crush(self, services, other); return undefined; }
      if (blockedTime > services.host.now()) return undefined;
      blockedTime = services.host.now() + 0.5; crush(self, services, other);
      return undefined;
    };
    return game.show(entity);
  }

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "func_plat": this.spawnPlatform(entity, game); return true;
      case "func_door_secret": this.spawnSecret(entity, game); return true;
      case "trigger_elevator":
        game.schedule(entity, game.host.frameSeconds(), (self, services) => {
          const train = services.pickTarget(self.target);
          if (train === null || train.classname !== "func_train") { services.host.diagnostic(`trigger_elevator has invalid train ${self.target}`); return undefined; }
          self.visible = false;
          self.use = (_current, host, other) => {
            if (train.nextThink !== null) return undefined;
            const path = host.entity(other)?.spawn.values.get("pathtarget") ?? "";
            const corner = host.pickTarget(path);
            if (corner === null) { host.host.diagnostic(`trigger_elevator used with invalid pathtarget ${path}`); return undefined; }
            return this.hooks.movers.resumeTrainAt(train, host, corner);
          };
          return undefined;
        });
        return true;
      case "func_conveyor":
        entity.speed ||= 100;
        if ((entity.spawnflags & 1) === 0) { entity.count = entity.speed; entity.speed = 0; }
        game.solid(entity, "brush"); game.show(entity);
        entity.use = (self) => {
          if ((self.spawnflags & 1) !== 0) { self.speed = 0; self.spawnflags &= ~1; }
          else { self.speed = self.count; self.spawnflags |= 1; }
          if ((self.spawnflags & 2) === 0) self.count = 0;
          return undefined;
        };
        return true;
      case "func_killbox":
        entity.visible = false; game.solid(entity, "none");
        entity.use = (self, services) => { killQ2Box(self, services); return undefined; };
        return true;
      case "func_object": {
        game.solid(entity, "brush"); game.motion(entity, "push"); entity.damage ||= 100;
        const original = game.body(entity).bounds;
        const bounds = { min: add(original.min, { x: 1, y: 1, z: 1 }), max: add(original.max, { x: -1, y: -1, z: -1 }) };
        const release: Q2Think = (self, services) => {
          services.motion(self, "toss");
          self.touch = (current, host, contact) => {
            if (contact.plane === null || contact.plane.normal.z < 1 || host.host.combat.read(contact.other)?.canTakeDamage !== true) return undefined;
            host.damage(contact.other, current, current.actor.id, current.damage, 1, zero, host.body(current).origin, zero, 20);
            return undefined;
          };
          return undefined;
        };
        if (entity.spawnflags === 0) game.schedule(entity, 2 * game.host.frameSeconds(), release);
        else {
          entity.visible = false; game.solid(entity, "none");
          entity.use = (self, services) => {
            self.visible = true; self.use = null; services.solid(self, "brush"); services.move(self, { bounds });
            killQ2Box(self, services); services.show(self); return release(self, services);
          };
        }
        if ((entity.spawnflags & 2) !== 0) entity.effects |= 0x1000;
        if ((entity.spawnflags & 4) !== 0) entity.effects |= 0x2000;
        entity.clipMask = 0x2010003; game.move(entity, { bounds }); game.show(entity);
        return true;
      }
      default: return false;
    }
  }
}
