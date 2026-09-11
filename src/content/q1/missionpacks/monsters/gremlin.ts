/* hipgrem.qc source frame callbacks, feeding and reproduction. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { callbackName } from "../../foundation/callbacks.ts";
import { POINT, dot, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { spawnMeatSpray, throwGib, throwHead } from "../../base/projectiles.ts";
import type { MissionMonster, Q1MissionPackMonsters } from "./runtime.ts";
import type { MissionAction, PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/hipgrem.ts";
import { hullBounds, number, radiusActors } from "./helpers.ts";
import { gremlinRun, gremlinStand, gremlinWalk } from "./gremlin-ai.ts";
import { gremlinDropBackpack, gremlinFireLaser, gremlinFireLightning, gremlinFireNail, gremlinSteal, gremlinWeaponAttack } from "./gremlin-weapons.ts";

function gib(monster: MissionMonster, damage: number): undefined {
  const { game, entity } = monster; game.sound(entity, "player/udeath.wav"); throwHead(game, entity, "h_grem", damage);
  for (let i = 0; i < 3; i++) throwGib(game, monster.origin, "gib1", damage); return undefined;
}
function resume(monster: MissionMonster): undefined {
  if (monster.state.oldEnemy !== null && monster.game.health(monster.state.oldEnemy) > 0) {
    monster.enemy = monster.state.oldEnemy; monster.entity.references.set("goalentity", monster.enemy); monster.nextFrame = monster.spec.run;
    monster.state.attackFinished = monster.game.time + 1; return monster.delay(0.1);
  }
  return monster.play(monster.state.path === "" ? "gremlin_stand1" : "gremlin_walk1");
}
function melee(monster: MissionMonster, side: number): undefined {
  const { game, entity } = monster; monster.face();
  if (monster.enemy === null || monster.distance > 100 || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
  game.sound(entity, "grem/attack.wav", "weapon"); game.damage(monster.enemy, entity.actor.id, entity.actor.id, 10 + 5 * game.host.random());
  const basis = game.makeVectors(game.body(entity).angles); spawnMeatSpray(game, entity, vadd(monster.origin, vscale(basis.forward, 16)), vscale(basis.right, side)); return undefined;
}
function split(monster: MissionMonster): undefined {
  const { game, entity, runtime } = monster;
  if (runtime.spawnedGremlins >= runtime.authoredGremlins * 2) return undefined;
  let angles = game.body(entity).angles, position = monster.origin, found = false;
  for (let count = 0; count < 10; count++) {
    position = vadd(monster.origin, vscale(game.makeVectors(angles).forward, 80)); let proceed = true;
    for (const actor of radiusActors(game, position, 35)) if (game.health(actor) > 0 && (((game.entity(actor)?.movementFlags ?? 0) & 32) !== 0 || game.isPlayer(actor))) proceed = false;
    const clear = (end: typeof position): boolean => game.host.trace({ start: monster.origin, end, bounds: POINT, ignore: entity.actor.id, monsters: true }).fraction === 1;
    if (clear(position) && proceed && clear(vsub(position, { x: 40, y: 40, z: 0 })) && clear(vadd(position, { x: 40, y: 40, z: 0 })) && clear(vadd(position, { x: 0, y: 0, z: 64 })) && !clear(vsub(position, { x: 0, y: 0, z: 64 }))) { found = true; break; }
    angles = { ...angles, y: angles.y + 36 };
  }
  if (!found) return undefined;
  runtime.spawnedGremlins++; const child = game.cloneEntity(entity), controller = runtime.require(child);
  child.solid = "slidebox"; child.movement = "step"; child.model = "progs/grem.mdl"; game.setBounds(child, hullBounds);
  const health = Math.max(100, game.health(entity.actor.id)); game.host.combat.setHealth(entity.actor, health / 2); game.host.combat.setHealth(child.actor, health / 2);
  number(controller, "stoleweapon", 0);
  for (const entry of game.host.inventory.entries(child.actor.id)) if (entry.item.startsWith("q1:weapon/")) game.host.inventory.configure(child.actor, { ...entry, count: 0 });
  game.totalMonsters++; game.host.emit({ kind: "monster-total", total: game.totalMonsters }); game.setOrigin(child, position);
  controller.play("gremlin_spawn1"); controller.enemy = null; return number(controller, "gorging", 0);
}
function gorgeDamage(monster: MissionMonster, target: ActorId, damage: number): undefined {
  const { game, entity } = monster, victim = game.entity(target), owned = game.host.actors.resolveOwned(target), combat = game.host.combat.read(target);
  if (owned === null || combat === null || ((victim?.movementFlags ?? 0) & 64) !== 0) return undefined;
  const invulnerableUntil = game.player(target)?.powerups.get("invulnerability") ?? victim?.number("invincible_finished") ?? 0;
  if (invulnerableUntil >= game.time) {
    if (entity.number("invincible_sound") < game.time) { game.sound(owned, "items/protect3.wav", "item"); number(monster, "invincible_sound", game.time + 2); }
    return undefined;
  }
  if ((game.options.teamplay ?? 0) === 1 && combat.team !== null && combat.team === game.host.combat.read(entity.actor.id)?.team) return undefined;
  game.host.combat.setHealth(owned, Math.fround(combat.health - damage)); return undefined;
}
function gorge(monster: MissionMonster, side: number): undefined {
  const { game, entity } = monster, target = monster.enemy; if (target === null) return undefined;
  game.sound(entity, "demon/dhit2.wav", "weapon"); gorgeDamage(monster, target, 7 + 5 * game.host.random());
  const basis = game.makeVectors(game.body(entity).angles); spawnMeatSpray(game, entity, vadd(monster.origin, vscale(basis.forward, 16)), vscale(basis.right, side));
  if (game.health(target) >= -200) return undefined;
  const victim = game.entity(target);
  if (victim !== null && victim.number("gorging") === 0) {
    victim.fields.set("gorging", "1"); game.sound(entity, "player/udeath.wav");
    const heads: Readonly<Record<string, string>> = { monster_ogre: "h_ogre", monster_knight: "h_knight", monster_shambler: "h_shams", monster_demon1: "h_demon", monster_wizard: "h_wizard", monster_zombie: "h_zombie", monster_dog: "h_dog", monster_hell_knight: "h_hellkn", monster_enforcer: "h_mega", monster_army: "h_guard", monster_shalrath: "h_shal", monster_gremlin: "h_grem", monster_scourge: "h_scourg", monster_fish: "gib1" };
    throwHead(game, victim, heads[victim.classname] ?? "h_player", -15);
    const amount = 150 + 100 * game.host.random(), health = game.health(entity.actor.id);
    if (health > 0 && health < entity.maxHealth) game.host.combat.setHealth(entity.actor, Math.min(entity.maxHealth, health + Math.ceil(amount)));
    split(monster);
  }
  monster.enemy = null; number(monster, "gorging", 0); return monster.play("gremlin_look1");
}
function meleeAttack(monster: MissionMonster): undefined {
  if (monster.entity.number("gorging") !== 0) return monster.play("gremlin_gorge1");
  if (monster.entity.number("stoleweapon") === 1) throw new Error("gremlin meleeing with stolen weapon");
  if (monster.enemy !== null && monster.game.isPlayer(monster.enemy) && monster.game.host.random() < 0.4 && gremlinSteal(monster)) return undefined;
  const r = monster.game.host.random(); return monster.play(r < 0.3 ? "gremlin_claw1" : r < 0.6 ? "gremlin_lunge1" : "gremlin_claw1");
}
function missileAttack(monster: MissionMonster): undefined {
  if (monster.entity.number("stoleweapon") !== 0) {
    if (gremlinWeaponAttack(monster)) return undefined;
    if (monster.game.host.random() < 0.1 && (monster.entity.movementFlags & 512) !== 0) return monster.play("gremlin_jump1");
  }
  if ((monster.entity.movementFlags & 512) !== 0) return monster.play("gremlin_jump1");
  return undefined;
}
export function gremlinDefinition(runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  const actions: Record<string, MissionAction> = {
    Gremlin_MeleeAttack: meleeAttack, Gremlin_MissileAttack: missileAttack, Gremlin_FireLightningGun: gremlinFireLightning,
    GremlinDropBackpack: gremlinDropBackpack, gremlin_gib: monster => gib(monster, -35),
    "hipgrem:gremlin_stand1": monster => { gremlinStand(monster); return monster.delay(0.2); },
    "hipgrem:gremlin_jump5": monster => {
      monster.face(); const { game, entity } = monster; if ((entity.movementFlags & 512) === 0) return monster.play("gremlin_run1");
      entity.touch = game.named.touch(entity, "hipnotic:Gremlin_JumpTouch"); const basis = game.makeVectors(game.body(entity).angles);
      game.setBody(entity, { origin: vadd(monster.origin, { x: 0, y: 0, z: 1 }), velocity: vadd(vscale(basis.forward, 300), { x: 0, y: 0, z: 300 }) }); entity.movementFlags -= 512; return undefined;
    },
    "hipgrem:gremlin_jump11": monster => monster.delay(3),
    "hipgrem:gremlin_shot1": monster => { monster.entity.effects |= 2; return undefined; },
    "hipgrem:gremlin_nail1": monster => { monster.entity.effects |= 2; return gremlinFireNail(monster); },
    "hipgrem:gremlin_laser1": monster => { monster.entity.effects |= 2; return gremlinFireLaser(monster); },
    "hipgrem:gremlin_look1": monster => monster.delay(0.2), "hipgrem:gremlin_look9": resume,
    "hipgrem:gremlin_glook20": monster => { gremlinDropBackpack(monster); number(monster, "stoleweapon", 0); return resume(monster); },
    "hipgrem:gremlin_spawn1": monster => { monster.delay(0.3); return number(monster, "gremlin:pain-disabled", 1); },
    "hipgrem:gremlin_spawn2": monster => monster.delay(0.3), "hipgrem:gremlin_spawn6": monster => number(monster, "gremlin:pain-disabled", 0),
    "hipgrem:gremlin_flip1": monster => {
      monster.face(); const { game, entity } = monster, basis = game.makeVectors(game.body(entity).angles);
      game.setBody(entity, { origin: vadd(monster.origin, { x: 0, y: 0, z: 1 }), velocity: vsub({ x: 0, y: 0, z: 350 }, vscale(basis.forward, 200)) }); entity.movementFlags &= ~512; return game.sound(entity, "grem/death.wav");
    },
    "hipgrem:gremlin_flip6": monster => { monster.entity.touch = monster.game.named.touch(monster.entity, "hipnotic:Gremlin_FlipTouch"); return undefined; },
  };
  for (const distance of [2, 4]) actions[`ai_back(${distance})`] = monster => { monster.game.host.walkMove(monster.entity.actor, monster.game.body(monster.entity).angles.y + 180, distance); return undefined; };
  for (const distance of [0, 8, 12, 16]) actions[`gremlin_run(${distance})`] = monster => gremlinRun(monster, distance);
  actions["gremlin_walk(8)"] = monster => gremlinWalk(monster, 8);
  for (const side of [0, 200]) actions[`Gremlin_Melee(${side})`] = monster => melee(monster, side);
  for (const side of [-200, 200]) actions[`Gremlin_Gorge(${side})`] = monster => gorge(monster, side);
  for (const offset of [-4, 4]) { actions[`Gremlin_FireNailGun(${offset})`] = gremlinFireNail; actions[`Gremlin_FireLaserGun(${offset})`] = gremlinFireLaser; }
  return {
    spec: { species: "gremlin", classnames: ["monster_gremlin"], model: "grem", head: "h_grem", health: 100, gibHealth: -35, gibs: ["gib1", "gib1", "gib1"], bounds: hullBounds,
      stand: "gremlin_stand1", walk: "gremlin_walk1", run: "gremlin_run1", sight: "grem/sight1.wav", missile: "Gremlin_MissileAttack", melee: true, movement: "walk" }, frames, actions,
    callbacks: {
      Gremlin_JumpTouch: { touch(game, entity) {
        const monster = runtime.require(entity); if (game.health(entity.actor.id) <= 0) return undefined;
        if (!game.host.checkBottom(entity.actor.id)) { if ((entity.movementFlags & 512) !== 0) { entity.touch = null; monster.nextFrame = "gremlin_jump1"; monster.delay(0.1); } return undefined; }
        entity.touch = null; monster.nextFrame = "gremlin_jump12"; return monster.delay(0.1);
      } },
      Gremlin_FlipTouch: { touch(game, entity) {
        const monster = runtime.require(entity);
        if (!game.host.checkBottom(entity.actor.id)) { if ((entity.movementFlags & 512) !== 0) { entity.touch = null; monster.nextFrame = "gremlin_flip1"; monster.delay(0.1); } return undefined; }
        entity.touch = null; monster.nextFrame = "gremlin_flip8"; return monster.delay(0.1);
      } },
    },
    spawn: monster => {
      runtime.authoredGremlins++; monster.entity.fields.set("yaw_speed", "40"); monster.spawnDefault(); monster.entity.maxHealth = 101;
      if (!monster.game.host.inventory.has(monster.entity.actor.id)) monster.game.host.inventory.create(monster.entity.actor, ["shells", "nails", "rockets", "cells"].map(ammo => ({ item: `q1:ammo/${ammo}`, count: 0, capacity: 1000000, countPolicy: { kind: "source-counter", arithmetic: "binary32" } })));
      return undefined;
    },
    melee: meleeAttack,
    checkAttack: monster => {
      if (monster.game.time < monster.state.attackFinished) return false;
      if (monster.distance <= 90 && monster.entity.number("stoleweapon") === 0) { monster.entity.attackState = "melee"; return true; }
      if (monster.game.host.random() < 0.03 + monster.entity.number("stoleweapon")) { monster.entity.attackState = "missile"; return true; }
      return false;
    },
    pain: (monster, attacker) => {
      if (monster.entity.number("gremlin:pain-disabled") !== 0) return undefined;
      const { game, entity } = monster;
      if (game.host.random() < 0.8) { number(monster, "gorging", 0); monster.enemy = attacker; if (attacker !== null) monster.found(attacker); }
      if (callbackName(entity.touch) === "hipnotic:Gremlin_JumpTouch" || monster.state.painFinished > game.time) return undefined;
      monster.state.painFinished = game.time + 1; const r = game.host.random(); game.sound(entity, `grem/pain${r < 0.33 ? 1 : r < 0.66 ? 2 : 3}.wav`);
      return monster.play(entity.number("stoleweapon") !== 0 ? "gremlin_gunpain1" : "gremlin_pain1");
    },
    die: (monster, attacker) => {
      const { game, entity } = monster;
      if (game.host.inventory.entries(entity.actor.id).some(entry => entry.item.startsWith("q1:weapon/") && entry.item !== "q1:weapon/axe" && entry.item !== "q1:weapon/shotgun" && entry.item !== "q1:weapon/hipnotic:mjolnir" && entry.count > 0)) { gremlinDropBackpack(monster); number(monster, "stoleweapon", 0); }
      const basis = game.makeVectors(game.body(entity).angles), attackerBody = attacker === null ? null : game.host.bodies.read(attacker), facing = dot(normalize(vsub(attackerBody?.origin ?? { x: 0, y: 0, z: 0 }, monster.origin)), basis.forward);
      const health = game.health(entity.actor.id); if (health < -35) return gib(monster, health);
      if (facing > 0.7 && game.host.random() < 0.5 && (entity.movementFlags & 512) !== 0) return monster.play("gremlin_flip1");
      return monster.play("gremlin_die1");
    },
  };
}
