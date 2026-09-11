/* quakec_mg1/horde.qc, combat.qc and client.qc.
 * Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import { callbackName } from "../../foundation/callbacks.ts";
import { spawnDoor } from "../../foundation/movers.ts";
import { overlaps, vadd, vsub } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";
import { chooseHordeSquad, hordeSquad } from "./squads.ts";
import type { HordeMonster, HordeSquadType } from "./squads.ts";
import type { Q1HordeServices } from "./types.ts";
import { registerHordeLoot, spawnHordePowerup } from "./loot.ts";
export type { Q1HordeServices } from "./types.ts";

export class Q1Horde {
  constructor(readonly context: Q1AddonContext, readonly services: Q1HordeServices) {
    if (context.program !== "mg1" && context.program !== "dopa") throw new Error("Official horde requires the MG1 source program");
    const { game } = context;
    context.base.registerKillCountRule("mg1:horde", monster => this.manager === null || monster.entity.classname !== "monster_zombie");
    game.registerWeaponRules({ id: "mg1:horde", attackDelay: (_game, player, delay) => {
      if (player.weapon !== "axe" || context.services.cvar("horde") === 0 || (context.base.campaign.readFlags() & 4) === 0) return delay;
      const chain = context.playerNumber(player.actor.id, "axe_hit_chain"), chop = chain >= 2 && game.time < context.playerNumber(player.actor.id, "axe_hit_chain_time");
      player.weaponAnimationBase = chop ? 1 : 5;
      return chop ? 0.8 : chain > 1 ? 0.6 : 0.4;
    } });
    game.named.register("mg1:horde:head_fade", { action: (_game, entity) => {
      if (context.services.cvar("horde") === 0) return game.cancel(entity);
      if (entity.number("alpha") === 0) context.alpha(entity, 1);
      return this.schedule(entity, "head_fade_step", 10 + game.host.random() * 5);
    } });
    game.named.register("mg1:horde:head_fade_step", { action: (_game, entity) => {
      if (entity.number("alpha") <= 0) return game.remove(entity);
      context.alpha(entity, Math.fround(entity.number("alpha") - context.frameTime));
      return this.schedule(entity, "head_fade_step", 0);
    } });
    game.named.register("mg1:horde:set", { action: (_game, entity) => this.schedule(entity, "countdown", 1) });
    game.named.register("mg1:horde:countdown", { action: (_game, entity) => {
      if (!this.prepare(entity)) return undefined;
      context.broadcast("3"); game.sound(entity, "misc/talk.wav", "voice", 0); return this.schedule(entity, "countdown2", 1);
    } });
    for (const [name, next, text] of [["countdown2", "countdown3", "2"], ["countdown3", "fight", "1"]] satisfies readonly (readonly [string, string, string])[]) {
      game.named.register("mg1:horde:" + name, { action: (_game, entity) => { context.broadcast(text); game.sound(entity, "misc/talk.wav", "voice", 0); return this.schedule(entity, next, 1); } });
    }
    game.named.register("mg1:horde:fight", { action: (_game, entity) => {
      context.broadcast(entity.number("wave") % 3 === 0 ? "$qc_horde_boss_wave" : "$qc_horde_fight"); this.spawnWave(entity); return game.sound(entity, "misc/talk.wav", "voice", 0);
    } });
    game.named.register("mg1:horde:wave", { action: (_game, entity) => this.spawnWave(entity) });
    game.named.register("mg1:horde:check", { action: (_game, entity) => this.checkWave(entity), use: (_game, entity) => this.checkWave(entity) });
    game.named.register("mg1:horde:point", { use: (_game, entity) => { entity.spawnflags ^= 1; return undefined; } });
    game.named.register("mg1:horde:door_touch", { touch: (_game, entity, other, normal) => {
      if (this.manager === null) return game.named.touch(entity, "door_touch")(other, normal);
      if (!game.isPlayer(other)) return undefined;
      const master = entity.doorGroup[0] ?? entity; if (master.attackFinished > game.time) return undefined;
      master.attackFinished = game.time + 2;
      if (master.message !== "") { game.message(other, master.message); const player = game.host.actors.resolveOwned(other); if (player !== null) game.sound(player, "misc/talk.wav", "voice"); }
      const silver = (entity.spawnflags & 16) !== 0, gold = (entity.spawnflags & 8) !== 0; if (!silver && !gold) return undefined;
      if (silver && game.host.inventory.count(other, "q1:key/silver") === 0 || gold && game.host.inventory.count(other, "q1:key/gold") === 0) {
        game.sound(entity, game.worldType === 2 ? "doors/basetry.wav" : game.worldType === 1 ? "doors/runetry.wav" : "doors/medtry.wav", "voice");
        if (silver !== gold) game.message(other, `$qc_need_${silver ? "silver" : "gold"}_${game.worldType === 2 ? "keycard" : game.worldType === 1 ? "runekey" : "key"}`);
        return undefined;
      }
      this.changeKeys(silver ? "silver" : "gold", -1);
      for (const door of master.doorGroup.length === 0 ? [master] : master.doorGroup) door.touch = null;
      return game.named.use(master, "door_use")(other, other);
    } });
    game.registerSpawn("func_door", (_game, entity) => { spawnDoor(game, entity); entity.touch = game.named.touch(entity, "mg1:horde:door_touch"); return undefined; });
    game.named.register("mg1:horde:found", { action: (_game, entity) => {
      const controller = context.base.monsters.get(entity.actor);
      if (controller !== undefined) return controller.enemy === null ? controller.play(controller.spec.stand) : controller.found(controller.enemy);
      if (entity.monster?.species === "army" || entity.monster?.species === "dog") return game.named.action(entity, "monster_found_target")();
      throw new Error("Horde monster lost its source controller");
    } });
    game.named.register("mg1:horde:die", { die: (_game, entity, attacker) => {
      if (entity.number("horde.countedDeath") !== 0) return undefined; context.setNumber(entity, "horde.countedDeath", 1);
      if (attacker !== null && game.isPlayer(attacker)) {
        const spree = context.playerNumber(attacker, "killspree") + 1; context.setPlayerNumber(attacker, "killspree", spree); context.setPlayerNumber(attacker, "killtime", game.time + 2);
        if (spree > 1) game.message(attacker, spree >= 14 ? `$qc_horde_streak_generic ${spree}` : `$qc_horde_streak_${spree}`, false);
      }
      spawnHordePowerup(this, entity);
      if (attacker !== null && game.isPlayer(attacker)) services.addScore(attacker, 1);
      // The base controller owns the kill counter. Horde zombies are excluded by its source hook.
      game.named.die(entity, entity.text("horde.sourceDie"))(attacker);
      if (game.live(entity) && entity.movement === "bounce" && entity.model.startsWith("progs/h_")) this.schedule(entity, "head_fade", 1);
      return entity.classname === "monster_zombie" ? undefined : this.remoteWavecheck();
    } });
    game.registerSpawn("horde_manager", (_game, entity) => {
      if (context.services.cvar("horde") === 0 && game.options.deathmatch === 0) context.services.setCvar("horde", "1");
      entity.target ||= "horde_event"; entity.targetname = "horde_manager"; entity.wait = 1; entity.delay = 9;
      context.setNumber(entity, "wave", 0); context.setNumber(entity, "horde.startingFlags", context.base.campaign.readFlags());
      entity.use = game.named.use(entity, "mg1:horde:check"); return this.schedule(entity, "set", 10);
    });
    for (const classname of ["info_monster_start", "info_monster_start_flying", "info_monster_start_ranged", "info_monster_start_boss"]) game.registerSpawn(classname, (_game, entity) => {
      const width = classname === "info_monster_start_ranged" || classname === "info_monster_start_boss" ? 44 : 80;
      entity.wait = 0; entity.use = game.named.use(entity, "mg1:horde:point"); return game.setBounds(entity, { min: { x: -width, y: -width, z: 0 }, max: { x: width, y: width, z: 128 } });
    });
    game.registerPlayerExtension({ id: "mg1:horde", attach: (_game, player) => { this.restoreKeys(player.actor.id); return undefined; }, afterPhysics: (_game, player) => {
      const spree = context.playerNumber(player.actor.id, "killspree");
      if (spree > 0 && game.time > context.playerNumber(player.actor.id, "killtime")) {
        if (spree > 1) { const score = Math.ceil(spree * spree / 2); game.message(player.actor.id, `$qc_horde_streak_ended ${score}`, false); services.addScore(player.actor.id, score); }
        context.setPlayerNumber(player.actor.id, "killspree", 0);
      }
      return undefined;
    } });
    registerHordeLoot(this);
  }
  get game() { return this.context.game; }
  get manager(): Q1Actor | null { return [...this.game.entities.values()].find(entity => entity.classname === "horde_manager") ?? null; }
  schedule(entity: Q1Actor, name: string, delay: number): undefined { return this.game.schedule(entity, delay, this.game.named.action(entity, "mg1:horde:" + name)); }
  livingPlayers(): readonly ActorId[] { return this.game.host.players().filter(player => this.game.health(player) > 0); }
  livingMonsters(): readonly Q1Actor[] { return [...this.game.entities.values()].filter(entity => entity.text("category") === "monster" && entity.classname !== "monster_zombie" && this.game.health(entity.actor.id) > 0); }
  target(): ActorId | null {
    const count = this.livingPlayers().length; if (count === 0) return null;
    const roll = this.game.host.random() * count; let index = 0;
    for (const player of this.game.host.players()) { if (this.game.health(player) > 0) index++; if (roll <= index && !this.services.noTarget(player)) return player; }
    return null;
  }
  blocked(point: Q1Actor): boolean {
    if ((point.spawnflags & 2) !== 0) return false;
    const source = this.game.body(point), min = vadd(source.origin, source.bounds.min), max = vadd(source.origin, source.bounds.max);
    return this.livingPlayers().some(player => {
      if (this.services.deadFlag(player) > 0) return false;
      const body = this.game.host.bodies.read(player); if (body === null) return false;
      const low = vadd(body.origin, body.bounds.min), high = vadd(body.origin, body.bounds.max);
      // Official CheckBlockedSpawn repeats the Y comparison and does not test Z.
      return high.x > min.x && low.x < max.x && high.y > min.y && low.y < max.y;
    });
  }
  findSpawn(type: HordeSquadType): Q1Actor | null {
    const points = (kind: HordeSquadType): Q1Actor[] => [...this.game.entities.values()].filter(entity => entity.classname === (kind === "normal" ? "info_monster_start" : `info_monster_start_${kind}`));
    const valid = (point: Q1Actor): boolean => this.game.time > point.wait && (point.spawnflags & 1) === 0 && !this.blocked(point);
    let candidates = points(type);
    if (!candidates.some(valid)) { if (type === "normal") return null; candidates = points("normal"); }
    if (!candidates.some(valid)) return null;
    const roll = candidates.length * this.game.host.random();
    return candidates.find((point, index) => index + 1 >= roll && valid(point)) ?? candidates.find(valid) ?? null;
  }
  spawnMonster(kind: HordeMonster, origin: Vec3, angles: Vec3, owner: Q1Actor): Q1Actor {
    const classname = kind === "grunt" ? "monster_army" : kind === "hellknight" ? "monster_hell_knight" : kind === "demon" ? "monster_demon1" : `monster_${kind}`;
    const entity = this.game.create(classname); this.game.setBody(entity, { origin, angles }); this.game.spawnEntity(entity);
    const controller = this.context.base.monsters.get(entity.actor), monster = entity.monster;
    if (controller === undefined && monster?.species !== "army" && monster?.species !== "dog") throw new Error(`Horde has no native monster controller for ${kind}`);
    this.game.cancel(entity); const offset = kind === "demon" ? 48 : kind === "ogre" || kind === "shambler" || kind === "shalrath" || kind === "wizard" || kind === "zombie" ? 32 : 24;
    let position = vadd(origin, { x: 0, y: 0, z: offset + 1 });
    if (kind !== "wizard") {
      const trace = this.game.host.trace({ start: position, end: vsub(position, { x: 0, y: 0, z: 256 }), bounds: this.game.body(entity).bounds, ignore: entity.actor.id, monsters: true });
      if (trace.fraction < 1 && !trace.allSolid) { position = trace.end; this.game.setBody(entity, { ground: trace.actor }); entity.movementFlags |= 512; }
    }
    this.game.setOrigin(entity, position); this.game.host.walkMove(entity.actor, 0, 0);
    entity.fields.set("category", "monster"); entity.damageable = true; entity.owner = owner.actor.id; entity.yawSpeed = 20; entity.movementFlags |= 32;
    const target = this.target(); if (controller !== undefined) controller.enemy = target; else if (monster !== null) monster.enemy = target;
    const sourceDie = callbackName(entity.die); if (sourceDie === null) throw new Error("Horde monster has no named source death"); entity.fields.set("horde.sourceDie", sourceDie);
    entity.die = this.game.named.die(entity, "mg1:horde:die");
    if (kind === "zombie") this.game.totalMonsters--;
    this.schedule(entity, "found", 0.1);
    const death = this.game.create("teledeath"), bounds = this.game.body(entity).bounds;
    death.owner = entity.actor.id; death.solid = "trigger"; death.touch = this.game.named.touch(death, "tdeath_touch");
    this.game.setBody(death, { origin: position, bounds: { min: vsub(bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(bounds.max, { x: 1, y: 1, z: 1 }) } }); this.game.link(death);
    const box = this.game.body(death).bounds;
    for (const actor of this.game.host.actors.observations()) {
      const body = this.game.host.bodies.read(actor.id);
      if (body !== null && overlaps({ min: vadd(position, box.min), max: vadd(position, box.max) }, { min: vadd(body.origin, body.bounds.min), max: vadd(body.origin, body.bounds.max) })) this.game.host.callbacks.touch({ self: death.actor, other: actor.id, plane: null, surface: null });
    }
    this.game.schedule(death, 0.01, this.game.named.action(death, "SUB_Remove")); return entity;
  }
  prepare(manager: Q1Actor): boolean {
    const { context, game } = this; context.setNumber(manager, "key_spawned", 0);
    const players = this.livingPlayers().length; if (players < 1) return false;
    for (const entity of game.entities.values()) if (entity.classname === "info_horde_item" && entity.wait === 0) this.schedule(entity, "item", game.host.random() * 2);
    const wave = manager.number("wave") + 1, skill = game.options.skill, level = wave + (skill >= 3 ? 6 : skill >= 2 ? 3 : 0), army = (level + 2) % 3 === 0;
    context.setNumber(manager, "wave", wave); context.setNumber(manager, "army", army ? 1 : 0);
    const scale = players >= 4 ? 2 : players >= 3 ? 1.5 : players >= 2 ? 1.25 : 1;
    let bosses = manager.number("bosses");
    if (level % 3 === 0) bosses = Math.floor((level + 1) / 4);
    else if (skill > 1 && !army && level > 9) bosses = Math.floor((level + 1) / 8);
    const elites = Math.floor((Math.ceil((level - 1) / 3) - Math.floor(bosses / 2)) * scale), fodder = Math.floor((level + 2 - (bosses * 2 + elites)) * scale);
    context.setNumber(manager, "bosses", bosses); context.setNumber(manager, "elites", elites); context.setNumber(manager, "fodder", fodder);
    for (const target of game.find(manager.target)) target.use?.(manager.actor.id, manager.activator);
    manager.wait = 1; return true;
  }
  spawnWave(manager: Q1Actor): undefined {
    const category = manager.number("fodder") > 0 ? "fodder" : manager.number("elites") > 0 ? "elites" : "bosses";
    const selection = chooseHordeSquad(manager.number("army") !== 0, category, () => this.game.host.random());
    if (selection === null) { this.context.setNumber(manager, "bosses", 0); return this.schedule(manager, "wave", 1); }
    const point = this.findSpawn(selection.type); if (point === null) return this.schedule(manager, "wave", 1);
    point.wait = this.game.time + 5; this.game.useTargets(point, manager.activator);
    const body = this.game.body(point);
    for (const spawn of hordeSquad(selection.squad, this.game.options.skill, () => this.game.host.random())) this.spawnMonster(spawn.monster, vadd(body.origin, spawn.offset), body.angles, manager);
    this.game.effect("teleport", body.origin); this.context.setNumber(manager, category, manager.number(category) - 1);
    if (manager.number("fodder") + manager.number("elites") + manager.number("bosses") <= 0) { manager.wait = 0; return this.schedule(manager, "check", 30); }
    return this.schedule(manager, "wave", 2 + this.game.host.random());
  }
  checkWave(manager: Q1Actor): undefined {
    if (manager.wait !== 0) return undefined;
    this.schedule(manager, "check", 10);
    if (this.game.killedMonsters + 3 >= this.game.totalMonsters) for (const entity of this.game.entities.values()) if (entity.text("category") === "monster" && this.game.health(entity.actor.id) <= 0) entity.fields.set("category", "");
    const wave = manager.number("wave"); if (this.livingMonsters().length > (wave % 3 === 0 || wave < 3 ? 0 : 5)) return undefined;
    for (const player of this.game.host.players()) if (this.services.deadFlag(player) > 0) this.services.respawnTeammate(player);
    manager.wait = 1;
    if (wave % 3 === 0) {
      if (manager.number("key_spawned") === 0) this.getKey(manager);
      return this.schedule(manager, "countdown", 20);
    }
    return this.schedule(manager, "countdown", 0);
  }
  remoteWavecheck(): undefined { const manager = this.manager; return manager === null || this.game.intermission !== null ? undefined : this.checkWave(manager); }
  getKey(manager: Q1Actor): undefined {
    const points = [...this.game.entities.values()].filter(entity => entity.classname === "info_horde_key"), first = points[0];
    if (first === undefined) return this.schedule(manager, "countdown", 4);
    const wave = manager.number("wave"), flag = wave <= 3 ? 1 : wave <= 6 ? 2 : wave <= 9 ? 4 : 8, point = points.find(entity => (entity.spawnflags & flag) !== 0);
    return this.schedule(point ?? first, point === undefined ? wave === 9 ? "gold" : "silver" : flag === 4 ? "gold" : "silver", 0);
  }
  restoreKeys(player: ActorId): undefined {
    const manager = this.manager, actor = this.game.host.actors.resolveOwned(player); if (manager === null || actor === null) return undefined;
    for (const key of ["silver", "gold"] satisfies readonly ("silver" | "gold")[]) if (manager.number(`keys_${key}`) > 0) this.game.host.inventory.give(actor, `q1:key/${key}`, 1);
    return undefined;
  }
  changeKeys(key: "silver" | "gold", delta: 1 | -1): undefined {
    const manager = this.manager; if (manager === null) throw new Error("Horde keys require their manager");
    const count = manager.number(`keys_${key}`) + delta; this.context.setNumber(manager, `keys_${key}`, count);
    if (delta === 1 && count === 1 || delta === -1 && count === 0) for (const player of this.game.host.players()) {
      const actor = this.game.host.actors.resolveOwned(player); if (actor === null) continue;
      if (delta === 1) this.game.host.inventory.give(actor, `q1:key/${key}`, 1); else this.game.host.inventory.consume(actor, `q1:key/${key}`, 1);
    }
    return undefined;
  }
  teammateKilled(attacker: ActorId): undefined {
    if (this.context.services.cvar("horde") === 0) return undefined;
    this.context.setPlayerNumber(attacker, "killtime", 0); return this.services.addScore(attacker, -2);
  }
  /** Called after the source dead-player release/press gate; true consumes ordinary respawn. */
  requestRespawn(): boolean {
    if (this.manager === null) return false;
    if (!this.game.options.coop || this.livingPlayers().length === 0) this.restartAfterDefeat();
    return true;
  }
  restartAfterDefeat(): undefined {
    const manager = this.manager; if (manager === null) throw new Error("Horde restart requires its manager");
    const flags = manager.number("horde.startingFlags"); this.context.base.campaign.writeFlags(flags); return this.services.restartSession(this.game.mapName, flags);
  }
}

export function registerQ1Horde(context: Q1AddonContext, services: Q1HordeServices): Q1Horde { return new Q1Horde(context, services); }
