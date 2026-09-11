/* wrath.qc and WrathMissile shared by the overlord. GPL-2.0-or-later. */
import type { Q1CallbackHandlers } from "../../foundation/callbacks.ts";
import { ZERO, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { throwGib } from "../../base/projectiles.ts";
import { frames } from "./tables/wrath.ts";
import type { PackMonsterDefinition } from "./types.ts";
import type { MissionMonster } from "./runtime.ts";
import { eye, hullBounds, missile } from "./helpers.ts";

export function wrathMissile(monster: MissionMonster, attack: number): undefined {
  const { game, entity } = monster, target = monster.target;
  if (target === null) return undefined;
  const direction = normalize(vsub(vadd(target, { x: 0, y: 0, z: 10 }), monster.origin)), basis = game.makeVectors(game.body(entity).angles);
  entity.effects |= 2;
  const forward = attack === 1 || attack === 4 ? 20 : attack === 2 ? 18 : 12, up = attack === 4 ? 16 : attack === 2 ? 10 : 12;
  const origin = vadd(vadd(vadd(monster.origin, vscale(basis.forward, forward)), vscale(basis.up, up)), vscale(basis.right, attack === 3 ? 20 : 0));
  const shot = missile(game, entity.actor.id, "wrath_missile", "progs/w_ball.mdl", origin, vscale(direction, 400), "rogue:WrathMissileTouch");
  shot.references.set("enemy", monster.enemy); shot.angularVelocity = { x: 300, y: 300, z: 300 };
  game.schedule(shot, 0.1, game.named.action(shot, "rogue:WrathHome"));
  monster.state.attackFinished = game.time + 2;
  return undefined;
}
export const wrathCallbacks: Readonly<Record<string, Q1CallbackHandlers>> = {
  WrathHome: { action(game, entity) {
    const enemy = entity.references.get("enemy") ?? null;
    if (enemy === null || game.health(enemy) < 1) return game.remove(entity);
    const target = eye(game, enemy);
    if (target !== null) game.setBody(entity, { velocity: vscale(normalize(vsub(target, game.body(entity).origin)), game.options.skill === 3 ? 550 : 400) });
    return game.schedule(entity, 0.1, game.named.action(entity, "rogue:WrathHome"));
  } },
  WrathMissileTouch: { touch(game, entity, other) {
    const classname = game.host.classname(other);
    if (other === entity.owner || classname === "monster_wrath" || classname === "monster_super_wrath") return game.remove(entity);
    if (classname === "monster_zombie") game.damage(other, entity.actor.id, entity.actor.id, 110);
    game.radiusDamage(entity.actor.id, entity.owner, 20, game.world?.actor.id ?? null, null);
    game.sound(entity, "weapons/r_exp3.wav", "weapon"); game.effect("explosion", game.body(entity).origin);
    game.setBody(entity, { velocity: ZERO }); entity.touch = null; entity.model = "progs/s_explod.spr"; entity.solid = "none"; entity.frame = 0; game.link(entity);
    return game.schedule(entity, 0.1, game.named.action(entity, "rogue:wrath_explode"));
  } },
  wrath_explode: { action(game, entity) { entity.frame++; return entity.frame > 5 ? game.remove(entity) : game.schedule(entity, 0.1, game.named.action(entity, "rogue:wrath_explode")); } },
};
export const wrathDefinition: PackMonsterDefinition = {
  spec: { species: "wrath", classnames: ["monster_wrath"], model: "wrath", head: null, health: 400, gibHealth: -Infinity, gibs: ["wrthgib1", "wrthgib2", "wrthgib3"], bounds: hullBounds,
    stand: "wrath_stand1", walk: "wrath_walk01", run: "wrath_run01", sight: "wrath/wsee.wav", missile: "wrath_attack", melee: false, movement: "fly" }, frames, callbacks: wrathCallbacks,
  actions: {
    wrath_attack: monster => { const r = monster.game.host.random(); monster.play(r < 0.25 ? "wrath_at_a01" : r < 0.65 ? "wrath_at_b01" : "wrath_at_c01"); return monster.game.sound(monster.entity, "wrath/watt.wav"); },
    "WrathMissile(1)": monster => wrathMissile(monster, 1), "WrathMissile(2)": monster => wrathMissile(monster, 2), "WrathMissile(3)": monster => wrathMissile(monster, 3),
    "wrath:wrath_die15": monster => {
      const { game, entity } = monster;
      for (const model of ["wrthgib1", "wrthgib2", "wrthgib3"]) throwGib(game, monster.origin, model, game.health(entity.actor.id));
      game.radiusDamage(entity.actor.id, entity.actor.id, 80, game.world?.actor.id ?? null, null);
      game.setBody(entity, { origin: vadd(monster.origin, { x: 0, y: 0, z: 24 }) });
      game.host.emit({ kind: "colored-explosion", origin: monster.origin, colorStart: 0, colorLength: 4 });
      return game.remove(entity);
    },
  },
  spawn: monster => { monster.entity.fields.set("yaw_speed", "35"); return monster.spawnDefault(); },
  pain: monster => {
    if (monster.state.painFinished > monster.game.time) return undefined;
    const r = monster.game.host.random();
    if (r > 0.1) { monster.state.painFinished = monster.game.time + 0.5; return undefined; }
    monster.play(r < 0.07 ? "wrath_pn_a01" : "wrath_pn_b01"); monster.state.painFinished = monster.game.time + 3;
    return monster.game.sound(monster.entity, "wrath/wpain.wav");
  },
  die: monster => monster.play("wrath_die02"),
};
