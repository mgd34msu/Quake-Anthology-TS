/* Rogue g_sphere.c. Sphere reactions share the owner's combat and movement authority. */
import type { ActorId } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { TouchContact } from "../../../contracts/world.ts";
import type { Q2CallbackDefinitions } from "../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Pain, Q2Think, Q2Touch } from "../foundation/host.ts";
import { add, length, normalize, scale, subtract, zero } from "../foundation/fields.ts";
import { throwGib } from "../foundation/monsters/gibs.ts";
import { vectorAngles } from "../foundation/weapons/vectors.ts";
import { explode, projectileMask, publishProjectile, sight } from "./projectiles/common.ts";
import type { Q2MissionPackProjectiles } from "./projectiles/index.ts";
import { q2MissionPackDamage as mod } from "./types.ts";
import type { Q2MissionPackPlayerEffect } from "./types.ts";

export type Q2SphereKind = "defender" | "hunter" | "vengeance";
export interface Q2SphereHooks {
  readonly hunterCamera: boolean;
  intermission(): boolean;
  playerEffect(effect: Q2MissionPackPlayerEffect): undefined;
}

function doppleFlag(game: Q2GameServices): number { return game.options.edition === "rerelease" ? 0x10000 : 0x100; }

export class Q2MissionPackSpheres {
  constructor(readonly projectiles: Q2MissionPackProjectiles, readonly hooks: Q2SphereHooks) {}
  get callbacks(): Q2CallbackDefinitions {
    return { think: { sphere_think_explode: this.expire, defender_think: this.defenderThink, hunter_think: this.hunterThink, vengeance_think: this.vengeanceThink },
      pain: { defender_pain: this.defenderPain, hunter_pain: this.hunterPain, vengeance_pain: this.vengeancePain },
      die: { sphere_explode: this.die, sphere_if_idle_die: this.idleDie }, touch: { hunter_touch: this.hunterTouch, vengeance_touch: this.vengeanceTouch } };
  }

  ownedSphere(actor: ActorId, game: Q2GameServices): Q2Entity | null {
    for (const entity of game.entities.values()) if (entity.classname === "sphere" && entity.owner === actor && (entity.spawnflags & doppleFlag(game)) === 0) return entity;
    return null;
  }

  ownerDamaged(actor: ActorId, attacker: ActorId | null, game: Q2GameServices): undefined {
    const sphere = this.ownedSphere(actor, game);
    return sphere?.pain?.(sphere, game, { self: sphere.actor, attacker, damage: 0, kick: 0 });
  }

  ownerDied(actor: ActorId, game: Q2GameServices): undefined {
    const sphere = this.ownedSphere(actor, game);
    return sphere?.die?.(sphere, game, { self: sphere.actor, attacker: actor, inflictor: actor, damage: 0, kick: 0, point: zero });
  }

  disconnect(actor: ActorId, game: Q2GameServices): undefined {
    const sphere = this.ownedSphere(actor, game); return sphere === null ? undefined : game.remove(sphere);
  }

  private readonly expire: Q2Think = (entity, game) => {
    const owner = game.entity(entity.owner);
    if (owner !== null && (owner.flags & 0x4000) !== 0) {
      game.move(owner, { velocity: zero }); game.motion(owner, "stationary");
      this.hooks.playerEffect({ kind: "sphere-camera", actor: owner.actor.id, sphere: null, origin: game.body(owner).origin, angles: game.body(owner).angles });
    }
    return explode(entity, game);
  };
  private readonly die: Q2Die = (entity, game) => this.expire(entity, game);
  private readonly idleDie: Q2Die = (entity, game) => entity.enemy === null ? this.expire(entity, game) : undefined;

