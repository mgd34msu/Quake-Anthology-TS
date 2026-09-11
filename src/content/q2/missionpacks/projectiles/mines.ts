/* Rogue g_newweap.c proximity mines and Tesla coils. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import type { ActorId } from "../../../../contracts/identity.ts";
import { freeQ2Entity } from "../../foundation/callbacks.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, dot, scale, subtract, zero } from "../../foundation/fields.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { q2MissionPackDamage as mod } from "../types.ts";
import { Q2MissionPackBolts } from "./bolts.ts";
import { projectile, projectileMask, publishProjectile, sight } from "./common.ts";

function mineLife(multiplier: number): number { return multiplier === 2 ? 30 : multiplier === 4 ? 15 : multiplier === 8 ? 10 : 45; }
function playerStart(entity: Q2Entity): boolean { return ["info_player_deathmatch", "info_player_start", "info_player_coop", "misc_teleporter_dest"].includes(entity.classname); }

export class Q2MissionPackMines extends Q2MissionPackBolts {
  override get callbacks(): Q2CallbackDefinitions {
    const base = super.callbacks;
    return { ...base, think: { ...base.think, Prox_Explode: this.proxExplode, prox_open: this.proxOpen, prox_seek: this.proxSeek,
      Prox_Think: this.proxFlight, tesla_think: this.teslaOpen, tesla_activate: this.teslaActivate, tesla_think_active: this.teslaActive },
      touch: { ...base.touch, prox_land: this.proxLand, Prox_Field_Touch: this.proxField, tesla_lava: this.teslaLava, badarea_touch: this.badAreaTouch },
      die: { ...base.die, prox_die: this.proxDie, tesla_die: this.teslaDie } };
  }

  private readonly badAreaTouch: Q2Touch = () => undefined;

  spawnBadArea(game: Q2GameServices, min: Vec3, max: Vec3, lifespan: number, owner: ActorId | null): Q2Entity {
    game.sourceCallbacks.register(this.callbacks);
    const area = game.create("bad_area"), origin = scale(add(min, max), 0.5);
    area.touch = this.badAreaTouch; area.owner = owner;
    game.move(area, { origin, bounds: { min: subtract(min, origin), max: subtract(max, origin) } });
    game.solid(area, "trigger"); game.motion(area, "stationary");
    if (lifespan !== 0) game.schedule(area, lifespan, freeQ2Entity);
    return area;
  }

  badAreaEntity(actor: ActorId, game: Q2GameServices, origin?: Vec3): Q2Entity | null {
    const body = game.host.bodies.read(actor);
    if (body === null) return null;
    const min = add(origin ?? body.origin, body.bounds.min), max = add(origin ?? body.origin, body.bounds.max);
    for (const area of game.entities.values()) {
      if (area.touch !== this.badAreaTouch || area.solid !== "trigger") continue;
      const other = game.body(area), areaMin = add(other.origin, other.bounds.min), areaMax = add(other.origin, other.bounds.max);
      if (min.x <= areaMax.x && max.x >= areaMin.x && min.y <= areaMax.y && max.y >= areaMin.y && min.z <= areaMax.z && max.z >= areaMin.z) return area;
    }
    return null;
  }

  badArea(actor: ActorId, game: Q2GameServices): boolean { return this.badAreaEntity(actor, game) !== null; }

  markTeslaArea(self: Q2Entity, game: Q2GameServices, tesla: Q2Entity): boolean {
    if (!game.host.actors.isLive(self.actor.id) || !game.host.actors.isLive(tesla.actor.id)) return false;
    let tail = tesla, next = game.entity(tesla.teamChain);
    while (next !== null) {
      if (next.classname === "bad_area") return false;
      tail = next; next = game.entity(next.teamChain);
    }
    const trigger = game.entity(tesla.teamChain);
    const bounds = trigger === null ? { min: { x: -128, y: -128, z: game.body(tesla).bounds.min.z }, max: { x: 128, y: 128, z: 128 } } : game.body(trigger).bounds;
    const origin = trigger === null ? zero : game.body(trigger).origin;
    // Classic passes absolute air_finished/nextthink as a lifespan, including its extra level-time offset.
    const lifespan = trigger === null ? 30 : tesla.timestamp !== 0 ? tesla.timestamp : tesla.nextThink ?? 0;
    const area = this.spawnBadArea(game, add(origin, bounds.min), add(origin, bounds.max), lifespan, tesla.actor.id);
    tail.teamChain = area.actor.id; return true;
  }

  protected throwMine(self: Q2Entity, game: Q2GameServices, classname: string, start: Vec3, direction: Vec3, speed: number): Q2Entity {
    game.sourceCallbacks.register(this.callbacks);
    const mine = projectile(self, game, classname, start, direction, speed, `models/weapons/g_${classname}/tris.md2`, "bounce", 32);
    const axes = angleVectors(vectorAngles(direction));
    const gravity = game.options.edition === "rerelease" && classname !== "nuke" ? (this.hooks.gravity?.() ?? this.hooks.base.inputs.get(self.actor.id)?.gravity ?? 800) / 800 : 1;
    game.move(mine, { velocity: add(add(scale(direction, speed), scale(axes.up, (200 + (game.host.random() * 2 - 1) * 10) * gravity)), scale(axes.right, (game.host.random() * 2 - 1) * 10)) }, false);
    if (classname !== "nuke") this.playerCollision(self, game, mine);
    mine.renderFlags = 0x8000; mine.teamMaster = self.actor.id; mine.damageableTarget = true;
    return mine;
  }

  private readonly proxExplode: Q2Think = (entity, game) => {
    const field = game.entity(entity.teamChain);
    if (field !== null && field.owner === entity.actor.id) game.remove(field);
    const owner = game.entity(entity.teamMaster);
    if (owner !== null) this.hooks.base.playerNoise(owner, game, game.body(entity).origin, "impact");
    if (entity.damage > 90) game.sound(entity, "items/damage3.wav", 3);
    if (game.host.combat.read(entity.actor.id) !== null) game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
    game.radiusDamage(entity, owner?.actor.id ?? entity.actor.id, entity.damage, entity.actor.id, 192, mod.prox, 0, "q2:weapon_proxlauncher");
    this.grenadeEffect(entity, game); return game.remove(entity);
  };

  private readonly proxDie: Q2Die = (entity, game, reaction) => {
    game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
    return game.entity(reaction.inflictor)?.classname === (game.options.edition === "rerelease" ? "prox_mine" : "prox") ? game.schedule(entity, game.host.frameSeconds(), this.proxExplode) : this.proxExplode(entity, game);
  };

  private readonly proxField: Q2Touch = (field, game, contact) => {
    if (!game.host.isMonster(contact.other) && !game.host.isPlayer(contact.other)) return undefined;
    const mine = game.entity(field.owner);
    if (mine === null) return game.remove(field);
    if (contact.other === mine.actor.id || mine.think === this.proxExplode) return undefined;
    if (mine.teamChain !== field.actor.id) return game.remove(field);
    game.sound(field, "weapons/proxwarn.wav", 2); return game.schedule(mine, 0.5, this.proxExplode);
  };

  private readonly proxSeek: Q2Think = (entity, game) => {
    if (game.host.now() > entity.wait) return this.proxExplode(entity, game);
    if (++entity.frame > 13) entity.frame = 9;
    game.show(entity); return game.schedule(entity, 0.1, this.proxSeek);
  };

  private readonly proxOpen: Q2Think = (entity, game) => {
    if (entity.frame !== 9) {
      if (entity.frame === 0) game.sound(entity, "weapons/proxopen.wav", 2);
      entity.frame++; game.show(entity); return game.schedule(entity, 0.05, this.proxOpen);
    }
    entity.owner = null; game.motion(entity, entity.motion);
    const field = game.entity(entity.teamChain); if (field !== null) field.touch = this.proxField;
    for (const actor of game.host.nearby(game.body(entity).origin, 202)) {
      const target = game.entity(actor);
      const living = (game.host.isPlayer(actor) || game.host.isMonster(actor)) && (game.host.combat.read(actor)?.health ?? 0) > 0;
      if (!living && !(game.options.mode === "deathmatch" && target !== null && playerStart(target))) continue;
      if (target !== null ? !sight(game, target, entity.actor.id) : !sight(game, entity, actor)) continue;
      game.sound(entity, "weapons/proxwarn.wav", 2); return this.proxExplode(entity, game);
    }
    entity.wait = game.host.now() + (this.hooks.strongMines === true ? 45 : mineLife(entity.damage / 90));
    return game.schedule(entity, 0.2, this.proxSeek);
  };

  private readonly proxLand: Q2Touch = (entity, game, contact) => {
    if (((contact.surface?.nativeFlags ?? 0) & 4) !== 0) return game.remove(entity);
    const normal = contact.plane?.normal;
    if (normal !== undefined && (game.host.pointContents(add(game.body(entity).origin, scale(normal, -10))) & 24) !== 0) return this.proxExplode(entity, game);
    const other = game.entity(contact.other);
    if (game.host.isMonster(contact.other) || game.host.isPlayer(contact.other) || other?.damageableTarget === true)
      return contact.other === entity.teamMaster ? undefined : this.proxExplode(entity, game);
    let motion: "bounce" | "stationary" = "stationary";
    if (contact.other !== game.host.worldActor()) {
      if (normal === undefined) return this.proxExplode(entity, game);
      const v = game.body(entity).velocity, out = subtract(v, scale(normal, dot(v, normal) * 1.5));
      if (out.z > 60) return undefined;
      if (other?.motion !== "push" || normal.z <= 0.7) return normal.z > 0.7 ? this.proxExplode(entity, game) : undefined;
      motion = "bounce";
    }
    if (normal === undefined) return this.proxExplode(entity, game);
    if ((game.host.pointContents(game.body(entity).origin) & 24) !== 0) return this.proxExplode(entity, game);
    const field = game.create("prox_field"); field.owner = entity.actor.id; field.teamMaster = entity.actor.id;
    game.move(field, { origin: game.body(entity).origin, bounds: { min: { x: -96, y: -96, z: -96 }, max: { x: 96, y: 96, z: 96 } } });
    game.solid(field, "trigger"); game.motion(field, "stationary");
    const angles = vectorAngles(normal); entity.angularVelocity = zero;
    game.move(entity, { velocity: zero, angles: { ...angles, x: angles.x + 90 } });
    entity.die = this.proxDie; entity.teamChain = field.actor.id; entity.touch = null;
    game.host.combat.create(entity.actor, { health: 20, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    game.motion(entity, motion); return game.schedule(entity, 0.05, this.proxOpen);
  };

  private readonly proxFlight: Q2Think = (entity, game) => {
    if (entity.timestamp <= game.host.now()) return this.proxExplode(entity, game);
    const angles = vectorAngles(game.body(entity).velocity);
    game.move(entity, { angles: { ...angles, x: angles.x - 90 } });
    return game.schedule(entity, 0, this.proxFlight);
  };

  fireProx(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, multiplier: number, speed: number): Q2Entity {
    const mine = this.throwMine(self, game, "prox", start, direction, speed), angles = game.body(mine).angles;
    mine.clipMask |= 24; mine.flags |= 0x2000; mine.damage = 90 * multiplier; mine.touch = this.proxLand;
    game.move(mine, { angles: { ...angles, x: angles.x - 90 }, bounds: { min: { x: -6, y: -6, z: -6 }, max: { x: 6, y: 6, z: 6 } } }, false);
    if (game.options.edition === "rerelease") {
      mine.classname = "prox_mine"; mine.flags = (mine.flags | 0x20000) + 2 ** 32; mine.timestamp = game.host.now() + mineLife(multiplier);
      game.schedule(mine, 0, this.proxFlight);
    } else game.schedule(mine, mineLife(multiplier), this.proxExplode);
    publishProjectile(mine, game); return mine;
  }

  protected grenadeEffect(entity: Q2Entity, game: Q2GameServices): undefined {
    const body = game.body(entity), wet = (game.host.pointContents(body.origin) & 56) !== 0;
    return game.host.emit({ kind: "effect", effect: `q2:${body.ground === null ? "rocket" : "grenade"}_explosion${wet ? "_water" : ""}`,
      origin: add(body.origin, scale(body.velocity, -0.02)), direction: zero, count: 0, color: 0 });
  }

  private removeTesla(entity: Q2Entity, game: Q2GameServices, blow = false): undefined {
    game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
    let child = game.entity(entity.teamChain);
    while (child !== null) { const next = game.entity(child.teamChain); game.remove(child); child = next; }
    entity.owner = entity.teamMaster; entity.enemy = null;
    if (blow) { entity.damage *= 50; entity.damageRadius = 200; }
    if (entity.damageRadius !== 0 && entity.damage > 150) game.sound(entity, "items/damage3.wav", 3);
    const owner = game.entity(entity.owner); if (owner !== null) this.hooks.base.playerNoise(owner, game, game.body(entity).origin, "impact");
    game.radiusDamage(entity, entity.owner, entity.damage, null, entity.damageRadius, 7);
    this.grenadeEffect(entity, game); return game.remove(entity);
  }

  private readonly teslaDie: Q2Die = (entity, game) => this.removeTesla(entity, game);

  private readonly teslaLava: Q2Touch = (entity, game, contact) => {
    if (contact.plane !== null && (game.host.pointContents(add(game.body(entity).origin, scale(contact.plane.normal, -20))) & 24) !== 0) return this.removeTesla(entity, game, true);
    return game.sound(entity, game.host.random() > 0.5 ? "weapons/hgrenb1a.wav" : "weapons/hgrenb2a.wav", 2);
  };

  private readonly teslaOpen: Q2Think = (entity, game) => {
    if ((game.host.pointContents(game.body(entity).origin) & 24) !== 0) return this.removeTesla(entity, game);
    game.move(entity, { angles: zero });
    if (entity.frame === 0) game.sound(entity, "weapons/teslaopen.wav", 2);
    entity.frame++;
    if (entity.frame > 14) { entity.frame = 14; return game.schedule(entity, 0.1, this.teslaActivate); }
    if (entity.frame === 10) {
      const owner = game.entity(entity.owner); if (owner !== null) this.hooks.base.playerNoise(owner, game, game.body(entity).origin, "weapon");
      entity.skin = 1;
    } else if (entity.frame === 12) entity.skin = 2;
    else if (entity.frame === 14) entity.skin = 3;
    game.show(entity); return game.schedule(entity, 0.1, this.teslaOpen);
  };

  private readonly teslaActivate: Q2Think = (entity, game) => {
    if ((game.host.pointContents(game.body(entity).origin) & 56) !== 0) return this.removeTesla(entity, game, true);
    if (game.options.mode === "deathmatch") for (const actor of game.host.nearby(game.body(entity).origin, 192)) {
      const other = game.entity(actor);
      if (other !== null && playerStart(other) && sight(game, other, entity.actor.id)) return this.removeTesla(entity, game);
    }
    const field = game.create("tesla trigger"); field.owner = entity.actor.id;
    game.move(field, { origin: game.body(entity).origin, bounds: { min: { x: -128, y: -128, z: game.body(entity).bounds.min.z }, max: { x: 128, y: 128, z: 128 } } });
    game.solid(field, "trigger"); game.motion(field, "stationary"); game.move(entity, { angles: zero });
    if (game.options.mode === "deathmatch") { entity.owner = null; game.motion(entity, entity.motion); }
    entity.teamChain = field.actor.id; entity.timestamp = game.host.now() + 30;
    return game.schedule(entity, game.host.frameSeconds(), this.teslaActive);
  };

  private readonly teslaActive: Q2Think = (entity, game) => {
    if (game.host.now() > entity.timestamp) return this.removeTesla(entity, game);
    const field = game.entity(entity.teamChain);
    if (field === null) throw new Error("Active source Tesla has no trigger field");
    const box = game.body(field), min = add(box.origin, box.bounds.min), max = add(box.origin, box.bounds.max);
    const start = add(game.body(entity).origin, { x: 0, y: 0, z: 16 });
    for (const observation of game.host.actors.observations()) {
      const actor = observation.id, body = game.host.bodies.read(actor), target = game.entity(actor);
      if (!game.host.actors.isLive(entity.actor.id)) return undefined;
      if (body === null || actor === entity.actor.id || (game.host.combat.read(actor)?.health ?? 0) < 1) continue;
      if (game.host.isPlayer(actor) && game.options.mode !== "deathmatch") continue;
      if (game.options.edition === "rerelease") {
        if (game.host.isPlayer(actor) && entity.teamMaster !== null && !this.hooks.base.hooks.canTarget(entity.teamMaster, actor)) continue;
        if (game.options.mode !== "deathmatch" && target !== null && Math.trunc(target.flags / 2 ** 32) % 2 !== 0) continue;
      }
      if (!game.host.isPlayer(actor) && !game.host.isMonster(actor) && target?.damageableTarget !== true) continue;
      if (body.origin.x + body.bounds.max.x < min.x || body.origin.x + body.bounds.min.x > max.x ||
        body.origin.y + body.bounds.max.y < min.y || body.origin.y + body.bounds.min.y > max.y ||
        body.origin.z + body.bounds.max.z < min.z || body.origin.z + body.bounds.min.z > max.z) continue;
      const trace = game.host.trace({ start, end: body.origin, bounds: null, ignore: entity.actor.id, mask: projectileMask(game) });
      if (trace.fraction !== 1 && !(trace.hit.kind === "actor" && trace.hit.actor === actor)) continue;
      if (entity.damage > 3) game.sound(entity, "items/damage3.wav", 3);
      game.damage(actor, entity, entity.teamMaster, entity.damage, game.host.isMonster(actor) && ((target?.flags ?? 0) & 3) === 0 ? 0 : 8,
        subtract(body.origin, start), trace.end, trace.contact.kind === "plane" ? trace.contact.plane.normal : zero, mod.tesla);
      this.hooks.base.hooks.emit({ kind: "beam", effect: "bfg-lightning", actor: entity.actor.id, start, end: trace.end, duration: game.host.frameSeconds() });
    }
    return game.schedule(entity, game.host.frameSeconds(), this.teslaActive);
  };

  fireTesla(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, multiplier: number, speed: number): Q2Entity {
    const mine = this.throwMine(self, game, "tesla", start, direction, speed);
    mine.damage = 3 * multiplier; mine.clipMask |= 24; mine.flags |= 0x2000; mine.touch = this.teslaLava; mine.die = this.teslaDie;
    if (game.options.edition === "rerelease") { mine.classname = "tesla_mine"; mine.clipMask &= ~0x4000000; mine.flags = (mine.flags | 0x20000) + 2 ** 32; }
    game.move(mine, { angles: zero, bounds: { min: { x: -12, y: -12, z: 0 }, max: { x: 12, y: 12, z: 20 } } }, false);
    game.host.combat.create(mine.actor, { health: game.options.mode === "deathmatch" ? 20 : game.options.edition === "rerelease" ? 50 : 30, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    mine.wait = game.host.now() + 30; game.schedule(mine, 3, this.teslaOpen); publishProjectile(mine, game); return mine;
  }
}
