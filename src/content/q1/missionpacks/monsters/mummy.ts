/* mummy.qc, including delayed wake and blocked stand-up. GPL-2.0-or-later. */
import type { Vec3 } from "../../../../contracts/math.ts";
import { POINT, ZERO, normalize, vadd, vscale, vsub } from "../../foundation/types.ts";
import { throwGib, throwHead } from "../../base/projectiles.ts";
import type { PackMonsterDefinition } from "./types.ts";
import type { MissionMonster } from "./runtime.ts";
import { frames } from "./tables/mummy.ts";
import { hullBounds, number } from "./helpers.ts";

function fire(monster: MissionMonster, offset: Vec3): undefined {
  const { game, entity } = monster;
  monster.face(); const target = monster.target; if (target === null) return undefined;
  game.sound(entity, "zombie/z_shot1.wav", "weapon");
  const basis = game.basis, origin = vadd(vadd(vadd(monster.origin, vscale(basis.forward, offset.x)), vscale(basis.right, offset.y)), vscale(basis.up, offset.z - 24));
  const grenade = game.create("mummy_grenade"); grenade.owner = entity.actor.id; grenade.movement = "bounce"; grenade.solid = "bbox"; grenade.model = "progs/zom_gib.mdl";
  game.makeVectors(game.body(entity).angles);
  game.setBody(grenade, { origin, velocity: { ...vscale(normalize(vsub(target, origin)), 600), z: 200 }, bounds: POINT }); grenade.angularVelocity = { x: 3000, y: 1000, z: 2000 };
  grenade.touch = game.named.touch(grenade, "rogue:mummyGrenadeTouch"); game.schedule(grenade, 2.5, game.named.action(grenade, "SUB_Remove"));
  return game.link(grenade);
}
function wake(monster: MissionMonster): undefined { number(monster, "mummy:asleep", 0); return monster.play("mummy_paine12"); }
export const mummyDefinition: PackMonsterDefinition = {
  spec: { species: "mummy", classnames: ["monster_mummy"], model: "mummy", head: "h_zombie", health: 500, gibHealth: 0, gibs: ["gib1", "gib2", "gib3"], bounds: hullBounds,
    stand: "mummy_stand1", walk: "mummy_walk1", run: "mummy_run1", sight: "zombie/z_idle.wav", missile: "mummy_missile", melee: false, movement: "walk" }, frames,
  callbacks: {
    mummyGrenadeTouch: { touch(game, entity, other) {
      if (other === entity.owner) return undefined;
      if (game.host.combat.read(other)?.canTakeDamage === true) { game.damage(other, entity.actor.id, entity.owner, 15 + game.host.random() * 15); game.sound(entity, "zombie/z_hit.wav", "weapon"); return game.remove(entity); }
      game.sound(entity, "zombie/z_miss.wav", "weapon"); game.setBody(entity, { velocity: ZERO }); entity.angularVelocity = ZERO; entity.touch = game.named.touch(entity, "rogue:mummyGrenadeRemove"); return undefined;
    } },
    mummyGrenadeRemove: { touch: (game, entity) => game.remove(entity) },
  },
  actions: {
    "mummy:mummy_run1": monster => { monster.ai("run", 2); monster.inPain = 0; return undefined; },
    "mummy:mummy_atta13": monster => fire(monster, { x: -10, y: -22, z: 30 }),
    "mummy:mummy_attb14": monster => fire(monster, { x: -10, y: -24, z: 29 }),
    "mummy:mummy_attc12": monster => fire(monster, { x: -12, y: -19, z: 29 }),
    "mummy:mummy_paine11": monster => monster.delay(monster.entity.nextThink - monster.game.time + 5),
    "mummy:mummy_paine12": monster => {
      monster.game.sound(monster.entity, "zombie/z_idle.wav", "voice", 2); monster.game.setBounds(monster.entity, hullBounds); monster.entity.solid = "slidebox";
      if (!monster.game.host.walkMove(monster.entity.actor, 0, 0)) { monster.nextFrame = "mummy_paine11"; monster.entity.solid = "none"; }
      return monster.game.link(monster.entity);
    },
    mummy_wake: wake,
    mummy_missile: monster => { if (monster.entity.number("mummy:asleep") !== 0) return wake(monster); const r = monster.game.host.random(); return monster.play(r < 0.3 ? "mummy_atta1" : r < 0.6 ? "mummy_attb1" : "mummy_attc1"); },
  },
  spawn: monster => {
    monster.spawnDefault();
    if ((monster.entity.spawnflags & 4) !== 0) { monster.entity.maxHealth = 1000; monster.game.host.combat.setHealth(monster.entity.actor, 1000); }
    if ((monster.entity.spawnflags & 2) !== 0) { number(monster, "mummy:asleep", 1); monster.game.setBounds(monster.entity, { min: hullBounds.min, max: { x: 16, y: 16, z: -16 } }); monster.entity.solid = "none"; }
    return undefined;
  },
  start: monster => { monster.startDefault(); if (monster.entity.number("mummy:asleep") !== 0) monster.nextFrame = monster.state.path === "" ? "mummy_sleep" : "mummy_wake"; return undefined; },
  found: (monster, target) => { monster.foundDefault(target); if (monster.entity.number("mummy:asleep") !== 0) monster.nextFrame = "mummy_wake"; return undefined; },
  pain: monster => {
    if (monster.entity.number("mummy:asleep") !== 0) return wake(monster);
    if (monster.state.painFinished > monster.game.time) return undefined;
    const r = monster.game.host.random(); if (r > 0.24) return undefined;
    monster.state.painFinished = monster.game.time + 2.5;
    return monster.play(r < 0.06 ? "mummy_paina1" : r < 0.12 ? "mummy_painb1" : r < 0.18 ? "mummy_painc1" : "mummy_paind1");
  },
  die: monster => {
    const { game, entity } = monster; game.host.combat.setHealth(entity.actor, -35); game.sound(entity, "zombie/z_gib.wav"); throwHead(game, entity, "h_zombie");
    for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, -35);
    return undefined;
  },
};