  private loop(entity: Q2Entity, game: Q2GameServices, sound: string): undefined {
    if (entity.sound === sound) return undefined;
    if (entity.sound !== "") game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: entity.sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "stop" });
    entity.sound = sound;
    return game.host.emit({ kind: "sound", actor: entity.actor.id, origin: game.body(entity).origin, path: sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
  }

  private fly(entity: Q2Entity, game: Q2GameServices): undefined {
    if (game.host.now() >= entity.wait) return this.expire(entity, game);
    const owner = entity.owner === null ? null : game.host.bodies.read(entity.owner);
    if (owner === null) return game.remove(entity);
    const destination = { ...owner.origin, z: owner.origin.z + owner.bounds.max.z + 4 };
    if (game.host.now() === Math.trunc(game.host.now()) && entity.owner !== null && !sight(game, entity, entity.owner)) return game.move(entity, { origin: destination });
    game.move(entity, { velocity: scale(subtract(destination, game.body(entity).origin), 5) }); return game.motion(entity, entity.motion);
  }

  private chase(entity: Q2Entity, game: Q2GameServices, direct: boolean): undefined {
    const enemy = entity.enemy, body = enemy === null ? null : game.host.bodies.read(enemy);
    if (game.host.now() >= entity.wait || enemy === null || body === null || (game.host.combat.read(enemy)?.health ?? 0) < 1) return this.expire(entity, game);
    const destination = game.host.isPlayer(enemy) ? add(body.origin, { x: 0, y: 0, z: game.entity(enemy)?.viewHeight ?? 22 }) : body.origin;
    let direction: Vec3, speed: number;
    if (direct || sight(game, entity, enemy)) {
      if (!direct) this.loop(entity, game, "spheres/h_active.wav");
      direction = normalize(subtract(destination, game.body(entity).origin)); speed = 500; entity.pos1 = destination;
    } else if (length(entity.pos1) === 0) {
      direction = normalize(subtract(body.origin, game.body(entity).origin)); speed = 0; this.loop(entity, game, "spheres/h_lurk.wav");
    } else {
      direction = subtract(entity.pos1, game.body(entity).origin); const distance = length(direction); direction = normalize(direction);
      if (distance > 1) { speed = distance > 500 ? 500 : distance < 20 ? distance / game.host.frameSeconds() : distance; if (!direct) this.loop(entity, game, "spheres/h_active.wav"); }
      else { direction = normalize(subtract(body.origin, game.body(entity).origin)); speed = 0; if (!direct) this.loop(entity, game, "spheres/h_lurk.wav"); }
    }
    game.move(entity, { angles: vectorAngles(direction), velocity: scale(direction, speed) }); return game.motion(entity, entity.motion);
  }

  private touch(entity: Q2Entity, game: Q2GameServices, contact: TouchContact, means: number): undefined {
    if ((entity.spawnflags & doppleFlag(game)) !== 0) {
      if (contact.other === entity.teamMaster) return undefined;
      entity.owner = entity.teamMaster; entity.teamMaster = null;
    } else if (contact.other === entity.owner || game.entity(contact.other)?.classname === "bodyque") return undefined;
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    const body = game.body(entity);
    if (game.host.combat.read(contact.other)?.canTakeDamage === true)
      game.damage(contact.other, entity, entity.owner, 10000, 1, body.velocity, body.origin, contact.plane?.normal ?? zero, means, 64);
    else game.radiusDamage(entity, entity.owner, 512, entity.owner, 256, means);
    return this.expire(entity, game);
  }

  private readonly vengeanceTouch: Q2Touch = (entity, game, contact) => this.touch(entity, game, contact, (entity.spawnflags & doppleFlag(game)) !== 0 ? mod.doppleVengeance : mod.vengeanceSphere);
  private readonly hunterTouch: Q2Touch = (entity, game, contact) => {
    if (contact.other === game.host.worldActor()) return undefined;
    const owner = game.entity(entity.owner);
    if (owner !== null && (owner.flags & 0x4000) !== 0) { game.move(owner, { velocity: zero }); game.motion(owner, "stationary"); }
    return this.touch(entity, game, contact, (entity.spawnflags & doppleFlag(game)) !== 0 ? mod.doppleHunter : mod.hunterSphere);
  };

  private readonly defenderPain: Q2Pain = (entity, _game, reaction) => { if (reaction.attacker !== entity.owner) entity.enemy = reaction.attacker; return undefined; };
  private readonly vengeancePain: Q2Pain = (entity, game, reaction) => {
    if (entity.enemy !== null || reaction.attacker === null) return undefined;
    if ((entity.spawnflags & doppleFlag(game)) === 0 && ((entity.owner !== null && (game.host.combat.read(entity.owner)?.health ?? 0) >= 25) || reaction.attacker === entity.owner)) return undefined;
    entity.wait = Math.max(entity.wait, game.host.now() + 15); entity.effects |= 16; entity.touch = this.vengeanceTouch; entity.enemy = reaction.attacker;
    return game.show(entity);
  };

  private readonly hunterPain: Q2Pain = (entity, game, reaction) => {
    if (entity.enemy !== null || reaction.attacker === null) return undefined;
    const owner = game.entity(entity.owner), dopple = (entity.spawnflags & doppleFlag(game)) !== 0;
    if (!dopple && (owner !== null && (game.host.combat.read(owner.actor.id)?.health ?? 0) > 0 || reaction.attacker === entity.owner)) return undefined;
    entity.wait = Math.max(entity.wait, game.host.now() + 15); entity.effects |= 8 | 0x4000000; entity.touch = this.hunterTouch; entity.enemy = reaction.attacker;
    game.show(entity);
    if (dopple || owner === null || !game.host.isPlayer(owner.actor.id) || !this.hooks.hunterCamera || (game.options.deathmatchFlags & 1024) !== 0) return undefined;
    const target = game.host.bodies.read(reaction.attacker);
    if (target === null || length(subtract(target.origin, game.body(entity).origin)) < 192) return undefined;
    game.sound(owner, "misc/udeath.wav", 4);
    for (let index = 0; index < 4; index++) throwGib(owner, game, "models/objects/gibs/sm_meat/tris.md2", 50);
    throwGib(owner, game, "models/objects/gibs/skull/tris.md2", 50);
    const origin = add(game.body(owner).origin, { x: 0, y: 0, z: owner.viewHeight });
    game.move(entity, { origin });
    owner.model = ""; owner.model2 = ""; owner.viewHeight = 8; owner.flags |= 0x4000;
    game.move(owner, { origin, angles: game.body(entity).angles, bounds: { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } } });
    game.solid(owner, "none"); game.motion(owner, "fly-missile"); game.show(owner); game.solid(entity, "box");
    return this.hooks.playerEffect({ kind: "sphere-camera", actor: owner.actor.id, sphere: entity.actor.id, origin, angles: game.body(entity).angles });
  };

  private readonly defenderThink: Q2Think = (entity, game) => {
    const owner = game.entity(entity.owner);
    if (owner === null) return game.remove(entity);
    if (this.hooks.intermission() || (game.host.combat.read(owner.actor.id)?.health ?? 0) <= 0) return this.expire(entity, game);
    if (++entity.frame > 19) entity.frame = 0;
    if (entity.enemy !== null) {
      const target = game.host.bodies.read(entity.enemy);
      if ((game.host.combat.read(entity.enemy)?.health ?? 0) <= 0 || target === null) entity.enemy = null;
      else if (entity.enemy !== entity.owner && entity.delay <= game.host.now() && sight(game, entity, entity.enemy)) {
        const origin = game.body(entity).origin;
        this.projectiles.fireBlaster2(owner, game, add(origin, { x: 0, y: 0, z: 2 }), normalize(subtract(target.origin, origin)), 10, 1000, 8);
        entity.delay = game.host.now() + 0.4;
      }
    }
    this.fly(entity, game);
    if (game.host.actors.isLive(entity.actor.id)) { game.show(entity); return game.schedule(entity, 0.1, this.defenderThink); }
    return undefined;
  };

  private readonly hunterThink: Q2Think = (entity, game) => {
    if (this.hooks.intermission()) return this.expire(entity, game);
    const owner = game.entity(entity.owner), enemy = entity.enemy === null ? null : game.host.bodies.read(entity.enemy);
    if (owner === null && (entity.spawnflags & doppleFlag(game)) === 0) return game.remove(entity);
    const body = game.body(entity), ideal = owner !== null ? game.body(owner).angles.y : enemy !== null ? vectorAngles(subtract(enemy.origin, body.origin)).y : body.angles.y;
    let delta = ideal - ((body.angles.y % 360 + 360) % 360); if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
    game.move(entity, { angles: { ...body.angles, y: (body.angles.y + Math.max(-40, Math.min(40, delta)) + 360) % 360 } });
    if (entity.enemy === null) this.fly(entity, game); else this.chase(entity, game, false);
    if (owner !== null && (owner.flags & 0x4000) !== 0 && game.host.actors.isLive(entity.actor.id)) {
      const current = game.body(entity), currentOwner = game.body(owner);
      owner.viewHeight = current.origin.z - currentOwner.origin.z;
      const angles = enemy === null ? current.angles : { x: 0, y: vectorAngles(subtract(enemy.origin, current.origin)).y, z: 0 };
      game.move(owner, { origin: current.origin, velocity: current.velocity, bounds: { min: zero, max: zero } }); game.motion(owner, "fly-missile");
      this.hooks.playerEffect({ kind: "sphere-camera", actor: owner.actor.id, sphere: entity.actor.id, origin: current.origin, angles });
    }
    return game.host.actors.isLive(entity.actor.id) ? game.schedule(entity, 0.1, this.hunterThink) : undefined;
  };

  private readonly vengeanceThink: Q2Think = (entity, game) => {
    if (this.hooks.intermission()) return this.expire(entity, game);
    if (game.entity(entity.owner) === null && (entity.spawnflags & doppleFlag(game)) === 0) return game.remove(entity);
    if (entity.enemy === null) this.fly(entity, game); else this.chase(entity, game, true);
    return game.host.actors.isLive(entity.actor.id) ? game.schedule(entity, 0.1, this.vengeanceThink) : undefined;
  };

  launch(owner: Q2Entity, game: Q2GameServices, kind: Q2SphereKind, dopple = false): Q2Entity {
    game.sourceCallbacks.register(this.callbacks);
    if (!dopple) { const old = this.ownedSphere(owner.actor.id, game); if (old !== null) game.remove(old); }
    const sphere = game.create("sphere"), body = game.body(owner);
    sphere.owner = dopple ? null : owner.actor.id; sphere.teamMaster = dopple ? owner.teamMaster : null;
    sphere.spawnflags = (kind === "defender" ? 1 : kind === "hunter" ? 2 : 4) | (dopple ? doppleFlag(game) : 0);
    sphere.clipMask = projectileMask(game); sphere.renderFlags = 8 | 0x8000; sphere.motion = "fly-missile"; sphere.wait = game.host.now() + 30;
    sphere.model = `models/items/${kind === "vengeance" ? "vengnce" : kind}/tris.md2`;
    if (kind === "defender") { sphere.model2 = "models/items/shell/tris.md2"; sphere.pain = this.defenderPain; sphere.die = this.die; }
    else if (kind === "hunter") { sphere.pain = this.hunterPain; sphere.die = this.idleDie; }
    else { sphere.pain = this.vengeancePain; sphere.die = this.idleDie; sphere.angularVelocity = { x: 30, y: 30, z: 0 }; }
    game.move(sphere, { origin: { ...body.origin, z: body.origin.z + body.bounds.max.z }, angles: { x: 0, y: body.angles.y, z: 0 }, bounds: { min: zero, max: zero } }, false);
    game.schedule(sphere, 0.1, kind === "defender" ? this.defenderThink : kind === "hunter" ? this.hunterThink : this.vengeanceThink);
    publishProjectile(sphere, game); this.loop(sphere, game, `spheres/${kind === "defender" ? "d" : kind === "hunter" ? "h" : "v"}_idle.wav`);
    return sphere;
  }
}
