/* quakec_mg3/ai.qc: source targeting, liquid damage and Horde movement policy.
 * Copyright (C) 1996-2026 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import { BaseMonster } from "../../../base/monsters.ts";
import type { MonsterAi } from "../../../base/animation.ts";
import { POINT, dot, normalize, vsub, yawFor } from "../../../foundation/types.ts";
import { walkMg3PathToGoal, Mg3PathResult } from "./path.ts";

function same(first: ActorId | null, second: ActorId | null): boolean {
  return first === null || second === null ? first === second : sameActor(first, second);
}

/** Shares the base source animation/combat owner; MG3 supplies only its differing AI policy. */
export class Mg3Monster extends BaseMonster {
  override makeVectors() { return this.game.makeVectors(this.game.body(this.entity).angles); }
  override attackFinished(seconds: number): undefined {
    this.state.refired = false;
    this.state.attackFinished = Math.fround(this.game.time + seconds);
    return undefined;
  }
  sightSound(): undefined {
    const { game, entity } = this;
    let sound = this.spec.sight;
    if (entity.classname === "monster_ogre" && entity.number("aflag") !== 0) sound = "armagon/sight.wav";
    else if (entity.classname === "monster_hell_knight" && entity.solid === "none" && (entity.spawnflags & (65536 | 8388608)) !== 0) return undefined;
    else if (entity.classname === "monster_enforcer") {
      const choice = Math.floor(game.host.random() * 3 + 0.5);
      sound = `enforcer/sight${choice === 1 ? 1 : choice === 2 ? 2 : choice === 0 ? 3 : 4}.wav`;
    }
    return sound === "" ? undefined : game.sound(entity, sound);
  }
  override found(target: ActorId): undefined {
    const { game, entity } = this;
    this.enemy = target;
    if (game.isPlayer(target)) { game.sightEntity = entity; game.sightTime = game.time; }
    if (entity.classname === "monster_hell_knight" && (entity.spawnflags & (65536 | 8388608)) !== 0 && this.state.painFinished > game.time) return undefined;
    entity.fields.set("show_hostile", String(Math.fround(game.time + 1)));
    this.sightSound();
    return this.huntTarget();
  }
  checkAttack(): boolean {
    const { game, entity, spec } = this, enemy = this.enemy;
    const start = this.eye(), end = enemy === null ? null : this.eye(enemy);
    if (enemy === null || start === null || end === null) return false;
    const trace = game.host.trace({ start, end, bounds: POINT, ignore: entity.actor.id, monsters: true });
    if (trace.actor === null || !sameActor(trace.actor, enemy) || trace.inOpen && trace.inWater) return false;
    const range = game.world?.number("enemy_range") ?? 0;
    if (range === 0 && spec.melee) { this.meleeAttack(); return true; }
    if (spec.missile === null || game.time < this.state.attackFinished || range === 3) return false;
    if (range === 0) this.state.attackFinished = 0;
    const chance = range === 0 ? 0.9 : range === 1 ? spec.melee ? 0.2 : 0.4 : range === 2 ? spec.melee ? 0.05 : 0.1 : 0;
    if (game.host.random() >= chance) return false;
    this.play(spec.missile); this.attackFinished(2 * game.host.random()); return true;
  }
  sourceWord(name: string, value: number): undefined {
    const world = this.game.world;
    if (world === null) throw new Error("MG3 AI requires the source world globals");
    world.fields.set(name, String(Math.fround(value))); return undefined;
  }
  rangeCategory(target = this.enemy): 0 | 1 | 2 | 3 {
    const distance = this.rangeDistance(target), nearSighted = (this.entity.spawnflags & 8192) !== 0;
    const ranges = nearSighted ? this.enemy === null ? [120, 300, 340] : [96, 400, 800] : [120, 500, 1000];
    const melee = ranges[0], near = ranges[1], mid = ranges[2];
    if (melee === undefined || near === undefined || mid === undefined) throw new Error("Missing source vision ranges");
    return distance < melee ? 0 : distance < near ? 1 : distance < mid ? 2 : 3;
  }
  inFront(target: ActorId): boolean {
    const body = this.game.host.bodies.read(target); if (body === null) return false;
    // MG3 infront passes self.angles directly, unlike the id1 rerelease pitch adjustment.
    const basis = this.game.makeVectors(this.game.body(this.entity).angles);
    const facing = dot(normalize(vsub(body.origin, this.origin)), basis.forward);
    const threshold = (this.entity.spawnflags & 8192) !== 0 ? Math.fround(0.866) : Math.fround(0.3);
    return facing > threshold || this.entity.classname === "monster_orb" && -facing > threshold;
  }
  override findTarget(): boolean {
    const { game, entity } = this;
    if ((entity.spawnflags & 32) !== 0) {
      const targets = game.find(entity.target).filter(target => target.damageable);
      if (targets.length > 0) {
        const target = targets[Math.floor(targets.length * game.host.random())];
        if (target === undefined) throw new Error("Source random target index exceeds candidates");
        this.enemy = target.actor.id; this.found(target.actor.id); return true;
      }
    }
    let candidate: ActorId | null;
    if (game.sightTime >= game.time - 0.1 && (entity.spawnflags & 3) === 0) {
      const sight = game.sightEntity;
      if (same(sight?.monster?.enemy ?? null, this.enemy)) return false;
      candidate = sight?.actor.id ?? null;
    } else candidate = game.host.checkClient(entity.actor);
    if (candidate === null || same(candidate, this.enemy)) return false;
    const actor = game.entity(candidate), player = game.player(candidate);
    if (((actor?.movementFlags ?? 0) & 128) !== 0 || (player?.powerups.get("invisibility") ?? 0) > game.time) return false;
    const range = this.rangeCategory(candidate);
    if (range === 3 || !this.visible(candidate)) return false;
    const hostile = player?.hostileUntil ?? actor?.number("show_hostile") ?? 0;
    if (range === 1 && hostile < game.time && !this.inFront(candidate) || range === 2 && !this.inFront(candidate)) return false;
    this.enemy = candidate;
    if (!game.isPlayer(candidate)) {
      this.enemy = actor?.monster?.enemy ?? null;
      if (this.enemy === null || !game.isPlayer(this.enemy)) { this.enemy = null; return false; }
    }
    this.found(this.enemy); return true;
  }
  checkContentsDamage(): boolean {
    const { game, entity } = this;
    if (entity.waterLevel === 0 || game.health(entity.actor.id) <= 0 || game.time < entity.number("dmgtime") || (entity.spawnflags & 16384) !== 0) return false;
    if (entity.waterType !== -4 && entity.waterType !== -5) return false;
    const world = game.world; if (world === null) throw new Error("MG3 contents damage requires the world actor");
    const lava = entity.waterType === -5;
    entity.fields.set("dmgtime", String(Math.fround(game.time + (lava ? 0.2 : 1))));
    game.damage(entity.actor.id, world.actor.id, world.actor.id, lava ? entity.classname === "monster_zombie" ? 120 : 30 * entity.waterLevel : 4 * entity.waterLevel);
    return lava && entity.classname === "monster_zombie" || game.health(entity.actor.id) <= 0;
  }
  override ai(mode: MonsterAi, distance: number): undefined {
    switch (mode) {
      case "stand":
        if (this.checkContentsDamage() || this.findTarget()) return undefined;
        return this.game.time > this.state.pauseUntil ? this.play(this.spec.walk) : undefined;
      case "walk": {
        if (this.checkContentsDamage()) return undefined;
        this.sourceWord("movedist", distance);
        if (this.findTarget()) return undefined;
        const goal = this.game.find(this.state.path)[0] ?? this.game.world;
        if (goal !== null) this.game.host.moveToGoal(this.entity.actor, goal.actor.id, distance);
        return undefined;
      }
      case "turn": return this.findTarget() ? undefined : this.changeYaw();
      case "painforward": this.game.host.walkMove(this.entity.actor, this.entity.idealYaw, distance); return undefined;
      default: return super.ai(mode, distance);
    }
  }
  huntTarget(): undefined {
    const target = this.target;
    if (target === null) return undefined;
    this.state.mode = "run"; this.entity.idealYaw = yawFor(vsub(target, this.origin));
    this.nextFrame = this.spec.run; this.delay(0.1); return this.attackFinished(1);
  }
  override updateRunKnowledge(): undefined {
    this.sourceWord("enemy_range", this.rangeCategory());
    const target = this.target;
    if (target !== null) this.sourceWord("enemy_yaw", yawFor(vsub(target, this.origin)));
    return undefined;
  }
  override run(distance: number): undefined {
    if (this.checkContentsDamage()) return undefined;
    const { game, entity } = this;
    this.sourceWord("movedist", distance);
    if (this.enemy === null || game.health(this.enemy) <= 0) {
      this.enemy = null;
      if (this.state.oldEnemy !== null && game.health(this.state.oldEnemy) > 0) { this.enemy = this.state.oldEnemy; this.huntTarget(); }
      else return this.play(this.state.path === "" ? this.spec.stand : this.spec.walk);
    }
    entity.fields.set("show_hostile", String(Math.fround(game.time + 1)));
    const seen = this.visible(); this.sourceWord("enemy_visible", Number(seen));
    if (seen) this.state.searchUntil = Math.fround(game.time + 5);
    if (this.searchForCoopTarget()) return undefined;
    this.updateRunKnowledge();
    if (entity.attackState === "missile" || entity.attackState === "melee") {
      entity.idealYaw = game.world?.number("enemy_yaw") ?? 0; this.changeYaw();
      const delta = ((game.body(entity).angles.y - entity.idealYaw) % 360 + 360) % 360;
      if (delta <= 45 || delta >= 315) {
        if (entity.attackState === "melee") this.meleeAttack(); else if (this.spec.missile !== null) this.play(this.spec.missile);
        entity.attackState = "straight";
      }
      return undefined;
    }
    if (seen && this.tryAttack()) return undefined;
    if (this.sliding) {
      entity.idealYaw = game.world?.number("enemy_yaw") ?? 0; this.changeYaw();
      const offset = this.lefty ? 90 : -90;
      if (game.host.walkMove(entity.actor, entity.idealYaw + offset, distance)) return undefined;
      this.lefty = !this.lefty;
      if (entity.classname === "monster_orb") { this.sliding = false; entity.attackState = "straight"; this.nextFrame = this.spec.run; return undefined; }
      game.host.walkMove(entity.actor, entity.idealYaw - offset, distance); return undefined;
    }
    return (game.world?.number("isHordeMode") ?? 0) !== 0 ? this.pathToGoal(distance) : this.moveToEnemy(distance);
  }
  pathToGoal(distance: number): undefined {
    const { entity, game } = this, target = this.target;
    if (entity.number("allowPathFind") === 0 || target === null) return this.moveToEnemy(distance);
    const seen = (game.world?.number("enemy_visible") ?? 0) !== 0, range = game.world?.number("enemy_range") ?? 0, style = entity.number("combat_style");
    if (!seen || style === 2 && range > 1 || style === 3 && range > 2) {
      if (walkMg3PathToGoal(this, distance, target) === Mg3PathResult.IN_PROGRESS) return undefined;
    }
    return this.moveToEnemy(distance);
  }
}
