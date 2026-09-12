/* Xatrix g_weapon.c Trap_Think. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think } from "../../foundation/host.ts";
import { add, dot, length, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { changeYaw } from "../../foundation/monsters/ai.ts";
import { angleVectors, vectorAngles } from "../../foundation/weapons/vectors.ts";
import { explode, freeProjectile, publishProjectile, sight, velocity } from "./common.ts";
import { Q2MissionPackNuke } from "./nuke.ts";
import { q2MissionPackDamage as mod } from "../types.ts";

function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }

export class Q2MissionPackProjectiles extends Q2MissionPackNuke {
  override get callbacks(): Q2CallbackDefinitions {
    const base = super.callbacks;
    return { ...base, think: { ...base.think, Trap_Think: this.trapThink, "rerelease/Trap_Think": this.trapRerelease, Trap_Gib_Think: this.trapGib }, die: { ...base.die, trap_die: this.trapDie } };
  }

  private readonly trapDie: Q2Die = (entity, game) => explode(entity, game);

  private readonly trapGib: Q2Think = (entity, game) => {
    const trap = game.entity(entity.owner);
    if (trap === null || trap.frame !== 5) return game.remove(entity);
    const body = game.body(entity), origin = game.body(trap).origin, axes = angleVectors(game.body(trap).angles);
    const degrees = 150 * game.host.frameSeconds() + trap.delay, radians = degrees * Math.PI / 180, delta = subtract(origin, body.origin);
    const rotated = add(add(scale(delta, Math.cos(radians)), scale(cross(axes.up, delta), Math.sin(radians))), scale(axes.up, dot(axes.up, delta) * (1 - Math.cos(radians))));
    const trace = game.host.trace({ start: body.origin, end: subtract(origin, rotated), bounds: null, ignore: entity.actor.id, mask: 3 });
    game.move(entity, { origin: add(trace.end, scale(normalize(delta), 15 * game.host.frameSeconds())), angles: { ...body.angles, y: body.angles.y + degrees } });
    return game.schedule(entity, game.host.frameSeconds(), this.trapGib);
  };

  private readonly trapRerelease: Q2Think = (entity, game) => {
    const now = game.host.now(), body = game.body(entity);
    if (entity.timestamp < now) return explode(entity, game);
    game.schedule(entity, 0.1, this.trapRerelease);
    if (body.ground === null) return undefined;
    if (entity.frame > 4) {
      if (entity.frame === 5) {
        if (entity.wait === 64) game.sound(entity, "weapons/trapdown.wav", 2, 1, 2);
        entity.wait -= 2; entity.delay += 2;
        if (entity.wait < 19) entity.frame++;
      } else if (++entity.frame === 8) {
        game.schedule(entity, 1, freeProjectile); entity.effects &= ~0x2000000;
        const size = 1 + (entity.accel - 100) / 300;
        const food = game.spawn({ classname: "item_foodcube", ordinal: -1, values: new Map([
          ["count", String(game.host.combat.read(entity.actor.id)?.mass ?? 0)], ["spawnflags", "65536"],
          ["origin", `${body.origin.x} ${body.origin.y} ${body.origin.z + 24 * size}`],
        ]) });
        food.scale = size; game.move(food, { angles: { x: 0, y: game.host.random() * 360, z: 0 }, velocity: { x: 0, y: 0, z: 400 } });
        food.think?.(food, game); game.cancel(food); game.show(food); game.sound(food, "misc/fhit3.wav");
      }
      return game.show(entity);
    }
    entity.effects &= ~0x2000000;
    if (entity.frame >= 4) {
      entity.effects |= 0x2000000;
      if (game.options.mode === "deathmatch") { entity.owner = null; game.motion(entity, entity.motion); }
    } else { entity.frame++; return game.show(entity); }
    let best: ActorId | null = null, nearest = 8000;
    for (const actor of game.host.nearby(body.origin, 256)) {
      if (actor === entity.actor.id) continue;
      const target = game.entity(actor), targetBody = game.host.bodies.read(actor);
      if (game.options.mode === "deathmatch" && target !== null && (target.classname.startsWith("info_player_") || target.classname === "misc_teleporter_dest" || target.classname.startsWith("item_flag_")) && sight(game, target, entity.actor.id)) return explode(entity, game);
      if (!game.host.isPlayer(actor) && !game.host.isMonster(actor) || game.options.mode !== "deathmatch" && game.host.isPlayer(actor) ||
        actor !== entity.teamMaster && !this.hooks.base.hooks.canTarget(entity.teamMaster, actor) || (game.host.combat.read(actor)?.health ?? 0) <= 0 || targetBody === null || !sight(game, entity, actor)) continue;
      const distance = length(subtract(body.origin, targetBody.origin));
      if (best === null || distance < nearest) { best = actor; nearest = distance; }
    }
    const target = best === null ? null : game.host.actors.resolveOwned(best), targetBody = best === null ? null : game.host.bodies.read(best);
    if (target !== null && targetBody !== null) {
      const origin = targetBody.ground === null ? targetBody.origin : add(targetBody.origin, { x: 0, y: 0, z: 1 }), delta = subtract(body.origin, origin), distance = length(delta);
      game.host.bodies.write(target, { ...targetBody, origin, ground: null });
      const maximum = game.host.isPlayer(target.id) ? 290 : 150;
      velocity(game, target.id, add(targetBody.velocity, scale(normalize(delta), Math.max(64, Math.min(maximum, maximum - distance)))), true);
      if (entity.sound !== "weapons/trapsuck.wav") {
        entity.sound = "weapons/trapsuck.wav";
        game.host.emit({ kind: "sound", actor: entity.actor.id, origin: body.origin, path: entity.sound, channel: 0, volume: 1, attenuation: 1, reliable: false, loop: "start" });
      }
      if (distance < 48) {
        const mass = game.host.combat.read(target.id)?.mass ?? 0;
        if (mass >= 400) return explode(entity, game);
        game.host.combat.setTraits(entity.actor, { canTakeDamage: false }); game.solid(entity, "none"); entity.die = null;
        game.damage(target.id, entity, entity.teamMaster, 100000, 1, zero, origin, zero, mod.trap, 0, "q2:ammo_trap");
        entity.enemy = target.id; entity.wait = 64; entity.timestamp = now + 30; entity.accel = mass; entity.frame = 5;
        game.host.combat.setTraits(entity.actor, { mass: Math.trunc(mass / (game.options.mode === "deathmatch" ? 4 : 10)) });
        for (const gib of [...game.entities.values()]) if (gib.classname === "gib" && length(subtract(game.body(gib).origin, body.origin)) <= 128) {
          game.motion(gib, "stationary"); gib.owner = entity.actor.id; this.trapGib(gib, game);
        }
      }
    }
    return game.show(entity);
  };

  private readonly trapThink: Q2Think = (entity, game) => {
    const now = game.host.now(), body = game.body(entity);
    if (entity.timestamp < now) return explode(entity, game);
    game.schedule(entity, 0.1, this.trapThink);
    if (body.ground === null) return undefined;
    if (entity.frame > 4) {
      if (entity.frame === 5) {
        if (entity.wait === 64) game.sound(entity, "weapons/trapdown.wav", 2, 1, 2);
        entity.wait -= 2; entity.delay += now;
        const axes = angleVectors(body.angles);
        for (let index = 0; index < 3; index++) {
          const gib = game.create("trap_gib"), radians = (120 * index + entity.delay) * Math.PI / 180;
          const rotated = add(add(scale(axes.right, Math.cos(radians)), scale(cross(axes.up, axes.right), Math.sin(radians))), scale(axes.up, dot(axes.up, axes.right) * (1 - Math.cos(radians))));
          const point = add(add(body.origin, scale(rotated, 1 + entity.wait / 2)), axes.forward);
          gib.model = entity.style === 1 ? "models/objects/gekkgib/torso/tris.md2" : (game.host.combat.read(entity.actor.id)?.mass ?? 0) > 200 ? "models/objects/gibs/chest/tris.md2" : "models/objects/gibs/sm_meat/tris.md2";
          gib.effects = (entity.style === 1 ? 26 : 1) | 2; gib.serverFlags |= 4;
          game.move(gib, { origin: { ...point, z: body.origin.z + entity.wait }, angles: body.angles, bounds: { min: zero, max: zero } });
          game.host.combat.create(gib.actor, { health: 0, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
          game.solid(gib, "none"); game.motion(gib, "toss"); game.show(gib); game.schedule(gib, 0.1, freeProjectile);
        }
        if (entity.wait < 19) entity.frame++;
      } else {
        entity.frame++;
        if (entity.frame === 8) {
          game.schedule(entity, 1, freeProjectile);
          const food = game.spawn({ classname: "item_foodcube", ordinal: -1, values: new Map([
            ["count", String(game.host.combat.read(entity.actor.id)?.mass ?? 0)], ["spawnflags", "65536"],
            ["origin", `${body.origin.x} ${body.origin.y} ${body.origin.z + 16}`],
          ]) });
          food.classname = "foodcube"; game.move(food, { velocity: { x: 0, y: 0, z: 400 } }); game.motion(food, "toss");
        }
      }
      return game.show(entity);
    }
    entity.effects &= ~0x2000000;
    if (entity.frame >= 4) { entity.effects |= 0x2000000; game.move(entity, { bounds: { min: zero, max: zero } }); }
    if (entity.frame < 4) entity.frame++;
    let best: ActorId | null = null, oldLength = 8000;
    for (const actor of game.host.nearby(body.origin, 256)) {
      if (actor === entity.actor.id || !game.host.isPlayer(actor) && !game.host.isMonster(actor) || (game.host.combat.read(actor)?.health ?? 0) <= 0 || !sight(game, entity, actor)) continue;
      if (best === null) { best = actor; continue; }
      const target = game.host.bodies.read(actor); if (target === null) continue;
      const distance = Math.trunc(length(subtract(body.origin, target.origin)));
      if (distance < oldLength) { oldLength = distance; best = actor; }
    }
    if (best !== null) {
      const owned = game.host.actors.resolveOwned(best), targetBody = game.host.bodies.read(best);
      if (owned !== null && targetBody !== null) {
        const origin = targetBody.ground === null ? targetBody.origin : add(targetBody.origin, { x: 0, y: 0, z: 1 });
        game.host.bodies.write(owned, { ...targetBody, origin, ground: null });
        const delta = subtract(body.origin, origin), distance = Math.trunc(length(delta));
        if (game.host.isPlayer(best)) velocity(game, best, add(targetBody.velocity, scale(normalize(delta), 250)), true);
        else {
          const monster = this.hooks.monster(best);
          if (monster !== null) { monster.state.idealYaw = vectorAngles(delta).y; changeYaw(monster); }
          velocity(game, best, scale(angleVectors(game.host.bodies.read(best)?.angles ?? targetBody.angles).forward, 256), true);
        }
        game.sound(entity, "weapons/trapsuck.wav", 2, 1, 2);
        if (distance < 32) {
          const mass = game.host.combat.read(best)?.mass ?? 0;
          if (mass >= 400) return explode(entity, game);
          entity.style = game.entity(best)?.classname === "monster_gekk" ? 1 : 0;
          game.damage(best, entity, entity.owner, 100000, 1, zero, origin, zero, mod.trap, 0, "q2:ammo_trap");
          entity.enemy = best; entity.wait = 64; entity.timestamp = now + 30;
          game.host.combat.setTraits(entity.actor, { mass: Math.trunc(mass / (game.options.mode === "deathmatch" ? 4 : 10)) }); entity.frame = 5;
        }
      }
    }
    return game.show(entity);
  };

  fireTrap(self: Pick<Q2Entity, "actor">, game: Q2GameServices, start: Vec3, direction: Vec3, damage: number, speed: number, timer: number, radius: number, held: boolean): Q2Entity {
    const trap = this.throwMine(self, game, "trap", start, direction, speed);
    if (game.options.edition === "rerelease") {
      const axes = angleVectors(vectorAngles(direction)), body = game.body(trap), baseUp = dot(subtract(body.velocity, scale(direction, speed)), axes.up);
      const gravity = this.hooks.gravity?.() ?? this.hooks.base.inputs.get(self.actor.id)?.gravity ?? 800;
      trap.classname = "food_cube_trap"; trap.model = "models/weapons/z_trap/tris.md2"; trap.effects = 0; trap.renderFlags = 0;
      trap.flags = 0x20000 | 0x2000; trap.flags += 2 ** 32; trap.die = this.trapDie; trap.angularVelocity = { x: 0, y: 300, z: 0 };
      trap.clipMask = 0x42004003;
      if (game.host.isPlayer(self.actor.id) && this.hooks.base.inputs.get(self.actor.id)?.playersCollide === false) trap.clipMask &= ~0x40000000;
      trap.timestamp = game.host.now() + 30; trap.sound = "weapons/traploop.wav";
      game.host.combat.create(trap.actor, { health: 20, armor: { kind: "none" }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
      game.move(trap, { angles: zero, velocity: add(body.velocity, scale(axes.up, baseUp * (gravity / 800 - 1))), bounds: { min: { x: -4, y: -4, z: 0 }, max: { x: 4, y: 4, z: 8 } } }, false);
      game.schedule(trap, 1, this.trapRerelease); publishProjectile(trap, game, trap.sound); return trap;
    }
    trap.classname = "htrap"; trap.model = "models/weapons/z_trap/tris.md2"; trap.effects = 0; trap.renderFlags = 0; trap.damageableTarget = false;
    trap.teamMaster = null; trap.damage = damage; trap.damageRadius = radius; trap.spawnflags = held ? 3 : 1;
    trap.angularVelocity = { x: 0, y: 300, z: 0 }; trap.timestamp = game.host.now() + 30;
    game.move(trap, { angles: zero, bounds: { min: { x: -4, y: -4, z: 0 }, max: { x: 4, y: 4, z: 8 } } }, false);
    game.host.combat.create(trap.actor, { health: 0, armor: { kind: "none" }, mass: 0, canTakeDamage: false, invulnerable: false, team: null });
    if (timer <= 0) {
      this.hooks.base.playerNoise(self, game, start, "impact");
      game.radiusDamage(trap, trap.owner, trap.damage, null, radius, held ? 24 : 16, 0, "q2:ammo_trap");
      this.grenadeEffect(trap, game); game.remove(trap);
    } else { game.schedule(trap, 1, this.trapThink); publishProjectile(trap, game, "weapons/traploop.wav"); }
    return trap;
  }
}
