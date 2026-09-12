/* Xatrix g_weapon.c and Rogue g_newweap.c projectile callbacks. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, dot, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { q2MissionPackDamage as mod } from "../types.ts";
import type { Q2MissionPackProjectileHooks } from "../types.ts";
import { effect, explode, freeProjectile, projectile, projectileMask, publishProjectile, sight, velocity } from "./common.ts";

export class Q2MissionPackBolts {
  constructor(readonly hooks: Q2MissionPackProjectileHooks) {}

  get callbacks(): Q2CallbackDefinitions { return {
    think: { "missionpack.free": freeProjectile, "ionripper_sparks": this.ionSparks,
      "heat_think": this.heatThink, "rerelease/heat_think": this.heatThinkRerelease, "tracker_fly": this.trackerFly, "tracker_pain_daemon_think": this.trackerPain },
    touch: { "ionripper_touch": this.ionTouch, "plasma_touch": this.plasmaTouch,
      "flechette_touch": this.flechetteTouch, "blaster2_touch": this.greenTouch, "tracker_touch": this.trackerTouch },
  }; }

  private register(game: Q2GameServices): undefined { return game.sourceCallbacks.register(this.callbacks); }

  protected playerCollision(self: Pick<Q2Entity, "actor">, game: Q2GameServices, projectile: Q2Entity): undefined {
    if (game.options.edition === "rerelease" && game.host.isPlayer(self.actor.id) && this.hooks.base.inputs.get(self.actor.id)?.playersCollide === false) projectile.clipMask &= ~0x40000000;
    return undefined;
  }

  private impactNoise(entity: Q2Entity, game: Q2GameServices): undefined {
    const owner = entity.owner;
    return owner === null ? undefined : this.hooks.base.playerNoiseForActor(owner, game, game.body(entity).origin, "impact");
  }

  private initialTouch(self: Pick<Q2Entity, "actor">, game: Q2GameServices, bolt: Q2Entity): undefined {
    const trace = game.host.trace({ start: game.body(self).origin, end: game.body(bolt).origin,
      bounds: null, ignore: bolt.actor.id, mask: bolt.clipMask });
    if (trace.fraction === 1 || bolt.touch === null) return undefined;
    const rerelease = game.options.edition === "rerelease";
    const plane = trace.contact.kind === "plane" ? trace.contact.plane : null;
    game.move(bolt, { origin: rerelease ? add(trace.end, plane?.normal ?? zero) : add(game.body(bolt).origin, scale(bolt.movedir, -10)) });
    return bolt.touch(bolt, game, { self: bolt.actor, other: trace.hit.kind === "actor" ? trace.hit.actor : game.host.worldActor(),
      plane: rerelease ? plane : null, surface: rerelease && trace.kind === "q2" && trace.surface !== null
        ? { name: trace.surface.name, nativeFlags: trace.surface.flags, nativeValue: trace.surface.value } : null });
  }

  private readonly ionSparks: Q2Think = (entity, game) => {
    effect(entity, game, "welding_sparks", zero, 0, 0xe4 + Math.floor(game.host.random() * 4));
    return game.remove(entity);
  };

  private readonly ionTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other === entity.owner) return undefined;
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    this.impactNoise(entity, game);
    if (game.host.combat.read(contact.other)?.canTakeDamage !== true) return undefined;
    game.damage(contact.other, entity, entity.owner, entity.damage, 1, game.body(entity).velocity,
      game.body(entity).origin, contact.plane?.normal ?? zero, mod.ripper, 4, "q2:weapon_boomer");
    return game.remove(entity);
  };

  fireIonRipper(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number): Q2Entity {
    this.register(game);
    const bolt = projectile(self, game, "ion", start, normalize(direction), speed, "models/objects/boomrang/tris.md2", "wall-bounce", effects);
    this.playerCollision(self, game, bolt);
    bolt.damage = damage; bolt.damageRadius = 100; bolt.renderFlags = 8; bolt.touch = this.ionTouch;
    game.schedule(bolt, 3, this.ionSparks); publishProjectile(bolt, game, "misc/lasfly.wav");
    this.hooks.base.checkDodge(self, game, start, bolt.movedir, speed); this.initialTouch(self, game, bolt);
    return bolt;
  }

  fireBlueBlaster(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number): Q2Entity {
    const bolt = this.hooks.base.fireBlaster(self, game, start, direction, damage, speed, effects, false, game.options.edition === "rerelease" ? 58 : 1);
    if (game.host.actors.isLive(bolt.actor.id)) { bolt.model = "models/objects/blaser/tris.md2"; game.show(bolt); }
    return bolt;
  }

  private readonly heatThink: Q2Think = (entity, game) => {
    let nearest: ActorId | null = null, nearestDistance = 0;
    const origin = game.body(entity).origin, forward = angleVectors(game.body(entity).angles).forward;
    for (const actor of game.host.nearby(origin, 1024)) {
      if (actor === entity.owner || !game.host.isPlayer(actor) || (game.host.combat.read(actor)?.health ?? 0) <= 0 || !sight(game, entity, actor)) continue;
      const body = game.host.bodies.read(actor);
      if (body === null) continue;
      const delta = subtract(body.origin, origin), distance = Math.trunc(length(delta));
      if (dot(normalize(delta), forward) <= 0.3) continue;
      if (nearest === null || distance < nearestDistance) { nearest = actor; nearestDistance = distance; }
    }
    const target = nearest === null ? null : game.host.bodies.read(nearest);
    if (target !== null) {
      entity.enemy = nearest; entity.movedir = normalize(subtract(target.origin, origin));
      game.move(entity, { angles: vectorAngles(entity.movedir), velocity: scale(entity.movedir, 500) });
      game.motion(entity, entity.motion);
    }
    return game.schedule(entity, 0.1, this.heatThink);
  };

  private readonly heatThinkRerelease: Q2Think = (entity, game) => {
    let acquire: ActorId | null = null, oldDot = 1, oldDistance = 0;
    const origin = game.body(entity).origin, forward = angleVectors(game.body(entity).angles).forward;
    for (const actor of game.host.nearby(origin, 1024)) {
      if (actor === entity.owner || !game.host.isPlayer(actor) || (game.host.combat.read(actor)?.health ?? 0) <= 0 || !sight(game, entity, actor)) continue;
      const body = game.host.bodies.read(actor);
      if (body === null) continue;
      const delta = subtract(origin, body.origin), distance = length(delta), alignment = dot(normalize(delta), forward);
      if (alignment >= oldDot) continue;
      if (acquire === null || alignment < oldDot || distance < oldDistance) { acquire = actor; oldDot = alignment; oldDistance = distance; }
    }
    const target = acquire === null ? null : game.host.bodies.read(acquire);
    if (target === null) entity.enemy = null;
    else {
      let desired = normalize(subtract(target.origin, origin));
      const alignment = dot(entity.movedir, desired);
      if (alignment < 0.45 && alignment > -0.45) desired = scale(desired, -1);
      const cosine = dot(entity.movedir, desired), angle = Math.acos(cosine), sine = Math.sin(angle);
      const from = Math.abs(cosine) > 0.9995 ? 1 - entity.accel : Math.sin((1 - entity.accel) * angle) / sine;
      const to = Math.abs(cosine) > 0.9995 ? entity.accel : Math.sin(entity.accel * angle) / sine;
      entity.movedir = normalize(add(scale(entity.movedir, from), scale(desired, to)));
      game.move(entity, { angles: vectorAngles(entity.movedir) });
      if (entity.enemy === null) { game.sound(entity, "weapons/railgr1a.wav", 1, 1, 0.25); entity.enemy = acquire; }
    }
    game.move(entity, { velocity: scale(entity.movedir, entity.speed) }); game.motion(entity, entity.motion);
    return game.schedule(entity, game.host.frameSeconds(), this.heatThinkRerelease);
  };

  fireHeatRocket(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, radius: number, radiusDamage: number, turnFraction = 0.075): Q2Entity {
    this.register(game);
    const rocket = this.hooks.base.fireRocket(self, game, start, direction, damage, speed, radius, radiusDamage);
    if (game.host.actors.isLive(rocket.actor.id)) {
      rocket.accel = turnFraction; rocket.speed = speed; rocket.movedir = direction;
      game.schedule(rocket, game.options.edition === "rerelease" ? game.host.frameSeconds() : 0.1, game.options.edition === "rerelease" ? this.heatThinkRerelease : this.heatThink);
    }
    return rocket;
  }

  private readonly plasmaTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other === entity.owner) return undefined;
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    this.impactNoise(entity, game);
    const body = game.body(entity);
    if (game.host.combat.read(contact.other)?.canTakeDamage === true)
      game.damage(contact.other, entity, entity.owner, entity.damage, 0, body.velocity, body.origin, contact.plane?.normal ?? zero, mod.phalanx, 0, "q2:weapon_phalanx");
    game.radiusDamage(entity, entity.owner, entity.radiusDamage, contact.other, entity.damageRadius, mod.phalanx, 0, "q2:weapon_phalanx");
    game.host.emit({ kind: "effect", effect: "q2:plasma_explosion", origin: add(body.origin, scale(body.velocity, -0.02)), direction: zero, count: 0, color: 0 });
    return game.remove(entity);
  };

  firePlasma(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, radius: number, radiusDamage: number): Q2Entity {
    this.register(game);
    const bolt = projectile(self, game, "plasma", start, direction, speed, "sprites/s_photon.sp2", "fly-missile", 0x1000000 | 0x2000);
    this.playerCollision(self, game, bolt);
    bolt.damage = damage; bolt.damageRadius = radius; bolt.radiusDamage = radiusDamage; bolt.touch = this.plasmaTouch;
    game.schedule(bolt, 8000 / speed, freeProjectile); publishProjectile(bolt, game, "weapons/rockfly.wav");
    this.hooks.base.checkDodge(self, game, start, direction, speed); return bolt;
  }

  private readonly flechetteTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other === entity.owner) return undefined;
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    if (game.host.combat.read(contact.other)?.canTakeDamage === true)
      game.damage(contact.other, entity, entity.owner, entity.damage, entity.damageRadius, game.body(entity).velocity,
        game.body(entity).origin, contact.plane?.normal ?? zero, mod.flechette, 128, "q2:weapon_etf_rifle");
    else effect(entity, game, "flechette", contact.plane?.normal ?? zero);
    return game.remove(entity);
  };

  fireFlechette(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, kick: number): Q2Entity {
    this.register(game);
    const bolt = projectile(self, game, "flechette", start, normalize(direction), speed, "models/proj/flechette/tris.md2", "fly-missile", 0);
    this.playerCollision(self, game, bolt);
    bolt.damage = damage; bolt.damageRadius = kick; bolt.renderFlags = 8; bolt.touch = this.flechetteTouch;
    game.schedule(bolt, 8000 / speed, freeProjectile); publishProjectile(bolt, game);
    if (game.options.edition === "rerelease") this.initialTouch(self, game, bolt);
    else this.hooks.base.checkDodge(self, game, start, bolt.movedir, speed);
    return bolt;
  }

  private readonly greenTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other === entity.owner) return undefined;
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    this.impactNoise(entity, game);
    const origin = game.body(entity).origin, hurt = game.host.combat.read(contact.other)?.canTakeDamage === true;
    if (entity.damage >= 5) {
      // The C callback temporarily disables owner damage; excluding it preserves that scope without changing shared traits.
      for (const actor of game.host.nearby(origin, entity.damageRadius)) {
        if (actor === entity.owner || hurt && actor === contact.other || game.host.combat.read(actor)?.canTakeDamage !== true) continue;
        const body = game.host.bodies.read(actor);
        if (body === null || !game.canDamage(actor, entity)) continue;
        const points = entity.damage * (game.options.edition === "rerelease" ? 2 : 3) - 0.5 * length(subtract(add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)), origin));
        if (points > 0) game.damage(actor, entity, entity.owner, Math.trunc(points), Math.trunc(points), subtract(body.origin, origin), origin, zero, 0, game.options.edition === "rerelease" ? 5 : 1);
      }
    }
    if (hurt) game.damage(contact.other, entity, entity.owner, entity.damage, 1, game.body(entity).velocity, origin,
      contact.plane?.normal ?? zero, entity.owner !== null && game.host.isPlayer(entity.owner) ? mod.defenderSphere : mod.blaster2, 4);
    else effect(entity, game, "blaster2", contact.plane?.normal ?? zero);
    return game.remove(entity);
  };

  fireBlaster2(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, effects: number): Q2Entity {
    this.register(game);
    const bolt = projectile(self, game, "bolt", start, normalize(direction), speed, "models/proj/laser2/tris.md2", "fly-missile", effects | (effects === 0 ? 0 : 0x4000000));
    this.playerCollision(self, game, bolt);
    if (game.options.edition === "rerelease") { bolt.model = "models/objects/laser/tris.md2"; bolt.skin = 2; bolt.scale = 2.5; }
    bolt.damage = damage; bolt.damageRadius = 128; bolt.touch = this.greenTouch;
    game.schedule(bolt, 2, freeProjectile); publishProjectile(bolt, game);
    this.hooks.base.checkDodge(self, game, start, bolt.movedir, speed); this.initialTouch(self, game, bolt); return bolt;
  }

  private readonly trackerFly: Q2Think = (entity, game) => {
    const enemy = entity.enemy, target = enemy === null ? null : game.host.bodies.read(enemy);
    if (enemy === null || target === null || !game.host.actors.isLive(enemy) || (game.host.combat.read(enemy)?.health ?? 0) < 1) return explode(entity, game, "tracker_explosion");
    const min = add(target.origin, target.bounds.min), max = add(target.origin, target.bounds.max);
    const destination = game.host.isPlayer(enemy) ? add(target.origin, { x: 0, y: 0, z: game.entity(enemy)?.viewHeight ?? 22 })
      : length(min) === 0 || length(max) === 0 ? target.origin : scale(add(min, max), 0.5);
    entity.movedir = normalize(subtract(destination, game.body(entity).origin));
    game.move(entity, { velocity: scale(entity.movedir, entity.speed), angles: vectorAngles(entity.movedir) });
    game.motion(entity, entity.motion); return game.schedule(entity, 0.1, this.trackerFly);
  };

  private readonly trackerPain: Q2Think = (entity, game) => {
    const enemy = entity.enemy, target = game.entity(enemy), body = enemy === null ? null : game.host.bodies.read(enemy);
    if (enemy === null || body === null || game.host.now() - entity.timestamp > 0.5 || (game.host.combat.read(enemy)?.health ?? 0) <= 0) {
      if (target !== null && !game.host.isPlayer(target.actor.id)) { target.effects = (target.effects & ~0x80000000) >>> 0; game.show(target); }
      return game.remove(entity);
    }
    const point = game.options.edition === "rerelease" ? add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5)) : body.origin;
    const interval = game.options.edition === "rerelease" ? 0.1 : game.host.frameSeconds();
    game.damage(enemy, entity, entity.owner, entity.damage, 0, zero, point, { x: 0, y: 0, z: 1 }, mod.tracker, 268, "q2:weapon_disintegrator");
    if (!game.host.actors.isLive(entity.actor.id)) return undefined;
    if ((game.host.combat.read(enemy)?.health ?? 0) < 1) {
      const gib = this.hooks.monster(enemy)?.state.gibHealth ?? 0;
      game.damage(enemy, entity, entity.owner, gib === 0 ? 500 : -gib, 0, zero, point, { x: 0, y: 0, z: 1 }, mod.tracker, 268, "q2:weapon_disintegrator");
    }
    if (game.host.isPlayer(enemy)) this.hooks.playerEffect({ kind: "tracker-pain", actor: enemy, until: game.host.now() + interval });
    else if (target !== null) { target.effects = (target.effects | 0x80000000) >>> 0; game.show(target); }
    return game.schedule(entity, interval, this.trackerPain);
  };

  private readonly trackerTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other === entity.owner) return undefined;
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    const target = game.host.combat.read(contact.other), body = game.body(entity);
    if (target?.canTakeDamage === true) {
      const creature = game.host.isMonster(contact.other) || game.host.isPlayer(contact.other);
      const live = creature && target.health > 0;
      game.damage(contact.other, entity, entity.owner, live ? 0 : creature ? entity.damage * 4 : entity.damage,
        entity.damage * 3, body.velocity, body.origin, contact.plane?.normal ?? zero, mod.tracker, 260, "q2:weapon_disintegrator");
      if (live) {
        const targetBody = game.host.bodies.read(contact.other), flags = game.entity(contact.other)?.flags ?? 0;
        if (targetBody !== null && (flags & 3) === 0) velocity(game, contact.other, add(targetBody.velocity, { x: 0, y: 0, z: 140 }));
        const daemon = game.create("pain daemon"); daemon.owner = entity.owner; daemon.enemy = contact.other;
        daemon.damage = Math.trunc(entity.damage * (game.options.edition === "rerelease" ? 0.1 : game.host.frameSeconds()) / 0.5); daemon.timestamp = game.host.now();
        game.schedule(daemon, game.options.edition === "rerelease" ? 0 : game.host.frameSeconds(), this.trackerPain);
      }
    }
    return explode(entity, game, "tracker_explosion");
  };

  fireTracker(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, enemy: ActorId | null): Q2Entity {
    this.register(game);
    const bolt = projectile(self, game, "tracker", start, normalize(direction), speed, "models/proj/disintegrator/tris.md2", "fly-missile", 0x4000000);
    this.playerCollision(self, game, bolt);
    bolt.damage = damage; bolt.enemy = enemy; bolt.touch = this.trackerTouch;
    game.schedule(bolt, enemy === null ? 10 : 0.1, enemy === null ? freeProjectile : this.trackerFly); publishProjectile(bolt, game, "weapons/disrupt.wav");
    this.hooks.base.checkDodge(self, game, start, bolt.movedir, speed); this.initialTouch(self, game, bolt); return bolt;
  }

  fireHeatBeam(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, _offset: Vec3, damage: number, kick: number): undefined {
    const waterMask = 56, end = add(start, scale(normalize(direction), 8192)), underwater = (game.host.pointContents(start) & waterMask) !== 0;
    let mask = projectileMask(game);
    if (game.options.edition === "rerelease" && game.host.isPlayer(self.actor.id) && this.hooks.base.inputs.get(self.actor.id)?.playersCollide === false) mask &= ~0x40000000;
    let waterStart = start, water = false;
    let trace = game.host.trace({ start, end, bounds: null, ignore: self.actor.id, mask: mask | (underwater ? 0 : waterMask) });
    if (trace.kind !== "q1" && (trace.contents & waterMask) !== 0) {
      water = true; waterStart = trace.end;
      if (length(subtract(start, waterStart)) !== 0) game.host.emit({ kind: "effect", effect: "q2:heatbeam_sparks", origin: waterStart, direction: trace.contact.kind === "plane" ? trace.contact.plane.normal : zero, count: 0, color: 0 });
      trace = game.host.trace({ start: waterStart, end, bounds: null, ignore: self.actor.id, mask });
    }
    const normal = trace.contact.kind === "plane" ? trace.contact.plane.normal : zero;
    const sky = trace.kind === "q2" ? ((trace.surface?.flags ?? 0) & 4) !== 0 : trace.kind === "q3" && (trace.surfaceFlags & 4) !== 0;
    const actor = trace.hit.kind === "actor" ? trace.hit.actor : null;
    if (!sky && trace.fraction < 1) {
      if (actor !== null && game.host.combat.read(actor)?.canTakeDamage === true)
        game.damage(actor, self.actor.id, self.actor.id, water ? Math.trunc(damage / 2) : damage, kick, direction, trace.end, normal, mod.heatbeam, 4, "q2:weapon_plasmabeam");
      else if (!water && !(trace.kind === "q2" && trace.surface?.name.startsWith("sky") === true)) {
        game.host.emit({ kind: "effect", effect: "q2:heatbeam_steam", origin: trace.end, direction: normal, count: 0, color: 0 });
        this.hooks.base.playerNoise(self, game, trace.end, "impact");
      }
    }
    if (water || underwater) {
      const pos = add(trace.end, scale(normalize(subtract(trace.end, waterStart)), -2));
      const waterEnd = (game.host.pointContents(pos) & waterMask) !== 0 ? pos : game.host.trace({ start: pos, end: waterStart, bounds: null, ignore: actor, mask: waterMask }).end;
      this.hooks.base.hooks.emit({ kind: "beam", effect: "bubble-trail", actor: self.actor.id, start: waterStart, end: waterEnd, duration: 0 });
    }
    return this.hooks.base.hooks.emit({ kind: "beam", effect: game.host.isPlayer(self.actor.id) ? "heatbeam" : "monster-heatbeam", actor: self.actor.id, start, end: trace.end, duration: 0 });
  }
}
