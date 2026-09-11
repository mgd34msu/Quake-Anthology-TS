/* quakec_mg3/monsters/mg3_rknight.qc. GPL-2.0-or-later. */
import { throwGib, throwHead } from "../../../base/projectiles.ts";
import type { Vec3 } from "../../../../../contracts/math.ts";
import { ZERO, length, normalize, vadd, vscale, vsub } from "../../../foundation/types.ts";
import { velocityAngles } from "../../../missionpacks/types.ts";
import { BLOODY_NIGHTMARE_ACTIVE } from "../../campaign.ts";
import type { HeavyAction, HeavyDefinition, Q1HeavyMonster } from "./runtime.ts";
import { heavySpike } from "./projectiles.ts";
import { frames } from "./tables/mg3_rknight.ts";

function shot(monster: Q1HeavyMonster, offset: number, variant: 0 | 1 | 2): undefined {
  const { game, entity } = monster, body = game.body(entity), delta = vsub(monster.target ?? ZERO, monster.origin);
  let origin: Vec3, direction: Vec3;
  if (variant === 0) {
    const angles = velocityAngles(delta), forward = game.makeVectors({ ...angles, y: angles.y + offset * 6 }).forward;
    origin = vadd(vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), vscale(forward, 20));
    direction = normalize(forward); direction = { ...direction, z: -direction.z + (game.host.random() - 0.5) * 0.1 };
  } else {
    const forward = game.makeVectors(body.angles).forward;
    origin = vadd(vadd(body.origin, vscale(vadd(body.bounds.min, body.bounds.max), 0.5)), vscale(forward, 10)); direction = normalize(delta);
    const nudge = 0.017 * offset * 6;
    if (variant === 1) { origin = vadd(origin, { x: 0, y: 0, z: 10 }); direction = { ...direction, z: direction.z + nudge }; direction = { ...direction, y: direction.y + (game.host.random() - 0.5) * 0.2 }; }
    else { origin = vadd(origin, { x: 0, y: 0, z: 14 }); direction = { ...direction, y: direction.y + (game.host.random() - 0.5) * 0.1 * (offset + 2) }; direction = { ...direction, z: direction.z + (game.host.random() - 0.5) * 0.1 * (offset + 2) }; }
    direction = normalize(direction);
  }
  const missile = heavySpike(game, entity.actor.id, origin, vscale(direction, 1000)); missile.model = "progs/diamond_trail.mdl";
  game.setBody(missile, { velocity: vscale(direction, (monster.context.base.campaign.readFlags() & BLOODY_NIGHTMARE_ACTIVE) !== 0 ? 600 : 400) }); missile.effects = 64;
  game.link(missile); return game.sound(entity, "hknight/attack1.wav", "weapon");
}
function idle(monster: Q1HeavyMonster): undefined {
  const { game, entity } = monster; if (game.host.random() >= 0.2) return undefined;
  const r = game.host.random(); return game.sound(entity, `rknight/idle_${r < 0.3 ? "02" : r < 0.6 ? "03" : "05"}.wav`);
}
function painSound(monster: Q1HeavyMonster): undefined { const r = monster.game.host.random(); return monster.game.sound(monster.entity, `rknight/pain_0${r < 0.3 ? 1 : r < 0.6 ? 2 : 3}.wav`); }
function magic(monster: Q1HeavyMonster): undefined {
  const delta = vsub(monster.target ?? ZERO, monster.origin), r = length(delta) > 300 ? 0.6 : 0.2;
  if (monster.game.host.random() < r) return monster.play("rknight_magicb1");
  return monster.play(monster.game.host.random() > (delta.z > 100 ? 0.7 : 0.5) ? "rknight_magica1" : "rknight_magicc1");
}
const actions: Record<string, HeavyAction> = {
  rk_idle_sound: idle, rknight_pain_sound: painSound, rknight_magic: magic,
  rknight_run: monster => monster.play((monster.entity.spawnflags & 2) !== 0 ? "rknight_runb1" : "rknight_run1"),
  rknight_melee: monster => {
    monster.runtime.runeKnightMeleeCycle++; monster.game.sound(monster.entity, "hknight/slash1.wav", "weapon");
    if (monster.runtime.runeKnightMeleeCycle === 1) return monster.play("rknight_slice1");
    if (monster.runtime.runeKnightMeleeCycle === 2) return monster.play("rknight_smash1");
    if (monster.runtime.runeKnightMeleeCycle === 3) { monster.play("rknight_watk1"); monster.runtime.runeKnightMeleeCycle = 0; }
    return undefined;
  },
  "mg3_rknight:rknight_magicb6": monster => { monster.face(); return monster.number("ammo_nails", Math.floor(monster.game.host.random() * 8 + 0.5)); },
  "mg3_rknight:rknight_magicb12": monster => { monster.face(); shot(monster, 3, 2); monster.number("ammo_nails", monster.entity.number("ammo_nails") - 1); if (monster.entity.number("ammo_nails") > 0) monster.nextFrame = "rknight_magicb12"; return undefined; },
};
for (let i = 0; i < 5; i++) {
  const offset = 1.5 - i; actions[`mg3_rknight:rknight_magica${8 + i}`] = monster => { monster.face(); return shot(monster, offset, 1); };
  const spread = i - 2; actions[`mg3_rknight:rknight_magicb${7 + i}`] = monster => { monster.face(); return shot(monster, spread, 2); };
}
for (let i = 0; i < 6; i++) { const offset = i - 2; actions[`mg3_rknight:rknight_magicc${6 + i}`] = monster => shot(monster, offset, 0); }
export const runeKnightDefinition: HeavyDefinition = {
  spec: { species: "hellknight", classnames: ["monster_ranged_knight"], model: "rknight", head: "h_hellkn", health: 250, gibHealth: -40, gibs: ["gib1", "gib2", "gib3"],
    bounds: { min: { x: -16, y: -16, z: -24 }, max: { x: 16, y: 16, z: 40 } }, stand: "rknight_stand1", walk: "rknight_walk1", run: "rknight_run", sight: "", melee: false, missile: "rknight_magic", movement: "walk" }, frames, actions,
  spawn: monster => { monster.game.host.combat.setHealth(monster.entity.actor, 250); monster.number("allowPathFind", 1); monster.number("combat_style", 1); return monster.initialize(1); },
  sight: monster => monster.game.sound(monster.entity, monster.game.host.random() < 0.5 ? "rknight/sight_01.wav" : "rknight/sight_03.wav"),
  pain: (monster, _attacker, damage) => {
    const { game, state } = monster; if (state.painFinished > game.time) return undefined;
    if (game.time - state.painFinished > 5) { monster.play("rknight_pain1"); state.painFinished = game.time + 1; return undefined; }
    if (game.host.random() * 30 > damage) return undefined;
    state.painFinished = game.time + 1; return monster.play("rknight_pain1");
  },
  die: monster => {
    const { game, entity } = monster, health = game.health(entity.actor.id);
    if (health < -40) { game.sound(entity, "player/udeath.wav"); throwHead(game, entity, "h_hellkn", health); for (const model of ["gib1", "gib2", "gib3"]) throwGib(game, monster.origin, model, health); return undefined; }
    game.sound(entity, game.host.random() < 0.5 ? "rknight/death_01.wav" : "rknight/death_02.wav"); return monster.play(game.host.random() > 0.5 ? "rknight_die1" : "rknight_dieb1");
  },
};
