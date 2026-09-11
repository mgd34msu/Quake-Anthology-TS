/* ai.qc/fight.qc and base monster QuakeC. Copyright (C) 1996-2022 id Software LLC. GPL-2.0-or-later. */
import type { ActorId } from "../../../contracts/identity.ts";
import { sameActor } from "../../../contracts/identity.ts";
import type { Vec3 } from "../../../contracts/math.ts";
import type { Q1Actor, Q1Monster } from "../foundation/entity.ts";
import type { Q1Foundation } from "../foundation/runtime.ts";
import { POINT, dot, length, normalize, vadd, vectors, vscale, vsub, yawFor } from "../foundation/types.ts";
import type { MonsterAi, MonsterFrame } from "./animation.ts";
import { monsterFrames } from "./frames.ts";
import type { MonsterSpecies } from "./species.ts";
import { monsterAction } from "./monster-actions.ts";
import { castLightning, throwGib, throwHead } from "./projectiles.ts";
import type { SaveReader } from "../../../persistence/value.ts";

export interface BaseMonsterSource {
  readonly callbackPrefix: string;
  readonly frames?: ReadonlyMap<string, MonsterFrame>;
  readonly actions?: ReadonlyMap<string, (monster: BaseMonster) => undefined>;
}
export interface MonsterServices {
  nextHellKnightMelee(): string;
  finale(monster: BaseMonster): undefined;
  finishFinale(monster: BaseMonster): undefined;
}

/** Source animation state only. Bodies, health, armor, damage and callback ordering stay in the shared host. */
export class BaseMonster {
  readonly state: Q1Monster;
  currentFrame: string;
  nextFrame: string;
  inPain = 0;
  counter = 0;
  idleUntil = 0;
  lefty = false;
  sliding = false;
  lightningCount = 0;
  countedDeath = false;
  constructor(readonly game: Q1Foundation, readonly entity: Q1Actor, readonly spec: MonsterSpecies, readonly services: MonsterServices, readonly source?: BaseMonsterSource) {
    this.currentFrame = spec.stand; this.nextFrame = spec.stand;
    this.state = entity.monster ?? { species: spec.species, mode: "stand", frameIndex: 0, sequence: [], firstFrame: 0, enemy: null, oldEnemy: null,
      path: entity.target, pauseUntil: 0, attackFinished: 0, painFinished: 0, searchUntil: 0, deathDrop: false, refired: false };
    entity.monster = this.state;
  }
  capture() { return { currentFrame: this.currentFrame, nextFrame: this.nextFrame, inPain: this.inPain, counter: this.counter, idleUntil: this.idleUntil, lefty: this.lefty, sliding: this.sliding, lightningCount: this.lightningCount, countedDeath: this.countedDeath }; }
  restore(reader: SaveReader): undefined {
    this.currentFrame = reader.field("currentFrame").string(); this.nextFrame = reader.field("nextFrame").string();
    if (!(this.source?.frames?.has(this.currentFrame) ?? false) && !monsterFrames.has(this.currentFrame) || !(this.source?.frames?.has(this.nextFrame) ?? false) && !monsterFrames.has(this.nextFrame)) return reader.fail("unknown source monster frame");
    this.inPain = reader.field("inPain").number(); this.counter = reader.field("counter").number(); this.idleUntil = reader.field("idleUntil").number();
    this.lefty = reader.field("lefty").boolean(); this.sliding = reader.field("sliding").boolean(); this.lightningCount = reader.field("lightningCount").number(); this.countedDeath = reader.field("countedDeath").boolean(); return undefined;
  }
  get enemy(): ActorId | null { return this.state.enemy; }
  set enemy(value: ActorId | null) { this.state.enemy = value; }
  get origin(): Vec3 { return this.game.body(this.entity).origin; }
  get target(): Vec3 | null { return this.enemy === null ? null : this.game.host.bodies.read(this.enemy)?.origin ?? null; }
  get distance(): number { const target = this.target; return target === null ? Infinity : length(vsub(target, this.origin)); }

