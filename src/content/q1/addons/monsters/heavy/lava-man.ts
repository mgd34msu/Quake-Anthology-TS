/* quakec_mg3/monsters/mg3_lavaman.qc. GPL-2.0-or-later. */
import type { ActorId } from "../../../../../contracts/identity.ts";
import { sameActor } from "../../../../../contracts/identity.ts";
import { POINT, ZERO, length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import type { HeavyDefinition, Q1HeavyMonster, Q1Mg3Heavy } from "./runtime.ts";
import { heavyPrefix } from "./runtime.ts";
import { frames } from "./tables/mg3_lavaman.ts";

function checkAttack(monster: Q1HeavyMonster): boolean {
  const { game, entity } = monster; monster.face();
  const trace = game.host.trace({ start: vadd(monster.origin, { x: 0, y: 0, z: 64 }), end: monster.target ?? ZERO, bounds: POINT, ignore: entity.actor.id, monsters: true });
  if (trace.inOpen && trace.inWater || monster.enemy === null || trace.actor === null || !sameActor(trace.actor, monster.enemy) || game.time < monster.state.attackFinished) return false;
  monster.play("lavaman_fire1"); monster.attackFinished(1 + game.host.random()); return true;
}
function hunt(monster: Q1HeavyMonster): undefined {
  const { game, entity } = monster;
  if (monster.enemy === null || game.health(monster.enemy) <= 0) {
    const enemy = monster.enemy, actors = game.host.actors.observations(), current = enemy === null ? -1 : actors.findIndex(actor => sameActor(actor.id, enemy));
    const player = actors.slice(current + 1).find(actor => game.isPlayer(actor.id))?.id ?? game.world?.actor.id ?? null;
    const target = player === null ? ZERO : game.host.bodies.read(player)?.origin ?? ZERO;
    if (game.host.trace({ start: vadd(monster.origin, { x: 0, y: 0, z: 96 }), end: target, bounds: POINT, ignore: game.world?.actor.id ?? null, monsters: false }).fraction === 1) monster.enemy = player;
  }
  if (monster.enemy !== null) { monster.face(); entity.references.set("movetarget", monster.enemy); entity.references.set("goalentity", monster.enemy); }
  return undefined;
}
function think(monster: Q1HeavyMonster, mode: "stand" | "walk" | "run"): undefined {
  if (monster.enemy !== null) checkAttack(monster); else hunt(monster);
  return monster.ai(mode, mode === "stand" ? 0 : 2);
}
function launch(monster: Q1HeavyMonster, hand: 1 | 2): undefined {
  const { game, entity } = monster, basis = game.makeVectors(game.body(entity).angles);
  const origin = vadd(vadd(vadd(monster.origin, vscale(basis.forward, 40)), vscale(basis.right, hand === 1 ? 65 : -65)), vscale(basis.up, 90));
  const delta = vsub(monster.target ?? ZERO, origin), duration = Math.max(1, Math.min(1.75, length(delta) / 380)), direction = normalize(delta);
  const ball = game.create("lavaman_ball"); ball.owner = entity.actor.id; ball.movement = "bounce"; ball.solid = "bbox"; ball.model = "progs/lavaball.mdl";
  ball.touch = game.named.touch(ball, `${heavyPrefix}:lavaman_touch`); ball.angularVelocity = { x: 200, y: 100, z: 300 };
  game.setBody(ball, { origin, angles: velocityAngles(direction), bounds: POINT, velocity: vadd(vscale(direction, 600 * duration), { x: 0, y: 0, z: 200 * duration }) });
  game.link(ball); game.schedule(ball, 6, game.named.action(ball, "SUB_Remove")); game.sound(entity, "boss1/throw.wav", "weapon");
  return monster.enemy === null || game.health(monster.enemy) <= 0 ? monster.play("lavaman_idle1") : undefined;
}
function awake(monster: Q1HeavyMonster, activator: ActorId | null): undefined {
  const { game, entity } = monster; entity.solid = "slidebox"; entity.movement = "fly"; entity.aimedDamage = true; entity.damageable = true; entity.movementFlags |= 32;
  entity.idealYaw = game.body(entity).angles.y; entity.yawSpeed = entity.number("yaw_speed") || 20; entity.model = "progs/lavaman.mdl"; game.setBounds(entity, monster.spec.bounds);
  monster.context.setVector(entity, "view_ofs", { x: 0, y: 0, z: 48 }); game.host.combat.setHealth(entity.actor, 1250 + 250 * monster.context.services.cvar("skill"));
  monster.installCallbacks(); entity.use = game.named.use(entity, `${heavyPrefix}:lavaman_force_death`);
  game.effect("lava-splash", vsub(monster.origin, { x: 0, y: 0, z: 50 }));
  if (activator !== null && game.isPlayer(activator) && (game.player(activator)?.powerups.get("invisibility") ?? 0) <= game.time && ((game.entity(activator)?.movementFlags ?? 0) & 128) === 0) monster.enemy = activator;
  return monster.play("lavaman_rise1");
}
export function lavaManDefinition(runtime: Q1Mg3Heavy): HeavyDefinition {
  return {
    spec: { species: "lava-man", classnames: ["monster_lava_man"], model: "lavaman", head: null, health: 1500, gibHealth: -Infinity, gibs: [],
      bounds: { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } }, stand: "lavaman_idle1", walk: "lavaman_walk1", run: "lavaman_walk1", sight: "", melee: true, missile: "lavaman_fire1", movement: "walk" }, frames,
    actions: { lavaman_stand: monster => think(monster, "stand"), lavaman_walk: monster => think(monster, "walk"), lavaman_run: monster => think(monster, "run"),
      "lavaman_missile(1)": monster => launch(monster, 1), "lavaman_missile(2)": monster => launch(monster, 2),
      "mg3_lavaman:lavaman_death9": monster => { monster.game.sound(monster.entity, "boss1/out1.wav", "body"); return monster.game.effect("lava-splash", vsub(monster.origin, { x: 0, y: 0, z: 50 })); },
      "mg3_lavaman:lavaman_death10": monster => monster.game.remove(monster.entity),
    },
    callbacks: {
      lavaman_awake: { use: (_game, entity, _other, activator) => awake(runtime.require(entity), activator) },
      lavaman_dead_use: { use: () => undefined },
      lavaman_force_death: { use: (game, entity, _other, activator) => {
        const monster = runtime.require(entity); entity.damageable = false; game.host.combat.setHealth(entity.actor, 0); game.killedMonsters++;
        game.host.emit({ kind: "monster-killed", actor: entity.actor.id, total: game.totalMonsters, found: game.killedMonsters }); game.useTargets(entity, activator);
        monster.countedDeath = true; entity.use = game.named.use(entity, `${heavyPrefix}:lavaman_dead_use`); return monster.play("lavaman_death1");
      } },
      lavaman_touch: { touch: (game, entity, other) => {
        if (entity.owner !== null && sameActor(entity.owner, other)) return undefined;
        if (game.host.contents(game.body(entity).origin) === "sky") return game.remove(entity);
        if (game.health(other) !== 0) game.damage(other, entity.actor.id, entity.owner, game.host.classname(other) === "monster_shambler" ? 20 : 40);
        game.radiusDamage(entity.actor.id, entity.owner, 40, other, null);
        game.setOrigin(entity, vsub(game.body(entity).origin, vscale(normalize(game.body(entity).velocity), 8))); game.effect("explosion", game.body(entity).origin); game.effect("explosion", game.body(entity).origin); return game.remove(entity);
      } },
    },
    spawn: monster => { const { game, entity } = monster; if (game.options.deathmatch !== 0) return game.remove(entity); game.totalMonsters++; entity.spawnflags |= 16384;
      if (entity.targetname !== "") { entity.use = game.named.use(entity, `${heavyPrefix}:lavaman_awake`); return undefined; } return awake(monster, entity.activator); },
    attack: checkAttack, melee: monster => monster.play("lavaman_fire1"),
    pain: monster => { const { entity, game, state } = monster;
      if (entity.count === 0) { entity.count++; state.painFinished = game.time + 2; return monster.play("lavaman_shocka1"); }
      if (state.painFinished > game.time || game.host.random() >= 0.05) return undefined; state.painFinished = game.time + 2; return monster.play("lavaman_shocka1"); },
    die: monster => monster.play("lavaman_death1"),
  };
}
