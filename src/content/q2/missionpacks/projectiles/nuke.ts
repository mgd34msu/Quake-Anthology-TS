/* Rogue g_newweap.c / g_combat.c antimatter bomb. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2Think, Q2Touch } from "../../foundation/host.ts";
import { add, length, scale, subtract, zero } from "../../foundation/fields.ts";
import { effect, publishProjectile, velocity } from "./common.ts";
import { Q2MissionPackMines } from "./mines.ts";
import { q2MissionPackDamage as mod } from "../types.ts";

export class Q2MissionPackNuke extends Q2MissionPackMines {
  override get callbacks(): Q2CallbackDefinitions {
    const base = super.callbacks;
    return { ...base, think: { ...base.think, Nuke_Think: this.nukeThink, Nuke_Quake: this.nukeQuake },
      touch: { ...base.touch, nuke_bounce: this.nukeBounce }, die: { ...base.die, nuke_die: this.nukeDie } };
  }

  private readonly nukeBounce: Q2Touch = (entity, game) => game.sound(entity, game.host.random() > 0.5 ? "weapons/hgrenb1a.wav" : "weapons/hgrenb2a.wav", 2);
  private readonly nukeDie: Q2Die = (entity, game, reaction) => {
    game.host.combat.setTraits(entity.actor, { canTakeDamage: false });
    return game.entity(reaction.attacker)?.classname === "nuke" ? game.remove(entity) : this.nukeExplode(entity, game);
  };

  private nukeExplode(entity: Q2Entity, game: Q2GameServices): undefined {
    const origin = game.body(entity).origin, owner = entity.teamMaster, blinded = new Set<ActorId>();
    if (owner !== null) this.hooks.base.playerNoiseForActor(owner, game, origin, "impact");
    for (const actor of game.host.nearby(origin, entity.damageRadius * 2)) {
      if (actor === entity.actor.id || !game.host.actors.isLive(actor) || game.host.combat.read(actor)?.canTakeDamage !== true) continue;
      const target = game.entity(actor), body = game.host.bodies.read(actor);
      if (body === null || !game.host.isPlayer(actor) && !game.host.isMonster(actor) && target?.damageableTarget !== true) continue;
      const distance = length(subtract(origin, add(body.origin, scale(add(body.bounds.min, body.bounds.max), 0.5))));
      const points = distance <= entity.damageRadius ? 10000 : entity.damage / entity.damageRadius * (2 * entity.damageRadius - distance);
      if (points <= 0) continue;
      if (game.host.isPlayer(actor)) {
        if (distance <= entity.damageRadius && target !== null) target.flags |= 0x10000;
        this.hooks.playerEffect({ kind: "nuke-blind", actor, until: game.host.now() + 2 }); blinded.add(actor);
      }
      game.damage(actor, entity, entity.teamMaster, Math.trunc(points), Math.trunc(points), subtract(body.origin, origin), origin, zero, mod.nuke, 1, "q2:ammo_nuke");
    }
    for (const actor of game.host.players()) {
      if (blinded.has(actor)) continue;
      const body = game.host.bodies.read(actor); if (body === null) continue;
      const trace = game.host.trace({ start: origin, end: body.origin, bounds: null, ignore: entity.actor.id, mask: 3 });
      const duration = trace.fraction === 1 ? 2 : length(subtract(body.origin, origin)) < 2048 ? 1.5 : 1;
      this.hooks.playerEffect({ kind: "nuke-blind", actor, until: game.host.now() + duration });
    }
    if (entity.damage > 400) game.sound(entity, "items/damage3.wav", 3);
    game.sound(entity, "weapons/grenlx1a.wav", 10, 1, 0);
    effect(entity, game, "explosion1_big"); effect(entity, game, "nukeblast");
    entity.visible = false; entity.speed = 100; entity.timestamp = game.host.now() + 3; entity.delay = 0; game.show(entity);
    return game.schedule(entity, game.host.frameSeconds(), this.nukeQuake);
  }

  private readonly nukeQuake: Q2Think = (entity, game) => {
    if (entity.delay < game.host.now()) { game.sound(entity, "world/rumble.wav", 0, 0.75, 0); entity.delay = game.host.now() + 0.5; }
    for (const actor of game.host.players()) {
      const body = game.host.bodies.read(actor); if (body === null || body.ground === null) continue;
      const mass = game.host.combat.read(actor)?.mass ?? 200;
      velocity(game, actor, { x: body.velocity.x + (game.host.random() * 2 - 1) * 150,
        y: body.velocity.y + (game.host.random() * 2 - 1) * 150, z: entity.speed * 100 / mass }, true);
    }
    return game.host.now() < entity.timestamp ? game.schedule(entity, game.host.frameSeconds(), this.nukeQuake) : game.remove(entity);
  };

  private readonly nukeThink: Q2Think = (entity, game) => {
    const multiplier = entity.damage / 400, divisor = multiplier === 1 ? 1.4 : multiplier === 2 ? 2 : multiplier === 4 ? 3 : multiplier === 8 ? 5 : 1;
    const flash = multiplier === 2 ? 37 : multiplier === 4 ? 38 : multiplier === 8 ? 39 : 36;
    if (entity.wait < game.host.now()) return this.nukeExplode(entity, game);
    if (game.host.now() >= entity.wait - 6) {
      if (++entity.frame > 11) entity.frame = 6;
      if ((game.host.pointContents(game.body(entity).origin) & 24) !== 0) return this.nukeExplode(entity, game);
      game.host.combat.setHealth(entity.actor, 1); entity.owner = null; game.motion(entity, entity.motion); game.show(entity);
      this.hooks.base.hooks.emit({ kind: "muzzleflash", actor: entity.actor.id, flash, silenced: false });
      if (entity.timestamp <= game.host.now()) {
        game.sound(entity, "weapons/nukewarn2.wav", 10, 1, 1.8 / divisor); entity.timestamp = game.host.now() + (entity.wait - game.host.now() <= 3 ? 0.3 : 0.5);
      }
      return game.schedule(entity, 0.1, this.nukeThink);
    }
    if (entity.timestamp <= game.host.now()) { game.sound(entity, "weapons/nukewarn2.wav", 10, 1, 1.8 / divisor); entity.timestamp = game.host.now() + 1; }
    return game.schedule(entity, game.host.frameSeconds(), this.nukeThink);
  };

  fireNuke(self: Q2Entity, game: Q2GameServices, start: Vec3, direction: Vec3, speed: number, multiplier: number): Q2Entity {
    const bomb = this.throwMine(self, game, "nuke", start, direction, speed);
    game.move(bomb, { angles: zero, bounds: { min: { x: -8, y: -8, z: 0 }, max: { x: 8, y: 8, z: 16 } } }, false);
    bomb.damage = 400 * multiplier; bomb.damageRadius = multiplier === 1 ? 512 : 512 + 128 * multiplier;
    bomb.wait = game.host.now() + 10; bomb.die = this.nukeDie; bomb.touch = this.nukeBounce;
    game.host.combat.create(bomb.actor, { health: 10000, armor: { regular: { kind: "none" }, powered: { kind: "none" } }, mass: 0, canTakeDamage: true, invulnerable: false, team: null });
    game.schedule(bomb, game.host.frameSeconds(), this.nukeThink); publishProjectile(bomb, game, "", { weapon: "q2:ammo_nuke", role: "grenade" }); return bomb;
  }
}
