/* quakec_{mg1,mg3}/monsters.qc InitMonster, StartMonster, monster_begin_walking. GPL-2.0-or-later. */
import type { ActorId } from "../../../../contracts/identity.ts";
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1Foundation } from "../../foundation/runtime.ts";
import type { BaseMonster } from "../../base/monsters.ts";
import { vadd, vsub, yawFor } from "../../foundation/types.ts";
import type { Q1AddonContext } from "../context.ts";
import { callbackName } from "../../foundation/callbacks.ts";

const small = { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } };
const large = { min: { x: -32, y: -32, z: -24 }, max: { x: 32, y: 32, z: 64 } };
const startNames = new WeakMap<Q1Foundation, Set<string>>();
function prefix(monster: BaseMonster): string { return monster.source?.callbackPrefix ?? "base"; }

/** Native spawn functions set their own health and callbacks before InitMonster. */
export function initMg3Monster(monster: BaseMonster, context: Q1AddonContext, model: string, type: 1 | 2 | 3, size: 1 | 2): undefined {
  const { game, entity } = monster;
  if (game.options.deathmatch !== 0 || context.removedForRunes(entity) || context.removedOutsideCoop(entity)) return game.live(entity) ? game.remove(entity) : undefined;
  entity.movementFlags |= 16384; entity.fields.set("mdl", model); context.setNumber(entity, "lefty", type); context.setNumber(entity, "state", size); monster.lefty = true;
  if (context.program === "mg3" || context.services.cvar("horde") === 0 || (entity.spawnflags & 4) === 0) game.totalMonsters++;
  if (context.program === "mg3" && entity.text("health_target") !== "") entity.maxHealth = game.health(entity.actor.id);
  if ((entity.spawnflags & 4) !== 0) { entity.use = game.named.use(entity, `${prefix(monster)}:start`); return undefined; }
  return game.schedule(entity, Math.max(0, entity.nextThink) + game.host.random() * 0.5 - game.time, game.named.action(entity, `${prefix(monster)}:monster_start`));
}

export function startMg3Monster(monster: BaseMonster, context: Q1AddonContext): undefined {
  const { game, entity, spec } = monster, name = prefix(monster), type = entity.number("lefty"), size = entity.number("state");
  const bounds = size === 1 ? small : large;
  entity.solid = "slidebox"; entity.movement = "step"; entity.model = entity.text("mdl"); game.setBounds(entity, bounds);
  if (type === 1) {
    const start = vadd(monster.origin, { x: 0, y: 0, z: 1 }), trace = game.host.trace({ start, end: vsub(start, { x: 0, y: 0, z: 256 }), bounds, ignore: entity.actor.id, monsters: true });
    game.setBody(entity, { origin: trace.fraction < 1 && !trace.allSolid ? trace.end : start, ground: trace.actor });
    if (trace.fraction < 1 && !trace.allSolid) entity.movementFlags |= 512;
  }
  game.host.walkMove(entity.actor, 0, 0);
  if ((entity.spawnflags & 4) !== 0) {
    const death = game.create("teledeath"); death.owner = entity.actor.id; death.solid = "trigger"; death.touch = game.named.touch(death, "tdeath_touch");
    game.setBody(death, { origin: monster.origin, bounds: { min: vsub(bounds.min, { x: 1, y: 1, z: 1 }), max: vadd(bounds.max, { x: 1, y: 1, z: 1 }) } }); game.link(death);
    game.schedule(death, 0.2, game.named.action(death, "SUB_Remove")); if ((entity.spawnflags & 16) !== 0) game.effect("teleport", monster.origin);
  }
  entity.aimedDamage = true; entity.damageable = true; entity.idealYaw = game.body(entity).angles.y; entity.yawSpeed ||= 20;
  context.setVector(entity, "view_ofs", { x: 0, y: 0, z: 25 }); entity.use = game.named.use(entity, `${name}:monster_use`);
  entity.movementFlags |= 32 | (type === 2 ? 1 : type === 3 ? 2 : 0); game.host.combat.setTraits(entity.actor, { team: "q1:monsters" }); game.link(entity);
  const targets = entity.target === "" ? [] : game.find(entity.target);
  if ((entity.spawnflags & 32) !== 0 && entity.target !== "") {
    const alive = targets.filter(target => target.damageable), chosen = alive[Math.floor(game.host.random() * alive.length)]; if (chosen !== undefined) return monster.found(chosen.actor.id);
  }
  const target = targets[0]; if (target !== undefined) entity.idealYaw = yawFor(vsub(game.body(target).origin, monster.origin));
  if (target?.classname === "path_corner" && (entity.spawnflags & 4096) === 0) monster.play(spec.walk);
  else { monster.state.pauseUntil = 99999999; monster.play(spec.stand); if (target?.classname === "path_corner") entity.use = game.named.use(entity, `${name}:walk`); }
  if ((entity.spawnflags & 4) === 0) return monster.delay(entity.nextThink - game.time + game.host.random() * 0.5);
  if (context.program !== "mg3" && [...game.entities.values()].some(candidate => candidate.classname === "horde_manager")) game.totalMonsters++;
  return (entity.spawnflags & 8) !== 0 ? monster.use(entity.activator) : undefined;
}

export function mg3MonsterActivator(game: Q1Foundation, activator: ActorId | null): ActorId | null {
  return activator !== null && game.isPlayer(activator) ? activator : game.host.players().find(player => game.health(player) > 0) ?? null;
}

export function registerMg3MonsterStartup(game: Q1Foundation, name: string, monster: (entity: Q1Actor) => BaseMonster): undefined {
  let names = startNames.get(game); if (names === undefined) { names = new Set<string>(); startNames.set(game, names); } names.add(`${name}:start`);
  game.named.register(`${name}:start`, { use: (_game, entity, _other, activator) => { entity.activator = activator; return monster(entity).start(); } });
  game.named.register(`${name}:walk`, { use: (_game, entity) => {
    const value = monster(entity); if (game.health(entity.actor.id) <= 0 || value.enemy !== null) { entity.use = null; return undefined; }
    entity.use = game.named.use(entity, `${name}:monster_use`); value.state.pauseUntil = 0; return value.play(value.spec.walk);
  } });
  return undefined;
}

export function waitingMg3Monster(game: Q1Foundation, entity: Q1Actor): boolean {
  const name = callbackName(entity.use); return name !== null && (startNames.get(game)?.has(name) ?? false);
}
