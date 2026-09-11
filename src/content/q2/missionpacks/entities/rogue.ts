/* Rogue g_newtrig.c/g_newtarg.c and misc_nuke_core. GPL-2.0-or-later. */
import type { Q2CallbackDefinitions } from "../../foundation/callbacks.ts";
import type { Q2Entity, Q2GameServices, Q2SpawnModule, Q2Think, Q2Touch, Q2Use } from "../../foundation/host.ts";
import { add, integerField, movedir, normalize, scale, subtract, zero } from "../../foundation/fields.ts";
import { killQ2Box } from "../../foundation/scenery.ts";
import { sight } from "../projectiles/common.ts";
import type { Q2MissionPackEntityHooks } from "./types.ts";

export interface Q2RogueEntitiesCheckpoint { readonly steamId: number; }

export class Q2RogueEntities implements Q2SpawnModule {
  private steamId = 0;
  constructor(readonly hooks: Q2MissionPackEntityHooks) {}
  get callbacks(): Q2CallbackDefinitions {
    return { think: { target_steam_start: this.steamStart, blacklight_think: this.blackLight, orb_think: this.orb },
      touch: { trigger_teleport_touch: this.teleportTouch, trigger_disguise_touch: this.disguiseTouch },
      use: { trigger_teleport_use: this.teleportUse, trigger_disguise_use: this.disguiseUse, use_target_steam: this.steamUse,
        target_anger_use: this.angerUse, target_killplayers_use: this.killPlayers, misc_nuke_core_use: this.coreUse } };
  }

  capture(): Q2RogueEntitiesCheckpoint { return { steamId: this.steamId }; }
  restore(state: Q2RogueEntitiesCheckpoint): undefined { this.steamId = state.steamId; return undefined; }

  private readonly teleportUse: Q2Use = entity => { entity.delay = entity.delay === 0 ? 1 : 0; return undefined; };
  private readonly teleportTouch: Q2Touch = (entity, game, contact) => {
    if (!game.host.isPlayer(contact.other) || entity.delay !== 0) return undefined;
    const destination = game.targets(entity.target)[0], player = game.entity(contact.other);
    if (destination === undefined) { game.host.diagnostic("Teleport Destination not found!"); return undefined; }
    if (player === null) return undefined;
    game.host.emit({ kind: "effect", effect: "q2:teleport_effect", origin: game.body(player).origin, direction: zero, count: 1, color: 0 });
    const body = game.body(destination), origin = add(body.origin, { x: 0, y: 0, z: 10 });
    game.host.bodies.unlink(player.actor); game.move(player, { origin, velocity: zero, angles: zero }, false);
    this.hooks.teleportPlayer(player.actor.id, origin, body.angles);
    game.host.emit({ kind: "entity-event", actor: player.actor.id, event: 6 });
    killQ2Box(player, game); return game.link(player);
  };

  private readonly disguiseTouch: Q2Touch = (entity, game, contact) => {
    if (!game.host.isPlayer(contact.other)) return undefined;
    const player = game.entity(contact.other);
    if (player !== null) player.flags = (entity.spawnflags & 4) !== 0 ? player.flags & ~0x8000 : player.flags | 0x8000;
    return undefined;
  };
  private readonly disguiseUse: Q2Use = (entity, game) => game.solid(entity, entity.solid === "none" ? "trigger" : "none");
  private readonly coreUse: Q2Use = (entity, game) => { entity.visible = !entity.visible; return game.show(entity); };

  private readonly steamStart: Q2Think = (entity, game) => {
    entity.use = this.steamUse;
    if (entity.target !== "") {
      entity.enemy = game.targets(entity.target)[0]?.actor.id ?? null;
      if (entity.enemy === null) game.host.diagnostic(`${entity.classname}: ${entity.target} is a bad target`);
    } else { entity.movedir = movedir(game.body(entity).angles); game.move(entity, { angles: zero }); }
    entity.count = (entity.count || 32) & 255; entity.speed ||= 75; entity.style = (integerField(entity.spawn, "sounds") || 8) & 255;
    entity.wait *= 1000; entity.visible = false; return game.show(entity);
  };

  private readonly steamUse: Q2Use = (entity, game, other) => {
    if (this.steamId > 20000) this.steamId %= 20000;
    this.steamId++;
    if (entity.wait === 0) entity.wait = other === null ? 1000 : (game.entity(other)?.wait ?? 0) * 1000;
    const target = entity.enemy === null ? null : game.host.bodies.read(entity.enemy), origin = game.body(entity).origin;
    if (target !== null) entity.movedir = normalize(subtract(add(target.origin, scale(add(target.bounds.min, target.bounds.max), 0.5)), origin));
    return this.hooks.emit({ kind: "steam", id: entity.wait > 100 ? this.steamId : -1, origin, direction: entity.movedir,
      count: entity.count, color: entity.style, speed: Math.trunc(entity.speed), milliseconds: entity.wait > 100 ? Math.trunc(entity.wait) : 0 });
  };

