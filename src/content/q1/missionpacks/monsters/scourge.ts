/* hipscrge.qc. Repeated classic frame macros resolve to the first declaration, as qcc does. GPL-2.0-or-later. */
import { POINT, dot, length, normalize, vadd, vscale, vsub, yawFor } from "../../foundation/types.ts";
import { spawnMeatSpray, launchSpike, throwGib, throwHead } from "../../base/projectiles.ts";
import type { Q1MissionPackMonsters, MissionMonster } from "./runtime.ts";
import type { PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/hipscrge.ts";
import { eye, number } from "./helpers.ts";

function think(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  if (entity.number("scourge:state") === 0) {
    const trigger = game.create("scourge_trigger"); trigger.solid = "trigger"; trigger.damageable = false;
    game.setBounds(trigger, { min: { x: -64, y: -64, z: -24 }, max: { x: 64, y: 64, z: 64 } });
    trigger.references.set("lastvictim", entity.actor.id); entity.references.set("lastvictim", trigger.actor.id);
    trigger.touch = game.named.touch(trigger, "hipnotic:ScourgeTriggerTouch");
    game.schedule(trigger, 0.1 + game.host.random(), game.named.action(trigger, "hipnotic:ScourgeTriggerThink")); game.setOrigin(trigger, monster.origin);
    number(monster, "scourge:state", 1);
  }
  const silent = entity.number("spawnsilent"), multi = entity.number("spawnmulti");
  if (silent === 0 && multi === 1) game.sound(entity, "misc/null.wav", "body", 2);
  else if (silent === 1 && multi === 0) game.sound(entity, "scourge/walk.wav", "body", 2);
  return number(monster, "spawnmulti", silent);
}
function side(monster: MissionMonster, right: boolean, distance: number): undefined {
  monster.game.host.walkMove(monster.entity.actor, monster.game.body(monster.entity).angles.y + (right ? 90 : 270), distance); return undefined;
}
function fire(monster: MissionMonster, offset: number): undefined {
  const { game, entity } = monster;
  monster.face(); const target = monster.target;
  if (target === null) return undefined;
  const basis = game.makeVectors(game.body(entity).angles), origin = vadd(vadd(vadd(monster.origin, { x: 0, y: 0, z: -19 }), vscale(basis.right, offset)), vscale(basis.forward, 14));
  game.sound(entity, "weapons/rocket1i.wav", "weapon");
  launchSpike(game, entity.actor.id, origin, vscale(normalize(vsub(vadd(target, vscale(basis.forward, 200)), origin)), 1000));
  monster.state.attackFinished = game.time + 0.2;
  return undefined;
}
function flash(monster: MissionMonster, offset: number): undefined { monster.entity.effects |= 2; return fire(monster, offset); }
function tail(monster: MissionMonster): undefined {
  monster.face(); if (monster.enemy === null || monster.distance > 100 || !monster.game.canDamage(monster.enemy, monster.entity.actor.id)) return undefined;
  const { game, entity } = monster; game.damage(monster.enemy, entity.actor.id, entity.actor.id, (game.host.random() + game.host.random() + game.host.random()) * 40); game.sound(entity, "shambler/smack.wav", "weapon");
  const basis = game.basis, spray = vscale(basis.right, (game.host.random() * 2 - 1) * 50);
  spawnMeatSpray(game, entity, vadd(monster.origin, vscale(basis.forward, 16)), spray);
  return undefined;
}
function turn(monster: MissionMonster): undefined {
  monster.delay(0.1); const target = monster.target;
  if (target === null) return undefined;
  if (Math.abs(monster.game.body(monster.entity).angles.y - yawFor(vsub(target, monster.origin))) > 10) return monster.face();
  monster.nextFrame = monster.spec.run; return undefined;
}
function checkAttack(monster: MissionMonster): boolean {
  const { game, entity } = monster, target = monster.enemy === null ? null : eye(game, monster.enemy);
  if (target === null) return false;
  const start = vadd(monster.origin, { x: 0, y: 0, z: 25 }), delta = vsub(target, start), distance = length(delta);
  if (distance <= 100 && monster.enemy !== null && game.canDamage(monster.enemy, entity.actor.id)) { entity.attackState = "melee"; return true; }
  if (game.time < monster.state.attackFinished || !monster.visible() || delta.z > 64 || delta.z < -200 || distance > 1000 || distance < 150) return false;
  const trace = game.host.trace({ start, end: target, bounds: POINT, ignore: entity.actor.id, monsters: true });
  if (trace.actor !== monster.enemy || trace.inOpen && trace.inWater) return false;
  entity.attackState = "missile"; monster.attackFinished(2 + 2 * game.host.random()); return true;
}
export function scourgeDefinition(runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  return {
    spec: { species: "scourge", classnames: ["monster_scourge"], model: "scor", head: "h_scourg", health: 300, gibHealth: -35, gibs: ["gib1", "gib2", "gib3"],
      bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "scourge_stand1", walk: "scourge_walk1", run: "scourge_run1", sight: "scourge/sight.wav", missile: "scourge_atk1", melee: true, movement: "walk" },
    frames,
    callbacks: {
      ScourgeTriggerThink: { action(game, entity) {
        const owner = entity.references.get("lastvictim") ?? null, target = owner === null ? null : game.entity(owner);
        if (target === null || game.health(target.actor.id) <= 0) return game.remove(entity);
        const body = game.body(target); game.setOrigin(entity, vadd(body.origin, vscale(game.makeVectors(body.angles).forward, 300)));
        return game.schedule(entity, 0.1, game.named.action(entity, "hipnotic:ScourgeTriggerThink"));
      } },
      ScourgeTriggerTouch: { touch(game, entity, other) {
        const shot = game.entity(other), owner = entity.references.get("lastvictim") ?? null, monster = owner === null ? null : runtime.context(owner);
        if (shot === null || (shot.movementFlags & (32 | 8)) !== 0 || game.isPlayer(other) || shot.movement !== "flymissile") return undefined;
        if (monster === null || game.health(monster.entity.actor.id) <= 0) return game.remove(entity);
        const body = game.body(shot);
        if (dot(normalize(vsub(monster.origin, body.origin)), normalize(body.velocity)) < 0.8) return undefined;
        if (game.time > entity.number("duration")) { monster.play(game.host.random() < 0.5 ? "scourge_strafeleft1" : "scourge_straferight1"); number(monster, "duration", game.time + 1.5); }
        return undefined;
      } },
    },
    actions: {
      scourge_think: think,
      "hipscrge:scourge_stand1": monster => { number(monster, "spawnsilent", 0); monster.ai("stand", 0); return think(monster); },
      "hipscrge:scourge_walk1": monster => { if (monster.game.host.random() < 0.1) monster.game.sound(monster.entity, "scourge/idle.wav", "voice", 2); number(monster, "spawnsilent", 1); think(monster); return monster.ai("walk", 8); },
      "hipscrge:scourge_run1": monster => { if (monster.game.host.random() < 0.1) monster.game.sound(monster.entity, "scourge/idle.wav", "voice", 2); number(monster, "spawnsilent", 1); think(monster); return monster.ai("run", 18); },
      "hipscrge:scourge_strafeleft1": monster => { number(monster, "spawnsilent", 1); think(monster); return side(monster, false, 20); },
      "hipscrge:scourge_straferight1": monster => { number(monster, "spawnsilent", 1); think(monster); return side(monster, true, 20); },
      "hipscrge:scourge_turn1": monster => { number(monster, "spawnsilent", 1); think(monster); return turn(monster); },
      "ai_left(20)": monster => side(monster, false, 20), "ai_left(14)": monster => side(monster, false, 14), "ai_right(20)": monster => side(monster, true, 20), "ai_right(14)": monster => side(monster, true, 14), ai_turn_in_place: turn,
      "hipscrge:scourge_atk1": monster => { number(monster, "spawnsilent", 0); think(monster); return flash(monster, 40); },
      "hipscrge:scourge_atk2": monster => flash(monster, -56), "hipscrge:scourge_atk3": monster => flash(monster, -40), "hipscrge:scourge_atk4": monster => flash(monster, 56), "hipscrge:scourge_atk5": monster => flash(monster, 40),
      "hipscrge:scourge_atk8": monster => { flash(monster, 56); return monster.attackFinished(4 * monster.game.host.random()); },
      "hipscrge:scourge_melee1": monster => { number(monster, "spawnsilent", 0); think(monster); return monster.ai("charge", 3); },
      "hipscrge:scourge_melee11": monster => { monster.face(); if (monster.game.options.skill === 3 && !monster.state.refired && monster.visible()) { monster.state.refired = true; monster.nextFrame = "scourge_melee1"; } return undefined; },
      "hipscrge:scourge_pain1": monster => { number(monster, "spawnsilent", 0); return think(monster); }, Attack_With_Tail: tail,
    },
    spawn: monster => { monster.entity.fields.set("yaw_speed", "60"); number(monster, "scourge:state", 0); monster.entity.attackState = "dodging"; return monster.spawnDefault(); },
    melee: monster => { monster.play("scourge_melee1"); return monster.attackFinished(2 * monster.game.host.random()); },
    checkAttack,
    pain: (monster, _attacker, damage) => {
      if (monster.game.host.random() * 50 > damage || monster.state.painFinished > monster.game.time) return undefined;
      monster.game.host.random(); monster.game.sound(monster.entity, "scourge/pain.wav"); monster.state.painFinished = monster.game.time + 2;
      return monster.play("scourge_pain1");
    },
    die: monster => {
      const { game, entity } = monster, trigger = game.entity(entity.references.get("lastvictim") ?? null);
      if (trigger !== null) game.remove(trigger); number(monster, "spawnsilent", 0); think(monster);
      if (game.health(entity.actor.id) < -35) {
        game.sound(entity, "player/udeath.wav"); throwHead(game, entity, "h_scourg");
        for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, game.health(entity.actor.id)); return undefined;
      }
      game.sound(entity, "scourge/pain2.wav"); return monster.play("scourge_die1");
    },
  };
}
