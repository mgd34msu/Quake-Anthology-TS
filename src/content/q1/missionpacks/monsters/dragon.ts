/* dragon.qc and new_ai.qc, including source flight and falling death. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import { sameActor } from "../../../../contracts/identity.ts";
import type { Vec3 } from "../../../../contracts/math.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import { POINT, ZERO, dot, length, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { throwGib } from "../../base/projectiles.ts";
import { launchRoguePlasma } from "../rogue-weapons.ts";
import { velocityAngles } from "../types.ts";
import type { MissionMonster, Q1MissionPackMonsters } from "./runtime.ts";
import type { MissionAction, PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/dragon.ts";
import { hullBounds, missile, number } from "./helpers.ts";

export function launchDragonFireball(game: Q1Foundation, owner: ActorId, origin: Vec3, direction: Vec3): Q1Actor {
  const source = game.entity(owner); if (source !== null) source.effects |= 2;
  const shot = missile(game, owner, "fireball", "progs/fireball.mdl", origin, ZERO, "rogue:FireballTouch", 6);
  game.setBody(shot, { velocity: vscale(direction, game.host.random() * 300 + 900) }); shot.angularVelocity = { x: 0, y: 0, z: 300 };
  game.setBody(shot, { angles: velocityAngles(game.body(shot).velocity) }); shot.references.set("enemy", source?.monster?.enemy ?? null); return shot;
}
function goal(monster: MissionMonster): Q1Actor | null { return monster.game.entity(monster.entity.references.get("movetarget") ?? null); }
function stopAttack(monster: MissionMonster): undefined {
  if (monster.entity.number("dragonAttacking") === 0) return undefined;
  monster.state.attackFinished = monster.game.time + monster.game.host.random() * 2 + 4 - monster.game.options.skill; number(monster, "dragonAttacking", 0);
  const destination = goal(monster), end = destination === null ? ZERO : monster.game.body(destination).origin;
  const trace = monster.game.host.trace({ start: monster.origin, end, bounds: POINT, ignore: monster.game.world?.actor.id ?? null, monsters: false });
  if (trace.fraction !== 1) for (const player of monster.game.host.players()) monster.game.message(player, "Error: Dragon cannot get to next target!\n", false);
  return undefined;
}
function checkAttack(monster: MissionMonster): undefined {
  const { game, entity } = monster, attack = entity.fields.get("dragon:missile") ?? "";
  if (entity.number("dragonAttacking") === 1 || attack === "" || monster.state.attackFinished > game.time) return undefined;
  if (monster.enemy !== null && game.health(monster.enemy) < 0) monster.enemy = null;
  if (((game.entity(monster.enemy)?.movementFlags ?? 0) & 128) !== 0) return undefined;
  if (monster.enemy === null) { monster.findTarget(); return undefined; }
  const target = monster.target; if (target === null) return undefined;
  const basis = game.makeVectors(game.body(entity).angles), direction = normalize(vsub(target, monster.origin));
  if (dot(direction, basis.forward) <= 0.3 || game.host.trace({ start: monster.origin, end: target, bounds: POINT, ignore: game.world?.actor.id ?? null, monsters: false }).fraction !== 1) return undefined;
  number(monster, "dragonAttacking", 1); monster.nextFrame = monster.distance < 350 ? "dragon_melee1" : attack; return undefined;
}
function move(monster: MissionMonster, distance: number): undefined {
  const { game, entity } = monster;
  if (game.health(entity.actor.id) < 1) return game.remove(entity);
  if (entity.number("dragonAttacking") === 0) checkAttack(monster);
  const previousEnemy = monster.enemy, destination = goal(monster);
  const target = entity.number("dragonAttacking") === 0 ? destination === null ? ZERO : game.body(destination).origin : monster.target ?? ZERO;
  if (entity.number("dragonAttacking") === 0) monster.enemy = destination?.actor.id ?? null;
  const direction = vsub(target, monster.origin), desired = velocityAngles(direction), original = game.body(entity).angles;
  let yaw = original.y, roll = original.z, offset = yaw - desired.y;
  const anglemod = (value: number): number => (value % 360 + 360) % 360;
  if (offset !== 0) {
    offset = 180 - yaw; let left = anglemod(desired.y + offset) - 180, right = 180 - anglemod(desired.y + offset);
    if (left < 0) left = 360; else if (right < 0) right = 360;
    entity.yawSpeed = 10;
    if (right < 180) { yaw = entity.yawSpeed < right ? yaw - entity.yawSpeed : desired.y; if (right > 5) roll = Math.min(30, roll + 5); }
    else { yaw = entity.yawSpeed < right ? yaw + entity.yawSpeed : desired.y; if (left > 5) roll = Math.max(-30, roll - 5); }
  } else if (roll !== 0) { if (roll < -5) roll += 5; else if (roll < 5) roll = 0; else if (roll > 5) roll -= 5; }
  game.setBody(entity, { angles: { ...original, y: yaw, z: roll } });
  if (direction.z > 5) game.setOrigin(entity, vadd(monster.origin, { x: 0, y: 0, z: 5 })); else if (direction.z < -5) game.setOrigin(entity, vsub(monster.origin, { x: 0, y: 0, z: 5 }));
  const before = monster.origin; game.host.walkMove(entity.actor, yaw, distance); const after = monster.origin;
  if (before.x === after.x && before.y === after.y && before.z === after.z) {
    const movementGoal = game.entity(entity.references.get("goalentity") ?? null); if (movementGoal !== null) game.host.moveToGoal(entity.actor, movementGoal.actor.id, distance);
  }
  monster.enemy = previousEnemy; return undefined;
}
function fire(monster: MissionMonster): undefined {
  const { game, entity } = monster; game.sound(entity, "dragon/attack.wav");
  const basis = game.makeVectors(game.body(entity).angles), origin = vadd(vadd(monster.origin, vscale(basis.forward, 112)), vscale(basis.up, 32));
  const plasma = game.host.random() > 0.66; let count = plasma ? game.options.skill > 1 ? 2 : 1 : Math.floor(game.host.random() * game.options.skill + 0.5) + 1;
  while (count-- > 0) {
    const distortion = (game.host.random() - 0.5) * 0.25, direction = normalize(vsub(monster.target ?? ZERO, origin)), spray = game.makeVectors(direction);
    const aim = vadd(direction, vscale(spray.right, distortion));
    if (plasma) launchRoguePlasma(game, entity.actor.id, origin, aim); else launchDragonFireball(game, entity.actor.id, origin, aim);
  }
  return undefined;
}
function tail(monster: MissionMonster): undefined {
  const { game, entity } = monster; if (monster.enemy === null || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
  move(monster, 10); const target = monster.target; if (target === null) return undefined;
  const delta = vsub(target, monster.origin);
  if (length(delta) < 250) {
    game.damage(monster.enemy, entity.actor.id, entity.actor.id, 30);
    const actor = game.host.actors.resolveOwned(monster.enemy), body = game.host.bodies.read(monster.enemy);
    if (actor !== null && body !== null) game.host.bodies.write(actor, { ...body, velocity: { ...vscale(normalize(delta), 500), z: 350 } });
  }
  return stopAttack(monster);
}
function violentDeath(monster: MissionMonster, count: number): undefined {
  const { game, entity } = monster;
  for (; count > 0; count -= 3) for (const model of ["gib1", "gib2", "gib3"]) {
    const gib = game.create("gib"); gib.model = `progs/${model}.mdl`; const velocity = vscale(game.body(entity).velocity, -1.25), basis = game.makeVectors(velocity);
    game.setBody(gib, { origin: monster.origin, bounds: { min: { x: -8, y: -8, z: -8 }, max: { x: 8, y: 8, z: 8 } }, velocity: vadd(vadd(velocity, vscale(basis.right, game.host.random() * 300 - 150)), vscale(game.basis.up, game.host.random() * 300 - 150)) });
    gib.movement = "bounce"; gib.angularVelocity = { x: game.host.random() * 600, y: game.host.random() * 600, z: game.host.random() * 600 }; gib.fields.set("ltime", String(game.time));
    game.schedule(gib, 10 + game.host.random() * 10, game.named.action(gib, "SUB_Remove")); game.link(gib);
  }
  return undefined;
}
function finishDeath(monster: MissionMonster, count: number): undefined { violentDeath(monster, count); monster.entity.target = "dragondoor"; monster.game.useTargets(monster.entity, monster.entity.activator); return monster.game.remove(monster.entity); }
function boom(monster: MissionMonster): undefined {
  if (monster.entity.number("dragonDeathState") > 2) return undefined;
  number(monster, "dragonDeathState", 3); for (const model of ["drggib01", "drggib02", "drggib03"]) throwGib(monster.game, monster.origin, model, -100);
  monster.game.sound(monster.entity, "player/tornoff2.wav", "body", 0); monster.nextFrame = "dragon_boom2"; return monster.delay(0.1);
}
function explode(monster: MissionMonster): undefined {
  const { game, entity } = monster; if (entity.number("dragonDeathState") > 1) return undefined;
  if (length(game.body(entity).velocity) < 100 || (entity.movementFlags & 16) !== 0) { number(monster, "dragonDeathState", 2); return boom(monster); }
  const basis = game.makeVectors(game.body(entity).angles), velocity = vsub(game.body(entity).velocity, vscale(basis.up, 40));
  game.setBody(entity, { velocity }); entity.fields.set("dragonLastVelocity", `${velocity.x} ${velocity.y} ${velocity.z}`); return undefined;
}
function use(monster: MissionMonster): undefined { if (monster.game.health(monster.entity.actor.id) < 1) { monster.entity.use = null; return undefined; } monster.nextFrame = "dragon_walk1"; return monster.delay(0.1); }
export function dragonDefinition(runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  const actions: Record<string, MissionAction> = {
    dragon_stop_attack: stopAttack, dragon_fireball: fire, dragon_tail: tail, dragon_explode: explode,
    dragon_tail_touch: monster => {
      const { game, entity } = monster; if (monster.enemy === null || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
      monster.ai("charge", 10); const target = monster.target;
      if (target !== null && length(vsub(target, monster.origin)) <= 150) game.damage(monster.enemy, entity.actor.id, entity.actor.id, game.host.random() * 30 + 30);
      return undefined;
    },
    dragon_boom2: monster => { monster.game.setBody(monster.entity, { velocity: monster.entity.vector("dragonLastVelocity") }); return finishDeath(monster, 15); },
    dragon_activate: monster => {
      const { game, entity } = monster; entity.damageable = true; entity.aimedDamage = true; entity.idealYaw = game.body(entity).angles.y;
      if (entity.yawSpeed === 0) entity.yawSpeed = 10; entity.fields.set("view_ofs", "0 0 25"); entity.movementFlags |= 1 | 32; game.host.walkMove(entity.actor, 0, 0);
      if (entity.target !== "") { const target = game.find(entity.target)[0]?.actor.id ?? null; entity.references.set("movetarget", target); entity.references.set("goalentity", target); }
      if (entity.targetname !== "") { entity.use = game.named.use(entity, "rogue:monster_use"); return undefined; }
      return use(monster);
    },
    "dragon:dragon_walk1": monster => { if (monster.entity.number("dragonAttacking") !== 0) stopAttack(monster); monster.entity.fields.set("dragon:missile", "dragon_atk_a1"); number(monster, "dragonPainSequence", 1); move(monster, 17);
      if (monster.game.host.random() < 0.2) monster.game.host.emit({ kind: "sound", actor: monster.entity.actor.id, path: "dragon/active.wav", channel: "voice", volume: 0.6, attenuation: 2 }); return undefined; },
    "dragon:dragon_walk2": monster => { monster.entity.fields.set("dragon:missile", ""); return move(monster, 17); },
    "dragon:dragon_walk13": monster => { monster.entity.fields.set("dragon:missile", ""); move(monster, 17); return number(monster, "dragonPainSequence", 1); },
    "dragon:dragon_death1": monster => {
      const { game, entity } = monster; if (entity.number("dragonDeathState") > 0) return undefined; number(monster, "dragonDeathState", 1); entity.use = null;
      const basis = game.makeVectors(game.body(entity).angles); game.setBody(entity, { velocity: vsub(vscale(basis.forward, 300), vscale(basis.up, 40)), ground: null }); entity.movementFlags &= ~512; game.setBounds(entity, hullBounds);
      entity.touch = game.named.touch(entity, "rogue:dragon_squish"); game.sound(entity, "dragon/death.wav", "voice", 0); return number(monster, "dragonAttacking", 0);
    },
    "dragon:dragon_death21": monster => finishDeath(monster, 39),
  };
  for (const distance of [10, 12, 17]) actions[`dragon_move(${distance})`] = monster => move(monster, distance);
  for (const entry of [{ frame: 3, attack: "b", pain: 2 }, { frame: 5, attack: "c", pain: 3 }, { frame: 7, attack: "d", pain: 4 }, { frame: 9, attack: "e", pain: 5 }, { frame: 11, attack: "f", pain: 6 }]) actions[`dragon:dragon_walk${entry.frame}`] = monster => { monster.entity.fields.set("dragon:missile", `dragon_atk_${entry.attack}1`); move(monster, 17); return number(monster, "dragonPainSequence", entry.pain); };
  return {
    spec: { species: "dragon", classnames: ["monster_dragon"], model: "dragon", head: null, health: 4000, gibHealth: -Infinity, gibs: [], bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } },
      stand: "dragon_walk1", walk: "dragon_walk1", run: "dragon_walk1", sight: "dragon/see.wav", missile: null, melee: false, movement: "fly" }, frames, actions,
    callbacks: {
      FireballTouch: { touch(game, entity, other) { if (entity.owner !== null && sameActor(other, entity.owner)) return undefined; const dragon = entity.owner !== null && game.host.classname(entity.owner) === "monster_dragon";
        game.radiusDamage(entity.actor.id, entity.owner, dragon ? 90 : 30, dragon ? entity.owner : game.world?.actor.id ?? null, null); game.sound(entity, "weapons/r_exp3.wav", "weapon"); game.host.emit({ kind: "colored-explosion", origin: game.body(entity).origin, colorStart: 228, colorLength: 5 }); return game.remove(entity); } },
      dragon_squish: { touch(game, entity, other) { const monster = runtime.require(entity); if (game.host.classname(other) === "player") { entity.classname = "monster_dragon_dead"; game.damage(other, entity.actor.id, entity.actor.id, 200); }
        if (game.world !== null && sameActor(other, game.world.actor.id)) { game.setBody(entity, { velocity: ZERO }); return explode(monster); } return undefined; } },
      dragon_corner_touch: { touch(game, corner, other) {
        const entity = game.entity(other), current = entity?.references.get("movetarget"); if (entity === null || current === undefined || current === null || !sameActor(current, corner.actor.id) || entity.classname !== "monster_dragon") return undefined;
        const target = game.find(corner.target)[0]; entity.references.set("movetarget", target?.actor.id ?? null); entity.references.set("goalentity", target?.actor.id ?? null); entity.target = corner.target;
        if (target === undefined) throw new Error("dragon_corner: no target found"); return undefined;
      } },
    },
    spawn: monster => {
      const { game, entity } = monster; number(monster, "dragonInRoom", 1); number(monster, "dragonInTransit", 0); number(monster, "dragonAttacking", 0); number(monster, "playerInRoom", 1); number(monster, "playerInTransit", 0);
      entity.solid = "slidebox"; entity.movement = "step"; entity.yawSpeed = entity.number("yaw_speed"); entity.model = "progs/dragon.mdl"; game.setBounds(entity, monster.spec.bounds); entity.maxHealth = 3000 + 1000 * game.options.skill; game.host.combat.setHealth(entity.actor, entity.maxHealth);
      entity.pain = game.named.pain(entity, "rogue:monster_pain"); entity.die = game.named.die(entity, "rogue:monster_die"); number(monster, "dragonPainSequence", 1); game.totalMonsters++;
      monster.nextFrame = "dragon_activate"; return monster.delay(0.1 - game.time);
    },
    use,
    pain: monster => {
      const { game, entity } = monster; if (monster.state.painFinished > game.time || game.host.random() >= 0.25) return undefined;
      stopAttack(monster); game.sound(entity, "dragon/pain.wav"); monster.state.painFinished = game.time + 2;
      const sequence: Readonly<Record<number, string>> = { 1: "A", 2: "F", 3: "E", 4: "D", 5: "C", 6: "B" }, name = sequence[entity.number("dragonPainSequence")]; if (name !== undefined) monster.nextFrame = `dragon_pain${name}1`; return undefined;
    },
    die: monster => monster.play("dragon_death1"),
  };
}
export function registerDragonCorners(game: Q1Foundation): undefined {
  game.registerSpawn("trigger_dragon", (_game, entity) => game.remove(entity));
  game.registerSpawn("dragon_corner", (_game, entity) => {
    if (entity.targetname === "") throw new Error("dragon_corner: no targetname"); entity.solid = "trigger"; entity.movement = "none"; entity.touch = game.named.touch(entity, "rogue:dragon_corner_touch"); entity.model = "";
    game.setBounds(entity, { min: { x: -16, y: -16, z: -16 }, max: { x: 16, y: 16, z: 16 } }); return game.link(entity);
  }); return undefined;
}