  private readonly angerUse: Q2Use = (entity, game) => {
    const target = game.targets(entity.killtarget)[0];
    if (target === undefined || entity.target === "") return undefined;
    target.serverFlags |= 4;
    if (game.host.combat.read(target.actor.id) === null)
      game.host.combat.create(target.actor, { health: 300, mass: 0, armor: { kind: "none" }, canTakeDamage: false, invulnerable: false, team: null });
    else game.host.combat.setHealth(target.actor, 300);
    for (const monster of game.targets(entity.target)) {
      if (monster === entity) game.host.diagnostic("WARNING: entity used itself.");
      else if (monster.use !== null) {
        if ((game.host.combat.read(monster.actor.id)?.health ?? 0) < 0) return undefined;
        this.hooks.targetAnger(monster, target, game);
      }
      if (!game.host.actors.isLive(entity.actor.id)) { game.host.diagnostic("entity was removed while using targets"); return undefined; }
    }
    return undefined;
  };

  private readonly killPlayers: Q2Use = (entity, game) => {
    const origin = game.body(entity).origin;
    for (const player of game.host.players()) game.damage(player, entity, entity.actor.id, 100000, 0, zero, origin, zero, 21, 32);
    for (const target of [...game.entities.values()]) {
      const combat = game.host.combat.read(target.actor.id);
      if (combat === null || combat.health < 1 || !combat.canTakeDamage) continue;
      for (const actor of game.host.players()) {
        const player = game.entity(actor);
        if (player !== null && sight(game, player, target.actor.id)) {
          game.damage(target.actor.id, entity, entity.actor.id, combat.health, 0, zero, game.body(target).origin, zero, 21, 32); break;
        }
      }
    }
    return undefined;
  };

  private randomAngles(entity: Q2Entity, game: Q2GameServices): undefined {
    return game.move(entity, { angles: { x: Math.floor(game.host.random() * 360), y: Math.floor(game.host.random() * 360), z: Math.floor(game.host.random() * 360) } });
  }
  private readonly blackLight: Q2Think = (entity, game) => { this.randomAngles(entity, game); return game.schedule(entity, 0.1, this.blackLight); };
  private readonly orb: Q2Think = (entity, game) => { this.randomAngles(entity, game); return game.schedule(entity, 0.1, this.orb); };

  spawn(entity: Q2Entity, game: Q2GameServices): boolean {
    switch (entity.classname) {
      case "info_teleport_destination": break;
      case "trigger_teleport":
        entity.wait ||= 0.2; entity.delay = entity.targetname !== "" && (entity.spawnflags & 8) === 0 ? 1 : 0;
        entity.use = entity.targetname === "" ? null : this.teleportUse; entity.touch = this.teleportTouch;
        entity.movedir = movedir(game.body(entity).angles); game.move(entity, { angles: zero });
        game.solid(entity, "trigger"); game.motion(entity, "stationary"); break;
      case "trigger_disguise":
        entity.touch = this.disguiseTouch; entity.use = this.disguiseUse; entity.visible = false;
        game.solid(entity, (entity.spawnflags & 2) !== 0 ? "trigger" : "none"); game.motion(entity, "stationary"); game.show(entity); break;
      case "target_steam":
        if (entity.target !== "") game.schedule(entity, 1, this.steamStart); else this.steamStart(entity, game); break;
      case "target_anger":
        if (entity.target === "" || entity.killtarget === "") { game.host.diagnostic(`target_anger without ${entity.target === "" ? "target" : "killtarget"}!`); game.remove(entity); }
        else { entity.use = this.angerUse; entity.visible = false; game.show(entity); }
        break;
      case "target_killplayers": entity.use = this.killPlayers; entity.visible = false; game.show(entity); break;
      case "target_blacklight": case "target_orb": {
        if (game.options.mode === "deathmatch") { game.remove(entity); break; }
        const orb = entity.classname === "target_orb";
        entity.model = "models/items/spawngro2/tris.md2"; entity.effects = (entity.effects | (orb ? 0x10000000 : 0x80000000 | 0x4000000)) >>> 0;
        entity.frame = orb ? 2 : 1; game.move(entity, { bounds: { min: zero, max: zero } });
        game.schedule(entity, 0.1, orb ? this.orb : this.blackLight); game.show(entity); break;
      }
      case "misc_nuke_core": entity.model = "models/objects/core/tris.md2"; entity.use = this.coreUse; game.show(entity); break;
      default: return false;
    }
    game.sourceCallbacks.register(this.callbacks); return true;
  }
}
