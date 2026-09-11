/* s_wrath.qc: destination selection, melee and staged death. GPL-2.0-or-later. */
import type { Q1Actor } from "../../foundation/entity.ts";
import type { Q1EntityServices } from "../../foundation/entity-services.ts";
import { POINT, ZERO, dot, length, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { spawnTeleportFog, spawnTeledeath } from "../../foundation/spawns.ts";
import type { MissionMonster } from "./runtime.ts";
import type { PackMonsterDefinition } from "./types.ts";
import { frames } from "./tables/s_wrath.ts";
import { eye, hullBounds, radiusActors } from "./helpers.ts";
import { wrathMissile } from "./wrath.ts";

export function isSpawnPointEmpty(game: Q1EntityServices, point: Q1Actor): boolean {
  for (const actor of radiusActors(game, game.body(point).origin, 64)) {
    if (actor === point.actor.id) continue;
    const other = game.entity(actor);
    if (((other?.movementFlags ?? 0) & 32) !== 0 || game.host.classname(actor) === "player" || other?.think != null) return false;
  }
  return true;
}
export function overlordDestination(game: Q1EntityServices): Q1Actor | null {
  const player = game.host.players()[0] ?? game.world?.actor.id ?? null;
  const body = player === null ? null : game.host.bodies.read(player);
  const basis = game.makeVectors(body?.angles ?? ZERO), origin = body?.origin ?? ZERO;
  let best: Q1Actor | null = null, furthest: Q1Actor | null = null, distance = 0;
  for (const entity of game.entities.values()) {
    if (entity.classname !== "info_overlord_destination" || !isSpawnPointEmpty(game, entity)) continue;
    const delta = vsub(game.body(entity).origin, origin), current = length(delta);
    if (dot(normalize(delta), basis.forward) > 0.6 && current > 150) best = entity;
    if (current > distance) { furthest = entity; distance = current; }
  }
  return best ?? furthest;
}
export function registerOverlordDestination(game: Q1EntityServices): undefined {
  game.registerSpawn("info_overlord_destination", (_game, entity) => {
    const body = game.body(entity); entity.mangle = body.angles; entity.model = "";
    return game.setBody(entity, { angles: ZERO, origin: vadd(body.origin, { x: 0, y: 0, z: 27 }) });
  });
  return undefined;
}
function teleport(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  if ((entity.spawnflags & 2) === 0 || game.host.random() > 0.75) return undefined;
  const destination = overlordDestination(game); if (destination === null) return undefined;
  spawnTeleportFog(game, monster.origin);
  const basis = game.makeVectors(game.body(entity).angles), origin = game.body(destination).origin;
  spawnTeleportFog(game, vadd(origin, vscale(basis.forward, 32))); spawnTeledeath(game, origin, entity.actor.id);
  game.setOrigin(entity, origin); entity.movementFlags &= ~512; return undefined;
}
function toss(monster: MissionMonster, model: string): undefined {
  const { game } = monster, basis = game.makeVectors(game.body(monster.entity).angles);
  const velocity = vadd(vadd(vadd(vscale(basis.forward, 250), vscale(basis.up, 300)), vscale(basis.up, game.host.random() * 100 - 50)), vscale(basis.right, game.host.random() * 200 - 100));
  const gib = game.create("gib"); gib.model = `progs/${model}.mdl`; gib.movement = "bounce"; gib.fields.set("ltime", String(game.time));
  game.setBody(gib, { origin: monster.origin, bounds: POINT }); game.schedule(gib, 10 + game.host.random() * 10, game.named.action(gib, "SUB_Remove"));
  game.setBody(gib, { velocity }); return game.link(gib);
}
function burst(monster: MissionMonster, models: readonly string[]): undefined {
  monster.game.host.emit({ kind: "colored-explosion", origin: monster.origin, colorStart: 0, colorLength: 4 });
  for (const model of models) toss(monster, model);
  return undefined;
}
function smash(monster: MissionMonster): undefined {
  const { game, entity } = monster;
  if (monster.enemy === null || !game.canDamage(monster.enemy, entity.actor.id)) return undefined;
  monster.ai("charge", 10);
  if (monster.target === null || monster.distance > 100) return undefined;
  const damage = 20 + game.host.random() * 10; game.sound(entity, "s_wrath/smash.wav", "weapon"); game.damage(monster.enemy, entity.actor.id, entity.actor.id, damage);
  const target = eye(game, monster.enemy) ?? monster.target, direction = normalize(vsub(target, monster.origin));
  game.host.emit({ kind: "particles", origin: vsub(monster.target, vscale(direction, 30)), direction: vscale(direction, -100), color: 73, count: damage });
  return undefined;
}
function melee(monster: MissionMonster): undefined { const r = monster.game.host.random(); return monster.play(r < 0.33 ? "overlord_at_a01" : r < 0.66 ? "overlord_at_b01" : "overlord_at_c01"); }
export const overlordDefinition: PackMonsterDefinition = {
  spec: { species: "super-wrath", classnames: ["monster_super_wrath"], model: "s_wrath", head: null, health: 1000, gibHealth: -Infinity, gibs: [], bounds: hullBounds,
    stand: "overlord_stand1", walk: "overlord_walk01", run: "overlord_run01", sight: "", missile: "overlord_missile", melee: true, movement: "fly" }, frames,
  actions: {
    overlord_smash: smash, overlord_melee: melee, overlord_teleport: teleport,
    overlord_missile: monster => { monster.game.host.random(); return monster.play("overlord_msl_a01"); },
    "WrathMissile(4)": monster => wrathMissile(monster, 4),
    "s_wrath:overlord_die01": monster => monster.delay(0.05),
    "s_wrath:overlord_die02": monster => { monster.entity.movementFlags |= 1; return monster.delay(0.05); },
    "s_wrath:overlord_die17": monster => { monster.entity.model = ""; burst(monster, ["s_wrtgb2", "s_wrtgb3", "wrthgib1", "wrthgib2", "wrthgib3"]); return monster.delay(0.1); },
    "s_wrath:overlord_die18": monster => { burst(monster, ["gib1", "gib2", "gib3", "gib1", "gib2", "gib3"]); return monster.delay(0.1); },
    "s_wrath:overlord_die19": monster => { burst(monster, ["gib1", "gib2", "gib3", "gib1", "gib2", "gib3"]); return monster.game.remove(monster.entity); },
  },
  pain: monster => { if (monster.state.painFinished > monster.game.time) return undefined; const r = monster.game.host.random(); if (r > 0.2) return undefined;
    monster.play(r < 0.15 ? "overlord_pn_a01" : "overlord_pn_b01"); monster.state.painFinished = monster.game.time + 2; return monster.game.sound(monster.entity, "wrath/wpain.wav"); },
  melee,
  die: monster => monster.play("overlord_die02"),
};
