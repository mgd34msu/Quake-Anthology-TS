/* quakec_mg3/monsters/mg3_*_infected.qc and monsters.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import { SaveReader } from "../../../../../persistence/value.ts";
import type { Q1Actor } from "../../../foundation/entity.ts";
import { BaseMonster } from "../../../base/monsters.ts";
import { throwGib, throwHead } from "../../../base/projectiles.ts";
import { fireBullets } from "../../../foundation/weapons.ts";
import { POINT, normalize, vscale, vsub } from "../../../foundation/types.ts";
import type { Q1AddonContext } from "../../context.ts";
import { infectedFrames } from "./frames.ts";
import { infectedKind, infectedSpecies } from "./species.ts";
import { initMg3Monster, startMg3Monster, mg3MonsterActivator } from "../startup.ts";

export const infectedPrefix = "mg3:infected";
const actions: ReadonlyMap<string, (monster: BaseMonster) => undefined> = new Map([
  ["army_fire", monster => {
    const { game, entity } = monster, target = monster.enemy === null ? null : game.host.bodies.read(monster.enemy);
    if (target === null) return undefined;
    monster.face(); game.sound(entity, "soldier/sattck1.wav", "weapon");
    fireBullets(game, entity.actor, normalize(vsub(vsub(target.origin, vscale(target.velocity, 0.2)), monster.origin)), game.body(entity).angles, 4, 0.1, 0.1, null);
    entity.effects |= 2; return undefined;
  }],
  ["army_refire", monster => { if (monster.game.options.skill === 3 && !monster.state.refired && monster.visible()) { monster.state.refired = true; monster.nextFrame = "army_atk1"; } return undefined; }],
  ["infected_corpse_hold", monster => monster.delay(9999)],
  ["infected_test_rise", monster => {
    const { game, entity } = monster; entity.solid = "slidebox";
    if (!game.host.walkMove(entity.actor, 0, 0)) { entity.solid = "none"; game.link(entity); monster.nextFrame = monster.currentFrame; return monster.delay(5); }
    game.link(entity); return game.sound(entity, "infected/death1_rev.wav", "voice");
  }],
  ["infected_rise_pain", monster => { monster.state.painFinished = monster.game.time + 1.5; return undefined; }],
  ["infected_resurrect", monster => monster.game.named.action(monster.entity, `${infectedPrefix}:resurrect`)()],
]);

export class Q1Infected extends BaseMonster {
  constructor(readonly context: Q1AddonContext, entity: Q1Actor, readonly replace: (entity: Q1Actor) => Q1Infected) {
    super(context.game, entity, infectedSpecies(entity), context.base, { callbackPrefix: infectedPrefix, frames: infectedFrames, actions });
  }
  override spawn(): undefined {
    const { game, entity, context, spec } = this;
    const classname = spec.classnames[0]; if (classname === undefined) throw new Error("Infected source class has no native name");
    entity.classname = classname; context.setNumber(entity, "infected", 1); game.host.combat.setHealth(entity.actor, spec.health);
    entity.pain = spec.stand.startsWith("hknight_corpse") ? null : game.named.pain(entity, `${infectedPrefix}:monster_pain`);
    entity.die = game.named.die(entity, `${infectedPrefix}:monster_die`); entity.pathEnd = game.named.action(entity, `${infectedPrefix}:monster_stand`);
    if (spec.species === "knight" || spec.species === "hellknight") { context.setNumber(entity, "allowPathFind", 1); context.setNumber(entity, "combat_style", spec.species === "knight" ? 1 : 3); }
    return initMg3Monster(this, context, `progs/${spec.model}.mdl`, 1, spec.species === "army" || spec.species === "knight" ? 1 : 2);
  }
  override start(): undefined { return startMg3Monster(this, this.context); }
  override use(activator: ActorId | null): undefined {
    return super.use(mg3MonsterActivator(this.game, activator));
  }
  override tryAttack(): boolean {
    if (this.spec.species !== "army") return super.tryAttack();
    const { game, entity } = this, enemy = this.enemy, distance = this.rangeDistance();
    if (enemy === null) return false;
    const start = this.eye(), end = this.eye(enemy); if (start === null || end === null) return false;
    const trace = game.host.trace({ start, end, bounds: POINT, ignore: entity.actor.id, monsters: true });
    if (trace.actor === null || !sameActor(trace.actor, enemy) || trace.inOpen && trace.inWater || distance >= 1000 || game.time < this.state.attackFinished || game.host.random() >= (distance < 120 ? 0.9 : distance < 500 ? 0.4 : 0.05)) return false;
    this.play("army_atk1"); this.attackFinished(1 + game.host.random()); if (game.host.random() < 0.3) { this.lefty = !this.lefty; this.context.setNumber(entity, "lefty", this.lefty ? 1 : 0); } return true;
  }
  override meleeAttack(): undefined {
    if (this.spec.species !== "zombie") return super.meleeAttack();
    const r = this.game.host.random(); return this.play(r < 0.3 ? "zombie_atta1" : r < 0.6 ? "zombie_attb1" : "zombie_attc1");
  }
  override pain(attacker: ActorId | null, damage: number): undefined {
    if (this.spec.species === "enforcer") {
      this.retaliate(attacker); const { game, entity, state } = this, r = game.host.random();
      if (state.painFinished > game.time || game.options.skill > 2 && game.host.random() * 200 > damage) return undefined;
      game.sound(entity, r < 0.5 ? "enforcer/pain1.wav" : "enforcer/pain2.wav", "voice"); state.painFinished = game.time + (r < 0.7 ? 1 : 2);
      return this.play(r < 0.2 ? "enf_paina1" : r < 0.4 ? "enf_painb1" : r < 0.7 ? "enf_painc1" : "enf_paind1");
    }
    if (this.spec.species !== "army") return super.pain(attacker, damage);
    this.retaliate(attacker); const { game, entity, state } = this;
    if (state.painFinished > game.time || game.options.skill > 2 && game.host.random() * 100 > damage) return undefined;
    const r = game.host.random(); state.painFinished = game.time + (r < 0.2 ? 0.6 : 1.1);
    this.play(r < 0.2 ? "army_pain1" : r < 0.6 ? "army_painb1" : "army_painc1"); return game.sound(entity, r < 0.2 ? "soldier/pain1.wav" : "soldier/pain2.wav", "voice");
  }
  override die(attacker: ActorId | null): undefined {
    const { game, entity, context } = this;
    if (this.countedDeath) return undefined;
    if (entity.number("infected.transformed") !== 0 && this.spec.species !== "zombie") return super.die(attacker);
    if (game.health(entity.actor.id) < -99) game.host.combat.setHealth(entity.actor, -99);
    this.enemy = attacker; entity.damageable = false; entity.touch = null; this.countKill();
    if (entity.number("infected.transformed") !== 0) {
      game.sound(entity, "zombie/z_gib.wav", "voice"); throwHead(game, entity, "h_zombie");
      for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, this.origin, model, game.health(entity.actor.id)); return undefined;
    }
    game.sound(entity, "player/udeath.wav", "voice");
    if (infectedKind(entity) === "army") throwGib(game, this.origin, "h_guard", game.health(entity.actor.id));
    for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, this.origin, model, game.health(entity.actor.id));
    context.setNumber(entity, "infected.transformed", 1); const spec = infectedSpecies(entity);
    entity.monster = { ...this.state, species: spec.species }; const transformed = this.replace(entity);
    transformed.restore(new SaveReader(this.capture(), infectedPrefix)); transformed.countedDeath = false;
    entity.model = `progs/${spec.model}.mdl`; entity.fields.set("noise", spec.species === "zombie" ? "zombie/z_idle.wav" : "demon/sight2.wav");
    game.host.combat.setHealth(entity.actor, spec.health); entity.maxHealth = spec.health;
    entity.pain = game.named.pain(entity, `${infectedPrefix}:monster_pain`); entity.aimedDamage = true; entity.damageable = true;
    if (spec.species === "zombie") entity.spawnflags = 128;
    else { context.setNumber(entity, "combat_style", 1); transformed.state.painFinished = game.time + 1; transformed.state.attackFinished = 0; }
    entity.classname = spec.species === "zombie" ? "monster_zombie" : "monster_demon1"; transformed.retarget();
    if (game.host.walkMove(entity.actor, 0, 0)) return transformed.play(spec.species === "zombie" ? "zombie_paina1" : "demon1_pain1");
    game.killedMonsters++; game.host.emit({ kind: "monster-killed", actor: entity.actor.id, total: game.totalMonsters, found: game.killedMonsters });
    transformed.countedDeath = true; game.host.combat.setHealth(entity.actor, -100);
    game.sound(entity, spec.species === "zombie" ? "zombie/z_gib.wav" : "player/udeath.wav", "voice");
    if (spec.species === "zombie") { throwHead(game, entity, "h_zombie", -100); for (const model of spec.gibs) throwGib(game, this.origin, model, -100); return undefined; }
    for (const model of spec.gibs) throwGib(game, this.origin, model, -100); return throwHead(game, entity, "h_demon", -100);
  }
  retarget(): undefined {
    const { game, entity } = this, enemy = this.enemy;
    if (enemy === null || game.host.classname(enemy) !== entity.classname) return undefined;
    const player = game.host.players().find(actor => game.health(actor) > 0); if (player === undefined) return undefined;
    const rival = game.entity(enemy)?.monster;
    if (rival !== undefined && rival !== null && rival.enemy !== null && sameActor(rival.enemy, entity.actor.id)) rival.enemy = player;
    this.enemy = player; return undefined;
  }
  resurrect(): undefined {
    this.context.setNumber(this.entity, "aflag", 0); this.context.setNumber(this.entity, "infected.risen", 1);
    const risen = this.replace(this.entity); risen.restore(new SaveReader(this.capture(), infectedPrefix));
    this.entity.pain = this.game.named.pain(this.entity, `${infectedPrefix}:monster_pain`); return risen.ai("stand", 0);
  }
}
