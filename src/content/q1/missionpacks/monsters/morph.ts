/* morph.qc: stone emergence, laser attacks and child summons. GPL-2.0-or-later. */
import { length, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { launchLaser } from "../../base/projectiles.ts";
import { MissionMonster, type Q1MissionPackMonsters } from "./runtime.ts";
import type { PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/morph.ts";
import { dropToFloor, eye, hullBounds } from "./helpers.ts";
import { isSpawnPointEmpty, overlordDestination } from "./overlord.ts";

function setup(monster: MissionMonster): undefined {
  const { game, entity } = monster, owner = game.entity(entity.owner);
  entity.solid = "slidebox"; entity.movement = "step"; entity.damageable = false; entity.movementFlags |= 32;
  entity.idealYaw = game.body(entity).angles.y; if (entity.yawSpeed === 0) entity.yawSpeed = 20;
  entity.fields.set("view_ofs", "0 0 25"); entity.frame = frames.get("morph_wake1")?.frame ?? 0; game.setBounds(entity, hullBounds);
  entity.pain = game.named.pain(entity, "rogue:monster_pain"); entity.die = game.named.die(entity, "rogue:monster_die");
  entity.maxHealth = owner === null ? 2000 : 200; game.host.combat.setHealth(entity.actor, entity.maxHealth);
  if (owner !== null) { entity.effects = 0; entity.spawnflags = owner.spawnflags; } else entity.effects |= 8;
  entity.skin = 2; return game.link(entity);
}
function wake(monster: MissionMonster): undefined {
  if (isSpawnPointEmpty(monster.game, monster.entity)) { setup(monster); monster.nextFrame = "morph_wake1"; }
  else monster.nextFrame = "morph_wake";
  return monster.delay(0.1);
}
function stab(monster: MissionMonster): undefined {
  const { game, entity } = monster; if (monster.enemy === null || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
  monster.face(); const target = eye(game, monster.enemy); if (target === null) return undefined;
  const delta = vsub(target, monster.origin), distance = length(delta), direction = normalize(delta), basis = game.makeVectors(game.body(entity).angles);
  if (distance <= 90) {
    game.sound(entity, "enforcer/enfstop.wav", "weapon", 3); game.damage(monster.enemy, entity.actor.id, entity.actor.id, game.host.random() * 10 + 20);
    game.host.emit({ kind: "particles", origin: monster.target ?? target, direction: vscale(basis.forward, 150), color: 73, count: 14 });
  } else {
    entity.effects |= 2; const origin = vadd(vadd(vadd(monster.origin, vscale(basis.forward, 80)), vscale(basis.right, 4)), { x: 0, y: 0, z: 4 });
    launchLaser(game, entity.actor.id, origin, direction);
    launchLaser(game, entity.actor.id, origin, vadd(direction, vscale(game.basis.right, distance !== 0 ? 0.04 : 0.1)));
    launchLaser(game, entity.actor.id, origin, vsub(direction, vscale(game.basis.right, distance !== 0 ? 0.04 : 0.1)));
  }
  return undefined;
}
function smack(monster: MissionMonster): undefined {
  const { game, entity } = monster; if (monster.enemy === null || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
  monster.face(); if (monster.distance > 100) return undefined;
  game.damage(monster.enemy, entity.actor.id, entity.actor.id, game.host.random() * 10 + 10);
  const basis = game.makeVectors(game.body(entity).angles), owner = game.host.actors.resolveOwned(monster.enemy), body = game.host.bodies.read(monster.enemy);
  if (owner !== null && body !== null) game.host.bodies.write(owner, { ...body, velocity: vadd(vscale(basis.forward, 100), { x: 0, y: 0, z: 100 }) });
  return undefined;
}
function fire(monster: MissionMonster): undefined {
  const { game, entity } = monster; monster.face(); entity.effects |= 2;
  const basis = game.makeVectors(game.body(entity).angles), target = monster.target; if (target === null) return undefined;
  const origin = vadd(vadd(vadd(monster.origin, vscale(basis.forward, 30)), vscale(basis.right, 8.5)), { x: 0, y: 0, z: 16 }), direction = normalize(vsub(target, monster.origin));
  launchLaser(game, entity.actor.id, origin, direction);
  const spread = monster.distance > 400 ? 0.04 : 0.1;
  launchLaser(game, entity.actor.id, origin, vadd(direction, vscale(game.basis.right, spread)));
  launchLaser(game, entity.actor.id, origin, vsub(direction, vscale(game.basis.right, spread)));
  return undefined;
}
function child(monster: MissionMonster): undefined {
  const { game, entity, runtime } = monster;
  if (entity.owner !== null || entity.number("childrenSpawned") > 1 + game.options.skill) return undefined;
  const destination = overlordDestination(game); if (destination === null) return undefined;
  const next = game.create("monster_morph"); next.model = entity.model; next.owner = entity.actor.id; next.mangle = destination.mangle;
  game.setBody(next, { angles: destination.mangle });
  const controller = new MissionMonster(game, next, monster.definition, runtime); runtime.monsters.set(next.actor, controller);
  controller.enemy = monster.enemy; controller.state.path = monster.state.path;
  next.references.set("movetarget", entity.references.get("movetarget") ?? null); next.references.set("goalentity", entity.references.get("goalentity") ?? null);
  setup(controller); game.setOrigin(next, game.body(destination).origin);
  dropToFloor(monster);
  controller.nextFrame = "morph_wake1"; return controller.delay(0.3);
}
export function morphDefinition(_runtime: Q1MissionPackMonsters): PackMonsterDefinition {
  return {
    spec: { species: "morph", classnames: ["monster_morph"], model: "morph_az", head: null, health: 2000, gibHealth: -Infinity, gibs: [], bounds: hullBounds,
      stand: "morph_stand1", walk: "morph_walk1", run: "morph_run1", sight: "", missile: "morph_fire1", melee: true, movement: "walk" }, frames,
    actions: {
      morph_stab2: stab, morph_smack: smack, morph_fire: fire, morph_teleport: child, morph_wake: wake,
      "morph:morph_die9": monster => { monster.entity.skin++; return undefined; },
      "morph:morph_die21": monster => monster.game.remove(monster.entity),
      "morph:morph_wake1": monster => {
        const { game, entity } = monster; game.sound(entity, "guard/see1.wav");
        const owner = game.entity(entity.owner); if (owner !== null) { game.totalMonsters++; owner.fields.set("childrenSpawned", String(owner.number("childrenSpawned") + 1)); game.host.emit({ kind: "monster-total", total: game.totalMonsters }); }
        return undefined;
      },
      "morph:morph_wake15": monster => { monster.entity.skin = 1; return undefined; },
      "morph:morph_wake31": monster => {
        monster.entity.solid = "slidebox"; monster.entity.damageable = true; monster.entity.aimedDamage = true; monster.entity.skin--;
        if (monster.entity.owner !== null) { monster.nextFrame = "morph_run1"; monster.delay(0.1); }
        return monster.game.link(monster.entity);
      },
    },
    spawn: monster => {
      const { game, entity } = monster;
      if ((entity.spawnflags & 2) !== 0) entity.model = "progs/morph_az.mdl";
      else if ((entity.spawnflags & 4) !== 0) entity.model = "progs/morph_eg.mdl";
      else if ((entity.spawnflags & 8) !== 0) entity.model = "progs/morph_gr.mdl";
      else throw new Error("monster_morph: no skin selection!");
      game.totalMonsters++; if (entity.targetname !== "") { entity.use = game.named.use(entity, "rogue:monster_use"); return undefined; }
      return wake(monster);
    },
    use: monster => { monster.nextFrame = "morph_wake"; return monster.delay(monster.entity.delay || 0.1); },
    melee: monster => { const r = monster.game.host.random(); return monster.play(r < 0.5 ? "morph_bigattack01" : r < 0.75 ? "morph_attack01" : "morph_knockback01"); },
    pain: monster => {
      const { game } = monster; if (game.options.skill === 3) { if (game.host.random() > 0.5) child(monster); return undefined; }
      if (monster.state.painFinished > game.time || game.host.random() > 0.25) return undefined;
      const r = game.host.random(); monster.state.painFinished = game.time + 2; game.sound(monster.entity, "guard/pain1.wav");
      monster.nextFrame = r > 0.6 ? "morph_painB1" : "morph_painA1"; return monster.delay(0.1);
    },
    die: monster => { monster.game.sound(monster.entity, "guard/death.wav"); monster.entity.solid = "none"; monster.nextFrame = "morph_die1"; monster.game.link(monster.entity); return monster.delay(0.1); },
  };
}