  play(name: string): undefined {
    if (!this.game.live(this.entity)) return undefined;
    const frame = this.source?.frames?.get(name) ?? monsterFrames.get(name); if (frame === undefined) throw new Error(`Missing Q1 source animation ${name}`);
    this.currentFrame = name; this.nextFrame = frame.next; this.entity.frame = frame.frame;
    this.game.schedule(this.entity, 0.1, this.game.named.action(this.entity, `${this.source?.callbackPrefix ?? "base"}:monster_frame`));
    if (this.game.options.edition === "classic") {
      if (name === "boss_idle1" || name === "f_death2") return undefined;
      if (name === "f_death21") { this.entity.solid = "none"; return this.game.link(this.entity); }
      if (name === "sham_magic11" && this.game.options.skill === 3) return castLightning(this);
    }
    for (const op of frame.operations) {
      if (!this.game.live(this.entity)) return undefined;
      switch (op.kind) {
        case "ai": this.ai(op.mode, op.distance); break;
        case "solid": this.entity.solid = op.solid; this.game.link(this.entity); break;
        case "lightstyle": this.game.host.emit({ kind: "lightstyle", style: 0, pattern: op.pattern }); break;
        case "action": { const action = this.source?.actions?.get(op.name); if (action === undefined) monsterAction(this, op.name); else action(this); break; }
        case "sound": {
          const r = op.chance === null ? 0 : this.game.host.random();
          if (op.chance === null || (op.comparison === "greater" ? r > op.chance : r < op.chance)) this.game.sound(this.entity, op.path, op.channel, op.attenuation);
          break;
        }
      }
    }
    return undefined;
  }
  delay(seconds: number): undefined { return this.game.schedule(this.entity, seconds, this.game.named.action(this.entity, `${this.source?.callbackPrefix ?? "base"}:monster_frame`)); }
  face(): undefined {
    const target = this.target; if (target === null) return undefined;
    const body = this.game.body(this.entity); this.entity.idealYaw = yawFor(vsub(target, body.origin));
    let turn = this.entity.idealYaw - body.angles.y; if (turn > 180) turn -= 360; if (turn < -180) turn += 360;
    const speed = this.entity.yawSpeed;
    return this.game.setBody(this.entity, { angles: { ...body.angles, y: (body.angles.y + Math.max(-speed, Math.min(speed, turn)) + 360) % 360 } });
  }
  visible(target = this.enemy): boolean {
    if (target === null) return false;
    const body = this.game.host.bodies.read(target); if (body === null) return false;
    const trace = this.game.host.trace({ start: vadd(this.origin, { x: 0, y: 0, z: this.spec.movement === "swim" ? 10 : 25 }), end: vadd(body.origin, { x: 0, y: 0, z: this.game.isPlayer(target) ? 22 : this.game.entity(target)?.monster?.species === "fish" ? 10 : 25 }), bounds: POINT, ignore: this.entity.actor.id, monsters: false });
    return trace.fraction === 1 && !(trace.inOpen && trace.inWater);
  }
  found(target: ActorId): undefined {
    this.enemy = target; this.state.mode = "run"; this.state.searchUntil = this.game.time + 5;
    this.attackFinished(1);
    if (this.game.isPlayer(target)) { this.game.sightEntity = this.entity; this.game.sightTime = this.game.time; }
    const targetBody = this.game.host.bodies.read(target); if (targetBody !== null) this.entity.idealYaw = yawFor(vsub(targetBody.origin, this.origin));
    let sound = this.spec.sight;
    if (this.spec.species === "enforcer") {
      const r = this.game.host.random() * 4;
      sound = `enforcer/sight${r > 3 ? 4 : r > 2 ? 3 : r > 1 ? 2 : 1}.wav`;
    }
    this.game.sound(this.entity, sound);
    this.nextFrame = this.spec.run; return this.delay(0.1);
  }
  findTarget(): boolean {
    const { game, entity } = this;
    const candidate = game.sightEntity !== null && game.sightTime >= game.time - 0.1 && (entity.spawnflags & 3) === 0
      ? game.sightEntity.monster?.enemy ?? null : game.host.checkClient(entity.actor);
    if (candidate === null || game.health(candidate) <= 0 || (game.player(candidate)?.powerups.get("invisibility") ?? 0) > game.time) return false;
    const body = game.host.bodies.read(candidate); if (body === null) return false;
    const delta = vsub(body.origin, this.origin), distance = length(delta);
    if (distance >= 1000 || !this.visible(candidate)) return false;
    const front = dot(normalize(delta), vectors(game.body(entity).angles).forward) > 0.3;
    if (distance >= 500 && !front || distance >= 120 && distance < 500 && (game.player(candidate)?.hostileUntil ?? 0) < game.time && !front) return false;
    this.found(candidate); return true;
  }
  ai(mode: MonsterAi, distance: number): undefined {
    const { game, entity } = this;
    switch (mode) {
      case "stand": if (!this.findTarget() && game.time > this.state.pauseUntil && this.state.path !== "") this.play(this.spec.walk); return undefined;
      case "turn": if (!this.findTarget()) this.face(); return undefined;
      case "walk": {
        if (this.findTarget() || game.time < this.state.pauseUntil) return undefined;
        const path = game.find(this.state.path)[0]; if (path === undefined) { this.state.pauseUntil = game.time + 999999; return this.play(this.spec.stand); }
        game.host.moveToGoal(entity.actor, path.actor.id, distance);
        return undefined;
      }
      case "run": return this.run(distance);
      case "face": return this.face();
      case "charge": this.face(); if (this.enemy !== null) game.host.moveToGoal(entity.actor, this.enemy, distance); return undefined;
      case "charge_side": {
        this.face(); const target = this.target; if (target !== null) game.host.walkMove(entity.actor, yawFor(vsub(vsub(target, vscale(vectors(game.body(entity).angles).right, 30)), this.origin)), 20); return undefined;
      }
      case "melee_side": this.ai("charge_side", 0); this.melee(60, 3, 3, true); return undefined;
      case "melee": this.melee(60, 3, 3, false); return undefined;
      case "pain": game.host.walkMove(entity.actor, game.body(entity).angles.y + 180, distance); return undefined;
      case "painforward": case "forward": game.host.walkMove(entity.actor, game.body(entity).angles.y, distance); return undefined;
    }
  }
  run(distance: number): undefined {
    const { game, entity } = this;
    if (this.enemy === null || game.health(this.enemy) <= 0) {
      if (this.state.oldEnemy !== null && game.health(this.state.oldEnemy) > 0) { this.enemy = this.state.oldEnemy; this.state.oldEnemy = null; }
      else { this.enemy = null; return this.play(this.state.path === "" ? this.spec.stand : this.spec.walk); }
    }
    const enemy = this.enemy; if (enemy === null) return undefined;
    const seen = this.visible(); if (seen) this.state.searchUntil = game.time + 5;
    if (game.options.coop && this.state.searchUntil < game.time) { this.findTarget(); return undefined; }
    if (entity.attackState !== "straight") {
      this.face(); const delta = (game.body(entity).angles.y - entity.idealYaw + 360) % 360;
      if (delta <= 45 || delta >= 315) {
        const attack = entity.attackState; entity.attackState = "straight";
        if (attack === "melee") this.meleeAttack(); else if (this.spec.missile !== null) this.play(this.spec.missile);
      }
      return undefined;
    }
    if (seen && this.tryAttack()) return undefined;
    if (this.sliding) {
      this.face(); const direction = entity.idealYaw + (this.lefty ? 90 : -90);
      if (!game.host.walkMove(entity.actor, direction, distance)) { this.lefty = !this.lefty; game.host.walkMove(entity.actor, direction + 180, distance); }
    } else game.host.moveToGoal(entity.actor, enemy, distance);
    return undefined;
  }
  attackFinished(seconds: number): undefined {
    this.state.refired = false;
    if (this.game.options.edition === "rerelease" || this.game.options.skill !== 3) this.state.attackFinished = this.game.time + seconds;
    return undefined;
  }
  tryAttack(): boolean {
    const { game, entity, spec } = this, target = this.target, enemy = this.enemy;
    if (target === null || enemy === null) return false;
    const distance = this.distance;
    if (spec.species === "demon") {
      if (distance < 120) { entity.attackState = "melee"; return true; }
      const body = game.body(entity), other = game.host.bodies.read(enemy); if (other === null) return false;
      const delta = vsub(target, body.origin), horizontal = Math.hypot(delta.x, delta.y);
      if (body.origin.z + body.bounds.min.z > target.z + other.bounds.min.z + (other.bounds.max.z - other.bounds.min.z) * 0.75 || body.origin.z + body.bounds.max.z < target.z + other.bounds.min.z + (other.bounds.max.z - other.bounds.min.z) * 0.25 || horizontal < 100 || horizontal > 200 && game.host.random() < 0.9) return false;
      game.sound(entity, "demon/djump.wav"); entity.attackState = "missile"; return true;
    }
    const specialized = entity.classname === "monster_ogre" || spec.species === "shambler";
    if (distance < 120 && spec.melee && (!specialized || game.canDamage(enemy, entity.actor.id))) {
      if (specialized) entity.attackState = "melee"; else this.meleeAttack(); return true;
    }
    if (spec.missile === null || game.time < this.state.attackFinished || distance >= 1000 || spec.species === "shambler" && distance > 600) return false;
    const trace = game.host.trace({ start: vadd(this.origin, { x: 0, y: 0, z: 25 }), end: vadd(target, { x: 0, y: 0, z: game.isPlayer(enemy) ? 22 : 25 }), bounds: POINT, ignore: entity.actor.id, monsters: true });
    if (trace.actor === null || !sameActor(trace.actor, enemy) || trace.inOpen && trace.inWater) return false;
    if (specialized) {
      this.attackFinished((spec.species === "shambler" ? 2 : 1) + 2 * game.host.random()); entity.attackState = "missile"; return true;
    }
    const chance = distance < 120 ? 0.9 : distance < 500 ? spec.species === "wizard" ? 0.6 : spec.melee ? 0.2 : 0.4 : spec.species === "wizard" ? 0.2 : spec.melee ? 0.05 : 0.1;
    if (game.host.random() >= chance) {
      if (spec.species === "wizard") { this.sliding = distance < 500; this.nextFrame = this.sliding ? "wiz_side1" : "wiz_run1"; }
      return false;
    }
    if (spec.species === "wizard") { entity.attackState = "missile"; return true; }
    this.attackFinished(2 * game.host.random());
    if (spec.species === "zombie") { const r = game.host.random(); this.play(r < 0.3 ? "zombie_atta1" : r < 0.6 ? "zombie_attb1" : "zombie_attc1"); }
    else this.play(spec.missile);
    return true;
  }
  meleeAttack(): undefined {
    switch (this.spec.species) {
      case "knight": return this.play(this.distance < 80 ? "knight_atk1" : "knight_runatk1");
      case "demon": return this.play("demon1_atta1");
      case "ogre": return this.play(this.game.host.random() > 0.5 ? "ogre_smash1" : "ogre_swing1");
      case "hellknight": this.game.sound(this.entity, "hknight/slash1.wav", "weapon"); return this.play(this.services.nextHellKnightMelee());
      case "shambler": { const chance = this.game.host.random(); return this.play(chance > 0.6 || this.game.health(this.entity.actor.id) === 600 ? "sham_smash1" : chance > 0.3 ? "sham_swingr1" : "sham_swingl1"); }
      case "tarbaby": return this.play("tbaby_jump1");
      case "fish": return this.play("f_attack1");
      default: return undefined;
    }
  }
  melee(range: number, scale: number, rolls: number, sight: boolean): number {
    const enemy = this.enemy; if (enemy === null || this.distance > range || sight && !this.game.canDamage(enemy, this.entity.actor.id)) return 0;
    let damage = 0; for (let i = 0; i < rolls; i++) damage = Math.fround(damage + this.game.host.random());
    damage = Math.fround(damage * scale); this.game.damage(enemy, this.entity.actor.id, this.entity.actor.id, damage); return damage;
  }
  retaliate(attacker: ActorId | null): undefined {
    if (attacker === null || sameActor(attacker, this.entity.actor.id) || this.game.host.classname(attacker) === this.entity.classname) return undefined;
    if (this.enemy !== null && sameActor(attacker, this.enemy)) return undefined;
    if (this.enemy !== null && this.game.isPlayer(this.enemy)) this.state.oldEnemy = this.enemy;
    return this.found(attacker);
  }
  pain(attacker: ActorId | null, damage: number): undefined {
    const { game, entity, state, spec } = this; this.retaliate(attacker);
    switch (spec.species) {
      case "zombie": {
        game.host.combat.setHealth(entity.actor, 60); if (damage < 9 || this.inPain === 2) return undefined;
        if (damage >= 25) { this.inPain = 2; return this.play("zombie_paine1"); }
        if (this.inPain !== 0) { state.painFinished = game.time + 3; return undefined; }
        if (state.painFinished > game.time) { this.inPain = 2; return this.play("zombie_paine1"); }
        this.inPain = 1; const r = game.host.random(); return this.play(r < 0.25 ? "zombie_paina1" : r < 0.5 ? "zombie_painb1" : r < 0.75 ? "zombie_painc1" : "zombie_paind1");
      }
      case "fish": return this.play("f_pain1");
      case "wizard": game.sound(entity, "wizard/wpain.wav"); return game.host.random() * 70 > damage ? undefined : this.play("wiz_pain1");
      case "shambler":
        game.sound(entity, "shambler/shurt2.wav");
        if (game.health(entity.actor.id) <= 0 || game.host.random() * 400 > damage || state.painFinished > game.time) return undefined;
        state.painFinished = game.time + 2; return this.play("sham_pain1");
      case "demon":
        if (entity.touch !== null || state.painFinished > game.time) return undefined;
        state.painFinished = game.time + 1; game.sound(entity, "demon/dpain1.wav");
        return game.host.random() * 200 > damage ? undefined : this.play("demon1_pain1");
      case "knight": {
        if (state.painFinished > game.time) return undefined;
        const r = game.host.random(); game.sound(entity, "knight/khurt.wav"); state.painFinished = game.time + 1;
        return this.play(r < 0.85 ? "knight_pain1" : "knight_painb1");
      }
      case "enforcer": {
        const r = game.host.random(); if (state.painFinished > game.time) return undefined;
        game.sound(entity, r < 0.5 ? "enforcer/pain1.wav" : "enforcer/pain2.wav"); state.painFinished = game.time + (r < 0.7 ? 1 : 2);
        return this.play(r < 0.2 ? "enf_paina1" : r < 0.4 ? "enf_painb1" : r < 0.7 ? "enf_painc1" : "enf_paind1");
      }
      case "ogre": {
        if (state.painFinished > game.time) return undefined;
        game.sound(entity, "ogre/ogpain1.wav"); const r = game.host.random(); state.painFinished = game.time + (r < 0.75 ? 1 : 2);
        return this.play(r < 0.25 ? "ogre_pain1" : r < 0.5 ? "ogre_painb1" : r < 0.75 ? "ogre_painc1" : r < 0.88 ? "ogre_paind1" : "ogre_paine1");
      }
      case "hellknight":
        if (state.painFinished > game.time) return undefined;
        game.sound(entity, "hknight/pain1.wav");
        if (game.time - state.painFinished <= 5 && game.host.random() * 30 > damage) return undefined;
        state.painFinished = game.time + 1; return this.play("hknight_pain1");
      case "shalrath":
        if (state.painFinished > game.time) return undefined;
        game.sound(entity, "shalrath/pain.wav"); state.painFinished = game.time + 3; return this.play("shal_pain1");
      case "tarbaby": case "boss": case "oldone": return undefined;
    }
  }
  countKill(): undefined {
    if (this.countedDeath) return undefined; this.countedDeath = true;
    this.game.killedMonsters++; this.game.host.emit({ kind: "monster-killed", actor: this.entity.actor.id, total: this.game.totalMonsters, found: this.game.killedMonsters });
    return this.game.useTargets(this.entity, this.enemy);
  }
  die(_attacker: ActorId | null): undefined {
    const { game, entity, spec } = this;
    if (this.countedDeath) return undefined;
    entity.damageable = false; entity.touch = null;
    if (spec.species === "oldone") return this.services.finale(this);
    this.countKill();
    if (game.health(entity.actor.id) < spec.gibHealth && spec.head !== null) {
      game.sound(entity, spec.species === "zombie" ? "zombie/z_gib.wav" : "player/udeath.wav");
      for (const model of spec.gibs) throwGib(game, this.origin, model, game.health(entity.actor.id));
      return throwHead(game, entity, spec.head);
    }
    switch (spec.species) {
      case "knight": game.sound(entity, "knight/kdeath.wav"); return this.play(game.host.random() < 0.5 ? "knight_die1" : "knight_dieb1");
      case "enforcer": game.sound(entity, "enforcer/death1.wav"); return this.play(game.host.random() > 0.5 ? "enf_die1" : "enf_fdie1");
      case "demon": return this.play("demon1_die1");
      case "ogre": game.sound(entity, "ogre/ogdth.wav"); return this.play(game.host.random() < 0.5 ? "ogre_die1" : "ogre_bdie1");
      case "hellknight": game.sound(entity, "hknight/death1.wav"); return this.play(game.host.random() > 0.5 ? "hknight_die1" : "hknight_dieb1");
      case "shambler": game.sound(entity, "shambler/sdeath.wav"); return this.play("sham_death1");
      case "wizard": entity.movement = "toss"; entity.movementFlags &= ~1; return this.play("wiz_death1");
      case "shalrath": game.sound(entity, "shalrath/death.wav"); entity.solid = "none"; game.link(entity); return this.play("shal_death1");
      case "tarbaby": return this.play("tbaby_die1");
      case "fish": return this.play("f_death1");
      case "zombie": game.sound(entity, "zombie/z_gib.wav"); for (const model of spec.gibs) throwGib(game, this.origin, model, game.health(entity.actor.id)); return throwHead(game, entity, "h_zombie");
      case "boss": return this.play("boss_death1");
    }
  }
  spawn(): undefined {
    const { game, entity, spec } = this;
    const crucified = spec.species === "zombie" && (entity.spawnflags & 1) !== 0;
    if (!crucified) game.totalMonsters++;
    entity.maxHealth = spec.health; game.host.combat.setHealth(entity.actor, spec.health);
    entity.model = `progs/${spec.model}.mdl`; entity.solid = "slidebox"; entity.movement = "step"; entity.aimedDamage = true;
    entity.yawSpeed = entity.number("yaw_speed") || (spec.movement === "fly" || spec.movement === "swim" ? 10 : 20);
    entity.idealYaw = game.body(entity).angles.y;
    if (!crucified && spec.movement !== "boss") entity.movementFlags |= 32 | (spec.movement === "fly" ? 1 : spec.movement === "swim" ? 2 : 0);
    game.setBounds(entity, spec.bounds);
    entity.pain = game.named.pain(entity, `${this.source?.callbackPrefix ?? "base"}:monster_pain`); entity.die = game.named.die(entity, `${this.source?.callbackPrefix ?? "base"}:monster_die`);
    entity.pathEnd = game.named.action(entity, `${this.source?.callbackPrefix ?? "base"}:monster_stand`); entity.use = game.named.use(entity, `${this.source?.callbackPrefix ?? "base"}:monster_use`);
    if (spec.species === "boss") {
      entity.model = ""; entity.solid = "none";
      entity.use = game.named.use(entity, `${this.source?.callbackPrefix ?? "base"}:boss_awake`); return undefined;
    }
    if (spec.species === "oldone") { entity.damageable = true; this.nextFrame = "old_idle1"; return this.delay(0.1); }
    if (crucified) { entity.movement = "none"; return this.play("zombie_cruc1"); }
    return game.schedule(entity, 0.1 + game.host.random() * 0.5, game.named.action(entity, `${this.source?.callbackPrefix ?? "base"}:monster_start`));
  }
  start(): undefined {
      const { game, entity, spec } = this;
      if (spec.movement === "walk") {
        const start = vadd(this.origin, { x: 0, y: 0, z: 1 }); const trace = game.host.trace({ start, end: vadd(start, { x: 0, y: 0, z: -256 }), bounds: spec.bounds, ignore: entity.actor.id, monsters: true });
        game.setBody(entity, { origin: trace.end, ground: trace.actor });
        if (trace.fraction < 1 && !trace.allSolid) entity.movementFlags |= 512;
      }
      if (spec.species === "fish" && game.options.edition === "classic") game.totalMonsters++;
      entity.damageable = true; game.link(entity);
      const path = game.find(this.state.path)[0]; this.nextFrame = path?.classname === "path_corner" ? spec.walk : spec.stand;
      return this.delay(0.1 + game.host.random() * 0.5);
  }
  use(activator: ActorId | null): undefined {
    const { game, entity } = this;
    if (this.enemy !== null || game.health(entity.actor.id) <= 0 || activator === null || !game.isPlayer(activator) || (game.player(activator)?.powerups.get("invisibility") ?? 0) > game.time) return undefined;
    this.enemy = activator; return game.schedule(entity, 0.1, game.named.action(entity, `${this.source?.callbackPrefix ?? "base"}:monster_found`));
  }
  awake(activator: ActorId | null): undefined {
    const { game, entity } = this;
    entity.model = "progs/boss.mdl"; entity.solid = "slidebox"; entity.damageable = false;
    game.host.combat.setHealth(entity.actor, game.options.skill === 0 ? 1 : 3); this.enemy = activator;
    game.effect("lava-splash", this.origin); game.link(entity); return this.play("boss_rise1");
  }
}

export function registerMonsterCallbacks(game: Q1Foundation, prefix: string, monster: (entity: Q1Actor) => BaseMonster): undefined {
    game.named.register(`${prefix}:monster_frame`, { action: (_game, entity) => { const value = monster(entity); return value.play(value.nextFrame); } });
    game.named.register(`${prefix}:monster_start`, { action: (_game, entity) => monster(entity).start() });
    game.named.register(`${prefix}:monster_stand`, { action: (_game, entity) => { const value = monster(entity); return value.play(value.spec.stand); } });
    game.named.register(`${prefix}:monster_found`, { action: (_game, entity) => { const value = monster(entity); return value.enemy === null ? undefined : value.found(value.enemy); } });
    game.named.register(`${prefix}:monster_pain`, { pain: (_game, entity, attacker, damage) => monster(entity).pain(attacker, damage) });
    game.named.register(`${prefix}:monster_die`, { die: (_game, entity, attacker) => monster(entity).die(attacker) });
    game.named.register(`${prefix}:monster_use`, { use: (_game, entity, _other, activator) => monster(entity).use(activator) });
    game.named.register(`${prefix}:boss_awake`, { use: (_game, entity, _other, activator) => monster(entity).awake(activator) });
  return undefined;
}
