/* Xatrix g_func.c/g_misc.c source-only scenery and campaign entities. GPL-2.0-or-later. */
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import { freeQ2Entity } from "../../foundation/callbacks.ts";
import type { Q2Die, Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Use } from "../../foundation/host.ts";
import { movedir, numberField, normalize, subtract, zero } from "../../foundation/fields.ts";
import { q2TargetLaserThink } from "../../base/entities/targets.ts";
import type { Q2MissionPackEntityHooks } from "./types.ts";

export class Q2XatrixEntities implements Q2SpawnModule {
  constructor(readonly hooks: Q2MissionPackEntityHooks) {}
  get callbacks(): Q2CallbackDefinitions {
    return { think: { rotating_light_alarm: this.alarm, object_repair_sparks: this.repairSparks, object_repair_dead: this.repairDead,
      object_repair_fx: this.repairFx, amb4_think: this.ambience, mal_laser_think: this.malThink, target_laser_think: q2TargetLaserThink }, die: { rotating_light_killed: this.lightKilled },
      use: { rotating_light_use: this.lightUse, misc_viper_missile_use: this.missileUse, use_nuke: this.nukeUse, target_mal_laser_use: this.malUse } };
  }

  private sparks(entity: Q2Entity, game: Q2GameServices, count: number): undefined {
    return game.host.emit({ kind: "effect", effect: "q2:welding_sparks", origin: game.body(entity).origin, direction: zero,
      count, color: 0xe0 + Math.floor(game.host.random() * 8) });
  }

  private readonly alarm: Q2Think = (entity, game) => {
    if ((entity.spawnflags & 1) !== 0) return game.cancel(entity);
    game.sound(entity, "misc/alarm.wav", 10, 1, 3); return game.schedule(entity, 1, this.alarm);
  };

  private readonly lightKilled: Q2Die = (entity, game) => {
    this.sparks(entity, game, 30); entity.effects &= ~0x800000; entity.use = null;
    game.show(entity); return game.schedule(entity, 0.1, freeQ2Entity);
  };

  private readonly lightUse: Q2Use = (entity, game) => {
    if ((entity.spawnflags & 1) !== 0) {
      entity.spawnflags &= ~1; entity.effects |= 0x800000;
      if ((entity.spawnflags & 2) !== 0) game.schedule(entity, 0.1, this.alarm);
    } else { entity.spawnflags |= 1; entity.effects &= ~0x800000; }
    return game.show(entity);
  };

  private readonly repairFx: Q2Think = (entity, game) => {
    const health = game.host.combat.read(entity.actor.id)?.health;
    if (health === undefined) throw new Error("Source repair object lost health");
    if (health <= 100) game.host.combat.setHealth(entity.actor, health + 1); else this.sparks(entity, game, 10);
    return game.schedule(entity, entity.delay, this.repairFx);
  };

  private readonly repairDead: Q2Think = (entity, game) => {
    game.useTargets(entity, entity.actor.id);
    return game.host.actors.isLive(entity.actor.id) ? game.schedule(entity, 0.1, this.repairFx) : undefined;
  };

  private readonly repairSparks: Q2Think = (entity, game) => {
    if ((game.host.combat.read(entity.actor.id)?.health ?? 0) < 0) return game.schedule(entity, 0.1, this.repairDead);
    this.sparks(entity, game, 10); return game.schedule(entity, entity.delay, this.repairSparks);
  };

  private readonly ambience: Q2Think = (entity, game) => {
    game.sound(entity, "world/amb4.wav", 2, 1, 0); return game.schedule(entity, 2.7, this.ambience);
  };

  private readonly missileUse: Q2Use = (entity, game) => {
    const target = game.targets(entity.target)[0];
    if (target === undefined) { game.host.diagnostic(`misc_viper_missile missing target ${entity.target}`); return undefined; }
    entity.enemy = target.actor.id;
    const origin = game.body(entity).origin, direction = normalize(subtract(game.body(target).origin, origin));
    this.hooks.weapons.fireRocket(entity, game, origin, direction, entity.damage, 500, entity.damage + 20, entity.damage);
    game.host.emit({ kind: "monster-muzzleflash", actor: entity.actor.id, flash: 57, origin, direction });
    return game.schedule(entity, 0.1, freeQ2Entity);
  };

  private readonly nukeUse: Q2Use = (entity, game) => {
    for (const target of [...game.entities.values()]) {
      if (target === entity) continue;
      if (game.host.isPlayer(target.actor.id)) game.damage(target.actor.id, entity, entity.actor.id, 100000, 1, zero, game.body(target).origin, zero, 39);
      else if (game.host.isMonster(target.actor.id)) game.remove(target);
    }
    entity.use = null; return undefined;
  };

