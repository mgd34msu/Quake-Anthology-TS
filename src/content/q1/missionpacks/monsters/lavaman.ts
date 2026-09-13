/* lavaman.qc, triggered emergence and ballistic fireballs. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { POINT, length, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import type { PackMonsterDefinition } from "./types.ts";
import type { MissionMonster } from "./runtime.ts";
import { frames } from "./tables/lavaman.ts";
import { dropToFloor, missile } from "./helpers.ts";
import { velocityAngles } from "../types.ts";

function checkAttack(monster: MissionMonster): boolean {
  monster.face(); const target = monster.target; if (target === null) return false;
  const trace = monster.game.host.trace({ start: vadd(monster.origin, { x: 0, y: 0, z: 64 }), end: target, bounds: POINT, ignore: monster.entity.actor.id, monsters: true });
  if (trace.actor !== monster.enemy || trace.inOpen && trace.inWater || monster.game.time < monster.state.attackFinished) return false;
  monster.play("lavaman_fire1"); monster.attackFinished(1 + monster.game.host.random()); return true;
}
function hunt(monster: MissionMonster): undefined {
  const { game } = monster;
  if (monster.enemy === null || game.health(monster.enemy) <= 0) {
    const players = game.host.players(), index = monster.enemy === null ? -1 : players.indexOf(monster.enemy), candidate = players[index + 1] ?? null;
    const body = candidate === null ? null : game.host.bodies.read(candidate);
    if (body !== null && game.host.trace({ start: vadd(monster.origin, { x: 0, y: 0, z: 96 }), end: body.origin, bounds: POINT, ignore: game.world?.actor.id ?? null, monsters: false }).fraction === 1) monster.enemy = candidate;
  }
  if (monster.enemy !== null) monster.face();
  return undefined;
}
function locomotion(monster: MissionMonster, mode: "stand" | "walk" | "run", distance: number): undefined {
  if (monster.enemy !== null) checkAttack(monster); else hunt(monster);
  if (mode === "walk" && monster.enemy !== null) { monster.findTarget(); monster.game.host.moveToGoal(monster.entity.actor, monster.enemy, distance); return undefined; }
  return monster.ai(mode, distance);
}
function fire(monster: MissionMonster, side: number): undefined {
  const { game, entity } = monster, target = monster.target;
  if (target === null) return undefined;
  const basis = game.makeVectors(game.body(entity).angles), origin = vadd(vadd(vadd(monster.origin, vscale(basis.forward, 40)), vscale(basis.right, side === 1 ? 65 : -75)), vscale(basis.up, side === 1 ? 130 : 125));
  const direction = normalize(vsub(target, origin)), t = Math.max(1, Math.min(1.75, length(vsub(target, origin)) / 380));
  const ball = missile(game, entity.actor.id, "lavaman_ball", "progs/lavaball.mdl", origin, vadd(vscale(direction, 600 * t), { x: 0, y: 0, z: 200 * t }), "rogue:lavaman_touch", 6);
  ball.movement = "bounce"; ball.angularVelocity = { x: 200, y: 100, z: 300 }; game.setBody(ball, { angles: velocityAngles(direction) });
  game.sound(entity, "boss1/throw.wav", "weapon");
  if (monster.enemy === null || game.health(monster.enemy) <= 0) return monster.play("lavaman_idle1");
  return undefined;
}
function awake(monster: MissionMonster, activator: ActorId | null): undefined {
  const { game, entity } = monster;
  entity.solid = "slidebox"; entity.movement = "step"; entity.damageable = true; entity.aimedDamage = true; entity.movementFlags |= 32;
  entity.idealYaw = game.body(entity).angles.y; entity.yawSpeed = entity.number("yaw_speed") || 20;
  entity.model = "progs/lavaman.mdl"; entity.fields.set("view_ofs", "0 0 48"); game.setBounds(entity, monster.spec.bounds);
  entity.maxHealth = 1250 + 250 * game.options.skill; game.host.combat.setHealth(entity.actor, entity.maxHealth);
  entity.pain = game.named.pain(entity, "rogue:monster_pain"); entity.die = game.named.die(entity, "rogue:monster_die");
  game.effect("lava-splash", monster.origin);
  if (activator !== null && game.isPlayer(activator) && (game.player(activator)?.powerups.get("invisibility") ?? 0) <= game.time && ((game.entity(activator)?.movementFlags ?? 0) & 128) === 0) monster.enemy = activator;
  dropToFloor(monster); game.monsterMissions.get(entity.actor.id)?.started(); return monster.play("lavaman_rise1");
}
export const lavamanDefinition: PackMonsterDefinition = {
  spec: { species: "lava-man", classnames: ["monster_lava_man"], model: "lavaman", head: null, health: 1500, gibHealth: -Infinity, gibs: [],
    bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "lavaman_idle1", walk: "lavaman_walk1", run: "lavaman_walk1", sight: "", missile: "lavaman_fire1", melee: true, movement: "walk" }, frames,
  callbacks: {
    lavaman_touch: { touch(game, entity, other) {
      if (other === entity.owner) return undefined;
      const body = game.body(entity); if (game.host.contents(body.origin) === "sky") return game.remove(entity);
      if (game.health(other) !== 0) game.damage(other, entity.actor.id, entity.owner, game.host.classname(other) === "monster_shambler" ? 20 : 40);
      game.radiusDamage(entity.actor.id, entity.owner, 40, other, null);
      game.setBody(entity, { origin: vsub(body.origin, vscale(normalize(body.velocity), 8)) });
      game.effect("explosion", game.body(entity).origin); game.effect("explosion", game.body(entity).origin);
      return game.remove(entity);
    } },
  },
  actions: {
    lavaman_stand: monster => locomotion(monster, "stand", 0), lavaman_walk: monster => locomotion(monster, "walk", 2), lavaman_run: monster => locomotion(monster, "run", 2),
    "lavaman_missile(1)": monster => fire(monster, 1), "lavaman_missile(2)": monster => fire(monster, 2),
    "lavaman:lavaman_death9": monster => { monster.game.sound(monster.entity, "boss1/out1.wav", "body"); return monster.game.effect("lava-splash", monster.origin); },
    "lavaman:lavaman_death10": monster => monster.game.remove(monster.entity),
  },
  spawn: monster => { const mission = monster.game.monsterMissions.get(monster.entity.actor.id); if (mission === undefined) monster.game.totalMonsters++; else mission.spawned(); if ((monster.entity.spawnflags & 2) !== 0) { monster.entity.use = monster.game.named.use(monster.entity, "rogue:monster_use"); return undefined; } return awake(monster, monster.entity.activator); },
  use: awake,
  checkAttack,
  melee: monster => monster.play("lavaman_fire1"),
  pain: monster => { if (monster.state.painFinished > monster.game.time || monster.game.host.random() >= 0.05) return undefined; monster.state.painFinished = monster.game.time + 2; return monster.play("lavaman_shocka1"); },
  die: monster => monster.play("lavaman_death1"),
};