  private readonly malThink: Q2Think = (entity, game) => {
    q2TargetLaserThink(entity, game); entity.spawnflags |= 0x80000000;
    return game.schedule(entity, entity.wait + 0.1, this.malThink);
  };

  private malOn(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.activator ??= entity.actor.id; entity.spawnflags |= 0x80000001; entity.visible = true; game.show(entity);
    return game.schedule(entity, entity.wait + entity.delay, this.malThink);
  }

  private malOff(entity: Q2Entity, game: Q2GameServices): undefined {
    entity.spawnflags &= ~1; entity.visible = false; game.cancel(entity); game.show(entity);
    return game.host.emit({ kind: "beam", actor: entity.actor.id, start: game.body(entity).origin, end: game.body(entity).origin, width: entity.frame, color: entity.skin, visible: false });
  }

  private readonly malUse: Q2Use = (entity, game, _other, activator) => {
    entity.activator = activator; return (entity.spawnflags & 1) !== 0 ? this.malOff(entity, game) : this.malOn(entity, game);
  };

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "rotating_light": {
        const health = numberField(entity.spawn, "health") || 10;
        entity.model = "models/objects/light/tris.md2"; entity.speed ||= 32; entity.maxHealth = health; entity.frame = 0;
        entity.use = this.lightUse; entity.die = this.lightKilled;
        entity.effects = (entity.spawnflags & 1) !== 0 ? entity.effects & ~0x800000 : entity.effects | 0x800000;
        game.host.combat.create(entity.actor, { health, mass: 0, armor: { kind: "none" }, canTakeDamage: true, invulnerable: false, team: null });
        game.solid(entity, "box"); game.motion(entity, "stop"); game.show(entity); break;
      }
      case "func_object_repair":
        entity.classname = "object_repair"; entity.delay ||= 1;
        game.host.combat.create(entity.actor, { health: 100, mass: 0, armor: { kind: "none" }, canTakeDamage: false, invulnerable: false, team: null });
        game.move(entity, { bounds: { min: { x: -8, y: -8, z: 8 }, max: { x: 8, y: 8, z: 8 } } });
        game.solid(entity, "box"); game.motion(entity, "stationary"); game.schedule(entity, 1, this.repairSparks); break;
      case "misc_viper_missile":
        entity.damage ||= 250; entity.model = "models/objects/bomb/tris.md2"; entity.visible = false; entity.use = this.missileUse;
        game.move(entity, { bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } });
        game.solid(entity, "none"); game.motion(entity, "stationary"); game.show(entity); break;
      case "misc_amb4": game.schedule(entity, 1, this.ambience); break;
      case "misc_nuke": entity.use = this.nukeUse; break;
      case "misc_crashviper": case "misc_transport": {
        if (entity.target === "") { game.host.diagnostic(`${entity.classname} without a target`); game.remove(entity); break; }
        const transport = entity.classname === "misc_transport", angles = game.body(entity).angles;
        this.hooks.movers.spawnTrain(entity, game); entity.blocked = null;
        entity.model = transport ? "models/objects/ship/tris.md2" : "models/ships/bigviper/tris.md2";
        game.move(entity, { angles });
        if (transport) entity.spawnflags |= 1;
        game.show(entity); break;
      }
      case "target_mal_laser":
        entity.renderFlags |= 0xa0; entity.frame = (entity.spawnflags & 64) !== 0 ? 16 : 4;
        entity.skin = (entity.spawnflags & 2) !== 0 ? 0xf2f2f0f0 : (entity.spawnflags & 4) !== 0 ? 0xd0d1d2d3 :
          (entity.spawnflags & 8) !== 0 ? 0xf3f3f1f1 : (entity.spawnflags & 16) !== 0 ? 0xdcdddedf : (entity.spawnflags & 32) !== 0 ? 0xe0e1e2e3 : 0;
        entity.movedir = movedir(game.body(entity).angles); entity.delay ||= 0.1; entity.wait ||= 0.1; entity.damage ||= 5; entity.use = this.malUse;
        game.move(entity, { angles: zero, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } } });
        game.solid(entity, "none"); game.motion(entity, "stationary");
        if ((entity.spawnflags & 1) !== 0) this.malOn(entity, game); else this.malOff(entity, game);
        break;
      default: return false;
    }
    game.sourceCallbacks.register(this.callbacks); return true;
  }
}
